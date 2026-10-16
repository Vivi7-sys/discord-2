import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import configuration
from capture import monitors

class Security(unittest.TestCase):
    def test_invite_origin_and_room(self):
        c = configuration('https://example.com/sala/'+'a'*64, ' Vivi ', 60, None)
        self.assertEqual(c['base'], 'https://example.com')
        self.assertEqual(c['name'], 'Vivi')
        self.assertFalse(c['audio'])

    def test_reject_untrusted_input(self):
        for url in ['http://example.com/sala/'+'a'*64, 'https://a:b@example.com/sala/'+'a'*64,
                    'https://example.com/sala/no', 'file:///sala/'+'a'*64]:
            with self.assertRaises(ValueError):
                configuration(url, 'Vivi', 30, None)

    def test_backend_name_contract(self):
        for name in ['a', 'a'*25, 'Vivi\nSilva']:
            with self.assertRaises(ValueError):
                configuration('https://example.com/sala/'+'a'*64, name, 30, None)

    def test_microphones_and_remaps_are_not_offered(self):
        import json
        sources = [{'name':'mic','monitor_source':''}, {'name':'screen_share_audio','monitor_source':''},
                   {'name':'speaker.monitor','monitor_source':'speaker'},
                   {'name':'fake.monitor','monitor_source':''}]
        sinks = [{'name':'speaker','index':0,'monitor_source':'speaker.monitor'}]
        with patch('audio.pulse_output', side_effect=[json.dumps(sources),json.dumps(sinks),b'speaker\n']):
            self.assertEqual([s['name'] for s in monitors()], ['speaker.monitor'])

class PortalContract(unittest.TestCase):
    def test_gio_six_argument_response_contract(self):
        import threading
        from capture import Portal
        from gi.repository import GLib
        class Bus:
            def get_unique_name(self):
                return ':1.42'
            def signal_subscribe(self, *args):
                self.callback = args[-1]
                return 1
            def call_sync(self, *args):
                # Signature confirmed against installed Gio's real D-Bus signal.
                self.callback(self, ':1.1', '/request', 'org.freedesktop.portal.Request',
                              'Response', GLib.Variant('(ua{sv})',
                              (0, {'session_handle': GLib.Variant('s', '/test/session')})))
            def signal_unsubscribe(self, sub):
                self.unsubscribed = sub
        portal = Portal.__new__(Portal)
        portal.bus = Bus()
        portal.cancelled = threading.Event()
        portal.pending = None
        result = portal.request('CreateSession', '(a{sv})', (), {})
        self.assertEqual(result, {'session_handle': '/test/session'})
        self.assertEqual(portal.bus.unsubscribed, 1)

class SelectionType(unittest.TestCase):
    def test_wrong_source_type_or_multiple_streams_rejected_before_remote_fd(self):
        from capture import Portal
        from unittest.mock import Mock
        import threading
        for streams in ([],[(42,{'source_type':1})],[(42,{'source_type':2}),(43,{'source_type':2})]):
            portal=Portal.__new__(Portal)
            portal.bus=Mock();portal.ended=lambda:None;portal.cancelled=threading.Event()
            portal.request=Mock(side_effect=[{'session_handle':'/test'}, {}, {'streams':streams}])
            with self.subTest(streams=streams),self.assertRaises(RuntimeError):portal.open(2)
            portal.bus.call_with_unix_fd_list_sync.assert_not_called()
