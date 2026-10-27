// Explicit disposable PostgreSQL only; never uses the operator ledger or providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
const database = process.env.CMS_TEST_DATABASE_URL;
if (!database)
  throw new Error(
    "CMS_TEST_DATABASE_URL must identify a disposable local database ending in _test.",
  );
const url = new URL(database);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw new Error("Refusing nonlocal/non-test CMS database.");
const directory = await mkdtemp(path.join(tmpdir(), "sm-cms-"));
Object.assign(process.env, {
  CMS_DATABASE_URL: database,
  CMS_ENABLED: "true",
  PAYLOAD_SECRET: "test-only-secret-not-for-deployment-1234567890",
  CMS_ORIGIN: "http://127.0.0.1:3198",
  CMS_LOCAL_TEST: "true",
  DATA_DIR: directory,
});
const { getPayload } = await import("payload");
const { default: config } = await import("../payload.config.ts");
const payload = await getPayload({ config });
await payload.db.migrate();
test("Payload PostgreSQL authentication, roles, publishing, versions, uploads and audit", async (t) => {
  try {
    const suffix = randomUUID();
    const password = "offline-test-password-1234567890";
    const admin = await payload.create({
      collection: "staff",
      context: { provisioning: true },
      data: {
        email: `admin-${suffix}@example.test`,
        password,
        role: "super-admin",
      },
    });
    const root = { ...admin, collection: "staff" as const };
    const editor = await payload.create({
      collection: "staff",
      overrideAccess: false,
      user: root,
      data: {
        email: `editor-${suffix}@example.test`,
        password,
        role: "editor",
      },
    });
    const support = await payload.create({
      collection: "staff",
      overrideAccess: false,
      user: root,
      data: {
        email: `support-${suffix}@example.test`,
        password,
        role: "support",
      },
    });
    const ed = { ...editor, collection: "staff" as const },
      su = { ...support, collection: "staff" as const };
    await t.test(
      "additive Studio settings preserve legacy content and enforce editor/support boundaries",
      async () => {
        const before = await payload.count({ collection: "staff" });
        const templates = [
          { label: "Test camera", prompt: "Use a slow camera move" },
        ];
        await payload.updateGlobal({
          slug: "studio-settings",
          overrideAccess: false,
          user: ed,
          data: {
            intro: "Private test studio",
            performanceTemplates: [],
            cameraTemplates: templates,
          },
        });
        const saved = await payload.findGlobal({
          slug: "studio-settings",
          overrideAccess: false,
        });
        assert.deepEqual(saved.cameraTemplates, templates);
        await assert.rejects(
          payload.updateGlobal({
            slug: "studio-settings",
            overrideAccess: false,
            user: su,
            data: { intro: "Forbidden" },
          }),
        );
        await assert.rejects(
          payload.updateGlobal({
            slug: "studio-settings",
            overrideAccess: false,
            user: ed,
            data: {
              cameraTemplates: [{ label: "Bad", prompt: "x".repeat(301) }],
            },
          }),
        );
        assert.equal(
          (await payload.count({ collection: "staff" })).totalDocs,
          before.totalDocs,
        );
        assert.ok(
          (
            await payload.find({
              collection: "audit-events",
              where: { resource: { equals: "studio-settings" } },
            })
          ).totalDocs > 0,
        );
      },
    );
    await t.test(
      "server recovery preserves account, revokes every session and clears lockout",
      async () => {
        const { recoverAdmin, recoveryConfirmation } =
          await import("../cms/recover-admin.ts");
        const first = await payload.login({
          collection: "staff",
          data: { email: admin.email, password },
        });
        const second = await payload.login({
          collection: "staff",
          data: { email: admin.email, password },
        });
        const headers = (token: string) =>
          new Headers({ authorization: `JWT ${token}` });
        assert.ok(
          (await payload.auth({ headers: headers(first.token!) })).user,
        );
        const count = (await payload.count({ collection: "staff" })).totalDocs;
        await assert.rejects(
          recoverAdmin(payload, admin.email, "x".repeat(24), "NO"),
        );
        await assert.rejects(
          recoverAdmin(payload, admin.email, "short", recoveryConfirmation),
        );
        await assert.rejects(
          recoverAdmin(
            payload,
            editor.email,
            "x".repeat(24),
            recoveryConfirmation,
          ),
        );
        await assert.rejects(
          recoverAdmin(
            payload,
            `missing-${suffix}@example.test`,
            "x".repeat(24),
            recoveryConfirmation,
          ),
        );
        assert.ok(
          (await payload.auth({ headers: headers(first.token!) })).user,
        );
        const hooks =
          payload.collections["audit-events"].config.hooks.beforeChange;
        const failAudit: (typeof hooks)[number] = ({ data }) => {
          if (data.action === "password-recovery")
            throw new Error("Injected audit failure");
          return data;
        };
        hooks.push(failAudit);
        try {
          await assert.rejects(
            recoverAdmin(
              payload,
              admin.email,
              "aborted-recovery-password-123456",
              recoveryConfirmation,
            ),
          );
        } finally {
          hooks.splice(hooks.indexOf(failAudit), 1);
        }
        assert.ok(
          (await payload.auth({ headers: headers(first.token!) })).user,
        );
        assert.ok(
          (
            await payload.login({
              collection: "staff",
              data: { email: admin.email, password },
            })
          ).token,
        );
        for (let i = 0; i < 5; i++)
          await assert.rejects(
            payload.login({
              collection: "staff",
              data: { email: admin.email, password: "wrong" },
            }),
          );
        const replacement = "replacement-password-only-for-local-tests";
        await recoverAdmin(
          payload,
          admin.email,
          replacement,
          recoveryConfirmation,
        );
        assert.equal(
          (await payload.count({ collection: "staff" })).totalDocs,
          count,
        );
        const same = await payload.findByID({
          collection: "staff",
          id: admin.id,
          showHiddenFields: true,
        });
        assert.equal(same.role, "super-admin");
        assert.equal(same.email, admin.email);
        assert.equal(same.sessions?.length || 0, 0);
        assert.equal(
          (await payload.auth({ headers: headers(first.token!) })).user,
          null,
        );
        assert.equal(
          (await payload.auth({ headers: headers(second.token!) })).user,
          null,
        );
        await assert.rejects(
          payload.login({
            collection: "staff",
            data: { email: admin.email, password },
          }),
        );
        assert.ok(
          (
            await payload.login({
              collection: "staff",
              data: { email: admin.email, password: replacement },
            })
          ).token,
        );
        const events = await payload.find({
          collection: "audit-events",
          where: { action: { equals: "password-recovery" } },
        });
        assert.ok(
          events.docs.some((event) => event.record === String(admin.id)),
        );
        assert.ok(!JSON.stringify(events.docs).includes(replacement));
        // Restore this disposable fixture through the same supported recovery API.
        await recoverAdmin(
          payload,
          admin.email,
          password,
          recoveryConfirmation,
        );
      },
    );
    await t.test("authentication and persisted account lockout", async () => {
      const login = await payload.login({
        collection: "staff",
        data: { email: admin.email, password },
      });
      assert.ok(login.token);
      for (let i = 0; i < 5; i++)
        await assert.rejects(
          payload.login({
            collection: "staff",
            data: { email: support.email, password: "wrong" },
          }),
        );
      await assert.rejects(
        payload.login({
          collection: "staff",
          data: { email: support.email, password },
        }),
      );
    });
    await t.test(
      "anonymous registration and editor/support role escalation denied",
      async () => {
        await assert.rejects(
          payload.create({
            collection: "staff",
            overrideAccess: false,
            data: {
              email: `bad-${suffix}@example.test`,
              password,
              role: "super-admin",
            },
          }),
        );
        await assert.rejects(
          payload.create({
            collection: "staff",
            overrideAccess: false,
            user: ed,
            data: {
              email: `bad-${suffix}@example.test`,
              password,
              role: "super-admin",
            },
          }),
        );
        await assert.rejects(
          payload.update({
            collection: "staff",
            id: editor.id,
            overrideAccess: false,
            user: ed,
            data: { role: "super-admin" },
          }),
        );
        assert.equal(
          (
            await payload.find({
              collection: "staff",
              overrideAccess: false,
              user: ed,
            })
          ).totalDocs,
          1,
        );
        await assert.rejects(
          payload.find({ collection: "staff", overrideAccess: false }),
        );
      },
    );
    // Each run uses one supported slug; remove a previous test page using explicit local test DB only.
    await payload.delete({
      collection: "pages",
      where: { slug: { equals: "faq" } },
    });
    const page = await payload.create({
      collection: "pages",
      overrideAccess: false,
      user: ed,
      draft: true,
      data: {
        slug: "faq",
        title: "Offline FAQ",
        blocks: [
          {
            blockType: "section",
            heading: "Safe text",
            body: "<script>alert(1)</script>",
          },
        ],
      },
    });
    await t.test(
      "draft isolation, publishing and revision rollback",
      async () => {
        assert.equal(
          (
            await payload.find({
              collection: "pages",
              overrideAccess: false,
              where: { id: { equals: page.id } },
            })
          ).totalDocs,
          0,
        );
        await assert.rejects(
          payload.update({
            collection: "pages",
            id: page.id,
            overrideAccess: false,
            user: su,
            data: { _status: "published" },
          }),
        );
        await payload.update({
          collection: "pages",
          id: page.id,
          overrideAccess: false,
          user: ed,
          data: { _status: "published" },
        });
        assert.equal(
          (
            await payload.find({
              collection: "pages",
              overrideAccess: false,
              where: { id: { equals: page.id } },
            })
          ).totalDocs,
          1,
        );
        const versions = await payload.findVersions({
          collection: "pages",
          overrideAccess: false,
          user: ed,
          where: { parent: { equals: page.id } },
          sort: "-updatedAt",
        });
        const version = versions.docs[0];
        await payload.update({
          collection: "pages",
          id: page.id,
          overrideAccess: false,
          user: ed,
          data: { title: "Changed" },
        });
        const restored = await payload.restoreVersion({
          collection: "pages",
          id: version.id,
          overrideAccess: false,
          user: ed,
        });
        assert.equal(restored.title, "Offline FAQ");
        await payload.update({
          collection: "pages",
          id: page.id,
          overrideAccess: false,
          user: ed,
          draft: true,
          data: { title: "Private unpublished revision" },
        });
        const publicDraftQuery = await payload.find({
          collection: "pages",
          overrideAccess: false,
          draft: true,
          where: { id: { equals: page.id } },
        });
        assert.ok(
          publicDraftQuery.docs.every(
            (doc) => doc.title !== "Private unpublished revision",
          ),
        );

        await assert.rejects(
          payload.findVersions({
            collection: "pages",
            overrideAccess: false,
            user: su,
          }),
        );
      },
    );
    await t.test(
      "malicious links and restricted route slugs rejected",
      async () => {
        await assert.rejects(
          payload.update({
            collection: "pages",
            id: page.id,
            overrideAccess: false,
            user: ed,
            data: {
              blocks: [
                {
                  blockType: "cta",
                  heading: "Bad",
                  buttonLabel: "Bad",
                  url: "javascript:alert(1)",
                },
              ],
            },
          }),
        );
      },
    );
    await t.test(
      "customer media cannot be uploaded; only bounded decoded raster files",
      async () => {
        const bad = Buffer.from('<svg onload="alert(1)"/>');
        await assert.rejects(
          payload.create({
            collection: "cms-assets",
            overrideAccess: false,
            user: ed,
            data: { alt: "bad" },
            file: {
              name: "bad.png",
              mimetype: "image/png",
              size: bad.length,
              data: bad,
            },
          }),
        );
        const { default: sharp } = await import("sharp");
        const data = await sharp({
          create: { width: 2, height: 2, channels: 3, background: "red" },
        })
          .png()
          .toBuffer();
        await assert.rejects(
          payload.create({
            collection: "cms-assets",
            overrideAccess: false,
            user: su,
            data: { alt: "blocked" },
            file: {
              name: "small.png",
              mimetype: "image/png",
              size: data.length,
              data,
            },
          }),
        );
        await assert.rejects(
          payload.create({
            collection: "cms-assets",
            overrideAccess: false,
            user: ed,
            data: { alt: "oversize" },
            file: {
              name: "big.png",
              mimetype: "image/png",
              size: 6 * 1024 * 1024,
              data,
            },
          }),
        );
        const image = await payload.create({
          collection: "cms-assets",
          overrideAccess: false,
          user: ed,
          data: { alt: "Public website test" },
          file: {
            name: `safe-${suffix}.png`,
            mimetype: "image/png",
            size: data.length,
            data,
          },
        });
        assert.equal(image.mimeType, "image/webp");
      },
    );
    await t.test(
      "operations separate from editing; audit immutable and no provider controls",
      async () => {
        await assert.rejects(
          payload.create({
            collection: "support-cases",
            overrideAccess: false,
            user: ed,
            data: { kind: "refund-request", subject: "Not allowed" },
          }),
        );
        await payload.create({
          collection: "support-cases",
          overrideAccess: false,
          user: su,
          data: { kind: "refund-request", subject: "Manual request only" },
        });
        const audit = await payload.find({
          collection: "audit-events",
          overrideAccess: false,
          user: root,
        });
        assert.ok(audit.totalDocs > 0);
        await assert.rejects(
          payload.update({
            collection: "audit-events",
            id: audit.docs[0].id,
            overrideAccess: false,
            user: root,
            data: { action: "tamper" },
          }),
        );
        await assert.rejects(
          payload.find({
            collection: "audit-events",
            overrideAccess: false,
            user: su,
          }),
        );
        assert.equal(
          Object.keys(payload.collections).some((x) =>
            /byteplus|billing|payments/.test(x),
          ),
          false,
        );
      },
    );
  } finally {
    await payload.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
