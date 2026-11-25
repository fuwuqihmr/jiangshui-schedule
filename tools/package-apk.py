import sys,zipfile
from pathlib import Path
project,build=map(Path,sys.argv[1:])
with zipfile.ZipFile(build/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as z:
    for p in (project/'web').rglob('*'):
        if p.is_file(): z.write(p,'assets/'+p.relative_to(project/'web').as_posix())
    for p in (build/'dex').glob('*.dex'): z.write(p,p.name)
