import { getToken } from "@vercel/connect";
import { RelayError } from "@/lib/errors";
import { parseInput, submitHostedRequest, getHostedRequest } from "./myfactory-protocol.mjs";

export async function factoryRequest(accountId: string, operation: "create" | "read", input: unknown) {
  const value = (name: string) => { const v = process.env[name]?.trim(); if (!v) throw new RelayError("INVALID_INPUT", "MyFactory routing is not configured.", undefined, 503); return v; };
  if (accountId !== value("MYFACTORY_RELAY_ACCOUNT_ID")) throw new RelayError("CAPABILITY_DENIED", "MyFactory is not connected to this account.", undefined, 403);
  const config = { clientId: "relay", repository: value("MYFACTORY_REPOSITORY"), teamId: value("MYFACTORY_LINEAR_TEAM_ID"),
    token: value("MYFACTORY_CLIENT_TOKEN"), receiptPublicKey: value("MYFACTORY_RECEIPT_PUBLIC_KEY") };
  const graphql = async (query: string, variables: Record<string, unknown>) => {
    const token = await getToken(value("MYFACTORY_LINEAR_CONNECTOR"), { subject: { type: "app" }, scopes: ["read", "write"] });
    const response = await fetch("https://api.linear.app/graphql", { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data) throw new RelayError("INVALID_INPUT", "MyFactory provider did not confirm the request. Reconcile the same request key.", undefined, 502);
    return body.data;
  };
  const identity = await graphql("query($team:String!){viewer{organization{id}} team(id:$team){id}}", {team:config.teamId});
  if (identity.viewer.organization.id !== value("MYFACTORY_LINEAR_WORKSPACE_ID") || identity.team.id !== config.teamId) throw new RelayError("CAPABILITY_DENIED", "MyFactory provider destination mismatch.", undefined, 403);
  return operation === "create" ? submitHostedRequest(config, parseInput(input), graphql)
    : getHostedRequest(config, String((input as {requestId?: unknown})?.requestId ?? ""), graphql);
}
