# Live control qualification

## Local evidence

`tests/v2/runners.test.ts` includes:

- a concurrent Agent-input/takeover race where exactly one authority succeeds;
- account-bound viewer and control-session isolation;
- provider URL containment behind a Relay stream ID;
- expired viewer denial;
- protected credential-frame suppression;
- policy and integrity rechecks before resume;
- input-fence and viewer-epoch rotation;
- stale human-input and disconnect denial after resume.

The database migration and serial suite exercise the durable session, viewer, and event boundaries. Production latency/SLO measurement remains WO-22 because local loopback PostgreSQL is not representative.

## Downstream evidence gates

- Concurrency demonstration video: pending WO-21 browser UI.
- WCAG 2.2 AA keyboard/focus/screen-reader report: pending WO-21 UI.
- Live Browserbase takeover and disconnect drill: `BLOCKED_EXTERNAL_CONFIGURATION` with WO-13 API key.
- Production observation latency benchmark: pending deployed regional infrastructure at WO-22.

These missing artifacts do not weaken the input-fence invariant, but WO-15 remains `IMPLEMENTED` rather than fully product-qualified until the applicable downstream gates pass.
