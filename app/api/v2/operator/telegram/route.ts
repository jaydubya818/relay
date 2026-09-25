import { readBoundedTelegramBody } from "@/lib/v2/telegram-input";
import { requireApiUser,verifySameOrigin } from "@/lib/api";
import { operatorContext } from "@/lib/v2/dashboard";
import { disconnectTelegram,setupTelegramPairing,telegramManagement } from "@/lib/v2/channels/management";
import { z } from "zod";
const schema=z.discriminatedUnion("operation",[z.object({operation:z.literal("pair"),grantOwnerChannel:z.literal(true)}).strict(),z.object({operation:z.literal("revoke"),bindingId:z.string().max(255)}).strict()]);
const headers={"cache-control":"no-store"};
export async function GET(){try{const user=await requireApiUser();const owner=await operatorContext(user.accountId,user.id);return Response.json(await telegramManagement(user.accountId,owner.principalId),{headers});}catch{return Response.json({error:"Owner access required."},{status:403,headers});}}
export async function POST(request:Request){try{if(!verifySameOrigin(request))throw new Error();const user=await requireApiUser();const owner=await operatorContext(user.accountId,user.id);const text=new TextDecoder().decode(await readBoundedTelegramBody(request));if(text.length>1024)throw new Error();const input=schema.parse(JSON.parse(text));return Response.json(input.operation==="pair"?await setupTelegramPairing(user.accountId,owner.principalId):await disconnectTelegram(user.accountId,owner.principalId,input.bindingId),{headers});}catch{return Response.json({error:"The Telegram connection could not be changed. Check its configuration, ownership and status."},{status:400,headers});}}
