import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { operatorContext } from "@/lib/v2/dashboard";
import { V2Sidebar } from "@/components/v2/sidebar";
import { LogoutButton } from "@/components/actions";

export const dynamic = "force-dynamic";
export default async function V2Layout({ children }: { children: ReactNode }) {
  const user = await requireUser(); const operator = await operatorContext(user.accountId, user.id);
  return <div className="v2-shell"><a className="v2-skip" href="#v2-content">Skip to content</a><V2Sidebar /><main id="v2-content" className="v2-main" tabIndex={-1}><div className="v2-topbar"><div><span className="v2-live" />CONTROL PLANE ONLINE</div><div className="v2-operator"><span>{operator.role}</span><strong>{operator.displayName}</strong><Link href="/v2/settings">Settings</Link><LogoutButton /></div></div><div className="v2-content">{children}</div></main></div>;
}
