import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { addMemory, getMemory } from "@/lib/memory";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

describe("account isolation", () => {
  afterEach(cleanupDatabase);
  it("does not permit cross-account memory access by ID", async () => {
    const { accountId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const agentA = await createAgent(accountId, { name: "Account A Agent" });
    const agentB = await createAgent(otherAccountId, { name: "Account B Agent" });
    const memory = await addMemory({ credentialId: "a", accountId, agentId: agentA.agentId, agentName: "A" }, { content: "Account A confidential", type: "FACT", scope: "SHARED" });
    await expect(getMemory({ credentialId: "b", accountId: otherAccountId, agentId: agentB.agentId, agentName: "B" }, memory.id)).rejects.toThrow("Memory not found");
  });
});
