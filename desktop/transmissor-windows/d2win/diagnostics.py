"""Allowlisted local measurements. No tokens, URLs, identities or window titles."""
import time
import asyncio


class Diagnostics:
    def __init__(self):
        self.previous = None
        self.cpu_wall = time.monotonic()
        self.cpu_time = time.process_time()
        self.previous_rtc = None
        self.previous_sent = None

    async def sample(self, track, capture, report):
        now = time.monotonic()
        counters = dict(capture.metrics)
        counters['videoSubmitted'] = report['videoSubmitted']
        counters['hardwareEncoded'] = report.get('hardwareEncoded', 0)
        previous_time, previous = self.previous or (now, counters)
        elapsed = now - previous_time
        result = {'elapsedSeconds': round(now - self.cpu_wall, 3),
                  'capturedFps': None, 'submittedFps': None, 'sentFps': None, 'encodedFps': None,
                  'externalEncodedFps': None, 'receivedFps': None, 'encodeMs': None, 'encoder': None,
                  'gpuDevices': await asyncio.to_thread(gpu_usage), 'gpuPercent': None, 'endToEndLatencyMs': None,
                  'cpuProcessPercent': round(100 * (time.process_time()-self.cpu_time) / max(.001, now-self.cpu_wall), 2),
                  'rawDropped': getattr(getattr(capture, 'raw_video', None), 'dropped', 0),
                  'videoDropped': capture.video.dropped,
                  'audioDropped': capture.audio.dropped,
                  'staleDropped': report['staleDropped']}
        if elapsed > 0:
            result['externalEncodedFps'] = round((counters['hardwareEncoded']-previous['hardwareEncoded'])/elapsed, 2)
            result['capturedFps'] = round((counters.get('capturedVideo', 0)-previous.get('capturedVideo', 0))/elapsed, 2)
            result['submittedFps'] = round((counters['videoSubmitted']-previous['videoSubmitted'])/elapsed, 2)
        self.previous = now, counters
        try:
            stats = await asyncio.wait_for(track.get_stats(), 1.5)
            for stat in stats:
                # SDK protobuf wrappers expose nested RTP counters, not W3C JSON.
                if not stat.HasField('outbound_rtp'):
                    continue
                wrapper = stat.outbound_rtp
                outbound = wrapper.outbound
                if wrapper.stream.kind != 'video':
                    continue
                if outbound.HasField('frames_sent'):
                    sent = outbound.frames_sent
                    result['framesSent'] = sent
                    if self.previous_sent:
                        before, count = self.previous_sent
                        if sent >= count:
                            result['sentFps'] = round((sent-count)/max(.001, now-before), 2)
                    self.previous_sent = now, sent
                result['bytesSent'] = wrapper.sent.bytes_sent
                if not outbound.HasField('frames_encoded'):
                    continue
                frames, seconds = outbound.frames_encoded, outbound.total_encode_time
                if self.previous_rtc:
                    before, before_frames, before_seconds = self.previous_rtc
                    count = frames-before_frames
                    if count >= 0:
                        result['encodedFps'] = round(count/max(.001, now-before), 2)
                    if count > 0:
                        result['encodeMs'] = round(1000*(seconds-before_seconds)/count, 3)
                self.previous_rtc = now, frames, seconds
                # Availability varies across the pinned native SDK build.
                if hasattr(outbound, 'encoder_implementation'):
                    result['encoder'] = outbound.encoder_implementation or None
                result['qualityLimitationReason'] = outbound.quality_limitation_reason
                result['framesEncoded'] = frames
                result['bytesSent'] = wrapper.sent.bytes_sent
                break
        except Exception:
            result['rtcStatsUnavailable'] = True
        return result


def gpu_usage():
    """Optional NVIDIA device-wide counters, never attributed to this process.

    Intel/AMD without a supported local counter provider return unavailable.
    The executable runs hidden, offline, with an explicit deadline.
    """
    import csv
    import shutil
    import subprocess
    executable = shutil.which('nvidia-smi')
    if executable is None:
        return None
    try:
        result = subprocess.run([executable, '--query-gpu=index,utilization.gpu,utilization.encoder',
                                 '--format=csv,noheader,nounits'], capture_output=True,
                                text=True, timeout=.7,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            return None
        values = []
        for row in csv.reader(result.stdout.splitlines()):
            index, busy, encoding = (int(value.strip()) for value in row)
            if not 0 <= busy <= 100 or not 0 <= encoding <= 100:
                return None
            values.append({'index': index, 'deviceBusyPercent': busy, 'deviceEncodeBusyPercent': encoding})
        return values or None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
