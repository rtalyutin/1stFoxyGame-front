"""Editable, original low-poly FoxyGames assets. Python 3, no dependencies.

Coordinates: metres, Y up, front -Z. GLB imports directly into Blender.
Run from any directory; outputs stay inside hub/public/models.
"""
import json, math, struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'public' / 'models'
COLORS = {
    'ink': '#111b2b', 'metal': '#24334b', 'steel': '#78859b', 'cream': '#fff0c9',
    'blue': '#1765a6', 'cyan': '#42dafa', 'purple': '#6543ac', 'violet': '#c06cff',
    'green': '#436d30', 'lime': '#9ecd47', 'orange': '#f78029', 'ember': '#ffbd42',
    'stone': '#7f748a', 'darkstone': '#3f3b64', 'wood': '#91522e', 'soil': '#594532',
    'red': '#ac3837', 'white': '#f4ecda', 'black': '#171c27', 'gold': '#dca54b',
    'sky': '#195379', 'water': '#35b7db', 'leaf': '#378851', 'fur': '#e77a36',
}

class Model:
    def __init__(self, name):
        self.name = name; self.bin = bytearray(); self.views = []; self.accessors = []
        self.nodes = []; self.meshes = []; self.materials = []; self.material_ids = {}
        self.geometries = {}; self.mesh_ids = {}; self.animations = []
        self.root = self.node('cabinet_root' if name != 'hero' else 'hero_root')

    def accessor(self, data, components, kind='FLOAT', target=None):
        fmt, component = ('f', 5126) if kind == 'FLOAT' else ('H', 5123)
        while len(self.bin) % 4: self.bin.append(0)
        start = len(self.bin); flat = [n for v in data for n in (v if isinstance(v, (tuple, list)) else [v])]
        self.bin.extend(struct.pack('<' + fmt * len(flat), *flat))
        view = {'buffer': 0, 'byteOffset': start, 'byteLength': len(self.bin)-start}
        if target: view['target'] = target
        self.views.append(view)
        a = {'bufferView': len(self.views)-1, 'componentType': component, 'count': len(data),
             'type': {1:'SCALAR',3:'VEC3',4:'VEC4'}[components]}
        if kind == 'FLOAT':
            rows = data if components > 1 else [[v] for v in data]
            a['min'] = [min(v[i] for v in rows) for i in range(components)]
            a['max'] = [max(v[i] for v in rows) for i in range(components)]
        self.accessors.append(a); return len(self.accessors)-1

    def material(self, color, glow=False):
        key = (color, glow)
        if key not in self.material_ids:
            h = COLORS.get(color, color).lstrip('#'); srgb = [int(h[i:i+2],16)/255 for i in (0,2,4)]
            rgb = [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in srgb]
            mat = {'name': color, 'pbrMetallicRoughness': {'baseColorFactor': rgb+[1],
                    'metallicFactor': .2 if color in ('metal','steel','blue','purple','gold') else 0,
                    'roughnessFactor': .55 if color in ('metal','steel','gold') else .85}}
            if glow: mat['emissiveFactor'] = [v*.7 for v in rgb]
            self.material_ids[key] = len(self.materials); self.materials.append(mat)
        return self.material_ids[key]

    def geometry(self, shape):
        if shape in self.geometries: return self.geometries[shape]
        p=[]; n=[]; ix=[]
        if shape == 'box':
            faces = [([1,0,0],[(.5,-.5,-.5),(.5,.5,-.5),(.5,.5,.5),(.5,-.5,.5)]),
                     ([-1,0,0],[(-.5,-.5,.5),(-.5,.5,.5),(-.5,.5,-.5),(-.5,-.5,-.5)]),
                     ([0,1,0],[(-.5,.5,-.5),(-.5,.5,.5),(.5,.5,.5),(.5,.5,-.5)]),
                     ([0,-1,0],[(-.5,-.5,.5),(-.5,-.5,-.5),(.5,-.5,-.5),(.5,-.5,.5)]),
                     ([0,0,1],[(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5),(-.5,-.5,.5)]),
                     ([0,0,-1],[(-.5,-.5,-.5),(-.5,.5,-.5),(.5,.5,-.5),(.5,-.5,-.5)])]
            for normal, pts in faces:
                offset=len(p); p+=pts; n += [normal]*4; ix += [offset,offset+1,offset+2,offset,offset+2,offset+3]
        else:
            # Flat shaded tapered prisms: cone, gem and cylinder.
            sides = 6 if shape == 'gem' else 10
            radii = [(.0,-.5),(.5,0),(.0,.5)] if shape == 'gem' else [(.5,-.5),(.0 if shape=='cone' else .5,.5)]
            for (r0,y0),(r1,y1) in zip(radii,radii[1:]):
                for i in range(sides):
                    a=2*math.pi*i/sides; b=2*math.pi*(i+1)/sides
                    pts=[(r0*math.cos(a),y0,r0*math.sin(a)),(r0*math.cos(b),y0,r0*math.sin(b)),
                         (r1*math.cos(b),y1,r1*math.sin(b)),(r1*math.cos(a),y1,r1*math.sin(a))]
                    normal=(math.cos((a+b)/2), (r0-r1)/(y1-y0), math.sin((a+b)/2))
                    length=math.sqrt(sum(v*v for v in normal)); normal=[v/length for v in normal]
                    offset=len(p); p+=pts; n += [normal]*4; ix += [offset,offset+1,offset+2,offset,offset+2,offset+3]
            for radius,y in (radii[0],radii[-1]):
                for i in range(sides):
                    a=2*math.pi*i/sides; b=2*math.pi*(i+1)/sides; offset=len(p)
                    pts=[(0,y,0),(radius*math.cos(a),y,radius*math.sin(a)),(radius*math.cos(b),y,radius*math.sin(b))]
                    if y<0: pts.reverse()
                    p+=pts; n += [(0,1 if y>0 else -1,0)]*3; ix += [offset,offset+1,offset+2]
        if shape != 'box':
            for i in range(0,len(ix),3): ix[i+1],ix[i+2]=ix[i+2],ix[i+1]
        clean=[]
        for i in range(0,len(ix),3):
            a,b,c=[p[j] for j in ix[i:i+3]]
            u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
            cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
            if sum(x*x for x in cross)>1e-12:clean+=ix[i:i+3]
        ix=clean
        result={'attributes': {'POSITION':self.accessor(p,3,target=34962),'NORMAL':self.accessor(n,3,target=34962)},
                'indices': self.accessor(ix,1,'USHORT',34963)}
        self.geometries[shape]=result; return result

    def node(self, name, position=(0,0,0), scale=None, parent=None, mesh=None, rotation=None):
        node={'name':name,'translation':list(position)}
        if scale: node['scale']=list(scale)
        if mesh is not None: node['mesh']=mesh
        if rotation: node['rotation']=rotation
        idx=len(self.nodes); self.nodes.append(node)
        if parent is not None: self.nodes[parent].setdefault('children',[]).append(idx)
        return idx

    def shape(self, name, color, pos, size, shape='box', parent=None, rotation=None, glow=False):
        key=(shape,color,glow)
        if key not in self.mesh_ids:
            primitive=dict(self.geometry(shape)); primitive['material']=self.material(color,glow)
            self.mesh_ids[key]=len(self.meshes); self.meshes.append({'name':name,'primitives':[primitive]})
        return self.node(name,pos,size,self.root if parent is None else parent,self.mesh_ids[key],rotation)

    def save(self):
        obj={'asset':{'version':'2.0','generator':'FoxyGames original parametric authoring source'},'scene':0,
             'scenes':[{'nodes':[self.root]}],'nodes':self.nodes,'meshes':self.meshes,'materials':self.materials,
             'buffers':[{'byteLength':len(self.bin)}],'bufferViews':self.views,'accessors':self.accessors}
        if self.animations: obj['animations']=self.animations
        encoded=json.dumps(obj,separators=(',',':')).encode(); encoded += b' ' * (-len(encoded)%4)
        self.bin.extend(b'\0' * (-len(self.bin)%4))
        body=struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(self.bin),0x004e4942)+self.bin
        OUT.mkdir(parents=True,exist_ok=True); (OUT/(self.name+'.glb')).write_bytes(struct.pack('<III',0x46546c67,2,12+len(body))+body)

