"""
Render aquacart_logo_intro.blend on Google Colab.

Run inside Blender:
    blender -b scene.blend -P render_colab.py -- --engine auto --out /content/frames/

EEVEE needs a GPU/GL context, which headless Colab does not always provide.
`--engine auto` tries EEVEE and falls back to Cycles (CUDA/OPTIX) with the
lighting rebalanced, since Cycles interprets the same lamp wattages differently.
"""
import argparse
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--engine", default="auto", choices=("auto", "eevee", "cycles"))
    p.add_argument("--out", default="/content/frames/")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--res", type=int, default=1080)
    p.add_argument("--start", type=int, default=0)
    p.add_argument("--end", type=int, default=0)
    return p.parse_args(argv)


def enable_gpu():
    """Turn on every CUDA/OPTIX device Cycles can see. Returns the backend used."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "NONE"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type != 'CPU']
        if backend != "NONE" and gpus:
            for d in prefs.devices:
                d.use = (d.type != 'CPU')
            bpy.context.scene.cycles.device = 'GPU'
            return backend, [d.name for d in gpus]
    bpy.context.scene.cycles.device = 'CPU'
    return "CPU", []


def to_cycles(samples):
    """Switch to Cycles and rebalance the EEVEE-tuned lighting."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.transparent_max_bounces = 4
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0

    # Cycles' area lamps read considerably hotter than EEVEE's for the same watts.
    K = 0.55
    for lamp in bpy.data.lights:
        lamp.energy *= K
        ad = lamp.animation_data
        if not ad or not ad.action:
            continue
        try:
            fcs = list(ad.action.layers[0].strips[0].channelbag(ad.action_slot).fcurves)
        except Exception:
            fcs = list(ad.action.fcurves)
        for fc in fcs:
            if fc.data_path != "energy":
                continue
            for kp in fc.keyframe_points:      # keeps the animated SWEEP streak in scale
                kp.co.y *= K
                kp.handle_left.y *= K
                kp.handle_right.y *= K
            fc.update()
    return backend_report(enable_gpu())


def backend_report(t):
    return {"backend": t[0], "devices": t[1]}


def try_eevee():
    """EEVEE only works headless when Blender can open a GL/EGL context."""
    sc = bpy.context.scene
    for name in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = name
        except TypeError:
            continue
        try:
            import gpu
            _ = gpu.platform.renderer_get()      # raises with no GL context
            return name
        except Exception as ex:
            print("EEVEE unavailable headless: %s" % ex)
            return None
    return None


def main():
    a = parse_args()
    sc = bpy.context.scene
    os.makedirs(a.out, exist_ok=True)

    engine_info = {}
    chosen = None
    if a.engine in ("auto", "eevee"):
        chosen = try_eevee()
        if chosen:
            sc.eevee.taa_render_samples = max(a.samples, 64)
    if not chosen:
        if a.engine == "eevee":
            sys.exit("EEVEE requested but no GL context is available on this machine.")
        engine_info = to_cycles(a.samples)
        chosen = 'CYCLES'

    sc.render.resolution_x = sc.render.resolution_y = a.res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = os.path.join(a.out, "f_")
    if a.start:
        sc.frame_start = a.start
    if a.end:
        sc.frame_end = a.end

    print("=" * 60)
    print("engine   :", chosen, engine_info)
    print("frames   :", sc.frame_start, "->", sc.frame_end, "@", sc.render.fps, "fps")
    print("res      :", a.res, "x", a.res)
    print("output   :", sc.render.filepath)
    print("=" * 60, flush=True)

    bpy.ops.render.render(animation=True)
    print("done:", len(os.listdir(a.out)), "files in", a.out)


main()
