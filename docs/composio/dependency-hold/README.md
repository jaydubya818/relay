# RELAY × COMPOSIO — DEPENDENCY HOLD

**Activation readiness: NO.** Preserve accepted Relay `84b02ee17fc4e285f337f89ee58bb689aa8c21b1`, MyEve compatibility reference `9200bd3826350ad586bb5640ca08557da7d1b984`, SDK `@composio/core@0.22.0`, all 27 frozen compatibility groups and historical evidence. No positive remote execution is activated.

## Canonical handoff and bounded preparation

The [exact owner handoff](canonical-owner-handoff.md) requests the existing canonical receiving transaction and its qualification: identity/capability/policy bindings, runtime lease, descriptor/argument/effect material, durable acknowledgment, revocation and UNKNOWN recovery. It is prepared locally, not sent to another chat or published as an issue. The [execution/recovery contract](execution-recovery-contract.md) defines idempotency, provider-result custody, Sofie behavior and the deterministic Golden Journey acceptance matrix without introducing an authority or execution ledger.

Five new preparation tests qualify existing boundaries: concurrent replay after a lost denial response and database-pool reconnect; transactional rollback on evidence-signing failure; local revocation surviving reconnect before upstream acknowledgment; a synthetic late response leaving the timed-out outcome UNKNOWN without retry; and projected untrusted result data remaining credential-free and bound to its digest after the raw object changes. They do not qualify positive admission, real process crashes, provider reconciliation, native MyEve result custody or a composed successful journey.

## Focused braces correction

The remaining high finding is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Registry metadata still identifies `braces@3.0.3` as latest and the advisory lists no patched release. The [upstream issue](https://github.com/micromatch/braces/issues/70) describes recursive processing of deeply nested string patterns. Local reproduction preserved a stack overflow with 9,001-character nested braces through compile/expand and nested parentheses through compile.

`patches/braces@3.0.3.patch` adds only a parser nesting check before brace and parenthesis stack pushes. Combined nesting up to 100 is accepted; deeper strings throw a deterministic SyntaxError before building an excessively deep AST. There is no caller option to disable the bound. Normal escaping, quoted/bracketed text, sibling blocks, ranges and ordinary glob semantics are retained. The ten security tests resolve the real Next ESLint → fast-glob → micromatch → braces chain and exercise that patched installation.

This is a **local mitigation of the repository's affected string-input path**, not an upstream fixed release or general protection for arbitrary caller-constructed AST objects. Such ASTs, including deep nodes, parent cycles and array values, bypass the parser and remain outside this patch's scope; no audited application/build consumer supplies them. This patch also makes no claim to solve every regex-complexity or expansion-size problem. Do not expose arbitrary globs/ASTs to provider results or remote users.

The patch uses pnpm 9's supported `patchedDependencies` mechanism. Original version, registry tarball, integrity and dependency versions are preserved. No package renaming, fork substitution, changed version assertion, ignore list, audit exception or gate suppression was introduced. Only patch registration and references change in the lockfile; a normalization comparison against the accepted lockfile verifies this.

- Original registry tarball: `https://registry.npmjs.org/braces/-/braces-3.0.3.tgz`
- Original integrity: `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`
- Patch SHA-256: `509e657aedcd1f242459f0ff0ea99ca3dfdd17b7f943c5f455a88295d54e45cc`
- pnpm patch hash: `vgeitjs3kk3vckqodss57rtyii`

The full audit still reports **one high, zero critical and zero moderate findings**, because its version advisory does not recognize this local source correction. Its nonzero exit is retained. Production audit reports zero findings. Thus the reproduced path is mitigated, but a clean full-graph advisory gate remains unresolved until an upstream recognized fix or separately reviewed dependency replacement is available. Passing regression CI does not waive that failure.

## Qualification and boundaries

Final exact SHA, PostgreSQL regression/performance counts, browser/accessibility, fresh-clone, hosted workflows, independent source review and historical hashes are recorded in `relay-composio-evidence/dependency-hold/REPORT.md` and `verification.json`. Initial reproductions and all final logs are retained separately from historical checkpoints.

No production deployment, live OAuth, paid provider operation, external provider write, external-alpha change, automatic merge, new production credential custody or execution activation. No MyEve source change and no change to the frozen Relay authority. Positive Composio receiving admission, successful execution idempotency/reconciliation, authenticated Sofie consumption and native Result/Proof remain dependencies of the canonical owner.
