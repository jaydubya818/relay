import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/actions";
import { currentUser, lookupBetaInvite, signupEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  if (await currentUser()) redirect("/");
  const token = (await searchParams).invite ?? "";
  const invite = token ? await lookupBetaInvite(token) : null;
  if (!signupEnabled() && !token) redirect("/login");
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">R</div>
        <h1>Create a Relay account</h1>
        <p className="subtle">{invite ? "Your beta invitation is valid. Create your own isolated Relay account with the email address that received this link." : "Start an isolated capability plane for your team and agents."}</p>
        {token && !invite ? <div className="notice error">This invitation is invalid or expired. Ask for a new link.</div> : <RegisterForm inviteToken={token || undefined} />}
        <p className="subtle">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
