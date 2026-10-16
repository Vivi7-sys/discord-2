#!/usr/bin/python3
"""Local synthetic stage benchmark. Does not connect to backend or capture devices."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import threading
from frame_ring import FrameRing
from capture import Capture

parser=argparse.ArgumentParser()
parser.add_argument('mode', choices=['drain','ffi'], default='ffi', nargs='?')
parser.add_argument('--format', choices=['RGBA','I420'], default='I420')
parser.add_argument('--fps', type=int, choices=[30,60], default=30)
parser.add_argument('--transport', choices=['pipe','ring'], default='pipe')
parser.add_argument('--profile', choices=['1080p30','1080p60','720p30'], default=None)
parser.add_argument('--seconds', type=int, default=15)
args=parser.parse_args()
if args.transport=='ring' and args.format!='I420':
    parser.error('Memória compartilhada requer I420')
here=Path(__file__).resolve().parent
profile=args.profile or ('1080p60' if args.fps==60 else '1080p30')
shape=json.loads((here/'profiles.json').read_text())[profile]
if shape['fps'] != args.fps:
    parser.error('FPS incompatível com perfil')
width,height=shape['width'],shape['height']
read_fd,write_fd=os.pipe()
ring=FrameRing(width,height) if args.transport=='ring' else None
child=subprocess.Popen(['node',str(here/'tests/bench-consumer.cjs'),args.mode,str(read_fd),args.format,str(ring.fd) if ring else 'none',str(width),str(height)],
                       pass_fds=(read_fd,ring.fd) if ring else (read_fd,),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
os.close(read_fd)
audio=os.fdopen(write_fd,'wb')
assert json.loads(child.stdout.readline())['state']=='ready'
capture=Capture(child.stdin,lambda:None,audio)
capture.ring=ring
capture.synthetic_clock=True
consumer_result=[]
def read_output():
    for line in child.stdout:
        event=json.loads(line)
        if event.get('state')=='video-release' and ring:
            ring.release(event['slot'])
        else:
            consumer_result.append(event)
reader=threading.Thread(target=read_output)
reader.start()
capture.pipeline('videotestsrc name=source is-live=true pattern=smpte75 horizontal-speed=8 ! '
                 f'video/x-raw,format={args.format},width={width},height={height},framerate={args.fps}/1 ! '
                 'queue max-size-buffers=2 max-size-bytes=0 max-size-time=0 leaky=downstream ! '
                          'appsink name=out emit-signals=true max-buffers=1 drop=true sync=false',1)
capture.pipeline('audiotestsrc name=source is-live=true volume=0.05 samplesperbuffer=480 ! '
                 'audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! '
                 'appsink name=out emit-signals=true max-buffers=3 drop=true sync=false',2)
time.sleep(args.seconds)
capture.stop()
child.stdin.close();audio.close()
child.wait(timeout=10)
reader.join(timeout=10)
consumer=consumer_result[-1]
result=dict(profile=profile,mode=args.mode,format=args.format,requestedFps=args.fps,transport=args.transport,capture=capture.snapshot(),consumer=consumer)
(here/f'results/RX550-LOCAL-{profile}-{args.mode}-{args.format}-{args.fps}-{args.transport}.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(mode=args.mode,format=args.format,captureFps=result['capture']['video']['fps'],consumerFps=consumer['video']['fps'],videoWriteMs=result['capture']['video']['writeMs'],pythonCpuPercent=result['capture']['pythonCpuPercent'],consumerCpuPercent=consumer['cpuPercent'])))

if ring:
    ring.close()
