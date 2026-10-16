#!/usr/bin/python3
"""Visible desktop pattern for MANUAL PipeWire capture; no SDK/media injection."""
from datetime import datetime
import time
import os
import gi
gi.require_version('Gtk','3.0');gi.require_version('Gst','1.0')
from gi.repository import Gtk, GLib, Gst
Gst.init(None)


class Reference(Gtk.Window):
    def __init__(self):
        super().__init__(title='Discord 2 — referência visual')
        self.set_default_size(960,540)
        self.started=time.monotonic();self.tone=None;self.drawn_frames=0
        box=Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=8);self.add(box)
        label=Gtk.Label(label='Capture esta janela no portal. Compare texto, cores, movimento e relógio com o site.');box.pack_start(label,False,False,0)
        self.area=Gtk.DrawingArea();box.pack_start(self.area,True,True,0)
        self.area.connect('draw',self.draw)
        button=Gtk.Button(label='Tocar bip na saída local (não testa sincronismo A/V)')
        button.connect('clicked',self.beep);box.pack_start(button,False,False,0)
        self.connect('delete-event',self.close)
        self.timer=GLib.timeout_add(33,lambda:(self.area.queue_draw(),True)[1])

    def draw(self,area,ctx):
        self.drawn_frames+=1
        width,height=area.get_allocated_width(),area.get_allocated_height()
        ctx.set_source_rgb(.08,.08,.08);ctx.paint()
        colors=((1,1,1),(1,1,0),(0,1,1),(0,1,0),(1,0,1),(1,0,0),(0,0,1))
        for i,color in enumerate(colors):
            ctx.set_source_rgb(*color);ctx.rectangle(i*width/7,0,width/7+1,height*.35);ctx.fill()
        ctx.set_source_rgb(1,1,1);ctx.select_font_face('monospace');ctx.set_font_size(34)
        ctx.move_to(18,height*.55);ctx.show_text(datetime.now().strftime('%H:%M:%S.%f')[:-3])
        ctx.set_font_size(14);ctx.move_to(18,height*.65);ctx.show_text('Texto pequeno: ABC abc 0123456789 — confirme nitidez e proporção')
        for x in range(0,width,16):
            ctx.set_source_rgb(1,1,1) if (x//16)%2 else ctx.set_source_rgb(.2,.2,.2)
            ctx.rectangle(x,height*.72,8,24);ctx.fill()
        ctx.set_source_rgb(1,.6,0);ctx.rectangle((time.monotonic()-self.started)*110%max(width-40,1),height*.85,40,25);ctx.fill()
        return False

    def beep(self,*_):
        if self.tone:self.tone.set_state(Gst.State.NULL)
        # Output only, explicit click. No source device or microphone is ever opened.
        self.tone=Gst.parse_launch('audiotestsrc num-buffers=25 samplesperbuffer=960 volume=0.1 freq=880 ! audioconvert ! pulsesink name=output')
        target=os.environ.get('DISCORD2_REFERENCE_SINK')
        if target:self.tone.get_by_name('output').set_property('device',target)
        self.tone.set_state(Gst.State.PLAYING)
        GLib.timeout_add(1000,self.stop_tone)

    def stop_tone(self):
        if self.tone:self.tone.set_state(Gst.State.NULL);self.tone=None
        return False

    def close(self,*_):
        GLib.source_remove(self.timer);self.stop_tone();Gtk.main_quit();return False


if __name__=='__main__':
    import signal
    window=Reference()
    for sig in (signal.SIGINT,signal.SIGTERM):
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT,sig,lambda:(window.close(),False)[1])
    window.show_all();Gtk.main()
