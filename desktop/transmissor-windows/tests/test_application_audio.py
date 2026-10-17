"""Policy/ownership tests; native run is NEVER treated as real Windows audio validation."""
import ctypes
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from d2win.application_audio import supported, validate_target, ApplicationStream
from d2win.native_windows import Target, Output, Capture
from d2win.audio_choice import selection, normalize, AudioChoice
from d2win.config import SafeError

class ApplicationAudio(unittest.TestCase):
    def test_windows_build_boundary(self):
        self.assertFalse(supported(19045));self.assertFalse(supported(20347))
        self.assertTrue(supported(20348));self.assertTrue(supported(22000))
    def test_rejects_monitor_inaccessible_and_pid_reuse_without_fallback(self):
        for target in [Target('monitor',1,'screen'),Target('window',1,'game',20,0),Target('window',1,'game',0,1)]:
            with self.assertRaises(SafeError):validate_target(target,22000)
        target=Target('window',1,'game',20,30)
        with patch('d2win.application_audio.window_identity',return_value=(20,31)):
            with self.assertRaises(SafeError):validate_target(target,22000)
        with patch('d2win.application_audio.window_identity',return_value=(20,30)):
            validate_target(target,22000)
    def test_three_modes_and_no_global_fallback(self):
        target=Target('window',1,'game',20,30);output=Output(3,'USB',2,48000,True)
        with patch('d2win.application_audio.validate_target',side_effect=SafeError('unsupported')):
            with self.assertRaises(SafeError):selection(0,target,output)
        self.assertEqual(selection(1,target,output),AudioChoice('system',output))
        self.assertIsNone(selection(2,target,output))
        with self.assertRaises(SafeError):selection(1,target)
        with self.assertRaises(SafeError):normalize(AudioChoice('invalid',output))
    def test_application_capture_does_not_open_pyaudio_or_route_system(self):
        target=Target('window',1,'game',20,30)
        capture=Capture(target,AudioChoice('application'),{'fps':30},lambda _:None)
        self.assertEqual(capture.audio_choice.mode,'application')
        # PCM16 is accepted directly with unity gain, no microphone/endpoint API.
        capture.accept_audio(b'\x10\x00\xf0\xff',123)
        self.assertEqual(capture.audio.get(),(b'\x10\x00\xf0\xff',123))
        capture.close();self.assertIsNone(capture.pa)
    def test_stream_close_is_idempotent_and_waits_before_closing_handle(self):
        stream=ApplicationStream(None,None,None)
        stream.kernel=Mock();stream.stop_handle=42;stream.thread=Mock()
        stream.thread.is_alive.return_value=False
        stream.close();stream.close()
        stream.kernel.CloseHandle.assert_called_once_with(42)
        self.assertIsNone(stream.callback)
    def test_stuck_thread_retains_handle_and_callback_until_owned_process_ends(self):
        stream=ApplicationStream(None,None,None)
        stream.kernel=Mock();stream.stop_handle=42;stream.thread=Mock();stream.callback=object()
        stream.thread.is_alive.return_value=True
        with self.assertRaises(SafeError):stream.close()
        stream.kernel.CloseHandle.assert_not_called();self.assertIsNotNone(stream.callback)
    @unittest.skipUnless(sys.platform=='win32','Windows DLL ABI only, no audio capture')
    def test_native_dll_abi_and_rejection_of_invalid_hwnd(self):
        from d2win.application_audio import load_native
        dll=load_native();pid=ctypes.c_uint32();birth=ctypes.c_uint64()
        self.assertLess(dll.d2_loopback_identity(None,ctypes.byref(pid),ctypes.byref(birth)),0)
        self.assertEqual((pid.value,birth.value),(0,0))

    def test_application_activation_failure_closes_video_never_starts_system_audio(self):
        target=Target('window',1,'game',20,30)
        capture=Capture(target,AudioChoice('application'),{'fps':30},lambda _:None)
        control=Mock();fake_capture=Mock();fake_capture.start_free_threaded.return_value=control
        fake_capture.event=lambda callback:callback
        with patch('d2win.native_windows.require_windows'),patch('d2win.native_windows.targets',return_value=[target]),patch('d2win.application_audio.validate_target'),patch.dict(sys.modules,{'windows_capture':types.SimpleNamespace(WindowsCapture=lambda **_:fake_capture)}),patch('d2win.application_audio.ApplicationStream') as adapter,patch.object(capture,'start_audio') as global_audio:
            adapter.return_value.start_stream.side_effect=SafeError('application denied')
            with self.assertRaisesRegex(SafeError,'application denied'):capture.start()
            global_audio.assert_not_called();control.stop.assert_called_once();control.wait.assert_called_once()
            adapter.return_value.close.assert_called_once()
        self.assertIsNone(capture.pa)

    @unittest.skipUnless(sys.platform=='win32','Real HWND identity test only, no audio/video capture')
    def test_native_identity_of_child_window_and_creation_time_guard(self):
        import subprocess
        from d2win.application_audio import window_identity
        code="import tkinter as tk; w=tk.Tk(); w.update(); print(w.winfo_id(),flush=True); w.mainloop()"
        process=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.PIPE,text=True)
        try:
            hwnd=int(process.stdout.readline().strip())
            pid,born=window_identity(hwnd)
            self.assertEqual(pid,process.pid);self.assertGreater(born,0)
            with self.assertRaises(SafeError):validate_target(Target('window',hwnd,'fixture',pid,born+1),22000)
        finally:
            process.terminate();process.wait(timeout=10);process.stdout.close()

    def test_stream_passes_exact_identity_and_copies_pcm_then_joins(self):
        import d2win.application_audio as adapter
        stopped=threading.Event();received=Mock();failed=Mock();kernel=Mock()
        kernel.CreateEventW.return_value=42
        kernel.SetEvent.side_effect=lambda _:stopped.set()
        dll=Mock();target=Target('window',7,'game',20,30)
        def native_run(hwnd,pid,born,stop,callback):
            self.assertEqual((hwnd,pid,born,stop),(7,20,30,42))
            callback(None,0,0,0)
            buffer=ctypes.create_string_buffer(b'\x10\x00\xf0\xff')
            callback(ctypes.addressof(buffer),1,20000,0)
            stopped.wait(2)
            return 0
        dll.d2_loopback_run.side_effect=native_run
        with patch.object(adapter,'validate_target'),patch.object(adapter,'load_native',return_value=dll),patch.object(ctypes,'WinDLL',return_value=kernel,create=True),patch.object(ctypes,'WINFUNCTYPE',ctypes.CFUNCTYPE,create=True):
            stream=ApplicationStream(target,received,failed)
            stream.start_stream()
            stream.close()
        failed.assert_not_called();received.assert_called_once()
        self.assertEqual(received.call_args.args[0],b'\x10\x00\xf0\xff')
        kernel.CloseHandle.assert_called_once_with(42)
        self.assertTrue(stream.done.is_set())

    def test_native_activation_error_closes_handle_and_never_delivers_audio(self):
        import d2win.application_audio as adapter
        received=Mock();failed=Mock();kernel=Mock();kernel.CreateEventW.return_value=42
        dll=Mock();dll.d2_loopback_run.return_value=-1
        with patch.object(adapter,'validate_target'),patch.object(adapter,'load_native',return_value=dll),patch.object(ctypes,'WinDLL',return_value=kernel,create=True),patch.object(ctypes,'WINFUNCTYPE',ctypes.CFUNCTYPE,create=True):
            stream=ApplicationStream(Target('window',7,'game',20,30),received,failed)
            with self.assertRaises(SafeError):stream.start_stream()
        received.assert_not_called();failed.assert_called_once();kernel.CloseHandle.assert_called_once_with(42)
