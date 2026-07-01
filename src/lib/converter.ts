// Custom text notation -> ABC notation (for abcjs).
// Handles durations, dots, octaves, accidentals, rests, ties, triplets,
// duration carry-over, and beat-based auto-beaming.

export interface MeasureInfo {
  label: string;       // e.g. "m1" or "m2-m9" for an Nx block
  lineNumber: number;  // 1-based source line
  abc: string;         // empty when multiRest is set
  leftBar?: string;    // ABC marker before this measure, e.g. '||', '|:'
  rightBar?: string;   // ABC marker after this measure, e.g. '||', ':|', '|]'
  voltaStart?: 1 | 2;  // start of a volta bracket
  multiRest?: number;  // N when this entry stands for N bars of rest
}

export interface ToAbcOptions {
  title?: string;
  meter?: string;
  key?: string;
  measuresPerLine?: number;
}

export interface ToAbcResult {
  abc: string;
  measures: MeasureInfo[];
  errors: string[];
}

const BASE_UNITS: Record<string, number> = {
  '1': 8, '2': 4, '4': 2, '8': 1, '16': 0.5, '32': 0.25,
};

function durToUnits(durStr: string): number | null {
  const dots = (durStr.match(/\./g) || []).length;
  const base = durStr.replace(/\./g, '');
  const u = BASE_UNITS[base];
  if (u === undefined) return null;
  if (dots === 1) return u * 1.5;
  if (dots === 2) return u * 1.75;
  return u;
}

function abcDur(units: number): string {
  if (units === 1) return '';
  if (units === 0.5) return '/2';
  if (units === 0.25) return '/4';
  if (units === 0.75) return '3/4';
  if (units === 1.5) return '3/2';
  if (units === 2.5) return '5/2';
  if (units === 3.5) return '7/2';
  if (Number.isInteger(units)) return String(units);
  const halves = units * 2;
  if (Number.isInteger(halves)) return `${halves}/2`;
  const quarters = units * 4;
  if (Number.isInteger(quarters)) return `${quarters}/4`;
  return '';
}

function pitchToAbc(pitch: string, acc: string | undefined, octStr: string | undefined): string {
  // 0=kleine -> "C,", 1=eingestrichene -> "C", 2=zweigestrichene -> "c", 3+ -> "c'..."
  const oct = octStr !== undefined ? parseInt(octStr, 10) : 1;
  let p: string;
  let octMark = '';
  if (oct <= 1) {
    p = pitch.toUpperCase();
    if (oct < 1) octMark = ','.repeat(1 - oct);
  } else {
    p = pitch.toLowerCase();
    if (oct > 2) octMark = "'".repeat(oct - 2);
  }
  let accidental = '';
  if (acc === '#') accidental = '^';
  else if (acc === '##') accidental = '^^';
  else if (acc === 'b') accidental = '_';
  else if (acc === 'bb') accidental = '__';
  else if (acc === '!') accidental = '=';
  return accidental + p + octMark;
}

