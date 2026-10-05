import bpy,pathlib,json,struct,hashlib
ROOT=pathlib.Path(__file__).resolve().parent
out=ROOT.parent/'runner-forge-road-v1-front/public/models/r3/shop.glb'
collection=bpy.data.collections['Runner_Forge_Shop_Asset']
bpy.ops.object.select_all(action='DESELECT')
for obj in collection.objects:obj.select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects['shop_root']
for obj in collection.objects:
 if obj.type=='MESH':
  for mat in obj.data.materials:
   mat.use_backface_culling=False
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=False,export_extras=True,export_cameras=False,export_lights=False,export_yup=True,export_image_format='AUTO')
raw=out.read_bytes();size,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+size])
nodes={n['name']:n for n in doc['nodes']};assert set(nodes)=={o.name for o in collection.objects}
assert not doc.get('skins') and not doc.get('animations')
root=nodes['shop_root'];assert root.get('translation',[0,0,0])==[0,0,0] and root.get('scale',[1,1,1])==[1,1,1]
assert nodes['socket_shop_entry']['translation']==[0,0,2.299999952316284]
triangles=sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'])
assert triangles==15456
report={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':triangles,'material_primitives':sum(len(m['primitives']) for m in doc['meshes']),'embedded_images':len(doc.get('images',[])),'bounds_glTF_xyz':[[-2.7658806,.005,-2.6549647],[2.7658806,3.4050002,1.7720001]],'materials':[{'name':m['name'],'alphaMode':m.get('alphaMode','OPAQUE'),'doubleSided':m.get('doubleSided',False),'pbr':m.get('pbrMetallicRoughness')} for m in doc['materials']]}
(ROOT/'export-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('SHOP_EXPORT_READY',json.dumps(report),flush=True)
