#!/usr/bin/python3
"""Derive stage rates from aggregate reports; never equate GPU busy time to latency."""
import json
from pathlib import Path


def summarize(report):
    capture=report.get('capture',{})
    diagnostics=capture.get('diagnostics',{})
    publisher=capture.get('publisher') or {}
    outbound=next((s for s in (publisher.get('rtc') or [[]])[0] if s['type']=='outbound'),{})
    frames=outbound.get('framesEncoded',0)
    elapsed=publisher.get('elapsedSeconds',0)
    gpu_ns=sum(int(device['fields'].get('drm-engine-enc','0 ns').split()[0]) for device in publisher.get('gpu',[]))
    stages={name:dict(buffers=s['buffers'],meanElapsedMs=s['totalMs']/s['buffers'] if s['buffers'] else None,maxElapsedMs=s['maxMs']) for name,s in diagnostics.get('stages',{}).items()}
    return dict(passed=report.get('passed'),profile=report.get('profile'),fixture=report.get('fixture'),
        sourceFps=diagnostics.get('sourceFps'),captureOutputFps=diagnostics.get('video',{}).get('fps'),
        sdkSubmitFps=publisher.get('video',{}).get('fps'),
        encodedFrames=frames,encodedFpsSincePublisherStart=frames/elapsed if elapsed else None,
        sentFrames=outbound.get('framesSent'),receiveFps=report.get('performance',{}).get('measuredReceiveFps'),
        encodePathMeanMs=outbound.get('totalEncodeTime',0)*1000/frames if frames else None,
        ownDrmEncodeBusyMsPerFrame=gpu_ns/1e6/frames if frames and gpu_ns else None,
        stages=stages,copyMs=diagnostics.get('copyMs'),rate=diagnostics.get('rate'),
        staleVideo=publisher.get('video',{}).get('skippedStale'),
        hostBusyPercent=report.get('host',{}).get('busyPercent'),
        audio=dict(capturedSeconds=diagnostics.get('audio',{}).get('durationSeconds'),
                   captureSpanSeconds=diagnostics.get('audio',{}).get('spanSeconds'),
                   receivedSeconds=report.get('received',{}).get('audioDurationSeconds'),
                   peakDbfs=report.get('received',{}).get('audioPeakDbfs'),
                   rmsDbfs=report.get('received',{}).get('audioRmsDbfs'),
                   clippedSamples=report.get('received',{}).get('clippedSamples')))


if __name__=='__main__':
    folder=Path(__file__).with_name('results')
    reports={p.name:summarize(json.loads(p.read_text())) for p in sorted(folder.glob('RX550-*-SDK-*.json'))}
    (folder/'RX550-SUMMARY.json').write_text(json.dumps(reports,indent=2)+'\n')
    print(json.dumps(reports,indent=2))
