"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RegisterForm } from "@/components/actions";

type Invite = { token: string; email: string };

export function BetaSignup({ publicSignupEnabled }: { publicSignupEnabled: boolean }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const tokenRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (tokenRef.current === undefined) tokenRef.current = new URLSearchParams(window.location.hash.slice(1)).get("invite") ?? "";
    const token = tokenRef.current;
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setChecking(false);
      return;
    }
    const controller = new AbortController();
    fetch("/api/beta-invites/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Invitation unavailable.");
      const result = await response.json() as { email: string };
      setInvite({ token, email: result.email });
    }).catch(() => {
      if (!controller.signal.aborted) setInvalid(true);
    }).finally(() => {
      if (!controller.signal.aborted) setChecking(false);
    });
    return () => controller.abort();
  }, []);

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">R</div>
        <h1>Create a Relay account</h1>
        {checking ? <p className="subtle">Checking your invitation…</p> : invite ? <>
          <p className="subtle">Invitation for {invite.email}. Create your own isolated Relay account.</p>
          <RegisterForm inviteToken={invite.token} invitedEmail={invite.email} />
        </> : invalid ? <div className="notice error">This invitation is invalid, expired, or already used. Ask for a new link.</div>
          : publicSignupEnabled ? <>
            <p className="subtle">Start an isolated capability plane for your team and agents.</p>
            <RegisterForm />
          </> : <div className="notice">A beta invitation is required to create an account.</div>}
        <p className="subtle">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
