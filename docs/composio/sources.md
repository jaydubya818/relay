# Source record

Inspected October 9, 2026 (America/Los_Angeles).

| Source | Exact baseline / evidence |
| --- | --- |
| Relay Owner Experience | `403411394fe5641b95d1a53db7f231147ec850f9`, `codex/relay-owner-checkpoint-b`; separate clone, active worktrees unchanged |
| Relay main | `a90625776193031ca2303ba2e2162249d1245479` |
| Frozen external alpha | `8a8678d675adc8ac7f799d7660071de2256bb231`; existing 27-group source verification retained |
| MyEve main | `2ef364024bc1cdd3e10ec28f3d340119c6f87d41` observed through GitHub |
| MyEve canonical control plane | `e93a4ce6e81494a43fdfe98447de1c42337d191b`, `codex/unified-capability-control-plane`; isolated reference clone |
| Shared capability package origin | MissionControl `04770b83844b036080e59c9e6ea8ebb565383534`, MyEve `packages/capability-control/source-lock.json` |
| MyFactory local source | `454a49064d52a6f3cf7a92a418cd70dda035bf1c`; canonical README inspected through GitHub; independent Work/admission/Result authority retained |
| MissionControl local source | `1b5884b94bfdc9873d682d924f7196a9d8f197fb`; canonical README and shared-package provenance inspected; Convex admission is not PostgreSQL-atomic |
| skillz main | `4942dde4b2a442df3ee45879bb22734c658426df`; canonical README inspected; no skill/profile activated |
| Composio TypeScript SDK | `@composio/core@0.22.0`, exact dependency and pnpm integrity lock |
| Transitive API client | `@composio/client@2.0.0-rc.8`, lockfile pinned |

Primary SDK source is the installed npm package's `src/composio.ts`,
`src/models/{Tools,Toolkits,ConnectedAccounts,AuthConfigs,Triggers}.ts`,
`src/types/{tool,toolkit,connectedAccounts,authConfigs,requestOptions,triggers}.types.ts`,
and its published declarations. SDK engine requirement is Node >=22.22.3.

Official references:

- [Composio source](https://github.com/ComposioHQ/composio)
- [SDK 0.22.0 package](https://registry.npmjs.org/@composio/core/-/core-0.22.0.tgz)
- [TypeScript SDK](https://docs.composio.dev/reference/sdk-reference/typescript)
- [Tools](https://docs.composio.dev/reference/sdk-reference/typescript/tools)
- [Connected accounts](https://docs.composio.dev/reference/sdk-reference/typescript/connected-accounts)
- [Custom auth configuration](https://docs.composio.dev/docs/auth-configuration/custom-auth-configs)
- [Toolkit discovery](https://docs.composio.dev/docs/toolkits)
- [GitHub catalog](https://docs.composio.dev/toolkits/github)
- [Google Calendar catalog](https://docs.composio.dev/toolkits/googlecalendar)
- [Slack catalog](https://docs.composio.dev/toolkits/slack)
- [Gmail guide](https://docs.composio.dev/kb/guide/toolkits-gmail)

Current SDK `link` is used rather than assuming historical managed-OAuth
`initiate` behavior. Catalog slugs are source evidence only. The test's dated
version and minimal schema are synthetic; no live schema digest, OAuth scope,
read qualification or production availability is inferred from them.
