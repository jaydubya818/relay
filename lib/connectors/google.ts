import { RelayError } from "@/lib/errors";
import type { ConnectorProvider } from "@/lib/connectors/types";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

async function googleRequest(secret: string, url: string, init: RequestInit = {}, capability?: string) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${secret}`, "content-type": "application/json", ...init.headers }, cache: "no-store" });
  if (response.status === 401) throw new RelayError("CONNECTION_REQUIRED", "Google authorization expired or was revoked. Reconnect Google Workspace.", capability, 409);
  if (response.status === 403) throw new RelayError("CAPABILITY_DENIED", "Google denied the requested scope.", capability, 403);
  if (response.status === 429) throw new RelayError("RATE_LIMITED", "Google API rate limit reached.", capability, 429);
  if (!response.ok) throw new RelayError("PROVIDER_ERROR", `Google returned ${response.status}.`, capability, 502);
  return response.json();
}

function header(payload: any, name: string) {
  return payload?.headers?.find((entry: any) => String(entry.name).toLowerCase() === name.toLowerCase())?.value;
}

function textBody(payload: any): string {
  if (payload?.mimeType === "text/plain" && payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const part of payload?.parts ?? []) { const value = textBody(part); if (value) return value; }
  return "";
}

export const googleProvider: ConnectorProvider = {
  provider: "GOOGLE",
  capabilities: () => ["email.search", "email.read", "calendar.event.list", "calendar.event.read", "calendar.availability.read"],
  async health(secret) {
    try {
      const profile = await googleRequest(secret, `${GMAIL}/profile`, {}, "email.read") as { emailAddress: string };
      return { ok: true, externalAccountId: profile.emailAddress, displayName: profile.emailAddress };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Google connection failed." }; }
  },
  async execute(secret, operation, input) {
    if (operation === "email.search") {
      const url = new URL(`${GMAIL}/messages`);
      url.searchParams.set("q", String(input.query ?? ""));
      url.searchParams.set("maxResults", String(Math.min(Number(input.limit ?? 25), 100)));
      return googleRequest(secret, url.toString(), {}, "email.search");
    }
    if (operation === "email.read") {
      const messageId = encodeURIComponent(String(input.messageId ?? ""));
      const message = await googleRequest(secret, `${GMAIL}/messages/${messageId}?format=full`, {}, "email.read") as any;
      const body = textBody(message.payload).slice(0, 100_000);
      return { id: message.id, threadId: message.threadId, labels: message.labelIds ?? [], snippet: message.snippet ?? "", internalDate: message.internalDate, headers: { from: header(message.payload, "from"), to: header(message.payload, "to"), subject: header(message.payload, "subject"), date: header(message.payload, "date") }, body, bodyTruncated: textBody(message.payload).length > body.length };
    }
    if (operation === "calendar.event.list") {
      const calendarId = encodeURIComponent(String(input.calendarId ?? "primary"));
      const url = new URL(`${CALENDAR}/calendars/${calendarId}/events`);
      url.searchParams.set("singleEvents", "true"); url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", String(Math.min(Number(input.limit ?? 50), 100)));
      if (input.timeMin) url.searchParams.set("timeMin", String(input.timeMin));
      if (input.timeMax) url.searchParams.set("timeMax", String(input.timeMax));
      if (input.query) url.searchParams.set("q", String(input.query));
      return googleRequest(secret, url.toString(), {}, "calendar.event.list");
    }
    if (operation === "calendar.event.read") {
      const calendarId = encodeURIComponent(String(input.calendarId ?? "primary"));
      const eventId = encodeURIComponent(String(input.eventId ?? ""));
      return googleRequest(secret, `${CALENDAR}/calendars/${calendarId}/events/${eventId}`, {}, "calendar.event.read");
    }
    if (operation === "calendar.availability.read") {
      return googleRequest(secret, `${CALENDAR}/freeBusy`, { method: "POST", body: JSON.stringify({ timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone, items: [{ id: input.calendarId ?? "primary" }] }) }, "calendar.availability.read");
    }
    throw new RelayError("INVALID_INPUT", "Unsupported Google operation.");
  },
};
