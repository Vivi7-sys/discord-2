import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('verify_payload', Path(__file__).resolve().parents[1]/'packaging/verify.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Packaging(unittest.TestCase):
    def test_digest_installed_tampering_and_extra_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'Discord2Transmissor-0.1.2-beta1-windows-x64-setup.exe'
            (root/name).write_bytes(b'installer fixture')
            (root/'SHA256SUMS').write_text(hashlib.sha256((root/name).read_bytes()).hexdigest()+'  '+name+'\n')
            installed = root/'installed'
            installed.mkdir()
            payload = installed/'Discord2Transmissor.exe'
            payload.write_bytes(b'payload fixture')
            (root/'payload-audit.json').write_text(json.dumps({'machine':'AMD64','files':{payload.name:hashlib.sha256(payload.read_bytes()).hexdigest()}}))
            self.assertTrue(module.verify(root, installed))
            (installed/'.env').write_text('forbidden fixture')
            with self.assertRaises(ValueError): module.verify(root, installed)
            (installed/'.env').unlink()
            payload.write_bytes(b'tampered')
            with self.assertRaises(ValueError): module.verify(root, installed)
            (root/name).write_bytes(b'tampered installer')
            with self.assertRaises(ValueError): module.verify(root)
