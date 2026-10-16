#!/usr/bin/python3
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
from capture import Portal, Capture, monitors, SelectionCancelled
from frame_ring import FrameRing, available as ring_available

HERE = Path(__file__).resolve().parent
PROFILES = json.loads((HERE / 'profiles.json').read_text())


def configuration(invite, name, fps, audio):
    u = urlparse(invite.strip())
    parts = u.path.strip('/').split('/')
    import re
    if (u.username or u.password or u.query or u.fragment or len(parts) != 2 or
            parts[0] != 'sala' or not re.fullmatch('[a-f0-9]{64}', parts[1]) or
            (u.scheme != 'https' and not (u.scheme == 'http' and u.hostname in ('localhost', '127.0.0.1')))):
        raise ValueError('Use o convite completo HTTPS /sala/… (ou localhost para testes)')
    name = re.sub(' +', ' ', name.strip())
    if (not 2 <= len(name.encode('utf-16-le')) // 2 <= 24 or
            any(ord(c) < 32 or ord(c) == 127 for c in name) or fps not in (30, 60)):
        raise ValueError('Confira nome e perfil')
    return dict(base=f'{u.scheme}://{u.netloc}', roomId=parts[1], name=name.strip(), fps=fps, audio=bool(audio), codec='h264')


def transmission_error(stage, reason):
    """Only fixed messages; never surface server/SDK text containing credentials."""
    if reason == 'API 429':
        return 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.'
    if stage == 'token' and reason == 'API 403':
        return 'Convite inválido ou expirado. Cole um novo convite do site Discord 2.'
    if stage == 'acquire' and reason == 'API 403':
        return 'O servidor não autorizou a transmissão. Confira se o compartilhamento está habilitado no site.'
    if stage == 'acquire' and reason == 'API 409':
        return 'Outra pessoa está transmitindo. Aguarde a liberação da vaga.'
    if reason == 'API 401':
        return 'Autorização recusada. Pare e entre novamente com o convite.'
    if reason == 'API 409':
        return 'Sala indisponível ou incompatível. Confira o convite e o limite de seis participantes.'
    if stage == 'connection':
        return 'Conexão perdida. Captura encerrada; confira a rede e tente iniciar novamente.'
    if stage in ('connect', 'token', 'acquire'):
        return 'Não foi possível conectar à sala. Confira a rede, o convite e a disponibilidade do site.'
    return 'Não foi possível publicar a mídia. Pare e tente iniciar novamente; salve o diagnóstico se persistir.'


