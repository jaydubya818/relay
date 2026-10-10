-- Explicit additive qualification migration. Never automatically applied at startup.
-- No new credential store or authorization tables; frozen canonical schema is unchanged.
CREATE TABLE integration_connections (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  owner_principal_id text NOT NULL REFERENCES principals(id),
  agent_id text NOT NULL REFERENCES agents(id),
  installation_id text NOT NULL,
  connected_account_id text NOT NULL,
  binding jsonb NOT NULL,
  provider_revocation text NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (provider_revocation IN ('NOT_REQUESTED','PENDING','CONFIRMED')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, owner_principal_id) REFERENCES account_memberships(account_id, principal_id),
  CHECK (binding->>'connectionId' = id AND binding->>'accountId' = account_id
    AND binding->>'ownerPrincipalId' = owner_principal_id AND binding->>'agentId' = agent_id
    AND binding->>'installationId' = installation_id AND binding->>'connectedAccountId' = connected_account_id)
);
CREATE UNIQUE INDEX integration_provider_identity ON integration_connections(connected_account_id);
CREATE TABLE integration_receipts (
  account_id text NOT NULL REFERENCES accounts(id), key text NOT NULL,
  request_hash text NOT NULL, result jsonb NOT NULL
);
CREATE UNIQUE INDEX integration_receipt_identity ON integration_receipts(account_id, key);
