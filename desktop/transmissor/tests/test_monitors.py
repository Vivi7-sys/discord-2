import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audio import output_monitors, monitor_state, monitors

USB='alsa_output.usb-0c76_USB_PnP_Audio_Device-00.analog-stereo'

class MonitorEnumeration(unittest.TestCase):
    def test_usb_null_description_and_suspended_default(self):
        sources=[{'name':USB+'.monitor','monitor_source':USB,'description':'(null)','state':'SUSPENDED'}]
        sinks=[{'name':USB,'index':69,'monitor_source':USB+'.monitor','description':None,
                'properties':{'device.description':'USB PnP Audio Device'}}]
        actual=output_monitors(sources,sinks,USB)
        self.assertEqual(len(actual),1)
        self.assertEqual(actual[0]['name'],USB+'.monitor')
        self.assertIn('USB PnP Audio Device',actual[0]['description'])
        self.assertIn('(padrão)',actual[0]['description'])
        with patch('audio.pulse_output',side_effect=[json.dumps(sources),json.dumps(sinks)]):
            self.assertTrue(monitor_state(USB+'.monitor')['monitorConfirmed'])

    def test_indices_zero_and_strings_and_nonstandard_names(self):
        sources=[{'index':8,'name':'valid-monitor','monitor_of_sink':0}]
        sinks=[{'index':0,'name':'output','monitor_source':'8'}]
        self.assertEqual(output_monitors(sources,sinks)[0]['name'],'valid-monitor')

    def test_mic_fake_suffix_dangling_and_conflicting_reverse_rejected(self):
        sources=[{'name':'mic','monitor_source':''},
                 {'name':'fake.monitor','monitor_source':'output'},
                 {'name':'gone.monitor','monitor_source':'gone'},
                 {'name':'invalid.monitor','monitor_source':'4294967295'}]
        sinks=[{'name':'output','index':4,'monitor_source':'real.monitor'}]
        self.assertEqual(output_monitors(sources,sinks,'mic'),[])
        with patch('audio.pulse_output',side_effect=[json.dumps(sources),json.dumps(sinks)]):
            with self.assertRaises(ValueError):monitor_state('fake.monitor')

    def test_all_valid_states_and_friendly_disambiguation(self):
        sources=[{'name':n+'.monitor','monitor_source':n,'state':state}
                 for n,state in [('one','IDLE'),('two','RUNNING'),('three','SUSPENDED')]]
        sinks=[{'name':n,'monitor_source':n+'.monitor','description':'Same'} for n in ['one','two','three']]
        actual=output_monitors(sources,sinks)
        self.assertEqual(len(actual),3)
        self.assertEqual(len({s['description'] for s in actual}),3)

    def test_default_query_failure_does_not_hide_monitors(self):
        import subprocess
        with patch('audio.pulse_output',side_effect=[json.dumps([{'name':'a.monitor','monitor_source':'a'}]),
             json.dumps([{'name':'a','monitor_source':'a.monitor'}]),subprocess.TimeoutExpired('pactl',3)]):
            actual=monitors()
        self.assertEqual(actual[0]['name'],'a.monitor')
        self.assertFalse(actual[0]['isDefault'])
