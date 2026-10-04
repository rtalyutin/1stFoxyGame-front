#!/usr/bin/env python3
"""Package one complete frontend build; does not publish or include account data."""
import argparse, hashlib, json, pathlib, zipfile
from publish import verify
p=argparse.ArgumentParser();p.add_argument('--dist',default='dist');p.add_argument('--output',required=True);a=p.parse_args()
d=pathlib.Path(a.dist);descriptor,m=verify(d)
expected=set(m['files'])|{'release-manifest.json'}
actual={x.relative_to(d).as_posix() for x in d.rglob('*') if x.is_file()}
if actual!=expected or any(x.is_symlink() for x in d.rglob('*')):raise SystemExit('Release file set differs from manifest')
with zipfile.ZipFile(a.output,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for name in sorted(expected):z.write(d/name,name)
archive=pathlib.Path(a.output)
print(json.dumps({'build_id':m['build_id'],'archive':a.output,'files':len(expected),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'manifest_sha256':descriptor['manifest_sha256']}))
