# Orchis → Sofie production beta qualification

Status: **`WAITING_FOR_TESTER`** (September 27, 2026 UTC). This guided beta is
separate from the earlier disposable managed-beta Golden Journey and does not
change Relay V2 release gates.

## Verified before the tester send

| Boundary | Observed status |
| --- | --- |
| Relay authority | An exact Orchis Agent → Sofie Agent `message.send` grant is active, expires October 3, 2026 at 23:33:32 UTC, and permits at most 10 calls per hour. Its signed grant audit was verified. No Knowledge, Factory, or private-memory grant was added. |
| Sofie | The production Relay connection is active. Incoming policy for Orchis is enabled. Automatic response is configured with an owner-approved public profile; model authentication is present and the selected free model is listed at zero cost. Configuration is not a live reply test. |
| First delivery | Sofie's authorized production inbox contained zero requests from the exact Orchis Agent at the latest check. No delivery, reply, or duplicate-suppression result is claimed. |
| Recovery cleanup | The one-use production recovery endpoint was removed, its production bearer variable was removed, and the original mainline was redeployed. The separate Vercel access token exposed during operator UI work was revoked; Vercel listed zero matching active tokens afterward. Its scope was a Vercel team. No replacement is required for this Relay message exchange; a separate workflow that used it would need its own newly scoped credential. |
| UI change | MyEve PR #41 only changes an incoming status label. It has **not** been deployed for this qualification. |

## Real tester acceptance

Wait for Orchis to initiate “Send Sofie a harmless beta hello and ask for a
short acknowledgment” from her signed-in Eve. Do not access Orchis's account,
inspect her private or reciprocal grants, or create a synthetic send under her
identity. A missing incoming request keeps the state `WAITING_FOR_TESTER`.

After a real request arrives, use only Sofie's authorized inbox and Relay
records visible from Sofie's side to verify, in order:

1. The signed caller identity is the exact registered Orchis Agent and the
   destination is Sofie. Confirm the seven-day grant was active for the
   request, its capability/resource match, and the rate limit was respected.
2. Correlate Relay request ID, conversation ID, signed delivery, and Sofie's
   one durable incoming record. Confirm the request reached the receiving
   Agent and Relay acknowledged its result.
3. Verify Sofie returned an actual automatic written response, not merely
   `{ "acknowledged": true }` or `replyStatus: "unavailable"`. Check its
   `replyTo`, conversation and participant binding, signed provenance, and
   public-profile-only response boundary.
4. Re-poll/re-read the same request without a second send. Confirm one
   response and one local effect for that request ID, with no duplicate
   execution or additional outbound message.

If Orchis reports a sanitized error, correlate only the request ID,
conversation ID, and approximate timestamp she supplies against authorized
Sofie/Relay records. Do not inspect her private account. Mark a failed or
missing step as such; do not report reciprocal communication `PASS` from a
grant, an acknowledgment, or a simulated request.
