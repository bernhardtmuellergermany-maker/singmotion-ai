import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import type { TLSSocket } from "node:tls";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["168.63.129.16", 32],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(address, prefix, "ipv6");

/** Conservative global-unicast policy; mapped, NAT64 and transition IPv6 denied. */
export function isPublicOutputAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  return (
    family === 6 &&
    !address.includes("%") &&
    globalV6.check(address, "ipv6") &&
    !denied.check(address, "ipv6")
  );
}

export type OutputTransport = (
  url: URL,
  signal: AbortSignal,
) => Promise<Response>;

/** Dependencies are injectable only in trusted server code, never through env/URLs. */
export function createOutputTransport(
  resolve: (
    host: string,
  ) => Promise<readonly { address: string; family: number }[]> = (host) =>
    lookup(host, { all: true, verbatim: true }),
  send: typeof request = request,
): OutputTransport {
  return async (url, signal) => {
    // URL/allowlist validation belongs to downloadValidatedOutput before this call.
    // Also refuse alternate schemes, credentials and literal hosts at this layer.
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      isIP(url.hostname) ||
      url.hostname.includes(":")
    )
      throw new Error("Invalid output transport destination.");
    let addresses;
    try {
      signal.throwIfAborted();
      addresses = await new Promise<Awaited<ReturnType<typeof resolve>>>(
        (resolveResult, reject) => {
          const abort = () => reject(new Error("aborted"));
          signal.addEventListener("abort", abort, { once: true });
          resolve(url.hostname)
            .then(resolveResult, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        },
      );
      signal.throwIfAborted();
    } catch {
      throw new Error("Provider output DNS resolution failed or timed out.");
    }
    // Reject mixed public/private answers rather than selecting a convenient one.
    if (
      !addresses.length ||
      addresses.some(
        ({ address, family }) =>
          isIP(address) !== family || !isPublicOutputAddress(address),
      )
    )
      throw new Error("Provider output DNS destination is not public.");
    const pinned = addresses[0];
    return new Promise<Response>((resolveResult, reject) => {
      const fail = () =>
        reject(new Error("Provider output connection failed or timed out."));
      // Literal socket destination: no second DNS lookup, proxy, pool reuse or retry.
      // Original hostname is retained for SNI, certificate verification and Host.
      let req: ReturnType<typeof request>;
      try {
        req = send(
          {
            protocol: "https:",
            hostname: pinned.address,
            family: pinned.family,
            port: 443,
            servername: url.hostname,
            rejectUnauthorized: true,
            method: "GET",
            path: url.pathname + url.search,
            agent: false,
            signal,
            maxHeaderSize: 16384,
            headers: { Host: url.hostname, "Accept-Encoding": "identity" },
          },
          (res) => {
            const socket = res.socket as TLSSocket;
            // Require the peer to be exactly the pinned public IP (canonical IPv6
            // comparison through BlockList), and TLS authentication to have succeeded.
            const peer = new BlockList();
            peer.addAddress(
              pinned.address,
              pinned.family === 4 ? "ipv4" : "ipv6",
            );
            if (
              !socket.authorized ||
              !socket.remoteAddress ||
              !isPublicOutputAddress(socket.remoteAddress) ||
              !peer.check(
                socket.remoteAddress,
                pinned.family === 4 ? "ipv4" : "ipv6",
              )
            ) {
              res.destroy();
              req.destroy();
              fail();
              return;
            }
            if (res.statusCode !== 200) {
              res.destroy();
              req.destroy();
              reject(
                new Error(
                  "Provider output HTTP status rejected; redirects are forbidden.",
                ),
              );
              return;
            }
            const headers = new Headers();
            for (const name of ["content-length", "content-encoding"]) {
              const value = res.headers[name];
              if (typeof value === "string") headers.set(name, value);
            }
            const stream = Readable.from(
              (async function* () {
                try {
                  for await (const chunk of res) yield chunk;
                } catch {
                  throw new Error(
                    "Provider output transfer failed or timed out.",
                  );
                } finally {
                  res.destroy();
                  req.destroy();
                }
              })(),
            );
            stream.once("close", () => {
              res.destroy();
              req.destroy();
            });
            resolveResult(
              new Response(
                Readable.toWeb(stream) as ReadableStream<Uint8Array>,
                {
                  status: 200,
                  headers,
                },
              ),
            );
          },
        );
      } catch {
        fail();
        return;
      }
      req.on("error", fail);
      req.end();
    });
  };
}

export const privateOutputTransport: OutputTransport = (url, signal) =>
  createOutputTransport()(url, signal);
