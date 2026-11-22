import { useEffect, useMemo, useRef, useState } from 'react';
import { DemoTag, downloadText, EmptyState, Landing, NotFound, Notice, PageHead, readFileText, Shell, useFlash, usePersistentState, useRoute } from './shared/ui';
import { CLEAN_VTT, DEMO_VTT } from './lib/demo';
import { activeCues, fix, formatTime, MAX_CPS, MAX_LINE, parse, type Cue, type Problem } from './lib/vtt';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/check', label: 'Check captions' },
  { to: '/guide', label: 'WebVTT guide' },
];

export default function App() {
  const [route] = useRoute();
  let page;
  if (route === '/') page = <Home />;
  else if (route === '/check') page = <Check />;
  else if (route === '/guide') page = <Guide />;
  else page = <NotFound />;
  return (
    <Shell name="CaptionCheck" wordmark={['Caption', 'Check']} nav={NAV} route={route} cta={{ to: '/check', label: 'Check a file' }} footerNote="Caption files are checked in your browser and never uploaded.">
      {page}
    </Shell>
  );
}

function Timeline({ cues, problems, t, onSeek, selected, onSelect }: { cues: Cue[]; problems: Problem[]; t: number | null; onSeek?: (t: number) => void; selected?: number | null; onSelect?: (i: number) => void }) {
  const timed = cues.filter((c) => c.start != null && c.end != null);
  const total = Math.max(1, ...timed.map((c) => Math.max(c.start!, c.end!))) + 0.5;
  const lanes: number[] = [];
  const laneOf = new Map<number, number>();
  for (const c of [...timed].sort((a, b) => a.start! - b.start!)) {
    const s = Math.min(c.start!, c.end!), e = Math.max(c.start!, c.end!);
    let lane = lanes.findIndex((end) => end <= s);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = e;
    laneOf.set(c.index, lane);
  }
  const ticks = Array.from({ length: Math.floor(total / Math.max(1, Math.ceil(total / 10))) + 1 }, (_, i) => i * Math.max(1, Math.ceil(total / 10)));
  return (
    <div className="tl" onClick={(e) => { if (!onSeek) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * total); }}>
      <div className="tl-ticks" aria-hidden="true">{ticks.map((s) => <span key={s} style={{ left: `${(s / total) * 100}%` }}>{s}s</span>)}</div>
      <div className="tl-lanes" style={{ height: Math.max(1, lanes.length) * 34 + 6 }} role="list" aria-label="Caption timeline">
        {timed.map((c) => {
          const s = Math.min(c.start!, c.end!), e = Math.max(c.start!, c.end!);
          const sev = problems.filter((p) => p.cue === c.index);
          const cls = sev.some((p) => p.severity === 'error') ? 'err' : sev.length ? 'warn' : 'ok';
          return (
            <button key={c.index} type="button" role="listitem" className={`tl-cue ${cls} ${selected === c.index ? 'is-selected' : ''}`} style={{ left: `${(s / total) * 100}%`, width: `${Math.max(0.6, ((e - s) / total) * 100)}%`, top: (laneOf.get(c.index) ?? 0) * 34 + 3 }} onClick={(ev) => { ev.stopPropagation(); onSelect?.(c.index); onSeek?.(s + 0.01); }} title={`Cue ${c.index + 1}: ${formatTime(s)} → ${formatTime(e)}${sev.length ? ` · ${sev.length} issue(s)` : ''}`} aria-label={`Cue ${c.index + 1}, ${formatTime(s)} to ${formatTime(e)}, ${cls === 'ok' ? 'no issues' : `${sev.length} issue${sev.length === 1 ? '' : 's'}`}`}>
              <span>{c.text.split('\n')[0] || '(empty)'}</span>
            </button>
          );
        })}
        {t != null && <span className="tl-head" style={{ left: `${(t / total) * 100}%` }} aria-hidden="true" />}
      </div>
    </div>
  );
}

function Screen({ cues, t }: { cues: Cue[]; t: number }) {
  const active = activeCues(cues, t);
  return (
    <div className="screen" aria-live="polite">
      <span className="screen-time mono">{formatTime(t)}</span>
      <div className="captions">{active.map((c) => <p key={c.index}>{c.text.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</p>)}</div>
      {active.length > 1 && <span className="screen-warn">{active.length} captions on screen at once</span>}
    </div>
  );
}

function usePlayer(duration: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = (now: number) => {
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setT((x) => (x + dt >= duration ? (setPlaying(false), duration) : x + dt));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing, duration]);
  return { t, setT, playing, toggle: () => { if (t >= duration) setT(0); setPlaying(!playing); } };
}

