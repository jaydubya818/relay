import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">R</div>
        <h1>Welcome to Relay</h1>
        <p className="subtle">Sign in to manage the shared capability plane for your AI agents.</p>
        <LoginForm defaultEmail={process.env.RELAY_ADMIN_EMAIL ?? "admin@relay.local"} />
      </section>
    </main>
  );
}
