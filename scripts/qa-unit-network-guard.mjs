import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

const blocked = () => {
  throw new Error("QA_UNIT_NETWORK_BLOCKED");
};

globalThis.fetch = async () => blocked();
for (const transport of [http, https]) {
  transport.request = blocked;
  transport.get = blocked;
}
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
dgram.createSocket = blocked;
syncBuiltinESMExports();