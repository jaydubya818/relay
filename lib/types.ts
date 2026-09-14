export const CAPABILITIES = [
  "memory.read",
  "memory.write",
  "memory.forget",
  "github.repo.read",
  "sandbox.create",
  "sandbox.exec",
  "sandbox.file.read",
  "sandbox.file.write",
  "sandbox.file.list",
  "sandbox.destroy",
  "browser.create",
  "browser.navigate",
  "browser.click",
  "browser.type",
  "browser.extract",
  "browser.screenshot",
  "browser.close",
  "agent.inbox.list",
  "agent.inbox.get",
  "agent.inbox.ack",
  "capabilities.search",
  "email.search",
  "email.read",
  "calendar.event.list",
  "calendar.event.read",
  "calendar.availability.read",
] as const;

export type CapabilityName = (typeof CAPABILITIES)[number];
export type ActivityStatus = "SUCCESS" | "DENIED" | "FAILED" | "BLOCKED";
export type AgentStatus = "ACTIVE" | "DISABLED";
export type MemoryScope = "SHARED" | "AGENT_PRIVATE";
export type MemoryType = "FACT" | "PREFERENCE" | "PROJECT" | "DECISION" | "OTHER";

export type SessionUser = {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: "OWNER" | "MEMBER";
};

export type AgentPrincipal = {
  credentialId: string;
  agentId: string;
  accountId: string;
  agentName: string;
};
