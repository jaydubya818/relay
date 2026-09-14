# WO-22 accessibility and approval-comprehension protocol

Automated accessibility status: `PASSED_AUTOMATED`  
Human accessibility status: `REQUIRES_HUMAN_REVIEW`  
Approval-comprehension status: `REQUIRES_HUMAN_REVIEW`

## Automated baseline

On 2026-09-13 a fresh Chromium/axe-core 4.13 audit covered:

`/v2`, `/v2/activity`, `/v2/tasks`, `/v2/approvals`, `/v2/agents`, `/v2/computers`, `/v2/connections`, `/v2/governance`, `/v2/infrastructure`, and `/v2/settings`.

After the focused navigation-landmark correction:

- axe WCAG A/AA violations: 0 on every route;
- every route: one `h1`, one `main`, one navigation landmark, one `aria-current="page"`;
- unnamed buttons: 0;
- first keyboard focus on the Approval route: “Skip to content” linking to `#v2-content`;
- final browser console: 0 errors and 0 warnings;
- focused dashboard regression: 2/2; typecheck and lint passed.

Automated results do not establish screen-reader usability, visual contrast in all states, cognitive clarity or human approval comprehension.

## Human study objective

Determine whether representative operators can independently:

1. navigate critical V2 states with supported keyboard and assistive technology;
2. identify who/what is acting;
3. identify the exact destination, recipient, merchant or resource;
4. state the consequence and data exposure;
5. state the approval scope and duration;
6. identify exact financial amount/currency or resource mutation;
7. distinguish approval from execution and recognize unknown/reconciliation states;
8. safely deny, pause/take control, revoke and recover.

## Participants

- Minimum 8 approval-comprehension participants: at least 3 frequent operations/admin users, 3 non-technical business approvers and 2 accessibility users.
- Accessibility matrix participants may overlap but must include direct users of each tested assistive-technology combination.
- Participants must not have authored the UI or source specification.
- Record experience level and accessibility needs; do not record unnecessary personal data.

## Platform and assistive-technology matrix

At minimum test current supported versions of:

- macOS + Safari + VoiceOver;
- Windows + Chrome or Edge + NVDA;
- Windows + Edge + Narrator;
- iOS + Safari + VoiceOver for responsive approval review;
- keyboard-only at desktop and narrow viewport;
- 200% zoom, increased text size, high contrast/forced colors, reduced motion.

Any excluded combination requires a named support-policy decision.

## Seeded scenarios

Use synthetic accounts and recipients only.

| Scenario | Required visible facts | Expected participant action |
|---|---|---|
| New-recipient Slack message | Agent/runtime, recipient/workspace/channel, exact message/attachments, consequence, once scope | Explain facts, approve once |
| Modified Telegram recipient after approval | Original and mutated recipient/action hash consequence | Refuse/reject; require new approval |
| Drive restricted-data share | Agent, file/resource, destination identity, classification, permission/effect, duration | Identify data exposure and deny unless scenario authorizes |
| Linear issue update | Workspace/project/issue, exact field transition/comment, task scope | Explain mutation and scope |
| Purchase | Agent/runtime, merchant, items, maximum amount, currency, credential display reference, human-checkout boundary | State exact maximum and protected-entry behavior |
| Insufficient/unknown budget | Budget scope/limit/status and blocked effect | Do not attempt workaround; identify required recovery |
| Live computer takeover | Current controller, Agent input fencing, protected entry, resume restriction | Pause/take control and verify Agent cannot type |
| Unknown external effect | Possible effect, no-auto-retry warning, evidence/reconciliation route | Avoid retry; escalate/reconcile |
| Revoked runner/connector | Affected resource and denial reason | Confirm subsequent action is blocked |

## Session procedure

1. Obtain consent and explain that the product—not the participant—is under test.
2. Start from a signed-out or neutral dashboard state; do not coach navigation.
3. Give task intent without naming the control to use.
4. Ask the participant to think aloud, then answer before deciding:
   - Who or what will act?
   - Where/to whom will it act?
   - What exactly will happen?
   - What data, money or resource is involved?
   - How many times and for how long does this approval apply?
   - What would cause Relay to ask again?
5. Record the answer verbatim, action taken, time, navigation errors and facilitator intervention.
6. For screen-reader runs, record focus order, landmark/heading announcements, control names/states, dynamic error/success announcements and return focus.
7. Debrief for confidence, ambiguity and perceived risk.

## Acceptance thresholds

All critical conditions are mandatory:

- 100% correctly identify actor, destination/recipient/merchant/resource, consequence, scope and exact amount/currency in financial scenarios before approving.
- 100% reject the mutated-recipient/amount scenario or explicitly require a new approval.
- 100% avoid retrying an `EFFECT_UNKNOWN` action.
- 100% confirm protected entry prevents simultaneous Agent input.
- No participant can complete a destructive, external-communication or financial action while materially misunderstanding its effect.
- At least 90% of non-critical tasks complete without facilitator intervention.
- Every supported AT combination can reach, understand and operate all critical controls with visible/audible focus and error/success feedback.

A missed critical condition is a failed study, not an averageable usability observation.

## Evidence and remediation

Retain a redacted study packet containing participant IDs, environment/version, seeded scenario hashes, responses, actions, completion times, accessibility findings and facilitator notes. Do not capture real credentials, communications or financial data.

Every finding receives severity, owner, target WorkOrder/release, regression method and retest result. Critical misunderstanding, inaccessible approval controls or inaccessible takeover/revocation blocks limited beta. The Product Owner and independent accessibility reviewer sign the final result.

| Study lead | Dates | Participants | AT/platform coverage | Critical misses | Remediation/retest | Decision | Signatures |
|---|---|---:|---|---:|---|---|---|
| _required_ | _required_ | _required_ | _required_ | _required_ | _required_ | _required_ | _required_ |
