"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ownerNavigation, advancedNavigation } from "@/lib/owner-presentation";

export function Sidebar() {
  const pathname = usePathname();
  const advanced = pathname.includes("/advanced") || advancedNavigation.some(([, href]) => pathname === href || pathname.startsWith(`${href}/`));
  return <aside className="sidebar">
    <Link className="brand" href="/" aria-label="Relay home"><span className="brand-mark" aria-hidden="true">R</span><span>RELAY</span></Link>
    <nav aria-label="Primary navigation"><div className="nav-group">{ownerNavigation.map(([label, href]) => {
      const current = !advanced && (pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)));
      return <Link className="nav-link" href={href} key={href} aria-current={current ? "page" : undefined}>{label}</Link>;
    })}</div></nav>
    <nav className="advanced-nav" aria-label="Advanced navigation"><Link className="nav-link" href="/advanced" aria-current={advanced ? "page" : undefined}>Advanced / Developer tools</Link></nav>
    <div className="sidebar-foot">Your agents and connections.</div>
  </aside>;
}