const NOTE_RE = /^(\d+\.{0,2})?([a-gp])(##|#|bb|b|!)?(\d)?$/;
const TRIO_RE = /^trio(\d+\.{0,2})\((.+)\)$/;
const MULTIREST_RE = /^(\d+)x$/;

// Paren-aware: "trio8(g g b)" stays as one token.
export function tokenize(body: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth--; buf += ch; continue; }
    if (/\s/.test(ch) && depth === 0) {
      if (buf) { tokens.push(buf); buf = ''; }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

interface Atom {
  abc: string;
  units: number;
  isRest: boolean;
}

interface Item {
  abc: string;
  units: number;
  beamable: boolean;
}

function parseAtom(tok: string, durRef: { value: string | null }): Atom | null {
  const m = tok.match(NOTE_RE);
  if (!m) return null;
  const [, dur, pitch, acc, oct] = m;
  if (dur) durRef.value = dur;
  const duration = durRef.value || '4';
  const units = durToUnits(duration);
  if (units === null) return null;
  const isRest = pitch === 'p';
  const pAbc = isRest ? 'z' : pitchToAbc(pitch, acc, oct);
  return { abc: pAbc + abcDur(units), units, isRest };
}

function groupForBeaming(items: Item[], beatUnits: number): string {
  const out: string[] = [];
  let pos = 0;
  let group: string[] = [];
  const flush = () => {
    if (!group.length) return;
    out.push(group.length === 1 ? group[0] : group.join(''));
    group = [];
  };
  const EPS = 1e-6;
  for (const item of items) {
    if (!item.beamable) {
      flush();
      out.push(item.abc);
      pos += item.units;
      continue;
    }
    group.push(item.abc);
    pos += item.units;
    const distance = Math.abs(pos - Math.round(pos / beatUnits) * beatUnits);
    if (distance < EPS) flush();
  }
  flush();
  return out.join(' ');
}

function parseMeasureBody(body: string, errors: string[], label: string, beatUnits: number): string {
  const tokens = tokenize(body);
  const durRef = { value: null as string | null };
  const items: Item[] = [];

  for (const tok of tokens) {
    const trio = tok.match(TRIO_RE);
    if (trio) {
      const [, trioDur, inner] = trio;
      const saved = durRef.value;
      const innerRef = { value: trioDur };
      const innerOut: string[] = [];
      let innerUnits = 0;
      for (const it of inner.split(/\s+/).filter(Boolean)) {
        const a = parseAtom(it, innerRef);
        if (!a) errors.push(`${label}: cannot parse "${it}" in triplet`);
        else { innerOut.push(a.abc); innerUnits += a.units; }
      }
      items.push({ abc: '(3' + innerOut.join(''), units: innerUnits * 2 / 3, beamable: false });
      durRef.value = saved;
      continue;
    }
    if (tok.includes('_')) {
      const parts = tok.split('_');
      const partOut: string[] = [];
      let totalUnits = 0;
      for (const p of parts) {
        const a = parseAtom(p, durRef);
        if (!a) errors.push(`${label}: cannot parse "${p}"`);
        else { partOut.push(a.abc); totalUnits += a.units; }
      }
      items.push({ abc: partOut.join('-'), units: totalUnits, beamable: false });
      continue;
    }
    const a = parseAtom(tok, durRef);
    if (!a) errors.push(`${label}: cannot parse "${tok}"`);
    else items.push({ abc: a.abc, units: a.units, beamable: a.units < 2 && !a.isRest });
  }

  return groupForBeaming(items, beatUnits);
}

interface BarMarkers {
  leftBar?: string;
  rightBar?: string;
  voltaStart?: 1 | 2;
  body: string;
}

// Strip bar/volta marker tokens from the beginning and end of a measure line.
// Recognized prefixes: '|' (double bar), '|:' (start repeat), '[1' / '[2' (volta).
// Recognized suffixes: '|' (double bar), ':|' (end repeat), '|]' (final bar).
export function stripBarMarkers(line: string, errors: string[], label: string): BarMarkers {
  const toks = line.split(/\s+/).filter(Boolean);
  let leftBar: string | undefined;
  let voltaStart: 1 | 2 | undefined;
  let rightBar: string | undefined;

  while (toks.length > 0) {
    const t = toks[0];
    if (t === '|' || t === '|:') {
      const mapped = t === '|' ? '||' : '|:';
      if (leftBar) errors.push(`${label}: multiple opening bar markers`);
      else leftBar = mapped;
      toks.shift();
      continue;
    }
    const v = t.match(/^\[([12])$/);
    if (v) {
      if (voltaStart !== undefined) errors.push(`${label}: multiple volta markers`);
      else voltaStart = parseInt(v[1], 10) as 1 | 2;
      toks.shift();
      continue;
    }
    break;
  }

  while (toks.length > 0) {
    const t = toks[toks.length - 1];
    if (t === '|' || t === ':|' || t === '|]') {
      const mapped = t === '|' ? '||' : t;
      if (rightBar) {
        errors.push(`${label}: multiple closing bar markers`);
        break;
      }
      rightBar = mapped;
      toks.pop();
      continue;
    }
    break;
  }

  return { leftBar, rightBar, voltaStart, body: toks.join(' ') };
}

export function parseLines(text: string, beatUnits: number): { measures: MeasureInfo[]; errors: string[] } {
  const measures: MeasureInfo[] = [];
  const errors: string[] = [];
  const rawLines = text.split('\n');
  let measureIdx = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = rawLines[i].replace(/%.*$/, '').trim();
    if (!stripped) continue;
    measureIdx += 1;
    const label = `line ${i + 1} (measure ${measureIdx})`;
    const { leftBar, rightBar, voltaStart, body } = stripBarMarkers(stripped, errors, label);
    const mr = body.match(MULTIREST_RE);
    if (mr) {
      const n = parseInt(mr[1], 10);
      if (n < 1) {
        errors.push(`${label}: Nx requires N >= 1`);
        continue;
      }
      const start = measureIdx;
      const end = measureIdx + n - 1;
      const rangeLabel = n === 1 ? `m${start}` : `m${start}-m${end}`;
      measures.push({ label: rangeLabel, lineNumber: i + 1, abc: '', leftBar, rightBar, voltaStart, multiRest: n });
      measureIdx += n - 1;
      continue;
    }
    const abc = body ? parseMeasureBody(body, errors, label, beatUnits) : '';
    measures.push({ label: `m${measureIdx}`, lineNumber: i + 1, abc, leftBar, rightBar, voltaStart });
  }
  return { measures, errors };
}

export function beatUnitsFromMeter(meter: string): number {
  const m = meter.match(/^(\d+)\/(\d+)$/);
  if (!m) return 2;
  const num = parseInt(m[1], 10);
  const den = parseInt(m[2], 10);
  if (den === 8 && num % 3 === 0) return 3;
  return 8 / den;
}

export function toAbc(text: string, opts: ToAbcOptions = {}): ToAbcResult {
  const o = { title: 'Untitled', meter: '4/4', key: 'C', measuresPerLine: 4, ...opts };
  const beatUnits = beatUnitsFromMeter(o.meter);
  const { measures, errors } = parseLines(text, beatUnits);
  let abc = `X:1\nT:${o.title}\nM:${o.meter}\nL:1/8\nK:${o.key}\n`;
  if (measures.length > 0) {
    let body = '';
    if (measures[0].leftBar) body += measures[0].leftBar + ' ';
    for (let i = 0; i < measures.length; i++) {
      const m = measures[i];
      if (m.voltaStart) body += `[${m.voltaStart} `;
      body += m.multiRest ? `Z${m.multiRest}` : m.abc;
      const isLast = i === measures.length - 1;
      if (isLast) {
        body += ' ' + (m.rightBar || '|]');
      } else {
        const next = measures[i + 1];
        const sep = ((m.rightBar || '') + (next.leftBar || '')) || '|';
        body += ' ' + sep;
        body += (i + 1) % o.measuresPerLine === 0 ? '\n' : ' ';
      }
    }
    abc += body + '\n';
  }
  return { abc, measures, errors };
}
