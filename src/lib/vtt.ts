export interface Cue {
  index: number; // position in the file
  id: string | null;
  start: number | null; // seconds
  end: number | null;
  settings: string;
  text: string;
  line: number; // line number of the timing line
  rawTiming: string;
}

export type Severity = 'error' | 'warning';
export interface Problem {
  severity: Severity;
  cue: number | null; // cue index, null for file-level
  line: number;
  message: string;
  fixable: boolean;
}

const TS = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)[.,](\d{1,3})$/;

export function parseTime(s: string): { value: number | null; comma: boolean } {
  const m = TS.exec(s.trim());
  if (!m) return { value: null, comma: false };
  const [, h, mm, ss, ms] = m;
  return { value: Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, '0')) / 1000, comma: s.includes(',') };
}

export function formatTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

export interface Parsed {
  hasHeader: boolean;
  cues: Cue[];
  extras: string[]; // NOTE / STYLE / REGION blocks, kept as-is
  problems: Problem[];
}

export const MAX_LINE = 42;
export const MAX_CPS = 20;

export function parse(text: string): Parsed {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const problems: Problem[] = [];
  const hasHeader = /^WEBVTT(\s|$)/.test(lines[0] ?? '');
  if (!hasHeader) problems.push({ severity: 'error', cue: null, line: 1, message: 'The file must start with “WEBVTT”.', fixable: true });
  const cues: Cue[] = [];
  const extras: string[] = [];
  let i = hasHeader ? 1 : 0;
  // skip header metadata until first blank line
  if (hasHeader) while (i < lines.length && lines[i].trim() !== '') i++;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;
    const blockStart = i;
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
    if (/^(NOTE|STYLE|REGION)\b/.test(block[0])) {
      extras.push(block.join('\n'));
      continue;
    }
    let id: string | null = null;
    let t = 0;
    if (!block[0].includes('-->')) {
      id = block[0].trim();
      t = 1;
    }
    const timing = block[t] ?? '';
    const lineNo = blockStart + t + 1;
    const m = timing.match(/^\s*(\S+)\s+-->\s+(\S+)(.*)$/);
    const index = cues.length;
    if (!m) {
      problems.push({ severity: 'error', cue: index, line: lineNo, message: `Missing or malformed timing line${timing ? `: “${timing.trim()}”` : ''}. Expected “00:00:01.000 --> 00:00:03.000”.`, fixable: false });
      cues.push({ index, id, start: null, end: null, settings: '', text: block.slice(t + 1).join('\n'), line: lineNo, rawTiming: timing });
      continue;
    }
    const a = parseTime(m[1]), b = parseTime(m[2]);
    if (a.value == null) problems.push({ severity: 'error', cue: index, line: lineNo, message: `Invalid start time “${m[1]}”.`, fixable: false });
    if (b.value == null) problems.push({ severity: 'error', cue: index, line: lineNo, message: `Invalid end time “${m[2]}”.`, fixable: false });
    if (a.comma || b.comma) problems.push({ severity: 'error', cue: index, line: lineNo, message: 'Times use a comma before the milliseconds (SubRip style). WebVTT needs a full stop.', fixable: true });
    const cueText = block.slice(t + 1).join('\n');
    cues.push({ index, id, start: a.value, end: b.value, settings: m[3].trim(), text: cueText, line: lineNo, rawTiming: timing });
  }

  const ids = new Map<string, number>();
  for (const c of cues) {
    if (c.id) {
      if (ids.has(c.id)) problems.push({ severity: 'warning', cue: c.index, line: c.line - 1, message: `Cue id “${c.id}” is also used by an earlier cue.`, fixable: true });
      ids.set(c.id, c.index);
    }
    if (!c.text.trim()) problems.push({ severity: 'error', cue: c.index, line: c.line, message: 'This cue has no text.', fixable: true });
    if (c.start != null && c.end != null) {
      if (c.end <= c.start) problems.push({ severity: 'error', cue: c.index, line: c.line, message: `The cue ends (${formatTime(c.end)}) before or when it starts (${formatTime(c.start)}).`, fixable: c.end < c.start });
      else {
        const chars = c.text.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').length;
        const cps = chars / (c.end - c.start);
        if (cps > MAX_CPS) problems.push({ severity: 'warning', cue: c.index, line: c.line, message: `Reading speed is ${cps.toFixed(0)} characters per second (aim for ${MAX_CPS} or fewer).`, fixable: false });
      }
    }
    c.text.split('\n').forEach((l) => {
      const len = l.replace(/<[^>]+>/g, '').length;
      if (len > MAX_LINE) problems.push({ severity: 'warning', cue: c.index, line: c.line, message: `A line is ${len} characters long (aim for ${MAX_LINE} or fewer).`, fixable: false });
    });
    if (c.text.split('\n').length > 2) problems.push({ severity: 'warning', cue: c.index, line: c.line, message: 'More than two lines of text on screen at once.', fixable: false });
  }
  const timed = cues.filter((c) => c.start != null && c.end != null && c.end > c.start);
  for (let k = 1; k < timed.length; k++) {
    const p = timed[k - 1], c = timed[k];
    if (c.start! < p.start!) problems.push({ severity: 'warning', cue: c.index, line: c.line, message: 'This cue starts earlier than the one before it (out of order).', fixable: true });
    else if (c.start! < p.end!) problems.push({ severity: 'warning', cue: c.index, line: c.line, message: `Overlaps the previous cue by ${(p.end! - c.start!).toFixed(3)} s.`, fixable: true });
  }
  return { hasHeader, cues, extras, problems };
}

