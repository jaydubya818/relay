// Presentation only. These labels and links never authorize an operation.
export const ownerNavigation = [
  ["Home", "/"], ["Agents", "/agents"], ["Connections", "/connections"],
  ["Activity", "/activity"], ["Settings", "/settings"],
] as const;

export const advancedNavigation = [
  ["MCP", "/developer", "Connect a development tool using scoped Agent credentials."],
  ["Agent administration", "/advanced/agents", "Existing Agent creation and credential tooling."],
  ["Connection setup", "/advanced/connections", "OAuth and manual service configuration."],
  ["MyFactory diagnostics", "/factory", "Direct Work dispatch for authorized owners."],
  ["Events", "/events", "Inspect raw events and delivery inboxes."],
  ["Sandboxes", "/sandboxes", "Inspect execution environments."],
  ["Browsers", "/browsers", "Inspect browser sessions."],
  ["System health", "/advanced/health", "Configuration and provider diagnostics."],
  ["Memory", "/memory", "Existing storage tools. Not enabled for the external-alpha owner experience."],
  ["V2 operations", "/v2", "Policies, audit, approvals and operational controls. Requires active V2 membership."],
] as const;

const permissionLabels: Record<string, string> = {
  "factory.workorder.create": "Submit work", "factory.workorder.read": "Read work results",
  "memory.read": "Read memory", "memory.write": "Save memory", "memory.forget": "Remove memory",
  "github.repo.read": "Read repositories", "sandbox.create": "Start an execution environment",
  "sandbox.exec": "Run commands", "sandbox.file.read": "Read files", "sandbox.file.write": "Write files",
  "sandbox.file.list": "List files", "sandbox.destroy": "Stop an execution environment",
  "browser.create": "Start a browser", "browser.navigate": "Open web pages", "browser.click": "Click on web pages",
  "browser.type": "Enter text on web pages", "browser.extract": "Read web pages",
  "browser.screenshot": "Capture web pages", "browser.close": "Close a browser",
  "agent.inbox.list": "List received messages", "agent.inbox.get": "Read received messages",
  "agent.inbox.ack": "Acknowledge messages", "capabilities.search": "Find available permissions",
  "email.search": "Search email", "email.read": "Read email", "calendar.event.list": "List calendar events",
  "calendar.event.read": "Read calendar events", "calendar.availability.read": "Read calendar availability",
};
export function permissionLabel(capability: string) { return permissionLabels[capability] ?? capability; }
const actionLabels: Record<string, string> = {
  ...permissionLabels, "memory.add": "Save memory", "memory.search": "Search memory", "memory.list": "List memories",
  "memory.get": "Read memory", "github.repo.list": "List repositories", "github.repo.get": "Read repository",
};
// Describe the request separately from its outcome: a denied request did not execute.
export function activityLabel(action: string) { return actionLabels[action] ?? `Recorded action: ${action}`; }
export function outcomeLabel(status: string) {
  return ({ SUCCESS: "Completed", DENIED: "Not allowed", FAILED: "Failed", BLOCKED: "Blocked" } as Record<string, string>)[status] ?? status;
}
export function providerLabel(provider: string) {
  return ({ GITHUB: "GitHub", GOOGLE: "Google Workspace", MYFACTORY: "MyFactory" } as Record<string, string>)[provider] ?? provider;
}
