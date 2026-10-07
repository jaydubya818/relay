import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('expiry', Path(__file__).with_name('expire-myeve-approval.py'))
expiry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(expiry)
CONTROL = 'ctl_'+'a'*32
RELAY = {'reference': 'approval_'+'b'*64, 'binding_hash': 'c'*64, 'run_id': 'owner_run_'+'d'*64, 'expires_at': '2099-01-01'}
CHANGED = {'id': RELAY['reference'], 'before': '2099-01-01', 'after': '2000-01-01', 'status': 'pending'}

class ExpiryTest(unittest.TestCase):
    def test_waits_for_delivered_control_before_any_mutation(self):
        q = Mock(return_value=None)
        with self.assertRaisesRegex(ValueError, 'delivered'):
            expiry.inject(q, CONTROL, 'email-pin-2', Mock())
        self.assertEqual(q.call_count, 1)
        self.assertEqual(q.call_args.args[0], 'rsql')

    def test_exact_reference_expires_only_myeve_and_preserves_relay(self):
        q = Mock(side_effect=[RELAY, CHANGED, RELAY, {'attempts': 0}])
        log = Mock()
        result = expiry.inject(q, CONTROL, 'email-pin-2', log)
        self.assertEqual(result['phase'], 'verified')
        sql = q.call_args_list[1].args[1]
        for expected in [RELAY['reference'], RELAY['run_id'], RELAY['binding_hash'], "status='pending'", 'attempts=0', 'FOR UPDATE']:
            self.assertIn(expected, sql)
        self.assertEqual(q.call_args_list[0].args, q.call_args_list[2].args)
        self.assertEqual(log.call_count, 3)
        self.assertNotIn('UPDATE', q.call_args_list[0].args[1])

    def test_expired_or_exhausted_approval_is_not_reopened(self):
        q = Mock(side_effect=[RELAY, None])
        with self.assertRaisesRegex(ValueError, 'No pending'):
            expiry.inject(q, CONTROL, 'email-pin-2', Mock())
        self.assertEqual(q.call_count, 2)

    def test_consumed_or_changed_relay_control_invalidates_setup(self):
        for after in [None, {**RELAY, 'expires_at': '2000-01-01'}]:
            q = Mock(side_effect=[RELAY, CHANGED, after])
            with self.assertRaisesRegex(ValueError, 'setup invalid'):
                expiry.inject(q, CONTROL, 'email-pin-2', Mock())

    def test_send_attempt_invalidates_setup(self):
        q = Mock(side_effect=[RELAY, CHANGED, RELAY, {'attempts': 1}])
        with self.assertRaisesRegex(ValueError, 'stop the campaign'):
            expiry.inject(q, CONTROL, 'email-pin-2', Mock())

    def test_rejects_untrusted_ids_before_query(self):
        q = Mock()
        for control, pin in [("';DROP", 'email-pin-2'), (CONTROL, "';DROP")]:
            with self.assertRaises(ValueError):
                expiry.inject(q, control, pin, Mock())
        q.assert_not_called()

if __name__ == '__main__':
    unittest.main()
