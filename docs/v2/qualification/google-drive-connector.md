# Google Drive connector qualification

Status: LOCAL PASS; LIVE PROVIDER BLOCKED_EXTERNAL_CONFIGURATION

The local conformance pack verifies the exact `drive.file` scope set, signed manifest, single-use tenant-bound OAuth state, opaque token/verifier handles, selected-root enforcement, authoritative app-created resource tracking, pre-generated create IDs, stable idempotency, ambiguous-effect reconciliation by file ID, immediate revoke, permission drift fail-closed behavior, and account isolation across flows, connections, resources, operations, and receipts.

Live qualification requires a V2-specific OAuth client, consent configuration, Drive API enablement, Picker/resource selection, isolated test folder, and credential broker binding. V1's frozen Google qualification and credentials are not reused or modified.

The live pack must prove search/read only inside selected roots, binary create/update, duplicate-create conflict reconciliation, token non-exposure, scope/resource loss, revoke/reconnect, provider rate behavior, and redacted receipts.