class Session:
    def __init__(self, status):
        self.status = status
        self.cancel = threading.Event()
        self.portal = None
        self.capture = None
        self.child = None
        self.terminate_requested = False
        self.termination_lock = threading.Lock()
        self.failure = None
        self.release_pending = False
        self.publisher_metrics = None
        self.capture_metrics = None
        self.audio_pipe = None
        self.frame_ring = None
        self.publisher_stopped = False
        self.publisher_killed = False
        self.publisher_acquired = False
        self.publisher_released = False
        self.reader = None
        self.requested = None
        self.selected = None
        self.timings = {}
        self.started = time.monotonic()

    def mark(self, name):
        self.timings.setdefault(name, round(time.monotonic()-self.started, 3))

    def diagnostic(self):
        """Explicit allowlist. No invitation, names, token, source names or media."""
        return dict(schemaVersion=1, type='gtk-portal-pipewire-desktop',
                    timestamp=datetime.now(timezone.utc).isoformat(), requested=self.requested,
                    selected=self.selected,
                    captureObserved=bool(self.capture and self.capture.counts[0]), syntheticMedia=False,
                    timings=self.timings, capture=self.capture_metrics,
                    publisher=self.publisher_metrics, acquired=self.publisher_acquired,
                    releaseConfirmed=self.publisher_released, publisherStopped=self.publisher_stopped,
                    publisherKilled=self.publisher_killed, failure=self.failure,
                    resources=dict(pipelinesClosed=not self.capture or not self.capture.pipelines,
                                   portalFdClosed=not self.portal or self.portal.fd is None,
                                   portalSessionClosed=not self.portal or not getattr(self.portal, 'session', None) or
                                                       getattr(self.portal, 'session_closed', False),
                                   ringClosed=not self.frame_ring or self.frame_ring.mapping.closed,
                                   audioPipeClosed=not self.audio_pipe or self.audio_pipe.closed,
                                   publisherExited=not self.child or self.child.poll() is not None,
                                   readerStopped=not self.reader or not self.reader.is_alive(),
                                   pipesClosed=not self.child or all(s is None or s.closed for s in
                                                                  (self.child.stdin, self.child.stdout))),
                    humanAssessment='not-assessed', latencyAndAvSync='not-measured')

    def stop(self):
        self.mark('stopRequested')
        self.cancel.set()
        if self.capture:
            self.capture.stopped = True
        with self.termination_lock:
            if self.child and self.child.poll() is None and not self.terminate_requested:
                self.terminate_requested = True
                try:
                    self.child.terminate()
                except ProcessLookupError:
                    pass
        if self.portal:
            self.portal.cancelled.set()

    def run(self, config, kind, audio):
        failed = False
        try:
            profile = config.get('profile', '1080p60' if config['fps'] == 60 else '1080p30')
            if profile not in PROFILES or config['fps'] != PROFILES[profile]['fps']:
                raise ValueError('Perfil inválido')
            config = {**config, **PROFILES[profile], 'profile': profile}
            self.requested = dict(profile=profile, **PROFILES[profile],
                                  source='screen' if kind == 1 else 'window' if kind == 2 else 'screen-or-window',
                                  audio=bool(audio), gainDb=config.get('gainDb', 0), codec=config.get('codec', 'h264'))
            self.portal = Portal(self.stop)
            self.mark('selectionStarted')
            self.status('Selecione a tela ou janela no COSMIC')
            stream = self.portal.open(kind)
            # Compositor coordinates may differ from actual captured pixel dimensions.
            self.selected = dict(sourceType=stream[1].get('source_type'),
                                 compositorSize=stream[1].get('size'))
            self.mark('selectionFinished')
            if self.cancel.is_set():
                return
            # The subprocess inherits no backend credentials or unrelated environment secrets.
            env = {k: v for k, v in os.environ.items() if k in
                   ('PATH', 'HOME', 'LD_LIBRARY_PATH', 'DISCORD2_RTC_MODULE', 'NODE_PATH')}
            env['RUST_LOG'] = 'off'
            audio_read, audio_write = os.pipe() if config['audio'] else (None, None)
            if ring_available() and config.get('sharedMemory', True):
                self.frame_ring = FrameRing(config["width"], config["height"])
            config = {**config, 'protocolVersion': 2, 'audioFd': audio_read,
                      'videoMemFd': self.frame_ring.fd if self.frame_ring else None}
            try:
                self.child = subprocess.Popen(['/usr/bin/node', str(HERE / 'publisher.cjs')], stdin=subprocess.PIPE,
                                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
                                              pass_fds=tuple(fd for fd in [audio_read, config['videoMemFd']] if fd is not None))
            except Exception:
                if audio_write is not None:
                    os.close(audio_write)
                raise
            finally:
                if audio_read is not None:
                    os.close(audio_read)
            if audio_write is not None:
                self.audio_pipe = os.fdopen(audio_write, 'wb')
            if self.cancel.is_set():
                return
            self.child.stdin.write((json.dumps(config) + '\n').encode())
            self.child.stdin.flush()
            events = queue.Queue()
            def read():
                for line in self.child.stdout:
                    try:
                        event = json.loads(line)
                        state = event['state']
                        if state == 'video-release':
                            if self.frame_ring:
                                self.frame_ring.release(event.get('slot'))
                            continue
                        if state == 'telemetry':
                            if self.capture and self.capture.counts[0] and not self.cancel.is_set():
                                encoded = event.get('encodedFps')
                                self.status('Transmitindo — entrada %.1f FPS; codificados %s FPS' %
                                            (event.get('submittedFps', 0), '—' if encoded is None else '%.1f' % encoded))
                            continue
                        if state == 'metrics':
                            self.publisher_metrics = {k: v for k, v in event.items() if k != 'state'}
                        if state == 'error':
                            self.failure = transmission_error(event.get('stage'), event.get('reason'))
                            self.status(self.failure)
                        events.put(state)
                        if state == 'release-unconfirmed':
                            self.release_pending = True
                            self.status('Liberação não confirmada; desconectando')
                        if state == 'stopped':
                            self.publisher_stopped = True
                        if state == 'reservation-acquired':
                            self.publisher_acquired = True
                            self.mark('reservationAcquired')
                        if state == 'reservation-released':
                            self.publisher_released = True
                            self.mark('reservationReleased')
                        if state in ('error', 'stopped'):
                            self.cancel.set()
                    except (ValueError, KeyError):
                        pass
                self.cancel.set()
            self.reader = threading.Thread(target=read, daemon=True)
            self.reader.start()
            self.status('Conectando e reservando transmissão')
            while not self.cancel.is_set():
                try:
                    state = events.get(timeout=.2)
                    if state == 'ready':
                        break
                    if state == 'error':
                        raise RuntimeError('Backend ou LiveKit recusou a transmissão')
                except queue.Empty:
                    pass
            if self.cancel.is_set():
                return
            self.capture = Capture(self.child.stdin, self.stop, self.audio_pipe)
            self.capture.ring = self.frame_ring
            self.capture.width, self.capture.height = config["width"], config["height"]
            self.capture.measure_stages = config.get('measureStages', False)
            self.capture.test_conversion = config.get('testConversion', False)
            self.capture.legacy_pipeline = config.get('capturePipeline') == 'legacy'
            self.capture.audio_gain_db = config.get('gainDb', 0)
            self.capture.start(self.portal, stream, config['fps'], audio)
            self.mark('captureStarted')
            self.status('Transmitindo — %s / %s FPS' % (profile.split('p')[0]+'p', config['fps']))
            self.cancel.wait()
        except SelectionCancelled:
            self.status('Seleção cancelada')
        except Exception as error:
            failed = True
            self.failure = self.failure or ('Falha local: ' + type(error).__name__)
            self.status(str(error) if isinstance(error, RuntimeError) else 'Erro local: ' + type(error).__name__)
            # Do not surface SDK/network exceptions that might contain a JWT or invite.
            self.status('Não foi possível transmitir. Confira dependências, permissão e backend.')
        finally:
            self.stop()
            if self.child:
                try:
                    self.child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    self.publisher_killed = True
                    self.child.kill()
                    self.child.wait()
                if self.reader:
                    self.reader.join(timeout=2)
                for pipe in (self.child.stdin, self.child.stdout):
                    if pipe:
                        try:
                            pipe.close()
                        except OSError:
                            pass
            if self.capture:
                self.capture.stop()
                self.capture_metrics = self.capture.snapshot()
            if self.audio_pipe:
                try:
                    self.audio_pipe.close()
                except OSError:
                    pass
            if self.frame_ring:
                self.frame_ring.close()
            if self.portal:
                self.portal.close()
            self.mark('resourcesClosed')
            message = self.failure or ('Falha na transmissão; captura encerrada' if failed else 'Parado')
            if self.release_pending:
                message += ' Liberação da vaga não confirmada; o servidor verificará a desconexão na próxima tentativa.'
            self.status(message, True)


