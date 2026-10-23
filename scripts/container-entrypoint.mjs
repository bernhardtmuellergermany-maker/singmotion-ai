// This file is installed root-owned outside /app. No application code is imported
// until supplementary groups and root UID/GID have been permanently dropped.
import fs from "node:fs";

const volume = "/app/.data";
const uid = 1000;
const gid = 1000;
if (process.env.DATA_DIR !== volume) {
  throw new Error("Container DATA_DIR must be /app/.data.");
}

function repair(fd, device) {
  const stat = fs.fstatSync(fd);
  if (stat.dev !== device || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error("Unexpected mount or special file in persistent storage.");
  }
  if (stat.isFile() && stat.nlink !== 1) {
    throw new Error("Hard-linked storage files require manual review.");
  }
  // FD-relative traversal plus O_NOFOLLOW prevents links redirecting root chown
  // outside the volume. Never rename, truncate, remove or recreate stored files.
  if (stat.isDirectory()) {
    const parent = `/proc/self/fd/${fd}`;
    for (const name of fs.readdirSync(parent)) {
      const child = fs.openSync(
        `${parent}/${name}`,
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          fs.constants.O_NONBLOCK,
      );
      try {
        repair(child, device);
      } finally {
        fs.closeSync(child);
      }
    }
  }
  if (stat.uid !== uid || stat.gid !== gid) fs.fchownSync(fd, uid, gid);
  const mode = stat.isDirectory() ? 0o700 : 0o600;
  if ((stat.mode & 0o7777) !== mode) fs.fchmodSync(fd, mode);
}

if (process.getuid() === 0) {
  // The image creates this directory; a missing/misconfigured mount is not
  // silently replaced with a new directory by the privileged initializer.
  const fd = fs.openSync(
    volume,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    repair(fd, fs.fstatSync(fd).dev);
  } finally {
    fs.closeSync(fd);
  }
  process.setgroups([]);
  process.setgid(gid);
  process.setuid(uid);
}
if (
  process.getuid() !== uid ||
  process.getgid() !== gid ||
  process.getgroups().some((group) => group !== gid)
) {
  throw new Error("Refusing to start application outside UID/GID 1000.");
}
process.umask(0o077);
console.log(
  "Volume initialization complete; starting application as UID/GID 1000.",
);
await import("/app/scripts/serve.mjs");
