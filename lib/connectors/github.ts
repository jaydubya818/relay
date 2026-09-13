import { RelayError } from "@/lib/errors";
import type { ConnectorProvider } from "@/lib/connectors/types";

const API = "https://api.github.com";

async function githubRequest(secret: string, path: string) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${secret}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Relay-V0",
    },
    cache: "no-store",
  });
  if (response.status === 429 || response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new RelayError("RATE_LIMITED", "GitHub rate limit reached.", "github.repo.read", 429);
  }
  if (!response.ok) throw new RelayError("PROVIDER_ERROR", `GitHub returned ${response.status}.`, "github.repo.read", 502);
  return response.json();
}

export const githubProvider: ConnectorProvider = {
  provider: "GITHUB",
  capabilities: () => ["github.repo.read"],
  async health(secret) {
    try {
      const user = await githubRequest(secret, "/user") as { id: number; login: string; name?: string };
      return { ok: true, externalAccountId: String(user.id), displayName: user.name || user.login };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "GitHub connection failed." };
    }
  },
  async execute(secret, operation, input) {
    if (operation === "repo.list") return githubRequest(secret, "/user/repos?per_page=50&sort=updated");
    if (operation === "repo.get") {
      const owner = encodeURIComponent(String(input.owner ?? ""));
      const repo = encodeURIComponent(String(input.repo ?? ""));
      if (!owner || !repo) throw new RelayError("INVALID_INPUT", "owner and repo are required.", "github.repo.read");
      return githubRequest(secret, `/repos/${owner}/${repo}`);
    }
    throw new RelayError("INVALID_INPUT", "Unsupported GitHub operation.", "github.repo.read");
  },
};
