"""Real Python RTC/API session. No Windows capture, no synthetic media feed."""
import asyncio
import json
import logging
import os
from pathlib import Path
import sys
import threading
os.environ['RUST_LOG']='off'
logging.disable(logging.CRITICAL)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from d2win.config import configuration
from d2win.session import Session
from d2win.media import Latest
from d2win.sdk import dispose_runtime

class NoCapture:
    def __init__(self,*args):
        self.video=Latest();self.audio=Latest();self.stream=None;self.metrics={}
    def start(self):pass
    def close(self):pass

def main():
    config=json.loads(sys.stdin.readline())
    def status(message):
        if message.startswith('Transmitindo'):
            print(json.dumps({'state':'ready'}),flush=True)
    session=Session(configuration(config['invite'],'D2 Windows test','720p30'),None,True,status,NoCapture)
    def stop():
        # EOF also stops cleanly. Invitation is supplied privately, never argv/env.
        sys.stdin.readline()
        session.stop()
    threading.Thread(target=stop,daemon=True).start()
    asyncio.run(session.run())
    dispose_runtime()
    print(json.dumps({'state':'done','report':session.report,'failed':session.failure is not None,'safeFailure':session.failure}),flush=True)

if __name__=='__main__':main()
