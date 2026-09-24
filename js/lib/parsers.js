// PhiAI-Player || Chart/file parsers (PEC / PCMY / info / LRC) and math helpers
function tripleToBeat(t) { return t[0] + (t[2] ? t[1] / t[2] : 0); }

function parsePEC(text) {
  const rawLines = String(text || '').split(/\r?\n/).map(s => s.trim());
  const chart = { BPMList: [], judgeLineList: [] };
  let lineData = [];
  let idx = 0;
  if (rawLines.length && /^-?\d+$/.test(rawLines[0])) {
    chart.offset = parseInt(rawLines[0], 10) - 150;
    idx = 1;
  }
  const chAt = (arr, i) => (arr[i] = arr[i] || { speed: [], moveX: [], moveY: [], rotate: [], alpha: [], notes: [] });
  const toX = (x) => (parseFloat(x) - 1024) * 1350 / 2048;
  const toY = (y) => (parseFloat(y) - 700) * 450 / 700;
  const toA = (v) => { const a = parseInt(v, 10); return isNaN(a) ? 255 : (a < 0 ? 0 : Math.min(255, a)); };
  // The PEC timeline unit is the beat; beat -> seconds must rely on the BPM carried by bp events;
  // prescan every bp event to build BPMList, using the first BPM as the conversion base for line speed (cv)
  let bpm0 = 120;
  {
    const bpmList = [];
    for (const l of rawLines) {
      if (!l.startsWith('bp')) continue;
      const bp = l.split(/\s+/);
      if (bp.length < 3) continue;
      const bpm = parseFloat(bp[2]);
      if (bpm > 0) bpmList.push({ bpm, startTime: [parseFloat(bp[1]) || 0, 0, 1] });
    }
    bpmList.sort((a, b) => a.startTime[0] - b.startTime[0]);
    if (bpmList.length) { chart.BPMList = bpmList; bpm0 = bpmList[0].bpm; }
  }
  // PEC cv line speed (official-chart Y/s scale) converted to the internal slope per beat:
  // official chart: 1Y = 540px (900px screen), beat -> seconds = 60/bpm, internal dist = slope * beatDelta * baseSpeed(40)
  // => slope = cv * 540*60 / (40*7.7) / bpm = cv * 105.19 / bpm
  const pecSpeed = (vs) => (isNaN(vs) ? 5.85 : vs) * 105.19 / bpm0;
  for (let i = idx; i < rawLines.length; i++) {
    const s = rawLines[i];
    if (!s) continue;
    const p = s.split(/\s+/);
    const tag = p[0];
    if (tag === 'bp') {
      // bp events were already prescanned above to build BPMList
    } else if (tag === 'cv' || tag === 'cp' || tag === 'cd' || tag === 'ca') {
      const E = chAt(lineData, parseInt(p[1], 10));
      const bt = parseFloat(p[2]) || 0;
      if (tag === 'cv') { const v = pecSpeed(parseFloat(p[3])); E.speed.push({ ts: bt, te: bt, end: v, inst: true, easingType: 1 }); }
      else if (tag === 'cp') { const x = toX(p[3]), y = toY(p[4]); E.moveX.push({ ts: bt, te: bt, end: x, inst: true, easingType: 1 }); E.moveY.push({ ts: bt, te: bt, end: y, inst: true, easingType: 1 }); }
      else if (tag === 'cd') { const r = parseFloat(p[3]) || 0; E.rotate.push({ ts: bt, te: bt, end: r, inst: true, easingType: 1 }); }
      else if (tag === 'ca') { const a = toA(p[3]); E.alpha.push({ ts: bt, te: bt, end: a, inst: true, easingType: 1 }); }
    } else if (tag === 'cm' || tag === 'cr' || tag === 'cf') {
      const E = chAt(lineData, parseInt(p[1], 10));
      const b0 = parseFloat(p[2]) || 0, b1 = parseFloat(p[3]) || 0;
      if (tag === 'cm') {
        const x = toX(p[4]), y = toY(p[5]);
        const et = parseInt(p[6], 10) || 1;
        E.moveX.push({ ts: b0, te: b1, end: x, inst: false, easingType: et });
        E.moveY.push({ ts: b0, te: b1, end: y, inst: false, easingType: et });
      } else if (tag === 'cr') { const et = parseInt(p[5], 10) || 1; E.rotate.push({ ts: b0, te: b1, end: parseFloat(p[4]) || 0, inst: false, easingType: et }); }
      else if (tag === 'cf') { E.alpha.push({ ts: b0, te: b1, end: toA(p[4]), inst: false, easingType: 1 }); }
    } else if (tag === 'n1' || tag === 'n2' || tag === 'n3' || tag === 'n4') {
      const E = chAt(lineData, parseInt(p[1], 10));
      const isHold = tag === 'n2';
      let speed = 1, width = 1;
      const lastTok = p[p.length - 1];
      if (p[p.length - 2] === '#') { speed = parseFloat(lastTok) || 1; }
      else if (p[p.length - 2] === '&') { width = parseFloat(lastTok) || 1; }
      else if (/^#[-+.\d]/.test(lastTok) && p.length >= 7) { speed = parseFloat(lastTok.slice(1)) || 1; }
      else if (/^&[-+.\d]/.test(lastTok) && p.length >= 7) { width = parseFloat(lastTok.slice(1)) || 1; }
      for (let j = i + 1; j < rawLines.length; j++) {
        const c = rawLines[j];
        if (!c) continue;
        if (c.charAt(0) === '#') { speed = parseFloat(c.slice(1)) || 1; i = j; }
        else if (c.charAt(0) === '&') { width = parseFloat(c.slice(1)) || 1; i = j; }
        else break;
      }
      const st = parseFloat(p[2]) || 0;
      const et = isHold ? ((parseFloat(p[3]) || 0) || st) : st;
      const nx = parseFloat(p[isHold ? 4 : 3]);
      const x = (isNaN(nx) ? 0 : nx) * 675 / 1024;
      const fromBelow = parseInt(p[isHold ? 5 : 4], 10);
      const isFake = parseInt(p[isHold ? 6 : 5], 10) === 1 ? 1 : 0;
      E.notes.push({
        type: { n1: 1, n2: 2, n3: 3, n4: 4 }[tag],
        startTime: [st, 0, 1],
        endTime: [et, 0, 1],
        positionX: x,
        above: (fromBelow === 2 || fromBelow === 0) ? 0 : 1,
        speed: speed,
        size: width,
        isFake: isFake,
      });
    }
  }
  if (!chart.BPMList.length) chart.BPMList.push({ bpm: 120, startTime: [0, 0, 1] }); // PEC falls back to 120bpm when no bp event exists
  const fill = (events, def) => {
    if (!events.length) return [];
    events.sort((a, b) => a.ts - b.ts);
    let curV = def;
    const out = [];
    for (const e of events) {
      const te = e.inst ? e.ts + 1e-9 : e.te;
      const s = e.inst ? e.end : curV;
      curV = e.end;
      out.push({ startTime: [e.ts, 0, 1], endTime: [te, 0, 1], start: s, end: e.end, easingType: e.easingType, easingLeft: 0, easingRight: 1 });
    }
    return out;
  };
  chart.judgeLineList = lineData.map((E, li) => ({
    name: 'Line' + li,
    eventLayers: [{
      speedEvents: fill(E.speed, 1),
      moveXEvents: fill(E.moveX, 0),
      moveYEvents: fill(E.moveY, 0),
      rotateEvents: fill(E.rotate, 0),
      alphaEvents: fill(E.alpha, 255),
    }],
    notes: E.notes,
  }));
  chart.__fmt = 'pec';
  return chart;
}

// ============ PCMY chart parsing ============
// Reverse-engineered from the sample files provided under /PCMY (sample: 1.pcmy)
// Structure: [segment0, segment1, ...] ; each segment = 4 beats ; /time_X:paramString)mode
// Easing table derived from the format spec (section 8): common easing names are reused, not verified against the original tool, corrections welcome
const PCMY_EASING = {
  11: 1,   // linear
  12: 6,   // easeInOutSine (the spec treats it as linear; mapped to the closest match here)
  13: 1,   // unknown -> linear
  21: 19,  // circOut
  22: 4,   // quadOut
  23: 7,   // quadInOut
  31: 15,  // quintIn
  32: 8,   // cubicOut
  33: 12,  // cubicInOut
  41: 2,   // sineIn
  42: 3,   // sineOut
  43: 6,   // sineInOut
};
const PCMY_EASING_IDS = new Set([11,12,13,21,22,23,31,32,33,41,42,43]);
function pcmFindEase(p) {
  for (let i = p.length - 1; i >= 0; i--) {
    const v = parseInt(p[i], 10);
    if (!isNaN(v) && PCMY_EASING_IDS.has(v)) return PCMY_EASING[v] || 1;
  }
  return 4;
}

// Position / flow-speed mapping constants (tunable for the whole PCMY renderer)
// PCMY_SCALE derived per spec section 9.3: mx = quantile(|X|, 0.99) ~= 8, my = quantile(|Y|, 0.99) ~= 22.9, pad ~= 1.1,
//   SC = min(CW/(mx*2*pad), CH/(my*2*pad)); canvas 1350x900 -> SC = min(76.7, 17.9) ~= 17.9
//   (the earlier value 54 was a guess and made the line sweep wildly across the canvas)
const PCMY_SCALE = parseFloat(window && window.__PCMY_SCALE) || 17.9;      // Event X unit -> pixels (+/-8 -> +/-143px)
// ===== PCMY flow rate vs playback speed (two separate concepts) =====
// Flow rate: 'Flow rate unit' = 14.7 is only metadata in 1.txt; the spec defines no mapping from it to fall speed, so it does not affect rendering.
// Fall speed: RPE fall speed = speedEvents x 40 (base) x note.speed x flowSpeed (UI). The '1.0x look' corresponds to 9.8.
// Playback speed: a PCMY chart property (spec section 10.1 confirms the default 0.5). Parsed by parsePCMY into chart.playbackSpeed;
//            it scales the track/note animation rate (speedEvents value = 1.0x base x that speed), does not change the music, and is not UI playSpeed.
const PCMY_SPEED_1X = (typeof window !== 'undefined' && Number(window.__PCMY_SPEED_1X)) || 9.8; // Fall-speed base px/beat at 1.0x playback speed
const PCMY_PLAYBACK = (typeof window !== 'undefined' && Number(window.__PCMY_PLAYBACK)) || 0.5; // PCMY chart 'playback speed' default (spec section 10.1)

function parsePCMY(text, meta) {
  const body = String(text || '').trim();
  const inner = body.replace(/^\[/, '').replace(/\]\s*$/, '');
  const segs = inner.split(',');
  const events = [];
  const EV_RE = /\/(-?[0-9.]+)_(-?[0-9.]+):([^)]*)\)([0-9.]+)/g;
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si].trim();
    if (!s) continue;
    EV_RE.lastIndex = 0;
    let m;
    while ((m = EV_RE.exec(s)) !== null) {
      events.push({ beat: si * 4 + parseFloat(m[1]), x: parseFloat(m[2]), p: m[3].split('?'), mode: m[4] });
    }
  }
  events.sort((a, b) => a.beat - b.beat);
  const baseBPM = (meta && Number(meta.BPM) > 0) ? Number(meta.BPM) : 180;
  const bpmList = [{ bpm: baseBPM, startTime: [0, 0, 1] }];
  for (const e of events) {
    if (e.mode !== '8') continue;
    const r = parseFloat(e.p[1]);
    bpmList.push({ bpm: baseBPM * (r && r > 0 ? r : 1), startTime: [e.beat, 0, 1] });
  }
  // PCMY chart 'playback speed' (spec section 10.1 confirms the default 0.5; overridable via a metadata key) -- track/note animation rate, does not change the music, not UI playSpeed
  const _pbRaw = meta ? (meta['Playback speed'] ?? meta['Playback Speed'] ?? meta['playbackSpeed'] ?? meta['倍速']) : undefined;
  const pb = (_pbRaw != null && Number(_pbRaw) > 0) ? Number(_pbRaw) : PCMY_PLAYBACK;
  const chart = { __fmt: 'pcmy', BPMList: bpmList, META: {}, playbackSpeed: pb, judgeLineList: [] };
  if (meta) {
    chart.META.name = meta.Name;
    chart.META.composer = meta.Composer;
    chart.META.charter = meta.Score;
    chart.META.level = meta.level ?? '';
    chart.META.song = meta.Audio;
    chart.META.background = meta.Image;
    chart.META.bpm = baseBPM;
    chart.META.playbackSpeed = pb;
  }
  // Offset (ms) lives at the top level of jsonData, matching RPE chart offset semantics (loadChart uses meta.offset ?? jsonData.offset)
  if (meta && meta.Delay != null) chart.offset = (Number(meta.Delay) || 0) * 1000;
  const pcmLineRoles = { '5': 'deco', '6': 'judge', '7': 'bind' };
  const evt = (ts, te, start, end, easing) => ({ startTime: [ts, 0, 1], endTime: [te, 0, 1], start, end, easingType: easing, easingLeft: 0, easingRight: 1 });
  let lineNameIdx = 0;
  const lines = [];
  const untyped = [];
  for (const e of events) {
    if (e.mode === '1' || e.mode === '2' || e.mode === '3' || e.mode === '8' || e.mode === '4') continue;
    const kind = pcmLineRoles[e.mode];
    if (!kind) { untyped.push(e.mode); continue; }   // Undetermined events such as 10.5/11/11.25/11.5/12/13/14/16/17 do not create lines
    const dur = parseFloat(e.p[0]);
    const start = Math.max(0, e.beat);
    const end = start + (isNaN(dur) ? 1 : Math.max(0, dur));
    const a0 = parseFloat(e.p[1]) || 0;
    const a1 = e.mode === '7' ? a0 : (parseFloat(e.p[2]) || 0);
    const ease = pcmFindEase(e.p);
    const J = {
      alphaEvents: [
        ...(start > 0 ? [evt(0, start - 1e-9, 0, 0, 1)] : []),
        evt(start, start + 1e-6, 255, 255, 1),
        evt(end, end + 1e-6, 0, 0, 1),
      ],
      moveXEvents: [evt(0, end, e.x * PCMY_SCALE, e.x * PCMY_SCALE, 1)],
      moveYEvents: [evt(0, end, 0, 0, 1)],
      rotateEvents: [evt(start, end, a0, a1, ease)],
      speedEvents: [{ startTime: [0, 0, 1], endTime: [end, 0, 1], start: chart.playbackSpeed, end: chart.playbackSpeed, easingType: 1, easingLeft: 0, easingRight: 1 }],
    };
    lines.push({ line: { name: (kind === 'judge' ? 'L' : kind === 'deco' ? 'D' : 'B') + lineNameIdx++, eventLayers: [J], notes: [] }, ev: e, kind, beat: e.beat, x: e.x, start, end });
  }
  for (const e of events) {
    if (!(e.mode === '1' || e.mode === '2' || e.mode === '3')) continue;
    const isPerform = e.mode === '2';
    const sp = parseFloat(e.p[0]);
    const speed = (!isNaN(sp) && sp) ? Math.abs(sp) : 1;
    let best = null, bestD = Infinity;
    for (const L of lines) {
      if (L.kind === 'bind') continue;   // Notes bound to a line carry no hittable notes
      if (L.beat <= e.beat && e.beat < L.end) {
        const d = Math.abs(L.x - e.x);
        if (d < bestD) { bestD = d; best = L; }
      }
    }
    if (!best) {
      for (const L of lines) {
        if (L.kind === 'bind') continue;
        const d = Math.abs(L.beat - e.beat);
        if (d < bestD) { bestD = d; best = L; }
      }
    }
    if (best) {
      best.line.notes.push({
        type: isPerform ? 4 : 1,
        startTime: [e.beat, 0, 1],
        endTime: [e.beat, 0, 1],
        positionX: 0,
        above: 1,
        speed: speed * chart.playbackSpeed,
        size: 1,
        isFake: isPerform ? 1 : 0,
      });
    }
  }
  for (const L of lines) chart.judgeLineList.push(L.line);
  if (untyped.length) console.warn('[pcmy] 未定性 mode 事件未渲染:', untyped.join(','));
  return chart;
}

