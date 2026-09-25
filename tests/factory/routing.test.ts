import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({token:vi.fn()}));
vi.mock("@vercel/connect",()=>({getToken:mocks.token}));
import { factoryRequest } from "../../lib/myfactory";
beforeEach(()=>{
 vi.resetAllMocks();
 vi.stubEnv("MYFACTORY_RELAY_ACCOUNT_ID","owner-account");
 for(const name of ["REPOSITORY","LINEAR_TEAM_ID","LINEAR_CONNECTOR","LINEAR_WORKSPACE_ID","CLIENT_TOKEN","RECEIPT_PUBLIC_KEY"])vi.stubEnv(`MYFACTORY_${name}`,name);
 mocks.token.mockResolvedValue("private-token");
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("denies another account before connector access",async()=>{
 await expect(factoryRequest("other-account","create",{})).rejects.toMatchObject({code:"CAPABILITY_DENIED"});
 expect(mocks.token).not.toHaveBeenCalled();
});
it("denies a connector destination mismatch before creating an issue",async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({data:{viewer:{organization:{id:"other"}},team:{id:"LINEAR_TEAM_ID"}}}));vi.stubGlobal("fetch",fetcher);
 await expect(factoryRequest("owner-account","create",{})).rejects.toMatchObject({code:"CAPABILITY_DENIED"});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not send malformed work to Linear",async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({data:{viewer:{organization:{id:"LINEAR_WORKSPACE_ID"}},team:{id:"LINEAR_TEAM_ID"}}}));vi.stubGlobal("fetch",fetcher);
 await expect(factoryRequest("owner-account","create",{command:"execute"})).rejects.toThrow("Unsupported");
 expect(fetcher).toHaveBeenCalledTimes(1);
});
