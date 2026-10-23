# Private OmniHuman output downloads

> Latest update: [clarified base billing, unapproved candidate hostname and
> operator-only existing-task MP4 retrieval](OUTPUT_RETRIEVAL_REVIEW.md).
> Rounding is clarified; inclusive taxes and host/media approval remain required.
> No real provider/R2 requests were made.

> **Operator discovery update:** [First controlled live test](FIRST_CONTROLLED_LIVE_TEST.md)
> documents a separate, explicitly gated one-plan CLI. It requires a manually
> reviewed inclusive exact-case bound and records the output URL without download.
> The ordinary production contract/transport and public flow remain blocked.
> No live request was performed during implementation.

Live generation remains blocked. No real output hostname has been approved:
`bytePlusVerification.contract` remains null, so the production allowlist has
no entries. No wildcard, environment override or example domain is installed.
The example hosts in tests are fictional and never contacted.

## Connection protection

The production `downloadValidatedOutput` defaults to `privateOutputTransport`
in `lib/live/output-transport.ts`. The runner uses that downloader by default;
it does not use global fetch. Its explicit dependency injection is for trusted
server-side tests only, not an HTTP, CLI or environment configuration option.

1. Require HTTPS, an exact approved hostname and port 443; reject credentials,
   fragments, IP literals (including alternate IPv4 forms), trailing-dot aliases
   and local names. An empty allowlist rejects before DNS or any connection.
2. Resolve all OS DNS answers once, within the overall 120-second deadline.
   Reject empty/malformed answers or any non-public answer, including mixed
   public/private results. No automatic fallback/retry is made.
3. Connect directly to the selected **literal public IP**, using a fresh Node
   HTTPS connection with `agent: false`. There is no second DNS lookup or shared
   socket pool. Retain the original approved hostname in TLS SNI, standard TLS
   certificate hostname verification (`rejectUnauthorized: true`) and Host.
   No request cookies, credentials, proxy settings or authorization headers are
   forwarded. A signed output URL's query is sent only to that pinned destination
   and is never logged. Node request does not follow redirects.
4. Also verify the authenticated socket's peer IP matches the selected address
   before accepting its response. IPv6 canonical-equivalent notation is accepted;
   a different peer is refused. No retry on TLS/connect/transfer failure.

The conservative address policy rejects IPv4 loopback, unspecified, RFC1918,
link-local/metadata, carrier NAT, benchmarking, documentation, multicast and
reserved ranges, plus Azure's platform virtual IP. IPv6 is limited to global
unicast 2000::/3, excluding protocol assignments, documentation and 6to4 ranges.
IPv4-mapped/compatible IPv6, NAT64, ULA, scoped/link-local and multicast IPv6 are
rejected. This deliberately sacrifices some uncommon legitimate destinations.
Review the policy against future IANA special-purpose assignments before live
activation; never add an exception merely because a test download fails.
Public IP classification cannot guarantee control-plane routing or that an
approved public service is trustworthy. Review host ownership and deployment
egress controls separately; no firewall or Railway settings are changed here.

## Existing private-media guarantees retained

Only HTTP 200 is accepted; redirects are closed, never followed. Headers are
bounded to 16 KiB. Responses request identity encoding, reject other encodings
and invalid Content-Length, enforce an actual 100 MiB streaming cap, and verify
length when advertised. The 120-second signal spans DNS, TLS and body transfer.
Cancellation/error destroys streams/connections; errors omit upstream details,
credentials, signed URLs and authorization headers.

Downloads use exclusive creation with mode 0600. Failures remove only the new
partial file, never an existing file. MP4 signature, stream presence, dimensions,
frame rate, duration and full FFmpeg decode validation remain required. The
runner revalidates even injected downloads and commits only under its SQLite
poll lease. FFmpeg has its separate 120-second decode deadline. Failed or expired
output retrieval never causes another paid submission or a budget refund.

## Before activating the real downloader

- Obtain exact BytePlus HTTPS output hostnames and evidence of their ownership.
  Review each individual hostname in a complete immutable verified contract;
  do not use wildcards, URL-supplied domains or allow redirects to new hosts.
- Confirm dimensions/aspect, codecs/FPS, output duration expectations and whether
  an expired one-hour URL can be refreshed without another generation.
- Complete inclusive billing/output-duration bounds and the remaining protocol,
  IAM, retention and operator review. Keep demo mode and hard verification gates
  unchanged until separate review and explicit one-test authorization.
- Review destination policy/egress and run offline regression checks. Later live
  acceptance of DNS/TLS and actual BytePlus output retrieval requires separate
  authorization; the mocks do not establish real hostnames or account acceptance.

Regression tests inject DNS and HTTPS boundaries, including the production
function's default path, with global fetch disabled. They cover public IPv4/IPv6,
private/mixed DNS, rebinding, peer mismatch, TLS rejection, DNS cancellation,
malicious URLs, redirects, connection failure, oversized advertised/streamed
bodies, private-file cleanup and successful MP4 validation. No BytePlus or R2
request is needed for these tests.

Validation (October 23, 2026, Cloud Linux / Node 24): lint, typecheck, production
build, all 115 automated tests (including eight new transport/security cases and
the nine backend lifecycle scenarios), and staging production security checks
passed. Staging checks cover authentication, private media/ranges, API access,
secure cookies, CSRF, generation lock and worker heartbeat. Windows execution
was not available in this session; tests use Node APIs and portable temp paths.
