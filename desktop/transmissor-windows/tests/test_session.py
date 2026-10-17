import asyncio
from pathlib import Path
import sys
import types
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from d2win.config import configuration, SafeError
from d2win.session import Session
from d2win.media import Latest

class NativeHandle:
    def __init__(self):self.closed=False
    def dispose(self):self.closed=True
class Track:
    def __init__(self):self._ffi_handle=NativeHandle()
    @staticmethod
    def create_video_track(*args):return Track()
    create_audio_track=create_video_track
class Source:
    def __init__(self,*args,**kwargs):self.closed=False
    async def aclose(self):self.closed=True
class FakeBackend:
    def __init__(self,config):self.closed=False;self.released=0
    async def login(self):return 'wss://example.test','ephemeral'
    async def share(self,action):return {}
    async def release(self):self.released+=1;return True
    async def close(self):self.closed=True
class FakeRoom:
    def __init__(self):
        self.closed=False
        self.local_participant=types.SimpleNamespace(publish_track=self.publish)
    def on(self,*args):return lambda callback:callback
    async def connect(self,*args,**kwargs):pass
    async def publish(self,*args):pass
    async def disconnect(self):self.closed=True
class Capture:
    def __init__(self,target,output,profile,stop):
        self.video=Latest();self.audio=Latest();self.stream=None;self.metrics={};self.closed=False;self.stop=stop
    def start(self):self.stop('Fixture stopped')
    def close(self):self.closed=True

def sdk(room):
    return types.SimpleNamespace(Room=lambda:room,RoomOptions=lambda **kw:kw,
        VideoSource=Source,AudioSource=Source,LocalVideoTrack=Track,LocalAudioTrack=Track,
        TrackPublishOptions=lambda **kw:types.SimpleNamespace(**kw,audio_encoding=types.SimpleNamespace()),VideoEncoding=lambda **kw:kw,AudioEncoding=lambda **kw:kw,
        TrackSource=types.SimpleNamespace(SOURCE_SCREENSHARE=1,SOURCE_SCREENSHARE_AUDIO=2),
        VideoCodec=types.SimpleNamespace(H264=0))

class Lifecycle(unittest.IsolatedAsyncioTestCase):
    async def test_stop_cleanup_and_repeat_sessions(self):
        for _ in range(2):
            room=FakeRoom();backend=FakeBackend(None)
            session=Session(configuration('https://example.test/sala/'+'a'*64,'Vivi','720p30'),None,None,
                            lambda _:None,capture_factory=Capture,backend_factory=lambda _:backend,rtc=sdk(room))
            await session.run()
            for key in ['acquired','releaseConfirmed','disconnected','captureClosed','tracksClosed','sourcesClosed']:
                self.assertTrue(session.report[key],key)
            self.assertTrue(backend.closed);self.assertEqual(backend.released,1)
    async def test_disconnect_exception_does_not_skip_release_or_source_cleanup(self):
        class Room(FakeRoom):
            async def disconnect(self):raise OSError('private exception')
        room=Room();backend=FakeBackend(None)
        session=Session(configuration('https://example.test/sala/'+'a'*64,'Vivi','720p30'),None,None,
                        lambda _:None,Capture,lambda _:backend,sdk(room))
        await session.run()
        self.assertTrue(session.report['releaseConfirmed']);self.assertTrue(session.report['sourcesClosed'])
        self.assertTrue(session.report['tracksClosed']);self.assertTrue(backend.closed)
    async def test_acquire_failure_releases_and_never_captures(self):
        class Backend(FakeBackend):
            async def share(self,action):raise SafeError('Vaga ocupada')
        backend=Backend(None);room=FakeRoom()
        def no_capture(*args):raise AssertionError('Must not capture')
        session=Session(configuration('https://example.test/sala/'+'a'*64,'Vivi','720p30'),None,None,
                        lambda _:None,no_capture,lambda _:backend,sdk(room))
        await session.run()
        self.assertFalse(session.report['acquired']);self.assertEqual(backend.released,1)
        self.assertEqual(session.failure,'Vaga ocupada');self.assertTrue(room.closed)
    async def test_cancel_pending_login_does_not_acquire(self):
        class Backend(FakeBackend):
            async def login(self):await asyncio.sleep(100)
        backend=Backend(None);room=FakeRoom()
        session=Session(configuration('https://example.test/sala/'+'a'*64,'Vivi','720p30'),None,None,
                        lambda _:None,Capture,lambda _:backend,sdk(room))
        task=asyncio.create_task(session.run());await asyncio.sleep(.05);session.stop()
        await asyncio.wait_for(task,1)
        self.assertFalse(session.report['acquired']);self.assertEqual(backend.released,0)
        self.assertTrue(backend.closed)

    async def test_application_audio_failure_releases_and_next_session_can_start(self):
        from d2win.audio_choice import AudioChoice
        class FailedCapture(Capture):
            def start(self):raise SafeError('Application loopback unavailable; no fallback')
        for factory in (FailedCapture,Capture):
            room=FakeRoom();backend=FakeBackend(None)
            session=Session(configuration('https://example.test/sala/'+'a'*64,'Vivi','720p30'),None,AudioChoice('application'),
                            lambda _:None,factory,lambda _:backend,sdk(room))
            await session.run()
            self.assertTrue(session.report['captureClosed']);self.assertTrue(session.report['releaseConfirmed'])
            self.assertTrue(session.report['sourcesClosed']);self.assertTrue(session.report['tracksClosed'])
            self.assertEqual(backend.released,1)
