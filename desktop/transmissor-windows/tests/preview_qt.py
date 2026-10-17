"""Render the real Qt widgets with fixture devices; never starts capture/network."""
import os
os.environ['QT_QPA_PLATFORM']='offscreen'
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFontDatabase, QFont, QFontMetrics
from d2win.ui import App
application=QApplication([])
if sys.platform == 'win32':
    # The offscreen plugin does not populate the Windows system font database.
    # Register the documented OS fonts explicitly for reproducible CI evidence.
    for filename in ('segoeui.ttf', 'seguisb.ttf'):
        font = Path(os.environ.get('WINDIR', 'C:/Windows'))/'Fonts'/filename
        if not font.is_file() or QFontDatabase.addApplicationFont(str(font)) < 0:
            raise RuntimeError('Segoe UI unavailable for Windows offscreen preview')
    application.setFont(QFont('Segoe UI', 10))
    if not QFontMetrics(application.font()).inFont('ç'):
        raise RuntimeError('Preview font cannot render Portuguese')
app=App(preview=True)
app.target['values']=['Tela 1: 2560 × 1440']
app.window.resize(720, 1120)
app.window.show();application.processEvents()
path=Path(sys.argv[1]) if len(sys.argv)>1 else Path('ui-preview.png')
app.window.grab().save(str(path))
app.close()
