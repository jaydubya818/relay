import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { LogoutButton } from "@/components/actions";
import { ThemeControl } from "@/components/owner-controls";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app-shell">
      <a className="owner-skip" href="#owner-content">Skip to content</a>
      <Sidebar />
      <main className="main" id="owner-content" tabIndex={-1}>
        <header className="topbar">
          <div className="workspace-context">Workspace <span>/</span> <strong>{user.role === "OWNER" ? "Owner" : "Member"}</strong></div>
          <div className="user-chip"><ThemeControl /><span className="avatar">{user.name.slice(0, 1)}</span><span className="user-name">{user.name}</span><LogoutButton /></div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
