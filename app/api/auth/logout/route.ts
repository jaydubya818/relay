import { revokeSession, sessionCookieName } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { verifySameOrigin } from "@/lib/api";

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  await revokeSession(request.cookies.get(sessionCookieName())?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
