"use client";
import { useActionState } from "react";
import { revokeIntegration } from "@/app/(dashboard)/connections/integrations/actions";

export function IntegrationRevoke({ connectionId }: { connectionId: string }) {
  const [state, action, pending] = useActionState(revokeIntegration, { message: "", ok: false });
  return <form action={action}>
    <input type="hidden" name="connectionId" value={connectionId} />
    <p className="subtle">Revoking blocks this connection in Relay immediately. Provider access must also be revoked before disconnect is complete.</p>
    <button className="button secondary" disabled={pending}>{pending ? "Revoking access…" : "Revoke Relay access"}</button>
    {state.message && <p className={state.ok ? "notice" : "notice error"} role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </form>;
}
