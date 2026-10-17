// brag.mjs — locate the installed /brag skill and expose the capabilities /fancy-motion reuses
// in place (never copies): its CC0 SFX library and keypress set, its music and cue presets,
// and its cue analyser. Part of the /fancy-motion skill (author: Awaiz Ahmed).
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

function* candidates(start) {
  let d = resolve(start);
  for (let i = 0; i < 8; i++) {
    yield join(d, ".claude", "skills", "brag");
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  yield join(homedir(), ".claude", "skills", "brag");
  // plugin installs keep skills under ~/.claude/plugins/**/skills/brag
  const plugins = join(homedir(), ".claude", "plugins");
  const stack = existsSync(plugins) ? [[plugins, 0]] : [];
  while (stack.length) {
    const [p, depth] = stack.pop();
    if (depth > 6) continue;
    let entries = [];
    try {
      entries = readdirSync(p);
    } catch {
      continue;
    }
    for (const e of entries) {
      const q = join(p, e);
      try {
        if (!statSync(q).isDirectory()) continue;
      } catch {
        continue;
      }
      if (e === "brag" && p.endsWith("skills")) yield q;
      else if (e !== "node_modules" && !e.startsWith(".")) stack.push([q, depth + 1]);
    }
  }
}

export function findBrag(start = process.cwd()) {
  for (const dir of candidates(start)) {
    if (!existsSync(join(dir, "SKILL.md"))) continue;
    const sfx = join(dir, "assets", "sfx");
    const music = join(dir, "assets", "music");
    return {
      dir,
      sfx: existsSync(sfx) ? Object.fromEntries(readdirSync(sfx).filter((f) => statSync(join(sfx, f)).isDirectory()).map((f) => [f, join(sfx, f)])) : {},
      sfxAnalysis: existsSync(join(sfx, "sfx-analysis.json")) ? join(sfx, "sfx-analysis.json") : null,
      music: existsSync(music) ? readdirSync(music).filter((f) => /\.(mp3|wav|ogg)$/i.test(f)).map((f) => join(music, f)) : [],
      cues: existsSync(join(music, "cues")) ? join(music, "cues") : null,
      analyzer: existsSync(join(dir, "scripts", "analyze_music_cues.py")) ? join(dir, "scripts", "analyze_music_cues.py") : null,
    };
  }
  return null;
}
