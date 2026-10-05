import bpy,json,math,pathlib,hashlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parent
scene=bpy.context.scene;scene.name='Shop_Review'
source_sha=hashlib.sha256((ROOT/'Runner-Forge-Shop-Source.blend').read_bytes()).hexdigest()

def bounds(objects):
    bpy.context.view_layer.update();dep=bpy.context.evaluated_depsgraph_get();pts=[]
    for obj in objects:
        e=obj.evaluated_get(dep);me=e.to_mesh();pts.extend(e.matrix_world@v.co for v in me.vertices);e.to_mesh_clear()
    return Vector([min(p[i] for p in pts) for i in range(3)]),Vector([max(p[i] for p in pts) for i in range(3)])

tentroot=bpy.data.objects['Tent_root'];merchantroot=bpy.data.objects['Merchant_root']
tent_sources=[o for o in tentroot.children_recursive if o.type=='MESH' and o.name.startswith('models')]
merchant_sources=[o for o in merchantroot.children_recursive if o.type=='MESH' and o.name.startswith('models')]
assert len(tent_sources)==1 and len(merchant_sources)==1
merchantroot.scale*=2.7/2.15
lo,hi=bounds(merchant_sources);merchantroot.location.x-=(lo.x+hi.x)/2;merchantroot.location.y+=-1.12-(lo.y+hi.y)/2;merchantroot.location.z-=lo.z
bpy.context.view_layer.update()
asset_collection=bpy.data.collections.new('Runner_Forge_Shop_Asset');scene.collection.children.link(asset_collection)
root=bpy.data.objects.new('shop_root',None);asset_collection.objects.link(root)
root['source']='Local Dota shopkeeper + secretshop_radiant001 adapted in Blender'
root['runtime']='Static posed merchant; no GPU skeleton or source physics exported'
asset=[];dep=bpy.context.evaluated_depsgraph_get()
for label,objects in [('Canopy',tent_sources),('Merchant',merchant_sources)]:
    for src in objects:
        ev=src.evaluated_get(dep)
        data=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=dep)
        data.transform(ev.matrix_world);data.update()
        obj=bpy.data.objects.new('RF_Shop_'+label,data);asset_collection.objects.link(obj);obj.parent=root
        for v in data.vertices:v.co.z+=.005
        obj.data.calc_loop_triangles();asset.append(obj)
for parent in [tentroot,merchantroot]:
    for obj in list(parent.children_recursive):
        if obj.name in bpy.data.objects:bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.objects.remove(parent,do_unlink=True)
canopy=next(o for o in asset if o.name=='RF_Shop_Canopy')
merchant=next(o for o in asset if o.name=='RF_Shop_Merchant')
assert len(canopy.data.loop_triangles)==7905 and len(merchant.data.loop_triangles)==6663

# Reuse painted source detail, author a teal cloth tint and native tangent normal.
old=canopy.data.materials[0];material=old.copy();material.name='RF_Radiant_Canopy_PBR'
canopy.data.materials[0]=material
nt=material.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED');output=next(n for n in nt.nodes if n.type=='OUTPUT_MATERIAL')
base_link=bs.inputs['Base Color'].links[0].from_socket
def mathnode(op,a,b):
    n=nt.nodes.new('ShaderNodeMath');n.operation=op
    for i,v in enumerate([a,b]):
        if isinstance(v,(int,float)):n.inputs[i].default_value=v
        else:nt.links.new(v,n.inputs[i])
    return n.outputs[0]
split=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(base_link,split.inputs['Color'])
r,g,b=[split.outputs[k] for k in ['Red','Green','Blue']]
low=mathnode('MINIMUM',r,mathnode('MINIMUM',g,b));high=mathnode('MAXIMUM',r,mathnode('MAXIMUM',g,b))
neutral=mathnode('LESS_THAN',mathnode('SUBTRACT',high,low),.45)
bright=mathnode('GREATER_THAN',low,.12)
mask=mathnode('MULTIPLY',neutral,bright)
multiply=nt.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;nt.links.new(base_link,multiply.inputs[1]);multiply.inputs[2].default_value=(.16,.64,.44,1)
mix=nt.nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX';nt.links.new(mask,mix.inputs[0]);nt.links.new(base_link,mix.inputs[1]);nt.links.new(multiply.outputs[0],mix.inputs[2])
nt.links.new(mix.outputs[0],bs.inputs['Base Color'])
uv=nt.nodes.new('ShaderNodeTexCoord');noise=nt.nodes.new('ShaderNodeTexNoise');nt.links.new(uv.outputs['UV'],noise.inputs['Vector']);noise.inputs['Scale'].default_value=150;noise.inputs['Detail'].default_value=2
bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.16;bump.inputs['Distance'].default_value=.015;nt.links.new(noise.outputs['Fac'],bump.inputs['Height']);nt.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
for k,val in [('Metallic',0),('Roughness',.88),('Emission Strength',0)]:
    for link in list(bs.inputs[k].links):nt.links.remove(link)
    bs.inputs[k].default_value=val
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8
scene.render.bake.margin=6;scene.render.bake.use_clear=True
bpy.ops.object.select_all(action='DESELECT');canopy.select_set(True);bpy.context.view_layer.objects.active=canopy
maps={}
for label,type,size in [('BaseColor','EMIT',1024),('Normal','NORMAL',1024)]:
    image=bpy.data.images.new('RF_Shop_Cloth_'+label,size,size,alpha=True)
    image.colorspace_settings.name='sRGB' if label=='BaseColor' else 'Non-Color'
    target=nt.nodes.new('ShaderNodeTexImage');target.image=image
    for n in nt.nodes:n.select=False
    target.select=True;nt.nodes.active=target
    if type=='EMIT':
        emit=nt.nodes.new('ShaderNodeEmission');nt.links.new(mix.outputs[0],emit.inputs['Color']);nt.links.new(emit.outputs[0],output.inputs['Surface'])
    else:nt.links.new(bs.outputs[0],output.inputs['Surface'])
    bpy.ops.object.bake(type=type)
    image.filepath_raw=str(ROOT/('RF_Shop_Cloth_'+label+'.png'));image.file_format='PNG';image.save();image.pack();maps[label]=image
    print('SHOP_BAKED_'+label,flush=True)