async function parsePECStreamed(blob, onStatus) {
  const BUCKET_MAX = 20000;
  const CHUNK = 8 * 1024 * 1024;
  const toX = (x) => (parseFloat(x) - 1024) * 1350 / 2048;
  const toY = (y) => (parseFloat(y) - 700) * 450 / 700;
  const toA = (v) => { const a = parseInt(v, 10); return isNaN(a) ? 255 : (a < 0 ? 0 : Math.min(255, a)); };
  const chart = { BPMList: [], judgeLineList: [] };
  const lineData = [];
  const chAt = (arr, i) => (arr[i] = arr[i] || { speed: [], moveX: [], moveY: [], rotate: [], alpha: [], notes: [] });
  let bpm0 = 120;
  // PEC cv line speed (official-chart Y/s scale) converted to the internal slope per beat (same as parsePEC)
  const pecSpeed = (vs) => (isNaN(vs) ? 5.85 : vs) * 105.19 / bpm0;
  let totalNotes = 0, totalFake = 0, maxBeat = 0, maxEndSec = 0;
  const buckets = [];
  let curBucket = null;
  let curByte = 0;
  const closeBucket = () => {
    if (curBucket) { curBucket.be = curByte; if (curBucket.count) buckets.push(curBucket); curBucket = null; }
  };
  const dec = new TextDecoder('utf-8');
  let pending = '';
  const size = blob.size;
  const handleNote = (lane, tag, st, et, isFake) => {
    if (!curBucket) curBucket = { t0: st, t1: st, bs: curByte, be: 0, count: 0 };
    if (curBucket.count >= BUCKET_MAX) { closeBucket(); curBucket = { t0: st, t1: st, bs: curByte, be: 0, count: 0 }; }
    curBucket.count++;
    if (st < curBucket.t0) curBucket.t0 = st;
    if (st > curBucket.t1) curBucket.t1 = st;
    if (et > maxBeat) maxBeat = et;
    if (et > maxEndSec) maxEndSec = et;
    totalNotes++;
    if (isFake) totalFake++;
  };
  const handleHeader = (s) => {
    const p = s.split(/\s+/);
    const tag = p[0];
    if (tag === 'bp') { const bpm = parseFloat(p[2]); if (bpm > 0) { if (!chart.BPMList.length) bpm0 = bpm; chart.BPMList.push({ bpm, startTime: [parseFloat(p[1]) || 0, 0, 1] }); } }
    else if (tag === 'cv' || tag === 'cp' || tag === 'cd' || tag === 'ca') {
      const E = chAt(lineData, parseInt(p[1], 10));
      const bt = (parseFloat(p[2]) || 0) / 1000;
      if (tag === 'cv') { const v = pecSpeed(parseFloat(p[3])); E.speed.push({ ts: bt, te: bt, end: v, inst: true, easingType: 1 }); }
      else if (tag === 'cp') { const x = toX(p[3]), y = toY(p[4]); E.moveX.push({ ts: bt, te: bt, end: x, inst: true, easingType: 1 }); E.moveY.push({ ts: bt, te: bt, end: y, inst: true, easingType: 1 }); }
      else if (tag === 'cd') { E.rotate.push({ ts: bt, te: bt, end: parseFloat(p[3]) || 0, inst: true, easingType: 1 }); }
      else if (tag === 'ca') { E.alpha.push({ ts: bt, te: bt, end: toA(p[3]), inst: true, easingType: 1 }); }
    } else if (tag === 'cm' || tag === 'cr' || tag === 'cf') {
      const E = chAt(lineData, parseInt(p[1], 10));
      const b0 = parseFloat(p[2]) || 0, b1 = parseFloat(p[3]) || 0;
      if (tag === 'cm') {
        const et = parseInt(p[6], 10) || 1;
        E.moveX.push({ ts: b0, te: b1, end: toX(p[4]), inst: false, easingType: et });
        E.moveY.push({ ts: b0, te: b1, end: toY(p[5]), inst: false, easingType: et });
      } else if (tag === 'cr') { E.rotate.push({ ts: b0, te: b1, end: parseFloat(p[4]) || 0, inst: false, easingType: parseInt(p[5], 10) || 1 }); }
      else if (tag === 'cf') { E.alpha.push({ ts: b0, te: b1, end: toA(p[4]), inst: false, easingType: 1 }); }
    }
  };
  const utf8Len = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
  let pendBytes = 0;
  let pos = 0;
  while (pos < size) {
    const buf = await blob.slice(pos, Math.min(size, pos + CHUNK)).arrayBuffer();
    const text = dec.decode(buf, { stream: true });
    const ls = (pending + text).split('\n');
    pending = ls.pop();
    for (const raw of ls) {
      const s = raw.trim();
      if (s) {
        const p = s.split(/\s+/);
        const tag = p[0];
        if (tag === 'n1' || tag === 'n2' || tag === 'n3' || tag === 'n4') {
          const isHold = tag === 'n2';
          const st = (parseFloat(p[2]) || 0) / 1000;
          const et = isHold ? ((parseFloat(p[3]) || 0) / 1000 || st) : st;
          handleNote(parseInt(p[1], 10), tag, st, et, parseInt(p[isHold ? 6 : 5], 10) === 1 ? 1 : 0);
        } else if (s.charAt(0) === '#' || s.charAt(0) === '&') {
          // speed/width suffix lines of the previous note: only counted, bucket boundaries are unaffected
        } else {
          handleHeader(s);
        }
      }
      curByte += utf8Len(raw) + 1;
    }
    pendBytes = utf8Len(pending);
    pos += buf.byteLength;
    if (onStatus) onStatus(pos / size);
  }
  if (pending.trim()) {
    const s = pending.trim();
    const p = s.split(/\s+/);
    const tag = p[0];
    if (tag === 'n1' || tag === 'n2' || tag === 'n3' || tag === 'n4') {
      const isHold = tag === 'n2';
      const st = parseFloat(p[2]) || 0;
      handleNote(parseInt(p[1], 10), tag, st, isHold ? ((parseFloat(p[3]) || 0) || st) : st, parseInt(p[isHold ? 6 : 5], 10) === 1 ? 1 : 0);
    } else if (s.charAt(0) !== '#' && s.charAt(0) !== '&') handleHeader(s);
    curByte += utf8Len(pending) + 1;
  }
  closeBucket();
  if (!chart.BPMList.length) chart.BPMList.push({ bpm: 120, startTime: [0, 0, 1] }); // PEC falls back to 120bpm when no bp event exists
  const fill = (events, def) => {
    if (!events.length) return [];
    events.sort((a, b) => a.ts - b.ts);
    let curV = def;
    const out = [];
    for (const e of events) {
      const te = e.inst ? e.ts + 1e-9 : e.te;
      const s = e.inst ? e.end : curV;
      curV = e.end;
      out.push({ startTime: [e.ts, 0, 1], endTime: [te, 0, 1], start: s, end: e.end, easingType: e.easingType, easingLeft: 0, easingRight: 1 });
    }
    return out;
  };
  chart.judgeLineList = lineData.map((E, li) => ({
    name: 'Line' + li,
    eventLayers: [{
      speedEvents: fill(E.speed, 1),
      moveXEvents: fill(E.moveX, 0),
      moveYEvents: fill(E.moveY, 0),
      rotateEvents: fill(E.rotate, 0),
      alphaEvents: fill(E.alpha, 255),
    }],
    notes: [],
  }));
  buckets.sort((a, b) => a.t0 - b.t0 || a.bs - b.bs);
  chart.__stream = { file: blob, size, buckets, totalNotes, totalFake, maxBeat, maxEndSec };
  return chart;
}


