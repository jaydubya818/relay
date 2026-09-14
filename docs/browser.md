# Browser sessions

Relay exposes browser work through the provider-neutral `BrowserProvider` contract. The initial adapter uses an isolated Playwright browser context for every Relay browser session; Playwright identifiers never appear in MCP results or canonical capability arguments.

Sessions are private to their owning Agent by default. A same-account Agent may use a session only after an explicit grant. Cross-account access is rejected. Every operation is authorized through the ordinary capability path and recorded in provider-independent activity history.

The default policy permits public HTTP and HTTPS destinations only. It rejects localhost, private, link-local, multicast, and non-web schemes. Redirects and subresources are checked by request routing as well as the initial navigation. Operators can configure TTL, operation timeout, and extraction bounds within Relay's enforced limits.

Expired sessions are closed on access or by `cleanupExpiredBrowserSessions`. The current single-process Playwright adapter keeps live contexts in process memory, so a process restart invalidates provider sessions. A later managed adapter can implement the same contract without changing Agent or MCP capability shapes.

Run the real adapter qualification with:

```sh
RELAY_LIVE_PLAYWRIGHT=1 pnpm vitest run tests/browser/playwright-live.test.ts
```
