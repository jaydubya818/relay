"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["01", "Command", "/v2"], ["02", "Tasks", "/v2/tasks"], ["03", "Approvals", "/v2/approvals"],
  ["04", "Agents", "/v2/agents"], ["05", "Computers", "/v2/computers"], ["06", "Connections", "/v2/connections"],
  ["07", "Governance", "/v2/governance"], ["08", "Infrastructure", "/v2/infrastructure"], ["09", "Activity", "/v2/activity"],
  ["10", "Settings", "/v2/settings"],
];

export function V2Sidebar() {
  const pathname = usePathname();
  return <aside className="v2-sidebar" aria-label="Relay V2 navigation"><Link href="/v2" className="v2-brand"><span>R</span><strong>RELAY</strong><small>V2 CONTROL</small></Link><nav aria-label="Relay V2">{links.map(([number, label, href]) => <Link href={href} key={href} aria-current={pathname === href ? "page" : undefined}><span>{number}</span>{label}</Link>)}</nav><div className="v2-sidebar-foot"><i /> Authoritative plane<br /><small>Provider-neutral execution</small></div></aside>;
}
