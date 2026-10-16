#!/usr/bin/python3
"""Visible GTK UI only; no backend, portal selection, capture or microphone."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import Window, Gtk, GLib, monitors
from reference import Reference
window=Window();window.show_all()
reference=Reference();reference.show_all()
assert window.session is None
assert window.audio.get_active_id()==next((s['name'] for s in monitors() if s['isDefault']),'none')
assert window.profile.get_active()==0
assert not window.stop_button.get_sensitive()
def finish():
    assert reference.drawn_frames>0
    reference.close();window.close();return False
GLib.timeout_add(1000,finish)
Gtk.main()
print(json.dumps({'gtkWindowOpened':True,'audioDefaultIsVerifiedOutputOrNone':True,'defaultProfile':'1080p30','captureStarted':False,'closed':True,'referenceRendered':True}))
