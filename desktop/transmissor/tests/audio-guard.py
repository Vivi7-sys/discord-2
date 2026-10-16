#!/usr/bin/python3
"""Real Pulse/PipeWire privacy regression; two private test sinks, never a microphone."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from capture import Capture, Gst, GLib

modules=[]
tones=[]
capture=None
result={}
loop=GLib.MainLoop()
ended=threading.Event()

def pactl(*args):
    return subprocess.check_output(['pactl',*args],env={**os.environ,'LC_ALL':'C.UTF-8'},stderr=subprocess.DEVNULL).decode().strip()

try:
    names=['discord2_guard_'+uuid.uuid4().hex for _ in range(2)]
    for name in names:
        modules.append(pactl('load-module','module-null-sink','sink_name='+name,'rate=48000','channels=2'))
    for i,name in enumerate(names):
        tones.append(subprocess.Popen(['gst-launch-1.0','-q','audiotestsrc','is-live=true','volume='+('0.05' if i==0 else '0.2'),'freq='+('997' if i==0 else '1379'),'!','audio/x-raw,rate=48000,channels=2','!','pulsesink','device='+name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
    def stop():
        ended.set();GLib.idle_add(loop.quit)
    capture=Capture(io.BytesIO(),stop,io.BytesIO())
    capture.audio_source_device=names[0]+'.monitor'
    source_holder=[]
    def setup(s):
        source_holder.append(s)
        s.set_property('device',capture.audio_source_device)
        props=Gst.Structure.new_empty('props')
        props.set_value('node.dont-fallback',True);props.set_value('node.dont-reconnect',True)
        s.set_property('stream-properties',props)
    capture.pipeline('pulsesrc name=source provide-clock=false buffer-time=200000 latency-time=20000 ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! appsink name=out emit-signals=true max-buffers=5 drop=true sync=false',2,setup)
    def move():
        if capture.counts[1]<10 or capture.peak<=100:
            return True
        result['validMonitorBuffers']=capture.counts[1]
        result['validMonitorPeak']=capture.peak
        try:
            index=source_holder[0].get_property('source-output-index')
            pactl('move-source-output',str(index),names[1]+'.monitor')
            result['moveAllowed']=True
        except subprocess.CalledProcessError:
            result['moveAllowed']=False
            loop.quit()
        return False
    # Wait for a verified input signal before moving; keep both sources active.
    GLib.timeout_add(50,move)
    GLib.timeout_add_seconds(8,lambda:(loop.quit(),False)[1])
    loop.run()
    result.update(buffersAfterMove=capture.counts[1],acceptedPeakAfterMove=capture.peak,currentDeviceMatchesOriginal=source_holder[0].get_property('current-device')==capture.audio_source_device,policyBlocked=any(e['domain']=='capture-policy' for e in capture.errors),captureStopped=ended.is_set())
    capture.stop()
    assert result.get('validMonitorBuffers',0)>5 and result['validMonitorPeak']>100
    assert not result['moveAllowed'] or result['policyBlocked']
    assert capture.peak<=1700, 'Foreign test signal was accepted'
    result['passed']=True
finally:
    if capture:capture.stop()
    for tone in tones:
        tone.terminate();tone.wait(timeout=5)
    for module in reversed(modules):pactl('unload-module',module)
    result['modulesRemoved']=True
    (Path(__file__).resolve().parents[1]/f'results/AUDIO-GUARD-{uuid.uuid4().hex}.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
