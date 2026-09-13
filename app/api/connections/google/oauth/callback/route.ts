import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { completeGoogleOAuth } from "@/lib/connectors/google-oauth";

export async function GET(request: Request) {
  const destination = new URL("/connections", request.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code"); const state = searchParams.get("state");
  if (!code || !state) { destination.searchParams.set("google", "cancelled"); return NextResponse.redirect(destination); }
  try { await completeGoogleOAuth(user, { code, state }); destination.searchParams.set("google", "connected"); }
  catch { destination.searchParams.set("google", "failed"); }
  return NextResponse.redirect(destination);
}
