import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { connectGitHub, disconnectGitHub, testGitHub } from "@/lib/connections";

export async function PUT(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const { token } = z.object({ token: z.string().min(20).max(300) }).parse(await request.json());
    return Response.json(await connectGitHub(user.accountId, token));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    return Response.json(await testGitHub(user.accountId));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    await disconnectGitHub(user.accountId);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
