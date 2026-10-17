"""UI state logic only, with widget doubles; NOT a Windows GUI/capture test."""
import importlib.util
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from d2win.native_windows import Target, Output

class Combo:
    def __init__(self,index=0):self.index=index;self.values=[]
    def current(self,index=None):
        if index is not None:self.index=index
        return self.index
    def __setitem__(self,key,value):setattr(self,key,value)
    def set(self,value):self.index=-1
    def configure(self,**kwargs):pass
class Value:
    def set(self,text):self.text=text

spec=importlib.util.spec_from_file_location('d2win.ui_fixture',Path(__file__).resolve().parents[1]/'d2win/ui.py')
ui=importlib.util.module_from_spec(spec)
tk=types.ModuleType('tkinter');tk.ttk=types.SimpleNamespace(Combobox=Combo);tk.messagebox=Mock()
with patch.dict(sys.modules,{'tkinter':tk}):spec.loader.exec_module(ui)

def window():
    app=ui.App.__new__(ui.App)
    app.process=None;app.closing=False;app.kind=Combo();app.target=Combo();app.audio=Combo()
    app.target_items=[];app.audio_items=[];app.status=Value()
    return app

class UiState(unittest.TestCase):
    def test_absent_wasapi_does_not_hide_video_targets(self):
        app=window()
        with patch.object(ui,'targets',return_value=[Target('monitor',1,'Display')]),patch.object(ui,'outputs',side_effect=OSError()):
            app.refresh(initial=True)
        self.assertEqual(app.target.values,['Display']);self.assertEqual(app.audio.values,['Sem áudio'])
        self.assertEqual(app.audio.current(),0)
    def test_default_output_change_preserves_manual_usb_choice(self):
        app=window();app.audio_items=[Output(5,'USB',2,48000,True)];app.audio.current(1)
        with patch.object(ui,'targets',return_value=[]),patch.object(ui,'outputs',return_value=[Output(5,'USB',2,48000,False),Output(6,'HDMI',2,48000,True)]):
            app.refresh()
        self.assertEqual(app.audio.current(),1)
    def test_close_waits_for_owned_worker_and_no_device_refresh_during_session(self):
        app=window();app.process=Mock();app.process.is_alive.return_value=False;app.process.exitcode=0
        app.receiver=Mock();app.receiver.poll.return_value=False
        app.cancel=threading.Event();app.stop_time=None;app.controls=[]
        app.start_button=Mock();app.stop_button=Mock();app.root=Mock();app.last_report={}
        with patch.object(ui,'outputs') as query:
            app.refresh();query.assert_not_called()
        app.close();self.assertTrue(app.cancel.is_set());self.assertTrue(app.closing)
        app.root.destroy.assert_not_called()
        app.poll();app.root.destroy.assert_called_once();self.assertIsNone(app.process)
