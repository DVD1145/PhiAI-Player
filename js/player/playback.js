// PhiAI-Player || js/player/playback.js
// EnhancedRPEPlayer instance methods (toggleAutoplay, togglePlay, play, playFallback, pause, _streamLoad, _parseStreamBucket, reset, restart, getCurrentTime, getCurrentBeat, resumeWithCountdown, warmupChart, startPreview, animate, updateJudgeLines) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  toggleAutoplay() {
  this.autoplay = !this.autoplay;
  this.updateAutoplayStatus();
},
togglePlay() {
  if (this.isPaused) {
    this.play();
  } else if (this.isPlaying) {
    this.pause(true);
  } else {
    this.play();
  }
},
play() {
  this.hidePauseOverlay();
  if (this.pausedRAF) { cancelAnimationFrame(this.pausedRAF); this.pausedRAF = null; }
  if (this.audioCtx && this.audioCtx.state === 'suspended') {
    this.audioCtx.resume().catch(e => console.warn('AudioContext resume failed', e));
  }
  if (!this.chart) return;
  if (this.isPaused) {
    this.isPaused = false;
    if (this.audio && !this.fallbackMode) {
      this.audio.currentTime = this.pauseOffset;
      this.audio.play().catch(() => { this.fallbackMode = true; this.playFallback(); });
    } else this.playFallback();
    this.isPlaying = true;
    this.pauseBtn.classList.remove('paused');
  } else {
    this.reset();
    this.isPlaying = true;
    this.startTime = performance.now() / 1000;
    if (this.audio) {
      // Clear stale fallback state when restarting / replaying (e.g. the last playback ended early and left fallbackMode = true),
      // otherwise the silent fallback clock keeps running and the music never plays after a replay
      this.fallbackMode = false;
      this.audio.currentTime = 0;
      this.audio.playbackRate = this.speed;
      this.audio.play().catch(() => { this.fallbackMode = true; this.playFallback(); });
    } else { this.fallbackMode = true; this.playFallback(); }
    this.pauseBtn.classList.remove('paused');
  }
  this.lastFrameTime = performance.now();
  this.animate();
},
playFallback() {
  this.fallbackMode = true;
  this.startTime = performance.now() / 1000;
  this.fallbackTime = 0;
},
pause(showOverlay = false) {
  if (!this.isPlaying) return;
  this._sfxQueue.length = 0; // Drop unplayed sounds when pausing, to avoid a burst of noise on resume / when scrubbing the progress bar
  this.isPaused = true;
  this.isPlaying = false;
  if (this.audio && !this.fallbackMode) { this.pauseOffset = this.audio.currentTime; this.audio.pause(); }
  else this.pauseOffset = this.fallbackTime;
  for (const b of this.bgaVideos) if (b.video && !b.video.paused) b.video.pause();
  if (this.animationId) cancelAnimationFrame(this.animationId);
  this.pauseBtn.classList.add('paused');
  if (showOverlay) { this.showPauseOverlay(); this.playSound('tap6'); }
  // Keep rendering while paused: whenever the canvas is cleared (page resize, progress scrubbing, ...) the picture is restored immediately
  const idleLoop = () => {
    if (this.isPlaying) { this.pausedRAF = null; return; }
    try {
      const ct = this.getCurrentTime();
      const cb = secondsToBeat(this.bpmList, Math.max(0, ct - (this.offset || 0)));
      this.render(cb, ct);
    } catch (e) { /* Ignore single-frame errors */ }
    this.pausedRAF = requestAnimationFrame(idleLoop);
  };
  if (this.pausedRAF) cancelAnimationFrame(this.pausedRAF);
  this.pausedRAF = requestAnimationFrame(idleLoop);
},
async _streamLoad(ct) {
  if (!this._noteStream || this._streamLoading) return;
  const winT0 = Math.max(0, ct - 4), winT1 = ct + 10;
  // Only reload when playback is within 6s of the end of the loaded range (or was rewound back to within 2s of its start)
  const needFwd = this._streamLoadedT1 === undefined || ct > this._streamLoadedT1 - 6;
  const needBack = this._streamLoadedT0 !== undefined && ct < this._streamLoadedT0 + 2;
  if (!needFwd && !needBack) return;
  this._streamLoading = true;
  try {
    const ns = this._noteStream;
    const bks = ns.buckets;
    const bpm = this.bpmList || ns.bpmList;
    const bT0 = secondsToBeat(bpm, winT0) - 0.75;
    const bT1 = secondsToBeat(bpm, winT1) + 0.75;
    let lo = 0, hi = bks.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bks[mid].t1 < bT0) lo = mid + 1; else hi = mid - 1; }
    let u0 = lo, u1 = bks.length - 1;
    while (u0 <= u1) { const mid = (u0 + u1) >> 1; if (bks[mid].t0 <= bT1) u0 = mid + 1; else u1 = mid - 1; }
    const out = [];
    const cap = 15000;
    for (let i = lo; i <= u1 && out.length < cap; i++) {
      const b = bks[i];
      if (b.t1 < bT0 || b.t0 > bT1) continue;
      const buf = await ns.file.slice(b.bs, b.be).arrayBuffer();
      const raw = new TextDecoder('utf-8').decode(buf);
      const notes = this._parseStreamBucket(raw, bT0, bT1);
      for (const n of notes) { if (out.length >= cap) break; out.push(n); }
    }
    out.sort((a, b) => a.startTime - b.startTime || a.lineIndex - b.lineIndex);
    const byLine = [];
    for (const n of out) { (byLine[n.lineIndex] = byLine[n.lineIndex] || []).push(n); }
    this._streamWindow = out;
    this._streamWindowByLine = byLine;
    const t0r = out.length ? out[0].startTimeSec : winT0;
    const t1r = out.length ? out[out.length - 1].startTimeSec : winT1;
    this._streamLoadedT0 = t0r;
    this._streamLoadedT1 = t1r;
    this._streamWinT0 = winT0;
    this._streamWinT1 = winT1;
  } catch (e) { console.warn('[Stream] 窗口加载失败:', e); }
  finally { this._streamLoading = false; }
},
_parseStreamBucket(text, bT0, bT1) {
  const out = [];
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    const s = ls[i].trim();
    if (!s) continue;
    const p = s.split(/\s+/);
    const tag = p[0];
    if (tag !== 'n1' && tag !== 'n2' && tag !== 'n3' && tag !== 'n4') continue;
    const isHold = tag === 'n2';
    let speed = 1, width = 1;
    const lastTok = p[p.length - 1];
    if (p[p.length - 2] === '#') speed = parseFloat(lastTok) || 1;
    else if (p[p.length - 2] === '&') width = parseFloat(lastTok) || 1;
    else if (/^#[-+.\d]/.test(lastTok) && p.length >= 7) speed = parseFloat(lastTok.slice(1)) || 1;
    else if (/^&[-+.\d]/.test(lastTok) && p.length >= 7) width = parseFloat(lastTok.slice(1)) || 1;
    for (let j = i + 1; j < ls.length; j++) {
      const c = ls[j].trim();
      if (!c) continue;
      if (c.charAt(0) === '#') { speed = parseFloat(c.slice(1)) || 1; i = j; }
      else if (c.charAt(0) === '&') { width = parseFloat(c.slice(1)) || 1; i = j; }
      else break;
    }
    const st = parseFloat(p[2]) || 0;
    const et = isHold ? ((parseFloat(p[3]) || 0) || st) : st;
    const nx = parseFloat(p[isHold ? 4 : 3]);
    const raw = {
      type: { n1: 1, n2: 2, n3: 3, n4: 4 }[tag],
      startTime: [st, 0, 1],
      endTime: [et, 0, 1],
      positionX: (isNaN(nx) ? 0 : nx) * 675 / 1024,
      above: parseInt(p[isHold ? 5 : 4], 10) === 2 ? 0 : 1,
      speed: speed,
      size: width,
      isFake: parseInt(p[isHold ? 6 : 5], 10) === 1 ? 1 : 0,
    };
    const n = this.buildNoteObject(raw, parseInt(p[1], 10));
    n.startTimeSec = bpmListToSeconds(this.bpmList, n.startTime);
    n.endTimeSec = bpmListToSeconds(this.bpmList, n.endTime);
    if (n.startTime < bT0 || n.startTime > bT1) continue;
    out.push(n);
  }
  return out;
},
reset() {
  this._sfxQueue.length = 0;
  this.counts = [0, 0, 0, 0];
  this.combo = 0;
  this.maxCombo = 0;
  this.judgedNotes.clear();
  if (!this._noteStream) for (const n of this.notes) {
    n.judged = false;
    n.judgeResult = null;
    n.holdActive = false;
    n.holdStarted = false;
    n.holdFinished = false;
    n.holdTriggered = false;
    n.holdUp = null;
    n._slideFile = null;
    n._slideResolved = false;
    n._slideNext = 0;
    n.lastHoldFxTime = null;
  }
  this.judgeEffects = [];
  this.fallbackTime = 0;
  this.updateScoreDisplay();
},
restart() { this.pause(); this.play(); },
getCurrentTime() {
  // While recording, follow the music element (exactly like normal play) so heavy rendering / VP9-encoding
  // frames cannot make the chart clock drift behind the audio. Charts without a music file fall back to the
  // frame-accumulated clock (corrected against wall time in the recording loop). The audio→note sync offset
  // (settings.syncOffsetMs) is applied at the single clock source so judging, rendering, HUD and the progress
  // bar all share one calibrated timeline: a positive value shifts the chart clock forward (notes hit earlier).
  const syncOff = (this.settings && this.settings.syncOffsetMs) || 0;
  if (this._rec && this._recAudioActive && this.audio) return this.audio.currentTime + syncOff / 1000;
  if (this.fallbackMode) return this.fallbackTime + syncOff / 1000;
  if (this.audio) return this.audio.currentTime + syncOff / 1000;
  return (performance.now() / 1000 - this.startTime) * this.speed + syncOff / 1000;
},
getCurrentBeat() {
  const t = this.getCurrentTime();
  return secondsToBeat(this.bpmList, Math.max(0, t - (this.offset || 0)));
},
resumeWithCountdown() {
  if (this._countingDown) return;
  if (!this.isPaused) { this.play(); return; }
  this._countingDown = true;
  const overlay = document.getElementById('pause-overlay');
  const menu = overlay.querySelector('.pause-menu');
  const cdA = document.getElementById('countdown-a');
  const cdB = document.getElementById('countdown-b');
  const expo = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const easeInExpo = 'cubic-bezier(0.7, 0, 0.84, 0)';
  const self = this;
  function enter(el, text) {
    el.textContent = text;
    el.style.transition = 'none';
    el.style.transform = 'translate(-50%, -50%) translateX(5vw)';
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = 'transform 0.5s ' + expo + ', opacity 0.5s ' + expo;
    el.style.transform = 'translate(-50%, -50%)';
    el.style.opacity = '1';
  }
  function exit(el) {
    el.style.transition = 'transform 0.5s ' + expo + ', opacity 0.5s ' + expo;
    el.style.transform = 'translate(-50%, -50%) translateX(-5vw)';
    el.style.opacity = '0';
  }
  menu.style.transition = 'transform 0.5s ' + expo + ', opacity 0.5s ' + expo;
  menu.style.transform = 'translateX(-5vw)';
  menu.style.opacity = '0';
  overlay.style.transition = 'backdrop-filter 3s ' + easeInExpo + ', opacity 0.5s ' + expo;
  overlay.style.backdropFilter = 'blur(20px)';
  void overlay.offsetWidth;
  overlay.style.backdropFilter = 'blur(0px)';
  enter(cdA, '3');
  setTimeout(() => { exit(cdA); enter(cdB, '2'); }, 1000);
  setTimeout(() => { exit(cdB); enter(cdA, '1'); }, 2000);
  setTimeout(() => {
    exit(cdA);
    self._countingDown = false;
    self.play();
    setTimeout(() => {
      overlay.style.transition = ''; overlay.style.backdropFilter = '';
      menu.style.transition = ''; menu.style.transform = ''; menu.style.opacity = '';
      cdA.style.transition = ''; cdA.style.transform = ''; cdA.style.opacity = '';
      cdB.style.transition = ''; cdB.style.transform = ''; cdB.style.opacity = '';
    }, 500);
  }, 3000);
},
warmupChart(maxMs = 2400) {
  if (this._warmupDone || !this.chart) return Promise.resolve();
  this._warmupDone = true;
  const wasAutoplay = this.autoplay;
  const wasMuted = this.muted;
  const wasSfxVol = this.settings.sfxVolume;
  const wasMusicVol = this.settings.musicVolume;
  // Keep the loading page background visible during warm-up: loading-mode hides #load-bg (the background becomes transparent and the
  // picture below shows through), so force the background layer (blurred artwork) to stay visible -- this avoids a black loading page and
  // uses an opaque background image to cover the warm-up frames showing through; the loading-indicator (z-index 1) still sits above it
  const ls = document.getElementById('load-screen');
  const lbg = document.getElementById('load-bg');
  if (lbg) lbg.style.setProperty('display', 'block', 'important');
  const finish = () => {
    // Stop the warm-up animation and fully restore the not-playing state (real play still starts from the beginning of the chart)
    if (this.animationId) { cancelAnimationFrame(this.animationId); this.animationId = null; }
    if (this.pausedRAF) { cancelAnimationFrame(this.pausedRAF); this.pausedRAF = null; }
    this._sfxQueue.length = 0;
    this.counts = [0, 0, 0, 0];
    this.combo = 0;
    this.maxCombo = 0;
    this.judgedNotes.clear();
    this.judgeEffects = [];
    this.fallbackTime = 0;
    this.pauseOffset = 0;
    this.isPaused = false;
    this.isPlaying = false;
    this._suppressJudgeFx = false;   // Restore hit effect rendering for real play
    this.particleEmitters = [];      // Clear the particle bursts created during warm-up so nothing lingers
    this.holdTime = false;
    if (this._noteStream) {
      this._streamWindow = [];
      this._streamWindowByLine = [];
      this._streamLoading = false;
      this._streamLoadedT0 = undefined;
      this._streamLoadedT1 = undefined;
    }
    // Clear judgement leftovers from the warm-up (note objects are re-judged during real play)
    const list = this._noteStream ? (this._streamWindow || []) : this.notes;
    for (const n of list) {
      n.judged = false; n.missed = false; n.judgeResult = null;
      n.snapT = 0; n.opacity = 1;
      n.holdActive = false; n.holdStarted = false; n.holdFinished = false;
      n.holdTriggered = false; n.holdUp = null;
      n.lastHoldFxTime = null;
    }
    // After loading, return the audio to its initial state (paused + reset) so real play starts at the beginning of the chart
    if (this.audio) { try { this.audio.pause(); this.audio.currentTime = 0; } catch (e) { /* Ignore */ } }
    // Restore user settings
    this.autoplay = wasAutoplay;
    this.muted = wasMuted;
    this.settings.sfxVolume = wasSfxVol;
    this.settings.musicVolume = wasMusicVol;
    if (this.audio) this.audio.volume = this.settings.musicVolume;
    if (lbg) lbg.style.display = '';
    // Clear the canvas to solid black so no warm-up frame shows through while the loading page slides out (startPreview renders it again)
    try { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.width, this.height); } catch (e) { /* Ignore */ }
  };
  return new Promise((resolve) => {
    try {
      this.muted = false;              // The sound path must run end to end (silence comes from volume = 0, not from an early muted return)
      this.settings.sfxVolume = 0;     // Sound nodes are still created, they just output 0 -> silence
      this.settings.musicVolume = 0;   // Mute the music
      if (this.audio) this.audio.volume = 0;
      this.autoplay = true;            // Auto judge, preview the first screen of notes
      // Time of the first real note (skipping the decorative fake notes at the intro; covers normal / lazy / streaming modes)
      let t0 = null;
      if (this._noteStream) {
        const b = this._noteStream.buckets;
        if (b && b.length) t0 = b[0].t0;
      } else {
        for (const jl of this.judgeLines) {
          const p = jl.pendingNotes;
          if (p && p.length) {
            for (const pn of p) {
              const raw = pn.raw || pn;
              if (raw.isFake) continue;
              const s = (pn.startTimeSec != null ? pn.startTimeSec : bpmListToSeconds(this.bpmList, raw.startTime)) + (this.offset || 0);
              t0 = t0 == null ? s : Math.min(t0, s);
              break;
            }
          }
        }
        if (t0 == null) {
          for (const n of this.notes) {
            if (n.isFake) continue;
            const s = n.startTimeSec + (this.offset || 0);
            t0 = t0 == null ? s : Math.min(t0, s);
          }
        }
      }
      if (t0 == null) { finish(); resolve(); return; }
      const startT = Math.max(0, t0 - 0.8);
      // Do not start real audio while the loading page is up: unlike play(), the render loop is driven manually here (the equivalent fallback
      // branch) and audio.play() is never called; the audio element stays paused and the timeline runs on the fallback clock
      if (this.audio) { try { this.audio.pause(); } catch (e) { /* Ignore */ } }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(e => console.warn('AudioContext resume failed', e));
      }
      this.holdTime = false;
      this._suppressJudgeFx = true;    // Disable hit effects (hit ring + particles) during warm-up so nothing lingers
      this.reset();
      this.isPlaying = true;
      this.fallbackMode = true;
      this.fallbackTime = startT;
      this.startTime = performance.now() / 1000;
      this.lastFrameTime = performance.now();
      this.animate();
      const judged = () => this.counts[0] + this.counts[1];
      const tStart = performance.now();
      let lastJump = performance.now();
      const tick = () => {
        const now = performance.now();
        if (now - tStart >= maxMs || judged() >= 2) {
          finish();
          resolve();
          return;
        }
        // If the intro fake notes are so long that no real judgement happens, jump 4 seconds ahead and keep warming up
        if (now - lastJump >= 1000) { this.fallbackTime += 4; lastJump = now; }
        setTimeout(tick, 60);
      };
      tick();
    } catch (e) {
      try { finish(); } catch (e2) { /* Ignore */ }
      resolve();
    }
  });
},
startPreview() {
  if (this.animationId) cancelAnimationFrame(this.animationId);
  this.isPlaying = true;
  this.isPaused = false;
  this.fallbackMode = true;
  this.holdTime = true;
  this.reset();
  this.startTime = performance.now() / 1000;
  this.lastFrameTime = performance.now();
  this.animate();
},
animate() {
  if (!this.isPlaying) return;
  this.animationId = requestAnimationFrame(() => this.animate());
  const now = performance.now();
  const dt = (now - this.lastFrameTime) / 1000;
  this.lastFrameTime = now;
  if (this.fallbackMode && !this.holdTime) this.fallbackTime += dt * this.speed;

  const ct = this.getCurrentTime();
  const cb = secondsToBeat(this.bpmList, Math.max(0, ct - (this.offset || 0)));

  this.updateJudgeLines(cb, ct);
  this.updateBGA(ct);
  // Inside the per-note loop only enqueue sounds (playSound no longer plays immediately); flush the SFX layer once after the loop,
  // so high-density charts never create a flood of AudioNodes within a single frame
  this._sfxInNoteLoop = true;
  try { this.updateNotes(cb, ct); }
  finally { this._sfxInNoteLoop = false; }
  this.flushSfx();
  this.updateEffects(dt);
  this.updateLyric(ct);
  this.render(cb, ct);
  this.updateFX(cb, ct - (this.offset || 0), dt);
  this.updateScoreDisplay();
  if (ct >= this.totalSeconds) {
    this.isPlaying = false;
    this.pauseBtn.classList.add('paused');
    this.hideFX();
    const head = this._barHeadEl || (this._barHeadEl = document.getElementById('ui-bar-head'));
    if (head) head.style.opacity = '0';
  }
},
updateJudgeLines(beat, currentTime) {
  // Parent line chain (same semantics as the reference fetch_pos/fetch_rot):
  //   final position = parent final position + R(-1 × parent rotation) * this line's local position   (Phira/prpr fetch_pos)
  //   final rotation = parent final rotation + this line's local rotation   (only when rotateWithFather && followFatherRotate)
  const resolveParentChain = (l) => {
    if (l._pcResolved) return;
    l._pcResolved = true;
    const pi = l.parent;
    if (pi >= 0 && pi !== l.index && pi < this.judgeLines.length) {
      const p = this.judgeLines[pi];
      resolveParentChain(p);
      const pa = p._pcRotation * Math.PI / 180;
      const cos = Math.cos(pa), sin = Math.sin(pa);
      // rotateWithFather (chart field) together with the global switch followFatherRotate decides whether the parent rotation is applied
      l._pcRotation = l.rotation + (l.rotateWithFather && this.settings.followFatherRotate ? p._pcRotation : 0);
      // Child offset matches the reference engine exactly (Phira/prpr fetch_pos): parent pos + R2(fetch_rot)·local, where the
      // parent fetch_rot = -1×(our parent rotation) and the frame is y-up. In our canvas coords that is R(-pa), i.e.
      // dx = X·cos + Y·sin, dy = -X·sin + Y·cos (identity at pa=0; numerically verified =0 vs a prpr replica at ±20°/±90°).
      l._pcPosX = p._pcPosX + l.posX * cos + l.posY * sin;
      l._pcPosY = p._pcPosY - l.posX * sin + l.posY * cos;
      l.posX = l._pcPosX; l.posY = l._pcPosY; l.rotation = l._pcRotation;
    } else {
      l._pcPosX = l.posX; l._pcPosY = l.posY; l._pcRotation = l.rotation;
    }
  };
  for (const jl of this.judgeLines) {
    const ev = jl.events;
    // Timeline of a bpmfactor line: line beat = global beat / bpmfactor (line BPM = root BPM / bpmfactor)
    const lb = beat / (jl.bpmFactor || 1);
    jl.posX = sumLayers(jl.layered.X, lb);
    jl.posY = sumLayers(jl.layered.Y, lb) + (jl.yOffset || 0);
    jl.rotation = sumLayers(jl.layered.R, lb);
    // Alpha may be negative (a deprecated yet valid RPE feature): a negative value hides the line and every note on it (the render loop skips alpha < 0), never clamp it to 0
    jl.alpha = jl.layered.A.length ? sumLayers(jl.layered.A, lb) : 255;
    jl.color = evaluateEvent(jl.colorEvents, lb, [255, 255, 255]);
    // Incline events (extended.inclineEvents): evaluate the angle (in line beats); the sin value scales note X
    jl.incline = evaluateEvent(jl.inclineEvents, lb, 0) || 0;
    jl.inclineSin = Math.sin(jl.incline * Math.PI / 180);
    // After parsing, line scale events carry startTime in seconds (converted by the line bpmfactor) and must be compared against global seconds; other events use line beats
    jl.scaleX = evaluateEvent(jl.scaleXEvents, currentTime, 1);
    jl.scaleY = evaluateEvent(jl.scaleYEvents, currentTime, 1);

    // gifEvents: GIF playback progress control (beat domain). If the current line beat falls inside an event span -> interpolate the progress; otherwise -1 = auto loop
    let gp = -1;
    if (jl.gifEvents && jl.gifEvents.length > 0) {
      for (const ev of jl.gifEvents) {
        if (lb >= ev.startBeat && lb <= ev.endBeat) {
          const span = ev.endBeat - ev.startBeat;
          const t = span <= 0 ? 1 : (lb - ev.startBeat) / span;
          const gl = ev.easingLeft ?? 0, gr = ev.easingRight ?? 1;
          let tn = gl + (gr - gl) * t; tn = Math.max(0, Math.min(1, tn));
          const gv = (ev.bezier === 1) ? bezierEase(ev.bezierPoints, tn) : (Easing[Math.max(1, ev.easingType)] || Easing[1])(tn);
          gp = ev.start + (ev.end - ev.start) * gv;
          break;
        }
      }
    }
    jl.gifProgress = gp;
    if (jl.isGif && this.gifFrameCache) {
      const gc = this.gifFrameCache[this.assetKey(jl.texture)] || this.gifFrameCache[jl.texture];
      if (gc && gc.frames && gc.frames.length) {
        let fi = 0;
        if (gp >= 0 && gp <= 1) {
          fi = Math.min(gc.frames.length - 1, Math.round(gp * (gc.frames.length - 1)));
        } else {
          let total = 0;
          for (const d of gc.delays) total += d;
          if (total > 0) {
            const tms = Math.max(0, currentTime) * 1000;
            let acc = ((tms % total) + total) % total;
            fi = 0;
            for (let i = 0; i < gc.delays.length; i++) {
              if (acc < gc.delays[i]) { fi = i; break; }
              acc -= gc.delays[i];
            }
          }
        }
        jl.gifFrameIndex = fi;
      }
    }

    let text = jl.currentText;
    if (jl.textEvents && jl.textEvents.length > 0) {
      let activeEvent = null;
      for (const ev of jl.textEvents) {
        if (currentTime >= ev.startTime && currentTime <= ev.endTime) {
          activeEvent = ev;
          break;
        }
      }
      if (activeEvent) {
        const ev = activeEvent;
        const progress = (ev.endTime - ev.startTime) <= 0 ? 1 : (currentTime - ev.startTime) / (ev.endTime - ev.startTime);
        const t = Math.max(0, Math.min(1, progress));
        const tl = ev.easingLeft ?? 0, tr = ev.easingRight ?? 1;
        let tn = tl + (tr - tl) * t; tn = Math.max(0, Math.min(1, tn));
        const easedT = (ev.bezier === 1) ? bezierEase(ev.bezierPoints, tn) : (Easing[Math.max(1, ev.easingType)] || Easing[1])(tn);
        text = interpolateText(ev.start, ev.end, easedT);
      }
    }
    jl.currentText = text;
  }
  // Once every line has evaluated this frame's events, apply the parent line chain in one pass (parents use this frame's values, avoiding one-frame lag / seek glitches)
  for (const jl of this.judgeLines) jl._pcResolved = false;
  for (const jl of this.judgeLines) resolveParentChain(jl);
  for (const jl of this.judgeLines) {
    if (jl.isUIControl && jl.attachUI) {
      const [sx, sy] = this.toScreen(jl.posX, jl.posY);
      const centerX = this.width / 2;
      const centerY = this.height / 2;
      const dx = sx - centerX;
      const dy = sy - centerY;
      let isPosActive = false;
      const checkIntervals = (intervals) => {
        for (const iv of intervals) {
          if (currentTime >= iv.start && currentTime <= iv.end) return true;
        }
        return false;
      };
      if (jl.moveXIntervals.length > 0 || jl.moveYIntervals.length > 0) {
        isPosActive = checkIntervals(jl.moveXIntervals) || checkIntervals(jl.moveYIntervals);
      }
      // While chart events drive the UI (move / rotate / opacity, any of them) disable CSS transitions so angle / opacity / coordinates are not stacked by transitions
      const isChartActive = isPosActive || checkIntervals(jl.rotateIntervals || []) || checkIntervals(jl.alphaIntervals || []);

      this.uiTransforms[jl.attachUI] = {
        dx: dx,
        dy: dy,
        rotation: jl.rotation,
        alpha: jl.alpha / 255,
        isPosActive: isPosActive,
        isChartActive: isChartActive,
        color: (jl.colorEvents && jl.colorEvents.length) ? (Array.isArray(jl.color) ? jl.color : [255, 255, 255]) : null,
        scaleX: jl.scaleX,
        scaleY: jl.scaleY,
      };
    }
  }
}
});
