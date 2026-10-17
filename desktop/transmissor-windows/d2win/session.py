"""Bounded session ownership: backend grants, native RTC tracks, Windows capture."""
import asyncio
import threading
import time
from .backend import Backend
from .config import SafeError
from .media import now_us
from .sdk import close_track


class Session:
    def __init__(self, config, target, output, status, capture_factory=None, backend_factory=Backend, rtc=None, telemetry=None):
        self.config, self.target, self.output = config, target, output
        self.status = status
        self.cancel = threading.Event()
        self.capture_factory = capture_factory
        self.backend_factory, self.rtc = backend_factory, rtc
        self.capture = None
        self.report = {'schema': 2, 'platform': 'windows', 'profile': config.profile,
                       'acquired': False, 'releaseConfirmed': False, 'disconnected': False,
                       'captureClosed': False, 'tracksClosed': False, 'sourcesClosed': False,
                       'hardwareEncoded': 0, 'encodedRejected': 0, 'videoSubmitted': 0, 'audioSubmitted': 0, 'staleDropped': 0,
                       'samples': [], 'captureObserved': False, 'audioObserved': False, 'synthetic': False}
        self.failure = None
        self.telemetry = telemetry or (lambda _: None)

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
        encoder = None
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
            # Probe only after authentication and exclusive reservation. Test doubles
            # keep using the original raw source contract.
            if self.config.encoder_mode == 'auto' and hasattr(rtc, 'EncodedVideoSource'):
                from .encoder import select_encoder
                encoder, attempts = await asyncio.to_thread(select_encoder, media)
                self.report['encoderProbe'] = attempts
            self.report['encoderPath'] = encoder.name if encoder else 'livekit-raw-h264'
            if encoder:
                video = rtc.EncodedVideoSource(media['width'], media['height'])
                self.status('H.264 por hardware: ' + encoder.name)
            else:
                video = rtc.VideoSource(media['width'], media['height'], is_screencast=True)
                self.status('H.264 do LiveKit; hardware externo indisponível.')
            sources.append(video)
            track = rtc.LocalVideoTrack.create_video_track('screen', video)
            tracks.append(track)
            options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE,
                                             video_codec=rtc.VideoCodec.H264, simulcast=False,
                                             video_encoding=rtc.VideoEncoding(max_bitrate=media['bitrate'], max_framerate=media['fps']))
            if encoder:
                options.video_encoder = rtc.VideoEncoderBackend.ENCODER_BACKEND_PRE_ENCODED
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
            from .diagnostics import Diagnostics
            diagnostics = Diagnostics()
            # A single outstanding native submission: no task-per-frame backlog.
            # Shield and drain it during stop before disposing source/track handles.
            async def submit(data, timestamp):
                def native_submit():
                    if encoder:
                        payload, key = encoder.encode(data, timestamp, video.take_feedback())
                        self.report['hardwareEncoded'] += 1
                        self.report['hardwareEncodeMs'] = encoder.last_encode_ms
                        frame = rtc.EncodedVideoFrame(payload, media['width'], media['height'], rtc.VideoCodec.H264,
                            rtc.EncodedFrameType.ENCODED_FRAME_KEY if key else rtc.EncodedFrameType.ENCODED_FRAME_DELTA, timestamp)
                        if not video.capture_frame(frame):
                            # No subscriber/encoder attached yet is not a capture failure.
                            # The next accepted AU must not depend on a rejected P frame.
                            encoder.force_keyframe = True
                            return False
                    else:
                        video.capture_frame(rtc.VideoFrame(media['width'], media['height'], rtc.VideoBufferType.I420, data), timestamp_us=timestamp)
                    return True
                pending = asyncio.create_task(asyncio.to_thread(native_submit))
                try:
                    return await asyncio.shield(pending)
                except asyncio.CancelledError:
                    await pending
                    raise
            async def video_loop():
                while not self.cancel.is_set():
                    frame = self.capture.video.get()
                    if frame:
                        data, timestamp = frame
                        if now_us() - timestamp > 150_000:
                            self.report['staleDropped'] += 1
                        else:
                            age = (now_us() - timestamp) / 1000
                            begin = time.perf_counter()
                            accepted = await submit(data, timestamp)
                            self.report['lastSubmitMs'] = (time.perf_counter()-begin)*1000
                            self.report['lastCaptureToSubmitMs'] = age
                            self.report['videoSubmitted' if accepted else 'encodedRejected'] += 1
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
            async def diagnostics_loop():
                while not self.cancel.is_set():
                    sample = await diagnostics.sample(track, self.capture, self.report)
                    if encoder:
                        sample['encodedFps'] = sample['externalEncodedFps']
                        sample['encodeMs'] = None
                        sample['encoder'] = encoder.name
                        sample['hardwareEncodeMs'] = self.report.get('hardwareEncodeMs')
                    sample['submitMs'] = self.report.get('lastSubmitMs')
                    sample['captureToSubmitMs'] = self.report.get('lastCaptureToSubmitMs')
                    self.report['samples'].append(sample)
                    del self.report['samples'][:-1800]  # At most one hour; no unbounded log.
                    self.telemetry(sample)
                    await asyncio.sleep(2)
            tasks = [asyncio.create_task(video_loop()), asyncio.create_task(diagnostics_loop())]
            if audio:
                tasks.append(asyncio.create_task(audio_loop()))
            self.status('Transmitindo — ' + self.config.profile + ' • ' + self.report['encoderPath'])
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
            if encoder:
                encoder.close()
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
