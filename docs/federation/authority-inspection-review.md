# Authority inspection security review

Scope: additive authenticated `authority.inspect`, its safe diagnostics, and the shared read-only policy evaluation extraction. This is an internal source review, not an independent audit or a production attestation.

- Authentication: existing Agent credential authentication derives both caller identifiers; canonical strict submission parsing rejects identity overrides.
- Isolation: grant diagnostics are restricted to caller account, caller Agent and exact target Agent. Names are not used. Queries are parameterized.
- Privacy: Knowledge diagnostics first require a non-private current publication and applicable audience. Inaccessible/private/absent resources and blocked relationships return MISSING. Responses never include grant documents, other resource names, policy expressions or secrets.
- Temporal authority: observations contain no execution handle. Existing submission, delivery and result retrieval still evaluate canonical current authority. Tests reject executing after revocation and expiry and reject injecting an old inspection result into a submission.
- Effects: inspection shares the canonical grant predicate and policy snapshot evaluator; it does not call policy decision persistence. Database snapshots cover grants, requests, approvals, budgets, policy decisions, audit, outbox, credentials and publications. Only bounded rate counters change.
- Abuse: bounded canonical body and field sizes plus per-Agent and per-account counters. No bulk or anonymous inspection operation.
- Signing/protocol: no signing implementation, token/envelope schema, grant contract, or execution authorization semantics changed. The policy refactor separates its existing computation from its existing persistence without changing the execution evaluator.
- Operational distinction: ACTIVE reflects current identity/resource/grant/policy checks, not guaranteed future admission, budget reservation or delivery. A caller must retain final checks and treat unknown transport failures as unavailable.

No confirmed authorization bypass or private-data disclosure was found in this review. The verification record must accompany these conclusions; tests do not establish timing-side-channel resistance or production performance.
