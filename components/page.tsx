import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

export function Status({ value }: { value: string }) {
  const variant = ["DENIED", "FAILED", "DISABLED", "ERROR", "REVOKED"].includes(value) ? "denied" : ["NOT_CONNECTED", "DISCONNECTED"].includes(value) ? "pending" : "";
  return <span className={`status ${variant.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>;
}

export function RelativeTime({ value }: { value?: string | null }) {
  if (!value) return <>Never</>;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return <>{seconds}s ago</>;
  if (seconds < 3600) return <>{Math.floor(seconds / 60)}m ago</>;
  if (seconds < 86400) return <>{Math.floor(seconds / 3600)}h ago</>;
  return <>{new Date(value).toLocaleDateString()}</>;
}
