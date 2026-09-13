# Operations

Relay emits structured JSON for capability calls and operational failures. Capability records include durable Agent session IDs, Agent and capability identity, provider-independent status, latency, and governed resource identifiers. Secrets and command/browser contents are excluded from activity metadata and logs.

`GET /api/health` is a lightweight PostgreSQL-backed liveness check. `GET /api/health/ready` verifies database access, applied Drizzle migrations, and the durable event table. Connector and execution-provider health is reported separately at `GET /api/health/providers`; provider degradation does not make global readiness fail.

Run migrations before shifting traffic:

```sh
pnpm db:migrate
```

Expired sandbox and browser resources must be cleaned by periodically invoking the exported cleanup functions from a trusted worker. V1 stores wake requests durably but does not automatically launch arbitrary Agent runtimes.
