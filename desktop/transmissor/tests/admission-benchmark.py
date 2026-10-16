#!/usr/bin/python3
"""Controlled saturated-ring benchmark. Synthetic buffers only, no SDK/network/devices."""
import argparse
from datetime import datetime, timezone
import importlib.util
import hashlib
import io
import json
from pathlib import Path
import resource
import subprocess
import sys
import time
from unittest.mock import patch

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))


def run_worker(module_path, profile, frames):
    spec=importlib.util.spec_from_file_location('admission_capture',module_path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    width,height=(1280,720) if profile=='720p30' else (1920,1080)
    ring_path=module_path.with_name('frame_ring.py')
    ring_spec=importlib.util.spec_from_file_location('admission_ring',ring_path)
    ring_module=importlib.util.module_from_spec(ring_spec);ring_spec.loader.exec_module(ring_module)
    ring=ring_module.FrameRing(width,height)
    try:
        # The simulated consumer holds all three slots: no real SDK or GPU.
        for _ in range(3):ring.put(bytes(ring.frame_bytes))
        output=io.BytesIO();capture=module.Capture(output,lambda:None);capture.ring=ring
        maps=0
        original=module.Gst.Buffer.map
        def counted_map(buffer,*args):
            nonlocal maps
            maps+=1
            return original(buffer,*args)
        cpu=resource.getrusage(resource.RUSAGE_SELF);start=time.monotonic()
        with patch.object(module.Gst.Buffer,'map',counted_map):
            capture.pipeline(f'videotestsrc name=source num-buffers={frames} pattern=black ! '
                             f'video/x-raw,format=I420,width={width},height={height},framerate=30/1 ! '
                             'appsink name=out emit-signals=true sync=false',1)
            event=capture.pipelines[0].get_bus().timed_pop_filtered(
                30*module.Gst.SECOND,module.Gst.MessageType.EOS|module.Gst.MessageType.ERROR)
            if event is None or event.type!=module.Gst.MessageType.EOS:raise RuntimeError('Benchmark failed')
            capture.stop()
        elapsed=time.monotonic()-start;end=resource.getrusage(resource.RUSAGE_SELF)
        if ring.dropped!=frames or output.getvalue():raise RuntimeError('Unexpected admission')
        result=dict(profile=profile,buffers=frames,
                    sourceHashes={name:hashlib.sha256(path.read_bytes()).hexdigest()
                                  for name,path in (('capture',module_path),('ring',ring_path))},maps=maps,pythonFrameBytes=maps*ring.frame_bytes,
                    cpuSeconds=end.ru_utime+end.ru_stime-cpu.ru_utime-cpu.ru_stime,
                    elapsedSeconds=elapsed,copyMs=capture.copy_ms)
        return result
    finally:
        if 'capture' in locals():capture.stop()
        ring.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--frames',type=int,default=90,choices=range(6,241))
    parser.add_argument('--worker',action='store_true')
    parser.add_argument('--profile',choices=['720p30','1080p30'])
    parser.add_argument('--module',type=Path)
    args=parser.parse_args()
    if args.worker:
        print(json.dumps(run_worker(args.module,args.profile,args.frames)))
    else:
        baseline=args.baseline.resolve();current=HERE/'capture.py'
        if not baseline.is_file() or baseline==current:parser.error('Separate baseline capture.py required')
        results=[]
        for profile in ('720p30','1080p30'):
            for variant in ('before','after','after','before'):
                module=baseline if variant=='before' else current
                command=[sys.executable,__file__,'--worker','--baseline',str(baseline),'--module',str(module),
                         '--profile',profile,'--frames',str(args.frames)]
                case=json.loads(subprocess.check_output(command,timeout=40));case['variant']=variant
                results.append(case);print(json.dumps(case),flush=True)
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        report=dict(timestamp=stamp,scope='synthetic-saturated-ring-only',order='ABBA per profile',cases=results)
        target=HERE/f'results/CONTINUACAO-ADMISSAO-{stamp}.json'
        target.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'report':str(target)}))
