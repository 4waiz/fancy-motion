// compose.mjs — write a project's composition HTML (index.html, or a variant such as portrait.html)
// from its manifest. One project can hold several formats/cuts: each variant file names its own
// manifest (data-manifest) and soundtrack; render a variant with `hyperframes render -c <file>`.
// Media are static <video> clips inside positionable wrappers (HyperFrames extracts their
// frames); optional media that do not exist yet are skipped so scenes can show a fallback.
// Part of the /fancy-motion skill (author: Awaiz Ahmed).
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function writeIndexHtml(projectDir, M, { compositionId = "fm-film", entry = "src/main.js", styles = ["vendor/tokens.css", "fm/fm.css"], soundtrack = M.soundtrack || "assets/audio/soundtrack.wav", file = "index.html", manifest = "manifest.json" } = {}) {
  const missing = [];
  const videos = (M.media || [])
    .filter((v) => {
      const ok = existsSync(join(projectDir, v.src));
      if (!ok) missing.push({ id: v.id, src: v.src, optional: !!v.optional });
      return ok;
    })
    .map((v) => `      <div class="vwrap" id="w-${v.id}" data-layout-ignore><video id="${v.id}" class="vid" data-start="${v.start}" data-duration="${v.duration}" data-media-start="${v.mediaStart ?? 0}" muted playsinline preload="auto" src="${esc(v.src)}"></video></div>`)
    .join("\n");
  const hasTrack = soundtrack && existsSync(join(projectDir, soundtrack));
  if (existsSync(join(projectDir, "src", "style.css")) && !styles.includes("src/style.css")) styles = [...styles, "src/style.css"];
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${M.width}, height=${M.height}" />
    <meta name="author" content="${esc(M.creator)}" />
    <title>${esc(M.title)}</title>
    <style>
      @font-face { font-family: "Archivo"; src: url("vendor/fonts/archivo-latin-standard-normal.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; font-display: block; }
      @font-face { font-family: "DM Sans"; src: url("vendor/fonts/dm-sans-latin-standard-normal.woff2") format("woff2"); font-weight: 100 1000; font-display: block; }
      @font-face { font-family: "JetBrains Mono"; src: url("vendor/fonts/jetbrains-mono-latin-wght-normal.woff2") format("woff2"); font-weight: 100 800; font-display: block; }
      @font-face { font-family: "Archivo"; src: url("vendor/fonts/archivo-symbols.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; font-display: block; unicode-range: U+2192, U+2248, U+2264-2265; }
      @font-face { font-family: "DM Sans"; src: url("vendor/fonts/dm-sans-symbols.woff2") format("woff2"); font-weight: 100 1000; font-display: block; unicode-range: U+2192, U+2248, U+2264-2265; }
      @font-face { font-family: "JetBrains Mono"; src: url("vendor/fonts/jetbrains-mono-symbols.woff2") format("woff2"); font-weight: 100 800; font-display: block; unicode-range: U+2192, U+2248, U+2264-2265; }
      html, body { margin: 0; background: #101114; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #101114; }
    </style>
${styles.map((s) => `    <link rel="stylesheet" href="${s}" />`).join("\n")}
    <script type="importmap">
      { "imports": { "three": "./vendor/three/build/three.module.js", "three/addons/": "./vendor/three/examples/jsm/" } }
    </script>
  </head>
  <body>
    <!-- ${esc(M.title)} · created by ${esc(M.creator)}${M.studio ? ` · ${esc(M.studio)}` : ""}${M.builtWith ? ` · built with ${esc(M.builtWith)}` : ""}. Generated from its manifest by /fancy-motion. -->
    <div id="root" data-composition-id="${compositionId}" data-manifest="${esc(manifest)}" data-format="${M.height > M.width ? "portrait" : M.height === M.width ? "square" : "landscape"}" data-start="0" data-width="${M.width}" data-height="${M.height}" data-duration="${M.duration}" data-fps="${M.fps}" data-no-timeline>
      <div id="below" class="fm-layer below" data-layout-ignore></div>
${videos}
      <canvas id="world" class="fm-world" width="${M.width}" height="${M.height}" data-layout-allow-overflow></canvas>
      <div id="mid" class="fm-layer mid" data-layout-ignore></div>
      <div id="above" class="fm-layer above"></div>
${hasTrack ? `      <audio id="soundtrack" data-start="0" data-duration="${M.duration}" data-volume="1" src="${soundtrack}"></audio>` : ""}
    </div>
    <script type="module" src="${entry}"></script>
  </body>
</html>
`;
  writeFileSync(join(projectDir, file), html);
  return { media: (M.media || []).length - missing.length, missing, soundtrack: !!hasTrack };
}
