"use client";
import { useRef, useState } from "react";
import type { HostedResult } from "@/lib/myfactory-protocol.mjs";

/** Returns true when the URL resolves only on the owner's local machine. */
function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch { return false; }
}

export function FactoryForm({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<HostedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A fresh idempotency key is generated for each new create submission so that
  // a corrected resubmit after a failure is treated as a distinct request.
  const pendingKeyRef = useRef<string | null>(null);

  async function request(operation: "create" | "read", input: unknown) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v2/operator/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, input }),
      });
      let body: Record<string, unknown> = {};
      try { body = await response.json(); } catch { /* non-JSON body — fall through to error message */ }
      if (!response.ok) throw new Error(String(body.message ?? body.error ?? "The request could not be confirmed."));
      setResult(body as unknown as HostedResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Generate a fresh idempotency key for this submission attempt so that
    // editing the form after a failure produces a new, distinct request.
    const key = crypto.randomUUID();
    pendingKeyRef.current = key;
    const data = new FormData(event.currentTarget);
    void request("create", {
      idempotencyKey: key,
      title: data.get("title"),
      description: data.get("description"),
      kind: "feature",
      acceptanceCriteria: String(data.get("criteria")).split("\n").filter(Boolean),
      allowedPaths: String(data.get("paths")).split("\n").filter(Boolean),
    });
  }

  return (
    <section className="card">
      {!configured && <p className="notice">MyFactory routing is not configured for this account yet.</p>}
      <form onSubmit={handleCreate}>
        <label>Title<input name="title" required maxLength={200} /></label>
        <label>Description<textarea name="description" required maxLength={12000} /></label>
        <label>Acceptance criteria<textarea name="criteria" required placeholder="One criterion per line" /></label>
        <label>Permitted repository paths<textarea name="paths" required placeholder="docs/" /></label>
        <button className="button primary" disabled={!configured || busy}>{busy ? "Checking…" : "Send to MyFactory"}</button>
      </form>
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && (
        <div className="section-gap" role="status">
          <h2>{result.receipt ? "Received by local factory" : "Waiting for the local factory"}</h2>
          <p><a href={result.issueUrl} target="_blank" rel="noreferrer">{result.issueIdentifier} in Linear ↗</a></p>
          {result.receipt ? (
            <p>
              WorkOrder{" "}
              {isLocalhostUrl(result.receipt.workOrderUrl)
                ? <span title="Link resolves only on the factory Mac">{result.receipt.workOrderId} (local Mac only)</span>
                : <a href={result.receipt.workOrderUrl}>{result.receipt.workOrderId}</a>}
              {" "}· {result.receipt.state}. Execution and review continue in MyFactory.
            </p>
          ) : (
            <p>The signed request is saved. The Mac will receive it when MyFactory is online.</p>
          )}
          <div className="inline">
            <button className="button" disabled={busy} onClick={() => void request("read", { requestId: result.requestId })}>
              Check factory receipt
            </button>
            <button className="button secondary" onClick={() => { setResult(null); setError(null); }}>
              Send another request
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
