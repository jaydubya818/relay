# Dashboard route performance contract

The dashboard route release gate measures the optimized production build, not the Next.js development server. The development server adds compilation and HMR work that Relay does not serve in a hosted deployment, so its latency is diagnostic rather than release-blocking.

The gate keeps the existing `<200 ms` p95 requirement. It builds Relay with `pnpm build`, starts it with `next start`, warms each authenticated route once, and records 20 sequential request samples per route using the same request-timing method as the original test. The test reports p50, p95, and p99 and fails when any route reaches or exceeds 200 ms at p95.

Production writes a Secure `__Host-relay_session` cookie. Because the loopback qualification server uses HTTP, the test captures that cookie from the normal login response and sends it explicitly through a dedicated authenticated request context. This does not change application authentication behavior or bypass authorization; it allows the production server to validate the real opaque session against the disposable database without weakening cookie security.

The original development-mode failures and the before/after measurements are retained in the dated owner-preview qualification evidence.
