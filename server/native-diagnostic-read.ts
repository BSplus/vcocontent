import type {PoolClient} from "@neondatabase/serverless";

const unavailable=()=>new Error("Upload diagnostics unavailable");
type Query=(text:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>;

/** One read-only operation, no waiting queue. Timed-out acquisitions retain
 * admission until settled; late connections are destroyed, never reused. */
export function createDiagnosticReader(connect:()=>Promise<PoolClient>,deadlineMs=6500){
  let running=false;
  return async function read<T>(work:(query:Query)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    if(running||signal?.aborted)throw unavailable();
    running=true;
    let client:PoolClient|undefined,closed=false,timer:ReturnType<typeof setTimeout>|undefined;
    let cancelled=false,rejectCancellation:(error:Error)=>void=()=>{};
    const cancellation=new Promise<never>((_,reject)=>{rejectCancellation=reject;});
    const close=()=>{
      if(client&&!closed){
        closed=true;client.removeListener("error",cancel);
        client.release(true);
      }
    };
    const cancel=()=>{
      if(cancelled)return;
      cancelled=true;close();rejectCancellation(unavailable());
    };
    signal?.addEventListener("abort",cancel,{once:true});
    timer=setTimeout(cancel,deadlineMs);
    const operation=(async()=>{
      try{
        client=await connect();
        if(cancelled){close();throw unavailable();}
        client.once("error",cancel);
        const query:Query=async(text,values)=>{
          if(cancelled)throw unavailable();
          const result=await client!.query(text,values);
          if(cancelled)throw unavailable();
          return result;
        };
        await query("begin read only");
        await query("set local statement_timeout='2s'");
        await query("set local lock_timeout='500ms'");
        const result=await work(query);
        await query("commit");
        return result;
      }finally{
        close();running=false;
      }
    })();
    try{return await Promise.race([operation,cancellation]);}
    catch{throw unavailable();}
    finally{
      if(timer)clearTimeout(timer);
      signal?.removeEventListener("abort",cancel);
    }
  };
}