export interface FixResult {
  text: string;
  changes: string[];
  remaining: Problem[];
}

/** Applies safe automatic fixes and serialises a clean WebVTT file. */
export function fix(parsed: Parsed): FixResult {
  const changes: string[] = [];
  if (!parsed.hasHeader) changes.push('Added the WEBVTT header.');
  if (parsed.problems.some((p) => p.message.includes('comma'))) changes.push('Replaced commas with full stops in timestamps.');
  let cues = parsed.cues.filter((c) => c.start != null && c.end != null).map((c) => ({ ...c }));
  const dropped = parsed.cues.length - cues.length;
  for (const c of cues)
    if (c.end! < c.start!) {
      [c.start, c.end] = [c.end, c.start];
      changes.push(`Swapped reversed start/end times in cue ${c.index + 1}.`);
    }
  const before = cues.length;
  cues = cues.filter((c) => c.text.trim() && c.end! > c.start!);
  if (before - cues.length) changes.push(`Removed ${before - cues.length} empty or zero-length cue(s).`);
  const ordered = [...cues].sort((a, b) => a.start! - b.start! || a.end! - b.end!);
  if (ordered.some((c, k) => c !== cues[k])) changes.push('Sorted cues by start time.');
  cues = ordered;
  for (let k = 1; k < cues.length; k++)
    if (cues[k].start! < cues[k - 1].end!) {
      changes.push(`Trimmed cue ${cues[k - 1].index + 1} to end when cue ${cues[k].index + 1} starts.`);
      cues[k - 1].end = cues[k].start;
    }
  const seen = new Set<string>();
  let renamed = 0;
  for (const c of cues)
    if (c.id) {
      if (seen.has(c.id)) {
        c.id = `${c.id}-${c.index + 1}`;
        renamed++;
      }
      seen.add(c.id);
    }
  if (renamed) changes.push(`Renamed ${renamed} duplicate cue id(s).`);
  const out = ['WEBVTT', ''];
  for (const e of parsed.extras) out.push(e, '');
  for (const c of cues) {
    if (c.id) out.push(c.id);
    out.push(`${formatTime(c.start!)} --> ${formatTime(c.end!)}${c.settings ? ' ' + c.settings : ''}`, c.text, '');
  }
  const text = out.join('\n');
  const remaining = parse(text).problems;
  if (dropped) changes.push(`Could not repair ${dropped} cue(s) with unreadable timing — they were left out. Check the original lines.`);
  return { text, changes, remaining };
}

export function activeCues(cues: Cue[], t: number) {
  return cues.filter((c) => c.start != null && c.end != null && t >= c.start && t < c.end);
}
