# Relay V2 operator dashboard

The V2 dashboard is an additive `/v2` control surface. Its visual model is an evidence-first operations ledger: current work and required human decisions are prominent; decoration and vanity analytics are excluded.

## Information architecture

- **Command:** active work, pending decisions, human control, budget warnings, and unknown outcomes.
- **Tasks:** durable state, retries, dead letters, and explicit cancellation.
- **Approval center:** actor, destination/task, consequence, immutable evidence, scope, password step-up, approve, and deny.
- **Agents:** lifecycle, signed Passport trust, validity, and runtime attribution.
- **Computers:** controller, fence, protected-entry state, pause, and exclusive takeover.
- **Connections:** account-owned communication identities, connector scopes/restrictions, and delivery state.
- **Governance:** active policy versions and budget consumption/currentness.
- **Infrastructure:** customer runners, assurance, certificate health, placement state, and cascade revocation.
- **Activity:** signed audit ledger with unknown-effect visibility.
- **Settings:** operator/account boundary and truthful external qualification status.

## Safety and state rules

Every page has a meaningful empty state. Stale, paused, reconciliation-required, dead-lettered, and effect-unknown states are visually distinct and actionable. Destructive operations use a two-stage confirmation. Approval decisions require password step-up bound to the exact request, action hash, and decision. The UI never returns broker credential handles, runtime secret hashes, runner public keys, or webhook secret handles.

Resume after human control is intentionally unavailable unless the deployment supplies both fresh policy and integrity checks. The UI does not offer a placebo resume button.

## Accessibility

Critical controls are native buttons and labeled forms, focus rings remain visible, status is communicated by text and not color alone, tables retain headers, page structure uses semantic landmarks, layouts reflow at 1020px and 660px, and motion respects `prefers-reduced-motion`. Formal WCAG 2.2 AA browser/audit evidence and comprehension sessions are recorded in WO-21 qualification and remain a WO-22 launch input.
