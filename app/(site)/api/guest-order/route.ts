import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import { dataDir, limit } from "@/lib/db";
import { stagingDenial } from "@/lib/staging";
import { applicationOrigin } from "@/lib/request-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
export async function POST(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (process.env.CUSTOMER_ACCOUNTS_ENABLED !== "true")
    return json({ error: "Guest ordering is not activated." }, 503);
  const origin = applicationOrigin(req.url, req.headers.get("host"));
  if (!origin || req.headers.get("origin") !== origin)
    return json({ error: "Request origin is not allowed." }, 403);
  let store: CommerceStore | undefined;
  try {
    limit("guest-access:global", 30, 60000);
    const reader = req.body?.getReader();
    if (!reader) throw Error();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.length;
      if (bytes > 1024) {
        await reader.cancel();
        throw Error();
      }
      parts.push(r.value);
    }
    const body = JSON.parse(Buffer.concat(parts).toString());
    if (
      typeof body.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(body.id) ||
      typeof body.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.token)
    )
      throw Error();
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    store.ownedOrder(body.id, null, body.token);
    const response = json({ ok: true });
    response.cookies.set(`sm_guest_${body.id}`, body.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: `/orders/${body.id}`,
      maxAge: 86400,
    });
    return response;
  } catch {
    return json(
      {
        error:
          "Order access is invalid or expired. Email recovery is not configured yet.",
      },
      403,
    );
  } finally {
    store?.close();
  }
}
