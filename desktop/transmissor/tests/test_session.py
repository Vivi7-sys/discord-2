"""Lifecycle tests with a local IPC peer, no LiveKit/portal/device access."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import Session, configuration, save_diagnostic
from capture import SelectionCancelled


class FakePortal:
    def __init__(self,stop):
        self.cancelled=threading.Event();self.fd=None;self.closed=False
    def open(self,kind):return (1,{})
    def close(self):self.closed=True


class FakeCapture:
    def __init__(self,output,stop,audio):self.stop_session=stop;self.pipelines=[];self.counts=[0,0]
    def start(self,*args):self.stop_session()
    def stop(self):self.pipelines.clear()
    def snapshot(self):return {'video':{'fps':0}}


class SessionLifecycle(unittest.TestCase):
    def test_repeated_stop_sends_only_one_termination_signal(self):
        from unittest.mock import Mock
        session=Session(lambda *args:None)
        session.child=Mock()
        session.child.poll.return_value=None
        session.stop()
        session.stop()
        session.child.terminate.assert_called_once()

    def test_stop_closes_ipc_reader_and_reports_explicit_release(self):
        # The peer exercises real stdin/stdout/SIGTERM ownership, but has no network.
        code='''import json,signal,sys
json.loads(sys.stdin.readline())
def stop(*args):
 print(json.dumps({'state':'reservation-released'}),flush=True)
 print(json.dumps({'state':'stopped'}),flush=True)
 sys.exit(0)
signal.signal(signal.SIGTERM,stop)
print(json.dumps({'state':'reservation-acquired'}),flush=True)
print(json.dumps({'state':'ready'}),flush=True)
signal.pause()
'''
        real_popen=subprocess.Popen
        def peer(*args,**kwargs):return real_popen([sys.executable,'-c',code],**kwargs)
        session=Session(lambda *args:None)
        config=configuration('https://example.com/sala/'+'a'*64,'Teste privado',30,None)
        with patch('app.Portal',FakePortal),patch('app.Capture',FakeCapture),patch('app.subprocess.Popen',peer):
            session.run(config,1,None)
        report=session.diagnostic()
        self.assertTrue(report['acquired']);self.assertTrue(report['releaseConfirmed'])
        self.assertTrue(report['publisherStopped']);self.assertFalse(report['publisherKilled'])
        self.assertTrue(all(report['resources'].values()))
        with patch.object(session.capture,'snapshot',side_effect=AssertionError('Do not resample stopped capture')):
            self.assertEqual(session.diagnostic()['capture'],report['capture'])
        encoded=json.dumps(report)
        self.assertNotIn('example.com',encoded);self.assertNotIn('a'*64,encoded)
        self.assertNotIn('Teste privado',encoded)
        self.assertTrue(session.portal.closed)

    def test_cancelled_selection_does_not_spawn_publisher(self):
        class CancelPortal(FakePortal):
            def open(self,kind):raise SelectionCancelled('Seleção cancelada')
        session=Session(lambda *args:None)
        config=configuration('https://example.com/sala/'+'b'*64,'Teste',30,None)
        with patch('app.Portal',CancelPortal),patch('app.subprocess.Popen') as spawn:
            session.run(config,2,None)
        spawn.assert_not_called();self.assertIsNone(session.failure)
        self.assertTrue(session.portal.closed)
        self.assertFalse(session.diagnostic()['acquired'])

    def test_reports_are_explicit_private_new_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            one=save_diagnostic({'type':'test-fixture'},Path(tmp))
            two=save_diagnostic({'type':'test-fixture'},Path(tmp))
            self.assertNotEqual(one,two)
            self.assertEqual(os.stat(one).st_mode&0o777,0o600)
            self.assertEqual(json.loads(one.read_text()),{'type':'test-fixture'})
