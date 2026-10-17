"""Windows x64 only; explicit app assets, no private checkout/env/test reports."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.1-beta1'


def build():
    if sys.platform != 'win32' or struct.calcsize('P') != 8:
        raise SystemExit('Compile com Python 3.12 x64 em Windows. Linux/Wine não validam este instalador.')
    if sys.version_info[:2] != (3, 12):
        raise SystemExit('Use Python 3.12 x64 para este conjunto de dependências.')
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT/'native/build.ps1')], check=True)
    from PIL import Image, ImageDraw, ImageFont
    icon = Image.new('RGBA', (256, 256))
    draw = ImageDraw.Draw(icon)
    draw.rounded_rectangle((0, 0, 255, 255), radius=56, fill='#5845c9')
    fontfile = Path('C:/Windows/Fonts/seguisb.ttf')
    font = ImageFont.truetype(str(fontfile), 152) if fontfile.exists() else ImageFont.load_default(size=150)
    draw.text((128, 128), 'D2', fill='white', font=font, anchor='mm')
    iconfile = ROOT/'packaging/d2.ico'
    icon.save(iconfile, sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--windowed',
            '--noupx', '--name', 'Discord2Transmissor', '--icon', str(iconfile),
            '--distpath', str(ROOT/'dist'), '--workpath', str(ROOT/'build'), '--specpath', str(ROOT/'build'),
            '--paths', str(ROOT), '--collect-all', 'livekit.rtc', '--collect-all', 'windows_capture',
            '--collect-all', 'pyaudiowpatch', '--copy-metadata', 'livekit',
            '--add-data', f'{ROOT.parent / "transmissor/profiles.json"};d2-resources',
            '--add-binary', f'{ROOT / "build/native/d2_application_loopback.dll"};d2-resources',
            '--add-data', f'{iconfile};d2-resources', str(ROOT/'launch.py')]
    subprocess.run(args, check=True, cwd=ROOT)
    app = ROOT/'dist/Discord2Transmissor'
    # Third-party notices stay with the installed payload, outside private source tree.
    notices = app/'THIRD-PARTY'; notices.mkdir(exist_ok=True)
    inventory = []
    for dist in importlib.metadata.distributions():
        name = dist.metadata.get('Name', 'unknown')
        inventory.append({'name': name, 'version': dist.version, 'license': dist.metadata.get('License-Expression', dist.metadata.get('License'))})
        for file in dist.files or []:
            if any(part.lower().startswith(('license', 'copying', 'notice')) for part in file.parts):
                source = Path(dist.locate_file(file))
                if source.is_file():
                    target = notices/name/(hashlib.sha256(str(file).encode()).hexdigest()[:10]+'-'+source.name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
    (notices/'inventory.json').write_text(json.dumps(inventory, indent=2)+'\n')
    shutil.copyfile(ROOT/'README.md', app/'README.md')
    shutil.copyfile(ROOT/'TESTE-WINDOWS.md', app/'TESTE-WINDOWS.md')
    binaries = []
    files = {}
    for file in app.rglob('*'):
        if not file.is_file():
            continue
        files[file.relative_to(app).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
        trusted_ca = file.name == 'cacert.pem' and 'certifi' in file.parts
        if file.name.startswith('.env') or file.suffix == '.key' or (file.suffix == '.pem' and not trusted_ca):
            raise RuntimeError('Arquivo privado proibido no payload')
        if file.suffix.lower() in ('.exe', '.dll', '.pyd'):
            data = file.read_bytes()
            if data[:2] == b'MZ':
                offset = struct.unpack_from('<I', data, 0x3c)[0]
                if struct.unpack_from('<H', data, offset+4)[0] != 0x8664:
                    raise RuntimeError('Binário que não é x64 no payload')
                binaries.append(str(file.relative_to(app)))
    (ROOT/'dist/payload-audit.json').write_text(json.dumps({'machine':'AMD64','binaries':binaries,'noEnvironmentFiles':True,'files':files},indent=2)+'\n')
    report = ROOT/'dist/packaged-self-test.json'
    result = subprocess.run([str(app/'Discord2Transmissor.exe'), '--self-test', '--report', str(report)], timeout=60)
    if result.returncode or not report.exists() or not json.loads(report.read_text()).get('nativeSdkLoaded'):
        raise RuntimeError('Runtime empacotado falhou no self-test')
    compiler = shutil.which('ISCC') or 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'
    subprocess.run([compiler, str(ROOT/'packaging/setup.iss')], check=True, cwd=ROOT)
    artifact = ROOT/f'dist/Discord2Transmissor-{VERSION}-windows-x64-setup.exe'
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    (ROOT/'dist/SHA256SUMS').write_text(digest+'  '+artifact.name+'\n')
    print(artifact)


if __name__ == '__main__':
    build()
