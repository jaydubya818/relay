# Live observation and human control

Relay is the control authority even when a provider supplies the pixels. A computer-control session binds one account, placement, task, capability lease, and provider session. Provider URLs remain server-side: a user receives a short-lived opaque Relay viewer grant, and Relay's observation proxy returns a Relay stream identifier.

## Input fencing

The controller is exactly one of `AGENT`, `PAUSED`, `HUMAN`, or `TERMINATED`. Every input permit carries the current fence token. Beginning Agent input atomically increments the in-flight count only while controller and fence still match. Takeover can atomically change the controller and increment the fence only when no Agent input is in flight. Therefore either an Agent operation starts or takeover wins; both cannot hold valid input authority.

Human input requires the selected principal, `HUMAN` state, and current fence. Disconnect moves the session to `PAUSED`, clears protected-entry mode, increments the fence and viewer epoch, and revokes viewer grants. It never silently gives control back to the Agent.

Resume requires an active authorized operator, no in-flight input, a fresh policy decision, and a safe integrity inspection. It clears human authority, rotates the fence and viewer epoch, revokes prior viewer grants, and records the inspected state hash.

## Protected credential entry

Only the current human controller can enable protected credential entry. While active, observation returns a suppression marker and never calls the provider observation relay. Events record only that suppression began or ended; credential contents, keystrokes, screenshots, and frames are excluded. Secret values remain outside evidence and Agent context.

## Failure handling

- Expired, revoked, cross-account, or old-epoch viewer tokens fail closed.
- A failed integrity or policy check leaves the computer human-controlled or paused.
- A takeover collision returns a retryable conflict without weakening the fence.
- Provider observation failure does not change control ownership.
- Human disconnect pauses; an authorized explicit resume is required.
