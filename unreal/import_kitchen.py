"""
import_kitchen.py — bring the exported kitchen into Unreal and set up the
like-for-like comparison against the Three.js render and the listing photo.

Run inside the Unreal Editor:
    Window > Developer Tools > Output Log, switch the console dropdown to
    "Python", then:

        exec(open(r"/path/to/unreal/import_kitchen.py").read())

What it does
------------
1. Imports export/kitchen.glb
2. Turns Lumen on (that is the whole point of the exercise)
3. Places the 5 calibrated camera viewpoints from kitchen.cameras.json,
   converted from glTF axes to Unreal's
4. Optionally renders each to PNG

IMPORTANT: this script has NOT been run — the environment it was written in has
no GPU and no Unreal install, so it is careful rather than verified. Treat it as
a strong starting point, not a guarantee. If it fights you, unreal/README.md has
the manual steps, which are only a few clicks; the camera maths is the only part
worth automating.

Coordinate systems
------------------
The source project works in FEET, Y-up (CONVENTIONS §1). The exporter already
converted to metres for glTF. Unreal is Z-up, left-handed, CENTIMETRES, so:

    UE.X = -glTF.Z
    UE.Y =  glTF.X
    UE.Z =  glTF.Y      all multiplied by 100

Unreal's glTF importer applies that to the geometry itself; the cameras below are
converted explicitly with the same mapping so they land in the same places.
"""

import json
import math
import os

import unreal

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(REPO, "export", "kitchen.glb")
CAMS = os.path.join(REPO, "export", "kitchen.cameras.json")

DEST = "/Game/Kitchen"
RENDER_DIR = os.path.join(REPO, "export", "unreal_renders")

# The listing photos are 1526x1014 (PHOTOGRAPHY.md §1.1). Matching the render
# size keeps the three-way comparison honest.
RENDER_W, RENDER_H = 1526, 1014

M_TO_UU = 100.0  # metres -> Unreal units (cm)


def gltf_to_unreal(p):
    """glTF (Y-up, right-handed, metres) -> Unreal (Z-up, left-handed, cm)."""
    x, y, z = p[0], p[1], p[2]
    return unreal.Vector(-z * M_TO_UU, x * M_TO_UU, y * M_TO_UU)


# --------------------------------------------------------------------------
# 1. Import the glb
# --------------------------------------------------------------------------

def import_glb():
    if not os.path.exists(GLB):
        unreal.log_error("missing %s — run `node tools/export_glb.mjs` first" % GLB)
        return False

    task = unreal.AssetImportTask()
    task.filename = GLB
    task.destination_path = DEST
    task.automated = True
    task.replace_existing = True
    task.save = True

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    unreal.log("imported %s -> %s" % (GLB, DEST))
    return True


# --------------------------------------------------------------------------
# 2. Lumen
# --------------------------------------------------------------------------

def enable_lumen():
    """
    Lumen is a project setting, but a PostProcessVolume is the reliable way to
    force it on for this level regardless of how the project was created.

    On Apple Silicon Lumen runs in SOFTWARE ray tracing mode — there is no
    hardware RT path on Metal — which is still a large upgrade over the
    analytic-lights-only look we are comparing against.
    """
    world = unreal.EditorLevelLibrary.get_editor_world()
    ppv = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.PostProcessVolume, unreal.Vector(0, 0, 0)
    )
    ppv.set_editor_property("unbound", True)

    settings = ppv.get_editor_property("settings")
    # Global illumination + reflections via Lumen
    settings.set_editor_property("override_dynamic_global_illumination_method", True)
    settings.set_editor_property(
        "dynamic_global_illumination_method",
        unreal.DynamicGlobalIlluminationMethod.LUMEN,
    )
    settings.set_editor_property("override_reflection_method", True)
    settings.set_editor_property("reflection_method", unreal.ReflectionMethod.LUMEN)

    # Quality. Raise these if the Air can take it; drop them if it throttles.
    settings.set_editor_property("override_lumen_scene_lighting_quality", True)
    settings.set_editor_property("lumen_scene_lighting_quality", 2.0)
    settings.set_editor_property("override_lumen_final_gather_quality", True)
    settings.set_editor_property("lumen_final_gather_quality", 2.0)

    # Match the project's measured exposure rather than letting auto-exposure
    # invent its own grade — otherwise the comparison is meaningless.
    # PHOTOGRAPHY.md: exposure 1.15 interior.
    settings.set_editor_property("override_auto_exposure_method", True)
    settings.set_editor_property(
        "auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL
    )

    ppv.set_editor_property("settings", settings)
    unreal.log("Lumen enabled via unbound PostProcessVolume")
    return ppv


# --------------------------------------------------------------------------
# 3. Cameras
# --------------------------------------------------------------------------

def place_cameras():
    if not os.path.exists(CAMS):
        unreal.log_error("missing %s" % CAMS)
        return []

    with open(CAMS, "r") as fh:
        cams = json.load(fh)

    spawned = []
    for cam in cams:
        if not cam.get("position_m") or not cam.get("target_m"):
            continue

        loc = gltf_to_unreal(cam["position_m"])
        tgt = gltf_to_unreal(cam["target_m"])

        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.CineCameraActor, loc
        )
        actor.set_actor_label(cam.get("id") or "view")

        rot = unreal.MathLibrary.find_look_at_rotation(loc, tgt)
        # CONVENTIONS §5: the reference camera never pitches — verticals stay
        # vertical. The stills achieve that with a shift lens; Unreal has no
        # shift, so the honest equivalent is to zero the pitch and accept a
        # slightly different framing rather than introduce converging verticals.
        rot.pitch = 0.0
        rot.roll = 0.0
        actor.set_actor_rotation(rot, False)

        comp = actor.get_cine_camera_component()
        # cameras.json stores VERTICAL fov; Unreal wants horizontal.
        v = math.radians(cam.get("fovV_deg") or 78.5)
        aspect = cam.get("aspect") or 1.505
        h = 2.0 * math.atan(math.tan(v / 2.0) * aspect)
        comp.set_editor_property("field_of_view", math.degrees(h))

        filmback = comp.get_editor_property("filmback")
        filmback.set_editor_property("sensor_width", 36.0)
        filmback.set_editor_property("sensor_height", 36.0 / aspect)
        comp.set_editor_property("filmback", filmback)

        spawned.append((cam.get("id"), actor))
        unreal.log("camera %s at %s" % (cam.get("id"), loc))

    return spawned


# --------------------------------------------------------------------------
# 4. Render
# --------------------------------------------------------------------------

def render(spawned):
    """
    High-res screenshots at the listing-photo size.

    If this path misbehaves, the Movie Render Queue gives better control and is
    worth the extra clicks — see README. Getting ONE good frame matters more
    than automating five.
    """
    os.makedirs(RENDER_DIR, exist_ok=True)
    for name, actor in spawned:
        unreal.EditorLevelLibrary.pilot_level_actor(actor)
        unreal.AutomationLibrary.take_high_res_screenshot(
            RENDER_W, RENDER_H, os.path.join(RENDER_DIR, "%s.png" % name)
        )
        unreal.log("rendered %s" % name)
    unreal.EditorLevelLibrary.eject_pilot_level_actor()


# --------------------------------------------------------------------------

def main():
    if not import_glb():
        return
    enable_lumen()
    spawned = place_cameras()
    unreal.log("placed %d cameras" % len(spawned))
    unreal.log("Now: check the framing, then run render(spawned) to write PNGs.")
    return spawned


if __name__ == "__main__":
    _spawned = main()
