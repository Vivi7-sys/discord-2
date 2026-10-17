"""Windows-only WGC + WASAPI adapters. Never request the default input device."""
from dataclasses import dataclass
import ctypes
from ctypes import wintypes
import sys
import threading
import time
from .config import SafeError
from .media import Latest, now_us, PcmConverter, letterbox_i420, audio_timestamp, FramePacer


def require_windows():
    if sys.platform != 'win32' or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise SafeError('Esta versão exige Windows 10/11 x64. Nenhuma captura foi iniciada.')
    if sys.getwindowsversion().build < 19041:
        raise SafeError('Use Windows 10 versão 2004 (build 19041) ou Windows 11 atualizado.')


@dataclass(frozen=True)
class Target:
    kind: str
    identifier: int
    name: str
    owner_pid: int = 0
    owner_created: int = 0


@dataclass(frozen=True)
class Output:
    index: int
    name: str
    channels: int
    rate: int
    default: bool = False

    @property
    def key(self):
        return self.index, self.name, self.channels, self.rate


def loopback_outputs(pa):
    """Only server-reported loopback devices in the WASAPI host API."""
    import pyaudiowpatch as audio
    host = pa.get_host_api_info_by_type(audio.paWASAPI)
    try:
        default = pa.get_default_wasapi_loopback()['index']
    except (OSError, ValueError, LookupError):
        default = None
    outputs = []
    for device in pa.get_loopback_device_info_generator():
        if (device.get('isLoopbackDevice') is True and device['hostApi'] == host['index']
                and 0 < device['maxInputChannels'] <= 8):
            outputs.append(Output(int(device['index']), str(device['name']), int(device['maxInputChannels']),
                                  round(device['defaultSampleRate']), device['index'] == default))
    return sorted(outputs, key=lambda d: (not d.default, d.name, d.index))


def outputs():
    require_windows()
    import pyaudiowpatch as audio
    with audio.PyAudio() as pa:
        return loopback_outputs(pa)


def targets(kind):
    require_windows()
    user = ctypes.WinDLL('user32', use_last_error=True)
    values = []
    if kind == 'window':
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user.IsWindowVisible.argtypes = [wintypes.HWND]
        user.GetWindowTextLengthW.argtypes = [wintypes.HWND]
        user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
        user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        @callback_type
        def found(hwnd, _):
            size = user.GetWindowTextLengthW(hwnd)
            if user.IsWindowVisible(hwnd) and size:
                title = ctypes.create_unicode_buffer(size + 1)
                user.GetWindowTextW(hwnd, title, size + 1)
                pid = wintypes.DWORD()
                user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                import os
                if pid.value != os.getpid():
                    # An inaccessible identity may still be used for video/system audio;
                    # application audio will reject it, never substitute a broader PID.
                    born = 0
                    try:
                        from .application_audio import window_identity
                        owner, born = window_identity(int(hwnd))
                        if owner != pid.value:
                            return True
                    except Exception:
                        pass
                    values.append(Target(kind, int(hwnd), title.value, pid.value, born))
            return True
        user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        user.EnumWindows(found, 0)
    elif kind == 'monitor':
        # Same unsorted EnumDisplayMonitors enumeration used by windows-capture.
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HANDLE, wintypes.HDC,
                                          ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
        class Info(ctypes.Structure):
            _fields_ = [('cbSize', wintypes.DWORD), ('monitor', wintypes.RECT), ('work', wintypes.RECT),
                        ('flags', wintypes.DWORD), ('device', wintypes.WCHAR * 32)]
        user.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Info)]
        monitor_count = 0
        @callback_type
        def found(handle, _dc, rect, _data):
            nonlocal monitor_count
            monitor_count += 1
            info = Info(); info.cbSize = ctypes.sizeof(info)
            if user.GetMonitorInfoW(handle, ctypes.byref(info)):
                index = monitor_count  # Include every enumerated handle, even if a prior label failed.
                r = info.monitor
                values.append(Target(kind, index, f'Tela {index}: {info.device} ({r.right-r.left}×{r.bottom-r.top})'))
            return True
        user.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.POINTER(wintypes.RECT), callback_type, wintypes.LPARAM]
        user.EnumDisplayMonitors(None, None, found, 0)
    else:
        raise ValueError('Invalid target type')
    return values


