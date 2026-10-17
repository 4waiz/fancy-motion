// captions.mjs — caption cues from placed narration + word timings, and SRT export.
// Cues break at natural phrases, never exceed two balanced lines, and hold long enough to read.
// Part of the /fancy-motion skill (author: Awaiz Ahmed).

const PUNCT_END = /[.?!:]$/;
const PUNCT_SOFT = /[,;—–]$/;
const FUNCTION_WORD = /^(a|an|the|and|or|but|of|to|in|on|at|by|for|with|into|from|that|as|is|are|can|we|you|your)$/i;

/**
 * Balanced wrap into ≤ maxLines lines of ≤ maxChars. Prefers punctuation boundaries and never
 * breaks inside a keepTogether phrase (names, noun phrases) when another split fits.
 */
export function wrap(text, maxChars = 46, maxLines = 2, keepTogether = []) {
  return bestWrap(text, maxChars, maxLines, keepTogether).lines;
}

const insidePhrase = (text, cut, keepTogether) =>
  keepTogether.some((ph) => {
    for (let k = text.indexOf(ph); k >= 0; k = text.indexOf(ph, k + 1)) if (cut > k && cut < k + ph.length) return true;
    return false;
  });

/** The wrap wrap() would choose, with its score (lower is better; 0 for a one-line cue). */
export function bestWrap(text, maxChars = 46, maxLines = 2, keepTogether = []) {
  if (text.length <= maxChars) return { lines: [text], score: 0 };
  const w = text.split(" ");
  let best = null;
  for (let i = 1; i < w.length; i++) {
    const a = w.slice(0, i).join(" "), b = w.slice(i).join(" ");
    const over = Math.max(0, a.length - maxChars) + Math.max(0, b.length - maxChars);
    const bonus = PUNCT_SOFT.test(w[i - 1]) || PUNCT_END.test(w[i - 1]) ? 10 : 0;
    const inside = insidePhrase(text, a.length, keepTogether);
    // a line should not end on a word that leans on the next one ("…and / a little", "…become a / working")
    const dangling = FUNCTION_WORD.test(w[i - 1]) ? 9 : 0;
    const score = over * 100 + Math.abs(a.length - b.length) - bonus + dangling + (a.length < b.length ? 0.5 : 0) + (inside ? 50 : 0);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return maxLines >= 2 ? best : { lines: [text], score: 0 };
}

/**
 * Split one narration clip's words into caption cues of ≤ cap characters. Sentence ends always
 * split; inside a sentence the split minimises a cost that prefers balanced, well-filled cues, a
 * comma at the cut, and never a dangling function word ("…into a complete / production…").
 */
function chunkWords(ws, cap, maxChars, maxLines, keepTogether) {
  const groups = [];
  let cur = [];
  ws.forEach((x, i) => {
    cur.push(x);
    if (PUNCT_END.test(x.w) && i < ws.length - 1) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);
  const out = [];
  for (const g of groups) {
    const n = g.length;
    const textOf = (a, b) => g.slice(a, b).map((y) => y.w).join(" ");
    const whole = textOf(0, n);
    const best = Array(n + 1).fill(Infinity), prev = Array(n + 1).fill(-1);
    best[0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < i; j++) {
        const t = textOf(j, i), L = t.length;
        if (best[j] === Infinity || (L > cap && i - j > 1)) continue;
        const last = g[i - 1].w;
        // cue splits belong at clause boundaries: a comma helps, mid-clause costs, a dangling word costs more
        let endCost = i === n ? 0 : PUNCT_SOFT.test(last) ? -1.0 : FUNCTION_WORD.test(last) ? 2.0 : 0.8;
        if (i < n && insidePhrase(whole, textOf(0, i).length, keepTogether)) endCost += 5; // "creative / brief"
        const wrapCost = Math.max(0, bestWrap(t, maxChars, maxLines, keepTogether).score) / 12;
        const cost = best[j] + 1 + 2 * (1 - Math.min(1, L / cap)) ** 2 + endCost + wrapCost;
        if (cost < best[i]) {
          best[i] = cost;
          prev[i] = j;
        }
      }
    }
    const parts = [];
    for (let i = n; i > 0; i = prev[i]) parts.unshift(g.slice(prev[i], i));
    out.push(...parts);
  }
  return out;
}

/**
 * vo: [{id, at, end, text, display}] ; words: {id: {words:[{w,start,end}]}} (clip-relative).
 * Returns [{start, end, text, lines, display, vo}] with absolute seconds.
 */
export function buildCaptions(vo, words, { maxChars = 46, maxLines = 2, minDur = 1.0, tail = 0.3, gap = 0.04, keepTogether = [] } = {}) {
  const cues = [];
  const cap = maxChars * maxLines;
  for (const clip of [...vo].sort((a, b) => a.at - b.at)) {
    const ws = words[clip.id]?.words;
    if (!ws || !ws.length) {
      cues.push({ start: clip.at, end: clip.end, text: clip.text, display: clip.display, vo: clip.id });
      continue;
    }
    for (const part of chunkWords(ws, cap, maxChars, maxLines, keepTogether)) {
      cues.push({ start: clip.at + part[0].start, end: clip.at + part[part.length - 1].end, text: part.map((x) => x.w).join(" "), display: clip.display, vo: clip.id });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const nextStart = i + 1 < cues.length ? cues[i + 1].start - gap : Infinity;
    c.end = Math.min(c.end + tail, nextStart);
    if (c.end - c.start < minDur) c.end = Math.min(c.start + minDur, nextStart);
    c.start = +c.start.toFixed(3);
    c.end = +c.end.toFixed(3);
    c.lines = wrap(c.text, maxChars, maxLines, keepTogether);
  }
  return cues;
}

const ts = (s) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};
/** Complete SRT: every cue, including ones shown as hero type instead of burned-in captions. */
export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${(c.lines || [c.text]).join("\n")}\n`).join("\n");
}
