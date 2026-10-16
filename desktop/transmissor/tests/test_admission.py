"""Exercise real Gst buffers and production callbacks, without devices/network."""
import io
from pathlib import Path
import struct
import sys
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from capture import Capture, Gst
from frame_ring import FrameRing


class Admission(unittest.TestCase):
    def run_buffers(self, capture, setup=None):
        capture.synthetic_clock=True
        capture.pipeline('videotestsrc name=source is-live=true num-buffers=6 pattern=black ! '
                         'video/x-raw,format=I420,width=1280,height=720,framerate=30/1 ! '
                         'appsink name=out emit-signals=true sync=false',1,setup)
        p=capture.pipelines[0]
        event=p.get_bus().timed_pop_filtered(10*Gst.SECOND,Gst.MessageType.EOS|Gst.MessageType.ERROR)
        self.assertIsNotNone(event)
        return event

    def test_full_ring_drops_before_mapping_without_touching_owned_slots(self):
        ring=FrameRing(1280,720)
        try:
            slots=[ring.put(bytes([n])*ring.frame_bytes) for n in (11,22,33)]
            output=io.BytesIO();capture=Capture(output,lambda:None);capture.ring=ring
            with patch.object(Gst.Buffer,'map',side_effect=AssertionError('Rejected video must not be mapped')):
                self.assertEqual(self.run_buffers(capture).type,Gst.MessageType.EOS)
            capture.stop()
            self.assertEqual(capture.video_capacity_before_copy,6)
            self.assertEqual(capture.video_bytes_avoided,6*ring.frame_bytes)
            self.assertEqual(output.getvalue(),b'')
            for slot,n in zip(slots,(11,22,33)):
                self.assertEqual(ring.mapping[slot*ring.stride],n)
            self.assertEqual(set(slots),ring.inflight)
        finally:
            if 'capture' in locals():capture.stop()
            ring.close()

    def test_fresh_frames_use_only_three_slots_until_ack(self):
        ring=FrameRing(1280,720)
        try:
            output=io.BytesIO();capture=Capture(output,lambda:None);capture.ring=ring
            self.assertEqual(self.run_buffers(capture).type,Gst.MessageType.EOS)
            capture.stop()
            raw=output.getvalue()
            slots=[struct.unpack_from('<I',raw,i+12)[0] for i in range(0,len(raw),16)]
            self.assertEqual(len(set(slots)),3)
            self.assertEqual(capture.counts[0],3)
            self.assertEqual(capture.video_capacity_before_copy,3)
            ring.release(slots[0])
            self.assertEqual(ring.reserve(),slots[0])
        finally:
            if 'capture' in locals():capture.stop()
            ring.close()

    def test_failed_map_returns_unsent_slot(self):
        ring=FrameRing(1280,720)
        try:
            output=io.BytesIO();capture=Capture(output,lambda:None);capture.ring=ring
            with patch.object(Gst.Buffer,'map',return_value=(False,None)):
                self.run_buffers(capture)
            capture.stop()
            self.assertEqual(ring.inflight,set())
            self.assertEqual(ring.free.qsize(),3)
            self.assertEqual(output.getvalue(),b'')
        finally:
            if 'capture' in locals():capture.stop()
            ring.close()

    def test_old_video_drops_before_mapping_in_pipe_and_ring(self):
        for use_ring in (False,True):
            with self.subTest(ring=use_ring):
                ring=FrameRing(1280,720) if use_ring else None
                output=io.BytesIO();capture=Capture(output,lambda:None);capture.ring=ring
                # Valid calibration shifted back 2 s to simulate a genuinely old frame.
                capture.clock_offsets[0]=(time.monotonic_ns()-Gst.SystemClock.obtain().get_time())/1e6-2000
                try:
                    with patch.object(Gst.Buffer,'map',side_effect=AssertionError('Old video must not be mapped')):
                        self.assertEqual(self.run_buffers(capture).type,Gst.MessageType.EOS)
                    capture.stop()
                    self.assertEqual(capture.video_stale_before_copy,6)
                    self.assertEqual(capture.video_bytes_avoided,6*1280*720*3//2)
                    self.assertEqual(output.getvalue(),b'')
                    if ring:self.assertEqual(ring.inflight,set())
                finally:
                    capture.stop()
                    if ring:ring.close()

    def test_failed_ipc_keeps_slot_until_teardown_or_ack(self):
        class BrokenOutput(io.BytesIO):
            def write(self,data):
                raise BrokenPipeError('Injected IPC failure')
        ring=FrameRing(1280,720)
        capture=Capture(BrokenOutput(),lambda:None);capture.ring=ring
        try:
            self.run_buffers(capture)
            capture.stop()
            self.assertEqual(len(ring.inflight),1)
            self.assertEqual(ring.free.qsize(),2)
        finally:
            capture.stop();ring.close()
