// Optional test preload for an isolated, disposable PostgreSQL database.
// Never imported by app runtime; no production secrets or connection settings.
import { connect } from "node:net";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { neonConfig } from "@neondatabase/serverless";

const port = Number(process.env.VIDEO_TEST_PG_PORT);
if (process.env.NODE_ENV === "production" || !Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("Disposable local PostgreSQL port required");
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
server.on("connection", ws => {
  const socket = connect({host:"127.0.0.1",port});
  ws.on("message", bytes => socket.write(bytes));
  socket.on("data", bytes => { if (ws.readyState === 1) ws.send(bytes); });
  socket.on("error", () => ws.close());
  socket.on("close", () => ws.close());
  ws.on("close", () => socket.destroy());
  ws.on("error", () => socket.destroy());
});
server._server.unref();
neonConfig.wsProxy = `127.0.0.1:${server.address().port}`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;
process.env.DATABASE_URL = `postgresql://video_fixture@127.0.0.1:${port}/video_fixture`;
