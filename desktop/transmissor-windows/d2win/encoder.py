"""Optional native FFmpeg hardware encoding into LiveKit's encoded-frame API.

No subprocess pipes or encoded-frame queue. Probe by actually encoding, never
infer hardware support from GPU name. Raw SDK H.264 remains the fallback.
"""
from fractions import Fraction
import sys
import time
from .config import SafeError

# NVENC/AMF/QSV are driver APIs. MF may select a software MFT, so exclude it
# from automatic hardware detection rather than mislabel it as acceleration.
CANDIDATES = ('h264_nvenc', 'h264_qsv', 'h264_amf')
OPTIONS = {
    'h264_nvenc': {'preset': 'p1', 'tune': 'ull', 'rc': 'cbr', 'zerolatency': '1', 'forced-idr': '1'},
    'h264_qsv': {'preset': 'veryfast', 'async_depth': '1', 'look_ahead': '0', 'forced_idr': '1'},
    'h264_amf': {'usage': 'ultralowlatency', 'quality': 'speed', 'rc': 'cbr', 'header_insertion_mode': 'idr'},
}


class HardwareEncoder:
    def __init__(self, name, profile, av_module=None):
        if av_module is None:
            import av as av_module
        self.av = av_module
        self.name = name
        self.profile = dict(profile)
        self.max_bitrate = profile["bitrate"]
        self.context = None
        self.force_keyframe = True
        self.last_reconfigure = 0
        self.last_encode_ms = None
        self.open()

    def open(self):
        p = self.profile
        context = self.av.CodecContext.create(self.name, 'w')
        context.width, context.height = p['width'], p['height']
        context.pix_fmt = 'nv12'
        context.time_base = Fraction(1, 1_000_000)
        context.framerate = Fraction(p['fps'], 1)
        context.bit_rate = p['bitrate']
        context.gop_size = p['fps'] * 2
        context.max_b_frames = 0
        context.options = {'profile': 'baseline', **OPTIONS.get(self.name, {})}
        context.open()
        self.context = context
        self.force_keyframe = True

    def encode(self, data, timestamp, feedback=None):
        import numpy as np
        if feedback is not None:
            self.force_keyframe |= feedback.keyframe_requested
            rate = feedback.rate_control
            if rate is not None:
                # Reopen at a materially changed transport target, forcing an IDR.
                # Ignore tiny fluctuations and cap to the selected quality budget.
                target = max(100_000, min(self.max_bitrate, rate.target_bitrate_bps))
                if abs(target-self.context.bit_rate) > self.context.bit_rate*.2 and time.monotonic()-self.last_reconfigure > 2:
                    self.profile['bitrate'] = target
                    self.open()
                    self.last_reconfigure = time.monotonic()
        p = self.profile
        image = np.frombuffer(data, dtype=np.uint8).reshape(p['height']*3//2, p['width'])
        frame = self.av.VideoFrame.from_ndarray(image, format='yuv420p').reformat(format='nv12')
        frame.pts = timestamp
        frame.time_base = Fraction(1, 1_000_000)
        if self.force_keyframe:
            frame.pict_type = self.av.video.frame.PictureType.I
        begin = time.perf_counter()
        packets = self.context.encode(frame)
        self.last_encode_ms = (time.perf_counter()-begin)*1000
        # Require a no-delay encoder, preserving the source timestamp on each AU.
        # Never drop encoded P frames independently: the next one may reference it.
        if len(packets) != 1:
            raise SafeError('O codificador de hardware acumulou frames. Pare e reinicie a transmissão.')
        packet = packets[0]
        payload = bytes(packet)
        if not payload.startswith((b'\x00\x00\x01', b'\x00\x00\x00\x01')):
            raise SafeError('Formato H.264 incompatível com transmissão em tempo real.')
        self.force_keyframe = False
        return payload, bool(packet.is_keyframe)

    def close(self):
        # PyAV releases AVCodecContext and its driver resources on final reference.
        self.context = None


def select_encoder(profile):
    attempts = []
    if sys.platform != 'win32':
        return None, attempts
    try:
        import av
        import numpy as np
    except ImportError:
        return None, [{'encoder': 'pyav', 'usable': False}]
    for name in CANDIDATES:
        encoder = None
        try:
            encoder = HardwareEncoder(name, profile, av)
            # A real encode checks driver/session availability, not just registration.
            black = np.zeros((profile['height']*3//2, profile['width']), dtype=np.uint8)
            black[:profile['height']] = 16
            black[profile['height']:] = 128
            _, key = encoder.encode(black.tobytes(), 0)
            if not key:
                raise ValueError('No initial keyframe')
            encoder.force_keyframe = True
            attempts.append({'encoder': name, 'usable': True})
            return encoder, attempts
        except Exception:
            if encoder: encoder.close()
            attempts.append({'encoder': name, 'usable': False})
    return None, attempts
