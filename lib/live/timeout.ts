/** A timed-out submission is uncertain, never permission to send another one. */
export async function providerRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 60_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Provider request timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
