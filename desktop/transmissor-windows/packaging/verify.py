"""Verify exact installer digest and installed payload without launching capture."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


def verify(dist, installed=None):
    name = 'Discord2Transmissor-0.1.0-windows-x64-setup.exe'
    digest, filename = (dist / 'SHA256SUMS').read_text().strip().split()
    if filename != name or hashlib.sha256((dist / name).read_bytes()).hexdigest() != digest:
        raise ValueError('Installer SHA-256 mismatch')
    audit = json.loads((dist / 'payload-audit.json').read_text())
    if audit['machine'] != 'AMD64' or not audit['files']:
        raise ValueError('Missing AMD64 payload manifest')
    if installed:
        for relative, expected in audit['files'].items():
            path = PurePosixPath(relative)
            if path.is_absolute() or '..' in path.parts or '\\' in relative or ':' in relative:
                raise ValueError('Unsafe payload path')
            if hashlib.sha256(installed.joinpath(*path.parts).read_bytes()).hexdigest() != expected:
                raise ValueError('Installed file differs from build payload')
        extra = {p.relative_to(installed).as_posix() for p in installed.rglob('*') if p.is_file()} - set(audit['files'])
        if extra - {'unins000.exe', 'unins000.dat', 'unins000.msg'}:
            raise ValueError('Unexpected installed files')
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', type=Path, required=True)
    parser.add_argument('--installed', type=Path)
    args = parser.parse_args()
    verify(args.dist, args.installed)
    print('SHA-256 and requested payload checks passed (no desktop capture).')
