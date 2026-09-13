import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { forgetMemoryAsUser } from "@/lib/memory";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    forgetMemoryAsUser(user.accountId, (await context.params).id);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
