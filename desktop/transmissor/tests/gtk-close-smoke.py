#!/usr/bin/python3
"""Actual GTK close-while-active path with a simulated session, no media/network."""
import json
import os
from pathlib import Path
import sys
import threading
from unittest.mock import patch
sys.path.insert(0,os.environ.get('DISCORD2_TEST_RUNTIME_DIR',str(Path(__file__).resolve().parents[1])))
from app import Window, Gtk, GLib
class SessionFixture:
    def __init__(self,status):
        self.status=status
        self.cancel=threading.Event()
        self.started=threading.Event()
    def run(self,*args):
        self.started.set()
        self.cancel.wait(5)
        self.status('Parado',True)
    def stop(self):self.cancel.set()
    def diagnostic(self):return {'fixture':True}
window=Window()
window.invite.set_text('https://discord-2-kuau.onrender.com/sala/'+'0'*64)
window.name.set_text('GTK fixture')
window.audio.set_active_id('none')
window.show_all()
with patch('app.Session',SessionFixture):
    window.start()
    session=window.session
    def close():
        if not session.started.is_set():return True
        window.close()
        assert window.closing
        assert not window.get_sensitive()
        return False
    GLib.timeout_add(50,close)
    timeout=GLib.timeout_add_seconds(8,lambda:(Gtk.main_quit(),False)[1])
    Gtk.main()
    GLib.source_remove(timeout)
assert session.cancel.is_set()
assert window.session is None
assert window.last_session is session
print(json.dumps({'realGtkCloseWhileActive':True,'sessionSimulated':True,'captureStarted':False,'closeWaitedForCompletion':True}))
