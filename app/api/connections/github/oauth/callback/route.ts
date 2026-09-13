import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { completeGitHubOAuth } from "@/lib/connectors/github-oauth";

export async function GET(request: Request) {
  const destination = new URL("/connections", request.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    destination.searchParams.set("github", "cancelled");
    return NextResponse.redirect(destination);
  }
  try {
    await completeGitHubOAuth(user, { code, state });
    destination.searchParams.set("github", "connected");
  } catch {
    destination.searchParams.set("github", "failed");
  }
  return NextResponse.redirect(destination);
}
