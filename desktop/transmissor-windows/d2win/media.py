"""Bounded queues and PCM conversion, independent of Windows device access."""
import queue
import threading
import time


class Latest:
    def __init__(self, capacity=1):
        self.queue = queue.Queue(capacity)
        self.dropped = 0
        self.lock = threading.Lock()

    def put(self, value):
        with self.lock:
            if self.queue.full():
                self.queue.get_nowait()
                self.dropped += 1
            self.queue.put_nowait(value)

    def get(self):
        try:
            return self.queue.get_nowait()
        except queue.Empty:
            return None

    def clear(self):
        with self.lock:
            while not self.queue.empty():
                self.queue.get_nowait()


def pcm_stereo(data, channels, rate):
    """Float32 WASAPI native mix -> native-rate stereo PCM16, no boost."""
    import numpy as np
    if channels < 1 or channels > 8 or not 8000 <= rate <= 384000:
        raise ValueError('Unsupported mix format')
    samples = np.frombuffer(data, dtype='<f4')
    if samples.size % channels:
        raise ValueError('Partial sample')
    samples = np.nan_to_num(samples.reshape(-1, channels), nan=0.0, posinf=0.0, neginf=0.0)
    if channels == 1:
        stereo = np.repeat(samples, 2, axis=1)
    elif channels == 2:
        stereo = samples
    else:
        # Conservative downmix; never amplify the mix. Document channel-order limits.
        mono = samples.mean(axis=1)
        stereo = np.repeat(mono[:, None], 2, axis=1)
    return (np.clip(stereo, -1, 1) * 32767).astype('<i2').tobytes()


def letterbox_i420(bgra, width, height):
    import cv2
    import numpy as np
    h, w = bgra.shape[:2]
    scale = min(width / w, height / h)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    # Keep BGRA until the final conversion; identical sizes need no resize/canvas.
    if (w, h) == (width, height):
        return cv2.cvtColor(bgra, cv2.COLOR_BGRA2YUV_I420).tobytes()
    resized = cv2.resize(bgra, size, interpolation=cv2.INTER_LINEAR)
    if size == (width, height):
        canvas = resized
    else:
        canvas = np.zeros((height, width, 4), dtype=np.uint8)
        x, y = (width - size[0]) // 2, (height - size[1]) // 2
        canvas[y:y+size[1], x:x+size[0]] = resized
    return cv2.cvtColor(canvas, cv2.COLOR_BGRA2YUV_I420).tobytes()


class FramePacer:
    """Deadline pacing tolerates scheduler jitter without halving nominal FPS."""
    def __init__(self, fps):
        self.period = 1_000_000 / fps
        self.deadline = None

    def accept(self, timestamp):
        if self.deadline is None:
            self.deadline = timestamp + self.period
            return True
        if timestamp + min(2000, self.period * .12) < self.deadline:
            return False
        self.deadline = timestamp + self.period if timestamp >= self.deadline + self.period else self.deadline + self.period
        return True



def now_us():
    return time.monotonic_ns() // 1000


def audio_timestamp(info, frames, rate, now=None):
    import math
    current = now_us() if now is None else now
    age = info.get('current_time', 0) - info.get('input_buffer_adc_time', 0)
    # Some loopback drivers do not populate the ADC clock. Use a bounded estimate,
    # not a fictitious one-second delay that would discard every valid block.
    if not math.isfinite(age) or not 0 <= age <= .5 or not info.get('input_buffer_adc_time'):
        age = frames / rate
    return current - round(age * 1_000_000)


class PcmConverter:
    """Streaming native SoX resampling, retaining phase across WASAPI callbacks."""
    def __init__(self, channels, rate):
        self.channels, self.rate = channels, rate
        self.resampler = None
        if rate != 48000:
            from livekit import rtc
            self.resampler = rtc.AudioResampler(rate, 48000, num_channels=2,
                                               quality=rtc.AudioResamplerQuality.MEDIUM)

    def convert(self, data):
        raw = pcm_stereo(data, self.channels, self.rate)
        if self.resampler is None:
            return raw
        return b''.join(frame.data.tobytes() for frame in self.resampler.push(bytearray(raw)))

    def close(self):
        if self.resampler is not None:
            # No public resampler close in the pinned Python SDK.
            self.resampler._ffi_handle.dispose()
            self.resampler = None
