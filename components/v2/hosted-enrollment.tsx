"use client";
import { useState } from "react";

type Result = Record<string, unknown> & { workloadToken?: string; runtimeClientCredential?: string | null };
const SECRET_KEYS = new Set(["workloadToken", "runtimeClientCredential"]);

/** Owner enrollment form. The password is typed by the owner; secrets are shown once in read-only fields (copy only) and never logged. */
export function HostedEnrollmentForm() {
  const [installationId, setInstallationId] = useState("jay");
  const [permitKey, setPermitKey] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setResult(null);
    try {
      let permitPublicKey: unknown;
      try { permitPublicKey = JSON.parse(permitKey); } catch { setError("Permit public key must be JSON: { keyId, jwk }."); return; }
      const response = await fetch("/api/v2/operator/hosted-enrollment", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId, permitPublicKey, password }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(`${response.status} ${body.code ?? "ERROR"}${body.message ? `: ${body.message}` : ""}`); return; }
      setResult(body);
    } finally { setPassword(""); setBusy(false); }
  }
  const copy = (value: string) => { void navigator.clipboard.writeText(value); };
  return <div className="v2-panel">
    <form onSubmit={submit} className="v2-form">
      <label>Installation id<input name="installationId" value={installationId} onChange={e => setInstallationId(e.target.value)} required /></label>
      <label>Permit public key (JSON)<textarea name="permitPublicKey" value={permitKey} onChange={e => setPermitKey(e.target.value)} rows={5} required /></label>
      <label>Confirm with your password<input name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? "Enrolling…" : "Enroll installation"}</button>
    </form>
    {error && <p role="alert" className="v2-notice danger">{error}</p>}
    {result && <dl className="v2-result">
      {Object.entries(result).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, v]) =>
        <div key={k}><dt>{k}</dt><dd><code>{typeof v === "string" ? v : JSON.stringify(v)}</code></dd></div>)}
      {[...SECRET_KEYS].map(k => typeof result[k] === "string" ? <div key={k}><dt>{k} (shown once)</dt><dd>
        <input readOnly type="password" value={result[k] as string} aria-label={k} />
        <button type="button" onClick={() => copy(result[k] as string)}>Copy</button></dd></div> : null)}
    </dl>}
  </div>;
}
