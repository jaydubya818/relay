import { currentUser } from "@/lib/auth";
import { RelayError } from "@/lib/errors";

export async function requireApiUser() {
  const user = await currentUser();
  if (!user) throw new RelayError("INVALID_CREDENTIAL", "Dashboard authentication required.", undefined, 401);
  return user;
}

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  const trustedOrigins = new Set([new URL(request.url).origin]);
  if (process.env.NEXT_PUBLIC_RELAY_URL) trustedOrigins.add(new URL(process.env.NEXT_PUBLIC_RELAY_URL).origin);
  return trustedOrigins.has(new URL(origin).origin);
}

export function errorResponse(error: unknown) {
  if (error instanceof RelayError) return Response.json(error.toJSON(), { status: error.status });
  const cause = error instanceof Error ? error.cause : undefined;
  console.error(JSON.stringify({ level: "error", event: "api_error", message: error instanceof Error ? error.message : "Unknown error",
    causeCode: cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined,
    causeName: cause instanceof Error ? cause.name : undefined }));
  return Response.json({ code: "INTERNAL_ERROR", message: "Relay could not complete the request." }, { status: 500 });
}
