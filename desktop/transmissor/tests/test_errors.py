import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import transmission_error

class Errors(unittest.TestCase):
    def test_clear_auth_conflict_and_disconnect_messages(self):
        self.assertIn('Convite',transmission_error('token','API 403'))
        self.assertIn('Outra pessoa',transmission_error('acquire','API 409'))
        self.assertIn('Conexão perdida',transmission_error('connection','Disconnected'))
        self.assertIn('Aguarde',transmission_error('token','API 429'))
    def test_raw_sdk_or_server_text_is_never_displayed(self):
        for stage in ('token','connect','acquire','publish-video'):
            self.assertNotIn('sensitive',transmission_error(stage,'sensitive token example'))
