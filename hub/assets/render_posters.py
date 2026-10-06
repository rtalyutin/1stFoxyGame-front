"""Render authored GLB geometry into the fallback posters. Requires Pillow.

This is an offline orthographic mesh render, never the live world renderer.
"""
import json, math, struct
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]

def rotate(v,q):
    x,y,z,w=q; a,b,c=v
    tx=2*(y*c-z*b); ty=2*(z*a-x*c); tz=2*(x*b-y*a)
    return (a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx)
def render(name):
    data=(ROOT/'public/models'/f'{name}.glb').read_bytes()
    length=struct.unpack_from('<I',data,12)[0]; gltf=json.loads(data[20:20+length])
    binary=data[28+length:]; faces=[]
    def values(idx):
        a=gltf['accessors'][idx]; v=gltf['bufferViews'][a['bufferView']]
        n={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]; fmt={5126:'f',5123:'H',5125:'I'}[a['componentType']]
        seq=struct.unpack_from('<'+fmt*(a['count']*n),binary,v.get('byteOffset',0)+a.get('byteOffset',0))
        return [seq[i:i+n] for i in range(0,len(seq),n)]
    def walk(idx,parents):
        node=gltf['nodes'][idx]; parents=parents+[node]
        def point(p):
            for transform in reversed(parents):
                s=transform.get('scale',[1,1,1]); p=tuple(p[i]*s[i] for i in range(3))
                p=rotate(p,transform.get('rotation',[0,0,0,1])); t=transform.get('translation',[0,0,0])
                p=tuple(p[i]+t[i] for i in range(3))
            return p
        if 'mesh' in node:
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                pts=[point(p) for p in values(primitive['attributes']['POSITION'])]
                indices=[p[0] for p in values(primitive['indices'])]
                color=gltf['materials'][primitive['material']]['pbrMetallicRoughness']['baseColorFactor'][:3]
                glow=gltf['materials'][primitive['material']].get('emissiveFactor',[0,0,0])
                for i in range(0,len(indices),3):
                    triangle=[pts[j] for j in indices[i:i+3]]
                    a,b,c=triangle; u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
                    normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                    length=math.sqrt(sum(n*n for n in normal)) or 1
                    brightness=.57+.43*max(0,sum(normal[j]/length*[-.25,.8,-.53][j] for j in range(3)))
                    linear=[min(1,color[j]*brightness+glow[j]*.2) for j in range(3)]
                    rgb=tuple(int((v*12.92 if v<=.0031308 else 1.055*v**(1/2.4)-.055)*255) for v in linear)
                    projected=[(320+p[0]*164,640-(p[1]*.975+p[2]*.224)*142) for p in triangle]
                    depth=sum(p[2]*.975-p[1]*.224 for p in triangle)/3
                    faces.append((depth,projected,rgb))
        for child in node.get('children',[]):walk(child,parents)
    walk(gltf['scenes'][0]['nodes'][0],[])
    image=Image.new('RGBA',(640,720)); draw=ImageDraw.Draw(image)
    for _,points,color in sorted(faces,reverse=True):draw.polygon(points,fill=color+(255,))
    (ROOT/'public/posters').mkdir(exist_ok=True)
    image.save(ROOT/'public/posters'/f'{name}.webp',lossless=True)
if __name__=='__main__':
    for name in ['runner-forge','last-throne','syezzhaem']:render(name)
