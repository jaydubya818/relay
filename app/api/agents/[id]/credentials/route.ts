import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { revokeCredential, rotateCredential } from "@/lib/agents";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const credential = await rotateCredential(user.accountId, (await context.params).id);
    return Response.json({ credential: credential.secret });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const body = await request.json().catch(() => ({}));
    return Response.json({ revoked: await revokeCredential(user.accountId, (await context.params).id, body.credentialId) });
  } catch (error) { return errorResponse(error); }
}
