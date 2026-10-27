import os
import unittest
from unittest.mock import patch, Mock
import google_sheets_rollout_release as r

class Gates(unittest.TestCase):
    def setUp(self):
        self.d=Mock()
        self.d.command.return_value='a'*40
        def require(value, message):
            if not value: raise ValueError(message)
        self.d.require.side_effect=require
    def test_dispatch(self):
        with patch.dict(os.environ,dict(STAGE='check',CONFIRM='check',GITHUB_REF='refs/heads/main',GITHUB_SHA='a'*40,REVIEWED_SHA='a'*40),clear=True):
            self.assertEqual(r.dispatch_gate(self.d),'check')
    def test_dispatch_refuses_mismatch(self):
        for override in ({'CONFIRM':'activate'},{'GITHUB_REF':'refs/heads/other'},{'REVIEWED_SHA':'b'*40},{'STAGE':'sql'}):
            env=dict(STAGE='check',CONFIRM='check',GITHUB_REF='refs/heads/main',GITHUB_SHA='a'*40,REVIEWED_SHA='a'*40);env.update(override)
            with patch.dict(os.environ,env,clear=True),self.assertRaises(ValueError): r.dispatch_gate(self.d)
    def test_emergency_independent(self):
        with patch.object(r.pilot,'run_stage') as stop:
            r.run_stage(self.d,'stop-monitoring',{})
            stop.assert_called_once_with(self.d,'stop-monitoring',{})
            self.d.readbacks.assert_not_called()
    def test_failed_preflight_never_writes(self):
        self.d.readbacks.side_effect=ValueError('drift')
        with self.assertRaises(ValueError): r.run_stage(self.d,'activate',{})
        self.d.apply.assert_not_called()
if __name__=='__main__': unittest.main()
