import errno
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from frame_ring import FrameRing, FRAME_BYTES, available

class Ring(unittest.TestCase):
    def test_bounds_ownership_and_no_reuse_until_ack(self):
        ring=FrameRing()
        try:
            slots=[ring.put(bytes([n])*FRAME_BYTES) for n in (1,2,3)]
            self.assertEqual(len(set(slots)),3)
            self.assertIsNone(ring.put(bytes(FRAME_BYTES)))
            ring.release(slots[0]);ring.release(slots[0])
            self.assertEqual(ring.put(bytes(FRAME_BYTES)),slots[0])
            self.assertIsNone(ring.put(bytes(FRAME_BYTES)))
            with self.assertRaises(ValueError):ring.put(bytes(10))
            with self.assertRaises(OSError):os.ftruncate(ring.fd,0)
        finally:ring.close()

    @unittest.skipUnless(available(),'Run npm run build:native first')
    def test_node_maps_exact_slot_and_rejects_invalid_descriptors(self):
        ring=FrameRing()
        try:
            slot=ring.put(bytes([127])*FRAME_BYTES)
            addon=str(Path(__file__).resolve().parents[1]/'native/shm.node')
            code="""const m=require(process.argv[1]), fd=Number(process.argv[2]),slot=Number(process.argv[3]);
            const a=new Uint8Array(m.mapFrame(fd,slot));let rejected=0;
            for(const args of [[-1,0],[fd,3],[fd,-1],[0,0]]){try{m.mapFrame(...args);}catch{rejected++;}}
            console.log(JSON.stringify({bytes:a.byteLength,first:a[0],last:a[a.length-1],rejected}));"""
            result=subprocess.check_output(['node','-e',code,addon,str(ring.fd),str(slot)],pass_fds=(ring.fd,))
            self.assertEqual(json.loads(result),dict(bytes=FRAME_BYTES,first=127,last=127,rejected=4))
        finally:ring.close()

    @unittest.skipUnless(available(), 'Run npm run build:native first')
    def test_720_mapping_rejects_mismatched_profile(self):
        ring=FrameRing(1280,720)
        try:
            slot=ring.put(bytes([91])*ring.frame_bytes)
            addon=str(Path(__file__).resolve().parents[1]/'native/shm.node')
            code="""const m=require(process.argv[1]),fd=Number(process.argv[2]),slot=Number(process.argv[3]);
            const bytes=1280*720*3/2,a=new Uint8Array(m.mapFrame(fd,slot,bytes));let rejected=0;
            for(const size of [1920*1080*3/2,1,0,999999]){try{m.mapFrame(fd,slot,size);}catch{rejected++;}}
            console.log(JSON.stringify({bytes:a.byteLength,last:a[a.length-1],rejected}));"""
            result=subprocess.check_output(['node','-e',code,addon,str(ring.fd),str(slot)],pass_fds=(ring.fd,))
            self.assertEqual(json.loads(result),dict(bytes=ring.frame_bytes,last=91,rejected=4))
        finally:ring.close()
        with self.assertRaises(ValueError):FrameRing(1280,1080)
