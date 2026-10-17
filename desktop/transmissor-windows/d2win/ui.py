"""Qt desktop shell. Device discovery and media never run on the widget thread."""
from concurrent.futures import ThreadPoolExecutor
import json
from .controller import Controller
from .native_windows import require_windows, targets, outputs
from .config import resource
from PySide6 import QtCore, QtGui, QtWidgets as W

STYLE = '''
QWidget { background: #15151e; color: #ededf5; font-family: 'Segoe UI'; font-size: 14px; }
QLabel#brand { font-size: 25px; font-weight: 700; }
QLabel#badge { background: #5845c9; border-radius: 12px; font-size: 24px; font-weight: 800; padding: 14px; }
QLabel#muted { color: #aaa9bf; font-size: 12px; }
QGroupBox { border: 1px solid #363545; border-radius: 12px; margin-top: 14px; padding: 22px 16px 14px; font-weight: 600; }
QGroupBox::title { subcontrol-origin: margin; left: 18px; padding: 0 6px; }
QLineEdit, QComboBox { background: #232330; border: 1px solid #454457; border-radius: 7px; padding: 9px 12px; min-height: 20px; }
QLineEdit:focus, QComboBox:focus { border: 1px solid #a99aff; }
QComboBox QAbstractItemView { background: #232330; selection-background-color: #5845c9; padding: 5px; }
QPushButton { background: #30303f; border: 1px solid #454457; border-radius: 8px; padding: 11px 16px; font-weight: 600; }
QPushButton:hover { background: #414155; }
QPushButton#primary { background: #7060e8; border-color: #8a7bf5; color: white; }
QPushButton#primary:hover { background: #8271f2; }
QPushButton:disabled, QComboBox:disabled, QLineEdit:disabled { color: #77758c; background: #1d1d28; border-color: #30303f; }
QLabel#status { background: #232330; border-radius: 8px; padding: 14px; }
'''


class Field:
    def __init__(self, widget): self.widget = widget
    def get(self): return self.widget.text()
    def configure(self, state): self.widget.setEnabled(state != 'disabled')


class Combo(Field):
    def current(self, index=None):
        if index is not None: self.widget.setCurrentIndex(index)
        return self.widget.currentIndex()
    def __setitem__(self, key, values):
        if key != 'values': raise KeyError(key)
        blocker = QtCore.QSignalBlocker(self.widget)
        self.widget.clear(); self.widget.addItems(values)
        del blocker
    def set(self, value): self.widget.setCurrentIndex(-1)


class Label:
    def __init__(self, widget): self.widget = widget
    def set(self, text): self.widget.setText(text)


class Root:
    def __init__(self, window): self.window = window
    def after(self, delay, callback): QtCore.QTimer.singleShot(delay, self.window, callback)
    def destroy(self):
        self.window.finished = True
        self.window.close()


class Window(W.QWidget):
    def closeEvent(self, event):
        if self.finished:
            event.accept()
        else:
            event.ignore()
            self.controller.close()


