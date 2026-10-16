import io
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from capture import Capture
import gi
gi.require_version('Gst','1.0')
from gi.repository import Gst


class Pipeline(unittest.TestCase):
    def test_profile_output_without_duplicates(self):
        capture=Capture(io.BytesIO(),lambda:None)
        capture.width,capture.height=1280,720
        description=capture.video_description(
            'videotestsrc name=source num-buffers=120 pattern=black ! '
            'video/x-raw,format=BGRx,width=64,height=64,framerate=60/1',30)
        # Execute the actual builder in C, without IPC/capture callbacks or private content.
        description=description[:description.index('appsink')]+'identity name=count silent=true ! fakesink sync=false'
        pipeline=Gst.parse_launch(description)
        try:
            pipeline.set_state(Gst.State.PLAYING)
            event=pipeline.get_bus().timed_pop_filtered(10*Gst.SECOND,Gst.MessageType.EOS|Gst.MessageType.ERROR)
            self.assertIsNotNone(event)
            self.assertEqual(event.type,Gst.MessageType.EOS)
            rate=pipeline.get_by_name('rate')
            self.assertEqual(rate.get_property('duplicate'),0)
            self.assertLessEqual(pipeline.get_by_name('count').get_property('stats').get_value('num-buffers'),61)
            caps=pipeline.get_by_name('count').get_static_pad('src').get_current_caps().get_structure(0)
            self.assertEqual((caps.get_value('width'),caps.get_value('height')),(1280,720))
        finally:pipeline.set_state(Gst.State.NULL)

    def test_1080p60_profile_keeps_dimensions_and_requested_rate(self):
        capture=Capture(io.BytesIO(),lambda:None)
        description=capture.video_description(
            'videotestsrc name=source num-buffers=2 pattern=black ! '
            'video/x-raw,format=I420,width=64,height=64,framerate=60/1',60)
        description=description[:description.index('appsink')]+'identity name=count silent=true ! fakesink sync=false'
        pipeline=Gst.parse_launch(description)
        try:
            pipeline.set_state(Gst.State.PLAYING)
            event=pipeline.get_bus().timed_pop_filtered(10*Gst.SECOND,Gst.MessageType.EOS|Gst.MessageType.ERROR)
            self.assertIsNotNone(event)
            self.assertEqual(event.type,Gst.MessageType.EOS)
            caps=pipeline.get_by_name('count').get_static_pad('src').get_current_caps().get_structure(0)
            self.assertEqual((caps.get_value('width'),caps.get_value('height')),(1920,1080))
            self.assertEqual(tuple(caps.get_fraction('framerate')),(True,60,1))
            self.assertEqual(pipeline.get_by_name('rate').get_property('duplicate'),0)
        finally:pipeline.set_state(Gst.State.NULL)
