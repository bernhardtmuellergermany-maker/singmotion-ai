// Operator-side short-lived test PKI. Never commit keys or include them in images.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
export async function createTestPKI(host, days=2) {
  if (!Number.isSafeInteger(days) || days<1 || days>7)
    throw Error("TEST_CERTIFICATE_LIFETIME_INVALID");
  if (!/^[a-z0-9-]+\.railway\.internal$/.test(host) && host !== "localhost")
    throw Error("PRIVATE_HOST_REQUIRED");
  const root = await mkdtemp(path.join(tmpdir(), "sm-network-pki-"));
  const run = (args) =>
    execFileSync("openssl", args, { cwd: root, stdio: "ignore" });
  try {
    for (const name of ["ca", "wrong-ca"])
      run([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        name + ".key",
        "-out",
        name + ".crt",
        "-days",
        String(days),
        "-subj",
        "/CN=singmotion-fixture-" + name,
      ]);
    const result = {
      BACKUP_TEST_CA_B64: (await readFile(path.join(root, "ca.crt"))).toString(
        "base64",
      ),
      BACKUP_TEST_WRONG_CA_B64: (
        await readFile(path.join(root, "wrong-ca.crt"))
      ).toString("base64"),
    };
    for (const role of ["server", "writer", "reader", "other"]) {
      run([
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        role + ".key",
        "-out",
        role + ".csr",
        "-subj",
        "/CN=singmotion-fixture-" + role,
      ]);
      await writeFile(
        path.join(root, role + ".ext"),
        role === "server"
          ? `subjectAltName=DNS:${host}\nextendedKeyUsage=serverAuth\n`
          : "extendedKeyUsage=clientAuth\n",
        { mode: 0o600 },
      );
      run([
        "x509",
        "-req",
        "-in",
        role + ".csr",
        "-CA",
        "ca.crt",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        role + ".crt",
        "-days",
        String(days),
        "-extfile",
        role + ".ext",
      ]);
      const cert = await readFile(path.join(root, role + ".crt"));
      result[`BACKUP_TEST_${role.toUpperCase()}_CERT_B64`] =
        cert.toString("base64");
      result[`BACKUP_TEST_${role.toUpperCase()}_KEY_B64`] = (
        await readFile(path.join(root, role + ".key"))
      ).toString("base64");
      result[`BACKUP_TEST_${role.toUpperCase()}_FP`] = new X509Certificate(
        cert,
      ).fingerprint256;
    }
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
