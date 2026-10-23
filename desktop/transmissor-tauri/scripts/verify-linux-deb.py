#!/usr/bin/env python3
"""Inspect the real Debian payload; does not claim a root installation or media validation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('deb', type=Path)
parser.add_argument('--headless', action='store_true', help='CI only: portal/media validation remains false')
parser.add_argument('--report', type=Path, default=Path('evidence/linux-package-check.json'))
args = parser.parse_args()

def command(*argv):
    return subprocess.check_output(argv, text=True, stderr=subprocess.STDOUT)

control = command('dpkg-deb', '--field', str(args.deb))
fields = dict(line.split(': ', 1) for line in control.splitlines() if ': ' in line and not line.startswith(' '))
assert fields['Architecture'] == 'amd64', fields
assert fields['Package'] != 'discord2-transmissor', 'Must coexist with GTK Linux 1.0.0'
for dep in ('libwebkit2gtk-4.1-0', 'gstreamer1.0-pipewire', 'gstreamer1.0-plugins-good', 'pulseaudio-utils', 'xdg-desktop-portal'):
    assert dep in fields['Depends'], dep
with tempfile.TemporaryDirectory(prefix='d2-tauri-deb-') as tmp:
    root = Path(tmp)
    subprocess.run(['dpkg-deb', '-x', str(args.deb), tmp], check=True)
    executable = root / 'usr/bin/Discord2Transmissor'
    assert executable.is_file() and os.access(executable, os.X_OK)
    assert 'x86-64' in command('file', str(executable))
    libraries = command('ldd', str(executable))
    assert 'not found' not in libraries, libraries
    desktops = list((root / 'usr/share/applications').glob('*.desktop'))
    assert len(desktops) == 1
    assert 'Exec=Discord2Transmissor' in desktops[0].read_text()
    assert list((root / 'usr/share/icons').rglob('*.png'))
    runtime_check = subprocess.run([str(executable), '--check'], text=True, capture_output=True, timeout=30)
    check = json.loads(runtime_check.stdout)
    assert check['ready'] or (args.headless and all(check['plugins'].values())), check
    files = [str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()]
    assert not any(p.endswith(('.py','.exe','.dll')) for p in files)
    collisions = []
    upgrade_files = []
    for path in files:
        owned = subprocess.run(['dpkg-query','-S','/'+path], capture_output=True, text=True)
        if owned.returncode == 0:
            owners = [line.split(': ', 1)[0] for line in owned.stdout.splitlines()]
            # Replacing files belonging to this same package is an ordinary
            # upgrade. Any other owner (including GTK) remains a hard failure.
            if owners and all(owner.split(':', 1)[0] == fields['Package'] for owner in owners):
                upgrade_files.append(path)
            else:
                collisions.append({'path':path,'owner':owned.stdout.strip()})
    assert not collisions, collisions
report = dict(package=fields['Package'], version=fields['Version'], architecture=fields['Architecture'], sha256=hashlib.sha256(args.deb.read_bytes()).hexdigest(), payloadVerified=True, dependenciesResolvedByLdd=True, packagedPreflight=check, overwritesInstalledFiles=bool(upgrade_files), updatesFilesFromSamePackage=upgrade_files, overwritesFilesFromOtherPackages=False, actualRootInstallationTested=False, portalCaptureTested=False, livekitTested=False)
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
