#!/usr/bin/python3
"""VA-API capabilities + synthetic FFmpeg stages; no screen, microphone or network."""
import ctypes as C
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import time


def capabilities():
    va=C.CDLL('libva.so.2');drm=C.CDLL('libva-drm.so.2')
    drm.vaGetDisplayDRM.argtypes=[C.c_int];drm.vaGetDisplayDRM.restype=C.c_void_p
    for name in ('vaInitialize','vaQueryConfigProfiles','vaQueryConfigEntrypoints','vaTerminate'):
        getattr(va,name).restype=C.c_int
    va.vaInitialize.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)]
    va.vaQueryVendorString.argtypes=[C.c_void_p];va.vaQueryVendorString.restype=C.c_char_p
    va.vaMaxNumProfiles.argtypes=[C.c_void_p];va.vaMaxNumEntrypoints.argtypes=[C.c_void_p]
    va.vaQueryConfigProfiles.argtypes=[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)]
    va.vaQueryConfigEntrypoints.argtypes=[C.c_void_p,C.c_int,C.POINTER(C.c_int),C.POINTER(C.c_int)]
    va.vaTerminate.argtypes=[C.c_void_p]
    for name in ('vaProfileStr','vaEntrypointStr'):
        getattr(va,name).argtypes=[C.c_int];getattr(va,name).restype=C.c_char_p
    fd=os.open('/dev/dri/renderD128',os.O_RDWR)
    display=drm.vaGetDisplayDRM(fd);major=C.c_int();minor=C.c_int()
    assert display and va.vaInitialize(display,C.byref(major),C.byref(minor))==0
    try:
        profiles=(C.c_int*va.vaMaxNumProfiles(display))();n=C.c_int()
        assert va.vaQueryConfigProfiles(display,profiles,C.byref(n))==0
        entries=[]
        for profile in profiles[:n.value]:
            points=(C.c_int*va.vaMaxNumEntrypoints(display))();count=C.c_int()
            assert va.vaQueryConfigEntrypoints(display,profile,points,C.byref(count))==0
            entries.append(dict(profile=va.vaProfileStr(profile).decode(),entrypoints=[va.vaEntrypointStr(v).decode() for v in points[:count.value]]))
        return dict(device='/dev/dri/renderD128',pciDevice=Path('/sys/class/drm/renderD128/device').resolve().name,
                    driver=Path('/sys/class/drm/renderD128/device/driver').resolve().name,
                    vendor=va.vaQueryVendorString(display).decode(),api=f'{major.value}.{minor.value}',profiles=entries)
    finally:
        va.vaTerminate(display);os.close(fd)


def run(width,height,stage):
    frames=240
    command=['ffmpeg','-hide_banner','-loglevel','info','-benchmark','-nostdin']
    if stage in ('upload','encode'):
        command+=['-init_hw_device','vaapi=va:/dev/dri/renderD128']
    command+=['-f','lavfi','-i',f'testsrc2=size={width}x{height}:rate=30','-frames:v',str(frames)]
    if stage=='nv12':command+=['-vf','format=nv12']
    if stage in ('upload','encode'):command+=['-vf','format=nv12,hwupload']
    command+=['-c:v','h264_vaapi' if stage=='encode' else 'wrapped_avframe']
    if stage=='encode':command+=['-b:v','3M' if height==720 else '5M']
    command+=['-f','null','-']
    cpu=resource.getrusage(resource.RUSAGE_CHILDREN);start=time.monotonic()
    p=subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,timeout=90)
    elapsed=time.monotonic()-start;end=resource.getrusage(resource.RUSAGE_CHILDREN)
    if p.returncode:raise RuntimeError('Synthetic FFmpeg stage failed: '+stage)
    timing=re.search(r'bench: utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s',p.stderr)
    return dict(width=width,height=height,stage=stage,frames=frames,wallSeconds=elapsed,
                throughputFps=frames/elapsed,cpuSeconds=end.ru_utime+end.ru_stime-cpu.ru_utime-cpu.ru_stime,
                ffmpegTiming=dict(zip(('user','system','wall'),map(float,timing.groups()))) if timing else None)


if __name__=='__main__':
    result=dict(capabilities=capabilities(),cases=[])
    for width,height in ((1280,720),(1920,1080)):
        for stage in ('source','nv12','upload','encode'):
            case=run(width,height,stage);result['cases'].append(case);print(json.dumps(case),flush=True)
    target=Path(__file__).resolve().parents[1]/'results/RX550-HARDWARE.json'
    target.write_text(json.dumps(result,indent=2)+'\n')
