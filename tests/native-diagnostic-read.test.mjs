import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {createDiagnosticReader} from "../server/native-diagnostic-read.ts";

const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class Client extends EventEmitter{
  calls=[];releases=[];work;
  async query(text,values){
    this.calls.push({text,values});
    if(this.work)return this.work(text,values);
    return {rows:[{ready:true}]};
  }
  release(destroy){this.releases.push(destroy);}
}
const sanitized=error=>error.message==="Upload diagnostics unavailable";

test("diagnostic reads enforce a read-only transaction and destroy the dedicated connection",async()=>{
  const client=new Client(),read=createDiagnosticReader(async()=>client,500);
  const value=await read(async query=>(await query("select example",[201])).rows[0]);
  assert.deepEqual(value,{ready:true});
  assert.deepEqual(client.calls.map(call=>call.text),[
    "begin read only","set local statement_timeout='2s'","set local lock_timeout='500ms'",
    "select example","commit",
  ]);
  assert.deepEqual(client.calls.at(-2).values,[201]);assert.deepEqual(client.releases,[true]);
  assert.equal(client.listenerCount("error"),0);
});
test("a stalled query retains admission after timeout until its response settles",async()=>{
  const held=deferred(),entered=deferred(),client=new Client();let connects=0;
  client.work=async text=>{
    if(text==="select stalled"){entered.resolve();return held.promise;}
    return {rows:[]};
  };
  const read=createDiagnosticReader(async()=>{connects++;return client;},50);
  const pending=read(query=>query("select stalled"));await entered.promise;
  const began=performance.now();
  for(let i=0;i<20;i++)await assert.rejects(read(async()=>{}),sanitized);
  await assert.rejects(pending,sanitized);
  assert.ok(performance.now()-began<1000);assert.equal(connects,1);
  assert.deepEqual(client.releases,[true]);
  for(let i=0;i<20;i++)await assert.rejects(read(async()=>{}),sanitized);
  assert.equal(connects,1);
  held.resolve({rows:[]});await turn();
  assert.equal(client.calls.some(call=>call.text==="commit"),false);
});
test("a late acquisition is destroyed without starting a transaction or admitting a queued request",async()=>{
  const acquisition=deferred(),late=new Client(),fresh=new Client();let connects=0;
  const read=createDiagnosticReader(()=>++connects===1?acquisition.promise:Promise.resolve(fresh),30);
  await assert.rejects(read(async()=>{}),sanitized);
  for(let i=0;i<20;i++)await assert.rejects(read(async()=>{}),sanitized);
  assert.equal(connects,1);
  acquisition.resolve(late);await turn();
  assert.deepEqual(late.calls,[]);assert.deepEqual(late.releases,[true]);
  assert.equal(await read(async()=>"recovered"),"recovered");
  assert.equal(connects,2);assert.deepEqual(fresh.releases,[true]);
});
test("connection and query failures are sanitized and allow a later request",async()=>{
  const client=new Client();let calls=0;
  const read=createDiagnosticReader(async()=>{
    if(calls++===0)throw Error("private-connection-detail");
    return client;
  });
  await assert.rejects(read(async()=>{}),sanitized);
  client.work=async()=>{throw Error("private-query-detail");};
  await assert.rejects(read(async()=>{}),sanitized);
  assert.deepEqual(client.releases,[true]);
});
test("disconnect cancellation destroys active reads but does not release admission early",async()=>{
  const held=deferred(),entered=deferred(),client=new Client(),controller=new AbortController();let connects=0;
  client.work=async text=>{
    if(text==="select held"){entered.resolve();return held.promise;}
    return {rows:[]};
  };
  const read=createDiagnosticReader(async()=>{connects++;return client;});
  const pending=read(query=>query("select held"),controller.signal);await entered.promise;
  controller.abort();await assert.rejects(pending,sanitized);
  await assert.rejects(read(async()=>{}),sanitized);assert.equal(connects,1);
  assert.deepEqual(client.releases,[true]);
  held.reject(Error("socket closed"));await turn();
  assert.equal(client.calls.some(call=>call.text==="commit"),false);
});
test("a pre-aborted request never acquires a connection",async()=>{
  const controller=new AbortController();controller.abort();let connects=0;
  const read=createDiagnosticReader(async()=>{connects++;return new Client();});
  await assert.rejects(read(async()=>{},controller.signal),sanitized);assert.equal(connects,0);
});
test("a connection error destroys the read and never returns it to the pool",async()=>{
  const client=new Client(),held=deferred(),entered=deferred();
  client.work=async text=>{
    if(text==="select held"){entered.resolve();return held.promise;}
    return {rows:[]};
  };
  const read=createDiagnosticReader(async()=>client);
  const pending=read(query=>query("select held"));await entered.promise;
  client.emit("error",Error("private-provider-detail"));await assert.rejects(pending,sanitized);
  held.reject(Error("closed"));await turn();assert.deepEqual(client.releases,[true]);
  assert.equal(client.listenerCount("error"),0);
});
