# SingMotion AI — privacy, private media and retention register (2026-11-16)

Status: **Technical implementation and disclosure audit; NOT a legal compliance certificate**.
Operator statement on 2026-11-16: **no external/customer data yet**. This is an **operator report**, not an independently verified zero-record SQL/R2 inventory; owner-operated LIVE tests have created real transaction, project and media records that still require privacy safeguards. No automatic media deletion or bucket lifecycle was activated by this review.

## 1. Actual data flow (as inspected in the currently deployed Staging/Production code)

| Data or recipient | Purpose and storage | Verified application safeguard | Retention/deletion status |
| --- | --- | --- | --- |
| Guest audio, image, draft | Railway SQLite/local private volume, optionally Cloudflare R2 `customer-sources/v1/` | Session/owner checks, owner-hashed object key, private server-side R2 credentials; checksum after copies | Session expiry is **not** the same as customer-account media deletion. Guest cleanup is separate and protects cloud mirrors and authenticated customer records |
| Registered account, email, verification state, login | Railway `commerce.sqlite`, provider-issued customer email | Signed-in account ownership, email verification before Credit top-ups, security-only cookies | No blanket automatic account-data expiry specified; manual verified GDPR request handling pending |
| Prepaid Credit wallet, Stripe references, refunds and disputes | Railway `commerce.sqlite`, Stripe payment system | Immutable owner-bound ledger, signed webhook, read-only integrity audit | Kept separately from project/trash deletion under applicable transaction/accounting/dispute retention; exact term requires operator tax/legal review |
| Original audio, artist portrait and approved video input | Private Railway volume and private Cloudflare R2 copies | Server-side user/owner checks; immutable/hashed inputs; provider gets signed object-specific GET URLs only when generation is authorised | Signed provider GET URLs last **13 hours**; expiry **does not delete** R2 source objects |
| BytePlus task input objects | Private R2 `byteplus-inputs/v1/` with owner hash and attempt manifest | No public ACL; manifest-bound exact keys; narrow deletion via `R2PrivateInputDelivery.cleanupExpired` after URL expiry + **1-hour grace** | Physical removal depends on successful, separately authorised cleanup; URL expiry alone gives **no** 13/14-hour deletion promise |
| Generated MP4, project title/prompt, task status | Owner-scoped private Studio, Railway private `live-output` / database; any R2 copies require separate owner-scoped manifest | Protected application download/Range routes, owner checks, task/payment evidence retained separately | User deletion places eligible project in **Recently deleted for 30 days**; scheduled permanent purge is currently **disabled** pending approved restoration/lifecycle checks |
| CMS content and staff | Railway PostgreSQL and application storage | CMS role checks, private admin | Business retention and backup lifecycle separate from project media |
| Backups | Railway volume snapshots, planned encrypted independent STRATO HiDrive | Snapshots currently exist on Railway; offsite tool staged | Railway docs: **daily 6d, weekly 27d, monthly 89d** if those schedules are selected; no independent HiDrive copy/restore has been confirmed |
| Email, network/security logs, hosting/CDN | Resend/configured mail provider, hosting providers | Server-side handlers; access controls vary by provider | Provider-side periods and subprocessors require contractual and account-side verification |

The application does not expose a public R2 bucket URL in its server-side media adapter. **The Cloudflare account's actual bucket public-access setting, object lifecycle rules, jurisdiction/region, versioning and policy are not independently established from repository code.** Do not claim an EU-only storage or a fixed deletion period until checking the Cloudflare dashboard.

## 2. Project deletion policy — what is currently real

- The user-initiated delete action soft-deletes eligible drafts and finished projects. The original owner may restore them for **30 full days**; another owner must be denied.
- Code path: `lib/project-trash.ts`, `lib/project-trash-cleanup.ts`, protected `/api/studio-live` and drafts route. Existing `tests/project-trash-retention.test.ts` exercises restoration, cross-owner denial, shared file preservation, R2-delete refusal and unknown in-flight provider attempts.
- The built-in hourly cleanup only runs if `PROJECT_TRASH_PURGE_ENABLED=true`. It processes at most eight expired projects per hour by default. In Production the switch is not enabled as of this review. **Do not turn it on blindly.** A deleted project can remain on physical storage beyond its 30-day user-visible recovery window until an authorised and successful purge occurs.
- Cleanup refuses to delete media referenced by paid orders, active projects, another user's records or uncertain provider tasks. It retains Stripe/Credit ledger and provider task evidence. These safeguards are intentional; deletion requests involving retained evidence need individual review.
- The customer-facing `/account/settings` currently offers a **manual email request** for account deletion. It is **not** an automatic data-erasure workflow; never tell customers that clicking the link deleted their account.
- Staging-only `/api/media-cleanup` supports an explicit owner-confirmed unused upload deletion with R2 object confirmation. This must not be described as active in Production.

