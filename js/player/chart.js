// PhiAI-Player || js/player/chart.js
// EnhancedRPEPlayer instance methods (isPhiChart, convertPhiChart, loadChart, buildNoteObject) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  isPhiChart(jsonData) {
  if (!jsonData || !Array.isArray(jsonData.judgeLineList) || !jsonData.judgeLineList.length) return false;
  const jl = jsonData.judgeLineList[0];
  return !jl.eventLayers && !jl.notes && (Array.isArray(jl.notesAbove) || Array.isArray(jl.notesBelow) || Array.isArray(jl.judgeLineMoveEvents));
},
convertPhiChart(j) {
  const fv = j.formatVersion ?? 3;
  const refBpm = (j.judgeLineList[0] && j.judgeLineList[0].bpm) || 120;
  // Phigros speed events are absolute (Y per second, 1 Y = 0.6 of the field height). prpr draws a
  // Y unit of note distance as 450/HEIGHT_RATIO px (450/0.83175 ~= 541 baseline px where 900 = full
  // height), so baseSpeed = 40 x phiSpeedScale must equal that: phiSpeedScale = 541.../40.
  this.phiSpeedScale = (450 / 0.83175) / 40;
  const secOf = (t, b) => t * 1.875 / b;
  const typeMap = { 1: 1, 2: 4, 3: 2, 4: 3 };
  // Official charts use a trailing event with endTime = 1e9 (ms) to mean 'lasts until the chart ends'.
  // Converting it as-is (x1.875/bpm) would stretch the chart length to millions of seconds and break totalSeconds / the progress bar.
  // Always clamp it to the real time (maxMs) of the last note / event on this line.
  const evBase = (ev, lineBpm, extra, maxMs) => {
    // A chart usually begins with a sentinel event whose startTime = -999999 (T units) meaning
    // 'from the very start'. Converting it as-is yields a huge negative seconds value, which the
    // beat->time mapping cannot represent, so clamp it (and any other negative startTime) to beat 0.
    const st = Math.max(0, +ev.startTime || 0);
    const endMs = (ev.endTime >= 1e9) ? Math.max(maxMs || 0, st) : Math.max(st, +ev.endTime || 0);
    const e = {
      startTime: [secOf(st, lineBpm), 0, 1],
      endTime: [secOf(endMs, lineBpm), 0, 1],
      easingType: ev.easingType || 1,
      easingLeft: ev.easingLeft ?? 0,
      easingRight: ev.easingRight ?? 1,
    };
    return Object.assign(e, extra || {});
  };
  // Decode a judge-line move-event coordinate pair into the canvas pixel domain (1350x900),
  // dispatched by formatVersion (the official spec's coordinate conventions are version-specific):
  //   formatVersion 1 : start = 1000x + y packed integer, bottom-left origin, top-right = (880, 520)
  //   formatVersion 3 : start/start2 = x/y normalized [0,1], bottom-left origin, top-right = (1, 1)
  //   split (>=5/13)  : judgeLineMoveEvents is split into judgeLineMoveXEvents / judgeLineMoveYEvents,
  //                     which keep the normalized [0,1] convention of format 3; each carries only its own axis
  //   other           : center origin, +x right, +y up, unit length = 0.1H (0.1 x 900 = 90 px)
  // Returns the pixel X (isX=1) or pixel Y (isX=0, in the chart coordinate system used by toScreen).
  // WARNING: toScreen maps (x, y) to screen as (width/2 + x*scaleX, height/2 - y*scaleY), i.e. it
  // expects y to grow UPWARD (top of screen = positive y). All the format conversions below therefore
  // emit y-up coordinates (start2=1 / top of the field -> +450 px), matching that convention.
  const phiPos = (cv, s, s2, isX, split) => {
    const v = typeof s === 'number' ? s : 0;
    const w = typeof s2 === 'number' ? s2 : 0;
    if (cv === 1) {
      const r = Math.round(v);
      return isX ? (((r - r % 1000) / 1000) / 880 - 0.5) * 1350 : ((r % 1000) / 520 - 0.5) * 900;
    }
    if (cv === 3) return isX ? (v - 0.5) * 1350 : (w - 0.5) * 900;
    // split (>=5/13): each event carries only its own axis value in start/end (x for X-events,
    // y for Y-events); both are normalized [0,1] like format 3
    if (split) return isX ? (v - 0.5) * 1350 : (v - 0.5) * 900;
    // other raw formatVersion (not 1/3): center origin, unit = 0.1H
    return isX ? v * 90 : w * 90;
  };
  const moveXOf = (e, b, maxMs, split) => evBase(e, b, { start: phiPos(fv, e.start, e.start2, 1, split), end: phiPos(fv, e.end, e.end2, 1, split) }, maxMs);
  const moveYOf = (e, b, maxMs, split) => evBase(e, b, { start: phiPos(fv, e.start, e.start2, 0, split), end: phiPos(fv, e.end, e.end2, 0, split) }, maxMs);
  const out = {
    META: j.META || {},
    formatVersion: fv,
    offset: (j.offset || 0) * 1000,
    BPMList: [{ bpm: 60, startTime: [0, 0, 1] }],
    judgeLineList: (j.judgeLineList || []).map((jl, li) => {
      // Judge line bpmfactor (converted charts may carry it): the effective line BPM = jl.bpm / bpmfactor, used for 128th-note -> seconds and speed conversion
      const lf = parseFloat(jl.bpmfactor ?? jl.bpmFactor ?? 1) || 1;
      const lb = (jl.bpm || refBpm) / lf;
      // Newer formats (>= v5 / v13) split the old combined judgeLineMoveEvents into an X and a Y array
      // (normalized [0,1] like format 3); older charts keep the single combined array (packed or s/s2).
      const isSplit = Array.isArray(jl.judgeLineMoveXEvents) || Array.isArray(jl.judgeLineMoveYEvents);
      const moveEvX = isSplit ? (jl.judgeLineMoveXEvents || []) : (jl.judgeLineMoveEvents || []);
      const moveEvY = isSplit ? (jl.judgeLineMoveYEvents || []) : (jl.judgeLineMoveEvents || []);
      const notes = [];
      for (const n of (jl.notesAbove || [])) notes.push(Object.assign({}, n, { above: 1 }));
      for (const n of (jl.notesBelow || [])) notes.push(Object.assign({}, n, { above: 0 }));
      notes.sort((a, b) => a.time - b.time);
      // Real maximum time of this line (ms): end of the notes plus the end of every non-permanent event, used to clamp endTime = 1e9 events
      let lineMaxMs = 0;
      for (const n of notes) lineMaxMs = Math.max(lineMaxMs, (n.time || 0) + (n.holdTime || 0));
      for (const k of ['judgeLineRotateEvents', 'judgeLineDisappearEvents']) {
        for (const e of (jl[k] || [])) if (e.endTime < 1e9) lineMaxMs = Math.max(lineMaxMs, e.endTime);
      }
      for (const e of moveEvX.concat(moveEvY)) if (e.endTime < 1e9) lineMaxMs = Math.max(lineMaxMs, e.endTime);
      return {
        name: 'Line' + li,
        yOffset: jl.yOffset ?? 0,
        // Effective line BPM (bpm/bpmfactor): drives the per-beat hold HitFx interval (60/lineBpm s).
        bpm: (jl.bpm || refBpm) / lf,
        eventLayers: [{
          speedEvents: (jl.speedEvents || []).map(e => Object.assign(evBase(e, lb, null, lineMaxMs), { start: +e.value || 0, end: +e.value || 0 })),
          moveXEvents: moveEvX.map(e => moveXOf(e, lb, lineMaxMs, isSplit)),
          moveYEvents: moveEvY.map(e => moveYOf(e, lb, lineMaxMs, isSplit)),
          rotateEvents: (jl.judgeLineRotateEvents || []).map(e => Object.assign(evBase(e, lb, null, lineMaxMs), { start: -(e.start || 0), end: -(e.end || 0) })),
          alphaEvents: (jl.judgeLineDisappearEvents || []).map(e => Object.assign(evBase(e, lb, null, lineMaxMs), { start: (e.start ?? 1) * 255, end: (e.end ?? 1) * 255 })),
        }],
        notes: notes.map(n => ({
          type: typeMap[n.type] || 1,
          above: n.above,
          startTime: [secOf(n.time, lb), 0, 1],
          endTime: [secOf(n.time + (n.holdTime || 0), lb), 0, 1],
          positionX: (n.positionX || 0) * 75.9375,
          yOffset: 0,
          // Phigros spec: a hold note's speed multiplier applies only to the hold length / tail --
          // the hold head always flies at the judge line's speed (multiplier 1), matching prpr's
          // pgr parser (speed forced to 1 for kind 3). Taps/drags/flicks keep their own speed.
          speed: n.type === 3 ? 1 : (n.speed || 1),
          alpha: 255,
          isFake: 0,
          size: 1,
          visibleTime: 999999,
          tint: [255, 255, 255],
          judgeArea: 1,
        })),
      };
    }),
  };
  return out;
},
loadChart(jsonData) {
  // Note flight speed conversion (flow-speed standard):
  // The orientation / speed unit is chosen automatically from the chart format, mirroring other
  // simulators (e.g. phira/prpr), which never ask the user to pick a "speed standard":
  //   - RPE charts always use the standard conversion (applied uniformly to every RPE version):
  //     height curve = speed integral x SPEED_RATIO (=10/45/HEIGHT_RATIO = 10/45/0.83175 ~= 0.2671),
  //     flight pixels = beatDelta x SPEED_RATIO x spd x screenHeight/2
  //     -> ~120.2 units per beat (900px baseline); baseSpeed = 40 x phiSpeedScale -> phiSpeedScale ~= 3.0057
  //   - PEC / .osu / PCMY charts keep the legacy conversion (phiSpeedScale = 1)
  //   - Phigros official-format charts are configured separately by convertPhiChart
  this.chartFmt = (jsonData && jsonData.__fmt) || 'rpe';
  this.phiSpeedScale = this.chartFmt === 'rpe'
      ? 450 * (10 / 45 / 0.83175) / 40
      : 1;
  // PCMY default playback speed 0.5: only the visual timeline runs at half speed (audio.currentTime x 0.5),
  // while the music keeps the user's original speed (audio.playbackRate untouched) and the UI speed readout shows 0.50
  if (this.chartFmt === 'pcmy') {
    const _psEl = document.getElementById('play-speed');
    const _psVal = document.getElementById('play-speed-val');
    if (_psEl) _psEl.value = String(jsonData.playbackSpeed);
    if (_psVal) _psVal.textContent = jsonData.playbackSpeed.toFixed(2);
  }
  this.lastNoteEndTime = 0;
  const metaTip = jsonData && jsonData.META && (jsonData.META.tip ?? jsonData.META.tips);
  const dynBg = jsonData && jsonData.META && jsonData.META.dynamicBackground;
  if (this.isPhiChart(jsonData)) { jsonData = this.convertPhiChart(jsonData); this.chartFmt = 'phi'; }
  // Chart-custom Tip: META.tip/tips as fallback (extra.json was already stored into chartTip with higher priority by the loader)
  if (!this.chartTip) this.chartTip = pickChartTip(metaTip);
  // Compatibility: info.yml DynamicBackground 1 = fixed-brightness fluid background, 2 = brightness follows the audio spectrum
  this.dynamicBackground = (dynBg === 1 || dynBg === 2) ? dynBg : 0;
  this.chart = jsonData;
  // RPE editor-only fields (judgeLineGroup / multiLineString / multiScale) are ignored by simulators
  // (they only describe the editor's multi-line selection page, never gameplay transforms), so they are not applied here.
  const streamData = jsonData.__stream || null;
  this._noteStream = streamData;
  this.hitsoundMap = {};
  const meta = jsonData.META || {};
    const chartOffsetMs = (meta.offset ?? jsonData.offset ?? 0) || 0;
    // Total offset = chart META.offset (ms / 1000) + info.yml offset (seconds) + the user's global setting; the three are summed instead of picking one;
    // the playback timeline = music position - total offset (the sign convention matches the reference model res.time = now() - offset)
    const offset = chartOffsetMs / 1000 + (this._hasInfoOffset ? (this.infoOffsetSec || 0) : 0);

  // BpmList normalization: accept both startTime (triple / numeric beats) and time (beats); sort and dedupe; prepend a default BPM segment before the first event
  const _rawBpmList = jsonData.BPMList;
  let bpmList;
  if (Array.isArray(_rawBpmList) && _rawBpmList.length) {
    bpmList = _rawBpmList.map(ev => {
      let b = 0;
      if (ev.startTime != null) b = Array.isArray(ev.startTime) ? tripleToBeat(ev.startTime) : (+ev.startTime || 0);
      else if (ev.time != null) b = +ev.time || 0;
      return { bpm: (ev.bpm != null && +ev.bpm > 0) ? +ev.bpm : (meta.bpm || 120), startTime: [b, 0, 1] };
    });
    bpmList.sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime));
    const dedup = [];
    for (const ev of bpmList) {
      if (dedup.length && tripleToBeat(dedup[dedup.length - 1].startTime) === tripleToBeat(ev.startTime)) dedup[dedup.length - 1] = ev;
      else dedup.push(ev);
    }
    bpmList = dedup;
    if (bpmList.length && tripleToBeat(bpmList[0].startTime) > 0) {
      bpmList.unshift({ bpm: bpmList[0].bpm, startTime: [0, 0, 1] });
    }
  } else {
    bpmList = [{ bpm: meta.bpm || 120, startTime: [0, 0, 1] }];
  }
  this.bpmList = bpmList;

  this.parseEffects();
  this._fxChain = [];
  this.hideFX();

  this.judgeLines = [];
  this.imageEventFiles = [];
  this.lineTextureFiles = [];
  this.attachUIIndex = {};
  this._sortedLinesCache = null;
  this.uiTransforms = {};
  this.uiEntrance = null;
  const jlList = jsonData.judgeLineList || [];
  const uiElementNames = ['pause', 'combonumber', 'combo', 'score', 'bar', 'name', 'level'];
  const uiElementMap = {
    pause: 1,
    combonumber: 2,
    combo: 3,
    score: 4,
    bar: 5,
    name: 6,
    level: 7,
  };

  // Global max_time: the latest end second across all line notes / speed events, plus 1.0s
  let maxTimeSec = 0;
  for (const jl of jlList) {
    for (const n of (jl.notes || [])) {
      maxTimeSec = Math.max(maxTimeSec, beatToSeconds(this.bpmList, tripleToBeat(n.endTime || n.startTime)));
    }
    for (const layer of (jl.eventLayers || jl.event_layers || [])) {
      if (!layer || !layer.speedEvents) continue;
      for (const e of layer.speedEvents) {
        maxTimeSec = Math.max(maxTimeSec, beatToSeconds(this.bpmList, tripleToBeat(e.endTime)));
      }
    }
  }
  maxTimeSec += 1.0;
  const maxTimeBeat = secondsToBeat(this.bpmList, maxTimeSec);

  for (let li = 0; li < jlList.length; li++) {
    const jl = jlList[li];
    // RPE bpmfactor: the BPM of this judge line = chart BPM / bpmfactor (line beat -> seconds is scaled by it)
    const lf = parseFloat(jl.bpmfactor ?? jl.bpmFactor ?? 1) || 1;
    const layers = jl.eventLayers || jl.event_layers || [];
    const merged = { speedEvents: [], moveXEvents: [], moveYEvents: [], rotateEvents: [], alphaEvents: [] };
    const layered = { X: [], Y: [], R: [], A: [] };
    const speedLayers = [];
    for (const layer of layers) {
      if (!layer) continue;
      if (layer.speedEvents) {
        const events = layer.speedEvents.slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime));
        merged.speedEvents.push(...events);
        speedLayers.push(events);
      }
      if (layer.moveXEvents) { merged.moveXEvents.push(...layer.moveXEvents); layered.X.push(layer.moveXEvents.slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime))); }
      if (layer.moveYEvents) { merged.moveYEvents.push(...layer.moveYEvents); layered.Y.push(layer.moveYEvents.slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime))); }
      if (layer.rotateEvents) { merged.rotateEvents.push(...layer.rotateEvents); layered.R.push(layer.rotateEvents.slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime))); }
      if (layer.alphaEvents) { merged.alphaEvents.push(...layer.alphaEvents); layered.A.push(layer.alphaEvents.slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime))); }
    }
    for (const k of Object.keys(merged)) merged[k].sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime));
    // RPE speed layers are additive too. Keep the first layer's implicit base
    // speed of 1 and treat later layers as zero-based additive overlays.
    if (speedLayers.length > 1) {
      const speedBeats = new Set([0]);
      for (const events of speedLayers) {
        for (const e of events) {
          speedBeats.add(tripleToBeat(e.startTime));
          speedBeats.add(tripleToBeat(e.endTime));
        }
      }
      const points = Array.from(speedBeats).filter(Number.isFinite).sort((a, b) => a - b);
      const speedAt = (beat) => speedLayers.reduce((sum, events, index) => sum + evaluateEvent(events, beat, index === 0 ? 1 : 0), 0);
      const additiveSpeedEvents = [];
      for (let i = 0; i < points.length - 1; i++) {
        const startBeat = points[i], endBeat = points[i + 1];
        if (endBeat <= startBeat) continue;
        additiveSpeedEvents.push({
          startTime: [startBeat, 0, 1],
          endTime: [endBeat, 0, 1],
          start: speedAt(startBeat),
          end: speedAt(endBeat),
          easingType: 1,
          easingLeft: 0,
          easingRight: 1,
        });
      }
      if (points.length) {
        const last = points[points.length - 1];
        additiveSpeedEvents.push({
          startTime: [last, 0, 1],
          endTime: [last, 0, 1],
          start: speedAt(last),
          end: speedAt(last),
          easingType: 1,
          easingLeft: 0,
          easingRight: 1,
        });
      }
      merged.speedEvents = additiveSpeedEvents;
    }
    // RPE extended.inclineEvents: judge line incline events (single layer, not stacked; default 0.0)
    const inclineEvents = ((jl.extended && (jl.extended.inclineEvents || jl.extended.incline_events)) || [])
      .slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime));
    // RPE speed events are stored on a beat axis but the flow standard integrates over seconds
    // (prpr: height += speed * dt; flight px/s = speed * (10/45/HEIGHT_RATIO) * RPE_HEIGHT/2,
    // independent of BPM). Pass a beat->seconds mapper (respecting the line BPM factor) so
    // non-60BPM charts do not fly BPM/60 x too fast.
    const _rpeToSec = this.chartFmt === 'rpe'
      ? (bb) => bpmListToSeconds(this.bpmList, bb, lf)
      : null;
    const speedFloor = buildSpeedFloor(merged.speedEvents, _rpeToSec ? (maxTimeBeat / lf) : maxTimeBeat, _rpeToSec);
    
    let attachUI = jl.attachUI ?? null;
    if (typeof attachUI === 'number') {
      // Numeric enum (matching the standard UIElement set: 1 = Pause .. 7 = Level)
      if (attachUI < 1 || attachUI > 7) attachUI = null;
      else attachUI = uiElementNames[attachUI - 1];
    } else if (typeof attachUI === 'string') {
      const k = attachUI.toLowerCase();
      if (!uiElementNames.includes(k)) attachUI = null;
      else attachUI = k;
    } else {
      attachUI = null;
    }

    let textEvents = [];
    if (jl.extended && jl.extended.textEvents && Array.isArray(jl.extended.textEvents)) {
      textEvents = jl.extended.textEvents.map(ev => {
        const startSec = bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf);
        const endSec = bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf);
        return {
          startTime: startSec,
          endTime: endSec,
          start: ev.start || '',
          end: ev.end || '',
          easingType: ev.easingType || 1,
          easingLeft: ev.easingLeft || 0,
          easingRight: ev.easingRight || 1,
          bezier: ev.bezier ?? 0,
          bezierPoints: Array.isArray(ev.bezierPoints) ? ev.bezierPoints.slice() : [0, 0, 0, 0],
        };
      });
      textEvents.sort((a, b) => a.startTime - b.startTime);
    }

    // RPE 1.4.0 paint events (extended.paintEvents): control the brush size.
    // value > 0 = pen down, stamp a circle at the line's current position every frame (accumulating into a stroke); value <= 0 = clear this line's canvas (per the spec, negative clears).
    // brush color = line color, opacity = line opacity (alpha * 2.55, capped at 1); a line with paint events does not render itself (its opacity stays 0).
    const paintEvents = (((jl.extended && (jl.extended.paintEvents || jl.extended.paint_events))) || []).map(ev => ({
      startTime: bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf),
      endTime: bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf),
      start: ev.start ?? 0,
      end: ev.end ?? 0,
      easingType: ev.easingType || 1,
      easingLeft: ev.easingLeft || 0,
      easingRight: ev.easingRight || 1,
      bezier: ev.bezier ?? 0,
      bezierPoints: Array.isArray(ev.bezierPoints) ? ev.bezierPoints.slice() : [0, 0, 0, 0],
    })).sort((a, b) => a.startTime - b.startTime);

    const scaleXEvents = jl.extended?.scaleXEvents || [];
    const colorEvents = jl.extended?.colorEvents || [];
    const scaleYEvents = jl.extended?.scaleYEvents || [];
    const parsedScaleX = scaleXEvents.map(ev => ({
      startTime: bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf),
      endTime: bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf),
      startBeat: tripleToBeat(ev.startTime),
      endBeat: tripleToBeat(ev.endTime),
      start: ev.start ?? 1,
      end: ev.end ?? 1,
      easingType: ev.easingType || 1,
      easingLeft: ev.easingLeft || 0,
      easingRight: ev.easingRight || 1,
      bezier: ev.bezier ?? 0,
      bezierPoints: Array.isArray(ev.bezierPoints) ? ev.bezierPoints.slice() : [0, 0, 0, 0],
    }));
    const parsedScaleY = scaleYEvents.map(ev => ({
      startTime: bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf),
      endTime: bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf),
      startBeat: tripleToBeat(ev.startTime),
      endBeat: tripleToBeat(ev.endTime),
      start: ev.start ?? 1,
      end: ev.end ?? 1,
      easingType: ev.easingType || 1,
      easingLeft: ev.easingLeft || 0,
      easingRight: ev.easingRight || 1,
      bezier: ev.bezier ?? 0,
      bezierPoints: Array.isArray(ev.bezierPoints) ? ev.bezierPoints.slice() : [0, 0, 0, 0],
    }));

    // gifEvents: GIF playback progress events (a 1.50 format feature), evaluated in the beat domain (like imageEvents, compared against the line beat lb)
    // The RPE default backing event (start = end = 10, outside the [0,1] range) means 'auto loop'; rendering advances it in a loop
    const gifEvents = ((jl.extended && jl.extended.gifEvents) || []).map(ev => ({
      startBeat: tripleToBeat(ev.startTime),
      endBeat: tripleToBeat(ev.endTime),
      start: ev.start ?? 0,
      end: ev.end ?? 1,
      easingType: ev.easingType || 1,
      easingLeft: ev.easingLeft || 0,
      easingRight: ev.easingRight || 1,
      bezier: ev.bezier ?? 0,
      bezierPoints: Array.isArray(ev.bezierPoints) ? ev.bezierPoints.slice() : [0, 0, 0, 0],
    }));

    const imageEvents = ((jl.extended && jl.extended.imageEvents) || []).slice().sort((a, b) => tripleToBeat(a.startTime) - tripleToBeat(b.startTime)).map(ev => ({
      startBeat: tripleToBeat(ev.startTime),
      endBeat: tripleToBeat(ev.endTime),
      image: ev.image || '',
      posX: ev.posX ?? 0, posY: ev.posY ?? 0,
      scaleX: ev.scaleX ?? 1, scaleY: ev.scaleY ?? 1,
      rotation: ev.rotation ?? 0,
      alpha: ev.alpha ?? 1,
      color: (Array.isArray(ev.color) && ev.color.length >= 3) ? ev.color.slice(0, 4) : null,
      anchorX: ev.anchorX ?? 0.5, anchorY: ev.anchorY ?? 0.5,
      loop: ev.loop ?? 0,
      fps: ev.fps ?? 10,
      offset: ev.offset ?? 0,
      length: ev.length ?? 1,
      easingType: ev.easingType ?? 1,
      easingLeft: ev.easingLeft ?? 0,
      easingRight: ev.easingRight ?? 1,
    }));
    for (const ev of imageEvents) if (ev.image && !this.imageEventFiles.includes(ev.image)) this.imageEventFiles.push(ev.image);
    { const tRaw = (jl.Texture || jl.texture || '').replace(/\\/g, '/');
      if (tRaw && tRaw.toLowerCase() !== 'line.png' && !this.lineTextureFiles.includes(tRaw)) this.lineTextureFiles.push(tRaw); }

    const moveXIntervals = merged.moveXEvents.map(ev => ({
      start: bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf),
      end: bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf),
    }));
    const moveYIntervals = merged.moveYEvents.map(ev => ({
      start: bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf),
      end: bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf),
    }));
    // Rotate / opacity event spans: while chart events drive the UI (including angle / opacity changes) disable CSS transitions so gradients do not stack
    const chartIntervals = (evs) => evs
      .filter(ev => ev.start !== ev.end)
      .map(ev => ({
        start: bpmListToSeconds(this.bpmList, tripleToBeat(ev.startTime), lf),
        end: bpmListToSeconds(this.bpmList, tripleToBeat(ev.endTime), lf),
      }));
    const rotateIntervals = chartIntervals(merged.rotateEvents);
    const alphaIntervals = chartIntervals(merged.alphaEvents);

    const anchor = jl.anchor || [0.5, 0.5];
    const hasTextEvents = textEvents.length > 0;
    const isUIControl = attachUI !== null;

    const lineObj = {
      index: li,
      name: jl.Name || jl.name || `Line${li}`,
      texture: jl.Texture || jl.texture || '',
      // Judge line YOffset: the overall vertical offset of the line, accumulated with the evaluated moveY events (and part of the parent line chain transform)
      yOffset: jl.yOffset ?? 0,
// RPE parent line: father is the parent line index (-1/None/empty = no parent); rotateWithFather follows the parent by default,
      // _noFatherRotate is an RPE field; true = do not follow the parent rotation
      parent: (() => { const f = jl.father ?? jl.parent; if (f === undefined || f === null || f === '' || f === -1 || f === '-1' || f === 'None') return -1; const n = Number(f); return Number.isNaN(n) ? -1 : n; })(),
      rotateWithFather: ((jl.rotateWithFather === true || jl.rotateWithFather === 1) && !jl._noFatherRotate) ? 1 : 0,
      isCover: jl.isCover ?? 1,
      zOrder: jl.zOrder ?? 0,
      bpmFactor: lf,
      bpm: (parseFloat(jl.bpm) > 0 ? +jl.bpm / lf : 0),
      events: merged,
      layered: layered,
      imageEvents: imageEvents,
      speedFloor: speedFloor,
      notes: [],
      posX: 0, posY: 0, rotation: 0, alpha: 255,
      color: [255, 255, 255],
      textEvents: textEvents,
      anchor: anchor,
      currentText: '',
      hasTextEvents: hasTextEvents,
      paintEvents: paintEvents,
      hasPaintEvents: paintEvents.length > 0,
      _paintCv: null,
      _paintDirty: false,
      attachUI: attachUI,
      isUIControl: isUIControl,
      moveXIntervals: moveXIntervals,
      moveYIntervals: moveYIntervals,
      rotateIntervals: rotateIntervals,
      alphaIntervals: alphaIntervals,
      inclineEvents: inclineEvents,
      incline: 0,
      inclineSin: 0,
      scaleXEvents: parsedScaleX,
      scaleYEvents: parsedScaleY,
      colorEvents: colorEvents,
      gifEvents: gifEvents,
      isGif: !!(jl.isGif),
      gifProgress: -1,
      gifFrameIndex: 0,
      scaleX: 1,
      scaleY: 1,
      // RPE Controls (keyframe-based, driven by note distance to line in y units)
      // Defined on judge line, apply to all notes on this line
      alphaControl: Array.isArray(jl.alphaControl) ? jl.alphaControl.slice().sort((a,b) => a.x - b.x) : null,
      sizeControl: Array.isArray(jl.sizeControl) ? jl.sizeControl.slice().sort((a,b) => a.x - b.x) : null,
      posControl: Array.isArray(jl.posControl) ? jl.posControl.slice().sort((a,b) => a.x - b.x) : null,
      yControl: Array.isArray(jl.yControl) ? jl.yControl.slice().sort((a,b) => a.x - b.x) : null,
      skewControl: Array.isArray(jl.skewControl) ? jl.skewControl.slice().sort((a,b) => a.x - b.x) : null,
    };
    this.judgeLines.push(lineObj);

    if (isUIControl) {
      const uiIdx = uiElementMap[attachUI];
      if (uiIdx) {
        // One UI element may bind to several lines: all of them are excluded from rendering and the UI follows the last one (same as attach_ui)
        (this.attachUIIndex[uiIdx] = this.attachUIIndex[uiIdx] || []).push(li);
        this._sortedLinesCache = null;
      }
    }
  }

  if (streamData) {
    // Streaming mode: notes are lazily loaded per time window, no full array is built
    this.notes = [];
    this._streamWindow = [];
    this._streamWindowByLine = [];
    this._streamWinT0 = -Infinity;
    this._streamWinT1 = -Infinity;
    this._streamLoading = false;
  } else {
    this.notes = [];
    for (let li = 0; li < jlList.length; li++) {
      const jl = jlList[li];
      const noteList = jl.notes || [];
      for (const n of noteList) {
        const note = this.buildNoteObject(n, li);
        this.notes.push(note);
        this.judgeLines[li].notes.push(note);
      }
    }
    this.notes.sort((a, b) => a.startTime - b.startTime);
  }

  let totalNotes = 0;
  let maxBeat = 0;
  let maxNoteEndSec = 0;
  if (streamData) {
    totalNotes = streamData.totalNotes - streamData.totalFake;
    maxBeat = streamData.maxBeat;
    maxNoteEndSec = streamData.maxEndSec;
  } else {
    totalNotes = this.notes.filter(n => !n.isFake).length;
    for (const n of this.notes) maxBeat = Math.max(maxBeat, n.endTime);

    for (const n of this.notes) n.double = false;
    // Chord detection includes fake notes for visual multi-note support. Fake notes
    // remain excluded from judging and scoring by the input/judgement paths.
    const doubleMap = new Map();
    for (const n of this.notes) {
      if (!(n.type === 1 || n.type === 2 || n.type === 3)) continue;
      const key = n.startTime;
      if (!doubleMap.has(key)) doubleMap.set(key, []);
      doubleMap.get(key).push(n);
    }
    for (const arr of doubleMap.values()) {
      if (arr.length >= 2) for (const n of arr) n.double = true;
    }

    // Precompute note times in seconds (for multi-BPM support; RPE lines scale beat -> seconds by bpmfactor)
    for (const n of this.notes) {
      const lbf = this.judgeLines[n.lineIndex] ? (this.judgeLines[n.lineIndex].bpmFactor || 1) : 1;
      n.startTimeSec = bpmListToSeconds(this.bpmList, n.startTime, lbf);
      n.endTimeSec = bpmListToSeconds(this.bpmList, n.endTime, lbf);
      if (n.endTimeSec > maxNoteEndSec) maxNoteEndSec = n.endTimeSec;
    }
  }
  this.totalNotes = totalNotes;

  let maxEndSec = 0;
  for (const jl of this.judgeLines) {
    for (const evs of [jl.events.moveXEvents, jl.events.moveYEvents, jl.events.rotateEvents, jl.events.alphaEvents, jl.events.speedEvents]) {
      for (const e of evs) maxBeat = Math.max(maxBeat, tripleToBeat(e.endTime));
    }
    if (jl.textEvents) for (const te of jl.textEvents) maxEndSec = Math.max(maxEndSec, te.endTime);
  }
  this.totalBeats = maxBeat + 4;
  if (this._noteStream) {
    maxBeat = Math.max(maxBeat, this._noteStream.maxBeat);
    maxEndSec = Math.max(maxEndSec, this._noteStream.maxEndSec);
    this.totalBeats = maxBeat + 4;
  }
  const chartDuration = Math.max(maxNoteEndSec + 2, maxEndSec, bpmListToSeconds(this.bpmList, this.totalBeats));
  this.totalSeconds = chartDuration;
  if (jsonData.META && jsonData.META.duration && jsonData.META.duration <= chartDuration * 2) {
    this.totalSeconds = Math.max(this.totalSeconds, jsonData.META.duration);
  }
  this.offset = offset;
  this.lastNoteEndTime = this._noteStream ? maxEndSec : maxNoteEndSec;
},
buildNoteObject(n, li) {
  const st = tripleToBeat(n.startTime), et = tripleToBeat(n.endTime || n.startTime);
  return {
    lineIndex: li,
    type: n.type || 1,
    above: n.above ?? 1,
    startTime: st,
    endTime: et,
    positionX: n.positionX || 0,
    positionY: n.positionY || 0,
    yOffset: n.yOffset || 0,
    alpha: n.alpha ?? 255,
    isFake: n.isFake === true || n.isFake === 1 || String(n.isFake).trim().toLowerCase() === 'true' || String(n.isFake).trim() === '1' ? 1 : 0,
    size: n.size ?? 1.0,
    speed: n.speed ?? 1.0,
    visibleTime: n.visibleTime ?? 999999,
    tint: n.tint || n.color || [255, 255, 255],
    judgeArea: n.judgeArea || 1.0,
    hitsound: n.hitsound || null,
    hitSounds: Array.isArray(n.hitSounds) ? n.hitSounds : null,
    tintHitEffects: Array.isArray(n.tintHitEffects) ? n.tintHitEffects : null,
    // Runtime evaluated control values (from judge line controls, defaults = no effect)
    controlAlpha: 1, controlSize: 1, controlPos: 1, controlY: 1, controlSkew: 0, ctrlXMax: 0,
    judged: false,
    judgeResult: null,
    holdActive: false,
    holdStarted: false,
    holdFinished: false,
    holdTriggered: false,
    holdUp: null,
    screenX: 0, screenY: 0,
    opacity: 1,
    localX: 0, localY: 0,
    startTimeSec: 0,
    endTimeSec: 0
  };
}
});
