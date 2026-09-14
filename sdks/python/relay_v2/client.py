"""Dependency-free Relay V2 REST client for long-running Agent runtimes."""

import json
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class RelayV2Error(RuntimeError):
    pass


class RelayV2Client:
    def __init__(self, *, base_url, account_id, credential, lease_token, workload_id,
                 runtime_product="custom", audience="relay-api", timeout=30):
        self.base_url = base_url.rstrip("/")
        self.account_id = account_id
        self.credential = credential
        self.lease_token = lease_token
        self.workload_id = workload_id
        self.runtime_product = runtime_product
        self.audience = audience
        self.timeout = timeout

    def submit_action(self, action, idempotency_key):
        return self._request(
            "POST",
            "/api/v2/runtime/actions",
            body={"action": action},
            extra_headers={"Idempotency-Key": idempotency_key},
        )

    def action_status(self, task_id, command_id):
        query = urlencode({"taskId": task_id})
        return self._request("GET", f"/api/v2/runtime/actions/{quote(command_id)}?{query}")

    def _request(self, method, path, body=None, extra_headers=None):
        headers = {
            "Authorization": f"Bearer {self.credential}",
            "X-Relay-Account-Id": self.account_id,
            "X-Relay-Lease": self.lease_token,
            "X-Relay-Workload-Id": self.workload_id,
            "X-Relay-Audience": self.audience,
            "X-Relay-Runtime-Product": self.runtime_product,
            **(extra_headers or {}),
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RelayV2Error(f"Relay request failed ({error.code}): {detail}") from error
