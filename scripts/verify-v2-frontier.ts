import { execFileSync } from "node:child_process";

const V2_BASE = "43e0160eb2b9552f71154d18369e4626e0e79339";
const V2_BASE_TAG = "relay-v1.0.0-rc.1";
const ALLOWED_BRANCH = "feat/relay-v2";
const PROTECTED_BRANCHES = ["main", "feat/relay-v1", "codex/relay-v1-rc-soak"] as const;

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(JSON.stringify({ status: "FAIL", check: "v2_frontier", message }));
  process.exit(1);
}

const branch = git("branch", "--show-current");
const head = git("rev-parse", "HEAD");
const tagCommit = git("rev-parse", `${V2_BASE_TAG}^{}`);

if (tagCommit !== V2_BASE) fail(`${V2_BASE_TAG} moved: expected ${V2_BASE}, received ${tagCommit}`);
if (branch !== ALLOWED_BRANCH) fail(`V2 work must run on ${ALLOWED_BRANCH}; current branch is ${branch || "detached"}`);

try {
  execFileSync("git", ["merge-base", "--is-ancestor", V2_BASE, head], { stdio: "ignore" });
} catch {
  fail(`HEAD ${head} is not descended from the qualified V2 base ${V2_BASE}`);
}

for (const protectedBranch of PROTECTED_BRANCHES) {
  const ref = `refs/heads/${protectedBranch}`;
  try {
    const commit = git("rev-parse", "--verify", ref);
    if (!commit) fail(`Protected ref ${ref} is unreadable`);
  } catch {
    fail(`Protected ref ${ref} is missing`);
  }
}

console.info(JSON.stringify({
  status: "PASS",
  check: "v2_frontier",
  branch,
  baseTag: V2_BASE_TAG,
  baseCommit: V2_BASE,
  head,
  protectedBranches: PROTECTED_BRANCHES,
}));

