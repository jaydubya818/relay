import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser, signupEnabled } from "@/lib/auth";
import { LoginForm } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await currentUser()) redirect("/");
  const params = await searchParams;
  const rawReturn = params.returnTo ?? "";
  // Accept only relative paths that are not the login page itself (same-origin guard).
  const returnTo = /^\/[^/]/.test(rawReturn) && !rawReturn.startsWith("/login") ? rawReturn : null;
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
