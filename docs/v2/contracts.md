# Relay V2 contract package

WorkOrder: WO-01

The `lib/v2/contracts` package is the source of truth for V2 wire vocabulary before service implementation. It contains runtime validators, JSON Schema 2020-12 identifiers, deterministic canonicalization, state machines, and reason codes.

## Compatibility

- Public resource/API version is `v2`.
- Event, action, capability, and lease payloads carry their own schema/version identifiers.
- Additive optional fields are backward compatible. New required fields, changed meaning, narrowed enum acceptance, or canonicalization changes require a new schema version.
- Consumers reject unknown major versions and preserve unknown optional fields only when the enclosing contract allows them.
- Capability names are stable; incompatible input, resource, evidence, or effect semantics require a new capability version.
- Canonical action hashes are computed from validated action material before adding the hash field itself.

## Immutability and terminal states

An approved action version is immutable. A material edit produces a new action intent and supersedes its approval. Terminal task, action, approval, and lease states cannot transition. Lease renewal creates a new lease and policy decision.

## Invalid fixtures

The contract suite rejects missing tenant/version fields, unknown fields in security-sensitive objects, non-finite numbers, undefined values, non-plain objects, invalid time ordering, cross-type IDs, unbounded delegation chains, and action hashes with an invalid algorithm or length.