// Bezier flattening: consecutive duplicate points in the control sequence mark segment boundaries
// each segment is an independent higher-order bezier, sampled with de Casteljau at 28 points and joined into a polyline (~ true curve)
function flattenBezier(curves) {
  const runs = [];
  let run = [];
  for (const pt of curves) {
    const prev = run.length ? run[run.length - 1] : null;
    if (prev && Math.abs(pt[0] - prev[0]) < 1e-9 && Math.abs(pt[1] - prev[1]) < 1e-9) {
      if (run.length > 1) runs.push(run);
      run = [pt];
    } else {
      run.push(pt);
    }
  }
  if (run.length > 1) runs.push(run);
  const out = [[0, 0]];
  for (const runPts of runs) {
    if (runPts.length === 2) {
      if (out[out.length - 1][0] !== runPts[1][0] || out[out.length - 1][1] !== runPts[1][1]) out.push(runPts[1]);
      continue;
    }
    const N = 96;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const a = runPts.slice();
      for (let n = a.length; n > 1; n--) {
        for (let j = 0; j < n - 1; j++) {
          a[j] = [a[j][0] + (a[j + 1][0] - a[j][0]) * t, a[j][1] + (a[j + 1][1] - a[j][1]) * t];
        }
      }
      out.push(a[0]);
    }
  }
  return out;
}

