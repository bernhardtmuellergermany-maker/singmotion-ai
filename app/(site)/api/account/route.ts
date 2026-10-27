import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { CommerceStore } from "@/lib/commerce/store";
import {
  dataDir,
  limit,
  createCustomerMediaSession,
  revokeMediaSession,
} from "@/lib/db";
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
async function handler(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  if (process.env.CUSTOMER_ACCOUNTS_ENABLED !== "true")
    return json(
      {
        enabled: false,
        error:
          "Customer accounts are not activated. Operator login remains available.",
      },
      503,
    );
  const expectedOrigin = applicationOrigin(req.url, req.headers.get("host"));
  if (
    req.method !== "GET" &&
    (!expectedOrigin || req.headers.get("origin") !== expectedOrigin)
  )
    return json({ error: "Request origin is not allowed." }, 403);
  let store: CommerceStore | undefined;
  try {
    limit("customer-account:global", 60, 60000);
    store = new CommerceStore(path.join(dataDir, "commerce.sqlite"));
    const token = req.cookies.get("sm_customer")?.value || "";
    if (req.method === "GET") {
      const id = store.session(token);
      return id
        ? json({
            enabled: true,
            authenticated: true,
            balanceCents: store.balance(id),
            paymentsEnabled: false,
          })
        : json({ enabled: true, authenticated: false, paymentsEnabled: false });
    }
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "Request required." }, 400);
    const chunks: Uint8Array[] = [];
    let n = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      n += r.value.length;
      if (n > 4096) {
        await reader.cancel();
        return json({ error: "Request too large." }, 413);
      }
      chunks.push(r.value);
    }
    const b = JSON.parse(Buffer.concat(chunks).toString());
    if (b.action === "logout") {
      store.logout(token);
      revokeMediaSession(req.cookies.get("sm_session")?.value || "");
      const r = json({ ok: true });
      r.cookies.set("sm_session", "", {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 0,
      });
      r.cookies.set("sm_customer", "", {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 0,
      });
      return r;
    }
    if (
      typeof b.email !== "string" ||
      b.email.length > 254 ||
      typeof b.password !== "string" ||
      b.password.length > 256
    )
      return json({ error: "Valid email and password required." }, 400);
    if (b.action === "register") store.register(b.email, b.password);
    else if (b.action !== "login")
      return json({ error: "Unknown action." }, 400);
    const session = store.login(b.email, b.password),
      r = json({ ok: true });
    const media = createCustomerMediaSession(store.session(session)!);
    r.cookies.set("sm_session", media.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 86400,
    });
    r.cookies.set("sm_customer", session, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 86400,
    });
    return r;
  } catch {
    return json(
      {
        error:
          "Account request could not be completed. Check your credentials; new passwords need at least 20 characters. Try again later if rate limited.",
      },
      400,
    );
  } finally {
    store?.close();
  }
}
export const GET = handler;
export const POST = handler;
