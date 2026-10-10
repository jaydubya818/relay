"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { integrationOwner } from "@/lib/integrations/owner";
import { IntegrationConnectionStore, ownerIntegrationConnections } from "@/lib/integrations/persistence";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";

export async function revokeIntegration(_previous: { message: string; ok: boolean }, form: FormData) {
  try {
    if (process.env.RELAY_INTEGRATIONS_PREVIEW !== "true") throw new Error();
    const requestHeaders = await headers();
    const expected = new URL(process.env.NEXT_PUBLIC_RELAY_URL ?? "").origin;
    if (requestHeaders.get("origin") !== expected) throw new Error();
    const owner = await integrationOwner();
    const connectionId = z.string().min(1).max(255).parse(form.get("connectionId"));
    // Resolve every identity on the server, never from hidden owner/agent fields.
    const records = await ownerIntegrationConnections(owner.accountId, owner.ownerPrincipalId);
    const record = records.find(value => value.id === connectionId);
    if (!record) throw new Error();
    const scope = { ...owner, agentId: record.agentId, installationId: record.installationId };
    await new IntegrationConnectionStore(requireV2PlatformBindings().signer).revokeLocal(scope, connectionId);
    revalidatePath("/connections/integrations");
    return { ok: true, message: "Relay access revoked. Provider revocation is pending; no provider request was sent." };
  } catch {
    return { ok: false, message: "Revocation could not be confirmed. Refresh and try again, or contact your administrator. No provider request was sent." };
  }
}