// Circular-arc flattening from three points: build the arc from A to C that passes through the middle point B
// output a polyline relative to A (approximating arc length); returns null when the points are collinear or no circle can be formed, caller falls back to a straight line
function circularArcToPiecewiseLinear(ax, ay, bx, by, cx, cy) {
  const midaX = (ax + bx) / 2, midaY = (ay + by) / 2;
  const midbX = (bx + cx) / 2, midbY = (by + cy) / 2;
  const noraX = -(by - ay), noraY = bx - ax;
  const norbX = -(cy - by), norbY = cx - bx;
  const des = norbX * noraY - norbY * noraX;
  if (Math.abs(des) < 1e-6) return null;
  const u = ((midbY - midaY) * noraX + (midaX - midbX) * noraY) / des;
  const ox = midbX + norbX * u, oy = midbY + norbY * u;
  const r = Math.hypot(ax - ox, ay - oy);
  if (!(r > 1e-6)) return null;
  let tA = Math.atan2(ay - oy, ax - ox);
  const tB = Math.atan2(by - oy, bx - ox);
  let tC = Math.atan2(cy - oy, cx - ox);
  const inArc = (s, m, e) => (m > s && m < e) || (m < s && m > e);
  if (!inArc(tA, tB, tC)) {
    if (Math.abs(tA + Math.PI * 2 - tC) < Math.PI * 2 && inArc(tA + Math.PI * 2, tB, tC)) tA += Math.PI * 2;
    else if (Math.abs(tA - (tC + Math.PI * 2)) < Math.PI * 2 && inArc(tA, tB, tC + Math.PI * 2)) tC += Math.PI * 2;
    else if (Math.abs(tA - Math.PI * 2 - tC) < Math.PI * 2 && inArc(tA - Math.PI * 2, tB, tC)) tA -= Math.PI * 2;
    else if (Math.abs(tA - (tC - Math.PI * 2)) < Math.PI * 2 && inArc(tA, tB, tC - Math.PI * 2)) tC -= Math.PI * 2;
    else return null;
  }
  const arcAng = Math.abs(tA - tC);
  if (arcAng < 1e-4) return null;
  const steps = Math.max(2, Math.min(200, Math.ceil(arcAng * r / 5)));
  const out = [[0, 0]];
  for (let i = 1; i <= steps; i++) {
    const ang = tA + (tC - tA) * (i / steps);
    out.push([Math.cos(ang) * r + ox, Math.sin(ang) * r + oy]);
  }
  // also returns the exact tangent direction at the arc end (relative to A, in chart coordinates) so very long sliders extend along the tangent,
  // instead of amplifying the approximation error of the last chord by the extension length
  const sgn = tC >= tA ? 1 : -1;
  out.tangent = [sgn * -Math.sin(tC), sgn * Math.cos(tC)];
  return out;
}

