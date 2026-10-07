#!/usr/bin/env python3
"""Inject MyEve-only expiry after the exact Relay prompt is delivered.

Offline helper: never starts services. Requires an already authorized local campaign.
Do not tell the owner to tap Approve unless this command succeeds.
"""
import argparse
import datetime
import json
import re
import subprocess


def inject(query, control_id, pin_id, record):
    if not re.fullmatch(r"ctl_[a-f0-9]{32}", control_id):
        raise ValueError("Exact Relay control id required")
    if not re.fullmatch(r"email-pin-[0-9]{1,3}", pin_id):
        raise ValueError("Exact pin id required")
    # Delivery is matched to this control, not merely any outbound message.
    relay_sql = f"""SELECT row_to_json(x) FROM (
      SELECT c.reference,c.binding_hash,c.expires_at::text AS expires_at,w.run_id
      FROM channel_controls c JOIN channel_work_links w ON w.task_id=c.task_id
      JOIN v2_tasks t ON t.id=c.task_id
      JOIN telegram_bindings b ON b.id=c.binding_id
      WHERE c.id='{control_id}' AND c.account_id='acct_qualificationrelay'
        AND c.kind='approval' AND c.consumed_at IS NULL AND c.choice IS NULL
        AND c.expires_at>now()+interval '2 minutes' AND b.revoked_at IS NULL
        AND t.status='WAITING_APPROVAL'
        AND EXISTS(SELECT 1 FROM communication_messages m WHERE m.task_id=c.task_id
          AND m.direction='OUTBOUND' AND m.status='SENT'
          AND m.idempotency_key='channel-pending:'||c.id)
    ) x"""
    before = query('rsql', relay_sql)
    if not before:
        raise ValueError("Exact prompt must be delivered, unconsumed and valid for two minutes")
    for key, pattern in [('reference', r'approval_[a-f0-9]{64}'), ('binding_hash', r'[a-f0-9]{64}'), ('run_id', r'owner_run_[a-f0-9]{64}')]:
        if not re.fullmatch(pattern, before[key]):
            raise ValueError("Unexpected approval identity")
    # The two databases cannot share a transaction. Compare the unchanged Relay
    # control again after the single-row MyEve mutation, failing closed on races.
    record({'phase': 'before', 'control': control_id, 'relay': before})
    changed = query('lsql', f"""WITH prior AS MATERIALIZED (
      SELECT id,expires_at FROM task_approval_decisions
      WHERE id='{before['reference']}' AND task_id='{before['run_id']}'
        AND owner_id='qualification-owner' AND binding_hash='{before['binding_hash']}'
        AND status='pending' AND expires_at>now()
        AND EXISTS(SELECT 1 FROM owner_qualification_email_pins
          WHERE pin_id='{pin_id}' AND attempts=0 AND exhausted_at IS NULL)
      FOR UPDATE
    ), changed AS (
      UPDATE task_approval_decisions a SET expires_at=now()-interval '1 minute'
      FROM prior p WHERE a.id=p.id
      RETURNING a.id,p.expires_at::text AS before,a.expires_at::text AS after,a.status
    ) SELECT row_to_json(changed) FROM changed""")
    record({'phase': 'mutation', 'control': control_id, 'myeve': changed})
    if not changed:
        raise ValueError("No pending, unexpired matching MyEve approval with unused pin")
    after = query('rsql', relay_sql)
    if after != before:
        raise ValueError("Relay control changed during injection; do not tap; setup invalid")
    pin = query('lsql', f"SELECT row_to_json(p) FROM (SELECT attempts FROM owner_qualification_email_pins WHERE pin_id='{pin_id}') p")
    if pin != {'attempts': 0}:
        raise ValueError("Pin attempts changed; stop the campaign")
    result = {'phase': 'verified', 'control': control_id, 'relay': after, 'myeve': changed, 'pinAttempts': 0}
    record(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controller', required=True)
    parser.add_argument('--control', required=True)
    parser.add_argument('--pin', required=True)
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()

    def query(side, sql):
        output = subprocess.run([args.controller, side, sql], check=True, capture_output=True, text=True).stdout.strip()
        return json.loads(output) if output else None

    def record(detail):
        with open(args.evidence, 'a') as log:
            log.write(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'step': 'injected_myeve_expiry', 'detail': detail})+'\n')

    print(json.dumps(inject(query, args.control, args.pin, record)))


if __name__ == '__main__':
    main()
