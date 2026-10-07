#!/usr/bin/env python3
"""Linux local immutable frontend publisher. No nginx reload/container operation.

Run after initial route installation. Every publication is fully extracted, hashed,
fsynced, renamed, and read through HTTP before its pointer can become active.
"""
import argparse, fcntl, hashlib, json, os, pathlib, re, shutil, signal, stat, sys, tempfile, urllib.request, zipfile
PREFIX='/games/syezzhaem/'
BUILD=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')
FIELDS=('manifest_version','build_id','entry_url','api_version','content_version','rules_version','snapshot_schema_version','level_id')
MAX_BYTES=128*1024*1024
def safe(name):
    if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9._/-]+',name) or name.startswith('/') or any(p in ('','..','.') for p in name.split('/')):raise ValueError('Unsafe release path')
    return name
def syncdir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def synced_write(path,data):
    with open(path,'xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
def atomic_json(path,value):
    data=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    temp=path.with_name('.'+path.name+'.'+next(tempfile._get_candidate_names()))
    try:
        synced_write(temp,data);os.replace(temp,path);syncdir(path.parent)
    finally:
        if temp.exists():temp.unlink()
def descriptor(m,raw):
    if set(m)!=set(FIELDS)|{'files'} or m['manifest_version']!=1 or m['snapshot_schema_version']!=1 or not BUILD.fullmatch(str(m['build_id'])):raise ValueError('Invalid release manifest')
    if m['entry_url']!=PREFIX+'releases/'+m['build_id']+'/' or m['api_version']!='v1' or (m['content_version'],m['rules_version'],m['level_id']) not in [('r1-map-1','r1-rules-1','house-bridge-portal'),('r1-map-2','r1-rules-2','house-bridge-portal-intro'),('r2-map-1','r2-rules-1','house-full-route')]:raise ValueError('Unsupported release contract')
    if not isinstance(m['files'],dict) or not 1<=len(m['files'])<=5000 or 'index.html' not in m['files']:raise ValueError('Missing release entry')
    for n,v in m['files'].items():
        safe(n)
        if n=='release-manifest.json' or not isinstance(v,dict) or set(v)!={'sha256','bytes'} or not re.fullmatch('[0-9a-f]{64}',str(v['sha256'])) or type(v['bytes']) is not int or not 0<=v['bytes']<=MAX_BYTES:raise ValueError('Invalid file hash')
    return {**{k:m[k] for k in FIELDS},'manifest_sha256':hashlib.sha256(raw).hexdigest()}
def verify(directory):
    manifest=directory/'release-manifest.json'
    if manifest.is_symlink() or manifest.stat().st_size>2*1024*1024:raise ValueError('Unsafe manifest')
    raw=manifest.read_bytes();m=json.loads(raw);d=descriptor(m,raw)
    actual=set()
    for p in directory.rglob('*'):
        if p.is_symlink() or not(p.is_dir() or p.is_file()):raise ValueError('Unsafe file kind')
        if p.is_file():actual.add(p.relative_to(directory).as_posix())
    if actual!=set(m['files'])|{'release-manifest.json'}:raise ValueError('Release file set mismatch')
    for name,v in m['files'].items():
        data=(directory/name).read_bytes()
        if len(data)!=v['bytes'] or hashlib.sha256(data).hexdigest()!=v['sha256']:raise ValueError('Release digest mismatch: '+name)
    return d,m
def extract(archive,directory):
    with zipfile.ZipFile(archive) as z:
        entries=z.infolist()
        if not entries or len(entries)>5001 or sum(x.file_size for x in entries)>MAX_BYTES:raise ValueError('Oversized archive')
        names=set()
        for e in entries:
            name=safe(e.filename.rstrip('/') if e.is_dir() else e.filename)
            kind=stat.S_IFMT(e.external_attr>>16)
            if kind not in ((0,stat.S_IFDIR) if e.is_dir() else (0,stat.S_IFREG)) or e.flag_bits&1 or name in names:raise ValueError('Unsafe archive entry')
            names.add(name)
        for e in entries:
            if e.is_dir():continue
            p=directory/e.filename;p.parent.mkdir(parents=True,exist_ok=True)
            with z.open(e) as source,open(p,'xb') as target:
                shutil.copyfileobj(source,target);target.flush();os.fsync(target.fileno())
    for p in sorted((x for x in directory.rglob('*') if x.is_dir()),key=lambda p:len(p.parts),reverse=True):syncdir(p)
    syncdir(directory)
def fault(point):
    if os.environ.get('SYEZZHAEM_PUBLISH_FAULT')==point:os.kill(os.getpid(),signal.SIGKILL)
def http_verify(origin,d,m):
    for name,v in {**m['files'],'release-manifest.json':{'bytes':None,'sha256':d['manifest_sha256']}}.items():
        request=urllib.request.Request(origin.rstrip('/')+d['entry_url']+name,headers={'Cache-Control':'no-cache'})
        with urllib.request.urlopen(request,timeout=15) as response:
            data=response.read(MAX_BYTES+1)
            if response.status!=200 or (v['bytes'] is not None and len(data)!=v['bytes']) or hashlib.sha256(data).hexdigest()!=v['sha256']:raise ValueError('Published HTTP digest mismatch: '+name)
def current(root):
    p=root/'active.json'
    if not p.exists():return None
    d=json.loads(p.read_text())
    if not isinstance(d,dict) or not BUILD.fullmatch(str(d.get('build_id',''))):raise ValueError('Unsafe active build ID')
    known,_=verify(root/'releases'/d['build_id'])
    if d!=known:raise ValueError('Active pointer failed recovery validation')
    return d
def known_catalog(root,active):
    path=root/'catalog.json'
    if not path.exists():
        if active:raise ValueError('Active build has no retained-build catalog')
        return {'manifest_version':1,'builds':{}}
    catalog=json.loads(path.read_text())
    if set(catalog)!={'manifest_version','builds'} or catalog['manifest_version']!=1 or not isinstance(catalog['builds'],dict):raise ValueError('Invalid existing catalog')
    for build,d in catalog['builds'].items():
        if not BUILD.fullmatch(build):raise ValueError('Unsafe catalog build ID')
        verified,_=verify(root/'releases'/build)
        if verified!=d:raise ValueError('Catalog build failed recovery validation')
    if active and catalog['builds'].get(active['build_id'])!=active:raise ValueError('Active build is absent from retained-build catalog')
    return catalog
def publish(args):
    root=pathlib.Path(args.root).resolve();root.mkdir(parents=True,exist_ok=True)
    with open(root/'.publish.lock','a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        old=current(root)
        catalog=known_catalog(root,old)
        if (old['build_id'] if old else 'none')!=args.expected_previous:raise ValueError('Expected previous build changed')
        releases=root/'releases';releases.mkdir(exist_ok=True);syncdir(root)
        stages=root/'.staging';stages.mkdir(exist_ok=True);syncdir(root)
        stage=pathlib.Path(tempfile.mkdtemp(prefix='build-',dir=stages))
        try:
            extract(args.archive,stage);d,m=verify(stage);fault('after-staging')
            final=releases/d['build_id']
            if final.exists():
                previous,_=verify(final)
                if previous!=d:raise ValueError('Build ID is already published with different bytes')
                shutil.rmtree(stage)
            else:
                os.rename(stage,final);syncdir(releases);syncdir(stages)
            fault('after-release')
            http_verify(args.verify_origin,d,m)
            catalog_path=root/'catalog.json'
            if d['build_id'] in catalog['builds'] and catalog['builds'][d['build_id']]!=d:raise ValueError('Catalog collision')
            catalog['builds'][d['build_id']]=d;atomic_json(catalog_path,catalog)
            fault('before-pointer')
            atomic_json(root/'active.json',d);fault('after-pointer')
            if current(root)!=d:raise ValueError('Active readback mismatch')
            print(json.dumps({'operation_status':'VERIFIED','build_id':d['build_id'],'previous_build_id':old['build_id'] if old else None,'manifest_sha256':d['manifest_sha256'],'retention':'all-builds-no-cleanup'}))
        finally:
            if stage.exists():shutil.rmtree(stage)
def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    pub=sub.add_parser('publish');pub.add_argument('--root',required=True);pub.add_argument('--archive',required=True);pub.add_argument('--expected-previous',required=True);pub.add_argument('--verify-origin',required=True)
    rec=sub.add_parser('recover');rec.add_argument('--root',required=True)
    clean=sub.add_parser('cleanup');clean.add_argument('--root',required=True)
    a=p.parse_args()
    if a.command=='publish':publish(a)
    elif a.command=='recover':
        root=pathlib.Path(a.root).resolve();d=current(root)
        if not d:raise ValueError('No fully verified active build')
        known_catalog(root,d)
        print(json.dumps({'operation_status':'VERIFIED','build_id':d['build_id'],'manifest_sha256':d['manifest_sha256']}))
    else:raise ValueError('Cleanup disabled: no agreed local-copy/deduplication retention policy')
if __name__=='__main__':
    try:main()
    except (ValueError,OSError,zipfile.BadZipFile,KeyError,TypeError,json.JSONDecodeError) as e:
        print(json.dumps({'operation_status':'FAIL','error':str(e)}),file=sys.stderr);sys.exit(1)
