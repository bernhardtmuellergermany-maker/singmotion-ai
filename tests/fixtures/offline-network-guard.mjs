// Loaded in offline CLI subprocesses before application imports. Any attempted
// HTTP/S3/provider transport fails the process even if application code catches it.
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
let attempts = 0;
function denied() {
  attempts++;
  throw new Error("Offline preflight forbids network access.");
}
globalThis.fetch = denied;
net.Socket.prototype.connect = denied;
tls.connect = denied;
syncBuiltinESMExports();
process.on("exit", () => {
  if (attempts) process.exitCode = 99;
});
