"""Toolkit independent session controls. Widget adapters belong to ui.py."""
import multiprocessing as mp
import time
from .config import configuration, SafeError
from .audio_choice import selection
from .native_windows import outputs, targets
from .worker import run_worker


class Controller:
    def kind_changed(self):
        # A switch to a window offers application audio; never silently global.
        self.audio_mode.current(0 if self.kind.current() == 1 else 2)
        self.refresh()
        self.audio_mode_changed()

    def audio_mode_changed(self, announce=True):
        self.audio.configure(state='readonly' if self.audio_mode.current() == 1 else 'disabled')
        if announce and self.audio_mode.current() == 0:
            from .application_audio import supported, UNSUPPORTED
            self.status.set('Áudio somente da árvore do processo selecionado; processos compartilhados podem incluir outras janelas.' if supported() else UNSUPPORTED)

    def refresh(self, initial=False, snapshot=None):
        if self.process:
            return
        previous_target = self.target_items[self.target.current()] if 0 <= self.target.current() < len(self.target_items) else None
        previous_audio = self.audio_items[self.audio.current()-1] if self.audio.current() > 0 and self.audio.current() <= len(self.audio_items) else None
        error = None
        try:
            self.target_items = snapshot[0] if snapshot is not None else targets('monitor' if self.kind.current() == 0 else 'window')
        except Exception:
            self.target_items = []
            error = 'Não foi possível consultar telas/janelas. Clique em Atualizar.'
        try:
            self.audio_items = snapshot[1] if snapshot is not None else outputs()
        except Exception:
            self.audio_items = []
            error = 'Saídas de áudio indisponíveis. Você pode transmitir sem áudio ou clicar em Atualizar.'
        self.target['values'] = [item.name for item in self.target_items]
        if self.target_items:
            self.target.current(self.target_items.index(previous_target) if previous_target in self.target_items else 0)
        else:
            self.target.set('')
        self.audio['values'] = ['Sem áudio'] + [f'{d.name} [{d.index}]' + (' (padrão)' if d.default else '') for d in self.audio_items]
        selected = next((i+1 for i, d in enumerate(self.audio_items) if previous_audio is not None and d.key == previous_audio.key), 0)
        if initial:
            selected = next((i+1 for i, d in enumerate(self.audio_items) if d.default), 0)
        self.audio.current(selected)
        self.audio_mode_changed(announce=False)
        if snapshot is not None and snapshot[2]:
            error = snapshot[2]
        if error:
            self.status.set(error)

    def enabled(self, enabled):
        for widget in self.controls:
            widget.configure(state=('readonly' if hasattr(widget, 'current') else 'normal') if enabled else 'disabled')
        self.start_button.configure(state='normal' if enabled else 'disabled')
        self.stop_button.configure(state='disabled' if enabled else 'normal')
        if enabled:
            self.audio_mode_changed(announce=False)

    def start(self):
        if self.process:
            return
        try:
            config = configuration(self.invite.get(), self.name.get(), ('720p30','1080p30','1080p60')[self.quality.current()],
                                   ('auto','sdk')[self.encoder.current()])
            target = self.target_items[self.target.current()]
            if self.target.current() < 0:
                raise ValueError()
            selected_output = self.audio_items[self.audio.current()-1] if self.audio.current() > 0 else None
            output = selection(self.audio_mode.current(), target, selected_output)
        except (ValueError, IndexError, SafeError) as error:
            self.status.set(str(error) or 'Selecione uma tela ou janela válida.'); return
        context = mp.get_context('spawn')
        self.receiver, sender = context.Pipe(duplex=False)
        self.cancel = context.Event()
        self.process = context.Process(target=run_worker, args=(config, target, output, self.cancel, sender))
        self.process.daemon = False
        try:
            self.process.start()
        except Exception:
            self.receiver.close(); sender.close(); self.process = None
            self.status.set('Não foi possível iniciar o processo de transmissão.'); return
        sender.close()
        self.enabled(False)
        self.last_report = None
        self.stop_time = None
        self.status.set('Conectando…')

    def stop(self):
        if self.process and self.stop_time is None:
            self.cancel.set()
            self.stop_time = time.monotonic()
            self.stop_button.configure(state='disabled')
            self.status.set('Encerrando captura e liberando transmissão…')

    def poll(self):
        if self.process:
            try:
                while self.receiver.poll():
                    event = self.receiver.recv()
                    if event['state'] in ('status', 'fatal'):
                        self.status.set(event['message'])
                    elif event['state'] == 'metrics':
                        self.show_metrics(event['sample'])
                    elif event['state'] == 'done':
                        self.last_report = event['report']
            except (EOFError, OSError):
                pass
            if self.stop_time is not None and time.monotonic()-self.stop_time > 30 and self.process.is_alive():
                self.process.terminate()
                self.status.set('Encerramento forçado. O servidor verificará a vaga na próxima tentativa.')
            if not self.process.is_alive():
                self.process.join(timeout=1)
                if self.last_report is None or self.process.exitcode != 0:
                    self.status.set('O transmissor foi encerrado inesperadamente. A vaga será verificada na próxima tentativa.')
                self.process.close(); self.process = None
                self.receiver.close(); self.receiver = None
                if self.closing:
                    self.root.destroy(); return
                self.enabled(True)
        self.root.after(100, self.poll)

    def close(self):
        if self.process:
            self.closing = True
            self.stop()
            self.enabled(False)
            self.stop_button.configure(state='disabled')
        else:
            self.root.destroy()
