"""Three sealed memfd slots. Reuse only after the synchronous SDK copy acknowledges a slot."""
import fcntl
import mmap
import os
import queue
from pathlib import Path

FRAME_BYTES = 1920*1080*3//2
SLOTS = 3
STRIDE = ((FRAME_BYTES+mmap.PAGESIZE-1)//mmap.PAGESIZE)*mmap.PAGESIZE


class FrameRing:
    def __init__(self, width=1920, height=1080):
        if (width, height) not in ((1920, 1080), (1280, 720)):
            raise ValueError("Perfil de vídeo inválido")
        self.frame_bytes = width*height*3//2
        self.stride = ((self.frame_bytes+mmap.PAGESIZE-1)//mmap.PAGESIZE)*mmap.PAGESIZE
        self.fd = os.memfd_create('discord2-frames', os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
        os.ftruncate(self.fd, self.stride*SLOTS)
        fcntl.fcntl(self.fd, fcntl.F_ADD_SEALS, fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL)
        self.mapping = mmap.mmap(self.fd, self.stride*SLOTS)
        self.free = queue.LifoQueue()
        self.inflight = set()
        for slot in range(SLOTS):
            self.free.put(slot)
        self.dropped = 0

    def put(self, data):
        if len(data) != self.frame_bytes:
            raise ValueError('Formato de vídeo incompatível com o ring I420')
        slot = self.reserve()
        if slot is None:
            return None
        try:
            self.write_reserved(slot, data)
        except Exception:
            self.release(slot)
            raise
        return slot

    def reserve(self):
        """Claim capacity before extracting a full frame from PyGObject."""
        try:
            slot = self.free.get_nowait()
        except queue.Empty:
            self.dropped += 1
            return None
        self.inflight.add(slot)
        return slot

    def write_reserved(self, slot, data):
        if slot not in self.inflight or len(data) != self.frame_bytes:
            raise ValueError('Slot ou formato de vídeo inválido')
        self.mapping.seek(slot*self.stride)
        self.mapping.write(data)

    def release(self, slot):
        if slot in self.inflight:
            self.inflight.remove(slot)
            self.free.put(slot)

    def close(self):
        self.mapping.close()
        os.close(self.fd)


def available():
    return Path(__file__).with_name('native').joinpath('shm.node').is_file()