def rx(angle): return [math.sin(angle/2),0,0,math.cos(angle/2)]
def rz(angle): return [0,0,math.sin(angle/2),math.cos(angle/2)]

def fox(m, name, position, scale=1):
    root=m.node(name,position,scale=(scale,)*3,parent=m.root)
    m.shape(name+'_body','fur',(0,.43,0),(.28,.34,.23),parent=root)
    m.shape(name+'_chest','cream',(0,.43,.121),(.19,.24,.015),parent=root)
    m.shape(name+'_head','fur',(0,.69,.015),(.35,.28,.28),parent=root)
    m.shape(name+'_muzzle','cream',(0,.66,.18),(.25,.12,.15),parent=root)
    m.shape(name+'_nose','black',(0,.69,.263),(.075,.06,.04),parent=root)
    for x in (-.12,.12):
        m.shape(name+'_ear','fur',(x,.89,.015),(.16,.2,.14),'cone',parent=root)
        m.shape(name+'_eye','black',(x,.744,.164),(.042,.044,.023),parent=root)
    m.shape(name+'_tail','fur',(0,.36,-.24),(.17,.43,.18),'cone',parent=root,rotation=rx(-1.05))
    limbs=[]
    for i,x in enumerate((-.105,.105)):
        leg=m.node(name+f'_leg_{i}',(x,.29,0),parent=root); limbs.append(leg)
        m.shape(name+'_shin','ink',(0,-.13,0),(.11,.26,.12),parent=leg)
        m.shape(name+'_foot','ink',(0,-.255,.045),(.14,.07,.2),parent=leg)
        arm=m.node(name+f'_arm_{i}',(x*1.9,.52,0),parent=root); limbs.append(arm)
        m.shape(name+'_arm','fur',(0,-.11,0),(.08,.24,.1),parent=arm)
    return root,limbs

