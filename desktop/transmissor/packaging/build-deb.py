#!/usr/bin/python3
"""Offline amd64 package builder. Explicit runtime allowlist; no installers/network."""
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
FILES = ('app.py launch.py capture.py audio.py metrics.py frame_ring.py publisher.cjs '
         'media.cjs rtc-native.cjs rtc-stats.cjs gpu-stats.cjs profiles.json native/shm.node').split()

def build():
    if platform.machine() != 'x86_64':
        raise SystemExit('Este pacote contém o SDK nativo Linux amd64.')
    subprocess.run(['/usr/bin/node', str(ROOT/'native/build.cjs')], check=True)
    lock = json.loads((ROOT/'package-lock.json').read_text())
    output = ROOT/'dist'
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='d2-deb-') as temporary:
        stage = Path(temporary)
        runtime = stage/'usr/lib/discord2-transmissor'
        runtime.mkdir(parents=True)
        for name in FILES:
            target = runtime/name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT/name, target)
        for guide in ('INSTALACAO.md', 'ENUMERACAO-AUDIO.md'):
            shutil.copyfile(ROOT/guide, runtime/guide)
        licenses = []
        for name, metadata in lock['packages'].items():
            if not name or metadata.get('dev'):
                continue
            source = ROOT/name
            if not source.exists():
                if metadata.get('optional'):
                    continue
                raise RuntimeError('Dependência ausente: '+name)
            package = json.loads((source/'package.json').read_text())
            if package['version'] != metadata['version']:
                raise RuntimeError('Versão diverge do lock: '+name)
            # Reject symlinks and hidden files; retain upstream licenses and runtime assets.
            for entry in source.rglob('*'):
                relative = entry.relative_to(source)
                if any(part.startswith('.') or part == 'node_modules' for part in relative.parts):
                    continue
                if entry.is_symlink():
                    raise RuntimeError('Link inesperado: '+str(entry))
                if entry.is_file():
                    destination = runtime/name/relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(entry, destination)
            licenses.append({'package': package['name'], 'version': package['version'],
                             'license': package.get('license', metadata.get('license'))})
        def write(name, content, mode=0o644):
            path = stage/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            path.chmod(mode)
        write('usr/bin/discord2-transmissor', '#!/bin/sh\nexport PATH=/usr/bin:/bin\nexec /usr/bin/python3 /usr/lib/discord2-transmissor/launch.py "$@"\n', 0o755)
        for name, destination in [('discord2-transmissor.desktop','usr/share/applications'),
                                   ('discord2-transmissor.svg','usr/share/icons/hicolor/scalable/apps')]:
            write(destination+'/'+name, (ROOT/'packaging'/name).read_text())
        write('usr/share/doc/discord2-transmissor/dependencies.json', json.dumps(licenses, indent=2)+'\n')
        write('DEBIAN/control', f'''Package: discord2-transmissor
Version: {VERSION}
Architecture: amd64
Maintainer: Discord 2 development <noreply@localhost>
Section: net
Priority: optional
Depends: python3, python3-gi, gir1.2-gtk-3.0, gir1.2-gstreamer-1.0, gir1.2-gst-plugins-base-1.0, gstreamer1.0-pipewire, gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, pulseaudio-utils, nodejs (>= 18.19), libc6 (>= 2.38), libstdc++6, libgcc-s1, xdg-desktop-portal
Recommends: mesa-va-drivers, libva2
Description: Transmissor GTK de tela e áudio para Discord 2
 Captura autorizada pelo portal Wayland e publicação pelo SDK LiveKit.
 Requer backend de portal ScreenCast compatível, como o do COSMIC.
''')
        manifest = {}
        for entry in stage.rglob('*'):
            if entry.is_file():
                manifest[str(entry.relative_to(stage))] = hashlib.sha256(entry.read_bytes()).hexdigest()
                if entry.suffix in ('.py', '.cjs', '.json', '.desktop', '.svg') and '/tmp/discord2' in entry.read_text(errors='replace'):
                    raise RuntimeError('Caminho temporário no runtime: '+str(entry))
        artifact = output/f'discord2-transmissor_{VERSION}_amd64.deb'
        # Build outside the payload and publish only a complete archive.
        with tempfile.TemporaryDirectory(prefix='d2-archive-') as archive_dir:
            pending = Path(archive_dir)/'package.deb'
            subprocess.run(['dpkg-deb', '--threads-max=2', '-Zgzip', '--root-owner-group', '--build', str(stage), str(pending)], check=True)
            shutil.copyfile(pending, output/'package.deb.pending')
            (output/'package.deb.pending').replace(artifact)
        (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
        print(artifact)

if __name__ == '__main__':
    build()
