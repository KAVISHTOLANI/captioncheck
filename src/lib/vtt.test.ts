import { describe, expect, it } from 'vitest';
import { activeCues, fix, formatTime, parse, parseTime } from './vtt';

describe('timestamps', () => {
  it('parses with and without hours, and detects commas', () => {
    expect(parseTime('00:01:02.500').value).toBe(62.5);
    expect(parseTime('01:02.5').value).toBe(62.5);
    expect(parseTime('00:00:01,200')).toEqual({ value: 1.2, comma: true });
    expect(parseTime('1:2:3').value).toBeNull();
    expect(parseTime('00:61:00.000').value).toBeNull();
    expect(formatTime(3723.04)).toBe('01:02:03.040');
  });
});

describe('validation', () => {
  it('accepts a clean file', () => {
    const p = parse('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello there.\n\n00:00:03.500 --> 00:00:05.000 align:start\nSecond line.');
    expect(p.problems).toEqual([]);
    expect(p.cues).toHaveLength(2);
    expect(p.cues[1].settings).toBe('align:start');
  });
  it('finds header, timing, comma, order, overlap, empty and length problems', () => {
    const src = ['00:00:01,000 --> 00:00:04,000', 'Comma times', '', 'a', '00:00:03.000 --> 00:00:06.000', 'Overlaps', '', 'a', '00:00:07.000 --> 00:00:06.000', 'Reversed', '', '00:00:09.000 --> 00:00:10.000', '', '', 'bad timing line', 'text', '', '00:00:11.000 --> 00:00:12.000', 'This line is definitely longer than forty-two characters wide'].join('\n');
    const msgs = parse(src).problems.map((p) => p.message);
    expect(msgs.some((m) => m.includes('WEBVTT'))).toBe(true);
    expect(msgs.some((m) => m.includes('comma'))).toBe(true);
    expect(msgs.some((m) => m.includes('Overlaps'))).toBe(true);
    expect(msgs.some((m) => m.includes('before or when'))).toBe(true);
    expect(msgs.some((m) => m.includes('also used'))).toBe(true);
    expect(msgs.some((m) => m.includes('Missing or malformed'))).toBe(true);
    expect(msgs.some((m) => m.includes('characters long'))).toBe(true);
    expect(msgs.some((m) => m.includes('characters per second'))).toBe(true);
  });
  it('keeps NOTE blocks and finds active cues', () => {
    const p = parse('WEBVTT\n\nNOTE made by hand\n\n00:00:01.000 --> 00:00:02.000\nHi');
    expect(p.extras).toEqual(['NOTE made by hand']);
    expect(activeCues(p.cues, 1.5)).toHaveLength(1);
    expect(activeCues(p.cues, 2)).toHaveLength(0);
  });
});

describe('fixing', () => {
  it('repairs what it can and reports the rest', () => {
    const src = '00:00:05,000 --> 00:00:07,000\nThird\n\nx\n00:00:01.000 --> 00:00:04.000\nFirst\n\nx\n00:00:03.000 --> 00:00:05.500\nSecond\n\n00:00:09.000 --> 00:00:08.000\nReversed\n\n00:00:10.000 --> 00:00:11.000\n\n\nnot a timing\ntext';
    const r = fix(parse(src));
    const p = parse(r.text);
    expect(r.text.startsWith('WEBVTT\n')).toBe(true);
    expect(p.problems.filter((x) => x.severity === 'error')).toEqual([]);
    expect(p.cues.map((c) => c.text)).toEqual(['First', 'Second', 'Third', 'Reversed']);
    expect(p.cues[0].end).toBe(3);
    expect(p.cues[1].end).toBe(5);
    expect(r.changes.join(' ')).toMatch(/Sorted/);
    expect(r.changes.join(' ')).toMatch(/Could not repair 1 cue/);
    expect(new Set(p.cues.filter((c) => c.id).map((c) => c.id)).size).toBe(p.cues.filter((c) => c.id).length);
  });
});