class Capture:
    def __init__(self, target, output, profile, stopped):
        self.target, self.output, self.profile = target, output, profile
        from .audio_choice import normalize
        self.audio_choice = normalize(output)
        self.stopped = stopped
        self.video = Latest(1)
        self.audio = Latest(5)  # At most ~100 ms, independent of video.
        self.cancel = threading.Event()
        self.control = self.capture = self.pa = self.stream = self.converter = None
        self.lock = threading.Lock()
        self.pacer = FramePacer(profile["fps"])
        self.raw_video = Latest(1)
        self.video_thread = None
        self.metrics = {'capturedVideo': 0, 'capturedAudio': 0, 'audioPeak': 0,
                        'audioSamples': 0, 'audioClipped': 0, 'videoLate': 0,
                        'wgcArrived': 0, 'pacedDropped': 0, 'convertedVideo': 0,
                        'conversionTotalMs': 0.0, 'conversionMaxMs': 0.0}

    def fail(self, message):
        if not self.cancel.is_set():
            self.cancel.set()
            self.stopped(message)

    def start(self):
        require_windows()
        # Fresh selection check: do not substitute another monitor/window after hotplug.
        if self.audio_choice.mode == 'application':
            from .application_audio import validate_target
            validate_target(self.target)
        current_targets = targets(self.target.kind)
        valid = any((item.identifier, item.owner_pid) == (self.target.identifier, self.target.owner_pid)
                    if self.target.kind == 'window' else item == self.target for item in current_targets)
        if not valid:
            raise SafeError('Tela/janela mudou ou foi fechada. Selecione novamente.')
        from windows_capture import WindowsCapture
        options = {'cursor_capture': True, 'draw_border': None,
                   'minimum_update_interval': None}
        options.update({'window_hwnd': self.target.identifier} if self.target.kind == 'window'
                       else {'monitor_index': self.target.identifier})
        self.capture = WindowsCapture(**options)
        @self.capture.event
        def on_frame_arrived(frame, capture_control):
            if self.cancel.is_set():
                capture_control.stop()
                return
            timestamp = now_us()
            self.metrics['wgcArrived'] += 1
            if not self.pacer.accept(timestamp):
                self.metrics['pacedDropped'] += 1
                return
            try:
                # The mapped GPU staging view expires at callback return. One owned
                # copy is required; conversion runs independently with latest-only input.
                self.raw_video.put((frame.frame_buffer.copy(), timestamp))
                self.metrics['capturedVideo'] += 1
            except Exception:
                self.fail('Falha na captura gráfica. Pare e selecione novamente.')
        @self.capture.event
        def on_closed():
            self.fail('A tela/janela capturada foi encerrada. Selecione novamente.')
        try:
            self.video_thread = threading.Thread(target=self.convert_video, name='d2-convert', daemon=True)
            self.video_thread.start()
            self.control = self.capture.start_free_threaded()
            if self.audio_choice.mode == 'application':
                from .application_audio import ApplicationStream
                self.stream = ApplicationStream(self.target, self.accept_audio, self.fail)
                self.stream.start_stream()
            elif self.audio_choice.mode == 'system':
                self.start_audio()
        except Exception as error:
            self.close()
            if isinstance(error, SafeError):
                raise
            raise SafeError('Não foi possível abrir a captura selecionada. Confira janela e saída de áudio.') from None

    def convert_video(self):
        try:
            import cv2
            # Avoid OpenCV creating a large competing worker pool alongside WebRTC.
            cv2.setNumThreads(1)
            while not self.cancel.is_set():
                frame = self.raw_video.get()
                if frame is None:
                    self.cancel.wait(.001)
                    continue
                bgra, timestamp = frame
                if now_us() - timestamp > 150_000:
                    self.metrics['videoLate'] += 1
                    continue
                begin = time.perf_counter()
                data = letterbox_i420(bgra, self.profile['width'], self.profile['height'])
                elapsed = (time.perf_counter() - begin) * 1000
                self.metrics['conversionTotalMs'] += elapsed
                self.metrics['conversionMaxMs'] = max(self.metrics['conversionMaxMs'], elapsed)
                self.metrics['convertedVideo'] += 1
                if not self.cancel.is_set():
                    self.video.put((data, timestamp))
        except Exception:
            self.fail('Falha ao converter vídeo. Pare e selecione novamente.')

    def start_audio(self):
        import pyaudiowpatch as audio
        self.pa = audio.PyAudio()
        selected = next((d for d in loopback_outputs(self.pa) if d.key == self.audio_choice.output.key), None)
        if selected is None:
            raise SafeError('Saída de áudio mudou. Selecione novamente; nenhum microfone será usado.')
        self.converter = PcmConverter(selected.channels, selected.rate)
        def callback(data, count, info, status):
            if self.cancel.is_set():
                return None, audio.paComplete
            if status:
                self.fail('O áudio foi interrompido. Confira a saída e reinicie.')
                return None, audio.paAbort
            try:
                # ADC time uses the PortAudio stream clock; map latency relative to current_time.
                timestamp = audio_timestamp(info, count, selected.rate)
                converted = self.converter.convert(data)
                self.accept_audio(converted, timestamp)
                return None, audio.paContinue
            except Exception:
                self.fail('Falha na captura WASAPI. Confira a saída e reinicie.')
                return None, audio.paAbort
        self.stream = self.pa.open(format=audio.paFloat32, channels=selected.channels,
                                   rate=selected.rate, frames_per_buffer=round(selected.rate / 50),
                                   input=True, input_device_index=selected.index,
                                   stream_callback=callback, start=False)
        self.stream.start_stream()

    def accept_audio(self, converted, timestamp):
        if self.cancel.is_set():
            return
        import numpy as np
        samples = np.frombuffer(converted, dtype='<i2').astype(np.int32)
        if samples.size:
            self.metrics['audioPeak'] = max(self.metrics['audioPeak'], int(np.abs(samples).max()))
            self.metrics['audioSamples'] += int(samples.size)
            self.metrics['audioClipped'] += int((np.abs(samples) >= 32767).sum())
        self.audio.put((converted, timestamp))
        self.metrics['capturedAudio'] += 1

    def close(self):
        with self.lock:
            self.cancel.set()
            errors = []
            if self.stream:
                try:
                    self.stream.stop_stream()
                except Exception as error:
                    errors.append(error)
                try:
                    self.stream.close()
                except Exception as error:
                    errors.append(error)
                self.stream = None
            if self.pa:
                try:
                    self.pa.terminate()
                except Exception as error:
                    errors.append(error)
                self.pa = None
            if self.converter:
                try:
                    self.converter.close()
                except Exception as error:
                    errors.append(error)
                self.converter = None
            if self.control:
                try:
                    self.control.stop()
                    self.control.wait()
                except Exception as error:
                    errors.append(error)
                self.control = None
            if self.video_thread:
                self.video_thread.join(timeout=5)
                if self.video_thread.is_alive():
                    errors.append(RuntimeError('Video conversion did not stop'))
                self.video_thread = None
            self.metrics['rawDropped'] = self.raw_video.dropped
            self.metrics['videoDropped'] = self.video.dropped
            self.metrics['audioDropped'] = self.audio.dropped
            self.raw_video.clear()
            self.video.clear()
            self.audio.clear()
            if errors:
                raise SafeError('Não foi possível confirmar o encerramento de todos os dispositivos.')
