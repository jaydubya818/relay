"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { OwnerIcon } from "@/components/owner-icons";
import { ownerNavigation, advancedNavigation } from "@/lib/owner-presentation";

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const advanced = pathname.includes("/advanced") || advancedNavigation.some(([, href]) => pathname === href || pathname.startsWith(`${href}/`));
  return <aside className={`sidebar ${open ? "mobile-open" : ""}`}>
    <div className="sidebar-brand"><Link className="brand" href="/" aria-label="Relay home"><span className="brand-mark" aria-hidden="true">r</span><span>relay<span className="brand-caption">Agent workspace</span></span></Link><button className="mobile-nav-button" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(!open)}>{open ? "Close menu" : "Menu"}</button></div>
    <div id="workspace-navigation" className="workspace-navigation"><div className="nav-label">WORKSPACE</div><nav aria-label="Primary navigation"><div className="nav-group">{ownerNavigation.map(([label, href]) => {
      const current = !advanced && (pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)));
      return <Link className="nav-link" href={href} key={href} onClick={() => setOpen(false)} aria-current={current ? "page" : undefined}><OwnerIcon name={label} />{label}</Link>;
    })}</div></nav>
    <nav className="advanced-nav" aria-label="Advanced navigation"><Link className="nav-link" href="/advanced" onClick={() => setOpen(false)} aria-current={advanced ? "page" : undefined}><OwnerIcon name="Advanced" /><span>Advanced<span className="nav-caption">Developer tools</span></span></Link></nav></div>
    <div className="sidebar-foot"><span className="workspace-seal">R</span><div>Your Relay workspace<small>Identity. Access. Visibility.</small></div></div>
  </aside>;
}
