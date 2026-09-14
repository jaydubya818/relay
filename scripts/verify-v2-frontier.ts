import { execFileSync } from "node:child_process";

const V2_BASE = "43e0160eb2b9552f71154d18369e4626e0e79339";
const V2_BASE_TAG = "relay-v1.0.0-rc.1";
const FROZEN_BRANCHES = ["feat/relay-v1", "codex/relay-v1-rc-soak"] as const;
const FROZEN_REFS = {
  "refs/heads/feat/relay-v1": V2_BASE,
  "refs/remotes/origin/feat/relay-v1": V2_BASE,
  "refs/heads/codex/relay-v1-rc-soak": "6ca798d5a677e0b7d9563692fb9ccbe1fa91a4ad",
} as const;

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(JSON.stringify({ status: "FAIL", check: "v2_frontier", message }));
  process.exit(1);
}

const branch = git("branch", "--show-current") || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "detached";
const head = git("rev-parse", "HEAD");
const tagCommit = git("rev-parse", `${V2_BASE_TAG}^{}`);

if (tagCommit !== V2_BASE) fail(`${V2_BASE_TAG} moved: expected ${V2_BASE}, received ${tagCommit}`);
if (FROZEN_BRANCHES.includes(branch as (typeof FROZEN_BRANCHES)[number])) fail(`V2 work cannot target frozen V1 branch ${branch}`);

try {
  execFileSync("git", ["merge-base", "--is-ancestor", V2_BASE, head], { stdio: "ignore" });
} catch {
  fail(`HEAD ${head} is not descended from the qualified V2 base ${V2_BASE}`);
}

for (const [ref, expected] of Object.entries(FROZEN_REFS)) {
  try {
    const commit = git("rev-parse", "--verify", ref);
    if (commit !== expected) fail(`Frozen ref ${ref} moved: expected ${expected}, received ${commit}`);
  } catch {
    // CI clones do not materialize every local-only historical branch.
    if (ref === "refs/remotes/origin/feat/relay-v1") fail(`Frozen remote ref ${ref} is missing`);
  }
}

console.info(JSON.stringify({
  status: "PASS",
  check: "v2_frontier",
  branch,
  baseTag: V2_BASE_TAG,
  baseCommit: V2_BASE,
  head,
  frozenBranches: FROZEN_BRANCHES,
  verifiedFrozenRefs: Object.keys(FROZEN_REFS),
}));
