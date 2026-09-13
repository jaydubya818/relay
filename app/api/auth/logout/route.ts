import { sessionCookieName } from "@/lib/auth";
import { NextResponse } from "next/server";

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return response;
}
