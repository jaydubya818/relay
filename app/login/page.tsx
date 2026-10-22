import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser, signupEnabled } from "@/lib/auth";
import { LoginForm } from "@/components/actions";
import { safeReturnTo } from "@/lib/url-safety";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await currentUser()) redirect("/");
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">R</div>
        <h1>Welcome to Relay</h1>
        <p className="subtle">Sign in to manage the shared capability plane for your AI agents.</p>
        <LoginForm returnTo={returnTo} />
        {signupEnabled() && <p className="subtle">New to Relay? <Link href="/signup">Create an account</Link></p>}
      </section>
    </main>
  );
}
