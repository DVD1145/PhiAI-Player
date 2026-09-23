// PhiAI-Player || js/player/judgement.js
// EnhancedRPEPlayer instance methods (judgeNoteTime, noteSoundKey, playNoteSounds, evalControl, commitJudgement, updateNotes, judgeNote, judgeFXPos, addJudgeEffect, hexToRgb, updateEffects) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  judgeNoteTime(timeDiff, note) {
  const ja = (note && note.judgeArea) || 1;
  const absDiff = Math.abs(timeDiff) / ja;
  if (absDiff <= this.LIMIT_PERFECT) return 'PERFECT';
  if (absDiff <= this.LIMIT_GOOD) return 'GOOD';
  if (absDiff <= this.LIMIT_BAD) return 'BAD';
  return 'MISS';
},
noteSoundKey(note) {
  if (this.settings.chartHitsounds && note.hitsound && this.hitsoundMap[note.hitsound]) return this.hitsoundMap[note.hitsound];
  return { 1: 'click', 3: 'flick', 4: 'drag' }[note.type] || 'click';
},
playNoteSounds(note) {
  if (!this.settings.chartHitsounds) return false;
  if (note.hitsound && this.hitsoundMap[note.hitsound]) {
    this.playSound(this.hitsoundMap[note.hitsound]);
    return true;
  }
  return false;
},
evalControl(control, x, field, def, xMax) {
  if (!control || control.length === 0) return def;
  if (x <= control[0].x) return control[0][field] ?? def;
  const last = control[control.length - 1];
  if (x >= last.x) return last[field] ?? def;
  // RPE control events use x = 9999999 as an 'infinitely far' end sentinel (e.g. skewControl [x=0 -> 0.1, x=9999999 -> 0],
  // meaning '0 far away -> 0.1 at the judge line' as a full-range gradient). Interpolating the literal value gives t = (x-0)/(9999999-0) ~= 0,
  // so the gradient would never take effect and would always return the value at x = 0. The sentinel endpoint is therefore normalized
  // by the note's actual maximum distance xMax, letting the 'far value -> line value' gradient span the whole flight; non-sentinel spans keep plain linear interpolation.
  const SENTINEL = 9999999;
  for (let i = 0; i < control.length - 1; i++) {
    const a = control[i], b = control[i + 1];
    if (x >= a.x && x <= b.x) {
      const va = a[field] ?? def, vb = b[field] ?? def;
      let t;
      if (b.x >= SENTINEL) {
        const lo = Math.max(a.x, 0);
        const hi = Math.max(lo + 1e-6, (xMax && xMax > 0) ? xMax : 1);
        t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
      } else {
        const span = b.x - a.x;
        t = span <= 0 ? 1 : (x - a.x) / span;
      }
      // A control event's easing applies to the span ending at its x, so use the easing of the next keyframe b
      const fn = Easing[Math.max(1, b.easing || 1)] || Easing[1];
      return va + (vb - va) * fn(t);
    }
  }
  return last[field] ?? def;
},
commitJudgement(judgement) {
  const idx = { PERFECT: 0, GOOD: 1, BAD: 2, MISS: 3 }[judgement];
  this.counts[idx]++;
  if (judgement === 'PERFECT' || judgement === 'GOOD') {
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
  } else {
    this.combo = 0;
  }
},
updateNotes(beat, ct) {
  const baseSpeed = 40 * (this.phiSpeedScale || 1);
  const offsetSec = this.holdOffset;
  if (this._noteStream) this._streamLoad(ct);
  // A seek (progress scrub, restart, jump) moves the clock discontinuously, so run one
  // unrestricted pass to let judgement bookkeeping catch up before windowing resumes.
  // The very first frame counts as a seek too: with no previous timestamp there is no
  // baseline, and windowing before any note has been settled would drop verdicts.
  if (this._lastNoteCt === undefined || Math.abs(ct - this._lastNoteCt) > 0.35) this._fullNotePass = 2;
  if (this._fullNotePass > 0) this._fullNotePass--;
  this._lastNoteCt = ct;
  const __winActive = !this._noteStream && !(this._fullNotePass > 0);
  // Active-note window radius, in chart units: anything further than this from its judge
  // line lies outside the draw cull radius used by drawNotesOnLine.
  let __visDist = Infinity;
  if (__winActive) {
    // The cull radius is compared to note distances in CSS px (note.localY * this.scaleY),
    // so it must use the CSS-px canvas size (this.width/this.height). canvas.width/height is
    // the device-px backing store (rect * dpr) and would inflate the radius with the page
    // zoom / display scale, hiding notes that are still on screen.
    // The 400px margin is kept constant in device px (= 400 * dpr is physical px): a fixed
    // CSS-px margin would shrink with scaleY at high zoom and silently enlarge the chart-unit
    // window below (__visDist), making which notes are updated depend on the page zoom.
    const __cvw = (this.width || (this.canvas && this.canvas.width)) || 1280;
    const __cvh = (this.height || (this.canvas && this.canvas.height)) || 720;
    const __cullR = Math.sqrt(__cvw * __cvw + __cvh * __cvh) / 2 + 400 / (this._dpr || 1);
    __visDist = __cullR / (this.scaleY || 1) * 1.15 + 150;
  }

  // Only walk the note tracks around the current playback position each frame; the remaining notes in the window (future notes sorted later)
  // are skipped with a plain break / cheap skip, so high-density charts do not shift or draw tens of thousands of notes every frame.
  // Pre-compute the per-line rotation trig once: the note loop below reuses line._cos/_sin (line 222), so every note on the
  // line avoids two Math.cos/Math.sin calls per frame (this used to happen on every loaded (non-stream) chart, where the
  // cache was never filled because the stream-only guard above was the only place that filled it).
  for (const jl of this.judgeLines) {
    const a = jl.rotation * Math.PI / 180;
    jl._cos = Math.cos(a);
    jl._sin = Math.sin(a);
  }

  const __noteList = this._noteStream ? (this._streamWindow || []) : this.notes;
  let __noteCnt = 0;
  for (const note of __noteList) {
    if (this._noteStream && ++__noteCnt > 15000) break;
    if (this._noteStream) {
      const __bd = note.startTime - beat;
      if (__bd > 30) break;
      if (__bd < -8) {
        const __skip = note.type === 2 ? (note.holdFinished || note.judged) : true;
        if (__skip) {
          if (!note.judged && !note.missed && !note.isFake && note.type !== 2) {
            note.missed = true;
            this.commitJudgement('MISS');
          }
          continue;
        }
      }
    }
    if (note.judged && note.type !== 2) {
      if (note.snapT > 0) {
        note.snapT--;
        note.localY = note.localY * 0.62;
        const sjl = this.judgeLines[note.lineIndex];
        const sRad = (sjl.rotation || 0) * Math.PI / 180;
        const cA = Math.cos(sRad), sA = Math.sin(sRad);
        const wX = note.localX * cA - note.localY * sA;
        const wY = note.localX * sA + note.localY * cA;
        note.screenX = this.width / 2 + (sjl.posX + wX) * this.scaleX;
        note.screenY = this.height / 2 - (sjl.posY + wY) * this.scaleY;
      }
      continue;
    }
    // Fade out when a hold breaks
    if (note.holdBroken && note.snapT > 0) {
      note.snapT--;
      note.opacity = note.snapT / 10;
      if (note.snapT <= 0) note.holdFinished = true;
      continue;
    }
    // Finished holds and MISSed notes that are far past the judge line no longer take part in any per-frame computation (performance)
    if (note.judged && note.type === 2 && note.holdFinished) continue;
    const line = this.judgeLines[note.lineIndex];
    // bpmfactor lines: note positions advance on the line timeline (line beat = global beat / bpmfactor)
    const lb = beat / (line.bpmFactor || 1);
    if (note.missed && (note.startTime - lb) < -30) continue;
    const beatDiff = note.startTime - lb;
    const spd = note.speed || 1.0;
    const ja = note.judgeArea || 1;
    const floorDiff = line.speedFloor ? speedFloorAt(line.speedFloor, note.startTime) - speedFloorAt(line.speedFloor, lb) : beatDiff;
    const dist = floorDiff * baseSpeed * spd * (this.settings.flowSpeed || 1);
    // Negative flow (core): while the speed floor is decreasing, notes that have not reached
    // the judge line yet (beatDiff > 0) sit on the BACK side of the line (dist < 0). Official
    // previews / prpr draw only the front side, so those notes are invisible during the
    // negative-flow approach; they reappear once the floor recovers. Applies to RPE too.
    note._flowBack = (dist < 0 && beatDiff > 0);
    // Active-note windowing: a note further than the draw cull radius from its judge line
    // can neither be seen nor judged this frame, so skip the expensive remainder (control
    // evaluation, trigonometry, screen projection, opacity, miss bookkeeping). Long charts
    // keep thousands of notes alive and updating all of them every frame dominated the
    // frame budget, although almost all of them sit far off-screen.
    if (__winActive) {
      // Active-note windowing, judged against the note's ESTIMATED on-canvas position
      // (line centre + note's chart offset projected to screen, rotation ignored for the
      // estimate): a line whose posY is far from the canvas centre must not hide notes
      // that are actually on screen. dist is the note's offset from the line centre in
      // chart units (mirrors localY's sign), so its on-screen offset is ~ dist*scaleY on
      // the line's axis. Any note whose estimate is within the viewport rect inflated by
      // winVisM is retained so its position is updated and it can be drawn; far off-screen
      // notes fall through to the strict distance check (which also honours miss
      // bookkeeping for settled past notes).
      const __winVisM = 400;
      const __lineSX = this.width / 2 + (line.posX || 0) * this.scaleX;
      const __lineSY = this.height / 2 - (line.posY || 0) * this.scaleY;
      const __dirE = (note.above === 1 ? 1 : -1);
      const __estSX = __lineSX + (note.positionX || 0) * this.scaleX;
      const __estSY = __lineSY - __dirE * dist * this.scaleY;
      const __onScreen =
        __estSX >= -__winVisM && __estSX <= this.width + __winVisM &&
        __estSY >= -__winVisM && __estSY <= this.height + __winVisM;
      // Notes that already flew past the judge line are invisible, but they still owe a
      // verdict: skipping them outright would silently drop their MISS bookkeeping and
      // inflate combo and score. So only skip a past note once it has been settled --
      // missed, fake, or a hold that finished. Notes that are merely far in the future
      // are safe to skip: they can neither be seen nor judged yet.
      const __past = dist < -__visDist;
      const __settled = note.isFake || note.missed || (note.type === 2 && note.holdFinished);
      if (!note.holdActive && !__onScreen && (dist > __visDist || (__past && __settled))) {
        note._winSkip = true;
        continue;
      }
      note._winSkip = false;
    } else if (note._winSkip) {
      note._winSkip = false;
    }
    const dir = note.above === 1 ? 1 : -1;
    // dir is the fall direction: above-notes approach from the front (positive localY) side.
    // Negative flow puts future notes on the BACK side instead; that is handled by
    // note._flowBack (drawn-side skip), and localY must NOT be flipped here or back-side
    // notes would be mirrored onto the front side where the official preview never shows them.
    const _dirEff = dir;

    // RPE Controls: keyframe-driven by note distance to line (y units, absolute)
    // Controls are defined on the judge line, apply to all notes on this line
    // RPE Controls: keyframe-driven by note distance to line (in chart height units)
    // ctrlX = (note.height - line_height) * RPE_HEIGHT/2 + yOffset, consistent with chart units
    const ctrlX = floorDiff * baseSpeed + (note.yOffset || 0);
    // Record the maximum distance between the note and the judge line: lets control events with a sentinel (9999999) endpoint interpolate across the full range
    if (ctrlX > note.ctrlXMax) note.ctrlXMax = ctrlX;
    const isHold = note.type === 2;
    if (line.alphaControl) note.controlAlpha = this.evalControl(line.alphaControl, ctrlX, 'alpha', 1, note.ctrlXMax);
    if (line.sizeControl) note.controlSize = this.evalControl(line.sizeControl, ctrlX, 'size', 1, note.ctrlXMax); // sizeControl drives the line width, holds included (per the RPE spec)
    if (line.posControl && !isHold) note.controlPos = this.evalControl(line.posControl, ctrlX, 'pos', 1, note.ctrlXMax); // Holds are not affected by pos (per the RPE spec)
    if (line.yControl) note.controlY = this.evalControl(line.yControl, ctrlX, 'y', 1, note.ctrlXMax); // y is a fall-speed multiplier, default 1
    if (line.skewControl && !isHold) note.controlSkew = this.evalControl(line.skewControl, ctrlX, 'skew', 0, note.ctrlXMax); // skew has no effect on holds (per the RPE spec)

    note.localX = note.positionX * (note.controlPos || 1);
    note.localY = (_dirEff * dist * (note.controlY || 1) + (note.yOffset || 0));

    const angleRad = line.rotation * Math.PI / 180;
    const cosA = line._cos !== undefined ? line._cos : Math.cos(angleRad);
    const sinA = line._sin !== undefined ? line._sin : Math.sin(angleRad);
    const worldX = note.localX * cosA - note.localY * sinA;
    const worldY = note.localX * sinA + note.localY * cosA;
    // Inlined toScreen: avoids allocating a two-element array for every note every frame
    note.screenX = this.width / 2 + (line.posX + worldX) * this.scaleX;
    note.screenY = this.height / 2 - (line.posY + worldY) * this.scaleY;

    if (note.spawnFading) {
      // Fade in from opacity 0 to 1 within 0.2s after being lazily spawned
      const fadeDt = ct - note.spawnAtSec;
      if (fadeDt >= 0.2) { note.spawnFading = false; note.opacity = 1; }
      else note.opacity = Math.max(0, Math.min(1, fadeDt / 0.2));
    } else {
      const vis = note.visibleTime || 999;
      note.opacity = (note.startTimeSec + (this.offset || 0) - ct) < vis ? 1 : 0;
    }

    if (this.autoplay && !note.isFake) {
      if (note.type === 2) {
        const startTimeSec = note.startTimeSec + (this.offset || 0);
        const endTimeSec = note.endTimeSec + (this.offset || 0);
        if (!note.holdTriggered && ct >= startTimeSec) {
          note.holdTriggered = true;
          note.holdStarted = true;
          note.holdActive = true;
          if (!this.playNoteSounds(note)) {
            if (this.holdSFXEnabled && this.audioBuffers['hold']) this.playSound('hold');
            else this.playSound('click');
          }
          const [fx, fy] = this.judgeFXPos(note);
          this.addJudgeEffect(fx, fy, 'PERFECT', note.tint, line.rotation, note.tintHitEffects);
        }
        if (note.holdActive && !note.judged && ct >= endTimeSec) {
          note.judged = true;
          note.holdActive = false;
          note.holdFinished = true;
          this.counts[0]++;
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;

          const tailBeatDiff = note.endTime - beat;
          const tailFloorDiff = line.speedFloor ? speedFloorAt(line.speedFloor, note.endTime) - speedFloorAt(line.speedFloor, beat) : tailBeatDiff;
          const tailDist = tailFloorDiff * baseSpeed * spd * (this.settings.flowSpeed || 1);
          const tailLocalY = dir * tailDist + (note.yOffset || 0);
          const tailWorldX = note.positionX * cosA - tailLocalY * sinA;
          const tailWorldY = note.positionX * sinA + tailLocalY * cosA;
          const [tailSX, tailSY] = this.toScreen(line.posX + tailWorldX, line.posY + tailWorldY);

          const [tfx, tfy] = this.judgeFXPos(note, tailSX, tailSY);
          this.addJudgeEffect(tfx, tfy, 'PERFECT', note.tint, line.rotation, note.tintHitEffects);
        }
        if (!note.holdTriggered && !note.judged && ct > startTimeSec + this.LIMIT_BAD * ja) {
          note.judged = true;
          this.counts[3]++;
          this.combo = 0;
          const [mfX, mfY] = this.judgeFXPos(note);
          this.addJudgeEffect(mfX, mfY, 'MISS', note.tint, line.rotation, note.tintHitEffects);
        }
      } else {
        if (!note.judged) {
          const targetTime = note.startTimeSec + (this.offset || 0);
          const timeDiff = ct - targetTime;
          if (timeDiff >= 0) {
            const judgement = this.judgeNoteTime(timeDiff, note);
            this.judgeNote(note, judgement);
          }
        }
      }
    }

    if (!this.autoplay && note.type === 2 && !note.isFake) {
      const hStartSec = note.startTimeSec + (this.offset || 0);
      if (!note.holdStarted && !note.judged && ct > hStartSec + this.LIMIT_BAD * ja) {
        note.judged = true;
        this.commitJudgement('MISS');
      } else if (note.holdActive && !note.judged) {
        const hEndSec = note.endTimeSec + (this.offset || 0);
        // Hold condition: any keyboard key is held, or a touching finger is near the hold's judge line
        const holdW = this.noteHitRadius(note);
        let held = this.keyDownCount > 0;
        if (!held) {
          for (const f of this.activeFingers.values()) {
            if (Math.abs(note.screenX - f.x) <= holdW) { held = true; break; }
          }
        }
        if (held) {
          note.holdUp = null;
        } else if (note.holdUp == null) {
          note.holdUp = ct;
        }
        if (ct >= hEndSec) {
          if (held || (note.holdUp != null && ct - note.holdUp <= this.UP_TOLERANCE)) {
            note.holdActive = false;
            note.judged = true;
            note.holdFinished = true;
            this.commitJudgement('PERFECT');
          } else {
            note.judged = true;
            note.holdActive = false;
            note.holdBroken = true;
            note.breakBeat = secondsToBeat(this.bpmList, Math.max(0, ct - (this.offset || 0)));
            note.snapT = 10;
            this.commitJudgement('MISS');
          }
        } else if (note.holdUp != null && ct - note.holdUp > this.UP_TOLERANCE) {
          note.judged = true;
          note.holdActive = false;
          note.holdBroken = true;
          note.breakBeat = secondsToBeat(this.bpmList, Math.max(0, ct - (this.offset || 0)));
          note.snapT = 10;
          this.commitJudgement('MISS');
        }
      }
    }

    // Spawn a hit effect once per line beat while a hold lasts (interval = 60/lineBpm s, matching the
    // reference Phigros behavior); falls back to every 0.5s when no per-line BPM is known (RPE charts).
    if (note.type === 2 && note.holdActive && !note.judged && !note.holdBroken && !note.isFake) {
      const fxBpm = line.bpm || 0;
      const fxInterval = fxBpm > 0 ? 60 / fxBpm : 0.5;
      if (note.lastHoldFxTime == null) note.lastHoldFxTime = ct;
      if (ct - note.lastHoldFxTime >= fxInterval) {
        note.lastHoldFxTime = ct;
        const [hfx, hfy] = this.judgeFXPos(note);
        this.addJudgeEffect(hfx, hfy, 'PERFECT', note.tint, line.rotation, note.tintHitEffects);
      }
    }

    if (!this.autoplay && (note.type === 3 || note.type === 4) && !note.isFake && !note.judged) {
      const targetSec = note.startTimeSec + (this.offset || 0);
      const diff = ct - targetSec;
      if (diff >= 0 && diff <= this.LIMIT_BAD * ja) {
      const hitW = this.noteHitRadius(note);
        const w = note.type === 4 ? hitW * 1.8 : hitW;
        let ok = false;
        if (this.keyDownCount > 0) {
          ok = true;
        } else {
          for (const f of this.activeFingers.values()) {
            const atX = Math.abs(note.screenX - f.x) <= w;
            if (note.type === 3) {
              if (!atX && Math.abs(note.screenX - f.startX) > w) continue;
            } else if (!atX) {
              continue;
            }
            if (note.type === 3 && !f.swiped) continue;
            ok = true;
            if (note.type === 3) f.swiped = false;
            break;
          }
        }
        if (ok) this.judgeNote(note, 'PERFECT');
      }
    }

    // Fake notes: no judgement, no hit effect, no sound, no score, never marked judged; they always render and fall off-screen naturally
    if (!note.judged && !note.missed && !note.isFake && note.type !== 2) {
      const nt = note.startTimeSec;
      const targetTime = nt + (this.offset || 0);
      if (ct > targetTime + this.LIMIT_BAD * ja) {
        note.missed = true;
        this.commitJudgement('MISS');
      }
    }
  }
},
judgeNote(note, judgement) {
  if (note.judged) return;
  note.judged = true;
  note.judgeResult = judgement;
  note.snapT = 8;
  this.commitJudgement(judgement);
  const [fx, fy] = this.judgeFXPos(note);
  this.addJudgeEffect(fx, fy, judgement, note.tint, this.judgeLines[note.lineIndex].rotation, note.tintHitEffects);
  if (!this.playNoteSounds(note)) this.playSound(this.noteSoundKey(note));
},
judgeFXPos(note, x = note.screenX, sy = note.screenY) {
  // Hit effects land on the judge line where the note is hit. The note may be slightly before
  // (early window) or past (late window) the line when judged, so projecting the note's screen
  // position perpendicularly onto the line (nearest point) keeps the ring/particles glued to the
  // line, following the line's rotation and the note's local x -- instead of lagging beside the
  // note (raw screenY) or sliding along the line by tan() (the old x-only projection).
  if (x == null) x = note.screenX;
  if (sy == null && note.screenY != null) sy = note.screenY;
  const jl = this.judgeLines[note.lineIndex];
  if (!jl) return [x, sy || 0];
  const [lcx, lcy] = this.judgeLineToScreen(jl);
  if (sy == null) sy = lcy;
  const a = (jl.rotation || 0) * Math.PI / 180;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const dx = x - lcx, dy = sy - lcy;
  const dot = dx * cosA + dy * sinA;
  return [lcx + cosA * dot, lcy + sinA * dot];
},
addJudgeEffect(x, y, result, noteColor, lineRotationDeg = 0, fixCol = null) {
  if (!this.settings.particleEffect || (this.hitFxAtlasConfig && this.hitFxAtlasConfig.hideParticles)) {
    //  Hit ring only, no particles
    const config = this.hitFxAtlasConfig;
    let finalColor = [255, 236, 159];
    if (result === 'PERFECT' && this.colorPerfect) {
      const c = this.hexToRgb(this.colorPerfect);
      if (c) finalColor = c;
    } else if (result === 'GOOD' && this.colorGood) {
      const c = this.hexToRgb(this.colorGood);
      if (c) finalColor = c;
    } else {
      finalColor = [255, 236, 159];
    }
    if (fixCol) finalColor = fixCol;
    let hitFxImg = this.hitFxImage;
    if (result === 'GOOD' && this.goodHitFxImage && this.goodHitFxImage.complete) {
      hitFxImg = this.goodHitFxImage;
    }
    let totalFrames = config ? config.totalFrames : 1;
    let duration = config ? config.duration : 0.4;
    let scale = config ? config.scale : 1.0;
    const rot = (config && config.rotate) ? lineRotationDeg * Math.PI / 180 : 0;
    const radius = 30 * this.noteScale * scale * (this.scaleX || 1) * (this.settings.hitFxScale ?? 1);
    this.judgeEffects.push({
      x, y, life: 1.0, maxLife: duration, result, color: finalColor,
      radius, frame: 0, totalFrames,
      cols: config ? config.cols : 1,
      rows: config ? config.rows : 1,
      rot: rot, scale, image: hitFxImg, tinted: config ? config.hitFxTinted !== false : true,
    });
    return;
  }

  const config = this.hitFxAtlasConfig;
  let finalColor = [255, 236, 159];

  if (result === 'PERFECT') {
    if (this.colorPerfect) {
      const c = this.hexToRgb(this.colorPerfect);
      if (c) finalColor = c;
    }
  } else if (result === 'GOOD') {
    if (this.colorGood) {
      const c = this.hexToRgb(this.colorGood);
      if (c) finalColor = c;
    } else {
      finalColor = [180, 225, 255];
    }
  } else {
    finalColor = [255, 236, 159];
  }
  if (fixCol) finalColor = fixCol;

  const particleConfig = {
    localCoords: false,
    emissionShape: 'point',
    oneShot: true,
    lifetime: 3,
    lifetimeRandomness: 0.2,
    amount: 4,
    explosiveness: 0.5,
    emitting: true,
    initialDirection: { x: 0, y: 0 },
    initialDirectionSpread: Math.PI * 2,
    initialVelocity: 420 * (this.scaleX || 1),
    initialVelocityRandomness: 0.1,
    linearAccel: 0,
    initialRotation: 0,
    initialRotationRandomness: 0,
    initialAngularVelocity: 0,
    initialAngularVelocityRandomness: 0,
    angularAccel: 0,
    angularDamping: 0,
    size: 24 * (this.scaleX || 1),
    sizeRandomness: 0,
    blendMode: 'alpha',
    baseColor: { r: finalColor[0]/255, g: finalColor[1]/255, b: finalColor[2]/255, a: 1 },
    colorsCurve: {
      start: { r: finalColor[0]/255, g: finalColor[1]/255, b: finalColor[2]/255, a: 1 },
      mid: { r: finalColor[0]/255, g: finalColor[1]/255, b: finalColor[2]/255, a: 0.5 },
      end: { r: finalColor[0]/255, g: finalColor[1]/255, b: finalColor[2]/255, a: 0 }
    },
    gravity: { x: 0, y: 0 },
    texture: null,
    atlas: null,
    shape: 'rect',
  };
  const emitter = new ParticleEmitter(particleConfig);
  emitter.emit({ x, y }, 4);
  this.particleEmitters.push(emitter);

  let hitFxImg = this.hitFxImage;
  if (result === 'GOOD' && this.goodHitFxImage && this.goodHitFxImage.complete) {
    hitFxImg = this.goodHitFxImage;
  }

  let totalFrames = config ? config.totalFrames : 1;
  let duration = config ? config.duration : 0.4;
  let scale = config ? config.scale : 1.0;
  const rot = (config && config.rotate) ? lineRotationDeg * Math.PI / 180 : 0;
  const radius = 30 * this.noteScale * scale * (this.scaleX || 1) * (this.settings.hitFxScale ?? 1);
  this.judgeEffects.push({
    x, y,
    life: 1.0,
    maxLife: duration,
    result,
    color: finalColor,
    radius,
    frame: 0,
    totalFrames,
    cols: config ? config.cols : 1,
    rows: config ? config.rows : 1,
    rot: rot,
    scale,
    image: hitFxImg,
    tinted: config ? config.hitFxTinted !== false : true,
  });
},
hexToRgb(hex) {
  if (!hex) return null;
  let str = String(hex).replace(/^0x/, '').replace(/^#/, '');
  if (str.length === 8) {
    const r = parseInt(str.substring(2,4), 16);
    const g = parseInt(str.substring(4,6), 16);
    const b = parseInt(str.substring(6,8), 16);
    return [r, g, b];
  } else if (str.length === 6) {
    const r = parseInt(str.substring(0,2), 16);
    const g = parseInt(str.substring(2,4), 16);
    const b = parseInt(str.substring(4,6), 16);
    return [r, g, b];
  }
  return null;
},
updateEffects(dt) {
  for (const eff of this.judgeEffects) {
    eff.life -= dt / eff.maxLife;
    eff.frame = Math.floor((1 - eff.life) * eff.totalFrames);
  }
  this.judgeEffects = this.judgeEffects.filter(e => e.life > 0);

  for (const emitter of this.particleEmitters) {
    emitter.update(dt);
  }
  this.particleEmitters = this.particleEmitters.filter(e => e.particles.length > 0 || e.config.emitting);
  if (this.bgEmitter) {
    this.bgEmitter.update(dt);
  }
}
});
