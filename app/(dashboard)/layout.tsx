import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { LogoutButton } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <header className="topbar">
          <div className="eyebrow">Capability plane / live</div>
          <div className="user-chip"><span className="avatar">{user.name.slice(0, 1)}</span><span>{user.name}</span><LogoutButton /></div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
