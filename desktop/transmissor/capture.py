import json
import os
import struct
import subprocess
import threading
import uuid
import time
import resource
import fcntl
from metrics import MediaMetrics
from audio import apply_gain, monitor_state, monitors
import gi

gi.require_version('Gst', '1.0')
from gi.repository import Gio, GLib, Gst
Gst.init(None)


class SelectionCancelled(RuntimeError):
    pass


class Portal:
    def __init__(self, ended):
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.session = None
        self.session_closed = False
        self.fd = None
        self.ended = ended
        self.closed_subscription = None
        self.cancelled = threading.Event()
        self.pending = None

    def request(self, method, signature, args, options):
        token = 'd2_' + uuid.uuid4().hex
        options['handle_token'] = GLib.Variant('s', token)
        sender = self.bus.get_unique_name()[1:].replace('.', '_')
        path = '/org/freedesktop/portal/desktop/request/' + sender + '/' + token
        done, result = threading.Event(), []
        def response(*a):
            result.append(a[5].unpack())
            done.set()
        sub = self.bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request',
                                        'Response', path, None, Gio.DBusSignalFlags.NONE, response)
        self.pending = path
        try:
            self.bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
                               'org.freedesktop.portal.ScreenCast', method,
                               GLib.Variant(signature, (*args, options)), None,
                               Gio.DBusCallFlags.NONE, 10000, None)
            for _ in range(1200):
                if done.wait(.1):
                    break
                if self.cancelled.is_set():
                    raise SelectionCancelled('Seleção cancelada')
            else:
                raise RuntimeError('Tempo de seleção excedido')
            if result[0][0] == 1:
                raise SelectionCancelled('Seleção cancelada')
            if result[0][0] != 0:
                raise RuntimeError('Captura não autorizada')
            return result[0][1]
        finally:
            if not done.is_set():
                try:
                    self.bus.call_sync('org.freedesktop.portal.Desktop', path,
                                       'org.freedesktop.portal.Request', 'Close', None,
                                       None, Gio.DBusCallFlags.NONE, 2000, None)
                except GLib.Error:
                    pass
            self.bus.signal_unsubscribe(sub)
            self.pending = None

    def open(self, kind):
        r = self.request('CreateSession', '(a{sv})', (),
                         {'session_handle_token': GLib.Variant('s', 'd2_' + uuid.uuid4().hex)})
        self.session = r['session_handle']
        def closed(*args):
            self.session_closed = True
            self.ended()
        self.closed_subscription = self.bus.signal_subscribe(
            'org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Session', 'Closed',
            self.session, None, Gio.DBusSignalFlags.NONE, closed)
        self.request('SelectSources', '(oa{sv})', (self.session,),
                     {'types': GLib.Variant('u', kind), 'multiple': GLib.Variant('b', False)})
        r = self.request('Start', '(osa{sv})', (self.session, ''), {})
        streams = r.get('streams', [])
        if len(streams) != 1:
            raise RuntimeError('O portal deve retornar exatamente uma tela ou janela')
        selected_type = streams[0][1].get('source_type')
        if selected_type is not None and (selected_type not in (1, 2) or not (selected_type & kind)):
            raise RuntimeError('O portal retornou um tipo diferente da seleção solicitada')
        reply, fds = self.bus.call_with_unix_fd_list_sync(
            'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
            'org.freedesktop.portal.ScreenCast', 'OpenPipeWireRemote',
            GLib.Variant('(oa{sv})', (self.session, {})), GLib.VariantType.new('(h)'),
            Gio.DBusCallFlags.NONE, 10000, None, None)
        self.fd = fds.get(reply.unpack()[0])
        return streams[0]

    def close(self):
        self.cancelled.set()
        for path, interface in [(self.pending, 'Request'), (self.session, 'Session')]:
            if path:
                try:
                    self.bus.call_sync('org.freedesktop.portal.Desktop', path,
                                       'org.freedesktop.portal.' + interface, 'Close', None,
                                       None, Gio.DBusCallFlags.NONE, 2000, None)
                    if interface == 'Session':
                        self.session_closed = True
                except GLib.Error:
                    pass
        if self.closed_subscription:
            self.bus.signal_unsubscribe(self.closed_subscription)
            self.closed_subscription = None
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


# Protocol v2 uses independent pipes, [uint32 bytes, uint64 capture monotonic us].
# Video is packed I420, audio is interleaved S16LE 48 kHz stereo.
FRAME_HEADER = struct.Struct('<IQ')
VIDEO_BYTES = 1920 * 1080 * 3 // 2