def cabinet(m,color,accent):
    m.shape('base','metal',(0,.13,0),(3.12,.26,1.14))
    m.shape('plinth','ink',(0,.33,0),(2.98,.14,1.02))
    m.shape('back','ink',(0,2.29,.57),(2.92,3.65,.12))
    backdrop={'blue':'#562d20','purple':'#281b4c','green':'#265e75'}[color]
    m.shape('world_backdrop',backdrop,(0,2.23,.49),(2.61,2.52,.05),glow=True)
    for x in (-1.47,1.47):
        m.shape('side','metal',(x,2.24,0),(.2,3.91,1.05))
        m.shape('colored_side',color,(x*1.045,2.2,0),(.12,3.91,1.08))
        m.shape('front_rail',color,(x,2.11,-.56),(.23,2.95,.12))
        m.shape('light_rail',accent,(x*.95,2.16,-.64),(.045,2.5,.035),glow=True)
        for y in (.64,3.65): m.shape('bolt','steel',(x,y,-.655),(.06,.06,.04),'cylinder',rotation=rx(math.pi/2))
    m.shape('footer',color,(0,.65,-.54),(2.94,.56,.24))
    for i in range(6): m.shape('vent','ink',(0,.48+i*.049,-.67),(1.45,.02,.02))
    m.shape('screen_sill',accent,(0,.99,-.56),(2.84,.1,.28))
    m.shape('hood',color,(0,3.93,-.02),(3.23,.53,1.25))
    m.shape('marquee','ink',(0,3.94,-.667),(2.85,.35,.025))
    m.shape('top_light',accent,(0,3.68,-.67),(2.79,.043,.035),glow=True)
    m.shape('crown','gold',(0,4.34,-.02),(.55,.45,.2),'gem')
    for x in (-.19,0,.19): m.shape('crown_tip',accent,(x,4.36,-.09),(.14,.26,.1),'cone',glow=True)
    # The bridge crosses the screen boundary and physically meets the hall floor.
    slope=math.atan2(1,2.1)
    m.shape('entry_bridge','darkstone',(0,.54,-1.42),(1.05,.12,2.34),rotation=rx(-slope))
    for i in range(9):
        z=-2.45+i*.254; y=.05+(z+2.5)/2.1
        m.shape('bridge_tread','stone',(0,y+.05,z),(1.08,.035,.04),rotation=rx(-slope))
    for name,pos in [('approach',(0,.1,-2.4)),('entry',(0,1.09,-.43)),('inside',(0,1.09,.15))]:
        m.node('anchor_'+name,pos,parent=m.root)
    m.node('screen_opening',(0,2.29,-.54),parent=m.root)

