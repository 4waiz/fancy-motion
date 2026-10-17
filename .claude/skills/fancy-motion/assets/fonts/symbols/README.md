# Symbol subsets (→ ≈ ≤ ≥)

The Fontsource "latin" subsets used by /fancy-motion do not contain U+2192 → , U+2248 ≈ ,
U+2264 ≤ or U+2265 ≥. Without these files the browser silently substitutes a system font for
those characters. These are text-subsets of the same OFL families (variable axes preserved),
fetched once from the Google Fonts API (`css2?family=…&text=→≈≤≥`) on 2026-10-17 and bundled so
renders never touch the network. Licence: SIL Open Font License 1.1 (see the family licence
files that vendor.mjs copies next to them). U+2713 ✓ exists in none of the three families, so
/fancy-motion tools print "ok"/"FAIL" instead.

| File | Family | Axes |
|---|---|---|
| archivo-symbols.woff2 | Archivo | wght 100–900, wdth 62–125 |
| dm-sans-symbols.woff2 | DM Sans | wght 100–1000 |
| jetbrains-mono-symbols.woff2 | JetBrains Mono | wght 100–800 |
