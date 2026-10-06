"""Blender5.2 native cabinet export. Run with --background --python-exit-code1."""
import json,struct,hashlib
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parents[1]
TARGETS={'runner-forge':151600,'last-throne':125600,'syezzhaem':136000}
BASELINES={'runner-forge':'fedb64a23be49a9e281bf1a5454dffb4863fba656ca1da4d0edc119f1bc517b6','last-throne':'6d9bb6dbddf87ecb50eb3cb7dde41b7bd00b2f59ed432bdb1998086863b2e079','syezzhaem':'a5edc324a81eefe1b6bc4607f893c538842b14daa58845f0f8991aba5f85585a'}
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/FoxyGames-Cabinets-100x.blend'))
for name,target in TARGETS.items():
 objects=list(bpy.data.collections[name].objects)
 original={obj['source_node_index']:json.loads(obj['source_local_transform']) for obj in objects}
 bpy.ops.object.select_all(action='DESELECT')
 for obj in objects:
  obj.select_set(True)
  if 'review_offset_x' in obj:obj.location.x-=obj['review_offset_x']
 bpy.context.view_layer.objects.active=objects[0]
 path=ROOT/'public/models'/f'{name}.glb'
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_skins=False,export_cameras=False,export_lights=False,export_extras=True)
 raw=path.read_bytes();size=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+size]);binary=raw[28+size:];mapping={}
 for i,node in enumerate(g['nodes']):
  source=node['extras']['source_node_index'];assert source not in mapping;mapping[source]=i
  node['name']=original[source]['name'];node.pop('extras',None)
 assert set(mapping)==set(original)
 triangles=0
 for source,i in mapping.items():
  old=original[source];new=g['nodes'][i]
  assert set(new.get('children',[]))=={mapping[c] for c in old.get('children',[])}
  for key,default in [('translation',[0,0,0]),('scale',[1,1,1]),('rotation',[0,0,0,1])]:
   assert max(abs(a-b) for a,b in zip(old.get(key,default),new.get(key,default)))<2e-5
  if 'mesh' in new:
   for p in g['meshes'][new['mesh']]['primitives']:
    assert p.get('mode',4)==4;triangles+=g['accessors'][p['indices']]['count']//3
 assert triangles==target
 g['asset']['extras']={'geometryRevision':'cabinet-100x-v1','triangleMultiplier':100,'baselineSha256':BASELINES[name]}
 encoded=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*(-len(encoded)%4);binary+=b'\0'*(-len(binary)%4)
 body=struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
 path.write_bytes(struct.pack('<III',0x46546c67,2,12+len(body))+body)
 print('EXPORTED',name,triangles,hashlib.sha256(path.read_bytes()).hexdigest())
