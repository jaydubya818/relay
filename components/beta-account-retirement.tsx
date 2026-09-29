"use client";

import { useState } from "react";
import type { BetaRetirementPlan } from "@/lib/beta-account-retirement";

export function BetaAccountRetirement({ accountId }: { accountId: string }) {
  const [plan, setPlan] = useState<BetaRetirementPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retired, setRetired] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function review() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/retire", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Could not prepare the retirement plan.");
      setPlan(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare the retirement plan."); }
    finally { setBusy(false); }
  }
  async function retire() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/retire", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, confirmation }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Retirement could not be completed.");
      setRetired(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retirement could not be completed."); }
    finally { setBusy(false); }
  }
  if (retired) return <p role="status">This beta account is retired. All sessions and agent credentials are revoked.</p>;
  return <div>
    <h2>Retire disposable beta account</h2>
    <p className="subtle">This removes future access and private disposable memory. Signed receipts and minimum provenance remain. Historical information already delivered to a peer cannot be recalled. This account cannot be reactivated.</p>
    <button className="button secondary" disabled={busy} onClick={() => void review()}>Review retirement</button>
    {plan && <div className="stack" role="region" aria-label="Retirement plan">
      <p>Agents: {plan.agents} · Active sessions: {plan.activeSessions} · Active credentials: {plan.activeCredentials} · Active grants: {plan.activeGrants} · Pending invites: {plan.pendingInvites} · Relationships: {plan.relationships}</p>
      <p>Queued deliveries: {plan.queuedDeliveries} · Published Knowledge: {plan.publishedKnowledge} · Historical receipts: {plan.historicalReceipts} · Private data objects: {plan.privateDataObjects}</p>
      {plan.unsupportedResources ? <p role="alert">{plan.unsupportedResources} external resources or active tasks must be cleared by the operator before retirement.</p> : <>
        <label htmlFor="retire-confirmation">Type RETIRE to confirm permanent account retirement.</label>
        <input id="retire-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        <button className="button" disabled={busy || confirmation !== "RETIRE"} onClick={() => void retire()}>Retire this beta account</button>
      </>}
    </div>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </div>;
}
