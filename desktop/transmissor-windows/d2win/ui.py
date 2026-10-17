"""Compact native Tk UI. All widget access stays on the UI thread."""
import json
import multiprocessing as mp
from pathlib import Path
import time
import tkinter as tk
from tkinter import ttk, messagebox
from .config import configuration, resource
from .native_windows import outputs, targets, require_windows
from .worker import run_worker


class App:
    def __init__(self):
        require_windows()
        self.root = tk.Tk()
        self.root.title('Discord 2 Transmissor')
        self.root.geometry('510x570')
        self.root.minsize(460, 540)
        icon = resource('d2.ico')
        if icon.is_file():
            self.root.iconbitmap(str(icon))
        self.process = self.receiver = self.cancel = None
        self.stop_time = None
        self.closing = False
        self.last_report = None
        self.target_items, self.audio_items = [], []
        box = ttk.Frame(self.root, padding=16); box.pack(fill='both', expand=True)
        self.controls = []
        def entry(label):
            ttk.Label(box, text=label).pack(anchor='w')
            widget = ttk.Entry(box); widget.pack(fill='x', pady=(0, 8)); self.controls.append(widget)
            return widget
        def combo(label, values):
            ttk.Label(box, text=label).pack(anchor='w')
            widget = ttk.Combobox(box, values=values, state='readonly'); widget.pack(fill='x', pady=(0, 8))
            self.controls.append(widget)
            return widget
        self.invite = entry('Convite da sala Discord 2')
        self.name = entry('Seu nome (2 a 24 caracteres)')
        self.kind = combo('Compartilhar', ['Tela', 'Janela']); self.kind.current(0)
        self.target = combo('Tela/janela', [])
        self.quality = combo('Qualidade', ['720p / 30 FPS', '1080p / 30 FPS', '1080p / 60 FPS']); self.quality.current(1)
        self.audio = combo('Áudio da saída', ['Sem áudio']); self.audio.current(0)
        self.refresh_button = ttk.Button(box, text='Atualizar telas e saídas', command=self.refresh)
        self.refresh_button.pack(fill='x'); self.controls.append(self.refresh_button)
        ttk.Label(box, text='Microfones não são oferecidos. Chamadas na mesma saída\npodem ser capturadas. A reprodução local é preservada.', wraplength=460).pack(pady=8, anchor='w')
        buttons = ttk.Frame(box); buttons.pack(fill='x')
        self.start_button = ttk.Button(buttons, text='Iniciar', command=self.start); self.start_button.pack(side='left', expand=True, fill='x')
        self.stop_button = ttk.Button(buttons, text='Parar', command=self.stop, state='disabled'); self.stop_button.pack(side='left', expand=True, fill='x', padx=(8, 0))
        self.status = tk.StringVar(value='Parado')
        ttk.Label(box, textvariable=self.status, wraplength=460).pack(fill='x', pady=10)
        self.kind.bind('<<ComboboxSelected>>', lambda *_: self.refresh())
        self.root.protocol('WM_DELETE_WINDOW', self.close)
        self.refresh(initial=True)
        self.root.after(100, self.poll)

    def refresh(self, initial=False):
        if self.process:
            return
        previous_target = self.target_items[self.target.current()] if 0 <= self.target.current() < len(self.target_items) else None
        previous_audio = self.audio_items[self.audio.current()-1] if self.audio.current() > 0 and self.audio.current() <= len(self.audio_items) else None
        error = None
        try:
            self.target_items = targets('monitor' if self.kind.current() == 0 else 'window')
        except Exception:
            self.target_items = []
            error = 'Não foi possível consultar telas/janelas. Clique em Atualizar.'
        try:
            self.audio_items = outputs()
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
        if error:
            self.status.set(error)

    def enabled(self, enabled):
        for widget in self.controls:
            widget.configure(state=('readonly' if isinstance(widget, ttk.Combobox) else 'normal') if enabled else 'disabled')
        self.start_button.configure(state='normal' if enabled else 'disabled')
        self.stop_button.configure(state='disabled' if enabled else 'normal')

    def start(self):
        if self.process:
            return
        try:
            config = configuration(self.invite.get(), self.name.get(), ('720p30','1080p30','1080p60')[self.quality.current()])
            target = self.target_items[self.target.current()]
            if self.target.current() < 0:
                raise ValueError()
            output = self.audio_items[self.audio.current()-1] if self.audio.current() > 0 else None
        except (ValueError, IndexError) as error:
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


def main():
    try:
        App().root.mainloop()
    except Exception:
        messagebox.showerror('Discord 2 Transmissor', 'Não foi possível abrir o aplicativo. Use Windows 10/11 x64 atualizado e confira a instalação.')
