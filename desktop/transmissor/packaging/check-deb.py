#!/usr/bin/python3
"""Extract and test shipped runtime, without installation, capture or network."""
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[1]
version=json.loads((ROOT/'package.json').read_text())['version']
artifact=ROOT/'dist'/f'discord2-transmissor_{version}_amd64.deb'
with tempfile.TemporaryDirectory(prefix='d2-package-check-') as tmp:
    stage=Path(tmp)
    subprocess.run(['dpkg-deb','--extract',str(artifact),tmp],check=True)
    runtime=stage/'usr/lib/discord2-transmissor'
    for entry in stage.rglob('*'):
        assert entry.name not in ('.env','.env.local','results','__pycache__'),entry
    assert not (runtime/'tests').exists()
    assert not (runtime/'integration.mjs').exists()
    subprocess.run(['desktop-file-validate',str(stage/'usr/share/applications/discord2-transmissor.desktop')],check=True)
    subprocess.run(['/usr/bin/python3','-c',"import app, capture, frame_ring; assert frame_ring.available(); print('Python runtime imports OK')"],cwd=runtime,check=True)
    subprocess.run(['/usr/bin/node','-e',"const r=require('@livekit/rtc-node'); const m=require('./native/shm.node'); if(!r.Room || !m.mapFrame)process.exit(1); r.dispose(); console.log('System Node + packaged SDK/native addon OK')"],cwd=runtime,check=True)
    if '--gui' in sys.argv:
        subprocess.run(['/usr/bin/python3',str(ROOT/'tests/gtk-audio-smoke.py')],
                       env={**os.environ,'DISCORD2_TEST_RUNTIME_DIR':str(runtime)},check=True)
    profiles=json.loads((runtime/'profiles.json').read_text())
    assert profiles['1080p30']['fps']==30 and profiles['1080p60']['fps']==60
    print(json.dumps({'packageExtracted':True,'systemNode':True,'desktopEntryValid':True,'qualityProfilesPreserved':True,'installedSystem':False}))
