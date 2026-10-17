import argparse
import asyncio
import json
import multiprocessing
from pathlib import Path
import sys


def self_check():
    from .native_windows import require_windows
    require_windows()
    from PySide6.QtWidgets import QApplication
    from .ui import App
    import windows_capture
    import pyaudiowpatch
    from livekit import rtc
    from .config import PROFILES
    from .application_audio import load_native, supported
    load_native()
    source = rtc.VideoSource(1280, 720, is_screencast=True)
    asyncio.run(source.aclose())
    from .sdk import dispose_runtime
    dispose_runtime()
    application = QApplication.instance() or QApplication([])
    window = App(preview=True)
    window.window.show(); application.processEvents()
    window.close()
    return {'platform': 'windows-x64', 'nativeSdkLoaded': True, 'wgcModuleLoaded': True,
            'wasapiModuleLoaded': True, 'qtLoaded': True, 'profiles': list(PROFILES),
            'applicationLoopbackDllLoaded': True, 'applicationLoopbackSupported': supported(),
            'captureStarted': False, 'networkUsed': False, 'realCaptureValidated': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.self_test:
        try:
            report = self_check()
            code = 0
        except Exception:
            report = {'selfTestFailed': True, 'captureStarted': False}
            code = 1
        if args.report:
            args.report.write_text(json.dumps(report, indent=2)+'\n')
        if sys.stdout:
            print(json.dumps(report))
        raise SystemExit(code)
    from .ui import main as show
    show()


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
