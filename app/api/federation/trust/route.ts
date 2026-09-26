import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";
import { purposeSigner } from "@/lib/v2/evidence/signing-provider";

export async function GET() {
  if (process.env.RELAY_FEDERATION_ENABLED !== "true")
    return Response.json({ error: "Federation is unavailable." }, { status: 503 });
  try {
    const bindings = requireV2PlatformBindings();
    if (!bindings.federation) throw new Error("Federation bindings unavailable.");
    const signer = purposeSigner(bindings.signer, "federation-delivery");
    const publicKey = await signer.publicKeyPem();
    return Response.json({
      origin: bindings.federation.issuer,
      keyId: signer.keyId,
      keyVersion: signer.keyVersion ?? signer.keyId,
      publicKey,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Federation trust material is unavailable." }, { status: 503 });
  }
}
