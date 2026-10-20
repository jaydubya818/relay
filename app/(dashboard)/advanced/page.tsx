export const metadata = { title: "Developer tools" };
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page";
import { advancedNavigation } from "@/lib/owner-presentation";

export default async function AdvancedPage() {
  const user = await requireUser();
  return <>
    <PageHeader eyebrow="Advanced" title="Developer tools" description="Integration, administration and diagnostics. Your existing account permissions apply to every operation." />
    <p className="notice">Signed in as {user.role === "OWNER" ? "an account owner" : "an account member"}. These tools do not grant additional access or enable disabled services.</p>
    <section className="grid cards">{advancedNavigation.map(([label, href, description]) => <Link className="card agent-card" href={href} key={href}><h2>{label} →</h2><p className="subtle">{description}</p></Link>)}</section>
  </>;
}
