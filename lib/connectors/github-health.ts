import { z } from "zod";
import { RelayError } from "@/lib/errors";
import type { CapabilityName } from "@/lib/types";

const repository = {
  owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
  repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).refine((value) => value !== "." && value !== ".."),
};
const page = { page: z.number().int().min(1).max(5).default(1), perPage: z.number().int().min(1).max(100).default(100) };
const branch = z.string().min(1).max(255).refine((value) => value !== "." && value !== ".." && Array.from(value).every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127));
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const created = z.string().refine((value) => {
  const parts = value.split("..");
  if (parts.length !== 2 || !parts.every((part) => z.iso.datetime().safeParse(part).success)) return false;
  const duration = Date.parse(parts[1]) - Date.parse(parts[0]);
  return duration >= 0 && duration <= 86_400_000;
}, "created must be an ISO UTC range of at most 24 hours");

export const githubHealthSchemas = {
  "branch.list": z.object({ ...repository, ...page }).strict(),
  "branch.get": z.object({ ...repository, branch }).strict(),
  "workflow.list": z.object({ ...repository, ...page }).strict(),
  "run.list": z.object({ ...repository, ...page, branch: branch.optional(), headSha: sha.optional(), created: created.optional() }).strict(),
  "run.get": z.object({ ...repository, runId: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict(),
  "deployment.list": z.object({ ...repository, ...page, ref: branch.optional(), sha: sha.optional() }).strict(),
  "deployment.status.list": z.object({ ...repository, ...page, deploymentId: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict(),
};

const capabilities = {
  "repo.list": "github.repo.read", "repo.get": "github.repo.read",
  "branch.list": "github.branch.read", "branch.get": "github.branch.read",
  "workflow.list": "github.actions.read", "run.list": "github.actions.read", "run.get": "github.actions.read",
  "deployment.list": "github.deployment.read", "deployment.status.list": "github.deployment.read",
} as const satisfies Record<string, CapabilityName>;

export function githubActionCapability(action: string): CapabilityName | undefined {
  if (!action.startsWith("github.")) return undefined;
  const operation = action.slice("github.".length);
  return Object.hasOwn(capabilities, operation) ? capabilities[operation as keyof typeof capabilities] : undefined;
}

export function isGitHubHealthOperation(operation: string): operation is keyof typeof githubHealthSchemas {
  return Object.hasOwn(githubHealthSchemas, operation);
}

const MAX_BYTES = 512 * 1024;

async function readJson(response: Response, capability: CapabilityName): Promise<unknown> {
  const invalid = () => new RelayError("PROVIDER_ERROR", "GitHub read returned an invalid or oversized response.", capability, 502);
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES || !/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) throw invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw invalid(); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } finally { reader.releaseLock(); }
}

export async function executeGitHubHealthRead(secret: string, operation: keyof typeof githubHealthSchemas, input: Record<string, unknown>) {
  const capability = capabilities[operation];
  const parsed = githubHealthSchemas[operation].safeParse(input);
  if (!parsed.success) throw new RelayError("INVALID_INPUT", "GitHub read arguments are invalid.", capability);
  const args = parsed.data;
  const prefix = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`;
  let path: string;
  switch (operation) {
    case "branch.list": path = `${prefix}/branches`; break;
    case "branch.get": path = `${prefix}/branches/${encodeURIComponent((args as z.infer<typeof githubHealthSchemas["branch.get"]>).branch)}`; break;
    case "workflow.list": path = `${prefix}/actions/workflows`; break;
    case "run.list": path = `${prefix}/actions/runs`; break;
    case "run.get": path = `${prefix}/actions/runs/${(args as z.infer<typeof githubHealthSchemas["run.get"]>).runId}`; break;
    case "deployment.list": path = `${prefix}/deployments`; break;
    case "deployment.status.list": path = `${prefix}/deployments/${(args as z.infer<typeof githubHealthSchemas["deployment.status.list"]>).deploymentId}/statuses`; break;
  }
  const url = new URL(path, "https://api.github.com");
  if ("page" in args) {
    url.searchParams.set("per_page", String(args.perPage));
    url.searchParams.set("page", String(args.page));
  }
  for (const [key, providerKey] of [["branch", "branch"], ["headSha", "head_sha"], ["created", "created"], ["ref", "ref"], ["sha", "sha"]] as const) {
    if (operation === "branch.get") break;
    if (key in args) url.searchParams.set(providerKey, String(args[key as keyof typeof args]));
  }
  try {
    const response = await fetch(url.toString(), {
      method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${secret}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Relay-V0" },
    });
    if (response.status === 429 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new RelayError("RATE_LIMITED", "GitHub rate limit reached.", capability, 429);
    if (response.status === 401) throw new RelayError("CONNECTION_REQUIRED", "Reconnect GitHub before using this capability.", capability, 409);
    if (response.status === 403) throw new RelayError("CAPABILITY_DENIED", "GitHub did not permit this read.", capability, 403);
    if (!response.ok) throw new RelayError("PROVIDER_ERROR", `GitHub returned ${response.status}.`, capability, response.status === 404 ? 404 : 502);
    const body = await readJson(response, capability);
    if (operation === "run.get") {
      const identity = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        run_attempt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), head_sha: sha,
        repository: z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), full_name: z.string() }).passthrough(),
      }).passthrough().safeParse(body);
      const requested = args as z.infer<typeof githubHealthSchemas["run.get"]>;
      if (!identity.success || String(identity.data.id) !== requested.runId ||
        identity.data.repository.full_name.toLowerCase() !== `${args.owner}/${args.repo}`.toLowerCase()) {
        throw new RelayError("PROVIDER_ERROR", "GitHub run identity is invalid.", capability, 502);
      }
      return body;
    }
    if (operation === "branch.get") {
      if (!body || typeof body !== "object" || Array.isArray(body) || !("name" in body) || typeof body.name !== "string" || !("commit" in body) || !body.commit || typeof body.commit !== "object" || !("sha" in body.commit) || !sha.safeParse(body.commit.sha).success) throw new RelayError("PROVIDER_ERROR", "GitHub branch response is invalid.", capability, 502);
      return body;
    }
    if (!("page" in args)) throw new RelayError("INTERNAL_ERROR", "GitHub pagination is unavailable.", capability, 500);
    const collection = operation === "workflow.list" ? "workflows" : operation === "run.list" ? "workflow_runs" : undefined;
    const record = body as { total_count?: unknown; workflows?: unknown; workflow_runs?: unknown } | null;
    const items = collection ? record?.[collection] : body;
    const totalCount = collection ? record?.total_count : undefined;
    if (!Array.isArray(items) || items.length > args.perPage || collection && (!Number.isSafeInteger(totalCount) || Number(totalCount) < 0)) throw new RelayError("PROVIDER_ERROR", "GitHub page response is invalid.", capability, 502);
    // Links indicate coverage only. They never become fetch targets.
    const linkedNext = /(?:^|,)\s*<[^>]+>\s*;\s*rel="next"(?:\s*;|\s*(?:,|$))/.test(response.headers.get("link") ?? "");
    const hasMore = linkedNext || (typeof totalCount === "number" ? totalCount > (args.page - 1) * args.perPage + items.length : items.length === args.perPage);
    return { items, page: args.page, perPage: args.perPage, hasMore, ...(typeof totalCount === "number" ? { totalCount } : {}) };
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError("PROVIDER_ERROR", "GitHub read failed.", capability, 502);
  }
}
