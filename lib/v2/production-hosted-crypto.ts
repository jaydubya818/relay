import { headers } from "next/headers";
import { GoogleKmsEd25519Provider } from "./evidence/google-kms";
import { GoogleKmsKeyWrapper, type WrappingVersion } from "./evidence/google-wrapper";
import { vercelStsTokenSource, type VercelWorkloadIdentity } from "./evidence/google-sts";
import { SigningKeyring, type SigningKey } from "./evidence/signing-provider";

const RELAY_PRODUCTION_IDENTITY = Object.freeze({
  issuer: "https://oidc.vercel.com/jaydubya818",
  audience: "https://vercel.com/jaydubya818",
  ownerId: "team_p8z8exJRTGfOPk1GC9vUOpv3",
  projectId: "prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK",
  environment: "production",
  subject: "owner:jaydubya818:project:relay:environment:production",
});

/** Production KMS composition. Configuration contains public resource names
 * and public verification keys only; assertions are obtained per request. */
export function productionHostedCrypto(
  environment: Record<string, string | undefined>,
  assertion = async () => {
    const value = (await headers()).get("x-vercel-oidc-token");
    if (!value) throw new Error("Missing request workload identity.");
    return value;
  },
  request: typeof fetch = fetch,
) {
  try {
    if (environment.NODE_ENV !== "production" || environment.VERCEL !== "1" || environment.VERCEL_TARGET_ENV !== "production" ||
        environment.RELAY_CRYPTO_BACKEND !== "kms") throw new Error();

    const identity = JSON.parse(environment.RELAY_PRODUCTION_IDENTITY_JSON ?? "") as VercelWorkloadIdentity;
    if (identity.issuer !== RELAY_PRODUCTION_IDENTITY.issuer || identity.audience !== RELAY_PRODUCTION_IDENTITY.audience ||
        identity.ownerId !== RELAY_PRODUCTION_IDENTITY.ownerId || identity.projectId !== RELAY_PRODUCTION_IDENTITY.projectId ||
        identity.environment !== RELAY_PRODUCTION_IDENTITY.environment || identity.subject !== RELAY_PRODUCTION_IDENTITY.subject ||
        identity.customEnvironmentId !== undefined) throw new Error();

    const kmsProjectId = environment.RELAY_PRODUCTION_KMS_PROJECT_ID ?? "";
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(kmsProjectId)) throw new Error();
    const keys = JSON.parse(environment.RELAY_PRODUCTION_SIGNING_KEYS_JSON ?? "") as SigningKey[];
    const versions = JSON.parse(environment.RELAY_PRODUCTION_WRAPPING_VERSIONS_JSON ?? "") as WrappingVersion[];
    if (!Array.isArray(keys) || keys.some((key) => !key.keyVersion.startsWith(`projects/${kmsProjectId}/`)) ||
        !Array.isArray(versions) || versions.some((version) => !version.version.startsWith(`projects/${kmsProjectId}/`))) throw new Error();

    const token = vercelStsTokenSource(identity, assertion, request);
    const provider = new GoogleKmsEd25519Provider(new Set(keys.map((key) => key.keyVersion)), token, request);
    return {
      keyring: new SigningKeyring(keys, provider),
      keyWrapper: new GoogleKmsKeyWrapper("relay-production-owner-envelope", versions, token, request),
    };
  } catch {
    throw new Error("Relay production KMS configuration is unavailable or invalid.");
  }
}
