import {createHash} from "node:crypto";
import type {Pool,PoolClient} from "@neondatabase/serverless";
import {drizzle} from "drizzle-orm/neon-serverless";
import {and,eq,sql} from "drizzle-orm";
import {createMediaLeasePool} from "./db";
import * as schema from "@shared/schema";
import {r2MultipartJournals as journals} from "@shared/r2-multipart-schema";
import {creatorAllowed,communityLimits,lockedCreatorBudget} from "./beta-policy";
import {mediaPolicy,MediaLimitError} from "./media-policy";
import {ObjectStoreError} from "./object-store";
import {MultipartUploadError,multipartPlanBinding,restoreMultipartCheckpoint,
  type MultipartCheckpoint,type MultipartJournal,type MultipartPlan} from "./r2-multipart-upload";
import type {R2MultipartDriver} from "./r2-multipart-driver";

export class MultipartJournalError extends Error {
  constructor(public code:"busy"|"closed"|"conflict"|"unavailable"|"lease_lost"|"denied"){
    super(`Multipart journal ${code}`);this.name="MultipartJournalError";
  }
}
const fail=(code:ConstructorParameters<typeof MultipartJournalError>[0]):never=>{throw new MultipartJournalError(code);};
let leasePool:Pool|undefined;
// Bound client-side reads too: statement_timeout alone cannot terminate a
// request whose response is lost in a network partition. Same connection
// configuration as the verified application pool, never a second database.
const connections=()=>leasePool??=createMediaLeasePool();
const lockId=(name:string)=>{
  const bytes=createHash("sha256").update(name).digest();
  return [bytes.readInt32BE(0),bytes.readInt32BE(4)] as [number,number];
};
const transitions:Record<MultipartCheckpoint["phase"],readonly MultipartCheckpoint["phase"][]>={
  initiating:["initiating","uploading"],uploading:["uploading","completing","aborting"],
  completing:["completing","verified"],verified:["verified"],aborting:["aborting","aborted"],aborted:["aborted"],
};

/** Real autocommit checkpoints under dedicated PostgreSQL session locks.
 * Never wrap the network operation in a transaction: rollback after a crash
 * must not erase the write intent that was saved before the provider request.
 * Unwired until schema, media handoff and cleanup integration are approved.
 */