// Chart-custom Tip: a string is used directly, an array picks a random entry (from extra.json / META / info.yml)
// Literal 'null'/'undefined' text (e.g. info.yml declaring 'tip: null') counts as unset and falls back to the built-in random list
const isNullLiteral = (s) => /^(null|undefined)$/i.test(s);
// Extract the main palette from the chart background (HSL filter for saturated pixels, up to 4 spread-out hues, boosted saturation, hex output) for the fluid background
function extractBgPalette(img) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 9;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, 16, 9);
  const d = x.getImageData(0, 0, 16, 9).data;
  const cands = [];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
    if (s < 0.25 || l < 0.15 || l > 0.85) continue;
    let h;
    if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6;
    else if (mx === g) h = (b - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
    cands.push({ h: h * 60, s, l });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s);
  const picked = [];
  for (const cd of cands) {
    if (picked.every(p => { const dh = Math.abs(p.h - cd.h); return Math.min(dh, 360 - dh) > 50; })) picked.push(cd);
    if (picked.length >= 4) break;
  }
  const toHex = (h, s0, l0) => {
    const s = Math.min(1, s0 + 0.25);
    const l = Math.min(0.62, Math.max(0.45, l0));
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(v * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  };
  return picked.map(p => toHex(p.h, p.s, p.l));
}
function pickChartTip(v) {
  if (typeof v === 'string' && v.trim() && !isNullLiteral(v.trim())) return v.trim();
  if (Array.isArray(v)) {
    const arr = v.filter(s => typeof s === 'string' && s.trim() && !isNullLiteral(s.trim()));
    if (arr.length) return arr[Math.floor(Math.random() * arr.length)];
  }
  return null;
}
function parseConfigScalar(v) {
  if (v === undefined || v === null) return v;
  let s = String(v).trim();
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (/^\[(.*)\]$/.test(s)) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(part => parseConfigScalar(part)).filter((x) => x !== '');
  }
  const lower = s.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'yes') return true;
  if (lower === 'no') return false;
  if (lower === 'on') return true;
  if (lower === 'off') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  return s;
}

