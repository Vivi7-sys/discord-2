"""Bounded session ownership: backend grants, native RTC tracks, Windows capture."""
import asyncio
import threading
import time
from .backend import Backend
from .config import SafeError
from .media import now_us
from .sdk import close_track


class Session:
    def __init__(self, config, target, output, status, capture_factory=None, backend_factory=Backend, rtc=None):
        self.config, self.target, self.output = config, target, output
        self.status = status
        self.cancel = threading.Event()
        self.capture_factory = capture_factory
        self.backend_factory, self.rtc = backend_factory, rtc
        self.capture = None
        self.report = {'schema': 1, 'platform': 'windows', 'profile': config.profile,
                       'acquired': False, 'releaseConfirmed': False, 'disconnected': False,
                       'captureClosed': False, 'tracksClosed': False, 'sourcesClosed': False,
                       'videoSubmitted': 0, 'audioSubmitted': 0, 'staleDropped': 0,
                       'captureObserved': False, 'audioObserved': False, 'synthetic': False}
        self.failure = None

    def stop(self):
        self.cancel.set()

    def native_error(self, message):
        self.failure = message  # Capture adapter supplies fixed strings only.
        self.stop()

    async def step(self, operation):
        task = asyncio.ensure_future(operation)
        try:
            deadline = time.monotonic() + 25
            while not task.done():
                if self.cancel.is_set():
                    raise asyncio.CancelledError()
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                await asyncio.sleep(.03)
            return await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def run(self):
        import os
        os.environ['RUST_LOG'] = 'off'
        if self.rtc is None:
            from livekit import rtc
            self.rtc = rtc
        rtc = self.rtc
        backend = self.backend_factory(self.config)
        room = rtc.Room()
        sources, tracks, tasks = [], [], []
        reserved = False
        closing = False
        @room.on('disconnected')
        def disconnected(*args):
            if not closing:
                self.native_error('Conexão perdida. Captura encerrada; confira a rede e tente novamente.')
        try:
            self.report['stage'] = 'token'
            self.status('Conectando à sala…')
            url, token = await self.step(backend.login())
            self.report['stage'] = 'connect'
            await self.step(room.connect(url, token, options=rtc.RoomOptions(auto_subscribe=False, dynacast=False)))
            if self.cancel.is_set():
                return
            self.status('Reservando transmissão…')
            self.report['stage'] = 'acquire'
            reserved = True  # Also release if the acquire reply is lost.
            await self.step(backend.share('acquire'))
            self.report['acquired'] = True
            media = self.config.media
            self.report['stage'] = 'publish-video'
            video = rtc.VideoSource(media['width'], media['height'], is_screencast=True)
            sources.append(video)
            track = rtc.LocalVideoTrack.create_video_track('screen', video)
            tracks.append(track)
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE,
                                             video_codec=rtc.VideoCodec.H264, simulcast=False,
                                             video_encoding=rtc.VideoEncoding(max_bitrate=media['bitrate'], max_framerate=media['fps']))
            await self.step(room.local_participant.publish_track(track, options))
            audio = None
            from .audio_choice import normalize
            if normalize(self.output).mode != 'none':
                self.report['stage'] = 'publish-audio'
                audio = rtc.AudioSource(48000, 2, queue_size_ms=100)
                sources.append(audio)
                audio_track = rtc.LocalAudioTrack.create_audio_track('screen-audio', audio)
                tracks.append(audio_track)
                audio_options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO, dtx=False)
                audio_options.audio_encoding.max_bitrate = 128000
                await self.step(room.local_participant.publish_track(audio_track, audio_options))
            if self.capture_factory is None:
                from .native_windows import Capture
                self.capture_factory = Capture
            self.report['stage'] = 'capture'
            self.capture = self.capture_factory(self.target, self.output, media, self.native_error)
            # Do not block asyncio delivery of RTC messages during COM/WGC initialization.
            await asyncio.to_thread(self.capture.start)
            if self.cancel.is_set():
                return
            async def video_loop():
                while not self.cancel.is_set():
                    frame = self.capture.video.get()
                    if frame:
                        data, timestamp = frame
                        if now_us() - timestamp > 500_000:
                            self.report['staleDropped'] += 1
                        else:
                            video.capture_frame(rtc.VideoFrame(media['width'], media['height'], rtc.VideoBufferType.I420, data), timestamp_us=timestamp)
                            self.report['videoSubmitted'] += 1
                            self.report['captureObserved'] = True
                    await asyncio.sleep(.002)
            async def audio_loop():
                while not self.cancel.is_set():
                    frame = self.capture.audio.get()
                    if frame:
                        data, timestamp = frame
                        if now_us() - timestamp > 500_000:
                            self.report['staleDropped'] += 1
                            audio.clear_queue()
                        elif data:
                            await audio.capture_frame(rtc.AudioFrame(data, 48000, 2, len(data)//4))
                            self.report['audioSubmitted'] += 1
                            self.report['audioObserved'] = True
                    await asyncio.sleep(.002)
            tasks = [asyncio.create_task(video_loop())]
            if audio:
                tasks.append(asyncio.create_task(audio_loop()))
            self.status('Transmitindo — perfil ' + self.config.profile)
            while not self.cancel.is_set():
                for task in tasks:
                    if task.done():
                        await task  # Never ignore exceptions in publication tasks.
                if self.capture.stream is not None and not self.capture.stream.is_active():
                    self.native_error('A saída de áudio foi interrompida. Confira o dispositivo e reinicie.')
                await asyncio.sleep(.05)
        except asyncio.CancelledError:
            pass
        except SafeError as error:
            self.failure = str(error)
        except Exception as error:
            self.report['failureKind'] = type(error).__name__
            self.failure = 'Não foi possível transmitir. Confira captura, rede e dependências; tente novamente.'
        finally:
            closing = True
            self.cancel.set()
            self.status('Encerrando captura e liberando transmissão…')
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if self.capture:
                try:
                    await asyncio.to_thread(self.capture.close)
                    self.report['captureClosed'] = True
                except Exception:
                    self.failure = self.failure or 'Falha ao encerrar a captura. Feche o aplicativo antes de reiniciar.'
                self.report['capture'] = dict(self.capture.metrics)
            else:
                self.report['captureClosed'] = True
            if reserved:
                self.report['releaseConfirmed'] = await backend.release()
            try:
                async with asyncio.timeout(6):
                    await room.disconnect()
                    self.report['disconnected'] = True
            except Exception:
                pass
            async def close_all(items):
                results = await asyncio.gather(*(item.aclose() for item in items), return_exceptions=True)
                return all(not isinstance(result, BaseException) for result in results)
            track_results = []
            for track in tracks:
                try:
                    close_track(track)
                    track_results.append(True)
                except Exception:
                    track_results.append(False)
            self.report['tracksClosed'] = all(track_results)
            self.report['sourcesClosed'] = await close_all(sources)
            await backend.close()
            message = self.failure or 'Parado'
            if reserved and not self.report['releaseConfirmed']:
                message += ' Liberação não confirmada; o servidor verificará a desconexão na próxima tentativa.'
            self.status(message)
