#!/usr/bin/python3
"""Real GTK + read-only Pulse enumeration; simulated hotplug, never captures audio."""
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,os.environ.get('DISCORD2_TEST_RUNTIME_DIR',str(Path(__file__).resolve().parents[1])))
from app import Window, Gtk, GLib, monitors

actual=monitors()
window=Window()
window.show_all()
def ids():return [row[1] for row in window.audio.get_model()]
assert set(ids())=={'none',*(item['name'] for item in actual)}
expected=next((item['name'] for item in actual if item['isDefault']),'none')
assert window.audio.get_active_id()==expected
assert window.session is None
fixtures=[{'name':'usb.monitor','description':'USB — áudio da saída (padrão)','isDefault':True},
          {'name':'hdmi.monitor','description':'HDMI — áudio da saída','isDefault':False}]
with patch('app.monitors',return_value=fixtures):
    window.refresh_audio(initial=True)
    assert window.audio.get_active_id()=='usb.monitor'
    window.audio.set_active_id('hdmi.monitor')
    window.refresh_audio()
    assert window.audio.get_active_id()=='hdmi.monitor'
    window.audio.set_active_id('none')
    window.refresh_audio()
    assert window.audio.get_active_id()=='none'
    window.audio.set_active_id('usb.monitor')
with patch('app.monitors',return_value=fixtures[1:]):
    window.refresh_audio()
    assert window.audio.get_active_id()=='none'
    assert 'removida' in window.audio_notice.get_text()
with patch('app.monitors',side_effect=RuntimeError('Disconnected')):
    window.refresh_audio()
    assert ids()==['none']
    assert 'Não foi possível' in window.audio_notice.get_text()
window.session=object()
with patch('app.monitors') as query:
    window.refresh_audio()
    query.assert_not_called()
window.session=None
window.refresh_audio()
assert window.audio.get_active_id()=='none'
assert set(ids())=={'none',*(item['name'] for item in actual)}
GLib.timeout_add(250,lambda:(window.close(),False)[1])
Gtk.main()
print(json.dumps({'gtk':True,'captureStarted':False,'manualChoicePreserved':True,
 'disconnectionDisablesAudio':True,'activeSessionUnchanged':True,
 'devices':[{k:item[k] for k in ('name','description','isDefault')} for item in actual]}))
