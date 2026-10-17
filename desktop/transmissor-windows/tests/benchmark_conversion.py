"""Synthetic CPU preprocessing comparison. Never a WGC/network/FPS benchmark."""
import json
from pathlib import Path
import platform
import statistics
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from d2win.media import letterbox_i420, FramePacer


def baseline(bgra,width,height):
    h,w=bgra.shape[:2];scale=min(width/w,height/h)
    size=(max(1,round(w*scale)),max(1,round(h*scale)))
    bgr=cv2.cvtColor(bgra,cv2.COLOR_BGRA2BGR)
    resized=cv2.resize(bgr,size,interpolation=cv2.INTER_AREA if scale<1 else cv2.INTER_LINEAR)
    canvas=np.zeros((height,width,3),dtype=np.uint8)
    x,y=(width-size[0])//2,(height-size[1])//2
    canvas[y:y+size[1],x:x+size[0]]=resized
    return cv2.cvtColor(canvas,cv2.COLOR_BGR2YUV_I420).tobytes()


def measure(fn,image,w,h):
    for _ in range(10):fn(image,w,h)
    times=[]
    for _ in range(100):
        start=time.perf_counter();fn(image,w,h);times.append((time.perf_counter()-start)*1000)
    return {'medianMs':round(statistics.median(times),3),'p95Ms':round(sorted(times)[94],3)}


if __name__=='__main__':
    cv2.setNumThreads(1)
    result={'synthetic':True,'platform':platform.system(),'opencv':cv2.__version__,
            'note':'CPU conversion only, single OpenCV thread for both. Does not predict Windows FPS.','cases':[]}
    for w,h,ow,oh in [(1920,1080,1920,1080),(2560,1440,1920,1080),(1920,1080,1280,720)]:
        image=np.random.default_rng(4).integers(0,256,(h,w,4),dtype=np.uint8)
        result['cases'].append({'input':[w,h],'output':[ow,oh],'before':measure(baseline,image,ow,oh),'after':measure(letterbox_i420,image,ow,oh)})
    pacing=[]
    for fps in (30,60):
        timestamps=[round(i*1_000_000/fps)+(-300 if i%2 else 300) for i in range(fps*10)]
        last=0;before=0
        for ts in timestamps:
            if ts-last>=1_000_000//fps:last=ts;before+=1
        pacer=FramePacer(fps)
        pacing.append({'requestedFps':fps,'durationSeconds':10,'oldAccepted':before,'newAccepted':sum(pacer.accept(t) for t in timestamps)})
    result['syntheticPacing']=pacing
    output=Path(sys.argv[1]) if len(sys.argv)>1 else Path('benchmark-conversion.json')
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
