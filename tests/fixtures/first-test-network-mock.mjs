// Explicit test preload only. All external socket access is fatal.
import net from "node:net";
import tls from "node:tls";
import { appendFileSync } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
const denied = () => {
  process.exit(99);
};
net.Socket.prototype.connect = denied;
tls.connect = denied;
const record = (value) =>
  appendFileSync(process.env.FIRST_TEST_MOCK_CALLS, value + "\n");
S3Client.prototype.send = async function (command) {
  if (!(command instanceof PutObjectCommand))
    throw Error("Unexpected storage operation");
  record("PUT");
  return {};
};
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.origin !== "https://cv.byteplusapi.com") process.exit(99);
  const action = url.searchParams.get("Action");
  record(action);
  if (action === "CVSync2AsyncSubmitTask")
    return Response.json({ code: 10000, data: { task_id: "cli-mock-task" } });
  if (action === "CVSync2AsyncGetResult")
    return Response.json({
      code: 10000,
      data: {
        status: "done",
        video_url: "https://unknown-output.example/video?mock=capability",
      },
    });
  throw Error("Unexpected provider operation");
};
