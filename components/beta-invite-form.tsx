"use client";

import { useEffect, useState, type FormEvent } from "react";

type Invitation = {
  id: string;
  email: string;
  expiresAt: string;
  status: "PENDING" | "REVOKED" | "ACCEPTED" | "EXPIRED";
  revokedAt: string | null;
  revokedByUserId: string | null;
};

export function BetaInviteForm() {
  const [url, setUrl] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/beta-invites", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? body.error ?? "Could not load invitations.");
    setInvitations(body.invitations);
  }
  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load invitations.")); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setUrl("");
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch("/api/beta-invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Could not create invitation.");
      setUrl(body.url);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create invitation."); }
    finally { setBusy(false); }
  }

  async function revoke(invitationId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/beta-invites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Could not revoke invitation.");
      setUrl("");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke invitation."); }
    finally { setBusy(false); }
  }

  return <div>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="beta-email">Tester email</label><input id="beta-email" name="email" type="email" autoComplete="off" required /></div>
      <button className="button" disabled={busy}>{busy ? "Working…" : "Create invitation"}</button>
      {error && <div className="notice error" role="alert">{error}</div>}
      {url && <div className="notice" role="status"><strong>Invitation ready. Expires in seven days and can be used once.</strong><div className="secret">{url}</div><button type="button" className="button secondary small" onClick={() => navigator.clipboard.writeText(url)}>Copy link</button></div>}
    </form>
    <h3>Invitations</h3>
    {invitations.length === 0 ? <p className="subtle">No invitations yet.</p> : <ul className="stack">
      {invitations.map((invite) => <li key={invite.id} className="card">
        <strong>{invite.email}</strong> · {invite.status === "PENDING" ? "Pending" : invite.status === "REVOKED" ? "Revoked" : invite.status === "ACCEPTED" ? "Accepted" : "Expired"}
        <div className="subtle">Expires {new Date(invite.expiresAt).toLocaleString()}</div>
        {invite.status === "REVOKED" && <div className="subtle">Revoked at {new Date(invite.revokedAt!).toLocaleString()} by {invite.revokedByUserId}</div>}
        {invite.status === "PENDING" && <button type="button" className="button secondary small" disabled={busy} onClick={() => void revoke(invite.id)}>Revoke</button>}
      </li>)}
    </ul>}
  </div>;
}