class App(Controller):
    def __init__(self, preview=False):
        if not preview: require_windows()
        self.window = Window(); self.window.finished = False; self.window.controller = self
        self.root = Root(self.window)
        self.window.setWindowTitle('Discord 2 • Transmissor')
        self.window.resize(680, 980); self.window.setMinimumSize(560, 700)
        icon = resource('d2.ico')
        if icon.is_file(): self.window.setWindowIcon(QtGui.QIcon(str(icon)))
        self.window.setStyleSheet(STYLE)
        self.process = self.receiver = self.cancel = None
        self.stop_time = None; self.closing = False; self.last_report = None
        self.target_items, self.audio_items, self.controls = [], [], []
        self.discovery = None; self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='d2-devices')
        outer = W.QVBoxLayout(self.window); outer.setContentsMargins(0, 0, 0, 0)
        scroll = W.QScrollArea(); scroll.setWidgetResizable(True); scroll.setFrameShape(W.QFrame.Shape.NoFrame)
        content = W.QWidget(); content.setMinimumHeight(1020)
        scroll.setWidget(content); outer.addWidget(scroll)
        layout = W.QVBoxLayout(content); layout.setContentsMargins(24, 24, 24, 24); layout.setSpacing(14)
        header = W.QHBoxLayout()
        badge = W.QLabel('D2'); badge.setObjectName('badge'); header.addWidget(badge)
        titles = W.QVBoxLayout(); title = W.QLabel('Compartilhe seu momento'); title.setObjectName('brand')
        subtitle = W.QLabel('TRANSMISSOR WINDOWS  •  0.1.2-beta1'); subtitle.setObjectName('muted')
        titles.addWidget(title); titles.addWidget(subtitle); header.addLayout(titles); header.addStretch(); layout.addLayout(header)
        def group(title):
            box = W.QGroupBox(title); form = W.QFormLayout(box); form.setSpacing(12)
            form.setFieldGrowthPolicy(W.QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)
            layout.addWidget(box); return form
        def entry(form, title, placeholder):
            widget = W.QLineEdit(); widget.setPlaceholderText(placeholder); form.addRow(title, widget)
            value = Field(widget); self.controls.append(value); return value
        def combo(form, title, values, index=0):
            widget = W.QComboBox(); widget.addItems(values); widget.setCurrentIndex(index)
            widget.setSizeAdjustPolicy(W.QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
            widget.setMinimumContentsLength(16)
            form.addRow(title, widget); value = Combo(widget); self.controls.append(value); return value
        form = group('01   CONEXÃO')
        self.invite = entry(form, 'Convite da sala', 'Cole o link do convite Discord 2')
        self.name = entry(form, 'Seu nome', 'Como você quer aparecer?')
        form = group('02   VÍDEO')
        self.kind = combo(form, 'Compartilhar', ['Tela', 'Janela'])
        self.target = combo(form, 'Origem', [])
        self.quality = combo(form, 'Qualidade', ['720p / 30 FPS', '1080p / 30 FPS', '1080p / 60 FPS'], 1)
        self.encoder = combo(form, 'Codificação', ['Automática • GPU quando disponível', 'LiveKit • compatibilidade'])
        form = group('03   ÁUDIO')
        self.audio_mode = combo(form, 'Capturar', ['Aplicativo selecionado', 'Sistema inteiro', 'Sem áudio'], 2)
        self.audio = combo(form, 'Saída do sistema', ['Sem áudio'])
        note = W.QLabel('Aplicativo: áudio do processo e seus filhos. Sistema: toda a saída.\nReprodução local preservada. Microfone nunca é capturado.')
        note.setObjectName('muted'); note.setWordWrap(True); form.addRow(note)
        refresh = W.QPushButton('Atualizar telas, janelas e saídas'); refresh.clicked.connect(lambda: self.refresh())
        self.refresh_button = Field(refresh); self.controls.append(self.refresh_button); layout.addWidget(refresh)
        actions = W.QHBoxLayout()
        start = W.QPushButton('Iniciar transmissão'); start.setObjectName('primary'); start.clicked.connect(self.start)
        stop = W.QPushButton('Parar'); stop.clicked.connect(self.stop); stop.setEnabled(False)
        self.start_button = Field(start); self.stop_button = Field(stop)
        actions.addWidget(start, 3); actions.addWidget(stop, 1); layout.addLayout(actions)
        status = W.QLabel('Pronto para compartilhar'); status.setObjectName('status'); status.setWordWrap(True)
        self.status = Label(status); layout.addWidget(status)
        self.metrics_label = W.QLabel('FPS reais aparecem durante a transmissão. Recepção: medir no espectador.')
        self.metrics_label.setObjectName('muted'); self.metrics_label.setWordWrap(True); layout.addWidget(self.metrics_label)
        save = W.QPushButton('Salvar diagnóstico'); save.clicked.connect(self.save_report); layout.addWidget(save)
        layout.addStretch()
        self.kind.widget.currentIndexChanged.connect(self.kind_changed)
        self.audio_mode.widget.currentIndexChanged.connect(lambda: self.audio_mode_changed())
        self.preview = preview
        if not preview: self.refresh(initial=True)
        self.root.after(100, self.poll)

    def refresh(self, initial=False):
        if self.process or self.discovery is not None: return
        kind = self.kind.current()
        self.start_button.configure(state='disabled')
        self.status.set('Consultando dispositivos…')
        def discover():
            error = None
            try: video = targets('monitor' if kind == 0 else 'window')
            except Exception:
                video = []; error = 'Não foi possível consultar telas/janelas. Atualize novamente.'
            try: audio = outputs()
            except Exception:
                audio = []; error = 'Saídas indisponíveis. Use sem áudio ou atualize novamente.'
            return video, audio, error
        self.discovery = self.executor.submit(discover)
        def finish():
            if not self.discovery.done():
                self.root.after(100, finish); return
            snapshot = self.discovery.result(); self.discovery = None
            if self.closing: return
            if kind != self.kind.current():
                self.refresh(initial=initial); return
            self.status.set('Pronto para compartilhar')
            Controller.refresh(self, initial=initial, snapshot=snapshot)
            self.start_button.configure(state='normal')
        self.root.after(100, finish)

    def show_metrics(self, sample):
        def value(key):
            v = sample.get(key)
            return '—' if v is None else f'{v:.1f}'
        self.metrics_label.setText(f"FPS capturados {value('capturedFps')}  •  enviados ao SDK {value('submittedFps')}  •  codificados {value('encodedFps')}  •  RTP {value('sentFps')}\n"
                                  f"Codificação {value('hardwareEncodeMs') if sample.get('hardwareEncodeMs') is not None else value('encodeMs')} ms  •  fila captura→SDK {value('captureToSubmitMs')} ms  •  CPU processo {value('cpuProcessPercent')}%")

    def save_report(self):
        if self.last_report is None:
            self.status.set('Pare a transmissão para salvar o diagnóstico completo.'); return
        path, _ = W.QFileDialog.getSaveFileName(self.window, 'Salvar diagnóstico', 'd2-windows-diagnostico.json', 'JSON (*.json)')
        if path:
            try:
                with open(path, 'w', encoding='utf-8') as file: json.dump(self.last_report, file, indent=2)
                self.status.set('Diagnóstico salvo.')
            except OSError: self.status.set('Não foi possível salvar nesse local.')

    def close(self):
        self.closing = True
        self.executor.shutdown(wait=False, cancel_futures=True)
        super().close()


def main():
    application = W.QApplication.instance() or W.QApplication([])
    try:
        app = App(); app.window.show()
        application.exec()
    except Exception:
        W.QMessageBox.critical(None, 'Discord 2 Transmissor',
                              'Não foi possível abrir o aplicativo. Confira a instalação e use Windows 10/11 x64 atualizado.')
