async function main() {
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"] as const;
  for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: "refresh_token" }) });
  const token = await tokenResponse.json() as { access_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error(`Google refresh failed: ${token.error ?? tokenResponse.status}${token.error_description ? ` (${token.error_description})` : ""}`);
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const [profileResponse, mailResponse, calendarResponse] = await Promise.all([
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers }),
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1", { headers }),
    fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&maxResults=1&timeMin=${encodeURIComponent(new Date().toISOString())}`, { headers }),
  ]);
  const result = { oauthRefresh: tokenResponse.status, gmailProfile: profileResponse.status, gmailSearch: mailResponse.status, calendarEvents: calendarResponse.status };
  console.info(JSON.stringify({ qualification: "google-readonly-live", ...result }));
  if ([profileResponse, mailResponse, calendarResponse].some((response) => !response.ok)) process.exitCode = 1;
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : "Google qualification failed."); process.exitCode = 1; });
