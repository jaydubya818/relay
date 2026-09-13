# Sandboxes

Relay sandboxes are Agent-owned, durable resource records backed by replaceable execution providers.

## Canonical contract

Relay services and MCP tools depend on `SandboxProvider`, which defines `create`, `exec`, `readFile`, `writeFile`, `listFiles`, `destroy`, and `health`. The public resource ID is a Relay `sbx_…` ID. Provider resource IDs are internal and never returned through the capability contract.

The initial `DockerSandboxProvider` is selected by the provider registry. Adding E2B or another managed provider must implement the same contract and must not change Agent grants, MCP schemas, ownership checks, or Activity records.

## Security defaults

- Sandboxes are private to their owning Agent until an Account operator creates an explicit Agent grant.
- Every resource lookup includes the Account ID before ownership or sharing is evaluated.
- Default network policy is `NONE`. `OPEN` must be requested explicitly. A future `RESTRICTED` allowlist policy is represented but rejected until it can be enforced correctly.
- The Docker adapter passes no Relay environment variables or credentials into containers.
- Containers drop all Linux capabilities, set `no-new-privileges`, cap processes, CPU, and memory, and use an isolated writable container filesystem.
- Commands have provider and host timeouts plus a bounded output buffer.
- File reads and writes are limited to the sandbox workspace and one MiB per operation.
- TTL is stored durably. Expired resources are destroyed during access or cleanup runs.

## Configuration

```text
RELAY_DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
RELAY_SANDBOX_IMAGE=alpine:3.20
```

The production host must provide a Docker-compatible engine and restrict access to its control socket to the Relay service account. Access to the Docker socket is equivalent to host-level administrative authority and must never be exposed to Agents or containers.

## Qualification

Contract and authorization tests use an in-memory fake through the provider interface:

```bash
pnpm test:sandbox
```

Run the real provider qualification only on a controlled development host:

```bash
RELAY_LIVE_DOCKER=1 pnpm test:sandbox
```

The live test creates and destroys a real constrained container, exercises command execution, binary file IO, file listing, timeout, output bounding, network isolation, and verifies that Relay environment variables are absent.
