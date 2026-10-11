// Disposable local PostgreSQL plus a loopback WebSocket transport for the
// existing Neon driver. No connected development/production database is used.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { WebSocketServer } from "ws";
const exec=promisify(execFile);
const directory=await mkdtemp(path.join(tmpdir(),"vco-photo-pg-"));
const portServer=createServer();
portServer.listen(0,"127.0.0.1");await once(portServer,"listening");
const pgPort=portServer.address().port;portServer.close();await once(portServer,"close");
let pg,proxy;
try {
  await exec("initdb",["-D",directory,"-A","trust","--no-locale","--username=vco_test"]);
  pg=spawn("postgres",["-D",directory,"-h","127.0.0.1","-p",String(pgPort),"-k",directory],{stdio:"ignore"});
  let ready=false;
  for(let i=0;i<80;i++) {
    try {await exec("pg_isready",["-h","127.0.0.1","-p",String(pgPort)]);ready=true;break;}
    catch {await new Promise(r=>setTimeout(r,100));}
  }
  if(!ready)throw new Error("Disposable local PostgreSQL failed to start");
  await exec("createdb",["-h","127.0.0.1","-p",String(pgPort),"-U","vco_test","photo_test"]);
  const env={...process.env,DATABASE_URL:`postgresql://vco_test@127.0.0.1:${pgPort}/photo_test?sslmode=disable`,
    NODE_ENV:"development"};
  await exec(process.execPath,["node_modules/drizzle-kit/bin.cjs","push","--force"],{env,maxBuffer:2_000_000});
  proxy=new WebSocketServer({port:0,host:"127.0.0.1"});
  await once(proxy,"listening");
  proxy.on("connection",socket=>{
    const tcp=connect(pgPort,"127.0.0.1");
    socket.on("message",data=>tcp.write(data));
    tcp.on("data",data=>{if(socket.readyState===1)socket.send(data);});
    tcp.on("error",()=>socket.close());
    tcp.on("close",()=>socket.close());
    socket.on("close",()=>tcp.destroy());
    socket.on("error",()=>tcp.destroy());
  });
  env.VCO_TEST_PG_PROXY=String(proxy.address().port);
  env.VCO_TEST_OBJECTS=path.join(directory,"fixture-objects");
  env.NODE_OPTIONS=`--import=${path.resolve("tests/helpers/local-postgres-transport.mjs")} --import=${path.resolve("tests/helpers/local-object-storage.mjs")}`;
  const files=process.argv.slice(2);
  const child=spawn(process.execPath,["--import","tsx","--test","--test-concurrency=1",
    ...(files.length?files:["tests/media-objects.test.mjs","tests/low-resolution-download.test.mjs","tests/image-download-routes.test.mjs","tests/media-budget.test.mjs",
      // Photo import/offline downloads are exercised by image-download-routes.
      // The broader mixed video/import suite can still be requested explicitly.
      "tests/creator-upload.test.mjs","tests/download-access.test.mjs"])],{env,stdio:"inherit"});
  const [code]=await once(child,"exit");
  process.exitCode=code ?? 1;
} finally {
  if(proxy){for(const client of proxy.clients)client.terminate();proxy.close();}
  if(pg){const stopped=once(pg,"exit");pg.kill("SIGTERM");await stopped;}
  await rm(directory,{recursive:true,force:true});
}