function Home() {
  const p = parse(DEMO_VTT);
  return (
    <Landing
      compact
      eyebrow="Caption validation · WebVTT"
      title={<>Captions that are <em>valid, timed and readable.</em></>}
      lead="Paste or upload a .vtt file. CaptionCheck finds broken timestamps, reversed and overlapping cues, empty captions and lines that are too long or too fast to read — shows them on a timeline — and downloads a corrected file when the fix is safe."
      primary={{ href: '#/check', label: 'Check a caption file' }}
      secondary={{ href: '#/guide', label: 'WebVTT guide' }}
      previewLabel="Demo cooking clip · real timeline"
      meta={['WebVTT and SRT-style times', 'No upload', 'Demo file included']}
      preview={
        <div className="hero-cap">
          <div className="hc-summary"><strong>{p.problems.filter((x) => x.severity === 'error').length} errors</strong> · {p.problems.filter((x) => x.severity === 'warning').length} warnings · {p.cues.length} cues</div>
          <Timeline cues={p.cues} problems={p.problems} t={null} />
          <ul className="legend small"><li><i className="ok" />No issues</li><li><i className="warn" />Warning</li><li><i className="err" />Error</li></ul>
        </div>
      }
      steps={[
        { title: 'Load the file', body: 'Paste text or open a .vtt file. SRT-style commas are recognised.' },
        { title: 'Review problems', body: 'Every issue lists its line number and cue, and lights up on the timeline.' },
        { title: 'Preview & download', body: 'Play the captions over time, then download a corrected file with a change log.' },
      ]}
      features={[
        { title: 'Timing checks', body: 'Malformed or reversed times, overlaps, out-of-order cues and zero-length cues.' },
        { title: 'Readability', body: `Lines over ${MAX_LINE} characters, more than two lines, and reading speeds over ${MAX_CPS} characters per second.` },
        { title: 'Safe auto-fix', body: 'Adds the header, fixes commas, swaps reversed times, trims overlaps, sorts, removes empty cues.' },
        { title: 'Honest about limits', body: 'Problems that need a human — long lines, fast reading, unreadable timings — are listed, not hidden.' },
      ]}
      note="CaptionCheck validates structure and timing. It doesn’t check spelling, speaker labels, or whether captions match the audio."
      closing={{ title: <>Fix your <em>next caption file.</em></>, action: { href: '#/check', label: 'Check a caption file' } }}
    />
  );
}

