import array
import math
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audio import apply_gain
from metrics import MediaMetrics

class Gain(unittest.TestCase):
    def test_unity_preserves_pcm(self):
        pcm=array.array('h',[-32768,-12000,0,12000,32767]).tobytes()
        self.assertEqual(apply_gain(pcm,0),(pcm,False))

    def test_six_db_boosts_quiet_signal_without_clipping(self):
        pcm=array.array('h',[1000,-1000]*480).tobytes()
        out,limited=apply_gain(pcm,6)
        self.assertFalse(limited)
        self.assertAlmostEqual(array.array('h',out)[0],1995,delta=1)

    def test_headroom_preserves_shape_instead_of_clipping(self):
        out,limited=apply_gain(array.array('h',[0,15000,30000,-30000,-15000]).tobytes(),12)
        values=array.array('h',out)
        self.assertTrue(limited)
        self.assertLess(max(abs(v) for v in values),29206)
        self.assertAlmostEqual(values[1]/values[2],.5,delta=.001)

    def test_silence_stays_silence(self):
        self.assertEqual(apply_gain(bytes(1920),12),(bytes(1920),False))

    def test_dbfs_reference(self):
        pcm=array.array('h',[round(math.sin(i*2*math.pi/48)*1638) for i in range(4800)]).tobytes()
        metric=MediaMetrics();metric.pcm(pcm)
        self.assertAlmostEqual(metric.snapshot()['peakDbfs'],-26.02,delta=.02)
        self.assertAlmostEqual(metric.snapshot()['rmsDbfs'],-29.03,delta=.02)
