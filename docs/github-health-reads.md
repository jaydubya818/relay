# GitHub health read tools

These source capabilities extend the existing account-owned GitHub connector.
They do not install an adapter, create grants, change OAuth scopes, approve an
acceptance policy or activate a deployment. Existing `github.repo.read` grants
continue to expose only repository list/get tools.

| Capability | MCP tools | Provider operations |
| --- | --- | --- |
| `github.branch.read` | `relay_github_branch_list`, `relay_github_branch_get` | List branches; get one branch tip |
| `github.actions.read` | `relay_github_workflow_list`, `relay_github_run_list`, `relay_github_run_get` | List workflows; list runs; read a run's current attempt |
| `github.deployment.read` | `relay_github_deployment_list`, `relay_github_deployment_status_list` | List deployments; list deployment statuses |

Each tool authenticates the existing Agent credential, checks its current
account/Agent capability grant through the existing executor, and loads only
that account's stored connection. The executor rejects GitHub action/capability
mismatches. GitHub independently enforces repository access and token permissions
on every read. No caller-provided account, credential, URL, role or capability
override is accepted. Grant and credential revocation apply on the next call.
This is the existing account/Agent authorization boundary, not a Work-scoped
delegation or a new financial authority.

Inputs use `owner` and `repo`; `branch.get` also requires a branch name and
`deployment.status.list` a positive decimal `deploymentId`. List tools accept
integer `page` (1–5, default 1) and `perPage` (1–100, default 100).
`run.list` optionally accepts `branch`, a 40-character lowercase `headSha`, and
`created` as two ISO UTC date-times separated by `..`, spanning at most 24 hours.
`deployment.list` optionally accepts `ref` and `sha`. New input schemas reject
unknown properties. Existing repository list/get contracts remain unchanged.
`run.get` requires a positive decimal `runId` and returns one current provider
run object. Its run ID and repository identity must match the requested path;
attempt, repository ID and head SHA must be well formed. Adapters must additionally
verify workflow/event/ref/SHA/creation identity against their selected list record,
recheck authorization context and reject missing, older or substituted attempts.
List pagination alone does not prove that a selected latest attempt is resolved.

Each list response has `items`, `page`, `perPage`, `hasMore`, and, for Actions,
`totalCount`. Branch get returns the provider branch object after checking its
name/commit shape. A full array page without a total count is conservatively
incomplete even if the provider omits its next link. `hasMore` at page 5 means
the supported bound was reached; it never means complete. Pagination is not a
consistent snapshot. Downstream adapters must independently bind identity,
authorization revision/expiry, repository/ref/SHA, observation time, workflow
policy, coverage and latest attempts before making any health assertion.

Transport uses fixed `GET` paths under `https://api.github.com`, the existing
`2022-11-28` API version, a 10-second deadline and a 512 KiB response limit.
Redirects are rejected. Link headers indicate coverage but are never fetched.
No automatic retries occur. Provider 401 becomes `CONNECTION_REQUIRED`, 403
becomes `CAPABILITY_DENIED`, and 429 or exhausted quota becomes `RATE_LIMITED`.
404, redirects, malformed/oversized responses and transport errors remain
explicit `PROVIDER_ERROR` failures, never successful empty lists. Raw upstream
error bodies and credentials do not appear in error messages.

Official endpoint contracts:

- [Branches](https://docs.github.com/en/rest/branches/branches?apiVersion=2022-11-28)
- [Workflows](https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28)
- [Workflow runs](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28)
- [Deployments](https://docs.github.com/en/rest/deployments/deployments?apiVersion=2022-11-28)
- [Deployment statuses](https://docs.github.com/en/rest/deployments/statuses?apiVersion=2022-11-28)

Fine-grained provider tokens need Contents read for branches, Actions read for
workflows/runs, and Deployments read for deployments/statuses. These source
definitions do not supply or upgrade those permissions. No live enrollment,
credential acquisition, production migration or paid execution follows from
their presence in the source catalog.
