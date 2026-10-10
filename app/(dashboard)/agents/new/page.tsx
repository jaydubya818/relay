export const metadata = { title: "Create Agent" };
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page";
import { OwnerCreateAgent } from "@/components/owner-controls";
export default async function CreateAgentPage() {
  await requireUser();
  return <><PageHeader eyebrow="AGENTS" title="Create Agent" description="Start with a named identity. Add only the permissions this Agent needs." action={<Link className="text-link" href="/agents">Back to Agents</Link>} /><section className="card create-agent"><OwnerCreateAgent /></section></>;
}
