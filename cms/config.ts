import { validTemplates } from "../lib/studio-content.ts";
import path from "node:path";
import sharp from "sharp";
import {
  buildConfig,
  type Access,
  type CollectionConfig,
  type CollectionAfterChangeHook,
  type GlobalConfig,
} from "payload";
import { postgresAdapter } from "@payloadcms/db-postgres";
import {
  cmsEnvironment,
  hasRole,
  contentRoles,
  safeLink,
  pageSlugs,
} from "./policy.ts";
cmsEnvironment();
const superAdmin: Access = ({ req }) => hasRole(req.user, ["super-admin"]);
const editor: Access = ({ req }) => hasRole(req.user, contentRoles);
const support: Access = ({ req }) =>
  hasRole(req.user, ["super-admin", "support"]);
const never: Access = () => false;
const audit: CollectionAfterChangeHook = async ({
  doc,
  req,
  collection,
  operation,
}) => {
  await req.payload.create({
    collection: "audit-events",
    overrideAccess: true,
    req,
    data: {
      actor: String(req.user?.id || "provisioning"),
      action: operation,
      resource: collection.slug,
      record: String(doc.id),
    },
  });
  return doc;
};
const text = (name: string, required = false) => ({
  name,
  type: "text" as const,
  required,
  maxLength: 500,
});
const link = {
  name: "url",
  type: "text" as const,
  required: true,
  validate: (v: unknown) =>
    safeLink(v) || "Use an internal path or HTTPS URL without credentials.",
};
const links = {
  name: "links",
  type: "array" as const,
  maxRows: 12,
  fields: [text("label", true), link],
};
const contentAccess = {
  create: editor,
  update: editor,
  delete: editor,
  readVersions: editor,
};
const collections: CollectionConfig[] = [
  {
    slug: "staff",
    admin: { useAsTitle: "email", group: "Administration" },
    auth: {
      tokenExpiration: 3600,
      maxLoginAttempts: 5,
      lockTime: 15 * 60 * 1000,
      useSessions: true,
      cookies: {
        secure: process.env.CMS_LOCAL_TEST !== "true",
        sameSite: "Strict",
      },
    },
    access: {
      admin: ({ req }) =>
        hasRole(req.user, ["super-admin", "editor", "support"]),
      create: superAdmin,
      read: ({ req }) =>
        hasRole(req.user, ["super-admin"])
          ? true
          : hasRole(req.user, ["editor", "support"])
            ? { id: { equals: req.user!.id } }
            : false,
      update: superAdmin,
      delete: never,
    },
    fields: [
      {
        name: "role",
        type: "select",
        required: true,
        defaultValue: "support",
        options: ["super-admin", "editor", "support"],
        access: {
          create: ({ req }) =>
            hasRole(req.user, ["super-admin"]) ||
            req.context.provisioning === true,
          update: ({ req }) => hasRole(req.user, ["super-admin"]),
        },
      },
    ],
    hooks: {
      beforeChange: [
        ({ data }) => {
          if (
            data.password &&
            (typeof data.password !== "string" || data.password.length < 20)
          )
            throw new Error(
              "Staff passwords must contain at least 20 characters.",
            );
          return data;
        },
      ],
      afterChange: [audit],
      afterLogin: [
        async ({ req, user }) => {
          await req.payload.create({
            collection: "audit-events",
            overrideAccess: true,
            req,
            data: {
              actor: String(user.id),
              action: "login",
              resource: "staff",
              record: String(user.id),
            },
          });
          return user;
        },
      ],
    },
    endpoints: [
      {
        path: "/first-register",
        method: "post",
        handler: async () =>
          Response.json(
            { error: "Provisioning is CLI-only." },
            { status: 403 },
          ),
      },
    ],
  },
  {
    slug: "pages",
    admin: {
      useAsTitle: "title",
      group: "Website",
      preview: (doc) => `/cms-preview/${doc.slug}`,
    },
    access: {
      ...contentAccess,
      read: ({ req }) =>
        hasRole(req.user, contentRoles)
          ? true
          : { _status: { equals: "published" } },
    },
    versions: { drafts: { autosave: true }, maxPerDoc: 30 },
    fields: [
      {
        name: "slug",
        type: "select",
        unique: true,
        required: true,
        options: pageSlugs,
      },
      text("title", true),
      { name: "description", type: "textarea", maxLength: 1000 },
      {
        name: "blocks",
        type: "blocks",
        maxRows: 40,
        blocks: [
          {
            slug: "hero",
            fields: [
              text("eyebrow"),
              text("heading", true),
              { name: "body", type: "textarea", maxLength: 5000 },
              text("buttonLabel"),
              {
                ...link,
                required: false,
                validate: (v: unknown) =>
                  !v || safeLink(v) || "Use an internal path or HTTPS URL.",
              },
            ],
          },
          {
            slug: "section",
            fields: [
              text("heading", true),
              {
                name: "body",
                type: "textarea",
                required: true,
                maxLength: 10000,
              },
            ],
          },
          {
            slug: "cards",
            fields: [
              text("heading"),
              {
                name: "items",
                type: "array",
                maxRows: 12,
                fields: [
                  text("heading", true),
                  { name: "body", type: "textarea", maxLength: 3000 },
                ],
              },
            ],
          },
          {
            slug: "image",
            labels: {
              singular: "Image / homepage hero artwork",
              plural: "Images",
            },
            fields: [
              {
                name: "image",
                type: "upload",
                relationTo: "cms-assets",
                admin: {
                  description:
                    "On Home, place this Image block immediately after Hero (or its secondary CTA) to replace hero artwork. Public marketing assets only; never upload customer media.",
                },
                required: true,
              },
              text("caption"),
            ],
          },
          {
            slug: "cta",
            fields: [text("heading", true), text("buttonLabel", true), link],
          },
        ],
      },
    ],
    hooks: { afterChange: [audit] },
  },
  {
    slug: "cms-assets",
    admin: {
      group: "Website",
      description:
        "Public website images only. Never upload customer or BytePlus media here.",
    },
    access: { ...contentAccess, read: () => true },
    upload: {
      staticDir: path.resolve(process.env.DATA_DIR || ".data", "cms-public"),
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      imageSizes: [{ name: "card", width: 1200 }],
      formatOptions: { format: "webp" },
      filesRequiredOnCreate: true,
    },
    fields: [text("alt", true)],
    hooks: {
      beforeOperation: [
        async ({ req, operation }) => {
          if ((operation === "create" || operation === "update") && req.file) {
            if (req.file.size > 5 * 1024 * 1024)
              throw new Error("CMS images must be at most 5 MiB.");
            const info = await sharp(req.file.data, {
              limitInputPixels: 20000000,
            }).metadata();
            if (
              !["jpeg", "png", "webp"].includes(info.format || "") ||
              !info.width ||
              !info.height ||
              (info.pages && info.pages > 1)
            )
              throw new Error(
                "Only single-frame JPEG, PNG and WebP images are accepted.",
              );
          }
        },
      ],
      afterChange: [audit],
    },
  },
  {
    slug: "support-cases",
    admin: {
      group: "Operations",
      description:
        "Manual reports and refund requests. Status changes do not issue refunds, suspend customers or run generations.",
    },
    access: {
      create: support,
      read: support,
      update: support,
      delete: superAdmin,
    },
    fields: [
      {
        name: "kind",
        type: "select",
        options: ["moderation", "user-report", "refund-request"],
        required: true,
      },
      text("subject", true),
      { name: "notes", type: "textarea", maxLength: 5000 },
      {
        name: "status",
        type: "select",
        options: ["open", "investigating", "resolved"],
        defaultValue: "open",
      },
    ],
    hooks: { afterChange: [audit] },
  },
  {
    slug: "audit-events",
    admin: {
      group: "Administration",
      description:
        "Append-only application audit metadata; no credentials, URLs, content or private media.",
    },
    access: { read: superAdmin, create: never, update: never, delete: never },
    fields: [
      text("actor", true),
      text("action", true),
      text("resource", true),
      text("record", true),
    ],
  },
];
const globals: GlobalConfig[] = [
  {
    slug: "studio-settings",
    admin: {
      group: "Operations",
      description:
        "Studio copy and optional prompt suggestions only. Authorization, costs and provider policy cannot be changed here.",
    },
    access: { read: () => true, update: editor },
    fields: [
      { name: "intro", type: "text", maxLength: 300 },
      ...["performanceTemplates", "cameraTemplates"].map((name) => ({
        name,
        type: "json" as const,
        admin: {
          description:
            'Optional array of {"label":"Name","prompt":"English suggestion"}; up to 12 entries.',
        },
        validate: (v: unknown) =>
          v == null ||
          validTemplates(v) ||
          "Use up to 12 label/prompt objects, labels ≤60 and prompts ≤300 characters.",
      })),
    ],
  },
  {
    slug: "site-navigation",
    admin: { group: "Website" },
    access: { read: () => true, update: editor, readVersions: editor },
    versions: { max: 30 },
    fields: [
      { name: "header", type: "group", fields: [links] },
      { name: "footer", type: "group", fields: [links] },
      text("copyright"),
    ],
  },
  {
    slug: "notification-templates",
    admin: {
      group: "Operations",
      description:
        "Draft copy only. No email delivery or automated notifications are connected.",
    },
    access: { read: superAdmin, update: superAdmin },
    fields: [
      {
        name: "templates",
        type: "array",
        fields: [
          text("name", true),
          text("subject", true),
          { name: "body", type: "textarea", maxLength: 10000 },
        ],
      },
    ],
  },
];
for (const collection of collections) {
  if (collection.slug !== "audit-events") {
    collection.hooks ||= {};
    collection.hooks.afterDelete = [
      async ({ doc, req }) => {
        await req.payload.create({
          collection: "audit-events",
          overrideAccess: true,
          req,
          data: {
            actor: String(req.user?.id || "operator"),
            action: "delete",
            resource: collection.slug,
            record: String(doc.id),
          },
        });
      },
    ];
  }
}
for (const global of globals)
  global.hooks = {
    afterChange: [
      async ({ doc, req }) => {
        await req.payload.create({
          collection: "audit-events",
          overrideAccess: true,
          req,
          data: {
            actor: String(req.user?.id || "operator"),
            action: "update",
            resource: global.slug,
            record: global.slug,
          },
        });
        return doc;
      },
    ],
  };
export default buildConfig({
  email: () => ({
    name: "disabled",
    defaultFromAddress: "disabled@invalid.example",
    defaultFromName: "Disabled",
    sendEmail: async () => {
      throw new Error("CMS email delivery is not configured.");
    },
  }),
  secret:
    process.env.PAYLOAD_SECRET ||
    "disabled-build-only-not-an-authentication-secret",
  serverURL: process.env.CMS_ORIGIN || "http://localhost:3000",
  routes: { admin: "/admin", api: "/api/cms" },
  admin: {
    user: "staff",
    importMap: { baseDir: path.resolve(".") },
    components: {
      beforeDashboard: ["/components/cms/operations.tsx#Operations"],
    },
  },
  collections,
  globals,
  db: postgresAdapter({
    pool: {
      connectionString:
        process.env.CMS_DATABASE_URL ||
        "postgres://disabled:disabled@127.0.0.1:1/disabled",
    },
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve("cms/migrations"),
  }),
  sharp,
  csrf: [process.env.CMS_ORIGIN || "http://localhost:3000"],
  cors: [],
  upload: { limits: { fileSize: 5 * 1024 * 1024 } },
  typescript: { outputFile: path.resolve("cms/payload-types.ts") },
  graphQL: { disable: true },
});