class Window(Gtk.Window):
    def __init__(self):
        super().__init__(title='Discord 2 Transmissor')
        self.set_icon_name('discord2-transmissor')
        self.set_default_size(440, 360)
        self.set_border_width(16)
        self.session = None
        self.last_session = None
        self.on_session_done = None
        self.closing = False
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.add(box)
        self.invite = Gtk.Entry(placeholder_text='Cole o convite do site Discord 2')
        self.name = Gtk.Entry(placeholder_text='Seu nome (2 a 24 caracteres)')
        self.kind = Gtk.ComboBoxText()
        self.kind.append_text('Tela'); self.kind.append_text('Janela'); self.kind.set_active(0)
        self.profile = Gtk.ComboBoxText()
        self.profile.append_text('1080p / 30 FPS'); self.profile.append_text('1080p / 60 FPS'); self.profile.append_text('720p / 30 FPS'); self.profile.set_active(0)
        self.audio = Gtk.ComboBoxText(); self.audio.append('none', 'Sem áudio'); self.audio.set_active_id('none')
        self.audio_refresh = Gtk.Button(label='Atualizar saídas de áudio')
        self.audio_refresh.connect('clicked', lambda *_: self.refresh_audio())
        self.audio.connect('notify::popup-shown', self.audio_popup)
        self.audio_notice = Gtk.Label()
        self.audio_notice.set_line_wrap(True)
        self.codec = Gtk.ComboBoxText()
        self.codec.append('h264', 'Codificação: automática (H.264)')
        self.codec.append('vp8', 'Codificação: VP8')
        self.codec.set_active_id('h264')
        self.gain = Gtk.ComboBoxText()
        for value, label in [('0', 'Ganho de captura: 0 dB'), ('6', 'Ganho de captura: +6 dB'), ('12', 'Ganho de captura: +12 dB')]:
            self.gain.append(value, label)
        self.gain.set_active_id('0')
        self.notice = Gtk.Label(label='Áudio: saída completa inclui chamadas.\nMicrofone bloqueado neste protótipo.')
        self.start_button = Gtk.Button(label='Selecionar e iniciar')
        self.stop_button = Gtk.Button(label='Parar'); self.stop_button.set_sensitive(False)
        self.report_button = Gtk.Button(label='Salvar diagnóstico da última sessão')
        self.report_button.set_sensitive(False)
        self.report_button.connect('clicked', self.save_report)
        self.label = Gtk.Label(label='Parado'); self.label.set_line_wrap(True)
        self.fields = [self.invite, self.name, self.kind, self.profile, self.audio, self.audio_refresh, self.codec, self.gain]
        for w in [self.invite, self.name, self.kind, self.profile, self.audio, self.audio_refresh, self.audio_notice]:
            box.pack_start(w, False, False, 0)
        advanced = Gtk.Expander(label='Opções avançadas')
        advanced_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        advanced.add(advanced_box)
        for w in [self.codec, self.gain]:
            advanced_box.pack_start(w, False, False, 0)
        for w in [advanced, self.notice, self.start_button, self.stop_button, self.report_button, self.label]:
            box.pack_start(w, False, False, 0)
        self.start_button.connect('clicked', self.start)
        self.stop_button.connect('clicked', lambda *_: self.stop())
        self.connect('delete-event', self.close)

        self.refresh_audio(initial=True)
        self.connect('focus-in-event', lambda *_: (self.refresh_audio(), False)[1])

    def audio_popup(self, *_):
        if self.audio.get_property('popup-shown'):
            self.refresh_audio()

    def refresh_audio(self, initial=False):
        # Never reconfigure a running capture or replace a user's manual choice.
        if self.session or self.closing:
            return
        previous = self.audio.get_active_id()
        try:
            devices = monitors()
        except Exception:
            self.audio.remove_all()
            self.audio.append('none', 'Sem áudio')
            self.audio.set_active_id('none')
            self.audio_notice.set_text('Não foi possível consultar as saídas. Clique em Atualizar para tentar novamente.')
            return
        names = {item['name'] for item in devices}
        selected = previous if previous in names or previous == 'none' else 'none'
        if initial:
            selected = next((item['name'] for item in devices if item['isDefault']), 'none')
        rows = [('none', 'Sem áudio')] + [(item['name'], item['description']) for item in devices]
        model = self.audio.get_model()
        existing = [(row[1], row[0]) for row in model] if model else []
        if rows != existing:
            self.audio.remove_all()
            for identifier, label in rows:
                self.audio.append(identifier, label)
        self.audio.set_active_id(selected)
        if previous not in (None, 'none') and previous not in names:
            self.audio_notice.set_text('A saída escolhida foi removida. Áudio desativado; escolha outra saída.')
        else:
            self.audio_notice.set_text('O áudio só começa ao iniciar a transmissão.' if devices else 'Nenhum monitor de saída disponível.')

    def status(self, text, done=False):
        def update():
            self.label.set_text(text)
            if done:
                self.last_session = self.session
                self.session = None
                if self.on_session_done and self.last_session:
                    self.on_session_done(self.last_session.diagnostic())
                self.report_button.set_sensitive(self.last_session is not None)
                for w in self.fields + [self.start_button]:
                    w.set_sensitive(True)
                self.stop_button.set_sensitive(False)
                if self.closing:
                    Gtk.main_quit()
        GLib.idle_add(update)

    def save_report(self, *_):
        if not self.last_session:
            return
        path = save_diagnostic(self.last_session.diagnostic())
        self.label.set_text('Diagnóstico salvo em ' + str(path))

    def start(self, *_):
        self.refresh_audio()
        audio = self.audio.get_active_id()
        audio = None if audio == 'none' else audio
        try:
            config = configuration(self.invite.get_text(), self.name.get_text(),
                                   60 if self.profile.get_active() == 1 else 30, audio)
            config['profile'] = ('1080p30', '1080p60', '720p30')[self.profile.get_active()]
            config['codec'] = self.codec.get_active_id()
            config['gainDb'] = int(self.gain.get_active_id())
        except ValueError as e:
            self.label.set_text(str(e)); return
        for w in self.fields + [self.start_button]:
            w.set_sensitive(False)
        self.stop_button.set_sensitive(True)
        self.session = Session(self.status)
        threading.Thread(target=self.session.run,
                         args=(config, 1 if self.kind.get_active() == 0 else 2, audio), daemon=True).start()

    def stop(self):
        self.label.set_text('Encerrando captura e liberando transmissão…')
        if self.session:
            self.session.stop()

    def close(self, *_):
        if self.session:
            self.closing = True
            self.stop()
            self.set_sensitive(False)
        else:
            Gtk.main_quit()
        return True


def save_diagnostic(report, directory=None):
    import uuid
    directory = directory or Path(GLib.get_user_state_dir()) / 'discord2-transmissor' / 'diagnostics'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / ('GTK-REAL-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex + '.json')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    return path


if __name__ == '__main__':
    import sys
    GLib.set_prgname('discord2-transmissor')
    GLib.set_application_name('Discord 2 Transmissor')
    window = Window()
    if '--validation' in sys.argv:
        # Private stdin contains only public invitation/name. Never auto-start capture.
        initial = json.loads(sys.stdin.readline())
        configuration(initial['invite'], 'Teste GTK', 30, None)
        window.audio.set_active_id('none')
        window.invite.set_text(initial['invite'])
        window.name.set_text('Teste GTK')
        window.label.set_text('Teste real: entre como espectador no site e clique em Selecionar e iniciar.')
        window.on_session_done = lambda report: print(json.dumps({'event':'gtk-diagnostic', 'report':report}), flush=True)
    import signal
    for sig in (signal.SIGINT, signal.SIGTERM):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, lambda: (window.close(), False)[1])
    window.show_all()
    Gtk.main()