nt.links.new(bs.outputs[0],output.inputs['Surface'])
for label,image in maps.items():
    tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image
    if label=='BaseColor':nt.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    else:
        normal=nt.nodes.new('ShaderNodeNormalMap');nt.links.new(tex.outputs['Color'],normal.inputs['Color']);nt.links.new(normal.outputs['Normal'],bs.inputs['Normal'])

# Normal maps and painted albedo remain; exported roughness/metallic replace Source2 masks.
for index,old in enumerate(list(merchant.data.materials)):
    m=old.copy();m.name='RF_Radiant_Merchant_PBR' if 'weapon' not in old.name else 'RF_Radiant_Staff_PBR';merchant.data.materials[index]=m
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for k,val in [('Roughness',.8 if 'weapon' not in old.name else .55),('Metallic',0 if 'weapon' not in old.name else .3),('Emission Strength',.08 if 'weapon' not in old.name else .15)]:
        for link in list(p.inputs[k].links):m.node_tree.links.remove(link)
        p.inputs[k].default_value=val

def glowmaterial(name,color,strength,metallic):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.36;p.inputs['Metallic'].default_value=metallic;p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=strength
    return m
green=glowmaterial('RF_Shop_Green_Lantern_PBR',(.04,.85,.16),3,0)
gold=glowmaterial('RF_Shop_Gold_Entrance_PBR',(.95,.66,.19),1.2,.5)
staff_index=next(i for i,m in enumerate(merchant.data.materials) if 'Staff' in m.name)
staff_ids={i for p in merchant.data.polygons if p.material_index==staff_index for i in p.vertices}
staff=[merchant.data.vertices[i].co for i in staff_ids];highest=max(v.z for v in staff)
top=[v for v in staff if v.z>highest-.3];lampcenter=sum(top,Vector())/len(top);lampcenter.z=highest-.22
bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.085,location=lampcenter)
lamp=bpy.context.object;lamp.name='RF_Shop_Lantern_Glow';lamp.data.materials.append(green)
for c in list(lamp.users_collection):c.objects.unlink(lamp)
asset_collection.objects.link(lamp);lamp.parent=root;asset.append(lamp)
for name,radius,minor,z,mat in [('Merchant_Ring',.64,.012,.025,gold),('Merchant_Aura',.58,.012,.028,green)]:
    bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=4,major_radius=radius,minor_radius=minor,location=(0,-1.12,z))
    obj=bpy.context.object;obj.name='RF_Shop_'+name;obj.data.materials.append(mat)
    for c in list(obj.users_collection):c.objects.unlink(obj)
    asset_collection.objects.link(obj);obj.parent=root;asset.append(obj)
for name,position in [('socket_shop_entry',(0,-2.30,0)),('socket_shop_focus',(0,-.2,1.25))]:
    obj=bpy.data.objects.new(name,None);asset_collection.objects.link(obj);obj.parent=root;obj.location=position

for image in bpy.data.images:
    if image.source=='FILE':image.pack()
lo,hi=bounds(asset)
triangles=0
for obj in asset:obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
assert 14568<=triangles<17000 and lo.z>=-.00001
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1200;scene.render.resolution_y=1000
scene.render.filepath=str(ROOT/'shop-material-review.png')
scene.camera.data.ortho_scale=7
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Runner-Forge-Shop-v1.blend'))
bpy.ops.render.render(write_still=True)
report={'pass':True,'triangles':triangles,'assetMeshes':len(asset),'staticMerchant':True,'bounds':[list(lo),list(hi)],'lampCenter':list(lampcenter),'sourceNativeSha256':source_sha,'materials':[m.name for m in set(m for obj in asset for m in obj.data.materials)],'source':'Local Dota shopkeeper + Radiant shop; native PBR/tint/bakes/rings authored here','gameExport':'not_started'}
(ROOT/'native-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
assert hashlib.sha256((ROOT/'Runner-Forge-Shop-Source.blend').read_bytes()).hexdigest()==source_sha
print('SHOP_NATIVE_READY',json.dumps(report),flush=True)
