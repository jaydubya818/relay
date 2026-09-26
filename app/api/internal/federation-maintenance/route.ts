import { expireFederationContent } from "@/lib/v2/federation/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });

  if (process.env.RELAY_FEDERATION_ENABLED !== "true")
    return Response.json({ error: "Federation maintenance unavailable" }, { status: 503, headers });

  try {
    await expireFederationContent();
    return Response.json({ expired: true }, { headers });
  } catch {
    return Response.json({ error: "Federation maintenance unavailable" }, { status: 503, headers });
  }
}
