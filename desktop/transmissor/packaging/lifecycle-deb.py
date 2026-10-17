#!/usr/bin/python3
"""Install/upgrade/remove in a disposable dpkg root, never the host database.
Dependency checking is bypassed only in this empty root; runtime is tested separately.
"""
import json
from pathlib import Path
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version'].replace('-rc','~rc')
old=root/'dist/discord2-transmissor_1.0.0~rc1_amd64.deb'
new=root/'dist'/f'discord2-transmissor_{version}_amd64.deb'
for artifact in (old,new):assert artifact.is_file(),artifact
with tempfile.TemporaryDirectory(prefix='d2-dpkg-root-') as directory:
    target=Path(directory)
    def dpkg(*args):
        subprocess.run(['fakeroot','dpkg','--log='+str(target/'dpkg.log'),'--root='+directory,'--force-not-root','--force-depends',*map(str,args)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    dpkg('--install',old)
    assert (target/'usr/bin/discord2-transmissor').is_file()
    dpkg('--install',new)
    status=(target/'var/lib/dpkg/status').read_text()
    assert 'Version: '+version in status
    assert (target/'usr/share/applications/discord2-transmissor.desktop').is_file()
    assert (target/'usr/share/icons/hicolor/scalable/apps/discord2-transmissor.svg').is_file()
    assert (target/'usr/lib/discord2-transmissor/publisher.cjs').read_bytes()==(root/'publisher.cjs').read_bytes()
    dpkg('--remove','discord2-transmissor')
    assert not (target/'usr/bin/discord2-transmissor').exists()
    assert not (target/'usr/lib/discord2-transmissor').exists()
    assert not (target/'usr/share/applications/discord2-transmissor.desktop').exists()
    print(json.dumps({'disposableDpkgRoot':True,'installPreviousVersion':True,'upgradeVersion':version,'removedVersion':version,'hostChanged':False,'dependencyResolutionTested':False}))
