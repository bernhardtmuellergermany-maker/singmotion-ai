# STRATO HiDrive as an independent encrypted SingMotion disaster-recovery target

2026-11-16 · Operator setup · Backup release gate #230

**Status: SUPPORTED IN THE OFFSITE TOOLKIT, NOT YET CONNECTED OR COPIED.**
The owner already uses STRATO for the singmotion.ai domain. A STRATO
domain-only contract does **not** provide backup storage or SFTP space.
See: https://www.strato.de/faq/hosting/so-verbinden-sie-sich-mit-dem-strato-sftp-server/

## Recommendation

Use a *separately provisioned private STRATO HiDrive* contract as
the independent archive. The official Rclone \`hidrive\` backend uses
HiDrive OAuth (instead of requiring HiDrive's optional SFTP/WebDAV
Protokoll-Paket) and integrates with Rclone client-side \`crypt\`.
Provider docs: https://rclone.org/hidrive/ and https://rclone.org/crypt/

Do NOT upload archives to any web/public/domain document root or
\`public\` folder. Use a private account-owned folder with private
permissions and multi-factor protection for the account.

No site/DNS/SSL changes are involved. Railway and Cloudflare keep
hosting the live service and private MP4 outputs.

## One-time operator steps

1. Visit the STRATO customer login and check whether a **HiDrive cloud
   storage** product is already active. The domain by itself is not enough.
   Select a capacity with headroom for all three backup datasets and
   historical versions. Confirm the recovery retention and user access.
2. Set up an isolated operator/recovery host, not the Production web app,
   with a current \`rclone\` and Node 24. Protect the host with its own
   credentials, restricted network and a proper secrets manager.
3. Run \`rclone config\` locally. Configure:
   - \`r2_source\`: **read-only** Cloudflare R2 S3 backend;
   - \`strato_hidrive\`: type \`hidrive\`, log in and authorize using
     STRATO's own OAuth flow. Keep its entire token private; don't paste
     it into chat, GitHub or a ticket. Default API endpoint must be
     https://api.hidrive.strato.com/2.1;
   - \`encrypted_offsite\`: type \`crypt\`, remote
     \`strato_hidrive:SingMotion-DR\`, filename encryption \`standard\`,
     directory encryption, and strong distinct randomly generated crypt
     password(s). The configuration contains sensitive tokens and
     recoverable keys and MUST be owner-only and separately vaulted.
4. Enforce POSIX \`0600\` on the Rclone configuration file. Secure a
   **separate recovery copy** of the crypt configuration/passphrase and
   verify that the recovery operator can actually decrypt a synthetic
   test object using an isolated machine.
5. The backup copy command is manually run from a trusted operator host
   only when the storage capacity, transfer costs, privacy, availability
   and operator permission have been reviewed. It **never** runs in
   Railway Production on app startup.
6. Example environment *variable names* (not real values):
   \`RCLONE_CONFIG\` = local private config file;
   \`RCLONE_R2_SOURCE\` = \`r2_source:ACTUAL_PRIVATE_MEDIA_BUCKET\`;
   \`RCLONE_OFFSITE_CRYPT\` = \`encrypted_offsite\`;
   \`OFFSITE_COPY_COST_AND_PRIVACY_APPROVED\` = \`YES\`.

Run \`npm run backup:r2-offsite\` on the isolated host. The command
copies into a unique backup prefix without deleting any source or
backup files and confirms full-content parity with \`rclone check
--download\` as well as object count/bytes.

For real SQLite and PostgreSQL use their existing encrypted export
scripts and copy **ciphertext only** into separate HiDrive private
folders under the crypt remote. Retrieve ciphertext independently
and restore in an isolated environment, never onto the running
Railway production database or volume.

## Storage/retention/availability limitations

STRATO HiDrive offers independent provider storage, but backups are
not proven immutable by this code. Operator must confirm whether
version retention, recovery points, non-deletable records, MFA, and
accidental-deletion protection meet the project's RPO/RTO and
privacy needs. An immutable-write Rclone mode prevents overwriting
a given copy; it does not stop an administrator deleting the entire
HiDrive archive. Keep historical named recovery snapshots and
separate restricted credentials. No automatic schedules are enabled
by this PR.

The official Rclone HiDrive OAuth refresh token requires operational
care: if the remote is unused for 60 days, re-authorization may be
necessary. Monitor backup successes/failures rather than assuming
that a configured login will always work.
https://rclone.org/hidrive/

## Release acceptance remains open

- [ ] Confirm which STRATO account product includes HiDrive, with
      usable quota and private folder.
- [ ] Configure, vault and validate Rclone HiDrive OAuth and crypt keys
      on the authorized host, not in GitHub/chat.
- [ ] Real read-only private Cloudflare R2 inventory and complete
      client-side encrypted copy; verify all objects/bytes and sample
      isolated playback/range requests.
- [ ] Real SQLite WAL-consistent encrypted archive, offsite transfer
      and isolated triple-DB ledger restore.
- [ ] Real PostgreSQL encrypted dump, offsite transfer, restore into
      independent database and CMS count/migration validation.
- [ ] Recovery key custody, retention and access permission tests,
      independent RPO/RTO measurements and operator signoff.

Railway Pro manual volume snapshots (SQLite 2026-11-16 12:59,
Postgres 2026-11-16 12:58) and schedules are already confirmed via
operator screenshots. Do not alter the Stripe/BytePlus/customer
workflows or public-release flags. Neither external storage nor
real independent restore was executed by this PR.
