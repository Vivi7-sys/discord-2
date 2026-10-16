#!/usr/bin/python3
"""Recorded speech via real paplay -> private output monitor -> production Capture.
No portal/video/SFU. Local playback via own loopback; no existing streams moved.
"""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from capture import Capture, GLib, Gst

def pactl(*args):
    return subprocess.check_output(['pactl', *args], env={**os.environ, 'LC_ALL':'C.UTF-8'}).decode().strip()

modules=[]
player=None
capture=None
name='discord2_voice_'+uuid.uuid4().hex
sink=pactl('get-default-sink')
before=[pactl('get-sink-volume',sink),pactl('get-sink-mute',sink)]
fixture='/usr/share/sounds/freedesktop/stereo/audio-channel-front-left.oga'
result={'kind':'recorded-speech-application-monitor','player':'paplay','fixture':fixture,
        'syntheticBeep':False,'gameTest':False,'livekitTest':False,'gainDb':0}
try:
    modules.append(pactl('load-module','module-null-sink','sink_name='+name,'rate=48000','channels=2'))
    modules.append(pactl('load-module','module-loopback','source='+name+'.monitor','sink='+sink,'latency_msec=30'))
    capture=Capture(io.BytesIO(),lambda:None,io.BytesIO())
    capture.audio_source_device=name+'.monitor'
    def setup(source):
        source.set_property('device',capture.audio_source_device)
        source.set_property('volume',1.0)
        source.set_property('mute',False)
        props=Gst.Structure.new_empty('props')
        props.set_value('node.dont-fallback',True)
        props.set_value('node.dont-reconnect',True)
        source.set_property('stream-properties',props)
    capture.pipeline('pulsesrc name=source provide-clock=false buffer-time=200000 latency-time=20000 ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! appsink name=out emit-signals=true max-buffers=5 drop=true sync=false',2,setup)
    loop=GLib.MainLoop()
    def play():
        global player
        player=subprocess.Popen(['paplay','--device='+name,fixture],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return False
    GLib.timeout_add(500,play)
    GLib.timeout_add_seconds(5,lambda:(loop.quit(),False)[1])
    loop.run()
    result['capture']=capture.snapshot()
    assert capture.counts[1]>10 and capture.peak>100, 'Recorded speech not captured'
    assert not capture.errors, 'Capture errors'
    result['passed']=True
finally:
    if capture:capture.stop()
    if player:
        if player.poll() is None:player.terminate()
        player.wait(timeout=5)
    for module in reversed(modules):pactl('unload-module',module)
    result['localOutputUnchanged']=before==[pactl('get-sink-volume',sink),pactl('get-sink-mute',sink)]
    result['modulesRemoved']=True
    result['humanAudibility']='not-assessed'
    target=Path(__file__).resolve().parents[1]/'results'/('PROGRAM-AUDIO-'+uuid.uuid4().hex+'.json')
    target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
    assert result['localOutputUnchanged']
