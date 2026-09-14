"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

async function mutate(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "Relay could not complete the operation.");
  return result;
}

export function ConfirmOperatorAction({ path, body, label, confirmLabel, danger = false }: { path: string; body: Record<string, unknown>; label: string; confirmLabel: string; danger?: boolean }) {
  const router = useRouter(); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  if (!confirming) return <button className={`v2-button ${danger ? "danger" : "secondary"}`} onClick={() => setConfirming(true)}>{label}</button>;
  return <div className="v2-confirm" role="group" aria-label={`${label} confirmation`}><span>{confirmLabel}</span><button className={`v2-button ${danger ? "danger-solid" : ""}`} disabled={busy} onClick={async () => { setBusy(true); setMessage(""); try { await mutate(path, body); setConfirming(false); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(false); } }}>{busy ? "Working…" : "Confirm"}</button><button className="v2-button secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>{message && <small className="v2-action-error" role="alert">{message}</small>}</div>;
}

export function ApprovalDecisionForm({ requestId, allowedScopes }: { requestId: string; allowedScopes: string[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setMessage(""); const data = new FormData(event.currentTarget); try { await mutate("/api/v2/operator/approvals", { requestId, decision: data.get("decision"), scopeKind: data.get("scopeKind"), password: data.get("password"), reason: data.get("reason") }); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Decision failed."); } finally { setBusy(false); } }
  return <form className="v2-approval-form" onSubmit={submit}><label>Scope<select name="scopeKind" defaultValue="once">{allowedScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></label><label className="grow">Reason <span>(optional)</span><input name="reason" maxLength={500} /></label><label>Password confirmation<input name="password" type="password" autoComplete="current-password" required /></label><div className="v2-decision-buttons"><button className="v2-button" name="decision" value="APPROVE" disabled={busy}>Approve</button><button className="v2-button danger" name="decision" value="DENY" disabled={busy}>Deny</button></div>{message && <div className="v2-action-error" role="alert">{message}</div>}</form>;
}
