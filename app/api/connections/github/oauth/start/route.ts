import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { beginGitHubOAuth } from "@/lib/connectors/github-oauth";
import { errorResponse } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.redirect(new URL("/login", request.url));
    const authorizationUrl = await beginGitHubOAuth(user, new URL(request.url).origin);
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    return errorResponse(error);
  }
}
