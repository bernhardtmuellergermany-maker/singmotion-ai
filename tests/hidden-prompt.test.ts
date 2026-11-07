import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { hiddenPrompt } from "../scripts/hidden-prompt.ts";
function terminal(tty = true) {
  const input = Object.assign(new PassThrough(), {
    isTTY: tty,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: tty });
  let text = "";
  output.on("data", (chunk) => (text += chunk.toString()));
  return {
    input,
    output,
    read: () =>
      hiddenPrompt(
        "Hidden: ",
        input as unknown as ReadStream,
        output as unknown as WriteStream,
      ),
    text: () => text,
  };
}
test("hidden prompt refuses redirected stdin/stdout", async () => {
  await assert.rejects(terminal(false).read(), /interactive terminal/);
});
test("hidden prompt disables echo, supports deletion and restores raw mode", async () => {
  const t = terminal();
  const result = t.read();
  assert.equal(t.input.isRaw, true);
  t.input.write("secretz\x7f-password\r");
  assert.equal(await result, "secret-password");
  assert.equal(t.input.isRaw, false);
  assert.equal(t.text(), "Hidden: \n");
});
test("hidden prompt restores terminal and sanitizes cancellation and multiline paste", async () => {
  for (const value of [
    "private\x03",
    "private\x04",
    "private\x1b",
    "private\rsecond-line",
    "x".repeat(1025),
  ]) {
    const t = terminal();
    const result = t.read();
    t.input.write(value);
    await assert.rejects(result, /Recovery cancelled/);
    assert.equal(t.input.isRaw, false);
    assert.equal(t.text(), "Hidden: \n");
  }
});

test("echo is disabled before the password prompt becomes visible", async () => {
  const t = terminal();
  t.output.on("data", (chunk) => {
    if (chunk.toString().includes("Hidden:")) assert.equal(t.input.isRaw, true);
  });
  const result = t.read();
  t.input.write("safe\r");
  assert.equal(await result, "safe");
});
