# Customer Insights — private CMS operations (2026-11-18)

Status: implemented as a **read-only, Super-Admin-only Payload CMS view** at `/admin/customer-insights`. This is a technical/operational description, **not a legal compliance certificate** or authority to activate marketing and tracking.

## Business goals and available data

1. **Customer support:** identify a registered customer by email or exact account ID; review the account's existing verification status, Credit Wallet balance, reservations, fulfilled video activity, open checkout attempts and status timeline. The view displays no passwords, session keys, Stripe secrets, filenames, content prompts or media URLs. Financial actions remain in the separately protected support workflow.
2. **Finance:** distinguish Credit purchase payments, promotional Beta Credits, consumed Credits and legacy euro orders. The CMS displays **application-recorded gross payment indicators** and separately known refunds, **not** settled bank revenue, turnover net of VAT, merchant fees, gift-cost COGS, gross margin or profit. These require reconciliation with Stripe and bookkeeping.
3. **Retention / product metrics:** registered accounts, verified emails, new registrations in the last 30 days, documentable video completions, pending payment attempts, credit video reservations and reviews. `lastTransactionAt` is a **business event**, not last website visit.
4. **Due diligence / possible business sale:** prioritize aggregate, reproducible metrics (activation of registered accounts into purchased Credits, refund rates, delivered videos, cohort retention, customer concentration, cost per verified MP4, compliance risks). Share **aggregate/anonymized figures first**. Any disclosure of identifiable customer records to a purchaser or investor needs a documented purpose, legal basis, recipient review, access scope, notice where appropriate and confidentiality measures; this CMS view is **not** an unrestricted investor data room.
5. **Marketing:** customer account email, transaction receipts and video-ready email preferences are **not marketing permission**. There is no verified newsletter opt-in in this projection.

The page is environment-local: Staging never merges with Production. It queries the existing `commerce.sqlite` by opening a regular, non-symlink file read-only, paginates 25 accounts, searches server-side, and never uses `CommerceStore` to create or mutate tables. Monetary fields remain in euro cents until display.

## Privacy and security controls

- The Payload custom root view checks the **full server-side** `initPageResult.req.user` for `super-admin` (never read-filtered client props).
- The private `GET /api/customer-insights` endpoint separately checks the authenticated Payload CMS **super-admin** role, limits requests by staff identity, validates search and profile IDs, and returns only approved projections. Customer cookies cannot authenticate this endpoint.
- Every successful list/detail retrieval generates an append-only CMS `audit-events` entry containing staff actor ID, action, category and account ID (detail only). Failed audit logging returns an error instead of releasing personal data.
- No bulk export, email dispatch, automatic refund, CRM import, remote analytics, external advertising pixel, server-side Geo-IP enrichment, new visitor cookie, client fingerprinting or behavioral session log.
- No new database columns/tables or automatic migrations; a missing `commerce.sqlite` is unavailable, never “zero customers”.
- Activity events shown to the operator are bounded (35 latest), without payment session IDs or media links.
- Existing support staff permissions are **not** broadened to full-customer PII.
- No change to current media deletion, billing, BytePlus or public access release gates.

## Critical interpretation limits

| Metric | Meaning | Not established |
| --- | --- | --- |
| Registered | Persisted `customer_accounts` entry | Verified unique real people, repeat visitors |
| Confirmed email | Existing verification record | Marketing opt-in |
| Documented videos | Settled Credit video reservations + linked old paid/free delivery records | Every draft, every anonymous demo video, every provider request |
| Paid Credits | Wallet top-ups with paid status and not reversed | Stripe payout / net-of-tax turnover |
| Legacy paid | Existing paid/delivered order status, gross amount | Account settlement, net refunds, provider costs |
| Last transaction | Latest order, Credit purchase or video reservation event | Last sign-in, active session duration, website dwell time |
| Open top-up | Purchase pending status | Proven shopping-cart abandonment |
| Acquisition source, country | **Not tracked / unknown** | IP-derived region, advertising referral |
| Marketing approval | **Not available** | Consent via verified email or service preference |

If a table is absent in a legacy source, do not infer a person has no financial history; reconcile first with the original commerce data. User/guest ownership links from all historical channels must be assessed before treating “video count” as exhaustive.

## Future phases requiring separate legal/operational approval

**Phase 2: privacy-first product analytics** (off by default).
- Specify exact product questions before collecting new event types.
- For aggregate visitor funnel/visit duration/referrer reporting, first inventory cookies and device accesses; determine TDDDG §25 applicability and GDPR Article 6 legal basis with counsel.
- If consent is required, provide a granular consent UI with reject/equal prominence, consent version, revocation, transparency, retention rules and tested opt-out. Do not set trackers before valid consent.
- If implemented, minimize fields: aggregate daily sign-ups, successful renders, checkout starts/completions and referrer/country buckets without full URLs, query strings, IPs, cross-site identity or individual browsing histories. Define retention limits and small-cohort suppression.
- Abandonment is a measured funnel drop-off (not “pending invoice”); visit duration requires explicit measurement and is often unreliable (background tabs, page closes).

**Phase 3: support and resale readiness.**
- Add verified rights-request workflow for access, rectification, erasure/restriction where legally permissible. Preserve accounting/chargeback evidence separately and document subject-level deletions across local DB, R2, providers and backups.
- Document purposes, lawful bases, data retention schedule, DPA/vendor transfer risks, staff access review, record of processing activities, controller contact and incident response. Verify each provider's actual retention and transfer settings.
- Reconcile customer-level gross receipts, refunds, VAT, payment fees and inference cost in a finance system before calling a metric `Umsatz` or `LTV`.
- Build aggregate anonymized monthly cohorts for investor reports; no automatic mass export of emails.
- Separate support rights from investor access, and require counsel-reviewed due-diligence controls prior to any company transaction.

Regulatory references: [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) (particularly Articles 5, 6, 12–15, 17, 25, 30), [DSK Orientierungshilfe Digitale Dienste](https://www.bfdi.bund.de/SharedDocs/Downloads/DE/DSK/Orientierungshilfen/OH_Digitale-Dienste.pdf?__blob=publicationFile&v=1), [Berliner Datenschutzbehörde Cookies](https://www.datenschutz-berlin.de/themen/internet/cookies), [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en). This document is not a substitute for individualized German privacy, marketing or tax advice.
