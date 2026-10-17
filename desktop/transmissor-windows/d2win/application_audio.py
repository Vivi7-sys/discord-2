"""Private native DLL bridge; render-only process tree capture, never global fallback."""
import ctypes
from pathlib import Path
import sys
import threading
from .config import SafeError, resource
from .media import now_us

MIN_BUILD = 20348
UNSUPPORTED = 'Áudio do aplicativo exige Windows build 20348+ (Windows 11). No Windows 10 comum, escolha explicitamente sistema inteiro ou sem áudio.'


def supported(build=None):
    if build is None:
        if sys.platform != 'win32':
            return False
        build = sys.getwindowsversion().build
    return build >= MIN_BUILD


def native_path():
    if getattr(sys, 'frozen', False):
        return resource('d2_application_loopback.dll')
    return Path(__file__).resolve().parents[1]/'build/native/d2_application_loopback.dll'


def load_native():
    if sys.platform != 'win32':
        raise SafeError('Application Loopback só está disponível no Windows.')
    try:
        dll = ctypes.CDLL(str(native_path()))  # Absolute path; no PATH/current-directory lookup.
    except OSError:
        raise SafeError('Componente de áudio do aplicativo ausente ou incompatível. Reinstale o transmissor.') from None
    dll.d2_loopback_abi.restype = ctypes.c_uint32
    if dll.d2_loopback_abi() != 1:
        raise SafeError('Componente de áudio incompatível. Reinstale o aplicativo.')
    dll.d2_loopback_identity.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint64)]
    dll.d2_loopback_identity.restype = ctypes.c_int32
    return dll


def window_identity(hwnd):
    dll = load_native()
    pid, born = ctypes.c_uint32(), ctypes.c_uint64()
    if dll.d2_loopback_identity(hwnd, ctypes.byref(pid), ctypes.byref(born)) < 0:
        raise SafeError('Não foi possível identificar com segurança o processo da janela. Atualize a seleção.')
    return pid.value, born.value


def validate_target(target, build=None):
    if not supported(build):
        raise SafeError(UNSUPPORTED)
    if target.kind != 'window' or target.owner_pid <= 0 or getattr(target, 'owner_created', 0) <= 0:
        raise SafeError('Áudio do aplicativo exige uma janela com processo identificado. Selecione novamente.')
    if window_identity(target.identifier) != (target.owner_pid, target.owner_created):
        raise SafeError('O processo da janela mudou. Selecione novamente; áudio global não será usado.')


class ApplicationStream:
    """PortAudio-compatible ownership surface; COM lives only on the owned thread."""
    def __init__(self, target, received, failed):
        self.target, self.received, self.failed = target, received, failed
        self.ready = threading.Event()
        self.done = threading.Event()
        self.thread = None
        self.stop_handle = None
        self.result = None
        self.dll = None
        self.callback = None
        self.kernel = None

    def start_stream(self):
        validate_target(self.target)
        self.dll = load_native()
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateEventW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_wchar_p]
        self.kernel.CreateEventW.restype = ctypes.c_void_p
        self.kernel.SetEvent.argtypes = [ctypes.c_void_p]
        self.kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        self.stop_handle = self.kernel.CreateEventW(None, True, False, None)
        if not self.stop_handle:
            raise SafeError('Não foi possível preparar o áudio do aplicativo.')
        callback_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint64, ctypes.c_uint32)
        @callback_type
        def receive(data, frames, age_us, flags):
            try:
                if not frames:
                    self.ready.set()
                    return 1
                raw = ctypes.string_at(data, frames*4)
                # GetBuffer QPC age maps into the same monotonic domain as video.
                timestamp = now_us()-min(age_us, 10_000_000)
                # Bound each queued block to 20 ms. Never keep the native buffer view.
                for offset in range(0, frames, 960):
                    self.received(raw[offset*4:(offset+960)*4], timestamp+round(offset*1_000_000/48000))
                return 1
            except Exception:
                return 0
        self.callback = receive  # Keep callable alive until the native worker has joined.
        self.dll.d2_loopback_run.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint64, ctypes.c_void_p, callback_type]
        self.dll.d2_loopback_run.restype = ctypes.c_int32
        def run():
            try:
                self.result = self.dll.d2_loopback_run(self.target.identifier, self.target.owner_pid,
                    self.target.owner_created, self.stop_handle, self.callback)
                if self.result < 0:
                    self.failed('Áudio do aplicativo indisponível ou processo encerrado. Atualize a janela e reinicie; áudio global não foi usado.')
            except Exception:
                self.result = -1
                self.failed('Falha no áudio do aplicativo. Pare e selecione novamente; áudio global não foi usado.')
            finally:
                self.done.set()
                self.ready.set()
        self.thread = threading.Thread(target=run, name='D2-application-loopback', daemon=True)
        self.thread.start()
        if not self.ready.wait(12) or self.done.is_set():
            self.close()
            raise SafeError('Não foi possível iniciar o áudio do aplicativo. Verifique suporte do Windows e a janela; não há fallback global.')

    def is_active(self):
        return self.thread is not None and not self.done.is_set()

    def stop_stream(self):
        if self.stop_handle:
            self.kernel.SetEvent(self.stop_handle)
        if self.thread:
            self.thread.join(timeout=12)
            if self.thread.is_alive():
                raise SafeError('Áudio do aplicativo não confirmou encerramento. Feche o transmissor.')

    def close(self):
        self.stop_stream()
        if self.stop_handle:
            self.kernel.CloseHandle(self.stop_handle)
            self.stop_handle = None
        self.thread = None
        self.callback = None
