import { reviewIndependentRecording } from "@/lib/live/recording-rejections";
import {
  offerStudioBudget,
  authorizeStudioBudget,
} from "@/lib/live/studio-budget-review";
import { FxReferenceError } from "@/lib/live/fx-reference";
import { createHash } from "node:crypto";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import { NextRequest } from "next/server";
import { getPayload } from "payload";
import payloadConfig from "@payload-config";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { stagingDenial } from "@/lib/staging";
import { hasRole } from "@/cms/policy";
import { studioStaff } from "@/cms/studio-access";
import { session, limit, dataDir, asset } from "@/lib/db";
import { openStudioStore } from "@/lib/live/studio";
import { studioRuntime, studioReadiness, loadRuntimeStudioPolicy } from "@/lib/live/studio-runtime";
import {
  StudioLiveError,
  studioDiagnostic,
  studioConfig,
  studioGate,
} from "@/lib/live/studio-policy";
import {
  requireRights,
  recordRights,
  termsVersion,
  hasRights,
} from "@/lib/rights";
import { parseStudioDraft } from "@/lib/studio-draft";
import { AppError } from "@/lib/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
async function handler(req: NextRequest) {
  const denied = stagingDenial(req.headers.get("authorization"));
  if (denied) return denied;
  let runtime: ReturnType<typeof studioRuntime> | undefined;
  try {
    if (process.env.CMS_ENABLED !== "true") {
      if (req.method !== "GET" || req.nextUrl.searchParams.has("id"))
        return json({ error: "CMS disabled." }, 503);
      return json({
        available: false,
        projects: [],
        blockers: ["Studio paid pilot is disabled."],
      });
    }
    const payload = await getPayload({ config: payloadConfig });
    const { user } = await payload.auth({ headers: req.headers });
    let verifiedOwner: string;
    try {
      verifiedOwner = studioStaff(user, req.method, req.headers, process.env);
    } catch (e) {
      if (
        req.method === "GET" &&
        !req.nextUrl.searchParams.has("id") &&
        e instanceof StudioLiveError &&
        e.code === "STAFF_AUTH_REQUIRED"
      )
        return json({
          available: false,
          projects: [],
          blockers: ["Paid Studio requires an approved operator account."],
        });
      throw e;
    }
    const auth = session(req.cookies.get("sm_session")?.value);
    if (!auth)
      throw new StudioLiveError(
        "SESSION_REQUIRED",
        "Open Studio to establish your private media session.",
        401,
      );
    const owner = auth.owner;
    if (owner !== verifiedOwner)
      throw new StudioLiveError(
        "OPERATOR_SESSION_MISMATCH",
        "Your private workspace does not match the signed-in Studio operator. Reopen Studio to refresh the operator session.",
        403,
      );
    limit(`${owner}:studio-live`, req.method === "POST" ? 30 : 180, 60000);
    const isSuperAdmin = hasRole(user, ["super-admin"]);
    runtime = studioRuntime(await openStudioStore(dataDir), dataDir, process.env, isSuperAdmin);
    const service = runtime.service;
    if (req.method === "GET") {
      const id = req.nextUrl.searchParams.get("id");
      if(!id && req.nextUrl.searchParams.get("trash")==="1")
        return json({items:service.listTrash(owner)});
      if(id && service.trashedAt(id,owner)!==null)
        throw new StudioLiveError("PROJECT_IN_TRASH","Project is in Recently deleted.",404);
      if (id && req.nextUrl.searchParams.has("video")) {
        const file = await service.output(id, owner),
          size = (await stat(file)).size;
        let start = 0,
          end = size - 1,
          status = 200;
        const range = req.headers.get("range");
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          start = Number(match?.[1]);
          end = match?.[2] ? Number(match[2]) : size - 1;
          if (
            !match ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            end >= size
          )
            return new Response(null, {
              status: 416,
              headers: { ...headers, "Content-Range": `bytes */${size}` },
            });
          status = 206;
        }
        return new Response(
          Readable.toWeb(
            createReadStream(file, { start, end }),
          ) as ReadableStream,
          {
            status,
            headers: {
              ...headers,
              "Content-Type": "video/mp4",
              "Accept-Ranges": "bytes",
              "Content-Length": String(end - start + 1),
              ...(status === 206
                ? { "Content-Range": `bytes ${start}-${end}/${size}` }
                : {}),
              "Content-Disposition": `${req.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename="singmotion.mp4"`,
            },
          },
        );
      }
      if (id && req.nextUrl.searchParams.get("copy") === "1") {
        // Reuse an owned project's original inputs for editing, never its
        // authorization, budget, task ID, provider job or finished video.
        const project=service.view(id,owner);
        const selection=project.selection;
        if(selection.owner!==owner)
          throw new StudioLiveError("PROJECT_OWNER_MISMATCH","Private project unavailable.",403);
        const song=asset(selection.songId,owner);
        const image=asset(selection.imageId,owner);
        if(song.kind!=="audio"||image.kind!=="image")
          throw new StudioLiveError("PROJECT_MEDIA_UNAVAILABLE","Original project media unavailable.",409);
        const publicAsset=(a:typeof song)=>({
          id:a.id,owner:a.owner,kind:a.kind,name:a.name,mime:a.mime,
          bytes:a.bytes,duration:a.duration,width:a.width,height:a.height,
          created:a.created,
        });
        return json({
          selection,
          song:publicAsset(song),
          image:publicAsset(image),
          artistName:project.artistName,
          projectName:project.projectName,
        });
      }
      if (id)
        return json(await service.withCurrentBudget(service.view(id, owner)));
      const blockers: string[] = [];
      try {
        studioGate(studioConfig());
        await loadRuntimeStudioPolicy(dataDir, process.env, isSuperAdmin);
        await studioReadiness(dataDir);
      } catch (e) {
        blockers.push(
          e instanceof StudioLiveError
            ? e.message
            : "Server policy unavailable.",
        );
      }
      const budget = null;
      return json({
        budget,
        superAdmin: isSuperAdmin,
        pilot: true,
        available: blockers.length === 0,
        projects: service.list(owner),
        blockers,
      });
    }
    const reader = req.body?.getReader();
    if (!reader)
      throw new StudioLiveError("BODY_REQUIRED", "Request required.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        bytes += p.value.length;
        if (bytes > 32768)
          throw new StudioLiveError(
            "REQUEST_TOO_LARGE",
            "Request too large.",
            413,
          );
        chunks.push(p.value);
      }
    } finally {
      await reader.cancel();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (
      [
        "budget-review",
        "budget-authorize",
        "fresh-test",
        "acknowledge-operator-risk",
      ].includes(body.action) &&
      !hasRole(user, ["super-admin"])
    )
      throw new StudioLiveError(
        "ADMIN_REQUIRED",
        "Historical administrative controls require Super Admin access.",
        403,
      );
    if (body.action === "budget-review")
      return json(
        await offerStudioBudget(
          service.store.db,
          String(user!.id),
          owner,
          service.config.maxTotalMicroUsd,
        ),
      );
    if (body.action === "budget-authorize")
      return json(
        authorizeStudioBudget(
          service.store.db,
          String(user!.id),
          owner,
          service.config.maxTotalMicroUsd,
          body.offerId,
          body.acknowledgment,
        ),
      );
    if (body.action === "tempo-recording-review") {
      requireRights(body.consent, body.termsVersion);
      return json(
        await reviewIndependentRecording(
          dataDir,
          service.store,
          parseStudioDraft(body.selection),
          owner,
          String(user!.id),
          body.evidence,
          body.confirmation,
        ),
      );
    }
    if (body.action === "rights-status") {
      const selection = parseStudioDraft(body.selection);
      if (selection.owner !== owner)
        throw new AppError("Draft ownership mismatch.", 403);
      asset(selection.songId, owner);
      asset(selection.imageId, owner);
      const content = createHash("sha256")
        .update(JSON.stringify(selection))
        .digest("hex");
      return json({
        confirmed: hasRights(
          service.store.db,
          String(user!.id),
          owner,
          content,
        ),
      });
    }
    if (body.action === "prepare") {
      requireRights(body.consent, body.termsVersion);
      const project = await service.prepare(
        body.selection,
        owner,
        body.artistName,
        body.consent,
        body.english,
        body.repeatOf,
        body.requestKey,
        body.projectName,
      );
      recordRights(
        service.store.db,
        String(user!.id),
        project.id,
        termsVersion(),
        {
          session: owner,
          content: createHash("sha256")
            .update(JSON.stringify(project.selection))
            .digest("hex"),
        },
      );
      return json(project);
    }
    if (body.action === "fresh-test")
      return json(await service.freshTest(owner, String(user!.id)));
    if (typeof body.id !== "string")
      throw new StudioLiveError(
        "PROJECT_REQUIRED",
        "Choose a saved Studio project.",
      );
    if (body.action === "submit") {
      if(service.trashedAt(body.id,owner)!==null)
        throw new StudioLiveError("PROJECT_IN_TRASH","Restore this project before continuing.",409);
      // The same wallet shown on /credits MUST be the wallet used for billing.
      // An overlapping customer session takes precedence over CMS staff identity
      // in the account menu; refuse to charge a different, hidden wallet.
      if(!isSuperAdmin)
        throw new StudioLiveError("CREDIT_IDENTITY_REQUIRED","A verified Super Admin wallet is required for private paid generation.",403);
      const commerce=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
      let creditSubject:string|null=null;
      try{
        const identity=await resolveCreditWalletIdentity(req,commerce);
        creditSubject=identity?.subject??null;
      }finally{commerce.close();}
      if(creditSubject!=="super-admin:"+String(user!.id))
        throw new StudioLiveError("CREDIT_ACCOUNT_MISMATCH",
         "Sign out of any customer account before using your Super Admin Credits. The account on /credits must match this Studio session.",403);
      requireRights(body.consent, body.termsVersion);
      const project = service.view(body.id, owner);
      recordRights(
        service.store.db,
        String(user!.id),
        body.id,
        termsVersion(),
        {
          session: owner,
          content: createHash("sha256")
            .update(JSON.stringify(project.selection))
            .digest("hex"),
        },
      );
      await payload.create({
        collection: "audit-events",
        overrideAccess: true,
        data: {
          actor: String(user!.id),
          action: "studio:explicit-paid-confirmation",
          resource: "private-studio-project",
          record: body.id,
        },
      });
      return json(
        await service.submit(
          body.id,
          owner,
          body.digest,
          body.ceilingMicroUsd,
          body.confirmation,
          creditSubject,
        ),
      );
    }
    if (body.action === "acknowledge-operator-risk") {
      service.acknowledgeOperatorRisk(
        body.id,
        owner,
        String(user!.id),
        body.confirmation,
      );
      return json(await service.freshTest(owner, String(user!.id)));
    }
    if (body.action === "acknowledge-private-risk")
      return json(
        service.acknowledgePrivateRisk(
          body.id,
          owner,
          String(user!.id),
          body.confirmation,
        ),
      );
    if (body.action === "delete")
      return json(await service.deleteProject(body.id, owner, body.confirmation));
    if (body.action === "restore")
      return json(service.restoreProject(body.id, owner, body.confirmation));
    if (body.action === "hide")
      return json(
        service.hide(body.id, owner, String(user!.id), body.confirmation),
      );
    if (body.action === "reconcile")
      return json(
        service.reconcile(body.id, owner, String(user!.id), body.evidence),
      );
    if (body.action === "poll") return json(await service.poll(body.id, owner));
    throw new StudioLiveError("ACTION_INVALID", "Unsupported Studio action.");
  } catch (e) {
    if (e instanceof FxReferenceError)
      return json({ error: e.message, code: "BUDGET_REVIEW_REQUIRED" }, 400);
    if (e instanceof StudioLiveError || e instanceof AppError)
      return json(
        {
          error: e.message,
          ...(e instanceof StudioLiveError ? { code: e.code } : {}),
        },
        e.status,
      );
    const safe = studioDiagnostic(e);
    console.warn("studio-live operation rejected", { code: safe.code });
    return json({ error: safe.message, code: safe.code }, safe.status);
  } finally {
    runtime?.close();
  }
}
export { handler as GET, handler as POST };
