import { describe,expect,it } from "vitest";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { canonicalHash } from "@/lib/v2/contracts";
import { ExecutorNotAdmitted,ExecutorOutcomeUnknown,HttpOwnerExecutor } from "@/lib/v2/channels/executor";
import { WORK_BUDGET,type ExecutionCommand } from "@/lib/v2/channels/contracts";
const command:ExecutionCommand={commandId:"fixture-status",operation:"status",work:{version:"relay.owner-work.v1",requestId:"fixture-task",taskId:"fixture-task",accountId:"fixture-account",ownerPrincipalId:"fixture-owner",agentId:"fixture-agent",threadId:"fixture-thread",sourceIdentity:"fixture-binding",ingress:"owner_telegram",requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),message:"Synthetic request",budget:WORK_BUDGET}};
const proof={code:"OWNER_WORK_NOT_ADMITTED",requestId:command.work.requestId,ownerPrincipalId:command.work.ownerPrincipalId,agentId:command.work.agentId,workHash:canonicalHash(command.work)};
function transport(body:unknown,status=409){return new HttpOwnerExecutor({endpoint:"https://executor.invalid/owner",audience:"fixture",environment:"preview",signer:createLocalEd25519Signer()},async()=>Response.json(body,{status}));}
describe("executor non-admission proof",()=>{
 it("accepts only an exact proof for STATUS",async()=>{await expect(transport(proof).call(command)).rejects.toBeInstanceOf(ExecutorNotAdmitted);});
 it.each(["requestId","ownerPrincipalId","agentId","workHash"])("rejects mismatched %s",async key=>{await expect(transport({...proof,[key]:"different"}).call(command)).rejects.toBeInstanceOf(ExecutorOutcomeUnknown);});
 it("does not treat a START failure or generic conflict as non-admission",async()=>{
  await expect(transport(proof).call({...command,operation:"start"})).rejects.toBeInstanceOf(ExecutorOutcomeUnknown);
  await expect(transport({code:"UNKNOWN"}).call(command)).rejects.toBeInstanceOf(ExecutorOutcomeUnknown);
  await expect(transport(proof,500).call(command)).rejects.toBeInstanceOf(ExecutorOutcomeUnknown);
 });
});
