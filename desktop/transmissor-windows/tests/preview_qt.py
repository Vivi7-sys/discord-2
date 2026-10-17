"""Render real Qt widgets with fixture devices; no media capture or network."""
import os
import sys
# Windows offscreen has no functional platform font engine in this wheel.
# Use the same Windows plugin as the installed app; grab only our own widget.
os.environ['QT_QPA_PLATFORM'] = 'windows' if sys.platform == 'win32' else 'offscreen'
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont, QFontMetrics
from d2win.ui import App
application=QApplication([])
if sys.platform == 'win32':
    application.setFont(QFont('Segoe UI', 10))
    if not QFontMetrics(application.font()).inFont('ç'):
        raise RuntimeError('Windows Qt font cannot render Portuguese')
app=App(preview=True)
app.target['values']=['Tela 1: 2560 × 1440']
app.window.resize(720, 1120)
app.window.show();application.processEvents()
path=Path(sys.argv[1]) if len(sys.argv)>1 else Path('ui-preview.png')
app.window.grab().save(str(path))
app.close()