def runner():
    m=Model('runner-forge'); cabinet(m,'blue','cyan')
    m.shape('inner_floor','darkstone',(0,1,.01),(2.75,.15,.98))
    for side in (-1,1):
        for i in range(4):
            x=side*(.72+i*.15); y=1.6+i*.22
            m.shape('forge_pillar','darkstone',(x,y,.3),(.25,y-1,.3))
            m.shape('lava_seam','ember',(x,y,.125),(.033,y-1,.025),glow=True)
        for i in range(3):
            m.shape('forge_rock','stone',(side*1.09,1.1+i*.17,-.3-i*.27),(.31,.38,.27),'gem')
    for i in range(6):
        x=-.8+i*.32; m.shape('path','stone',(x,1.14,.05),( .3,.09,.68))
        m.shape('lava','orange',(x,1.08,.07),(.26,.02,.74),glow=True)
    m.shape('hammer','steel',(.75,2.76,.08),(.59,.34,.27))
    m.shape('hammer_handle','wood',(.75,2.28,.08),(.08,.74,.08))
    m.shape('anvil','metal',(.75,1.6,.07),(.66,.24,.36))
    m.shape('forge_core','ember',(-.73,2.59,.21),(.58,.62,.34),'gem',glow=True)
    fox(m,'npc_runner',(-.65,1.2,-.02),.62)
    # Forge terrain spills over the sill, outside the cabinet. Keep the entry lane clear.
    for side in (-1,1):
        for i in range(3):
            m.shape('spill_rock','darkstone',(side*(.98+i*.1),.88-i*.23,-.95-i*.24),(.4,.34,.42),'gem')
            m.shape('lava_fall','ember',(side*(.98+i*.1),1-i*.23,-1.17-i*.24),(.16,.28,.055),glow=True)
    for i in range(5): m.shape(f'spark_{i}','ember',(-.96+i*.48,1.7+i*.14,-.79),(.055,.055,.055),'gem',glow=True)
    m.save()

def throne():
    m=Model('last-throne'); cabinet(m,'purple','violet')
    m.shape('inner_floor','darkstone',(0,1,.03),(2.75,.15,.92))
    m.shape('castle','darkstone',(0,1.82,.31),(1.1,1.46,.3))
    m.shape('castle_gate','ink',(0,1.5,.145),(.4,.75,.04))
    for x,y in [(-.57,2.07),(.57,2.07),(0,2.7),(-.87,1.8),(.87,1.8)]:
        m.shape('tower','stone',(x,y,.24),(.32,.8,.34))
        m.shape('roof','purple',(x,y+.62,.24),(.47,.55,.48),'cone')
        m.shape('window','cyan',(x,y,.058),(.07,.2,.026),glow=True)
    m.shape('throne_crystal','violet',(0,3.2,.19),(.38,.5,.22),'gem',glow=True)
    for i in range(4):
        root=m.node(f'knight_{i}',(-.9+i*.58,1.14,-.27),parent=m.root)
        m.shape('knight_body','steel',(0,.19,0),(.16,.28,.12),parent=root)
        m.shape('knight_head','cream',(0,.4,0),(.14,.14,.12),parent=root)
        m.shape('knight_helmet','purple',(0,.47,0),(.2,.11,.16),parent=root)
        m.shape('shield','cyan',(-.13,.23,-.065),(.035,.24,.18),parent=root)
        m.shape('spear','gold',(.14,.35,0),(.025,.64,.025),parent=root)
    for i in range(4): m.shape(f'orbit_{i}','violet',(-1.24+i*.81,2.17+i*.2,-.75),(.15,.22,.13),'gem',glow=True)
    # Crystal roots emerge in front of the frame and continue into the hall.
    for side in (-1,1):
        m.shape('crystal_root','darkstone',(side*1.08,.45,-1.35),(.65,.56,.74),'gem')
        m.shape('outer_crystal','violet',(side*1.06,.85,-1.42),(.25,.95,.3),'gem',rotation=rz(-side*.24),glow=True)
        m.shape('outer_crystal','purple',(side*1.32,.57,-1.52),(.22,.53,.27),'gem',rotation=rz(-side*.48))
    m.save()

