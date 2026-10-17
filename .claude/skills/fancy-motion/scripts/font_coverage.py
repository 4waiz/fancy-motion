"""Font coverage check: every character the film can show must exist in the bundled font that
renders it — otherwise the browser silently substitutes another font.

  uv run --project <skill>/scripts python <skill>/scripts/font_coverage.py <project>
      [--extra file.txt ...]

Collects text from manifest.json (captions, hero words, scene titles), src/**/*.js and *.css
string literals, assets/source/* (SKILL.md, code, invocation) and checks it against each
bundled woff2 in vendor/fonts. Reports, per family, the characters that are missing.
Author: Awaiz Ahmed.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

FAMILIES = {
    "Archivo": ["archivo-latin-standard-normal.woff2", "archivo-symbols.woff2"],
    "DM Sans": ["dm-sans-latin-standard-normal.woff2", "dm-sans-symbols.woff2"],
    "JetBrains Mono": ["jetbrains-mono-latin-wght-normal.woff2", "jetbrains-mono-symbols.woff2"],
}


def cmap_of(path):
    return set(TTFont(str(path)).getBestCmap().keys())


def collect(project, extras):
    P = Path(project)
    texts = []
    M = json.loads((P / "manifest.json").read_text(encoding="utf-8"))
    for c in M.get("captions", []):
        texts.append(("captions (DM Sans)", c["text"]))
    for s in M.get("scenes", []):
        for h in s.get("hero", []):
            texts.append(("hero (Archivo)", h))
    for f in list((P / "src").rglob("*.js")) + list((P / "src").rglob("*.css")):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"\"([^\"\\n]{1,200})\"|'([^'\\n]{1,200})'|`([^`]{1,400})`", src):
            s = next(g for g in m.groups() if g is not None)
            if re.search(r"[^\x00-\x7f]", s):
                texts.append((f"{f.relative_to(P)}", s))
    for f in (P / "assets" / "source").glob("*"):
        if f.suffix in (".md", ".json", ".js", ".txt"):
            texts.append((f"{f.relative_to(P)}", f.read_text(encoding="utf-8")))
    for e in extras:
        texts.append((e, Path(e).read_text(encoding="utf-8")))
    return texts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--extra", nargs="*", default=[])
    a = ap.parse_args()
    P = Path(a.project)
    fonts = {fam: set().union(*[cmap_of(P / "vendor" / "fonts" / f) for f in files if (P / "vendor" / "fonts" / f).exists()]) for fam, files in FAMILIES.items()}
    texts = collect(P, a.extra)
    chars = {}
    for where, s in texts:
        for ch in s:
            if ord(ch) < 0x20 or ch in "\n\r\t":
                continue
            chars.setdefault(ch, set()).add(where)
    nonascii = sorted(c for c in chars if ord(c) > 0x7E)
    print(f"{len(chars)} distinct characters; non-ASCII: {''.join(nonascii)}")
    bad = 0
    for fam, cm in fonts.items():
        missing = [c for c in nonascii if ord(c) not in cm]
        if missing:
            bad += 1
            print(f"{fam}: MISSING {''.join(missing)}")
            for c in missing:
                print(f"   U+{ord(c):04X} {c!r} used in: {', '.join(sorted(chars[c]))[:160]}")
        else:
            print(f"{fam}: all characters present")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
