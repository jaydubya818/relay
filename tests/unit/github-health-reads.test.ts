import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "@/lib/connectors/github";

const repository = { owner: "example", repo: "dashboard" };
const secret = "synthetic-github-token";
const operations = [
  ["branch.list", "/branches", [], "github.branch.read"],
  ["workflow.list", "/actions/workflows", { total_count: 0, workflows: [] }, "github.actions.read"],
  ["run.list", "/actions/runs", { total_count: 0, workflow_runs: [] }, "github.actions.read"],
  ["deployment.list", "/deployments", [], "github.deployment.read"],
] as const;

function response(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

afterEach(() => vi.unstubAllGlobals());

describe("bounded GitHub health reads", () => {
  it.each(operations)("reads %s with a fixed GET path and explicit page coverage", async (operation, path, body) => {
    const fetch = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal("fetch", fetch);
    const result = await githubProvider.execute(secret, operation, repository);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/example/dashboard${path}?per_page=100&page=1`);
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store", headers: { Authorization: `Bearer ${secret}` } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ items: [], page: 1, perPage: 100, hasMore: false });
  });

  it("preserves existing repository grant semantics", () => {
    expect(githubProvider.capabilities()).toEqual(["github.repo.read", "github.branch.read", "github.actions.read", "github.deployment.read"]);
  });

  it("encodes a branch with slashes as a single path value", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ name: "feature/ci", commit: { sha: "a".repeat(40) } }));
    vi.stubGlobal("fetch", fetch);
    await githubProvider.execute(secret, "branch.get", { ...repository, branch: "feature/ci" });
    expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/example/dashboard/branches/feature%2Fci");
  });

  it("filters runs without accepting a provider URL", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ total_count: 1, workflow_runs: [{ id: 1 }] }));
    vi.stubGlobal("fetch", fetch);
    await githubProvider.execute(secret, "run.list", { ...repository, branch: "feature/ci", headSha: "a".repeat(40), created: "2026-10-27T00:00:00Z..2026-10-28T00:00:00Z", page: 2, perPage: 50 });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("branch")).toBe("feature/ci");
    expect(url.searchParams.get("head_sha")).toBe("a".repeat(40));
    expect(url.searchParams.get("created")).toBe("2026-10-27T00:00:00Z..2026-10-28T00:00:00Z");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("reads deployment statuses through a numeric identifier", async () => {
    const fetch = vi.fn().mockResolvedValue(response([{ id: 2, state: "success" }]));
    vi.stubGlobal("fetch", fetch);
    expect(await githubProvider.execute(secret, "deployment.status.list", { ...repository, deploymentId: "42" })).toMatchObject({ items: [{ id: 2, state: "success" }] });
    expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/example/dashboard/deployments/42/statuses?per_page=100&page=1");
  });

  it("reports additional pages without following provider-controlled links", async () => {
    const fetch = vi.fn().mockResolvedValue(response([], { link: '<https://untrusted.invalid/leak>; rel="next"' }));
    vi.stubGlobal("fetch", fetch);
    expect(await githubProvider.execute(secret, "deployment.list", repository)).toMatchObject({ hasMore: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { owner: ".." }, { repo: ".." }, { repo: "a/b" }, { owner: "a?token=x" },
    { page: 0 }, { page: 6 }, { perPage: 101 }, { page: 1.5 },
    { url: "https://untrusted.invalid" }, { accountId: "foreign" },
  ])("rejects malformed or authority-bearing inputs before fetch: %j", async (override) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(githubProvider.execute(secret, "run.list", { ...repository, ...override })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([".", "..", "\u0000", ""])("rejects unsafe branch identifiers: %j", async (branch) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(githubProvider.execute(secret, "branch.get", { ...repository, branch })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, {}, "CAPABILITY_DENIED", 403], [404, {}, "PROVIDER_ERROR", 404],
    [401, {}, "CONNECTION_REQUIRED", 409], [429, {}, "RATE_LIMITED", 429],
    [403, { "x-ratelimit-remaining": "0" }, "RATE_LIMITED", 429],
    [302, { location: "https://untrusted.invalid" }, "PROVIDER_ERROR", 502],
  ])("preserves a nonempty failure for provider status %s", async (status, headers, code, errorStatus) => {
    const fetch = vi.fn().mockResolvedValue(response({ message: "private provider detail" }, headers, status));
    vi.stubGlobal("fetch", fetch);
    await expect(githubProvider.execute(secret, "run.list", repository)).rejects.toMatchObject({ code, status: errorStatus, capability: "github.actions.read" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([{}, { total_count: 0, workflow_runs: null }, { total_count: -1, workflow_runs: [] }])("rejects malformed run pages: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
    await expect(githubProvider.execute(secret, "run.list", repository)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("rejects an oversized provider response even without a length header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ total_count: 1, workflow_runs: [{ title: "x".repeat(512 * 1024) }] })));
    await expect(githubProvider.execute(secret, "run.list", repository)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("sanitizes network failures and never retries", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error(`network failure ${secret}`)); vi.stubGlobal("fetch", fetch);
    await expect(githubProvider.execute(secret, "run.list", repository)).rejects.toMatchObject({ code: "PROVIDER_ERROR", message: "GitHub read failed." });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
