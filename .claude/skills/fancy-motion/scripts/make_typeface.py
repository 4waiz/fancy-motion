"""Make a three.js typeface JSON (for TextGeometry / extruded hero type) from any TTF/OTF/WOFF2.

Variable fonts are instanced first, so one family gives exactly the width and weight you want:

  uv run --project <skill>/scripts python <skill>/scripts/make_typeface.py \
      node_modules/@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2 \
      film/assets/fonts/archivo-xc-black.typeface.json --axis wght=900 --axis wdth=62

Output uses font units with resolution = unitsPerEm, so TextGeometry `size` is the em size.
Outline commands follow three.js FontLoader: 'q' = end point then control point,
'b' = end point then two control points. Author: Awaiz Ahmed. (Fonts keep their own licence —
the OFL travels with the font; this converter only re-encodes outlines.)
"""
import argparse
import json
import string
from pathlib import Path

from fontTools.pens.basePen import decomposeQuadraticSegment
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

DEFAULT_CHARS = string.ascii_letters + string.digits + " .,:;!?'\"-–—/()&+×→·%#@*"


def fmt(v):
    return str(int(round(v)))


def outline(recording):
    out = []
    cur = None
    start = None
    for op, args in recording.value:
        if op == "moveTo":
            cur = start = args[0]
            out += ["m", fmt(cur[0]), fmt(cur[1])]
        elif op == "lineTo":
            cur = args[0]
            out += ["l", fmt(cur[0]), fmt(cur[1])]
        elif op == "qCurveTo":
            pts = list(args)
            if pts[-1] is None:  # contour made only of off-curve points
                pts = pts[:-1]
                mid = ((pts[-1][0] + pts[0][0]) / 2, (pts[-1][1] + pts[0][1]) / 2)
                out += ["m", fmt(mid[0]), fmt(mid[1])]
                pts = pts + [mid]
            for ctrl, end in decomposeQuadraticSegment(pts):
                out += ["q", fmt(end[0]), fmt(end[1]), fmt(ctrl[0]), fmt(ctrl[1])]
                cur = end
        elif op == "curveTo":
            c1, c2, end = args
            out += ["b", fmt(end[0]), fmt(end[1]), fmt(c1[0]), fmt(c1[1]), fmt(c2[0]), fmt(c2[1])]
            cur = end
        elif op in ("closePath", "endPath"):
            if start is not None and cur is not None and cur != start:
                out += ["l", fmt(start[0]), fmt(start[1])]
            cur = start = None
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("font")
    ap.add_argument("out")
    ap.add_argument("--axis", action="append", default=[], help="tag=value, e.g. wght=900")
    ap.add_argument("--chars", default=DEFAULT_CHARS)
    ap.add_argument("--ttf", help="also write the static instance as .ttf")
    a = ap.parse_args()

    font = TTFont(a.font)
    if "fvar" in font and a.axis:
        loc = {k: float(v) for k, v in (s.split("=") for s in a.axis)}
        font = instancer.instantiateVariableFont(font, loc, inplace=False)
    if a.ttf:
        font.flavor = None
        font.save(a.ttf)
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]
    glyphs = {}
    xs, ys = [], []
    for ch in a.chars:
        name = cmap.get(ord(ch))
        if not name:
            continue
        pen = RecordingPen()
        gs[name].draw(pen)
        adv, lsb = hmtx[name]
        o = outline(pen)
        bounds = [v for op, args in pen.value for p in args if p is not None for v in [p]]
        if bounds:
            gx = [p[0] for p in bounds]
            gy = [p[1] for p in bounds]
            xs += gx
            ys += gy
            glyphs[ch] = {"ha": adv, "x_min": int(min(gx)), "x_max": int(max(gx)), "o": o}
        else:
            glyphs[ch] = {"ha": adv, "x_min": 0, "x_max": adv, "o": ""}
    name_table = font["name"]
    family = name_table.getDebugName(1) or Path(a.font).stem
    post = font["post"]
    data = {
        "glyphs": glyphs,
        "familyName": family,
        "ascender": font["hhea"].ascent,
        "descender": font["hhea"].descent,
        "underlinePosition": post.underlinePosition,
        "underlineThickness": post.underlineThickness,
        "boundingBox": {"xMin": int(min(xs)), "yMin": int(min(ys)), "xMax": int(max(xs)), "yMax": int(max(ys))},
        "resolution": upem,
        "original_font_information": {"format": 0, "fontFamily": family, "axes": a.axis, "source": Path(a.font).name},
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {a.out}: {len(glyphs)} glyphs, upem {upem}, family {family!r}, axes {a.axis}")


if __name__ == "__main__":
    main()
