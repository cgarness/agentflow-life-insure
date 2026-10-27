"""Offline negative controls for Gate E; never contacts production."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("pilot", Path(__file__).with_name("google_sheets_pilot_release.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.d = p.load_helpers()
        self.d.require = lambda ok, label: None if ok else self.fail_gate(label)
        self.d.sql = MagicMock(return_value="f")
        self.d.apply = MagicMock()
        self.d.management = MagicMock()
        self.d.secret_inventory = MagicMock(return_value={})

    def fail_gate(self, label):
        raise self.d.Stop(label)

    def test_file_checksums(self):
        p.files_gate(self.d)

    def test_baseline_is_fixed_and_includes_missing_row_detection(self):
        query = p.baseline_query()
        self.assertEqual(query.count("count(*)=1"), 9)
        self.assertNotIn("created_at <", query)
        with self.assertRaises(self.d.Stop):
            p.originals(self.d, {})

    def test_stop_does_not_require_healthy_credentials_or_baseline(self):
        self.d.sql.return_value = "off"
        with contextlib.redirect_stdout(io.StringIO()):
            p.run_stage(self.d, "stop-monitoring", {})
        self.d.apply.assert_called_once()
        self.d.secret_inventory.assert_not_called()
        self.d.management.assert_not_called()

    def test_finish_refuses_live_channels_without_unscheduling(self):
        self.d.sql.side_effect = ["off", "1"]
        with self.assertRaises(self.d.Stop):
            p.run_stage(self.d, "finish-rollback", {})
        self.d.apply.assert_not_called()
        self.d.management.assert_not_called()

    def test_finish_refuses_mode_pilot(self):
        self.d.sql.return_value = "pilot"
        with self.assertRaises(self.d.Stop):
            p.run_stage(self.d, "finish-rollback", {})
        self.d.apply.assert_not_called()

    def test_partial_credentials_fail(self):
        self.d.secret_inventory.return_value = {x: "x" for x in self.d.B1_SECRETS}
        self.d.credential_state = MagicMock(return_value=("partial", set(), True, False))
        with self.assertRaises(self.d.Stop):
            p.credentials(self.d, {})
        self.d.management.assert_not_called()

    def test_wrong_cron_command_fails(self):
        self.d.sql.return_value = json.dumps([dict(name=p.JOB, schedule="* * * * *", command="select 1",
                                                 active=True, database="postgres", username="postgres")])
        with self.assertRaises(self.d.Stop):
            p.cron(self.d, {}, True)

    def test_polling_job_fails(self):
        self.d.sql.return_value = '[{"name":"google-sheets-sync-every-minute"}]'
        with self.assertRaises(self.d.Stop):
            p.cron(self.d, {}, False)

    def test_mismatch_confirmation_refuses_before_connection(self):
        with patch.object(p, "load_helpers", return_value=self.d), patch.dict(os.environ,
             {"GITHUB_REF":"refs/heads/main", "STAGE":"activate-pilot", "CONFIRM":"check"}):
            self.d.connection_env = MagicMock()
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
                p.main()
            self.d.connection_env.assert_not_called()

    def test_non_main_refuses_before_connection(self):
        with patch.object(p, "load_helpers", return_value=self.d), patch.dict(os.environ,
             {"GITHUB_REF":"refs/heads/topic", "STAGE":"check", "CONFIRM":"check"}):
            self.d.connection_env = MagicMock()
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
                p.main()
            self.d.connection_env.assert_not_called()

    def test_pristine_failure_prevents_every_forward_write(self):
        self.d.readbacks = MagicMock()
        expected = json.loads((p.PLAN / "gate-e-edge-baseline.json").read_text())
        self.d.inventory = MagicMock(return_value={n:dict(status="ACTIVE",verify_jwt=False,ezbr_sha256=h) for n,h in expected.items()})
        with patch.object(p, "credentials", return_value={}), patch.object(p, "pristine", side_effect=self.d.Stop("drift")):
            for stage in ("check", "schedule-maintenance", "record-schedule", "activate-pilot"):
                with self.assertRaises(self.d.Stop):
                    p.run_stage(self.d, stage, {})
        self.d.apply.assert_not_called()
        self.d.management.assert_not_called()

    def forward_setup(self):
        self.d.readbacks = MagicMock()
        expected = json.loads((p.PLAN / "gate-e-edge-baseline.json").read_text())
        self.d.inventory = MagicMock(return_value={n:dict(status="ACTIVE",verify_jwt=False,ezbr_sha256=h) for n,h in expected.items()})

    def test_activation_scopes_before_enabling_and_never_rotates(self):
        self.forward_setup()
        calls=[]
        self.d.apply.side_effect=lambda *a: calls.append("scope")
        self.d.management.side_effect=lambda path,method,body: calls.append((path,method,body))
        before={"EXISTING":"digest"}
        after=before | {self.d.KILL_SWITCH:p.hashlib.sha256(b"true").hexdigest()}
        with patch.object(p,"credentials",side_effect=[before,after]), patch.object(p,"pristine"), patch.object(p,"active"):
            with contextlib.redirect_stdout(io.StringIO()):
                p.run_stage(self.d,"activate-pilot",{})
        self.assertEqual(calls,["scope",("secrets","POST",[{"name":self.d.KILL_SWITCH,"value":"true"}])])

    def test_activation_sql_failure_never_sets_flag(self):
        self.forward_setup()
        self.d.apply.side_effect=self.d.Stop("SQL failed")
        with patch.object(p,"credentials",return_value={}), patch.object(p,"pristine"):
            with self.assertRaises(self.d.Stop):
                p.run_stage(self.d,"activate-pilot",{})
        self.d.management.assert_not_called()

    def test_flag_failure_never_retries_or_rotates(self):
        self.forward_setup()
        self.d.management.side_effect=self.d.Stop("write outcome unknown")
        with patch.object(p,"credentials",return_value={}), patch.object(p,"pristine"), patch.object(p,"active"):
            with self.assertRaises(self.d.Stop):
                p.run_stage(self.d,"activate-pilot",{})
        self.d.apply.assert_called_once()
        self.d.management.assert_called_once()

    def test_check_never_writes(self):
        self.forward_setup()
        with patch.object(p,"credentials",return_value={}), patch.object(p,"pristine"):
            p.run_stage(self.d,"check",{})
        self.d.apply.assert_not_called()
        self.d.management.assert_not_called()

    def test_schedule_does_not_enable_flag(self):
        self.forward_setup()
        with patch.object(p,"credentials",return_value={}), patch.object(p,"pristine"), patch.object(p,"cron"):
            p.run_stage(self.d,"schedule-maintenance",{})
        self.d.apply.assert_called_once_with({},p.ROOT/p.SCHEDULE)
        self.d.management.assert_not_called()


if __name__ == "__main__":
    unittest.main()
