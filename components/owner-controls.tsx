"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CapabilityName } from "@/lib/types";

export function ThemeControl() {
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    try { const saved = localStorage.getItem("relay-theme"); if (["light", "dark", "system"].includes(saved ?? "")) setTheme(saved!); } catch { /* Storage is optional. */ }
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.ownerTheme = theme === "system" ? (media.matches ? "dark" : "light") : theme; };
    apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply);
  }, [theme]);
  return <label className="theme-control"><span className="sr-only">Appearance</span><select value={theme} onChange={(event) => { const value = event.target.value; setTheme(value); try { localStorage.setItem("relay-theme", value); } catch { /* Keep the current tab preference. */ } }}><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select></label>;
}

async function mutate(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.message === "string" ? result.message : typeof result?.error === "string" ? result.error : typeof result?.error?.message === "string" ? result.error.message : "The request could not be completed. No confirmed change was received.");
  if (!result) throw new Error("The server response could not be read. Refresh to check the current state before retrying.");
  return result;
}

export function GrantControl({ agentId, capability, allowed }: { agentId: string; capability: CapabilityName; allowed: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <div className="grant-control"><button className={`button small ${allowed ? "secondary" : ""}`} aria-label={`${allowed ? "Remove" : "Allow"} ${capability}`} disabled={busy} onClick={async () => {
    setBusy(true); setMessage("");
    try { await mutate(`/api/agents/${agentId}/capabilities/${encodeURIComponent(capability)}`, "PUT", { effect: allowed ? "DENY" : "ALLOW" }); setMessage(allowed ? "Permission removed." : "Permission granted. Execution policy still applies."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update permission."); }
    finally { setBusy(false); }
  }}>{busy ? "Saving…" : allowed ? "Remove" : "Allow"}</button><span className="subtle" role="status">{message}</span></div>;
}

export function AgentStatusControl({ agentId, disabled }: { agentId: string; disabled: boolean }) {
  const router = useRouter(); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <div className="stack"><div className="owner-actions">{!confirm ? <button className={`button ${disabled ? "secondary" : "danger"}`} onClick={() => setConfirm(true)}>{disabled ? "Enable Agent" : "Disable Agent"}</button> : <><span>{disabled ? "Allow this Agent to use its existing grants again?" : "Stop this Agent from using Relay? Its history will be retained."}</span><button className="button" disabled={busy} onClick={async () => {
    setBusy(true); setMessage(""); try { await mutate(`/api/agents/${agentId}`, "PATCH", { status: disabled ? "ACTIVE" : "DISABLED" }); setMessage(disabled ? "Agent enabled." : "Agent disabled."); setConfirm(false); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update Agent."); } finally { setBusy(false); }
  }}>{busy ? "Saving…" : "Confirm"}</button><button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></>}</div><span role="status" className="subtle">{message}</span></div>;
}

export function OwnerCreateAgent() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [created, setCreated] = useState<{ agentId: string; credential: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const data = new FormData(event.currentTarget);
    try { setCreated(await mutate("/api/agents", "POST", { name: data.get("name"), description: data.get("description"), capabilities: data.get("memory") ? ["memory.read"] : [] })); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create Agent."); } finally { setBusy(false); }
  }
  if (created) return <div className="stack"><h2>Agent created</h2><p>Copy this new credential now. Relay will not show it again. Keep it in your Agent’s secret storage.</p><pre className="secret">{created.credential}</pre><div className="owner-actions"><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(created.credential); setMessage("Credential copied."); } catch { setMessage("Clipboard unavailable. Select and copy the credential above."); } }}>Copy credential</button><a className="button" href={`/agents/${created.agentId}`}>Configure Agent</a></div><p role="status">{message}</p></div>;
  return <form className="stack" onSubmit={submit}><div className="field"><label htmlFor="owner-agent-name">Agent name</label><input id="owner-agent-name" name="name" required minLength={2} maxLength={80} placeholder="e.g. Research assistant" /></div><div className="field"><label htmlFor="owner-agent-purpose">Purpose</label><textarea id="owner-agent-purpose" name="description" maxLength={280} placeholder="What will this Agent help you do?" /></div><label className="check-row"><input type="checkbox" name="memory" /> Allow reading shared memory</label><p className="subtle">No capabilities are granted by default. You can add individual permissions after creation.</p><button className="button" disabled={busy}>{busy ? "Creating…" : "Create Agent"}</button><p role="status" className="subtle">{message}</p></form>;
}