class Capture:
    def __init__(self, output, ended, audio_output=None):
        self.output, self.audio_output, self.ended = output, audio_output, ended
        self.pipelines = []
        self.stopped = False
        self.counts = [0, 0]
        self.ipc_bytes = [0, 0]
        self.peak = 0
        self.metrics = [MediaMetrics(), MediaMetrics()]
        self.source_counts = [0, 0]
        self.source_times = [[None, None], [None, None]]
        self.started = time.monotonic()
        self.cpu_start = resource.getrusage(resource.RUSAGE_SELF)
        self.errors = []
        self.audio_gain_db = 0
        self.input_audio = MediaMetrics()
        self.limited_blocks = 0
        self.monitor = None
        self.ring = None
        self.width, self.height = 1920, 1080
        self.legacy_pipeline = False
        self.measure_stages = False
        self.stages = {}
        self.source_caps = [None, None]
        self.rate_stats = None
        self.copy_ms = dict(map=0.0, extract=0.0, ring=0.0)
        self.video_stale_before_copy = 0
        self.video_capacity_before_copy = 0
        self.video_bytes_avoided = 0
        self.synthetic_clock = False
        self.audio_source_device = None
        self.clock_offsets = [None, None]
        self.pipe_capacity = None
        try:
            fcntl.fcntl(output.fileno(), fcntl.F_SETPIPE_SZ, 1024*1024)
        except (OSError, AttributeError):
            pass  # Per-user kernel pipe quotas may forbid increasing capacity.
        try:
            self.pipe_capacity = fcntl.fcntl(output.fileno(), fcntl.F_GETPIPE_SZ)
        except (OSError, AttributeError):
            pass

    def pipeline(self, description, kind, source_setup=None):
        p = Gst.parse_launch(description)
        if source_setup:
            source_setup(p.get_by_name('source'))
        p.use_clock(Gst.SystemClock.obtain())
        sink = p.get_by_name('out')
        def sample(sink):
            sample = sink.emit('pull-sample')
            if self.stopped:
                return Gst.FlowReturn.FLUSHING
            if kind == 2 and self.audio_source_device is not None:
                current = p.get_by_name('source').get_property('current-device')
                if current != self.audio_source_device:
                    self.errors.append(dict(domain='capture-policy', code=1))
                    self.ended()
                    return Gst.FlowReturn.FLUSHING
            started = time.monotonic_ns()
            buffer = sample.get_buffer()
            running = sample.get_segment().to_running_time(Gst.Format.TIME, buffer.pts)
            # GStreamer clock epochs differ from Python/SDK monotonic time on this host.
            # Calibrate explicitly instead of passing a clock-domain offset into WebRTC.
            if self.clock_offsets[kind-1] is None:
                candidates = []
                for _ in range(3):
                    t0 = time.monotonic_ns()
                    gst_now = p.get_clock().get_time()
                    t1 = time.monotonic_ns()
                    candidates.append((t1-t0, (t0+t1)//2-gst_now))
                offset = min(candidates)[1]
                self.clock_offsets[kind-1] = offset/1e6
            else:
                offset = round(self.clock_offsets[kind-1]*1e6)
            pts_us = (p.get_base_time()+running+offset)//1000 if running != Gst.CLOCK_TIME_NONE else started//1000
            metric = self.metrics[kind-1]
            if metric.caps is None:
                metric.caps = sample.get_caps().to_string()
            # The publisher also checks age after IPC. Reject already-old video
            # here, before map/data extraction and memfd copies. Audio is unchanged.
            if kind == 1 and started//1000-pts_us > 500000:
                self.video_stale_before_copy += 1
                self.video_bytes_avoided += buffer.get_size()
                return Gst.FlowReturn.OK
            slot = None
            if kind == 1 and self.ring:
                slot = self.ring.reserve()
                if slot is None:
                    self.video_capacity_before_copy += 1
                    self.video_bytes_avoided += buffer.get_size()
                    return Gst.FlowReturn.OK
            mapped = None
            notification_started = False
            try:
                map_start = time.monotonic_ns()
                ok, mapped = buffer.map(Gst.MapFlags.READ)
                self.copy_ms["map"] += (time.monotonic_ns()-map_start)/1e6
                if not ok:
                    mapped = None
                    self.ended()
                    return Gst.FlowReturn.ERROR
                extract_start = time.monotonic_ns()
                data = mapped.data
                self.copy_ms["extract"] += (time.monotonic_ns()-extract_start)/1e6
                if kind == 2:
                    self.input_audio.pcm(data)
                    data, limited = apply_gain(data, self.audio_gain_db)
                    self.limited_blocks += limited
                    metric.pcm(data)
                    self.peak = metric.peak
                if kind == 1 and self.ring:
                    ring_start = time.monotonic_ns()
                    self.ring.write_reserved(slot, data)
                    self.copy_ms["ring"] += (time.monotonic_ns()-ring_start)/1e6
                    payload = struct.pack('<I', slot)
                else:
                    payload = data
                target = self.output if kind == 1 else self.audio_output
                if target is None:
                    raise ValueError('Audio requires an independent pipe')
                write_start = time.monotonic_ns()
                # Once an IPC write starts, ownership may have reached the SDK
                # even if flush fails. Only its ACK (or teardown) can release it.
                notification_started = True
                target.write(FRAME_HEADER.pack(len(payload), pts_us))
                target.write(payload)
                target.flush()
                finished = time.monotonic_ns()
                metric.record(len(data), pts_us, finished-started, finished-write_start,
                              buffer.duration//1000 if buffer.duration != Gst.CLOCK_TIME_NONE else 0)
                self.counts[kind-1] += 1
                self.ipc_bytes[kind-1] += FRAME_HEADER.size+len(payload)
            except (OSError, ValueError):
                self.ended()
                return Gst.FlowReturn.ERROR
            finally:
                if mapped is not None:
                    buffer.unmap(mapped)
                if slot is not None and not notification_started:
                    self.ring.release(slot)
            return Gst.FlowReturn.OK
        sink.connect('new-sample', sample)
        # Correlate PTS at element pads. These are elapsed times including scheduling,
        # not CPU or GPU execution times. Bounded maps; no media is retained.
        for name in (('waiting', 'convert', 'scale') if self.measure_stages else ()):
            element = p.get_by_name(name)
            if element is None:
                continue
            pending = {}
            stat = self.stages.setdefault(name, dict(buffers=0, totalMs=0.0, maxMs=0.0))
            def before(pad, info, pending=pending):
                if len(pending) >= 128:
                    pending.clear()
                pending[info.get_buffer().pts] = time.monotonic_ns()
                return Gst.PadProbeReturn.OK
            def after(pad, info, pending=pending, stat=stat):
                start = pending.pop(info.get_buffer().pts, None)
                if start is not None:
                    ms = (time.monotonic_ns()-start)/1e6
                    stat['buffers'] += 1
                    stat['totalMs'] += ms
                    stat['maxMs'] = max(stat['maxMs'], ms)
                return Gst.PadProbeReturn.OK
            element.get_static_pad('sink').add_probe(Gst.PadProbeType.BUFFER, before)
            element.get_static_pad('src').add_probe(Gst.PadProbeType.BUFFER, after)
        source = p.get_by_name('source')
        if source:
            def incoming(pad, info):
                if self.synthetic_clock:
                    # TestSrc timestamps count frames even when its generator falls behind.
                    # Synthetic capture time is generation time, not the missed schedule.
                    b = info.get_buffer()
                    b.pts = p.get_clock().get_time()-p.get_base_time()
                self.source_counts[kind-1] += 1
                now = time.monotonic()
                self.source_times[kind-1][0] = self.source_times[kind-1][0] or now
                self.source_times[kind-1][1] = now
                if self.source_caps[kind-1] is None:
                    caps = pad.get_current_caps()
                    self.source_caps[kind-1] = caps.to_string() if caps else None
                return Gst.PadProbeReturn.OK
            source.get_static_pad('src').add_probe(Gst.PadProbeType.BUFFER, incoming)
        bus = p.get_bus()
        bus.add_signal_watch()
        def message(bus, m):
            if not self.stopped and m.type in (Gst.MessageType.ERROR, Gst.MessageType.EOS, Gst.MessageType.CLOCK_LOST):
                # Keep only domain/code; GStreamer debug strings can contain device identifiers.
                if m.type == Gst.MessageType.ERROR:
                    e, _ = m.parse_error()
                    self.errors.append(dict(domain=e.domain, code=e.code))
                self.ended()
        bus.connect('message', message)
        self.pipelines.append(p)
        if p.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            raise RuntimeError('Falha no pipeline de captura')

    def video_description(self, source, fps):
        prefix = source + ' ! queue name=waiting max-size-buffers=2 max-size-bytes=0 max-size-time=0 leaky=downstream ! '
        conversions = 'videoconvert name=convert ! videoscale name=scale add-borders=true ! '
        rate = f'videorate name=rate drop-only=true ! video/x-raw,framerate={fps}/1 ! '
        middle = conversions + 'videorate name=rate ! ' if self.legacy_pipeline else rate + conversions
        return (prefix + middle +
                f'video/x-raw,format=I420,width={self.width},height={self.height},framerate={fps}/1,pixel-aspect-ratio=1/1 ! '
                'appsink name=out emit-signals=true max-buffers=1 drop=true sync=false')

    def start(self, portal, stream, fps, audio):
        node, properties = stream
        def setup(source):
            source.set_property('fd', portal.fd)
            serial = properties.get('pipewire-serial')
            if serial and source.find_property('target-object'):
                source.set_property('target-object', str(serial))
            else:
                source.set_property('path', str(node))
        # Rate-limit before CPU conversion and never synthesize duplicate frames.
        source = 'pipewiresrc name=source do-timestamp=true provide-clock=false'
        if not self.legacy_pipeline:
            # Negotiate square desktop pixels at the source. Without this constraint
            # this host fixated a pathological PAR of 1/2147483647 upstream.
            source += ' ! video/x-raw,pixel-aspect-ratio=1/1'
        self.pipeline(self.video_description(source, fps), 1, setup)
        if audio:
            if audio not in [s['name'] for s in monitors()]:
                raise RuntimeError('Áudio deve ser monitor de saída; microfones são bloqueados')
            self.monitor = monitor_state(audio)
            self.audio_source_device = audio
            def audio_setup(source):
                source.set_property('device', audio)
                props = Gst.Structure.new_empty('props')
                props.set_value('node.dont-fallback', True)
                props.set_value('node.dont-reconnect', True)
                source.set_property('stream-properties', props)
                source.set_property('volume', 1.0)
                source.set_property('mute', False)
            self.pipeline('pulsesrc name=source do-timestamp=true provide-clock=false buffer-time=200000 latency-time=20000 ! '
                          'queue max-size-time=100000000 max-size-buffers=0 max-size-bytes=0 leaky=downstream ! '
                          'audioconvert ! audioresample ! '
                          'audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved ! '
                          'appsink name=out emit-signals=true max-buffers=3 drop=true sync=false', 2,
                          audio_setup)

    def snapshot(self):
        cpu = resource.getrusage(resource.RUSAGE_SELF)
        elapsed = time.monotonic()-self.started
        cpu_seconds = cpu.ru_utime+cpu.ru_stime-self.cpu_start.ru_utime-self.cpu_start.ru_stime
        return dict(elapsedSeconds=round(elapsed, 3), pythonCpuSeconds=round(cpu_seconds, 3),
                    pythonCpuPercent=round(100*cpu_seconds/elapsed, 2),
                    sourceBuffers=self.source_counts,
                    sourceFps=[(n-1)/(t[1]-t[0]) if n>1 and t[1]>t[0] else 0 for n,t in zip(self.source_counts,self.source_times)], video=self.metrics[0].snapshot(),
                    audio=self.metrics[1].snapshot(), inputAudio=self.input_audio.snapshot(),
                    gainDb=self.audio_gain_db, limitedBlocks=self.limited_blocks,
                    transport='memfd-ring' if self.ring else 'pipe',
                    sourceCaps=self.source_caps, stages=self.stages, copyMs=self.copy_ms, rate=self.rate_stats,
                    videoBeforeCopy=dict(stale=self.video_stale_before_copy,
                                         capacity=self.video_capacity_before_copy,
                                         bytesAvoided=self.video_bytes_avoided),
                    ringDropped=self.ring.dropped if self.ring else 0, clockOffsetsMs=self.clock_offsets, ipcBytes=self.ipc_bytes, monitor=self.monitor, videoPipeBytes=self.pipe_capacity, errors=self.errors)

    def stop(self):
        self.stopped = True
        for p in self.pipelines:
            rate = p.get_by_name('rate')
            if rate:
                self.rate_stats = {k: rate.get_property(k) for k in ('in', 'out', 'drop', 'duplicate')}
            p.set_state(Gst.State.NULL)
            p.get_bus().remove_signal_watch()
        self.pipelines.clear()
