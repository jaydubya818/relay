# Deployment

Relay is hosting-provider neutral. A production deployment requires a Node.js 22 web/API service, PostgreSQL with TLS and backups, a secret manager, a conforming sandbox provider, browser runtime dependencies, and a trusted periodic worker for expiration and wake processing. Governed object storage is required before provider event payload bodies are retained.

Build with `pnpm build`, apply schema changes with `pnpm db:migrate`, start the web service with `pnpm start`, and start the maintenance process with `pnpm worker`. Configure load balancers to use `/api/health` for liveness and `/api/health/ready` for readiness. Do not gate global readiness on GitHub, Google, Docker, or Playwright availability.

The web service should run without host Docker access when a managed `SandboxProvider` is selected in the future. Canonical Agent and MCP contracts must not change when providers change.