function parseInfoYaml(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const s = raw.trim();
    const i = s.indexOf(':');
    if (i <= 0 || s[0] === '#') continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (!k || v === '') continue;
    const key = k.toLowerCase();
    const parsed = parseConfigScalar(v);
    if (key === 'name') out.name = parsed;
    else if (key === 'level') out.level = parsed;
    else if (key === 'charter') out.charter = parsed;
    else if (key === 'composer') out.composer = parsed;
    else if (key === 'illustrator') out.illustrator = parsed;
    else if (key === 'music') out.songName = parsed;
    else if (key === 'illustration') out.bgName = parsed;
    else if (key === 'offset' && typeof parsed === 'number') out.offsetSec = parsed;
    else if (key === 'backgrounddim' && typeof parsed === 'number') out.backgroundDim = parsed;
    else if (key === 'unlockvideo') out.unlockVideo = parsed;
    else if (key === 'tip') out.tip = parsed;
    else if (key === 'dynamicbackground') { const n = parseInt(parsed, 10); if (n === 1 || n === 2) out.dynamicBackground = n; }
    else out[k] = parsed;
  }
  return Object.keys(out).length ? out : null;
}


function parseInfoTxt(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.charAt(0) === '#') continue;
    const i = s.indexOf(':');
    if (i <= 0) continue;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    if (!v) continue;
    const key = k.toLowerCase();
    const parsed = parseConfigScalar(v);
    if (key === 'name') out.name = parsed;
    else if (key === 'song') out.song = parsed;
    else if (key === 'picture' || key === 'background') out.background = parsed;
    else if (key === 'level') out.level = parsed;
    else if (key === 'charter') out.charter = parsed;
    else if (key === 'composer') out.composer = parsed;
    else if (key === 'offset' && typeof parsed === 'number') out.offsetSec = parsed;
    else if (key === 'dynamicbackground') { const n = parseInt(parsed, 10); if (n === 1 || n === 2) out.dynamicBackground = n; }
    else if (['hitfx', 'hitfxduration', 'hitfxscale', 'hitfxrotate', 'holdatlas', 'holdatlasmh', 'colorperfect', 'colorgood', 'holdsfx', 'goodhitfx', 'holdrepeat', 'holdkeephead', 'holdcompact', 'hideparticles', 'hitfxtinted'].includes(key)) out[k] = parsed;
    else out[k] = parsed;
  }
  return Object.keys(out).length ? out : null;
}
function parseInfoCsv(text) {
  const rows = String(text || '').split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  if (!rows.length) return null;
  const row = rows[rows.length - 1].split(',');
  if (row.length < 8) return null;
  const out = {};
  const name = (row[6] || '').trim();
  if (name) out.name = name;
  const level = (row[7] || '').trim();
  if (level) out.level = level;
  const illustrator = (row[8] || '').trim();
  if (illustrator) out.illustrator = illustrator;
  const designer = (row[9] || '').trim();
  if (designer) out.charter = designer;
  return Object.keys(out).length ? out : null;
}

