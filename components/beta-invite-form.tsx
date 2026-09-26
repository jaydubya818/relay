"use client";

import { useState, type FormEvent } from "react";

export function BetaInviteForm() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setUrl("");
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch("/api/beta-invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Could not create invitation.");
      setUrl(body.url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create invitation."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <div className="field"><label htmlFor="beta-email">Tester email</label><input id="beta-email" name="email" type="email" autoComplete="off" required /></div>
    <button className="button" disabled={busy}>{busy ? "Creating…" : "Create invitation"}</button>
    {error && <div className="notice error" role="alert">{error}</div>}
    {url && <div className="notice" role="status"><strong>Invitation ready. Expires in 48 hours and can create one account for this email.</strong><div className="secret">{url}</div><button type="button" className="button secondary small" onClick={() => navigator.clipboard.writeText(url)}>Copy link</button></div>}
  </form>;
}
