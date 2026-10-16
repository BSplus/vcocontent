import test from "node:test";
import assert from "node:assert/strict";
import {once} from "node:events";
import {connect} from "node:net";
import {Pool,neonConfig} from "@neondatabase/serverless";
import WebSocket,{WebSocketServer} from "ws";
import {createDiagnosticReader} from "../server/native-diagnostic-read.ts";

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test("diagnostics tolerate real loopback connection and response stalls",{
  skip:!process.env.VCO_TEST_PG_PROXY||!process.env.VCO_TEST_OBJECTS,timeout:20000,
},async t=>{
  assert.equal(new URL(process.env.DATABASE_URL).hostname,"127.0.0.1");
  const original=neonConfig.wsProxy,originalConstructor=neonConfig.webSocketConstructor;
  neonConfig.webSocketConstructor=WebSocket;
  const proxy=new WebSocketServer({port:0,host:"127.0.0.1"});
  await once(proxy,"listening");
  let silentConnect=false,silentReplies=false,connections=0;
  const sockets=new Set(),pools=[];
  proxy.on("connection",socket=>{
    connections++;
    socket.on("error",()=>{});
    if(silentConnect)return;
    const tcp=connect(Number(process.env.VCO_TEST_PG_PORT),"127.0.0.1");sockets.add(tcp);
    socket.on("message",bytes=>tcp.write(bytes));
    tcp.on("data",bytes=>{if(!silentReplies&&socket.readyState===1)socket.send(bytes);});
    tcp.on("error",()=>socket.close());tcp.on("close",()=>{sockets.delete(tcp);socket.close();});
    socket.on("close",()=>tcp.destroy());socket.on("error",()=>tcp.destroy());
  });
  neonConfig.wsProxy=()=>`127.0.0.1:${proxy.address().port}`;
  const make=(queryTimeout=350)=>{
    const pool=new Pool({connectionString:process.env.DATABASE_URL,
      max:1,connectionTimeoutMillis:350,query_timeout:queryTimeout});
    pools.push(pool);return pool;
  };
  try{
    await t.test("silent startup cannot accumulate acquisitions",async()=>{
      silentConnect=true;
      const pool=make(),read=createDiagnosticReader(()=>pool.connect(),100),started=performance.now();
      await assert.rejects(read(async()=>{}),/Upload diagnostics unavailable/);
      assert.ok(performance.now()-started<1500);
      for(let i=0;i<20;i++)await assert.rejects(read(async()=>{}),/Upload diagnostics unavailable/);
      assert.equal(connections,1);
      await wait(500);
      assert.equal(pool.totalCount,0);assert.equal(pool.waitingCount,0);
      silentConnect=false;
      assert.equal(await read(async query=>(await query("select 1 as ok")).rows[0].ok),1);
      assert.equal(pool.totalCount,0);
    });
    await t.test("lost SELECT replies close the socket without admitting queued work",async()=>{
      const pool=make(),read=createDiagnosticReader(()=>pool.connect(),200);
      let entered;const ready=new Promise(resolve=>{entered=resolve;});
      const pending=read(async query=>{
        silentReplies=true;entered();
        return query("select 1 as fixture_read_only");
      });
      await ready;
      const before=connections;
      for(let i=0;i<20;i++)await assert.rejects(read(async()=>{}),/Upload diagnostics unavailable/);
      await assert.rejects(pending,/Upload diagnostics unavailable/);
      assert.equal(connections,before);
      silentReplies=false;await wait(500);
      assert.equal(pool.totalCount,0);assert.equal(pool.waitingCount,0);assert.equal(sockets.size,0);
      assert.equal(await read(async query=>(await query("select 2 as ok")).rows[0].ok),2);
    });
    await t.test("server statement limits and read-only mode remain effective",async()=>{
      const pool=make(5000),read=createDiagnosticReader(()=>pool.connect(),4000);
      let statementFailed=false;const began=performance.now();
      await assert.rejects(read(async query=>{
        try{await query("select pg_sleep(8)");}
        catch(error){statementFailed=true;throw error;}
      }),/Upload diagnostics unavailable/);
      assert.equal(statementFailed,true);assert.ok(performance.now()-began<3500);
      await assert.rejects(read(query=>query("create table diagnostic_must_not_exist(id integer)")),
        /Upload diagnostics unavailable/);
      const result=await read(query=>query("select to_regclass('diagnostic_must_not_exist') as name"));
      assert.equal(result.rows[0].name,null);
    });
  }finally{
    neonConfig.wsProxy=original;neonConfig.webSocketConstructor=originalConstructor;silentReplies=false;
    for(const socket of proxy.clients)socket.terminate();
    for(const tcp of sockets)tcp.destroy();
    await Promise.all(pools.map(pool=>pool.end()));
    await new Promise(resolve=>proxy.close(resolve));
  }
});
