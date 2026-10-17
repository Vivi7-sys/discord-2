"""Controlled regressions, not Windows desktop or driver benchmarks."""
import asyncio
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import cv2
from d2win.media import FramePacer, letterbox_i420, Latest
from d2win.diagnostics import Diagnostics
from d2win.encoder import HardwareEncoder, select_encoder, CANDIDATES
from livekit import rtc
from livekit.rtc._proto import stats_pb2


class Pacing(unittest.TestCase):
    def test_jitter_does_not_halve_30_or_60(self):
        for fps in (30, 60):
            pacer = FramePacer(fps)
            accepted = sum(pacer.accept(round(i*1_000_000/fps) + (-300 if i%2 else 300)) for i in range(fps*10))
            self.assertGreaterEqual(accepted, fps*10-1)
    def test_fast_capture_and_long_pause_do_not_burst(self):
        pacer = FramePacer(30)
        accepted = sum(pacer.accept(i*1000) for i in range(1000))
        self.assertLessEqual(accepted, 31)
        self.assertTrue(pacer.accept(5_000_000))
        self.assertFalse(pacer.accept(5_000_001))
    def test_direct_bgra_matches_previous_color_conversion(self):
        image = np.random.default_rng(7).integers(0,256,(180,320,4),dtype=np.uint8)
        reference = cv2.cvtColor(cv2.cvtColor(image,cv2.COLOR_BGRA2BGR),cv2.COLOR_BGR2YUV_I420).tobytes()
        self.assertEqual(letterbox_i420(image,320,180),reference)
    def test_padded_wgc_rows_and_odd_source_size(self):
        image = np.zeros((203, 347, 4),dtype=np.uint8)[:, :331]
        self.assertEqual(len(letterbox_i420(image,640,360)),640*360*3//2)


class DiagnosticTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_pinned_protobuf_and_counter_deltas(self):
        wrapper = stats_pb2.RtcStats()
        wrapper.outbound_rtp.stream.kind='video'
        wrapper.outbound_rtp.outbound.frames_encoded=10
        wrapper.outbound_rtp.outbound.total_encode_time=.1
        wrapper.outbound_rtp.outbound.encoder_implementation='controlled-test'
        wrapper.outbound_rtp.sent.bytes_sent=2048
        async def stats(): return [wrapper]
        track=types.SimpleNamespace(get_stats=stats)
        capture=types.SimpleNamespace(metrics={'capturedVideo':10},video=Latest(),audio=Latest())
        report={'videoSubmitted':10,'staleDropped':0}
        diagnostics=Diagnostics()
        first=await diagnostics.sample(track,capture,report)
        self.assertIsNone(first['encodedFps']);self.assertIsNone(first['receivedFps'])
        wrapper.outbound_rtp.outbound.frames_encoded=12
        wrapper.outbound_rtp.outbound.total_encode_time=.12
        second=await diagnostics.sample(track,capture,report)
        self.assertAlmostEqual(second['encodeMs'],10)
        self.assertEqual(second['encoder'],'controlled-test')
        self.assertEqual(second['bytesSent'],2048)
        self.assertIsNone(second['endToEndLatencyMs'])


class Encoding(unittest.TestCase):
    def test_hardware_probe_failure_is_explicit_raw_fallback(self):
        with patch('d2win.encoder.sys.platform','win32'), patch('d2win.encoder.HardwareEncoder',side_effect=RuntimeError('private driver error')):
            encoder,attempts=select_encoder({'width':320,'height':180,'fps':30,'bitrate':500000})
        self.assertIsNone(encoder)
        self.assertEqual([a['encoder'] for a in attempts],list(CANDIDATES))
        self.assertTrue(all(a['usable'] is False for a in attempts))
        self.assertNotIn('private',str(attempts))
    def test_native_encode_access_units_keyframe_feedback_and_decode(self):
        # libx264 is ONLY a test surrogate. Production selects hardware candidates.
        import av
        from d2win.encoder import OPTIONS
        profile={'width':320,'height':180,'fps':60,'bitrate':500000}
        with patch.dict(OPTIONS, {'libx264':{'preset':'ultrafast','tune':'zerolatency','x264-params':'repeat-headers=1'}}):
            encoder=HardwareEncoder('libx264',profile)
            decoder=av.CodecContext.create('h264','r')
            image=np.zeros((270,320),dtype=np.uint8);image[:180]=16;image[180:]=128
            for i in range(5):
                feedback=types.SimpleNamespace(keyframe_requested=i==3,rate_control=None)
                data,key=encoder.encode(image.tobytes(),1_000_000+i*16667,feedback)
                if i in (0,3):self.assertTrue(key)
                frame=rtc.EncodedVideoFrame(data,320,180,rtc.VideoCodec.H264,
                    rtc.EncodedFrameType.ENCODED_FRAME_KEY if key else rtc.EncodedFrameType.ENCODED_FRAME_DELTA,1_000_000+i*16667)
                self.assertEqual(len(decoder.decode(av.Packet(frame.data))),1)
            encoder.close();self.assertIsNone(encoder.context)
