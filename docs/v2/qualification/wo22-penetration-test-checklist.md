# Relay V2 independent penetration-test checklist

Status: `REQUIRES_HUMAN_REVIEW`  
Target: a dedicated production-like Relay V2 staging tenant and provider set  
Prohibited targets: Relay V1, production customer data, uncontrolled third-party accounts

The tester must receive written authorization, exact hosts/accounts/providers, test window, source IPs, emergency contacts, data-handling rules and stop conditions. Use synthetic tenants, messages, files, financial instruments and secret canaries. Do not create real purchases or contact uninvolved recipients.

## Entry criteria

- Reviewed commit and deployed image digests are recorded.
- Two attacker-controlled tenants plus one administrator fixture exist.
- Browserbase/E2B/runner/channel/connector targets included in beta are connected to dedicated test accounts.
- Logs, traces, audit export and provider receipts are retained for the window.
- Kill switches, revocation operator and incident contact are staffed.
- Destructive and denial-of-service test ceilings are approved.

## Test checklist

| Area | Tests | Passing condition |
|---|---|---|
| Authentication/session | Credential stuffing limits, fixation, cookie flags, logout/revoke, CSRF/same-origin, step-up replay and expiry | No session/step-up reuse, cross-origin mutation or tenant switch |
| Tenant isolation | Enumerate/substitute IDs across REST, MCP, dashboard, jobs, outbox/DLQ, objects, runners, artifacts, computers, communications, connectors, approvals and budgets | No cross-account existence oracle, read, mutation, routing or signed URL |
| Runtime/Agent attribution | Forge runtime product, Agent ID, Passport, account and audience claims | Self-declared metadata grants no authority; mismatch denied and audited |
| Passport/grants/policy | Replay old Passport/policy, omit facts, alter resource ownership, test `ALLOW`/`DENY`/`REQUIRE_APPROVAL`/`LIMIT`/`ESCALATE` edges | Stale/missing/untrusted facts fail closed; no policy widening |
| Approval | Tamper recipient/resource/merchant/amount/currency/attachment after display; reuse deep link; race decisions/consumption; wrong approver | Exact action binding and once consumption hold under concurrency |
| Budgets | Parallel reservations, hierarchy bypass, unit/currency confusion, stale/unknown balance and settlement replay | Hard limit cannot oversubscribe; unknown state blocks consequential work |
| Workload identity/leases | Steal/replay token, wrong workload/audience/provider/account, call exhaustion, expiry/clock skew, parent revoke, offline financial use | Every invalid or stale authority is rejected and evidenced |
| Events/outbox | Forge signature, replay/reorder/dedupe, poison payload, oversized body, tenant route substitution, worker death around effect | One logical task/effect; poison isolated; unknown effects never blind retry |
| Provider adapters | SSRF/redirect/DNS rebinding, metadata/private IP, command injection, path traversal, timeout/429/5xx, malicious receipt | Constrained destinations/resources; failures classified; no policy bypass |
| Customer runner/gateway | Enrollment replay, certificate theft, fake attestation, downgrade, assignment replay, offline work, reconnect, secret/artifact exfiltration | Relay remains authoritative; outbound-only boundary and revoke TTL hold |
| Computer/browser | Viewer-token theft, cross-session attach, stale fence input, simultaneous human/Agent input, snapshot/profile leakage, protected-entry capture | Exclusive control, tenant/profile isolation and capture suppression hold |
| Slack/Telegram | Webhook forgery/replay, sender spoof, thread substitution, mention/reply loop, new-recipient send, rate/outage behavior | Verified identity/thread, loop prevention, exact approval and evidence |
| Drive/Linear | OAuth state/callback mix-up, scope escalation, cross-account resource, token refresh/revoke race, permission drift | Least scope and account ownership; revoke/drift immediately deny |
| Money/protected checkout | Raw PAN/CVV injection, credential-handle enumeration, merchant/amount substitution, checkout permit replay, ambiguous result retry | No raw credential exposure; exact final review; unknown effect quarantined |
| Evidence/audit | Tamper, delete, reorder, duplicate sequence, forge source/assurance, secret canary in artifacts/logs/traces | Offline verification fails on tamper; canary absent; source not overstated |
| Rate/abuse | Per-tenant fairness, webhook flood, expensive policy facts, provider-call and spend exhaustion within approved ceilings | Attacker tenant cannot starve or spend another tenant; alerts fire |
| Supply chain/release | Unsigned adapter/image, version downgrade, SBOM/provenance mismatch, unprotected release path | Deployment rejects untrusted digest/version and records provenance |
| RBAC/admin | Role escalation, membership suspension bypass, service-client overreach, audit/retention/kill-switch authorization | Least privilege and step-up requirements hold |

## Required evidence

For every case record:

- unique test ID, UTC timestamp, tester and source;
- exact commit/image/provider versions and tenant fixtures;
- request/action hash and correlation/task/lease identifiers where relevant;
- expected and observed outcome;
- Relay audit/export and provider-side receipt/log reference;
- screenshots only when they contain no restricted data;
- finding severity, reproducibility, affected boundary and remediation owner.

## Finding policy

- Any exploitable cross-tenant access, authority widening, approval/budget bypass, secret exposure, duplicate consequential effect, audit forgery or release-chain compromise is critical/high until independently triaged.
- Limited beta requires no open critical/high finding. An exception must be signed by the security owner and Product Owner, narrowly scoped, monitored, and expire on a stated date.
- Fixes require focused regression coverage and independent retest; developer assertion alone does not close a finding.

## Exit record

| Tester | Test dates | Commit/images | Providers/channels/connectors | Critical | High | Medium | Low | Retest complete | Report/signature |
|---|---|---|---|---:|---:|---:|---:|---|---|
| _required_ | _required_ | _required_ | _required_ | _required_ | _required_ | _required_ | _required_ | _required_ | _required_ |

Until an independent tester completes and signs this record, the penetration gate remains `REQUIRES_HUMAN_REVIEW`.
