"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { CapabilityName } from "@/lib/types";

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? body.error ?? body.message ?? "Request failed.");
  return body;
}

export function LogoutButton() {
  const router = useRouter();
  return <button className="button secondary small" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>Sign out</button>;
}

export function LoginForm({ defaultEmail }: { defaultEmail: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await requestJson("/api/auth/login", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
      router.push("/"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={defaultEmail} autoComplete="email" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {error && <div className="notice error">{error}</div>}
      <button className="button" disabled={busy}>{busy ? "Signing in…" : "Sign in to Relay"}</button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      await requestJson("/api/auth/signup", { method: "POST", body: JSON.stringify({
        accountName: data.get("accountName"), name: data.get("name"), email: data.get("email"), password: data.get("password"),
      }) });
      router.push("/"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Account creation failed."); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="account-name">Account name</label><input id="account-name" name="accountName" minLength={2} maxLength={100} autoComplete="organization" required /></div>
      <div className="field"><label htmlFor="signup-name">Your name</label><input id="signup-name" name="name" minLength={2} maxLength={100} autoComplete="name" required /></div>
      <div className="field"><label htmlFor="signup-email">Email</label><input id="signup-email" name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label htmlFor="signup-password">Password</label><input id="signup-password" name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /><span className="subtle">At least 12 characters.</span></div>
      {error && <div className="notice error">{error}</div>}
      <button className="button" disabled={busy}>{busy ? "Creating account…" : "Create Relay account"}</button>
    </form>
  );
}

export function AgentCreateForm() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSecret("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const result = await requestJson("/api/agents", { method: "POST", body: JSON.stringify({
        name: data.get("name"),
        description: data.get("description"),
        capabilities: ["memory.read", "memory.write"],
      }) });
      setSecret(result.credential); form.reset(); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent creation failed."); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2>Create agent</h2>
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="agent-name">Name</label><input id="agent-name" name="name" placeholder="Research Agent" minLength={2} required /></div>
        <div className="field"><label>Capability profile</label><select disabled defaultValue="memory"><option value="memory">Memory read / write</option></select></div>
        <div className="field full"><label htmlFor="agent-description">Description</label><textarea id="agent-description" name="description" placeholder="What this agent is trusted to do" /></div>
        <div className="field full"><button className="button" disabled={busy}>{busy ? "Creating…" : "Create agent"}</button></div>
      </form>
      {error && <div className="notice error">{error}</div>}
      {secret && <div className="notice"><strong>Agent created.</strong> Copy this credential now. It will not be shown again.<div className="secret">{secret}</div><button className="button secondary small" onClick={() => navigator.clipboard.writeText(secret)}>Copy credential</button></div>}
    </div>
  );
}

export function CapabilityToggle({ agentId, capability, allowed }: { agentId: string; capability: CapabilityName; allowed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button aria-label={`${allowed ? "Disable" : "Enable"} ${capability}`} className={`toggle ${allowed ? "on" : ""}`} disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      await requestJson(`/api/agents/${agentId}/capabilities/${encodeURIComponent(capability)}`, { method: "PUT", body: JSON.stringify({ effect: allowed ? "DENY" : "ALLOW" }) });
      router.refresh();
    } finally { setBusy(false); }
  }}><span /></button>;
}

export function AgentCredentialActions({ agentId, disabled }: { agentId: string; disabled: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function rotate() {
    setBusy(true); setMessage("");
    try {
      const result = await requestJson(`/api/agents/${agentId}/credentials`, { method: "POST" });
      setSecret(result.credential); setMessage("Previous active credentials were revoked.");
      router.refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Rotation failed."); } finally { setBusy(false); }
  }
  async function toggleStatus() {
    setBusy(true);
    try {
      await requestJson(`/api/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ status: disabled ? "ACTIVE" : "DISABLED" }) });
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div className="inline"><button className="button" disabled={busy || disabled} onClick={rotate}>Rotate credential</button><button className={`button ${disabled ? "secondary" : "danger"}`} disabled={busy} onClick={toggleStatus}>{disabled ? "Enable agent" : "Disable agent"}</button></div>
      {message && <div className="notice">{message}{secret && <><div className="secret">{secret}</div><button className="button secondary small" onClick={() => navigator.clipboard.writeText(secret)}>Copy credential</button></>}</div>}
    </div>
  );
}

export function RevokeCredentialButton({ agentId, credentialId }: { agentId: string; credentialId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="button danger small" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await requestJson(`/api/agents/${agentId}/credentials`, { method: "DELETE", body: JSON.stringify({ credentialId }) }); router.refresh(); } finally { setBusy(false); }
  }}>Revoke</button>;
}

export function ForgetMemoryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="button danger small" disabled={busy} onClick={async () => {
    setBusy(true);
    try { await requestJson(`/api/memories/${id}`, { method: "DELETE" }); router.refresh(); } finally { setBusy(false); }
  }}>{busy ? "Forgetting…" : "Forget"}</button>;
}

export function GitHubConnectionManager({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget;
    const token = new FormData(form).get("token");
    try {
      const result = await requestJson("/api/connections/github", { method: "PUT", body: JSON.stringify({ token }) });
      setMessage(`Connected as ${result.displayName}.`); form.reset(); router.refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Connection failed."); } finally { setBusy(false); }
  }
  async function action(method: "POST" | "DELETE") {
    setBusy(true); setMessage("");
    try {
      const result = await requestJson("/api/connections/github", { method });
      setMessage(method === "POST" ? (result.ok ? "GitHub connection is healthy." : result.message) : "GitHub disconnected.");
      router.refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Request failed."); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <form className="form-grid" onSubmit={connect}>
        <div className="field full"><label htmlFor="github-token">GitHub personal access token</label><input id="github-token" name="token" type="password" minLength={20} placeholder={connected ? "Enter a new token to reconnect" : "github_pat_…"} required /></div>
        <div className="field full"><div className="inline"><button className="button" disabled={busy}>{connected ? "Reconnect" : "Connect GitHub"}</button>{connected && <><button type="button" className="button secondary" onClick={() => action("POST")}>Test connection</button><button type="button" className="button danger" onClick={() => action("DELETE")}>Disconnect</button></>}</div></div>
      </form>
      {message && <div className={`notice ${message.includes("failed") ? "error" : ""}`}>{message}</div>}
      <p className="subtle">Relay validates this token with GitHub, encrypts it at rest, and never returns it through the dashboard API.</p>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="button secondary small" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied" : "Copy"}</button>;
}

export function McpConnectionTest() {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setResult("");
    const credential = String(new FormData(event.currentTarget).get("credential") ?? "");
    try {
      const response = await fetch("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error?.data?.message ?? "Relay connection failed.");
      const tools = body.result.tools.map((tool: { name: string }) => tool.name);
      setResult(`Relay connection successful. Projected tools: ${tools.join(", ") || "none"}`);
    } catch (reason) {
      setResult(reason instanceof Error ? reason.message : "Relay connection failed.");
    } finally { setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="field"><label htmlFor="test-credential">Relay agent credential</label><input id="test-credential" name="credential" type="password" placeholder="rly_…" required /></div>
      <button className="button" disabled={busy}>{busy ? "Testing…" : "Test connection"}</button>
      {result && <div className={`notice ${result.includes("failed") || result.includes("invalid") ? "error" : ""}`}>{result}</div>}
    </form>
  );
}
