import { browserProvider, sandboxProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const [sandbox, browser] = await Promise.all([sandboxProvider().health(), browserProvider().health()]);
  return Response.json({ ok: sandbox.ok && browser.ok, providers: { sandbox, browser }, timestamp: new Date().toISOString() });
}
