import { telegramWebhook } from "@/lib/v2/channels/http";
export const runtime="nodejs";
export async function POST(request:Request) { return telegramWebhook(request); }
