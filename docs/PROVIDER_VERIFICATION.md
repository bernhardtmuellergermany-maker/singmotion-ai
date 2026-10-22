# OmniHuman 2.0 integration gate

Status: **not verified, not connected, no paid API requests made**.

The supplied product specification reports observations in the BytePlus console:

- OmniHuman 2.0, USD 0.07/second before tax (provider cost, not customer price).
- MP4, 720p, 25 FPS.
- One JPEG/PNG image; up to 30 MB and 4096 × 4096.
- MP3 audio up to 15 MB and 300 seconds.
- English prompt support.

These observations are not a complete official API contract. No authenticated provider documentation or verified OmniHuman **2.0** request/response contract was supplied. Consequently this implementation contains **no guessed endpoint, auth header, signing scheme, model ID, or field mapping**. It does not reuse an OmniHuman 1.5 API. No credential value is needed for the demo.

Before implementing and activating the direct adapter, record the official source URL, API version/date, region, and concrete evidence for each item:

1. Authentication/signing, token lifetime, endpoint region, entitlement and usage restrictions.
2. Exact 2.0 model identifier, creation schema, optional prompt field and accepted languages.
3. Input delivery method (signed URLs or upload), accepted MIME/codecs, minimum dimensions/duration, maximum limits, and signed URL validity needs.
4. Single-image versus explicit multi-image support. The current domain always submits one primary image.
5. Job creation response, durable provider ID, idempotency support, retry semantics, rate limits, and ambiguous timeout recovery.
6. Polling/webhooks, authenticating webhook signatures, terminal status mapping, cancellation behavior, and error responses.
7. Output URL domains/expiry, download authorization, exact media format, copy-to-R2 and media validation requirements.
8. Billing granularity, minimum chargeable duration, failed-job billing, regional tax/currency, and commercial likeness/music restrictions.
9. Supported prompt behavior: gentle camera/performance directions are guidance; orbit is not offered until supported and useful. No deterministic choreography or identity promise.

Then use a separately authorized, budget-capped live smoke test. Never automatically resubmit an ambiguous paid request or fall back to fal.ai. Persist the provider request/idempotency record before submitting. Read-only polling can retry with bounded backoff; rendering needs explicit authorization and deduplication.

The fal.ai fallback needs its own official 2.0 contract verification and explicit selection; a common adapter interface does not establish API compatibility.
