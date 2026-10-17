"""Render the real Qt widgets with fixture devices; never starts capture/network."""
import os
os.environ['QT_QPA_PLATFORM']='offscreen'
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PySide6.QtWidgets import QApplication
from d2win.ui import App
application=QApplication([])
app=App(preview=True)
app.target['values']=['Tela 1: 2560 × 1440']
app.window.resize(720, 1120)
app.window.show();application.processEvents()
path=Path(sys.argv[1]) if len(sys.argv)>1 else Path('ui-preview.png')
app.window.grab().save(str(path))
app.close()
