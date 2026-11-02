"""Operator transport regressions. Run only through the scheduled runner."""
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fork_web', Path(__file__).with_name('web.py'))
web = importlib.util.module_from_spec(spec)
# Importing the operator must not leave generated files in a deployment checkout.
previous_bytecode_setting = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    spec.loader.exec_module(web)
finally:
    sys.dont_write_bytecode = previous_bytecode_setting


class HarnessArtifactTransport(unittest.TestCase):
    def test_cpu_artifacts_come_from_the_host_selected_by_harness(self):
        # Fake only the process/SSH boundary. Exercise the real operator parser and transfer.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hosts = {'compute': {'ssh': 'worker@compute.example'},
                     'browser': {'ssh': 'worker@browser.example'}}
            config = root / 'config.env'
            config.write_text("HARNESS_HOSTS='" + json.dumps(hosts) + "'\n")
            harness = root / 'harness'
            harness.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
Path(os.environ['INVOCATION']).write_text(json.dumps(sys.argv[1:]))
if os.environ['REPORT_PLACEMENT'] == 'yes':
    print('harness: CPU placement ' + json.dumps({'selected_host': os.environ['SELECTED_HOST']}))
if os.environ['REPORT_PLACEMENT'] == 'deadline':
    print('harness: CPU placement deadline exceeded before sync: {}')
    sys.exit(76)
print('BUILD_EXPORT=/remote/export.tar')
''')
            scp = root / 'scp'
            scp.write_text('''#!/usr/bin/env python3
import os, sys
from pathlib import Path
Path(os.environ['TRANSFER']).write_text(sys.argv[-2])
Path(sys.argv[-1]).write_bytes(b'complete export')
''')
            harness.chmod(0o755)
            scp.chmod(0o755)
            for role, selected, placement in [('cpu', 'compute', 'yes'), ('cpu', 'browser', 'yes'), ('browser', 'browser', 'no')]:
                with self.subTest(role=role, selected=selected), patch.dict(os.environ, {
                    'PATH': str(root) + os.pathsep + os.environ['PATH'],
                    'HARNESS_CONFIG': str(config), 'SELECTED_HOST': selected,
                    'REPORT_PLACEMENT': placement, 'INVOCATION': str(root / 'invocation'),
                    'TRANSFER': str(root / 'transfer'),
                }):
                    output = root / (role + '-' + selected) / 'export.tar'
                    web.harness_artifact(role, ['build-command'], 'BUILD_EXPORT=', output)
                    self.assertEqual(output.read_bytes(), b'complete export')
                    self.assertEqual((root / 'transfer').read_text(), hosts[selected]['ssh'] + ':/remote/export.tar')
                    self.assertEqual(json.loads((root / 'invocation').read_text())[:2], ['run', role])
            with patch.dict(os.environ, {
                'PATH': str(root) + os.pathsep + os.environ['PATH'],
                'HARNESS_CONFIG': str(config), 'SELECTED_HOST': 'browser',
                'REPORT_PLACEMENT': 'no', 'INVOCATION': str(root / 'invocation'),
                'TRANSFER': str(root / 'unexpected-transfer'),
            }):
                with self.assertRaises(ValueError):
                    web.harness_artifact('cpu', ['build-command'], 'BUILD_EXPORT=', root / 'missing' / 'export.tar')
                self.assertFalse((root / 'unexpected-transfer').exists())
            # A queue-deadline diagnostic is not a placement and must fail as a missing artifact.
            with patch.dict(os.environ, {
                'PATH': str(root) + os.pathsep + os.environ['PATH'],
                'HARNESS_CONFIG': str(config), 'SELECTED_HOST': 'browser',
                'REPORT_PLACEMENT': 'deadline', 'INVOCATION': str(root / 'invocation'),
                'TRANSFER': str(root / 'unexpected-transfer'),
            }):
                with self.assertRaisesRegex(ValueError, 'did not produce'):
                    web.harness_artifact('cpu', ['build-command'], 'BUILD_EXPORT=', root / 'missing' / 'export.tar')
                self.assertFalse((root / 'unexpected-transfer').exists())


if __name__ == '__main__':
    unittest.main()
