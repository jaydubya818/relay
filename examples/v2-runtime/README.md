# Relay V2 runtime examples

Use the TypeScript client for a Codex runtime and the Python client for a Claude runtime. The product label is attribution metadata only; authorization always comes from the account, Passport, policy decision, workload identity, and capability lease.

```ts
const relay = new RelayV2Client({
  baseUrl: process.env.RELAY_URL!, accountId: process.env.RELAY_ACCOUNT_ID!,
  credential: process.env.RELAY_RUNTIME_CREDENTIAL!, leaseToken: process.env.RELAY_LEASE!,
  workloadId: process.env.RELAY_WORKLOAD_ID!, runtimeProduct: "codex",
});
const accepted = await relay.submitAction(canonicalActionIntent, taskLocalIdempotencyKey);
```

```python
relay = RelayV2Client(
    base_url=os.environ["RELAY_URL"], account_id=os.environ["RELAY_ACCOUNT_ID"],
    credential=os.environ["RELAY_RUNTIME_CREDENTIAL"], lease_token=os.environ["RELAY_LEASE"],
    workload_id=os.environ["RELAY_WORKLOAD_ID"], runtime_product="claude",
)
accepted = relay.submit_action(canonical_action_intent, task_local_idempotency_key)
```

Never pass a connector or provider token through the runtime. Relay exchanges vault references for narrowly scoped credentials at the enforcement point.
