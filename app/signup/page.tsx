import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/actions";
import { currentUser, signupEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  if (!signupEnabled()) redirect("/login");
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">R</div>
        <h1>Create a Relay account</h1>
        <p className="subtle">Start an isolated capability plane for your team and agents.</p>
        <RegisterForm />
        <p className="subtle">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