function Check() {
  const [text, setText] = usePersistentState('captioncheck:text', DEMO_VTT);
  const [name, setName] = usePersistentState('captioncheck:name', 'demo-tomato-soup.vtt');
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [showFixed, setShowFixed] = useState(false);
  const [flash, setFlash] = useFlash(6000);
  const parsed = useMemo(() => parse(text), [text]);
  const fixed = useMemo(() => fix(parsed), [parsed]);
  const duration = Math.max(1, ...parsed.cues.filter((c) => c.end != null).map((c) => Math.max(c.end!, c.start ?? 0)));
  const player = usePlayer(duration);
  const errors = parsed.problems.filter((p) => p.severity === 'error').length;
  const warnings = parsed.problems.length - errors;
  const fixable = parsed.problems.filter((p) => p.fixable).length;
  const shown = parsed.problems.filter((p) => (filter === 'all' || p.severity === filter) && (selected == null || p.cue === selected));

  async function onFile(f?: File) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setFlash({ kind: 'error', text: `${f.name} is over 2 MB — caption files are usually much smaller.` });
    const t = await readFileText(f);
    setText(t);
    setName(f.name);
    setSelected(null);
    setFlash({ kind: 'success', text: `Loaded ${f.name}.` });
  }
  function download() {
    const out = name.replace(/\.(vtt|srt|txt)$/i, '') + (fixable ? '-fixed' : '') + '.vtt';
    downloadText(out, fixed.text, 'text/vtt');
    setFlash({ kind: 'success', text: `Downloaded ${out}.${fixed.remaining.length ? ` ${fixed.remaining.length} issue(s) still need a manual edit.` : ''}` });
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow={<>Workspace · Check {text === DEMO_VTT && <DemoTag />}</>}
        title={<em>{name}</em>}
        description={text.trim() ? `${parsed.cues.length} cues · ${errors} error${errors === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${fixable} can be fixed automatically` : 'No captions loaded'}
        actions={
          <>
            <input id="vtt" type="file" accept=".vtt,.srt,.txt,text/vtt" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            <label htmlFor="vtt" className="btn">Open file</label>
            <button type="button" className="btn" onClick={() => { setText(DEMO_VTT); setName('demo-tomato-soup.vtt'); }}>Demo: problems</button>
            <button type="button" className="btn" onClick={() => { setText(CLEAN_VTT); setName('demo-clean.vtt'); }}>Demo: clean</button>
            <button type="button" className="btn btn-primary" onClick={download} disabled={!parsed.cues.length}>{fixable ? 'Download fixed .vtt' : 'Download .vtt'}</button>
          </>
        }
      />
      {flash && <Notice kind={flash.kind} onDismiss={() => setFlash(null)}>{flash.text}</Notice>}
      {!text.trim() ? (
        <div className="stack">
          <EmptyState title="Paste or open a caption file" actions={<button type="button" className="btn btn-primary" onClick={() => setText(DEMO_VTT)}>Load the demo file</button>}>Start with WEBVTT, then cues separated by blank lines.</EmptyState>
          <textarea aria-label="Caption text" className="code" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello!'} />
        </div>
      ) : (
        <>
          <section className="card stack" aria-labelledby="tl-title">
            <div className="card-title-row">
              <h2 id="tl-title">Timeline &amp; preview</h2>
              <div className="row">
                <button type="button" className="btn btn-sm btn-primary" onClick={player.toggle}>{player.playing ? 'Pause' : 'Play'}</button>
                <ul className="legend small"><li><i className="ok" />OK</li><li><i className="warn" />Warning</li><li><i className="err" />Error</li></ul>
              </div>
            </div>
            <Screen cues={parsed.cues} t={player.t} />
            <Timeline cues={parsed.cues} problems={parsed.problems} t={player.t} onSeek={(x) => player.setT(Math.max(0, Math.min(duration, x)))} selected={selected} onSelect={(i) => setSelected(selected === i ? null : i)} />
            <p className="hint">Click the timeline to jump; click a cue to filter its problems. Cues stacked on separate rows overlap in time.</p>
          </section>
          <div className="cap-grid">
            <section className="card stack" aria-labelledby="src-title">
              <div className="card-title-row">
                <h2 id="src-title">{showFixed ? 'Corrected file' : 'Original'}</h2>
                <div className="seg" role="radiogroup" aria-label="Show">
                  <button type="button" role="radio" aria-checked={!showFixed} onClick={() => setShowFixed(false)}>Original</button>
                  <button type="button" role="radio" aria-checked={showFixed} onClick={() => setShowFixed(true)}>Corrected</button>
                </div>
              </div>
              {showFixed ? (
                <>
                  <ul className="log">{fixed.changes.length ? fixed.changes.map((c) => <li key={c}>{c}</li>) : <li>No automatic changes were needed.</li>}</ul>
                  <pre className="output" data-testid="fixed">{fixed.text}</pre>
                </>
              ) : (
                <textarea aria-label="Caption text" className="code" rows={20} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
              )}
            </section>
            <section className="card" aria-labelledby="prob-title">
              <div className="card-title-row">
                <h2 id="prob-title">Problems</h2>
                <div className="seg" role="radiogroup" aria-label="Severity">
                  <button type="button" role="radio" aria-checked={filter === 'all'} onClick={() => setFilter('all')}>All {parsed.problems.length}</button>
                  <button type="button" role="radio" aria-checked={filter === 'error'} onClick={() => setFilter('error')}>Errors {errors}</button>
                  <button type="button" role="radio" aria-checked={filter === 'warning'} onClick={() => setFilter('warning')}>Warnings {warnings}</button>
                </div>
              </div>
              {selected != null && <p className="small">Showing cue {selected + 1} only. <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>Show all</button></p>}
              {parsed.problems.length === 0 ? (
                <Notice kind="success">No problems found — this file is valid WebVTT with readable timing.</Notice>
              ) : shown.length === 0 ? (
                <p className="muted">Nothing matches this filter.</p>
              ) : (
                <ul className="problems">
                  {shown.map((p, k) => (
                    <li key={k} className={`prob prob-${p.severity}`}>
                      <span className="mono small">Line {p.line}{p.cue != null ? ` · cue ${p.cue + 1}` : ''}</span>
                      <span>{p.message}</span>
                      <span className={`badge ${p.fixable ? 'badge-ok' : ''}`}>{p.fixable ? 'Auto-fixable' : 'Needs manual edit'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {fixed.remaining.length > 0 && parsed.problems.length > 0 && <p className="hint">After automatic fixes, {fixed.remaining.length} issue(s) would remain (mostly readability warnings).</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Guide() {
  return (
    <div className="stack narrow">
      <PageHead eyebrow="Reference" title={<>WebVTT <em>in brief</em></>} description="What a valid file looks like, and the readability guidelines CaptionCheck uses." />
      <div className="card prose">
        <pre className="output">{`WEBVTT

NOTE Comments start with NOTE and are kept.

intro
00:00:01.000 --> 00:00:03.500 align:center
Hello, and welcome.

00:00:04.000 --> 00:00:06.000
A cue can have
up to two lines.`}</pre>
        <h2>Rules</h2>
        <ul>
          <li>The first line must be <code>WEBVTT</code>.</li>
          <li>Cues are separated by a blank line. An optional identifier comes before the timing line.</li>
          <li>Times are <code>HH:MM:SS.mmm</code> (hours optional) with a <strong>full stop</strong> — SubRip (.srt) uses a comma.</li>
          <li>The end time must be after the start time.</li>
        </ul>
        <h2>Readability guidelines (warnings)</h2>
        <ul>
          <li>At most {MAX_LINE} characters per line and two lines per cue.</li>
          <li>At most {MAX_CPS} characters per second of display time.</li>
          <li>Cues shouldn’t overlap unless you mean to show two speakers at once.</li>
        </ul>
        <p className="muted">Guidelines vary between broadcasters and platforms; these are common defaults, not a standard.</p>
      </div>
    </div>
  );
}
