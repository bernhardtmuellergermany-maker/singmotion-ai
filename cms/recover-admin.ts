import type { Payload } from "payload";
import type { PostgresAdapter } from "@payloadcms/db-postgres";
import { sql } from "@payloadcms/db-postgres";

export const recoveryConfirmation = "RECOVER SUPER ADMIN";
export function validateRecovery(password: string, confirmation: string) {
  if (confirmation !== recoveryConfirmation)
    throw new Error("Recovery confirmation required.");
  if (
    typeof password !== "string" ||
    password.length < 20 ||
    password.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(password)
  )
    throw new Error(
      "Password must contain 20–1024 characters without control characters.",
    );
}
export async function recoverAdmin(
  payload: Payload,
  email: string,
  password: string,
  confirmation: string,
) {
  validateRecovery(password, confirmation);
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email))
    throw new Error("A valid account email is required.");
  if (!payload.collections.staff.config.auth.useSessions)
    throw new Error("Session revocation support is required.");
  const transactionID = await payload.db.beginTransaction();
  if (!transactionID) throw new Error("A recovery transaction is required.");
  const req = { transactionID, context: {} };
  try {
    const found = await payload.find({
      collection: "staff",
      where: { email: { equals: email.trim().toLowerCase() } },
      limit: 2,
      depth: 0,
      overrideAccess: true,
      req,
    });
    if (found.docs.length !== 1)
      throw new Error("Existing super-admin account not found.");
    const id = found.docs[0].id;
    const transaction = (payload.db as unknown as PostgresAdapter).sessions[
      transactionID
    ];
    // Serialize role changes/recovery for this exact row. Password writes use Payload only.
    await transaction.db.execute(
      sql`SELECT id FROM staff WHERE id = ${id} FOR UPDATE`,
    );
    const current = await payload.findByID({
      collection: "staff",
      id,
      overrideAccess: true,
      req,
    });
    if (current.role !== "super-admin")
      throw new Error("Account is not a super-admin.");
    // No req.user/_sid: Payload 3.92's supported password update revokes ALL sessions.
    // Clear old reset credentials as well. Never pass a caller-controlled user or role.
    await payload.update({
      collection: "staff",
      id,
      overrideAccess: true,
      req,
      data: {
        password,
        resetPasswordToken: null,
        resetPasswordExpiration: null,
      },
    });
    await payload.unlock({
      collection: "staff",
      overrideAccess: true,
      req,
      // Payload generated auth types require this unused field; unlock uses email.
      data: { email: current.email, password: "" },
    });
    const updated = await payload.findByID({
      collection: "staff",
      id,
      overrideAccess: true,
      showHiddenFields: true,
      req,
    });
    if (updated.sessions?.length) throw new Error("Session revocation failed.");
    await payload.create({
      collection: "audit-events",
      overrideAccess: true,
      req,
      data: {
        actor: "server-operator",
        action: "password-recovery",
        resource: "staff",
        record: String(id),
      },
    });
    await payload.db.commitTransaction(transactionID);
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID);
    throw error;
  }
}
