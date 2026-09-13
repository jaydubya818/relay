import { authenticateDashboardUser, createSession, sessionCookieName, sessionMaxAge } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const user = await authenticateDashboardUser(String(body.email ?? ""), String(body.password ?? ""));
  if (!user) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  const response = NextResponse.json({ user });
  response.cookies.set(sessionCookieName(), await createSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAge(),
    path: "/",
  });
  return response;
}
