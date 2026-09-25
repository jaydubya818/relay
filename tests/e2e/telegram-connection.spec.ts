import { Client } from "pg";
// This browser fixture never provisions identities outside a disposable local DB.
test.beforeAll(async()=>{
 const url=new URL(process.env.RELAY_UI_TEST_DATABASE_URL??"postgresql://postgres@127.0.0.1:55432/relay_e2e_playwright");
 if(!["127.0.0.1","localhost"].includes(url.hostname)||!/^\/relay_e2e_[a-z0-9_]+$/.test(url.pathname))throw new Error("Disposable local UI database required.");
 const client=new Client({connectionString:url.toString()});await client.connect();
 try {
  await client.query("INSERT INTO principals(id,type,user_id,display_name) SELECT 'prn_ui_fixture','HUMAN',id,'UI fixture owner' FROM users WHERE email='admin@relay.local' ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO account_memberships(account_id,principal_id,role) SELECT account_id,'prn_ui_fixture','OWNER' FROM users WHERE email='admin@relay.local' ON CONFLICT DO NOTHING");
 }finally{await client.end();}
});
import { expect,test } from "@playwright/test";
test("Telegram management states remain usable on mobile and by keyboard",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/login");await page.getByLabel("Email").fill("admin@relay.local");await page.getByLabel("Password").fill("relay-e2e");await page.getByRole("button",{name:"Sign in to Relay"}).click();await expect(page.getByRole("heading",{name:"Overview"})).toBeVisible();
 let state="NOT_CONFIGURED",bindingId:string|null=null;
 await page.route("**/api/v2/operator/telegram",async route=>{
  if(route.request().method()==="POST"){
   const input=route.request().postDataJSON();expect(input).toEqual({operation:"revoke",bindingId:"fixture-binding"});state="REVOKED";bindingId=null;return route.fulfill({json:{revoked:true}});
  }
  return route.fulfill({json:{state,agentName:"Fixture Agent",bindingId,lastActivity:null,executionEnabled:false}});
 });
 await page.goto("/v2/connections");await expect(page.getByText("Telegram is not configured",{exact:false})).toBeVisible();
 for(const next of ["READY_TO_PAIR","AGENT_UNAVAILABLE","EXECUTION_DISABLED","APPROVAL_WAITING","DELIVERY_FAILURE","PROVIDER_ATTENTION","PAIRED"]){
  state=next;await page.getByRole("button",{name:"Refresh status"}).click();await expect(page.getByText(next.toLowerCase().replaceAll("_"," "),{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 bindingId="fixture-binding";await page.getByRole("button",{name:"Refresh status"}).click();const revoke=page.getByRole("button",{name:"Revoke connection"});await expect(revoke).toBeVisible();await revoke.focus();await page.keyboard.press("Enter");await expect(page.getByRole("group",{name:"Confirm Telegram revocation"})).toBeVisible();
 const confirm=page.getByRole("button",{name:"Confirm revocation"});await confirm.focus();await page.keyboard.press("Enter");await expect(page.getByText("revoked",{exact:true})).toBeVisible();await expect(revoke).toHaveCount(0);
});
