import { describe,expect,it } from "vitest";
import { TelegramOwnerSender } from "@/lib/v2/channels/delivery";
describe("Telegram callback acknowledgement",()=>{
 it("uses the fixed Bot API method without turning acknowledgement into execution",async()=>{
  let request:RequestInit|undefined;
  const sender=new TelegramOwnerSender("synthetic-token",async(url,init)=>{expect(String(url)).toBe("https://api.telegram.org/botsynthetic-token/answerCallbackQuery");request=init;return Response.json({ok:true,result:true});});
  expect(await sender.acknowledge("synthetic-callback","Decision recorded.")).toBe(true);
  expect(JSON.parse(String(request?.body))).toEqual({callback_query_id:"synthetic-callback",text:"Decision recorded.",cache_time:0});expect(request?.redirect).toBe("error");
 });
 it("contains provider failures and rejects unbounded responses",async()=>{
  expect(await new TelegramOwnerSender("synthetic-token",async()=>{throw new Error("private provider details");}).acknowledge("callback","Recorded")).toBe(false);
  expect(await new TelegramOwnerSender("synthetic-token",async()=>new Response("x".repeat(4097))).acknowledge("callback","Recorded")).toBe(false);
 });
});
