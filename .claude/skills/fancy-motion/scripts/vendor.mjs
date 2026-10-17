#!/usr/bin/env node
// vendor.mjs — give a /fancy-motion project pinned, local copies of everything it renders with:
// the fm component library (from this skill), Three.js + the few addons it uses, the three OFL
// font families, and design tokens. No CDN at render time; one source of truth (this skill).
//
//   node <skill>/scripts/vendor.mjs <project-dir> [--node-modules <dir>] [--tokens <tokens.css>] [--check]
//
// --check exits 1 if the project's copies differ from the sources (so drift is caught, not kept).
// Author: Awaiz Ahmed.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here, "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const valueFlags = new Set(["--node-modules", "--tokens"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const project = resolve(positional[0] || ".");
const check = args.includes("--check");

function findNodeModules(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "node_modules", "three"))) return join(d, "node_modules");
    d = dirname(d);
  }
  return null;
}
const nm = resolve(opt("node-modules", "") || findNodeModules(project) || findNodeModules(process.cwd()) || findNodeModules(skill) || "");
if (!existsSync(join(nm, "three"))) {
  console.error("three not found. Run `npm i -D three@0.186.1 @fontsource-variable/archivo @fontsource-variable/dm-sans @fontsource-variable/jetbrains-mono` in the project (or a parent) first.");
  process.exit(2);
}
const tokens = resolve(opt("tokens", "") || join(skill, "assets", "templates", "starter", "tokens.css"));

const fmDir = join(skill, "assets", "templates", "starter", "fm");
const plan = [
  ...readdirSync(fmDir).map((f) => [join(fmDir, f), join(project, "fm", f)]),
  [join(nm, "three/build/three.module.js"), join(project, "vendor/three/build/three.module.js")],
  [join(nm, "three/build/three.core.js"), join(project, "vendor/three/build/three.core.js")],
  [join(nm, "three/examples/jsm/geometries/RoundedBoxGeometry.js"), join(project, "vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js")],
  [join(nm, "three/examples/jsm/geometries/TextGeometry.js"), join(project, "vendor/three/examples/jsm/geometries/TextGeometry.js")],
  [join(nm, "three/examples/jsm/loaders/FontLoader.js"), join(project, "vendor/three/examples/jsm/loaders/FontLoader.js")],
  [join(nm, "three/LICENSE"), join(project, "vendor/three/LICENSE")],
  [join(nm, "@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2"), join(project, "vendor/fonts/archivo-latin-standard-normal.woff2")],
  [join(nm, "@fontsource-variable/dm-sans/files/dm-sans-latin-standard-normal.woff2"), join(project, "vendor/fonts/dm-sans-latin-standard-normal.woff2")],
  [join(nm, "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"), join(project, "vendor/fonts/jetbrains-mono-latin-wght-normal.woff2")],
  [join(nm, "@fontsource-variable/archivo/LICENSE"), join(project, "vendor/fonts/LICENSE-Archivo-OFL.txt")],
  [join(nm, "@fontsource-variable/dm-sans/LICENSE"), join(project, "vendor/fonts/LICENSE-DMSans-OFL.txt")],
  [join(nm, "@fontsource-variable/jetbrains-mono/LICENSE"), join(project, "vendor/fonts/LICENSE-JetBrainsMono-OFL.txt")],
  [join(skill, "assets/fonts/symbols/archivo-symbols.woff2"), join(project, "vendor/fonts/archivo-symbols.woff2")],
  [join(skill, "assets/fonts/symbols/dm-sans-symbols.woff2"), join(project, "vendor/fonts/dm-sans-symbols.woff2")],
  [join(skill, "assets/fonts/symbols/jetbrains-mono-symbols.woff2"), join(project, "vendor/fonts/jetbrains-mono-symbols.woff2")],
  [tokens, join(project, "vendor/tokens.css")],
];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
const pkg = (name) => JSON.parse(readFileSync(join(nm, name, "package.json"), "utf8")).version;
let drift = 0;
const record = {};
for (const [src, dst] of plan) {
  if (!existsSync(src)) {
    console.error(`missing source: ${src}`);
    process.exit(2);
  }
  const s = sha(src);
  record[dst.slice(project.length + 1).replace(/\\/g, "/")] = s;
  if (check) {
    if (!existsSync(dst) || sha(dst) !== s) {
      drift++;
      console.log(`drift: ${dst}`);
    }
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}
if (check) {
  console.log(drift ? `${drift} file(s) differ from /fancy-motion sources — run vendor.mjs without --check` : "vendor: in sync");
  process.exit(drift ? 1 : 0);
}
const meta = {
  generatedBy: "/fancy-motion scripts/vendor.mjs",
  skillVersion: JSON.parse(readFileSync(join(skill, "skill.json"), "utf8")).version,
  three: pkg("three"),
  fonts: { archivo: pkg("@fontsource-variable/archivo"), dmSans: pkg("@fontsource-variable/dm-sans"), jetbrainsMono: pkg("@fontsource-variable/jetbrains-mono") },
  files: record,
};
writeFileSync(join(project, "vendor", "vendor.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`vendored ${plan.length} files into ${project} (three ${meta.three}, skill ${meta.skillVersion})`);