## 3. Operator process for GDPR requests

1. Receive requests through `support@singmotion.ai` (check inbound delivery) and create a restricted-access case with timestamp and request type. **Do not attach private video, credentials, plaintext backup or payment-card numbers**.
2. Authenticate the claimant without leaking whether a third-party account exists; request only proportionate verification.
3. Review data held in account, project/draft, local media, owner-scoped R2 copies, generated MP4, Stripe transaction/credit entries, support and provider records. Categorise: erase, export, correct, restrict, or lawfully retain with documented reason.
4. For erasure, finish/cancel any in-flight work safely, honour provider and Stripe records where retention is required, run an authorised deletion with confirmation, and record any R2 or provider failure as an outstanding item rather than claiming success.
5. Track encrypted backups, expiry and old restored copies separately; do not promise immediate removal from scheduled backup generations without a verified, tested mechanism.
6. Reply without unnecessary data exposure, normally **within one month** under GDPR Article 12(3), subject to lawful extensions and identity/exception handling. Record case resolution and recipient notifications where applicable.

This SOP describes a **to-be-operated human workflow**, not evidence that every step was successfully executed in a real data subject request.

## 4. Compliance and vendor acceptance register

| Item | What must be obtained or independently verified | Status as of 2026-11-16 |
| --- | --- | --- |
| GDPR Art. 30 RoPA & Art. 6 basis | Processing purposes, categories, lawful bases and balancing per activity | Draft mapping in this document; owner/legal sign-off missing |
| Railway hosting | Actual region, sub-processors, Art. 28 DPA, US transfer mechanism and retention | Production US sfo previously observed; contract/transfer not approved |
| Cloudflare R2 | Private bucket, actual placement/jurisdiction, object retention/lifecycle, DPA, subprocessors, transfer | Application adapter and read/write checks pass; dashboard/contract evidence not recorded |
| BytePlus | Contracting legal entity, data processing terms, country, training/reuse, model input/output retention and deletion procedure | **Not independently verified**; actual private video generation succeeded in owner test |
| Stripe | Data-controller/processor roles, payment and tax accounting retention, international buyer treatment | Private German LIVE test successful; global MoR/tax treatment is a separate open approval |
| Resend / email | Contract, region, retention, real sender/inbound handling and subprocessors | Integration present; final contract/inbound checks pending |
| Cookies / device storage | Full inventory, optional scripts, live TTL and consent management if nonessential access is used | Known first-party cookie details documented; third-party audit pending |
| STRATO HiDrive | Operator-only private folder, DPA, auth, client-side encryption, backup retention, isolated restore | Private folder prepared; OAuth approval and real copy/restore outstanding |
| Erasure and recovery | Isolated media/database restoration, retention job dry run, R2 lifecycle/copy deletion and case procedure | Synthetic tests exist; real DR and deletion exercise not completed |

## 5. Safe pre-public checklist

- Keep Production password protection and current private LIVE Credit/MP4 route unchanged.
- Inspect Cloudflare R2 bucket public access, exact region and lifecycle **read-only** before editing rules. Do not apply a bucket-wide `Delete after 30 days` rule: this would erase saved customer originals and provider evidence independent of project deletion.
- Verify any `byteplus-inputs/` lifecycle is prefix-scoped and never shorter than provider input lease + grace + operational recovery review.
- Keep `PROJECT_TRASH_PURGE_ENABLED=false` until an owner-approved, tested cleanup run and encrypted independent recovery exist. This is a risk and transparency limitation, not proof of compliant indefinite retention.
- Record actual vendor DPA and transfer mechanism evidence rather than treating a signed-up service or a privacy notice as one.
- Align customer-facing Privacy, Cookie and Terms pages to actual Production behavior. The operator has reported *no external customer data*; existing owner's Stripe/video test records remain real and must be preserved.

## References

- [GDPR (EUR-Lex), especially Articles 5, 12, 13, 15–18, 28, 30, 44+](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [EDPB: data protection by design and by default](https://www.edpb.europa.eu/system/files/documents/2026-02/edpb-summary-gdpr-data-protection-design-default_en.pdf)
- [Cloudflare R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Railway volume backup schedule/retention](https://docs.railway.com/volumes/backups)
- Project: `docs/R2_PRIVATE_INPUTS.md`, `docs/PRODUCTION_CROSS_STORE_RECOVERY_2026-11-16.md`, GitHub #90, #176, #230.
