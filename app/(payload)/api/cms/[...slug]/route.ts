import { NextRequest } from "next/server";
import config from "@payload-config";
import {
  REST_GET,
  REST_POST,
  REST_PATCH,
  REST_DELETE,
  REST_PUT,
  REST_OPTIONS,
} from "@payloadcms/next/routes";
import { limit } from "@/lib/db";
import {
  cmsOriginFailure,
  cmsLoginDiagnostic,
  annotateCmsFailure,
} from "@/cms/request-security";
type Context = { params: Promise<{ slug?: string[] }> };
function protect(
  handler: (request: Request, args: Context) => Promise<Response>,
) {
  return async (request: Request, args: Context) => {
    if (process.env.CMS_ENABLED !== "true")
      return Response.json({ error: "CMS disabled." }, { status: 503 });
    const { slug = [] } = await args.params;
    if (
      slug.some((part) =>
        ["first-register", "forgot-password", "reset-password"].includes(part),
      )
    )
      return Response.json(
        { error: "Operation unavailable. Contact the administrator." },
        { status: 403 },
      );
    const originFailure = cmsOriginFailure(
      request.method,
      request.headers,
      process.env.CMS_ORIGIN,
    );
    if (originFailure)
      return annotateCmsFailure(
        Response.json(
          { error: "Invalid origin.", code: originFailure },
          { status: 403 },
        ),
        originFailure,
      );
    if (slug[0] === "staff" && slug[1] === "login") {
      try {
        limit("cms:login:global", 100, 15 * 60 * 1000);
      } catch {
        return annotateCmsFailure(
          Response.json(
            { error: "Try again later." },
            { status: 429, headers: { "Retry-After": "900" } },
          ),
          "CMS_RATE_LIMITED",
        );
      }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 6 * 1024 * 1024) {
          await reader.cancel();
          return Response.json(
            { error: "Request too large." },
            { status: 413 },
          );
        }
        chunks.push(part.value);
      }
      request = new NextRequest(request.url, {
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
        signal: request.signal,
      });
    }
    const response = await handler(request, args);
    if (slug[0] === "staff" && slug[1] === "login") {
      const code = cmsLoginDiagnostic(response.status);
      if (code) annotateCmsFailure(response, code);
    }
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  };
}
export const GET = protect(REST_GET(config));
export const POST = protect(REST_POST(config));
export const PATCH = protect(REST_PATCH(config));
export const DELETE = protect(REST_DELETE(config));
export const PUT = protect(REST_PUT(config));
export const OPTIONS = protect(REST_OPTIONS(config));
