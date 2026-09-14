import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { disconnectGoogle, testGoogle } from "@/lib/connections";

export async function POST(request: Request) {
  try { if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 }); const user = await requireApiUser(); return Response.json(await testGoogle(user.accountId)); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 }); const user = await requireApiUser(); await disconnectGoogle(user.accountId); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
