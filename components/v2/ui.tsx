import type { ReactNode } from "react";

export function V2Header({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <header className="v2-page-head"><div><div className="v2-kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function V2Status({ value }: { value: string }) { const danger = ["FAILED", "DENIED", "REVOKED", "DEAD_LETTERED", "EFFECT_UNKNOWN", "UNKNOWN", "ERROR", "HIGH", "CRITICAL"].includes(value); const waiting = ["PENDING", "PENDING_APPROVAL", "WAITING_APPROVAL", "PAUSED", "STALE", "QUARANTINED", "RECONCILIATION_REQUIRED"].includes(value); return <span className={`v2-status ${danger ? "danger" : waiting ? "waiting" : ""}`}><i />{value.replaceAll("_", " ")}</span>; }
export function V2Empty({ title, detail }: { title: string; detail: string }) { return <div className="v2-empty"><strong>{title}</strong><span>{detail}</span></div>; }
export function V2Time({ value }: { value?: string | null }) { return <time dateTime={value ?? undefined}>{value ? new Date(value).toLocaleString() : "Never"}</time>; }
export function V2Notice({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "danger"; children: ReactNode }) { return <div className={`v2-notice ${tone}`}>{children}</div>; }
