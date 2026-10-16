#!/usr/bin/python3
"""Local checks only. Never starts capture or reads backend credentials."""
import json
import os
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
import gi
gi.require_version('Gst','1.0')
gi.require_version('Gtk','3.0')
from gi.repository import Gst, Gio, GLib, Gtk
Gst.init(None)
plugins={name:Gst.ElementFactory.find(name) is not None for name in
         ('pipewiresrc','pulsesrc','videoconvert','videoscale','videorate','appsink')}
portal=None
try:
    bus=Gio.bus_get_sync(Gio.BusType.SESSION,None)
    response=bus.call_sync('org.freedesktop.portal.Desktop','/org/freedesktop/portal/desktop',
        'org.freedesktop.DBus.Properties','GetAll',
        GLib.Variant('(s)',('org.freedesktop.portal.ScreenCast',)),
        None,Gio.DBusCallFlags.NONE,2000,None).unpack()[0]
    portal={k:response.get(k) for k in ('version','AvailableSourceTypes')}
except Exception:
    pass
result=dict(plugins=plugins,portal=portal,wayland=bool(os.environ.get('WAYLAND_DISPLAY')),
            sharedMemory=(HERE/'native/shm.node').is_file())
result['ready']=all(plugins.values()) and portal is not None and result['wayland']
if '--check' in sys.argv:
    print(json.dumps(result))
    sys.exit(0 if result['ready'] else 1)
if not result['ready']:
    print('Pré-verificação incompleta: execute em uma sessão COSMIC/Wayland com portal e plugins GStreamer.\n'
          'Plugin ausente: sudo apt install gstreamer1.0-pipewire gstreamer1.0-plugins-base gstreamer1.0-plugins-good\n'
          +json.dumps(result),file=sys.stderr)
    if Gtk.init_check()[0]:
        dialog = Gtk.MessageDialog(message_type=Gtk.MessageType.ERROR, buttons=Gtk.ButtonsType.CLOSE, text='Não foi possível iniciar o Transmissor')
        dialog.format_secondary_text('Entre em uma sessão Wayland com portal de compartilhamento e instale as dependências do pacote. Execute discord2-transmissor --check no terminal para detalhes.')
        dialog.run()
        dialog.destroy()
    sys.exit(1)
os.execv('/usr/bin/python3',['/usr/bin/python3',str(HERE/'app.py'),*sys.argv[1:]])
