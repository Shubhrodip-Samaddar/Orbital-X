"""
Builds three simple models in Blender and exports them as GLB files into ./models/
Run from a terminal (Blender must be installed):
    blender --background --python make_models.py
Or open Blender > Scripting tab > open this file > Run Script.
"""
import bpy, os, random

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
os.makedirs(OUT, exist_ok=True)

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

def paint(obj, name, rgba, metal=0.6, rough=0.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    obj.data.materials.append(m)

def cube(loc, scale, name, rgba, metal=0.6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    paint(o, name, rgba, metal)
    return o

def export(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"),
                              export_format="GLB", use_selection=True)
    print("Exported", name)

# 1) Satellite: bus + two solar panels + dish
clear()
cube((0, 0, 0), (1, 1, 1.4), "bus", (0.75, 0.75, 0.78, 1))
cube((-1.9, 0, 0), (2.2, 0.05, 1), "panelL", (0.1, 0.25, 0.6, 1), 0.2)
cube((1.9, 0, 0), (2.2, 0.05, 1), "panelR", (0.1, 0.25, 0.6, 1), 0.2)
bpy.ops.mesh.primitive_cone_add(radius1=0.5, depth=0.3, location=(0, 0, 0.95))
paint(bpy.context.active_object, "dish", (0.9, 0.9, 0.9, 1))
export("satellite")

# 2) Rocket body: cylinder + nozzle + band
clear()
bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=3.2, location=(0, 0, 0))
paint(bpy.context.active_object, "tank", (0.82, 0.82, 0.82, 1))
bpy.ops.mesh.primitive_cone_add(radius1=0.4, radius2=0.2, depth=0.6, location=(0, 0, -1.9))
paint(bpy.context.active_object, "nozzle", (0.25, 0.25, 0.25, 1))
bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.04, location=(0, 0, 0.8))
paint(bpy.context.active_object, "band", (0.7, 0.2, 0.1, 1))
export("rocket_body")

# 3) Fragment: jagged, irregular lump
clear()
random.seed(7)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.9)
frag = bpy.context.active_object
for v in frag.data.vertices:
    v.co.x *= random.uniform(0.55, 1.25)
    v.co.y *= random.uniform(0.55, 1.25)
    v.co.z *= random.uniform(0.55, 1.25)
paint(frag, "scrap", (0.5, 0.46, 0.43, 1), metal=0.3, rough=0.7)
export("fragment")
