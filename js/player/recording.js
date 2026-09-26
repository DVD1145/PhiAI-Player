// PhiAI-Player || js/player/recording.js
// EnhancedRPEPlayer instance methods (startChartRecording, stopChartRecording, _restoreRec, chartNameForFile, _setupRecAudio, _cleanupRecAudio, _drawRecHud) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  startChartRecording(w, h, quality = 1, fps = 60) {
  if (this._rec || !this.chart || !this.totalSeconds) return;
  try { this.pause(); } catch (e) { /* Not playing */ }
  if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null; }
  if (this.pausedRAF) { cancelAnimationFrame(this.pausedRAF); this.pausedRAF = null; }
  if (this._countingDown) this._countingDown = false;
  // The game scene renders into its own canvas at (quality x w) x (quality x h) and is scaled onto the captured
  // canvas every frame: quality > 1 supersamples for extra sharpness, quality < 1 renders cheaply below the
  // output resolution (the common "render low, present high" optimization). The HUD is drawn at the full output
  // resolution so text always stays crisp. The post-processing FX chain is skipped entirely: it paints onto a DOM
  // overlay that canvas.captureStream cannot see, so running it would only burn frame time.
  quality = Math.max(0.5, Math.min(2, Number(quality) || 1));
  fps = (fps === 30 || fps === 60) ? fps : 60;
  const sw = Math.max(2, Math.round(w * quality)), sh = Math.max(2, Math.round(h * quality));
  const rc = document.createElement('canvas');       // capture canvas (output resolution, what MediaRecorder sees)
  rc.width = w; rc.height = h;
  const inner = document.createElement('canvas');    // render canvas (game scene, quality-scaled resolution)
  inner.width = sw; inner.height = sh;
  const ctxOpts = { alpha: false, desynchronized: true }; // opaque output + lower compositor latency (ignored where unsupported)
  let capCtx = null;
  try { capCtx = rc.getContext('2d', ctxOpts) || rc.getContext('2d'); } catch (e) { capCtx = rc.getContext('2d'); }
  let innerCtx = null;
  try { innerCtx = inner.getContext('2d', ctxOpts) || inner.getContext('2d'); } catch (e) { innerCtx = inner.getContext('2d'); }
  const saved = {
    canvas: this.canvas, ctx: this.ctx,
    width: this.width, height: this.height,
    scaleX: this.scaleX, scaleY: this.scaleY,
    _dpr: this._dpr,
    fxEffects: this.fxEffects, _fxExtraEffects: this._fxExtraEffects,
    sfxVolume: this.settings.sfxVolume,
    speed: this.speed,
    autoplay: this.autoplay,
    muted: this.muted,
  };
  this.canvas = inner;
  this.ctx = innerCtx;
  this.width = sw; this.height = sh;
  this.scaleX = sw / 1350; this.scaleY = sh / 900;
  this._dpr = 1;
  this._recHudS = w / sw;        // chart-driven HUD position offsets are measured in render pixels; rescale them to output pixels
  this.fxEffects = []; this._fxExtraEffects = [];
  this.hideFX();
  this.speed = 1;                // Record at the canonical 1.0 speed regardless of the user's setting
  this.autoplay = true;          // Force auto-judging so every note is hit in the recording
  this.muted = false;            // The full sound path must run end to end so the recording gets all audio
  this.fallbackMode = true;
  this.holdTime = false;
  this.isPaused = false;
  this.isPlaying = true;
  this.reset();
  this.fallbackTime = 0;
  this.startTime = performance.now() / 1000;
  this.lastFrameTime = performance.now();
  this._recUiOffset = {};        // Frozen per-element UI offset while chart position events drive the HUD
  this._recAudioActive = false;  // Set once the music element actually starts playing
  this._recWall0 = performance.now() / 1000; // Recording start wall time, used to keep the fallback clock in real time
  this._recFrameN = 0;           // Frame counter for the 30 fps render-gating below
  if (typeof rc.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    this._restoreRec(saved);
    this.showStatus('当前浏览器不支持录制 (需 canvas.captureStream + MediaRecorder)');
    return;
  }
  try { capCtx.imageSmoothingEnabled = true; capCtx.imageSmoothingQuality = 'high'; } catch (e) { /* Ignore */ }
  // Manual-capture mode: probe whether the canvas track can requestFrame(). If yes, use captureStream(0)
  // (automatic sampling off) and push exactly one frame per render with track.requestFrame(), so the encoder
  // only processes frames we actually produced - no duplicated frames when the machine (or the 30 fps gate)
  // renders fewer frames than a fixed captureStream(fps) would sample.
  let canManual = false;
  let probeTrack = null;
  try {
    probeTrack = rc.captureStream(0).getVideoTracks()[0];
    canManual = !!probeTrack && typeof probeTrack.requestFrame === 'function';
  } catch (e) { canManual = false; }
  if (probeTrack) { try { probeTrack.stop(); } catch (e) { /* Ignore */ } }
  const stream = canManual ? rc.captureStream(0) : rc.captureStream(fps);
  const recTrack = canManual ? stream.getVideoTracks()[0] : null;
  this._setupRecAudio(stream);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const bps = Math.max(4e6, Math.min(45e6, Math.round(w * h * 4 * (fps === 30 ? 0.7 : 1))));
  let mr = null;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 128000 } : { videoBitsPerSecond: bps, audioBitsPerSecond: 128000 }); }
  catch (e) {
    try { mr = new MediaRecorder(stream); } catch (e2) {
      this._restoreRec(saved);
      this.showStatus('无法初始化录制器');
      return;
    }
  }
  const rec = { rc, stream, mr, chunks: [], saved, cancel: false, w, h, t0: performance.now(), push: null };
  if (canManual) rec.push = () => { try { recTrack.requestFrame(); } catch (e) { /* Ignore */ } };
  this._rec = rec;
  mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
  mr.onerror = () => this.stopChartRecording(true);
  mr.start(500);

  const self = this;
  const loop = () => {
    if (!this._rec) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
if (this.fallbackMode && !this.holdTime) {
      this.fallbackTime += dt * this.speed;
      // No-music charts: reconcile the frame-accumulated clock against wall time so a slow / encoding-heavy
      // frame (dt is clamped to 0.1s) cannot let the chart fall behind real time.
      if (this._rec) {
        const wall = (performance.now() / 1000 - this._recWall0) * this.speed;
        if (wall > this.fallbackTime) this.fallbackTime = wall;
      }
    }
    const ct = this.getCurrentTime();
    const cb = secondsToBeat(this.bpmList, Math.max(0, ct - (this.offset || 0)));
    this._recFrameN = (this._recFrameN || 0) + 1;
    const doWork = fps >= 60 || this._recFrameN % 2 === 1; // 30 fps: render every second rAF and push a frame only then
    try {
      if (doWork) {
        // Game scene render (into the quality-scaled inner canvas)
        this.updateJudgeLines(cb, ct);
        this.updateBGA(ct);
        this._sfxInNoteLoop = true;
        try { this.updateNotes(cb, ct); } finally { this._sfxInNoteLoop = false; }
        this.flushSfx();
        this.updateEffects(dt);
        this.render(cb, ct);
        // Present the scene at the output resolution onto the captured canvas, then draw the HUD on top
        capCtx.drawImage(inner, 0, 0, w, h);
        this.canvas = rc; this.ctx = capCtx; this.width = w; this.height = h;
        this.scaleX = w / 1350; this.scaleY = h / 900;
        this._drawRecHud(ct);
        if (rec.push) rec.push(); // manual-capture: only rendered frames reach the encoder (no duplicated frames)
        // Switch the render target back to the inner scene canvas
        this.canvas = inner; this.ctx = innerCtx; this.width = sw; this.height = sh;
        this.scaleX = sw / 1350; this.scaleY = sh / 900;
      }
    } catch (e) { /* Ignore single-frame errors so one bad frame cannot abort the whole recording */ }
    const pct = this.totalSeconds > 0 ? Math.min(1, ct / this.totalSeconds) : 0;
    const bar = document.getElementById('rec-bar');
    const txt = document.getElementById('rec-progress-text');
    if (bar) bar.style.width = (pct * 100).toFixed(1) + '%';
    if (txt) txt.textContent = formatClock(ct) + ' / ' + formatClock(this.totalSeconds) + ' (' + Math.round(pct * 100) + '%)';
    const recEnd = this._rec.cancel || ct >= this.totalSeconds ||
      (this._recAudioActive && this.audio && this.audio.ended); // music ran out before the chart tail
    if (recEnd) {
      this.stopChartRecording(this._rec.cancel);
      return;
    }
    this._recId = requestAnimationFrame(loop);
  };
  this._recId = requestAnimationFrame(loop);
},
stopChartRecording(cancel = false) {
  const rec = this._rec;
  if (!rec) return;
  this._rec = null;
  if (this._recId) { cancelAnimationFrame(this._recId); this._recId = null; }
  const finalize = () => {
    this._restoreRec(rec.saved);
    this.settings.sfxVolume = rec.saved.sfxVolume;
    this.isPlaying = false;
    this.isPaused = false;
    rec.mr = null;
    try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* Ignore */ }
    if (cancel) {
      showRecResult(null);
    } else {
      let blob = null;
      try { blob = new Blob(rec.chunks, { type: 'video/webm' }); } catch (e) { /* Ignore */ }
      showRecResult(blob, this.chartNameForFile() + '-' + rec.w + 'x' + rec.h + '.webm');
    }
  };
  try {
    rec.mr.onstop = finalize;
    rec.mr.stop();
  } catch (e) {
    finalize();
  }
},
_restoreRec(saved) {
  this.canvas = saved.canvas;
  this.ctx = saved.ctx;
  this.width = saved.width;
  this.height = saved.height;
  this.scaleX = saved.scaleX;
  this.scaleY = saved.scaleY;
  this._dpr = saved._dpr;
  this.fxEffects = saved.fxEffects;
  this._fxExtraEffects = saved._fxExtraEffects;
  this.speed = saved.speed;
  this.autoplay = saved.autoplay;
  if (saved.muted !== undefined) this.muted = saved.muted;
  this._recAudioActive = false;
  this._recHudS = 1;
  this._cleanupRecAudio();
  this.fallbackMode = false;
  this.holdTime = false;
  this._fxFBOs = null;
  this._fxScale = 1;
  this._fxDtEma = 0;
  this.hideFX();
  if (this._countingDown) this._countingDown = false;
  try { this.ctx.setTransform(this._dpr || 1, 0, 0, this._dpr || 1, 0, 0); } catch (e) { /* Ignore */ }
},
chartNameForFile() {
  const meta = (this.chart && this.chart.META) || this._pendingChartData && this._pendingChartData.META || {};
  const raw = (meta.name || meta.title || meta.songName || 'chart').replace(/[\\\/:*?"<>|]/g, '_').trim();
  return raw || 'chart';
},
_setupRecAudio(stream) {
  try {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { return; }
  if (!this.audioCtx) return;
  try { if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {}); } catch (e) { /* Ignore */ }
  try {
    const dest = this.audioCtx.createMediaStreamDestination();
    this._recDest = dest;
    // SFX bus: _spawnSfx sources connect here instead of ctx.destination while recording
    const sfx = this.audioCtx.createGain();
    sfx.connect(dest);
    sfx.connect(this.audioCtx.destination);
    this._recSfxBus = sfx;
    // When the limiter chain is active, feed the (already limited) SFX into the recording stream too, so the
    // recording matches what is heard and never captures a clipped burst
    if (this.settings.sfxLimit && this._ensureSfxChain(this.audioCtx) && this._sfxLimiter) {
      try { this._sfxLimiter.connect(dest); } catch (e) { /* Ignore */ }
    }
    // Music: route the audio element into the graph (createMediaElementSource may only be used once per element,
    // so reuse the fluid-background source when it already exists) and start it in real time to match the fallback clock.
    if (this.audio && this.audio.src) {
      let src = this._bgMediaSrc;
      if (!src) {
        try {
          src = this.audioCtx.createMediaElementSource(this.audio);
          if (!this._fluidDead) this._bgMediaSrc = src;
        } catch (e) { src = null; }
      }
      if (src) {
        const mg = this.audioCtx.createGain();
        mg.connect(dest);
        if (!this._bgAnalyser && !this._audioSrcToSpeakers) {
          mg.connect(this.audioCtx.destination);
          this._recMusicToSpeakers = true;
        }
        src.connect(mg);
        this._recMusicGain = mg;
        try { this.audio.muted = false; } catch (e) { /* Ignore */ }
        try { this.audio.playbackRate = 1; } catch (e) { /* Ignore */ }
        try {
          this.audio.currentTime = 0;
          const self = this;
          this.audio.play().then(() => { if (self._rec) self._recAudioActive = true; }).catch(() => {});
        } catch (e) { /* Ignore */ }
      }
    }
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch (e) {
    console.warn('[Rec] audio mixing unavailable, recording video only', e);
    try { this._cleanupRecAudio(); } catch (e2) { /* Ignore */ }
  }
},
_cleanupRecAudio() {
  try {
    if (this._recSfxBus) { this._recSfxBus.disconnect(); this._recSfxBus = null; }
    if (this._recMusicGain) { this._recMusicGain.disconnect(); this._recMusicGain = null; }
    // Detach the SFX limiter from the recording destination (it stays wired to the speakers)
    if (this._sfxLimiter && this._recDest) {
      try { this._sfxLimiter.disconnect(this._recDest); } catch (e) { /* Ignore */ }
    }
    if (this._recDest) { this._recDest.disconnect(); this._recDest = null; }
  } catch (e) { /* Ignore */ }
  // If the music element was pulled into the graph for the recording and no analyser keeps it flowing to the speakers, restore that path once
  if (this._recMusicToSpeakers) {
    this._recMusicToSpeakers = false;
    try {
      if (this._bgMediaSrc && this.audioCtx && !this._bgAnalyser && !this._audioSrcToSpeakers) {
        this._bgMediaSrc.connect(this.audioCtx.destination);
        this._audioSrcToSpeakers = true;
      }
    } catch (e) { /* Ignore */ }
  }
  try { if (this.audio) this.audio.pause(); } catch (e) { /* Ignore */ }
},
_drawRecHud(ct, opts) {
  opts = opts || {};
  const ctx = this.ctx, w = this.width, h = this.height;
  const uis = Math.min(w / 1350, h / 900) * 1.43;
  const uiF = "px 'AppFont','Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
  const offs = this._recUiOffset || (this._recUiOffset = {});
  const S = this._recHudS || 1;
  const uisCss = uis / S;
  // Vertical text anchoring mirrors the DOM line boxes exactly. Those use font/line-height dependent CSS ('line-height: normal')
  // for the title and the difficulty, so the glyph baseline offset from each box is measured ONCE per resize from the live DOM:
  // the offset (box → glyph baseline) is invariant to the translate-only chart entrance motions, so it is cached and re-applied
  // to the box's CSS anchor at any --uis without per-frame layout reads; the box anchor itself is pure CSS math.
  const uiKey = Math.round(uis * 1000) + '|' + Math.round(S * 1000);
  if (this._recUiKey !== uiKey) {
    this._recUiKey = uiKey;
    const measure = (elId, fontPx) => {
      const el = document.getElementById(elId);
      if (!el) return null;
      ctx.font = Math.round(fontPx) + uiF;
      const m = ctx.measureText(el.textContent && el.textContent.length ? el.textContent : 'A');
      const fbaCss = (m.fontBoundingBoxAscent || 0) / S;
      // The combo number/label live in #combo-area which is display:none until combo>=3; at the first
      // _drawRecHud (chart start) the box is 0x0, so temporarily reveal the hidden ancestor — still
      // invisible — exactly like captureDefaultPositions does, then restore it afterwards.
      const tmpVisible = [];
      const revealHidden = (node) => {
        while (node && node.nodeType === 1) {
          if (getComputedStyle(node).display === 'none') {
            node.style.display = 'block';
            node.style.visibility = 'hidden';
            tmpVisible.push(node);
            return;
          }
          node = node.parentElement;
        }
      };
      const b0 = el.getBoundingClientRect();
      if (!(b0.width || b0.height)) revealHidden(el);
      let rTop = null;
      try {
        const rng = document.createRange();
        rng.selectNodeContents(el);
        const rs = rng.getClientRects();
        rTop = rs && rs.length ? rs[0].top : null;
        if (rng.detach) rng.detach();
      } catch (e) {}
      const b = el.getBoundingClientRect();
      if (!(b.width || b.height)) {
        for (const n of tmpVisible) { n.style.display = ''; n.style.visibility = ''; }
        return null;
      }
      if (rTop === null) rTop = b.top;
      for (const n of tmpVisible) { n.style.display = ''; n.style.visibility = ''; }
      return { topRel: (rTop + fbaCss) - b.top, boxH: b.height };
    };
    const fromBottom = (elId, fontPx) => { const x = measure(elId, fontPx); return (x && x.boxH > 0) ? Math.max(0, x.boxH - x.topRel) : null; };
    const fromTop = (elId, fontPx) => { const x = measure(elId, fontPx); return x ? x.topRel : null; };
    const D = this._recUiD = {};
    D.title = fromBottom('title-display', 24 * uis);
    D.level = fromBottom('difficulty-display', 22 * uis);
    D.score = fromTop('score-display', 36 * uis);
    D.combonumber = fromTop('combo-number', 54 * uis);
    D.combo = fromTop('combo-label', 18 * 0.965 * uis);
  }
  const D = this._recUiD;
  const vhCss = h / S;
  const fallbackA = (fontPx) => Math.round(0.9 * fontPx * 10) / 10 / S;
  // Entrance window (pause / score / name / level only; progress bar, combo number and combo label are excluded). While it
  // lasts, updateUI keeps each element at the position where the last chart binding left it and slides it in with an
  // easeOutExpo translateY on top of its final position.
  const inEntrance = (key) => !!(this.uiEntrance && key !== 'bar' && key !== 'combonumber' && key !== 'combo'
    && Math.max(0, (performance.now() - this.uiEntrance.start) / this.uiEntrance.duration) < 1);
  const entranceDist = this.uiEntrance ? this.uiEntrance.dist : 0;
  const holdFor = (key) => {
    const t = (this.uiTransforms || {})[key];
    let o = offs[key];
    if (!o) o = offs[key] = {};
    if (t && !inEntrance(key)) {
      // Continuous follow: while the chart drives the UI, its position is the judge line's every frame (identical to state
      // `act` in updateUI, so the raster and the DOM never diverge once the entrance is over)
      o.dx = t.dx || 0; o.dy = t.dy || 0;
    } else if (this._uiHold && this._uiHold[key]) {
      // During the entrance the DOM freezes the element where the last binding left it (state `_uiHold`); mirror that offset
      const dp = this.defaultPositions[key];
      o.dx = dp ? (this._uiHold[key].x - dp.left) : 0;
      o.dy = dp ? (this._uiHold[key].y - dp.top) : 0;
    } else {
      o.dx = 0; o.dy = 0;
    }
    return o;
  };
  const drawTF = (key, defFill, cb) => {
    const t = (this.uiTransforms || {})[key];
    const o = holdFor(key);
    let rot = 0, sc = null, alpha = 1, color = null, ey = 0;
    if (t) {
      rot = t.rotation || 0;
      if (t.scaleX !== undefined && t.scaleY !== undefined && (t.scaleX !== 1 || t.scaleY !== 1)) sc = [t.scaleX, t.scaleY];
      if (t.alpha !== undefined) alpha = t.alpha;
      if (t.color) color = t.color;
    }
    if (inEntrance(key)) {
      const et = Math.max(0, (performance.now() - this.uiEntrance.start) / this.uiEntrance.duration);
      const d = (this.uiEntrance.dir && this.uiEntrance.dir[key]) || 1;
      const etC = Math.min(et, 1);
      const eased = etC === 1 ? 1 : 1 - Math.pow(2, -10 * etC);
      ey = Math.round(d * (1 - eased) * entranceDist);
    }
    ctx.save();
    // Rotate/scale about the element's own center (CSS transform-origin:center), not the canvas
    // origin: the DOM applies `transform: translate(dx,dy) rotate(r)` with the element centered, so
    // the raster must pivot at the element center too or the two diverge under chart rotation events.
    const dp = this.defaultPositions[key];
    let pcx = 0, pcy = 0;
    if (dp) {
      // Per-key CSS transform-origin: everything is center except the progress bar which is `left`
      if (key === 'bar') {
        pcx = dp.left || 0;
        pcy = (dp.top || 0) + (window.innerHeight - (dp.top || 0) - (dp.bottom || 0)) / 2;
      } else {
        pcx = (dp.left || 0) + (window.innerWidth - (dp.left || 0) - (dp.right || 0)) / 2;
        pcy = (dp.top || 0) + (window.innerHeight - (dp.top || 0) - (dp.bottom || 0)) / 2;
      }
    }
    ctx.translate(o.dx * S, (o.dy + ey) * S);
    ctx.translate(pcx * S, pcy * S);
    ctx.rotate(rot * Math.PI / 180);
    if (sc) ctx.scale(sc[0], sc[1]);
    ctx.translate(-pcx * S, -pcy * S);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    // Chart color events tint the text; without one the element keeps its default CSS fill
    ctx.fillStyle = color ? 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')' : defFill;
    cb();
    ctx.restore();
  };

  ctx.save();
  ctx.lineJoin = 'round';
  const meta = (this.chart && this.chart.META) || {};
  const name = (meta.name || meta.title || meta.songName || '-').toString();
  const lv = (meta.level !== undefined && meta.level !== null && meta.level !== '') ? String(meta.level) : '-';

  // Title (bottom-left) + difficulty (bottom-right)
  if (name && name !== '-') {
    ctx.textBaseline = 'alphabetic';
    drawTF('name', '#fff', () => {
      ctx.textAlign = 'left';
      ctx.font = (24 * uis) + uiF;
      ctx.fillText(name, 30 * uis, (vhCss - 18 * uisCss - (D.title != null ? D.title : 6 * uisCss)) * S);
    });
  }
  if (lv && lv !== '-') {
    ctx.textBaseline = 'alphabetic';
    drawTF('level', '#fff', () => {
      ctx.font = (22 * uis) + uiF;
      ctx.textAlign = 'right';
      ctx.fillText(lv, w - 30 * uis, (vhCss - 18 * uisCss - (D.level != null ? D.level : 6 * uisCss)) * S);
    });
  }

  // Score (top-right, fixed width 7 digits, tabular)
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  drawTF('score', '#fff', () => {
    let sc;
    try { sc = this.computeScore(); } catch (e) { sc = 0; }
    sc = Math.min(1000000, Math.max(0, sc));
    ctx.font = (36 * uis) + "px 'AppFont','Segoe UI','PingFang SC','Microsoft YaHei','Consolas',monospace";
    ctx.fillText(String(sc).padStart(7, '0'), w - 30 * uis, (20 * uisCss + (D.score != null ? D.score : fallbackA(ctx.font.split('px')[0]))) * S);
  });

  // Combo number + label (top-center); label mirrors updateScoreDisplay (AP / FC / AUTOPLAY / COMBO)
  if (this.combo >= 3) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let label = this.autoplay ? 'AUTOPLAY' : 'COMBO';
    drawTF('combonumber', '#fff', () => {
      ctx.font = (54 * uis) + uiF;
      ctx.fillText(String(this.combo), w / 2, (6 * uisCss + (D.combonumber != null ? D.combonumber : fallbackA(ctx.font.split('px')[0]))) * S);
    });
    drawTF('combo', '#E7E7E7', () => {
      ctx.font = (18 * 0.965 * uis) + uiF;
      ctx.fillText(label, w / 2, (54 * uisCss + (D.combo != null ? D.combo : fallbackA(ctx.font.split('px')[0]))) * S);
    });
  }

  // Top progress bar (#ui-bar): fill = progress, head = white 8px block at the current edge
  const tot = this.totalSeconds > 0 ? this.totalSeconds : 1;
  const prog = Math.min(1, Math.max(0, ct / tot));
  const bh = Math.max(2, 8 * uis);
  drawTF('bar', '#fff', () => {
      ctx.globalAlpha *= 0.8;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(0, 0, w * prog, bh);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 8;
      ctx.fillRect(Math.max(0, w * prog - bh * 0.25), 0, bh * 0.25, bh);
      ctx.shadowBlur = 0;
    });

  // Pause button (top-left, flex-centered 30*uis pause icon). Drawn only for the shading composite (opts.pauseBtn), where the
  // opaque fx output covers the DOM button; at its default position it is unbound, so chart events move it via the same transform.
  if (opts.pauseBtn) {
    ctx.textBaseline = 'alphabetic';
    drawTF('pause', '#fff', () => {
      const isz = 30 * uis;
      const vs = isz / 41;
      const ox = (isz - 37 * vs) / 2;
      ctx.save();
      ctx.translate(30 * uis + ox, 26 * uis);
      ctx.scale(vs, vs);
      ctx.fillRect(0, 0, 11, 39);
      ctx.fillRect(22, 0, 11, 39);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(11, 2); ctx.lineTo(15, 2); ctx.lineTo(15, 41);
      ctx.lineTo(4, 41); ctx.lineTo(4, 39); ctx.lineTo(11, 39);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(33, 2); ctx.lineTo(37, 2); ctx.lineTo(37, 41);
      ctx.lineTo(26, 41); ctx.lineTo(26, 39); ctx.lineTo(33, 39);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }
  ctx.restore();
}
});