// LRC lyric parsing: [mm:ss.xx] text -> [{ time(seconds), text }], sorted by time; multiple tags on one line each produce an entry
function parseLRC(text) {
  const out = [];
  const timeRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const tokenRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]|[^\[\]]+/g;
  const toT = (m) => {
    let frac = m[3] || '';
    frac = frac.length === 2 ? frac + '0' : frac.length === 1 ? frac + '00' : frac.slice(0, 3);
    return (+m[1]) * 60 + (+m[2]) + (+frac) / 1000;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const tags = [...line.matchAll(timeRe)];
    if (!tags.length) continue;
    const s = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!s) continue;
    // Word-by-word karaoke format (timestamps interleaved with characters): [t]char[t]char... produces charTimes for progressive highlighting
    const toks = [];
    tokenRe.lastIndex = 0;
    let tm;
    while ((tm = tokenRe.exec(line)) !== null) toks.push(tm);
    let karaoke = false;
    for (let i = 0; i + 2 < toks.length; i++) {
      if (toks[i][0][0] === '[' && toks[i + 1][0][0] !== '[' && toks[i + 2][0][0] === '[') { karaoke = true; break; }
    }
    if (karaoke) {
      const chars = [];
      const times = [];
      let lastT = toT(tags[0]);
      let endT = lastT;
      for (const tk of toks) {
        if (tk[0][0] === '[') { lastT = toT(tk); endT = lastT; continue; }
        for (const ch of tk[0]) {
          if (ch === '(' || ch === ')') continue;
          chars.push(ch);
          times.push(lastT);
        }
      }
      const textS = chars.join('');
      if (textS && times.length === textS.length) {
        const item = { time: toT(tags[0]), text: textS, charTimes: times };
        // A trailing timestamp (tail/end marker) clearly later than the last character is stored as endT for the line fade-out
        if (endT > times[times.length - 1] + 0.2) item.endT = endT;
        out.push(item);
        continue;
      }
    }
    for (const m of tags) out.push({ time: toT(m), text: s });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function bpmListToSeconds(list, beat, factor=1.0) {
  if (!list || !list.length) return beat * 60 / (120 / (factor || 1));
  if (tripleToBeat(list[0].startTime) > 0) list = [{ bpm: list[0].bpm, startTime: [0, 0, 1] }].concat(list);
  let sec = 0;
  for (let i = 0; i < list.length; i++) {
    const ev = list[i], bpm = (ev.bpm || 120) / factor, start = tripleToBeat(ev.startTime);
    const next = i + 1 < list.length ? tripleToBeat(list[i+1].startTime) : Infinity;
    const seg = Math.min(beat, next) - start;
    if (seg <= 0) continue;
    sec += seg * 60 / bpm;
    if (beat <= next) break;
  }
  return sec;
}

function secondsToBeat(list, sec, factor=1.0) {
  if (!list || !list.length) return sec / (60 / (120 / (factor || 1)));
  if (tripleToBeat(list[0].startTime) > 0) list = [{ bpm: list[0].bpm, startTime: [0, 0, 1] }].concat(list);
  let beat = 0, acc = 0;
  for (let i = 0; i < list.length; i++) {
    const ev = list[i], bpm = (ev.bpm || 120) / factor, start = tripleToBeat(ev.startTime);
    const dur = i + 1 < list.length ? (tripleToBeat(list[i+1].startTime) - start) * 60 / bpm : Infinity;
    if (sec <= acc + dur) { beat = start + (sec - acc) / (60 / bpm); break; }
    acc += dur; beat = i + 1 < list.length ? tripleToBeat(list[i+1].startTime) : beat;
  }
  return beat;
}

// Beats -> seconds (the inverse of secondsToBeat, converted piecewise by BPMList; used for the start time of extra.json videos)
function beatToSeconds(list, beat) {
  if (!list || !list.length) return beat * 60 / 120;
  if (tripleToBeat(list[0].startTime) > 0) list = [{ bpm: list[0].bpm, startTime: [0, 0, 1] }].concat(list);
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    const ev = list[i], bpm = ev.bpm || 120, start = tripleToBeat(ev.startTime);
    const end = i + 1 < list.length ? tripleToBeat(list[i + 1].startTime) : Infinity;
    if (beat < start) {
      const prevStart = i > 0 ? tripleToBeat(list[i - 1].startTime) : 0;
      const prevBpm = i > 0 ? (list[i - 1].bpm || 120) : (list[0].bpm || 120);
      return acc + (beat - prevStart) * 60 / prevBpm;
    }
    if (beat < end) return acc + (beat - start) * 60 / bpm;
    acc += (end - start) * 60 / bpm;
  }
  return acc;
}

