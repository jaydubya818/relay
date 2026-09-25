import { telegramReadiness } from "@/lib/v2/channels/http";
export const runtime="nodejs";
export async function GET(){const status=await telegramReadiness();return Response.json({healthy:status.healthy,ready:status.ready,executionReady:status.executionReady},{status:status.ready?200:503,headers:{"cache-control":"no-store"}});}
