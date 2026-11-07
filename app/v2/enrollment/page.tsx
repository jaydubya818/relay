import { requireUser } from "@/lib/auth";
import { operatorContext } from "@/lib/v2/dashboard";
import { V2Header, V2Notice } from "@/components/v2/ui";
import { HostedEnrollmentForm } from "@/components/v2/hosted-enrollment";

export const dynamic = "force-dynamic";
export default async function EnrollmentPage() {
  const user = await requireUser();
  await operatorContext(user.accountId, user.id);
  if (user.role !== "OWNER") return <><V2Header kicker="Owner only" title="Hosted enrollment" description="Only the account owner can enroll an installation." /></>;
  return <>
    <V2Header kicker="Owner only" title="Hosted Sofie enrollment" description="Creates or renews the Relay enrollment for one hosted installation. Requires your password." />
    <V2Notice tone="warning">The workload token and the runtime-client credential are shown once. Copy them; they are not stored or logged here.</V2Notice>
    <HostedEnrollmentForm />
  </>;
}
