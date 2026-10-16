#!/usr/bin/python3
"""Unpaced C GStreamer test: identical BGRA frames, rate placement only changes."""
import json
from pathlib import Path
import resource
import time
import gi
gi.require_version('Gst','1.0')
from gi.repository import Gst
Gst.init(None)


def run(profile, legacy):
    width,height=(1280,720) if profile=='720p30' else (1920,1080)
    convert='videoconvert ! identity name=converted silent=true ! videoscale add-borders=true ! '
    rate='videorate name=rate ! ' if legacy else 'videorate name=rate drop-only=true ! video/x-raw,framerate=30/1 ! '
    middle=convert+rate if legacy else rate+convert
    pipeline=Gst.parse_launch('videotestsrc num-buffers=120 pattern=smpte75 horizontal-speed=8 ! '
        'video/x-raw,format=BGRx,width=1920,height=1080,framerate=60/1 ! identity name=input silent=true ! '+
        middle+f'video/x-raw,format=I420,width={width},height={height},framerate=30/1,pixel-aspect-ratio=1/1 ! '
        'identity name=output silent=true ! fakesink sync=false')
    cpu=resource.getrusage(resource.RUSAGE_SELF);start=time.monotonic()
    try:
        pipeline.set_state(Gst.State.PLAYING)
        message=pipeline.get_bus().timed_pop_filtered(60*Gst.SECOND,Gst.MessageType.EOS|Gst.MessageType.ERROR)
        if not message or message.type==Gst.MessageType.ERROR:raise RuntimeError('Conversion benchmark failed')
        elapsed=time.monotonic()-start;end=resource.getrusage(resource.RUSAGE_SELF)
        result=dict(profile=profile,pipeline='legacy' if legacy else 'early-drop',wallSeconds=elapsed,
                    cpuSeconds=end.ru_utime+end.ru_stime-cpu.ru_utime-cpu.ru_stime)
        for name in ('input','converted','output'):
            result[name+'Buffers']=pipeline.get_by_name(name).get_property('stats').get_value('num-buffers')
        rate_element=pipeline.get_by_name('rate')
        result['rate']={k:rate_element.get_property(k) for k in ('in','out','drop','duplicate')}
        return result
    finally:pipeline.set_state(Gst.State.NULL)


if __name__=='__main__':
    cases=[]
    for profile in ('720p30','1080p30'):
        for legacy in (True,False):
            case=run(profile,legacy);cases.append(case);print(json.dumps(case),flush=True)
    (Path(__file__).resolve().parents[1]/'results/RX550-CONVERSION.json').write_text(json.dumps(cases,indent=2)+'\n')
