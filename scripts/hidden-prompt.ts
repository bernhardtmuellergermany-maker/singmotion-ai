import type { ReadStream, WriteStream } from "node:tty";

// Raw TTY only: never readline's echoing mode, argv, environment or redirected input.
export function hiddenPrompt(
  label: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function")
    return Promise.reject(new Error("An interactive terminal is required."));
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    const encoding = input.readableEncoding;
    let value = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.off("data", data);
      input.off("end", cancel);
      input.off("error", cancel);
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
      process.off("SIGHUP", cancel);
      input.setRawMode(wasRaw);
      input.pause();
      if (encoding) input.setEncoding(encoding);
      output.write("\n");
      const result = value;
      value = "";
      if (error) reject(error);
      else resolve(result);
    };
    const cancel = () => finish(new Error("Recovery cancelled."));
    const data = (chunk: string) => {
      // Refuse multiline pasted data and control sequences; do not echo even errors.
      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];
        if (char === "\r" || char === "\n") {
          if (chunk.slice(i).replace(/\r?\n|\r/g, "") !== "") return cancel();
          return finish();
        }
        if (char === "\u0003" || char === "\u0004" || char === "\u001b")
          return cancel();
        if (char === "\u007f" || char === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (/[\u0000-\u001f]/.test(char) || value.length >= 1024)
          return cancel();
        value += char;
      }
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.on("data", data);
    input.once("end", cancel);
    input.once("error", cancel);
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    process.once("SIGHUP", cancel);
    output.write(label);
    input.resume();
  });
}
