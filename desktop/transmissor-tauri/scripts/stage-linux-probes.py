#!/usr/bin/env python3
"""Keep real-media test executables for validation on the target Pop!_OS host."""
from pathlib import Path
import os
import shutil
import subprocess

out = Path('artifacts/linux-probes')
out.mkdir(parents=True, exist_ok=True)
for name in ('linux_capture', 'linux_real_session'):
    candidates = [p for p in Path('src-tauri/target/debug/deps').glob(name + '-*') if p.is_file() and os.access(p, os.X_OK)]
    if not candidates:
        raise SystemExit('Missing compiled real-media probe: ' + name)
    source = max(candidates, key=lambda p: p.stat().st_mtime)
    target = out / name
    shutil.copy2(source, target)
    subprocess.run(['strip', '--strip-debug', str(target)], check=True)
(out / 'source-commit.txt').write_text(subprocess.check_output(['git','rev-parse','HEAD'], text=True))