def moving():
    m=Model('syezzhaem'); cabinet(m,'green','lime')
    m.shape('island','soil',(0,1,.06),(2.71,.24,.94))
    m.shape('lawn','leaf',(0,1.145,.06),(2.73,.055,.95))
    m.shape('house','cream',(.32,1.69,.3),(.92,1.03,.4))
    for x in (-.2,.83): m.shape('roof','red',(x,2.27,.29),(.62,.13,.53),rotation=rz(.52 if x<0 else -.52))
    m.shape('door','wood',(.32,1.49,.08),(.24,.57,.045))
    for x in (.01,.66): m.shape('window','cyan',(x,1.88,.08),(.2,.2,.045),glow=True)
    for x,z in [(-.92,.2),(1.04,.22),(-1.02,-.22)]:
        m.shape('trunk','wood',(x,1.63,z),(.1,1,.1))
        for j in range(3): m.shape('tree','leaf',(x,1.95+j*.31,z),(.74-j*.15,.7,.65-j*.13),'cone')
    cart=m.node('moving_cart',(-.58,1.29,-.2),parent=m.root)
    m.shape('cart','wood',(0,0,0),(.52,.22,.28),parent=cart)
    m.shape('crate','gold',(0,.26,0),(.35,.3,.24),parent=cart)
    for x in (-.22,.22): m.shape('wheel','ink',(x,-.12,0),(.15,.15,.06),'cylinder',parent=cart,rotation=rx(math.pi/2))
    cat=m.node('cat',(0,1.34,-.6),parent=m.root)
    m.shape('cat_body','orange',(0,.12,0),(.28,.19,.12),parent=cat)
    m.shape('cat_head','orange',(.14,.24,0),(.17,.18,.13),parent=cat)
    for x in (.09,.2): m.shape('cat_ear','orange',(x,.36,0),(.07,.09,.06),'cone',parent=cat)
    m.shape('cat_tail','orange',(-.21,.2,0),(.045,.32,.045),parent=cat,rotation=rz(-.8))
    for i in range(4):
        m.shape(f'floating_block_{i}','soil',(-1.26+i*.85,2.44+i%2*.33,-.79),(.27,.25,.25))
        m.shape(f'grass_cap_{i}','lime',(-1.26+i*.85,2.585+i%2*.33,-.79),(.29,.055,.27))
    # Disassembled lawn blocks step out of the opening, beside the hero's bridge.
    for side in (-1,1):
        for i in range(3):
            pos=(side*(.96+i*.09),.86-i*.23,-.95-i*.27)
            m.shape('outer_soil','soil',pos,(.43,.25,.45))
            m.shape('outer_grass','lime',(pos[0],pos[1]+.145,pos[2]),(.45,.06,.47))
    m.save()

def hero():
    m=Model('hero'); root,limbs=fox(m,'fox',(0,0,0))
    samples=[i*.6/16 for i in range(17)]; times=m.accessor(samples,1)
    for clip,amp in [('run',.5),('idle',.04)]:
        anim={'name':clip,'samplers':[],'channels':[]}
        for i,limb in enumerate(limbs):
            def gait(t):
                phase=(t/.6+(0 if i in (0,3) else .5))%1
                angle=amp*(-1+4*phase if phase<=.5 else 3-4*phase)
                return phase,angle
            values=[rx(gait(t)[1] if clip=='run' else amp*math.cos(t/.6*2*math.pi)) for t in samples]
            sampler=len(anim['samplers']); anim['samplers'].append({'input':times,'output':m.accessor(values,4),'interpolation':'LINEAR'})
            anim['channels'].append({'sampler':sampler,'target':{'node':limb,'path':'rotation'}})
            if clip=='run' and i in (0,2):
                positions=[]
                for t in samples:
                    phase,angle=gait(t)
                    lift=0 if phase<=.5 else .13*math.sin((phase-.5)*2*math.pi)
                    # The stance sole stays on the ground while the swing foot lifts.
                    y=.255*math.cos(angle)+.045*math.sin(angle)+.035*abs(math.cos(angle))+.1*abs(math.sin(angle))+lift
                    positions.append((-.105 if i==0 else .105,y,0))
                sampler=len(anim['samplers']);anim['samplers'].append({'input':times,'output':m.accessor(positions,3),'interpolation':'LINEAR'})
                anim['channels'].append({'sampler':sampler,'target':{'node':limb,'path':'translation'}})
        m.animations.append(anim)
    m.save()

if __name__ == '__main__':
    if (Path(__file__).resolve().parent/'FoxyGames-Cabinets-100x.blend').exists():
        hero()
        print('Detailed cabinets retained; regenerate with Blender export_cabinets_100x.py')
    else:
        runner(); throne(); moving(); hero()
    for p in OUT.glob('*.glb'): print(p.name, p.stat().st_size)