function buildSpeedFloor(events, maxBeat, toSec) {
  if (!events || !events.length) return null;
  // Speed floor units follow prpr / phira: the "height" floor is the integral of the speed value over
  // TIME (seconds), so a speed value v carries notes at v * (10/45/HEIGHT_RATIO) * RPE_HEIGHT/2 px per
  // second regardless of BPM. RPE stores speed events on a beat axis, so when toSec (a function
  // beat -> seconds for this judge line) is provided the accumulation is weighted by dt/db; without it
  // (phi/PEC charts already carrying seconds triples, or beat==second) raw beats are used.
  const kf = [{ b: 0, p: 0, v: 1 }];
  let cursor = 0, height = 0, speed = 1;
  const evs = events.slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime));
  const width = (a, b) => {
    const db = b - a;
    if (db <= 0.0000001) return 1;
    return toSec ? (toSec(b) - toSec(a)) / db : 1;
  };
  const emit = (b, p, v) => {
    const last = kf[kf.length - 1];
    if (last.b === b) last.v = v;
    else kf.push({ b, p, v });
  };
  for (const e of evs) {
    let bs = tripleToBeat(e.startTime), be = tripleToBeat(e.endTime);
    let s0 = e.start ?? 1, s1 = e.end ?? 1;
    // Some older RPE charts (e.g. RPEVersion≤100) swap startTime/endTime fields;
    // if the start beat is after the end beat, swap both the times and the values.
    if (bs > be + 1e-6) { const tmp = bs; bs = be; be = tmp; const tv = s0; s0 = s1; s1 = tv; }
    if (bs > cursor) {
      const w = width(cursor, bs);
      emit(cursor, height, speed * w);
      height += (bs - cursor) * speed * w;
      cursor = bs;
    }
    if (be > cursor) {
      const span = be - bs;
      const steps = 64;
      let x = cursor;
      while (x < be) {
        const xu = Math.min(x + span / steps, be);
        const t1 = span > 0 ? (x - bs) / span : 0;
        const t2 = span > 0 ? (xu - bs) / span : 0;
        const midT = Math.max(0, Math.min(1, (t1 + t2) / 2));
        const vM = s0 + (s1 - s0) * midT;
        const w = width(x, xu);
        emit(x, height, vM * w);
        height += (xu - x) * vM * w;
        x = xu;
      }
      speed = s1;
      cursor = be;
    }
  }
  emit(cursor, height, speed * width(cursor, cursor + Math.max(0.000001, Math.abs(speed) * 1e-6)));
  // Past max_time the floor is clamped to a constant instead of being extrapolated
  if (maxBeat != null) {
    if (maxBeat > cursor) {
      emit(maxBeat, height + speed * (maxBeat - cursor) * width(cursor, Math.max(maxBeat, cursor + 0.000001)), 0);
    } else {
      const last = kf[kf.length - 1];
      if (last) last.v = 0;
    }
  }
  return kf;
}

function speedFloorAt(kf, t) {
  if (!kf) return t;
  let lo = 0, hi = kf.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (kf[m].b <= t) lo = m; else hi = m - 1;
  }
  return kf[lo].p + (t - kf[lo].b) * kf[lo].v;
}

// RPE 1.7.0 bezier easing events (bezier/bezierPoints): cubic bezier curve easing.
// bezierPoints = [P1x, P1y, P2x, P2y] with fixed endpoints P0 = (0,0) and P3 = (1,1);
// solve Bx(u) = t for the parameter u, then take y = By(u) as the eased value (control point y may exceed [0,1] to create overshoot).
function bezierEase(bp, t) {
  if (!Array.isArray(bp) || bp.length < 4) return t;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const p1x = +bp[0], p1y = +bp[1], p2x = +bp[2], p2y = +bp[3];
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) {
    const u = (lo + hi) / 2;
    const bx = 3 * (1 - u) * (1 - u) * u * p1x + 3 * (1 - u) * u * u * p2x + u * u * u;
    if (bx < t) lo = u; else hi = u;
  }
  const u = (lo + hi) / 2;
  return 3 * (1 - u) * (1 - u) * u * p1y + 3 * (1 - u) * u * u * p2y + u * u * u;
}

function evaluateEvent(events, beat, def) {
  if (!events || !events.length) return def;
  let res = def;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const ts = (typeof e.startTime === 'number') ? e.startTime : (e.startBeat ?? tripleToBeat(e.startTime));
    const te = (typeof e.endTime === 'number') ? e.endTime : (e.endBeat ?? tripleToBeat(e.endTime));
    if (beat < ts) break;
    if (beat >= ts && beat <= te) {
      const span = te - ts, t = span <= 0 ? 1 : (beat - ts) / span;
      const l = e.easingLeft ?? 0, r = e.easingRight ?? 1;
      let tn = l + (r - l) * t; tn = Math.max(0, Math.min(1, tn));
      const v = (e.bezier === 1) ? bezierEase(e.bezierPoints, tn) : (Easing[Math.max(1, e.easingType || 1)] || Easing[1])(tn);
      if (Array.isArray(e.start)) {
        const a = e.start, b = e.end;
        res = a.map((c, idx) => c + ((b[idx] ?? c) - c) * v);
      } else {
        res = e.start + (e.end - e.start) * v;
      }
      break;
    }
    res = e.end;
  }
  return res;
}

function interpolateText(start, end, t) {
  if (start === end) return start;
  const numRe = /%P%([-+]?\d*\.?\d+)/;
  const matchStart = start.match(numRe);
  const matchEnd = end.match(numRe);
  if (matchStart && matchEnd) {
    const numStart = parseFloat(matchStart[1]);
    const numEnd = parseFloat(matchEnd[1]);
    if (!isNaN(numStart) && !isNaN(numEnd)) {
      const interp = numStart + (numEnd - numStart) * t;
      let numStr;
      if (Number.isInteger(numStart) && Number.isInteger(numEnd)) {
        numStr = Math.round(interp).toString();
      } else {
        numStr = interp.toFixed(2);
      }
      const prefix = start.substring(0, matchStart.index);
      const suffix = start.substring(matchStart.index + matchStart[0].length);
      return prefix + numStr + suffix;
    }
  }
  if (end === '') {
    const len = start.length;
    const cut = Math.floor(len * (1 - t));
    return start.substring(0, cut);
  }
  if (start === '') {
    const len = end.length;
    const show = Math.floor(len * t);
    return end.substring(0, show);
  }
  if (end.startsWith(start)) {
    const extra = end.substring(start.length);
    const len = extra.length;
    const show = Math.floor(len * t);
    return start + extra.substring(0, show);
  }
  if (start.startsWith(end)) {
    const extra = start.substring(end.length);
    const len = extra.length;
    const remove = Math.floor(len * t);
    return end + extra.substring(0, len - remove);
  }
  return t < 0.5 ? start : end;
}

// ============================================================
//  PEZ parser
// ============================================================