export class PostgresMultipartJournal implements MultipartJournal {
  private readonly plan:MultipartPlan;
  private readonly binding:string;
  private readonly lost=new AbortController();
  readonly signal:AbortSignal;
  private client:PoolClient|null=null;
  private running=false;
  constructor(plan:MultipartPlan,private readonly driver:R2MultipartDriver,signal?:AbortSignal){
    this.plan=structuredClone(plan);
    this.binding=multipartPlanBinding(this.plan,driver);
    this.signal=AbortSignal.any([signal??new AbortController().signal,this.lost.signal]);
  }
  private held(){
    if(this.signal.aborted||!this.client)fail("lease_lost");
    return this.client!;
  }
  async authorize(plan:MultipartPlan,stage:"upload"|"verify"|"cancel"){
    if(multipartPlanBinding(plan,this.driver)!==this.binding)fail("conflict");
    const db=drizzle({client:this.held(),schema});
    await db.transaction(async tx=>{
      // Match finish/cleanup: reservation before owner, gallery and session.
      const [reservation]=await tx.select().from(schema.mediaReservations)
        .where(eq(schema.mediaReservations.id,this.plan.sessionId)).for("update");
      if(!reservation||reservation.eventId!==plan.eventId||reservation.creatorId!==plan.owner.creatorId||
        reservation.storageKey!==plan.key||!Number.isSafeInteger(reservation.reservedBytes)||
        reservation.reservedBytes<plan.size)fail("denied");
      if(plan.owner.creatorId!==null)
        await tx.select().from(schema.users).where(eq(schema.users.id,plan.owner.creatorId)).for("update");
      const [actor]=await tx.select().from(schema.users).where(eq(schema.users.id,plan.actorId));
      const [event]=await tx.select().from(schema.events).where(eq(schema.events.id,plan.eventId)).for("update");
      const [session]=await tx.select().from(schema.mediaUploadSessions)
        .where(eq(schema.mediaUploadSessions.id,plan.sessionId)).for("update");
      if(!actor||!creatorAllowed(actor)||!event||event.creatorId!==plan.owner.creatorId||
        !actor.isAdmin&&event.creatorId!==actor.id||event.isPremium||
        !session||session.actorId!==plan.actorId||session.eventId!==plan.eventId||
        session.ownerId!==plan.owner.creatorId||session.state!=="finalizing"||session.cleanedAt||
        session.size!==plan.size||session.mime!==plan.mime||session.sha256!==plan.sha256||
        session.requestFingerprint!==plan.owner.revision||session.expiresAt.getTime()!==plan.expiresAt)
        fail("denied");
      if(stage==="upload"){
        this.driver.writable();
        if(plan.expiresAt<=Date.now())fail("closed");
        const limit=plan.mime.startsWith("image/")
          ? plan.owner.kind==="creator"?communityLimits.imageBytes:mediaPolicy.imageBytes:mediaPolicy.videoBytes;
        if(plan.size>limit||plan.owner.kind==="creator"&&!plan.mime.startsWith("image/"))fail("denied");
        if(plan.owner.creatorId!==null)await lockedCreatorBudget(tx,plan.owner.creatorId,0,0,0,0,true,"CREATOR");
      }
    });
    this.held();
  }
  async exclusive<T>(scope:string,key:string,sessionId:string,
    work:(saved:unknown,save:(state:MultipartCheckpoint)=>Promise<void>)=>Promise<T>):Promise<T>{
    if(this.running)fail("busy");
    if(scope!==this.driver.scope||key!==this.plan.key||sessionId!==this.plan.sessionId)fail("conflict");
    if(this.signal.aborted)fail("lease_lost");
    this.running=true;
    let client:PoolClient|undefined,timer:ReturnType<typeof setInterval>|undefined;
    try{
      client=await this.connect();
      this.client=client;
      client.on("error",()=>this.lost.abort(new MultipartJournalError("lease_lost")));
      await client.query("set statement_timeout='5s'");
      await client.query("set lock_timeout='2s'");
      await client.query("set application_name='vco-r2-multipart-journal'");
      for(const name of [`vco-r2-session:${sessionId}`,`vco-r2-destination:${scope}:${key}`]){
        const {rows}=await client.query("select pg_try_advisory_lock($1::integer,$2::integer) as acquired",lockId(name));
        if(rows[0]?.acquired!==true)fail("busy");
      }
      let pulsing=false;
      timer=setInterval(()=>{
        if(pulsing||!this.client)return;
        pulsing=true;
        void this.client.query("select 1").catch(()=>this.lost.abort(new MultipartJournalError("lease_lost")))
          .finally(()=>{pulsing=false;});
      },5000);timer.unref();
      const db=drizzle({client,schema});
      let [row]=await db.select().from(journals).where(eq(journals.sessionId,sessionId));
      if(!row){
        const [destination]=await db.select({id:journals.sessionId}).from(journals)
          .where(and(eq(journals.scope,scope),eq(journals.objectKey,key)));
        if(destination)fail("conflict");
      }
      if(row&&(row.scope!==scope||row.objectKey!==key||row.binding!==this.binding||row.reservationId!==sessionId))
        fail("conflict");
      await this.authorize(this.plan,"verify");
      let previous=restoreMultipartCheckpoint(row?.checkpoint,this.binding,this.plan),revision=row?.revision??0;
      const save=async(input:MultipartCheckpoint)=>{
        if(this.held()!==client)fail("lease_lost");
        const next=restoreMultipartCheckpoint(structuredClone(input),this.binding,this.plan);
        if(!next||Buffer.byteLength(JSON.stringify(next))>16384||
          (!previous?next.phase!=="initiating":
            !transitions[previous.phase].includes(next.phase)||
            previous.uploadId!==undefined&&previous.uploadId!==next.uploadId||
            previous.version!==undefined&&previous.version!==next.version||
            next.parts.length<previous.parts.length||next.parts.length>previous.parts.length+1||
            previous.parts.some((part,i)=>JSON.stringify(part)!==JSON.stringify(next.parts[i]))))
          fail("conflict");
        if(!row){
          // Read-only inspection/cancel with no intent must not create a journal.
          // Only a validated write intent pins the existing reservation.
          await this.authorize(this.plan,"upload");
          const inserted=await db.insert(journals).values({sessionId,reservationId:sessionId,scope,
            objectKey:key,binding:this.binding,revision:1,checkpoint:next}).onConflictDoNothing().returning();
          if(inserted.length!==1)fail("conflict");
          row=inserted[0];previous=next;revision=1;return;
        }
        const changed=await db.update(journals).set({checkpoint:next,revision:revision+1,updatedAt:new Date()})
          .where(and(eq(journals.sessionId,sessionId),eq(journals.revision,revision),
            eq(journals.scope,scope),eq(journals.objectKey,key),eq(journals.binding,this.binding),
            eq(journals.reservationId,sessionId))).returning({id:journals.sessionId});
        if(changed.length!==1){this.lost.abort(new MultipartJournalError("lease_lost"));fail("lease_lost");}
        previous=next;revision++;
      };
      // Await before releasing the lease, including rejecting async operations.
      return await work(structuredClone(previous),save);
    }catch(error){
      if(error instanceof MultipartJournalError||error instanceof MultipartUploadError)throw error;
      // Provider/authorization errors with public codes may propagate, never SQL
      // error text containing connection details, keys or checkpoint contents.
      if(error instanceof ObjectStoreError||error instanceof MediaLimitError)throw error;
      throw new MultipartJournalError(this.signal.aborted?"lease_lost":"unavailable");
    }finally{
      if(timer)clearInterval(timer);
      this.client=null;this.running=false;
      // Destroy, never return a session holding advisory locks to the pool.
      client?.release(true);
    }
  }
  private async connect(){
    let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
    const pending=connections().connect();
    void pending.then(client=>{if(expired)client.release(true);}).catch(()=>{});
    try{
      return await Promise.race([pending,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{expired=true;reject(new MultipartJournalError("unavailable"));},5000);
      })]);
    }finally{if(timer)clearTimeout(timer);}
  }
}

export function databaseMultipartContext(plan:MultipartPlan,driver:R2MultipartDriver,signal?:AbortSignal){
  const journal=new PostgresMultipartJournal(plan,driver,signal);
  return {driver,journal,signal:journal.signal,
    authorize:(current:MultipartPlan,stage:"upload"|"verify"|"cancel")=>journal.authorize(current,stage)};
}
