"""Aggregate-only diagnostics: no content, device names, URLs or credentials."""
import audioop
import math
import time


def dbfs(value):
    return round(20 * math.log10(value / 32768), 2) if value else None


class MediaMetrics:
    def __init__(self):
        self.count = self.bytes = self.work_ns = self.write_ns = 0
        self.first = self.last = self.first_pts = self.last_pts = None
        self.non_monotonic = self.pts_gaps = self.clipped = self.samples = 0
        self.peak = self.energy = 0
        self.saturated_blocks = 0
        self.max_age_ms = 0
        self.buckets = {}
        self.caps = None

    def record(self, size, pts_us, work_ns, write_ns, duration_us=0):
        now = time.monotonic_ns()
        self.first = now if self.first is None else self.first
        self.last = now
        self.buckets[int((now-self.first)/1e9)] = self.buckets.get(int((now-self.first)/1e9), 0)+1
        if self.last_pts is not None:
            self.non_monotonic += pts_us <= self.last_pts
            self.pts_gaps += duration_us > 0 and pts_us-self.last_pts > duration_us*1.8
        self.first_pts = pts_us if self.first_pts is None else self.first_pts
        self.last_pts = pts_us
        self.max_age_ms = max(self.max_age_ms, max(0, now/1000-pts_us)/1000)
        self.count += 1
        self.bytes += size
        self.work_ns += work_ns
        self.write_ns += write_ns

    def pcm(self, data):
        # C implementations; do not scan 96,000 Python integers/second in capture callbacks.
        n = len(data)//2
        block_peak = audioop.max(data, 2)
        self.peak = max(self.peak, block_peak)
        self.saturated_blocks += block_peak >= 32767
        self.energy += audioop.rms(data, 2)**2*n
        self.samples += n

    def snapshot(self):
        span = (self.last-self.first)/1e9 if self.count>1 else 0
        return dict(buffers=self.count, bytes=self.bytes, spanSeconds=round(span, 3),
                    fps=round((self.count-1)/span, 3) if span else 0,
                    workMs=round(self.work_ns/1e6, 3), writeMs=round(self.write_ns/1e6, 3),
                    maxAgeMs=round(self.max_age_ms, 3), nonMonotonicPts=self.non_monotonic,
                    ptsGaps=self.pts_gaps, ptsSpanSeconds=round((self.last_pts-self.first_pts)/1e6, 3) if self.count>1 else 0,
                    perSecond=[self.buckets.get(i, 0) for i in range(max(self.buckets, default=-1)+1)],
                    peak=self.peak, peakDbfs=dbfs(self.peak), sampleCount=self.samples,
                    durationSeconds=round(self.samples/96000, 4), saturatedBlocks=self.saturated_blocks,
                    rmsDbfs=dbfs(math.sqrt(self.energy/self.samples)) if self.samples else None,
                    caps=self.caps)
