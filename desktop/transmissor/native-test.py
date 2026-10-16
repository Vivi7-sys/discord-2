#!/usr/bin/python3
"""Interactive real capture test. Parent supplies only public API config via stdin."""
import json
import sys
import threading
from gi.repository import GLib
import app
from app import Session
from capture import monitors

config = json.loads(sys.stdin.readline())
duration = config.pop('testSeconds', 30)
loop = GLib.MainLoop()
result = {'capture': 'not-started'}
session = None

def status(text, done=False):
    print(json.dumps({'stage': text}), flush=True)
    if text.startswith('Transmitindo') and result['capture'] != 'started':
        result['capture'] = 'started'
        print(json.dumps({'state': 'capturing'}), flush=True)
        def stop_capture():
            print(json.dumps({'state': 'capture-ended'}), flush=True)
            session.stop()
            return False
        GLib.timeout_add_seconds(duration, stop_capture)
    if text.startswith('Não foi'):
        result['capture'] = 'failed'
    if done:
        if session.capture:
            result.update(videoBuffers=session.capture.counts[0], audioBuffers=session.capture.counts[1], audioPeak=session.capture.peak, diagnostics=session.capture.snapshot(), publisher=session.publisher_metrics, publisherStopped=session.publisher_stopped, publisherKilled=session.publisher_killed)
        print(json.dumps(result), flush=True)
        GLib.idle_add(loop.quit)

synthetic = config.pop('synthetic', False)
if synthetic:
    class TestPortal:
        def __init__(self, ended):
            self.cancelled = threading.Event()
        def open(self, kind):
            return (0, {})
        def close(self):
            pass
    class TestCapture(app.Capture):
        def start(self, portal, stream, fps, audio):
            self.synthetic_clock = True
            if self.test_conversion:
                self.pipeline(self.video_description(
                    'videotestsrc name=source is-live=true pattern=smpte75 horizontal-speed=8 ! '
                    'video/x-raw,format=BGRx,width=1920,height=1080,framerate=60/1', fps), 1)
            else:
                self.pipeline('videotestsrc name=source is-live=true pattern=smpte75 horizontal-speed=8 ! '
                              f'video/x-raw,format=I420,width={self.width},height={self.height},framerate={fps}/1 ! '
                              'queue max-size-buffers=2 max-size-bytes=0 max-size-time=0 leaky=downstream ! '
                              'appsink name=out emit-signals=true max-buffers=1 drop=true sync=false', 1)
            self.pipeline('audiotestsrc name=source is-live=true volume=0.05 wave=sine samplesperbuffer=960 ! '
                          'audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! '
                          'appsink name=out emit-signals=true max-buffers=3 drop=true sync=false', 2)
    app.Portal = TestPortal
    app.Capture = TestCapture
sources = [] if synthetic else monitors()
# Explicit test source selected by harness; never falls back to default input.
audio = config.pop('audioSource', None)
if not synthetic and audio not in [s['name'] for s in sources]:
    raise RuntimeError('Test output monitor unavailable')
session = Session(status)
threading.Thread(target=session.run, args=(config, 3, audio), daemon=True).start()
GLib.timeout_add_seconds(240, lambda: (session.stop(), False)[1])
loop.run()
