// PhiAI-Player || js/player/rendering.js
// EnhancedRPEPlayer instance methods (render, updatePaintLine, drawLineDebug, tintImage, drawJudgeLine, _flushTapBatch, drawNotesOnLine, roundedRect, rotatedTex, preTintedBody, drawNoteImage, drawImageEvents, drawTextEvent, drawJudgeEffect) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  render(beat, currentTime) {
  const ctx = this.ctx;
  const w = this.width, h = this.height;
  ctx.clearRect(0, 0, w, h);

  // Clear the paint canvases when time rewinds (progress scrubbing / restart) so no old strokes linger (reference implementations have no rewind; this is an addition for player interaction)
  if (this._lastPaintTime !== undefined && currentTime < this._lastPaintTime - 0.05) {
    for (const jl of this.judgeLines) {
      if (jl._paintCv && jl._paintDirty) {
        const pc = jl._paintCv.getContext('2d');
        pc.setTransform(1, 0, 0, 1, 0, 0);
        pc.clearRect(0, 0, jl._paintCv.width, jl._paintCv.height);
        jl._paintDirty = false;
      }
    }
  }
  this._lastPaintTime = currentTime;

  // The chart viewport follows the page size automatically (scaleX/scaleY are already derived from the canvas size); manual global zoom is no longer offered

  // Draw the background: cover fit (keep the original aspect ratio, center it, crop the overflow), no distortion when the page is resized
  const drawBgCover = (img) => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) { ctx.drawImage(img, 0, 0, w, h); return; }
    // Pre-compose the cover-fitted background into an offscreen canvas. Resampling a
    // full-screen image with smoothing on every frame was one of the most expensive single
    // operations in the render loop; now it runs once per (image, canvas size) and each
    // frame costs only a 1:1 blit of an already-scaled bitmap.
    const dpr = this._dpr || 1;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    const bc = this._bgCache;
    if (bc && bc.img === img && bc.w === bw && bc.h === bh) { ctx.drawImage(bc.cv, 0, 0, w, h); return; }
    const cv = (bc && bc.cv) || document.createElement('canvas');
    cv.width = bw; cv.height = bh;
    const bctx = cv.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = Math.max(w / iw, h / ih);
    bctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    this._bgCache = { img: img, w: bw, h: bh, cv: cv };
    ctx.drawImage(cv, 0, 0, w, h);
  };
  if (this.dynamicBackground > 0) {
    // Compatible dynamic fluid background: replaces the chart background image (1 = fixed brightness, 2 = brightness follows the audio spectrum)
    this.renderFluidBackground(ctx, w, h);
  } else if (this.blurredBg && this.blurredBg.complete) {
    drawBgCover(this.blurredBg);
  } else if (this.backgroundImage && this.backgroundImage.complete) {
    drawBgCover(this.backgroundImage);
  } else {
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);
  }
  // BGA video background (extra.json videos): drawn above the artwork and below the dim layer;
  // scale: cropCenter (default) / inside / fit, alpha = opacity, dim = how much the scene is darkened
  let bgDim = 0.5;
  const cur = this._bgaCurrent;
  if (cur && cur.video && cur.video.readyState >= 2) {
    try {
      const v = cur.video;
      const vw = v.videoWidth || 0, vh = v.videoHeight || 0;
      if (vw && vh) {
        ctx.save();
        ctx.globalAlpha = cur.alpha;
        if (cur.scale === 'fit') {
          ctx.drawImage(v, 0, 0, w, h);
        } else if (cur.scale === 'inside') {
          const r = Math.min(w / vw, h / vh);
          const dw = vw * r, dh = vh * r;
          ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
        } else {
          const r = Math.max(w / vw, h / vh);
          const dw = vw * r, dh = vh * r;
          ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
        }
        ctx.restore();
        bgDim = cur.dim;
      }
    } catch (e) {
      // A failed video draw (decoder error etc.) must not interrupt the whole render loop
      console.warn('[BGA] 视频绘制失败:', e);
    }
  }
  ctx.fillStyle = `rgba(0,0,0,${bgDim})`;
  ctx.fillRect(0, 0, w, h);

  // Background particles
  if (this.bgEmitter) {
    this.bgEmitter.draw(ctx, { x: w/2, y: h/2 });
  }

  // Judge lines and notes. LIFE mode separates the two layers so the top fade
  // mask can cover the judge lines while the notes stay bright on top of it.
  const sortedLines = this._sortedDrawLines();

  if (this.lifeMode) {
    // Pass 1: judge lines (and cover-line back notes) + paint/image events
    for (const jl of sortedLines) {
      if (jl.alpha < 0) continue;
      if (jl.isCover) this.drawNotesOnLine(jl, beat, 'back');
      if (jl.hasTextEvents || jl.hasPaintEvents) {
        // Skip drawing the line (RPE: a line with text / paint events always has opacity 0)
      } else {
        this.drawJudgeLine(jl);
      }
      if (jl.hasPaintEvents) this.updatePaintLine(jl, currentTime);
      this.drawImageEvents(jl, beat, currentTime);
    }

    // LIFE mode: static black fade across the top, over the judge lines but under the notes
    if (w > 0 && h > 0) {
      const gh = Math.max(40, h * 0.3);
      const mg = ctx.createLinearGradient(0, 0, 0, gh);
      mg.addColorStop(0, 'rgba(0,0,0,0.85)');
      mg.addColorStop(0.55, 'rgba(0,0,0,0.35)');
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, 0, w, gh);
    }

    // LIFE mode: thin red light bars, beneath the notes (so notes stay on top)
    if (w > 0 && h > 0) {
      // Dense rows of thin red light bars at the top (default angle 90deg = vertical).
      // The band reaches about past the combo-label bottom. Lines lean progressively:
      // 0deg at the horizontal centre, up to 20deg at the far edges, left half -deg,
      // right half +deg. Every bar is a single-direction vertical-fade sprite. Lines
      // far from the centre are dimmer and shorter, and every line independently
      // fades out and back in at its own random pace (visible -> gone -> visible).
      const uis = Math.min(w / 1350, h / 900) * 1.43;
      const bandH = (6 + 54 + 18 * 0.965 + 64) * 0.9 * uis; // top of combo-area, past the combo-label bottom
      const n = Math.max(36, Math.round(w / 18)); // very dense, ~18px per column
      const step = w / n;
      const barW = Math.min(3, step * 0.24); // rendered half-width of the glow blur
      const kMax = 20 * Math.PI / 180; // up to 20 degrees at the far edges
      const now = currentTime;
      // Pre-composite the glow sprite once: a single-direction vertical fade only —
      // bright at the very top, fading downward to transparent. No symmetric
      // two-sided blur, so every line reads as one red ray dropping from the top.
      let spr = this._lifeBarSpr;
      if (!spr) {
        spr = this._lifeBarSpr = document.createElement('canvas');
        spr.width = 128; spr.height = 128;
        const sc = spr.getContext('2d');
        const vg = sc.createLinearGradient(0, 0, 0, 128);
        vg.addColorStop(0, 'rgba(255,25,25,1)');
        vg.addColorStop(0.3, 'rgba(255,18,18,0.9)');
        vg.addColorStop(0.55, 'rgba(240,8,8,0.6)');
        vg.addColorStop(0.82, 'rgba(190,0,0,0.28)');
        vg.addColorStop(1, 'rgba(0,0,0,0)');
        sc.fillStyle = vg;
        sc.fillRect(0, 0, 128, 128);
      }
      ctx.save();
      const cxx = w / 2;
      for (let i = 0; i < n; i++) {
        const x = step * (i + 0.5);
        const side = x < w / 2 ? -1 : 1; // left half -> -deg (/), right half -> +deg (\)
        // Angle grows with distance from the horizontal centre (0deg in the middle,
        // up to 20deg near the edges, opposite signs on each half)
        const frac = Math.max(0, Math.min(1, Math.abs(x - cxx) / cxx));
        const ang = side * kMax * frac;
        // Per-line deterministic randomness
        const r1 = Math.sin(i * 12.9898 + 78.233) * 23423.5;
        const r2 = Math.sin(i * 78.42 + 23.11) * 5678.3;
        const rndA = r1 - Math.floor(r1);
        const rndB = r2 - Math.floor(r2);
        // Edge fade: lines far from the horizontal centre are dimmer
        const edge = Math.max(0, 1 - Math.abs(x - cxx) / cxx);
        const edgeFade = Math.pow(edge, 1.05);
        // Length shrinks away from the centre (top-anchored, still fading downward)
        const len = bandH * (0.5 + 0.5 * edgeFade);
        // Independent breathing: each line fades out and back in at its own pace
        const cycle = 0.4 + rndA * 0.7;               // random breath period (0.4s..1.1s)
        const phase = rndB * Math.PI * 2;           // random phase
        const wav = 0.5 + 0.5 * Math.sin(now / cycle * Math.PI * 2 + phase);
        const breath = 0.12 + 0.88 * wav;           // 0.12 .. 1.0 -> visible -> gone -> back
        const alpha = Math.max(0, Math.min(1, edgeFade * breath));
        ctx.save();
        ctx.translate(x, 0);
        ctx.rotate(ang);
        if (alpha > 0.02) {
          ctx.globalAlpha = Math.min(1, alpha * 1.15);
          ctx.drawImage(spr, -barW * 2.6, 0, barW * 5.2, len);
        }
        // The blurred bar itself
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(spr, -barW, 0, barW * 2, len);
        // Thin bright core keeps the "line" readable
        ctx.globalAlpha = Math.min(1, alpha * 1.08 + 0.12);
        ctx.drawImage(spr, -barW * 0.22, 0, barW * 0.44, len);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Pass 2: notes + text events over the fade
    for (const jl of sortedLines) {
      if (jl.alpha < 0) continue;
      if (jl.isCover) {
        this.drawNotesOnLine(jl, beat, 'front');
      } else {
        this.drawNotesOnLine(jl, beat);
      }
      this.drawTextEvent(jl);

      if (this.settings.lineNumbers) {
        this.drawLineDebug(jl);
      }
    }
  } else {
    for (const jl of sortedLines) {
      if (jl.alpha < 0) continue;
      // isCover = 1: back notes first -> judge line -> front notes
      // isCover = 0: judge line -> all notes
      if (jl.isCover) this.drawNotesOnLine(jl, beat, 'back');
      if (jl.hasTextEvents || jl.hasPaintEvents) {
        // Skip drawing the line (RPE: a line with text / paint events always has opacity 0)
      } else {
        this.drawJudgeLine(jl);
      }
      if (jl.hasPaintEvents) this.updatePaintLine(jl, currentTime);
      this.drawImageEvents(jl, beat, currentTime);
      if (jl.isCover) {
        this.drawNotesOnLine(jl, beat, 'front');
      } else {
        this.drawNotesOnLine(jl, beat);
      }
      this.drawTextEvent(jl);

      if (this.settings.lineNumbers) {
        this.drawLineDebug(jl);
      }
    }
  }

  // Particle bursts (lowest layer: drawn first, the hit-fx body then covers them)
  // (disabled during warm-up so no leftover effect shows once real play starts)
  if (!this._suppressJudgeFx) {
    for (const emitter of this.particleEmitters) {
      emitter.draw(ctx, { x: 0, y: 0 });
    }
  }

  // Hit rings / body (on top of the particles; disabled during warm-up so no leftover effect shows once real play starts)
  if (!this._suppressJudgeFx) {
    for (const eff of this.judgeEffects) {
      this.drawJudgeEffect(eff);
    }
  }

  this.updateUI();
  this.updateMissingBadge();
},
updatePaintLine(jl, currentTime) {
  const ctx = this.ctx;
  const w = this.width, h = this.height;
  let cv = jl._paintCv;
  if (!cv) cv = jl._paintCv = document.createElement('canvas');
  if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    jl._paintDirty = false;
  }
  const pctx = jl._paintCtx || (jl._paintCtx = cv.getContext('2d'));
  // paintEvents' startTime is chart seconds (parsed via bpmListToSeconds); evaluate on the chart-time clock (raw clock - chart offset)
  // so a non-zero META.offset does not shift the stroke timing relative to the notes.
  const v = evaluateEvent(jl.paintEvents, currentTime - (this.offset || 0), 0);
  if (v <= 0) {
    if (jl._paintDirty) {
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, cv.width, cv.height);
      jl._paintDirty = false;
    }
  } else {
    const a = Math.min(1, Math.max(0, jl.alpha) / 255 * 2.55);
    if (a > 0) {
      const r = Math.max(0.5, v * (w / 1350));
      const [sx, sy] = this.judgeLineToScreen(jl);
      const dpr = this.canvas.width / Math.max(1, w);
      const col = Array.isArray(jl.color) ? jl.color : [255, 255, 255];
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pctx.save();
      pctx.translate(sx, sy);
      pctx.rotate(jl.rotation * Math.PI / 180);
      pctx.scale(jl.scaleX || 1, jl.scaleY || 1);
      pctx.beginPath();
      pctx.arc(0, 0, r, 0, Math.PI * 2);
      pctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;
      pctx.fill();
      pctx.restore();
      jl._paintDirty = true;
    }
  }
  if (jl._paintDirty) {
    ctx.drawImage(cv, 0, 0, w, h);
  }
},
drawLineDebug(jl) {
  const ctx = this.ctx;
  const [sx, sy] = this.judgeLineToScreen(jl);
  ctx.save();
  ctx.translate(sx, sy - 30);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = `#${jl.index} ${Math.round(jl.rotation)}°`;
  ctx.fillText(label, 0, 0);
  ctx.translate(0, 10);
  ctx.rotate(jl.rotation * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(0, -8);
  ctx.lineTo(-15, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,200,100,0.6)';
  ctx.fill();
  ctx.restore();
},
tintImage(img, w, h, r, g, b, forceCache) {
  if (r >= 255 && g >= 255 && b >= 255) return img;
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  // Cache large textured line tints too. Texture lines are usually big art (up to 2-4k so the
  // display-sized tint hits ~18M px), and the colorEvents gradient changes per frame, so the old
  // 400k-px cap plus a precise-color cache key meant such lines rebuilt the offscreen tint at
  // 4 canvas passes per frame -- the visible 'image appears -> stutter' hitch. Three fixes:
  //   1) quantize the tint color (per-channel step 2, visually identical) so adjacent color
  //      values share one cached canvas instead of never hitting.
  //   2) raise the pixel cap/budget so large art actually gets cached (warmImages pre-fills the
  //      first-seen colors), and evict the smallest entries first so a few ~18Mpx glow art tints
  //      survive until the picture actually shows instead of being thrown out by cheap entries.
  //   3) very large tints (an 18Mpx out canvas is a 68MB copy) skip the cache when a runtime
  //      colorEvent fade changes the color every frame -- they build once into the shared scratch
  //      and are drawn immediately; only the pre-warmed first-seen colors are force-cached.
  const q = (v) => v >= 255 ? 255 : Math.min(255, Math.round(v / 2) * 2);
  const qr = q(r), qg = q(g), qb = q(b);
  if (qr >= 255 && qg >= 255 && qb >= 255) return img;
  const px = w * h;
  // Cache lookup must not be gated by a pixel cap: GlowLine1 art (4000x2250) scaled to a 1920-wide
  // draw size is ~32M px, i.e. above any fixed cap, yet it is the very line whose first frame the
  // user noticed hitching. The 80Mpx budget below is the real memory bound; a cap on the lookup
  // side silently disabled caching for exactly the hurtful tints (warmImages pre-builds them, but
  // the runtime hit never happened -> 'preprocessing is a no-op').
  const canCache = !!(img.src || img.currentSrc);
  let key, cache;
  // Tint canvases are big (GlowLine1 ~32Mpx = ~128MB each). 80Mpx was too tight to hold the
  // pre-warmed key colors *and* a runtime gradient while still having headroom, so pre-warmed
  // entries were evicted before they were ever drawn -> the 'image appears' frame still rebuilt
  // a 32Mpx tint. 160Mpx (a handful of art tints, released on chart switch) leaves that headroom.
  const TINT_PX_BUDGET = 160000000;
  if (canCache || forceCache) {
    cache = this._tintCache || (this._tintCache = new Map());
    key = (img.src || img.currentSrc) + '|' + w + 'x' + h + '|' + qr + ',' + qg + ',' + qb;
    const hit = cache.get(key);
    if (hit) {
      if (cache.size > 1 && cache.keys().next().value !== key) {
        cache.delete(key); cache.set(key, hit);
      }
      return hit.cv;
    }
  }
  if (!this._tintCv) this._tintCv = document.createElement('canvas');
  if (!this._tintAux) this._tintAux = document.createElement('canvas');
  const cv = this._tintCv, aux = this._tintAux;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  if (aux.width !== w || aux.height !== h) { aux.width = w; aux.height = h; }
  const tc = cv.getContext('2d'), ac = aux.getContext('2d');
  ac.clearRect(0, 0, w, h);
  ac.drawImage(img, 0, 0, w, h);
  tc.clearRect(0, 0, w, h);
  tc.drawImage(img, 0, 0, w, h);
  tc.globalCompositeOperation = 'multiply';
  tc.fillStyle = 'rgb(' + qr + ',' + qg + ',' + qb + ')';
  tc.fillRect(0, 0, w, h);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(aux, 0, 0);
  tc.globalCompositeOperation = 'source-over';
  // Store on a miss unless the tint is a multi-Mpx art piece whose colorEvent is changing every
  // frame: a per-frame gradient produces a new key each frame and copying a 32Mpx out canvas per
  // frame is slower than re-using the shared scratch. Small/medium tints are cheap to copy and
  // greatly benefit re-colored lines, so cache those. Pre-warmed large tints were already stored
  // by warmImages (forceCache); the budget/LRU still bound memory (evict-smallest-first keeps the
  // big art tints that are still on screen).
  if (!forceCache && px > 2000000) return cv;
  const evict = () => {
    let minKey = null, minPx = Infinity;
    for (const [mk, mv] of cache) { if (mv.px < minPx) { minPx = mv.px; minKey = mk; } }
    if (minKey === null) return false;
    cache.delete(minKey);
    this._tintPx -= minPx;
    return true;
  };
  while (cache.size > 0 && (cache.size > 300 || (this._tintPx || 0) + px > TINT_PX_BUDGET)) {
    if (!evict()) break;
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(cv, 0, 0);
  cache.set(key, { cv: out, px: px });
  this._tintPx = (this._tintPx || 0) + px;
  return out;
},
drawJudgeLine(jl) {
  const ctx = this.ctx;
  const [sx, sy] = this.judgeLineToScreen(jl);
  const angleRad = jl.rotation * Math.PI / 180;
  const alpha = (jl.alpha / 255);
  if (alpha <= 0.01) return;
  const tex = (jl.texture && this.lineTextures) ? (this.lineTextures[jl.texture] || this.lineTextures[this.assetKey(jl.texture)]) : null;
  const _anchor = (Array.isArray(jl.anchor) && jl.anchor.length >= 2) ? jl.anchor : [0.5, 0.5];
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angleRad);
  ctx.scale(jl.scaleX, jl.scaleY);
  const lineLength = Math.sqrt(this.width*this.width + this.height*this.height) * 2;
  if (jl.isGif) {
    // GIF line textures: prefer the per-frame cached canvas (needed for gifEvents playback progress control); fall back to an <img> while the cache is not ready
    const gf = (this.gifFrameCache) ? (this.gifFrameCache[this.assetKey(jl.texture)] || this.gifFrameCache[jl.texture]) : null;
    let drawImg = (tex && tex.complete) ? tex : null;
    if (gf && gf.frames && gf.frames.length) {
      const idx = Math.max(0, Math.min(gf.frames.length - 1, jl.gifFrameIndex || 0));
      drawImg = gf.frames[idx];
    }
    if (drawImg) {
      // Texture line size follows the standard semantics: image pixels x (canvas width / 1350); scale events are applied through ctx.scale
      const imgW = (drawImg.width || 1) * (this.width / 1350);
      const imgH = (drawImg.height || imgW) * (this.width / 1350);
      // Color events tint with multiply blending; draw the raw image when there is no color event or the color is pure white
      const col = (jl.colorEvents && jl.colorEvents.length && Array.isArray(jl.color)) ? jl.color : [255, 255, 255];
      const src = this.tintImage(drawImg, imgW, imgH, col[0], col[1], col[2]);
      ctx.globalAlpha = alpha;
      ctx.drawImage(src, -_anchor[0] * imgW, (_anchor[1] - 1) * imgH, imgW, imgH);
    }
  } else if (tex && tex.complete) {
    // Texture line size follows the standard semantics: image pixels x (canvas width / 1350); scale events are applied through ctx.scale
    const imgW = (tex.width || 1) * (this.width / 1350);
    const imgH = (tex.height || imgW) * (this.width / 1350);
    // Color events tint with multiply blending; draw the raw image when there is no color event or the color is pure white
    const col = (jl.colorEvents && jl.colorEvents.length && Array.isArray(jl.color)) ? jl.color : [255, 255, 255];
    const src = this.tintImage(tex, imgW, imgH, col[0], col[1], col[2]);
    ctx.globalAlpha = alpha;
    ctx.drawImage(src, -_anchor[0] * imgW, (_anchor[1] - 1) * imgH, imgW, imgH);
  } else {
    const lineHeight = 4 * this.scaleY;
    const col = (jl.colorEvents && jl.colorEvents.length) ? (Array.isArray(jl.color) ? jl.color : [255, 255, 173]) : [255, 255, 173];
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
    ctx.fillRect(-lineLength/2, -lineHeight/2, lineLength, lineHeight);
  }
  ctx.restore();
},
_flushTapBatch(ctx) {
  const b = this._tapBatch;
  if (!b || b.items.length === 0) return;
  const it = b.items;
  if (it.length === 4) {
    ctx.save();
    ctx.translate(it[0], it[1]);
    this.roundedRect(ctx, -it[2] / 2, -it[3] / 2, it[2], it[3], it[3] / 2, b.key);
    ctx.restore();
  } else {
    ctx.beginPath();
    for (let i = 0; i < it.length; i += 4) {
      const cx = it[i], cy = it[i + 1], nw = it[i + 2], nh = it[i + 3];
      const r = nh / 2, x0 = cx - nw / 2, y0 = cy - nh / 2, x1 = cx + nw / 2, y1 = cy + nh / 2;
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x1 - r, y0);
      ctx.arcTo(x1, y0, x1, y1, r);
      ctx.lineTo(x1, y1 - r);
      ctx.arcTo(x1, y1, x0, y1, r);
      ctx.lineTo(x0 + r, y1);
      ctx.arcTo(x0, y1, x0, y0, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x1, y0, r);
      ctx.closePath();
    }
    ctx.fillStyle = b.key;
    ctx.fill();
  }
  it.length = 0;
},
drawNotesOnLine(jl, beat, filter) {
  const ctx = this.ctx;
  // bpmfactor lines: note flight / hide timing follows the line timeline (line beat = global beat / bpmfactor)
  const lb = beat / (jl.bpmFactor || 1);
  const [lineSX, lineSY] = this.judgeLineToScreen(jl);
  const angleRad = jl.rotation * Math.PI / 180;
  // Screen-culling rotation trig is constant for the whole line: compute it once here instead
  // of once per note inside the loop (the cull check runs for every note every frame)
  const __cosA = Math.cos(angleRad), __sinA = Math.sin(angleRad);
  ctx.save();
  ctx.translate(lineSX, lineSY);
  ctx.rotate(angleRad);

  const useRP = this.useResourcePack && this.noteTextures;
  const tex = useRP ? this.noteTextures : null;
  const baseScale = this.noteScale || 4.35;

  // Screen visibility culling (performance): skip drawing a note when its true on-canvas
  // position lies outside the viewport rectangle (cw x ch) inflated by a fixed margin.
  // The note's screen position is the line centre screen origin (lineSX/lineSY) plus the
  // line-local offset (lx, ly) rotated by the line's own rotation. Crucially this is the
  // SAME transform the drawing code applies, so the cull sees exactly what would be drawn.
  // It does NOT compare the raw line-local offset against a radius around the canvas centre:
  // charts that move the judge line far from the centre (e.g. a high posY to show notes
  // before they fall into view) would cull notes that are visibly on canvas. All geometry
  // here is CSS px (canvas backing store is rect*dpr, but this.width/height are CSS px), so
  // the decision is identical at every page zoom / display scale.
  const cw = (this.width || (this.canvas && this.canvas.width)) || 1280;
  const ch = (this.height || (this.canvas && this.canvas.height)) || 720;
  const cullM = 400; // CSS px margin: how far beyond the viewport edges notes still get drawn

  const __lineNotes = this._noteStream ? (this._streamWindowByLine[jl.index] || []) : jl.notes;
  // The current speed floor is identical for every note on this line this frame; resolving
  // it once here removes one binary search per hold (it used to run four per hold).
  const __cullNow = jl.speedFloor ? speedFloorAt(jl.speedFloor, lb) : 0;
  let __drawCnt = 0;
  // Notes inside a hold must stay visible: draw every hold (type 2) on a line first, then the other notes, so notes render above holds
  for (const __pass of __NOTE_PASSES) {
  for (const note of __lineNotes) {
    if ((note.type === 2 ? 0 : 1) !== __pass) continue;
    // Outside the active window: updateNotes skipped it this frame, so its cached position
    // is stale. Draw nothing rather than blitting it at a wrong place.
    if (note._winSkip) continue;
    // Negative-flow notes that are still on the BACK side of the judge line are invisible
    // (official previews / prpr draw only the front side), and their cached screen position
    // sits behind the line too, so skip drawing them entirely.
    if (note._flowBack) continue;
    if (this._noteStream && ++__drawCnt > 2000) break;
    if (this._noteStream) {
      const __bd = note.startTime - beat;
      if (__bd > 30) break;
      if (__bd < -8 && (note.type !== 2 || note.holdFinished)) continue;
    }
    if (filter === 'back' && note.above === 1) continue;
    if (filter === 'front' && note.above !== 1) continue;
    if (note.judged && note.type !== 2) continue;
    // isFake show notes: fly in normally and hide once they reach the judge line (instant notes use startTime, holds use endTime)
    if (note.isFake && lb >= (note.type === 2 ? note.endTime : note.startTime)) continue;
    if (note.isFake && note.type !== 2) {
      if (note.screenX < -100 || note.screenX > cw + 100 ||
          note.screenY < -100 || note.screenY > ch + 100) continue;
    }
    if (note.missed && note.type !== 2) {
      if (note.screenX < -100 || note.screenX > cw + 100 ||
          note.screenY < -100 || note.screenY > ch + 100) continue;
    }
    if (note.type === 2 && note.holdFinished) continue;

    const lx = (note.localX || note.positionX) * this.scaleX;
    const ly = -(note.localY || 0) * this.scaleY;

    const tint = (note.tint || [255,255,255]);
    // Controls are on the judge line object, not the note object
    const jl = this.judgeLines[note.lineIndex];

    // Screen visibility culling (performance): the note's true on-canvas position is the
    // line centre screen origin plus the line-local offset rotated by the line rotation,
    // which is exactly the transform the drawing code applies. Cull against the viewport
    // rectangle inflated by cullM, so off-centre judge lines (high posY) never drop notes
    // that are actually on screen. All coordinates are CSS px -> zoom-independent.
    // x offset of the note from the line centre
    const __cullCX = lx;
    // y offset of the note's head from the line centre
    const __cullHY = ly;
    // screen x/y of the note head (line centre + rotated offset)
    const __cullHX = lineSX + __cullCX * __cosA - __cullHY * __sinA;
    const __cullHYs = lineSY + __cullCX * __sinA + __cullHY * __cosA;
    if (note.type === 2) {
      const cullSf = jl.speedFloor;
      const cullSpeedBase = 40 * (this.phiSpeedScale || 1);
      const cullSpd = note.speed || 1.0;
      const cullFlow = this.settings.flowSpeed || 1;
      const cullDir = note.above === 1 ? 1 : -1;
      const cullHeadY = (cullSf ? speedFloorAt(cullSf, note.startTime) - __cullNow : (note.startTime - lb)) * cullSpeedBase * cullSpd * cullFlow;
      const cullTailY = (cullSf ? speedFloorAt(cullSf, note.endTime) - __cullNow : (note.endTime - lb)) * cullSpeedBase * cullSpd * cullFlow;
      const cullFlowNeg = (cullHeadY >= 0 && cullTailY >= 0) ? false : ((cullHeadY <= 0 && cullTailY <= 0) ? true : ((note.startTime > lb) ? (cullHeadY < 0) : (cullTailY < 0)));
      const cullDirEff = cullFlowNeg ? -cullDir : cullDir;
      // y offset of the note's tail from the line centre (same transform as the drawing tail)
      const cullTY = -(cullTailY * this.scaleY * cullDirEff);
      // screen x/y of the note tail
      const __cullTX = lineSX + __cullCX * __cosA - cullTY * __sinA;
      const __cullTYs = lineSY + __cullCX * __sinA + cullTY * __cosA;
      // axis-aligned bounding box of head..tail; keep if it touches the inflated viewport rect
      const __bbL = Math.min(__cullHX, __cullTX), __bbR = Math.max(__cullHX, __cullTX);
      const __bbT = Math.min(__cullHYs, __cullTYs), __bbB = Math.max(__cullHYs, __cullTYs);
      if (__bbR < -cullM || __bbL > cw + cullM || __bbB < -cullM || __bbT > ch + cullM) continue;
    } else {
      if (__cullHX < -cullM || __cullHX > cw + cullM ||
          __cullHYs < -cullM || __cullHYs > ch + cullM) continue;
    }

    // alphaControl: noteAlpha = noteAlpha * nowAlpha (spec: both converted to 0-1)
    const a = (note.alpha / 255) * note.opacity * (note.controlAlpha || 1);
    // sizeControl affects real size (not just width), excluded for Hold per RPE spec
    const ctrlSize = (jl && jl.sizeControl) ? (note.controlSize || 1) : 1;
    const baseW = 36 * note.size * ctrlSize * this.scaleX * baseScale;

    // ---- tap-note batching (see _flushTapBatch) ----
    // Plain (untextured) tap notes are collected as raw coordinates and emitted as one
    // filled path. Incline and skew are excluded because they need a per-note transform;
    // non-opaque notes are excluded because merging overlaps of translucent shapes into one
    // fill would blend the overlap once instead of twice.
    const __batchTap = !tex && note.type === 1 && a >= 0.999 &&
      !jl.inclineSin && !(jl.skewControl && note.controlSkew);
    if (!__batchTap) this._flushTapBatch(ctx);
    if (__batchTap) {
      const noteW2 = baseW;
      const noteH2 = 10 * this.scaleY * baseScale;
      const style2 = 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',' + a + ')';
      const __tb = this._tapBatch || (this._tapBatch = { key: style2, items: [] });
      if (__tb.items.length) {
        if (__tb.key !== style2) { this._flushTapBatch(ctx); __tb.key = style2; }
      } else {
        __tb.key = style2;
      }
      __tb.items.push(lx, ly, noteW2, noteH2);
      continue;
    }
    ctx.save();
    // incline tilt: for non-hold notes the X position scales by 1 - sin(angle) * (chart height to the line * aspect ratio) * 1/360
    let __lx = lx;
    if (note.type !== 2 && jl.inclineSin) {
      // x *= 1 - sin(angle) * (normalized height to the line) * RPE_HEIGHT/2/360 (RPE_HEIGHT = 900 -> 1.25)
      const __baseChart = (note.localY || 0) / 450;
      __lx *= (1 - jl.inclineSin * __baseChart * 1.25);
    }
    ctx.translate(__lx, 0);
    // skewControl: horizontal shear (left/right tilt) -- notes on opposite sides of the anchor tilt in opposite directions
    // Reference: notes on the left lean like '\', notes on the right like '/'; a positive value tilts the top to the left
    if (note.type !== 2 && jl && jl.skewControl && note.controlSkew) {
      const skewSign = (note.positionX || __lx) >= 0 ? -1 : 1;
      ctx.transform(1, 0, note.controlSkew * skewSign * 10, 1, 0, 0);
    }

    if (note.type === 1) {
      const isMH = !!note.double;
      const img = tex ? (isMH ? tex.click_mh : tex.click) : null;
      if (img && img.complete) {
        const scaleFactor = (isMH && this.mhScale) ? this.mhScale : 1.0;
        const w = baseW * scaleFactor;
        const h = w * (img.height / img.width);
        ctx.save();
        ctx.translate(0, ly);
        this.drawNoteImage(ctx, img, -w/2, -h/2, w, h, tint, a);
        ctx.restore();
              } else {
        const noteW = baseW;
        const noteH = 10 * this.scaleY * baseScale;
        ctx.save();
        ctx.translate(0, ly);
        this.roundedRect(ctx, -noteW/2, -noteH/2, noteW, noteH, noteH/2, `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`);
        ctx.restore();
              }
    } else if (note.type === 2) {
      const isMH = !!note.double;
      const holdParts = isMH ? this.holdPartsMH : this.holdParts;
      const imgWhole = tex ? (isMH ? tex.hold_mh : tex.hold) : null;

      const baseSpeed = 40 * (this.phiSpeedScale || 1);
      const spd = note.speed || 1.0;
      const sf = jl.speedFloor;
      const rb = note.holdBroken ? (note.breakBeat || 0) / (jl.bpmFactor || 1) : lb;
      let headPos, tailPos, _dirEff, _flowNeg;
      const dir = note.above === 1 ? 1 : -1;
      const _flowK = baseSpeed * spd * (this.settings.flowSpeed || 1);
      // The head matches every other note (click/flick): it uses note.localY computed by updateNotes directly (already including the negative flow-speed direction fix)
      headPos = ly;
      // After reaching the judge line (hit / fake): the head is pinned at 'judge line + yOffset' and the hold translates with yOffset while held,
      // so it no longer slips below the line on negative flow speed; the tail keeps flowing by the normal note formula and the body stretches with the flow speed (reversed on negative speed, normal length otherwise)
      if (!note.holdBroken && note.startTime <= lb) headPos = -(note.yOffset || 0) * this.scaleY;
      // Tail: use exactly the same formula as updateNotes, substituting endTime as the startTime of 'an independent note',
      // so holds move and stretch exactly like normal notes (on negative flow speed the tail naturally stretches upwards)
      const _rawHeadDiff = sf ? speedFloorAt(sf, note.startTime) - speedFloorAt(sf, lb) : (note.startTime - lb);
      const _rawTailDiff = sf ? speedFloorAt(sf, note.endTime) - speedFloorAt(sf, lb) : (note.endTime - lb);
      const _rawHeadY = _rawHeadDiff * _flowK;
      const _rawTailY = _rawTailDiff * _flowK;
      _flowNeg = (_rawHeadY >= 0 && _rawTailY >= 0) ? false : ((_rawHeadY <= 0 && _rawTailY <= 0) ? true : ((note.startTime > lb) ? (_rawHeadY < 0) : (_rawTailY < 0)));
      _dirEff = _flowNeg ? -dir : dir;
      const _tDist = _rawTailDiff * _flowK;
      const _tLocalY = _dirEff * _tDist * (note.controlY || 1) + (note.yOffset || 0);
      tailPos = -(_tLocalY) * this.scaleY;

      const scaleFactor = (isMH && this.mhScale) ? this.mhScale : 1.0;
      const w = baseW * scaleFactor;

      // Keep using the split head/body/tail atlas at very small note widths. Falling back
      // to the whole atlas based on rendered height makes a thin hold sample unrelated
      // atlas cells and produces the visible texture glitch.
      if (holdParts && holdParts.tail && holdParts.tail.complete && holdParts.tail.width > 0 && holdParts.tail.height > 0 && holdParts.body && holdParts.body.complete && holdParts.body.width > 0 && holdParts.body.height > 0 && holdParts.head && holdParts.head.complete && holdParts.head.width > 0 && holdParts.head.height > 0) {
        const tailImg = holdParts.tail;
        const bodyImg = holdParts.body;
        const headImg = holdParts.head;

        const tailH = w * (tailImg.height / tailImg.width);
        const bodyH = w * (bodyImg.height / bodyImg.width);
        const headH = w * (headImg.height / headImg.width);

        const _cfg = this.hitFxAtlasConfig || {};
        const _repeat = !!_cfg.holdRepeat;
        const _compact = !!_cfg.holdCompact;
        const _keepHead = !!_cfg.holdKeepHead;
        const _bodyH = Math.abs(headPos - tailPos);
        const _bodyY = Math.min(headPos, tailPos);
        const _bodyYVis = _bodyY;
        const _bodyHVis = _bodyH;
        if (note.holdActive) {
          if (tailPos !== 0) {
            const _actBodyYRaw = Math.min(headPos, tailPos);
            const _actBodyHRaw = Math.abs(tailPos - headPos);
            let _actBodyY = _actBodyYRaw;
            let _actBodyH = _actBodyHRaw;
            if (jl.isCover === 1 || jl.isCover === true) {
              const _fs2 = this.settings.flowSpeed || 1;
              const _dir2 = note.above === 1 ? 1 : -1;
              const _appr2 = -Math.sign(_fs2 * _dir2) || -1;
              if (_appr2 > 0) {
                const _clipTop = Math.max(_actBodyY, 0);
                const _clipBot = _actBodyY + _actBodyH;
                _actBodyH = Math.max(0, _clipBot - _clipTop);
                _actBodyY = _clipTop;
              } else {
                const _clipBot = Math.min(_actBodyY + _actBodyH, 0);
                _actBodyH = Math.max(0, _clipBot - _actBodyY);
              }
            }
            if (_actBodyH > 0) {
            if (_repeat && bodyH > 0) {
              let _y = _actBodyY;
              while (_y < _actBodyY + _actBodyH) {
                const _rem = _actBodyY + _actBodyH - _y;
                if (_rem >= bodyH) { this.drawNoteImage(ctx, bodyImg, -w/2, _y, w, bodyH, tint, a); }
                else { this.drawNoteImage(ctx, bodyImg, -w/2, _y, w, _rem, tint, a, 0, 0, bodyImg.width, _rem * bodyImg.width / w); }
                _y += bodyH;
              }
             } else if (tailPos > headPos) { this.drawNoteImage(ctx, bodyImg, -w/2, _actBodyY, w, _actBodyH, tint, a, 0, bodyImg.height, bodyImg.width, -bodyImg.height); }
             else { this.drawNoteImage(ctx, bodyImg, -w/2, _actBodyY, w, _actBodyH, tint, a); }
            }
          }
          if (_keepHead) {
            const _hy = _compact ? headPos - headH/2 : (tailPos > headPos ? headPos - headH : headPos);
            const _flipH = tailPos > headPos;
            const _nearImg = headImg;
            const _nearH = headH;
            this.drawNoteImage(ctx, _nearImg, -w/2, _hy, w, _nearH, tint, a, 0, _flipH ? _nearImg.height : 0, _nearImg.width, _flipH ? -_nearImg.height : _nearImg.height);
          }
          const _ty = _compact ? tailPos - tailH/2 : (tailPos > headPos ? tailPos : tailPos - tailH);
          const _flipT = tailPos > headPos;
          const _farImg = tailImg;
          const _farH = tailH;
          this.drawNoteImage(ctx, _farImg, -w/2, _ty, w, _farH, tint, a, 0, _flipT ? _farImg.height : 0, _farImg.width, _flipT ? -_farImg.height : _farImg.height);
          } else {
            let _cY = _bodyYVis, _cH = _bodyHVis;
            const _bodyFlip = (_repeat && bodyH > 0) ? false : (headPos < tailPos);
            if (jl.isCover === 1 || jl.isCover === true) {
              const _fs = this.settings.flowSpeed || 1;
              const _dir = note.above === 1 ? 1 : -1;
              const _appr = -Math.sign(_fs * _dir) || -1;
              if (_appr > 0) {
                _cY = Math.max(_bodyYVis, 0);
                _cH = Math.max(0, (_bodyYVis + _bodyHVis) - _cY);
              } else {
                _cY = _bodyYVis;
                _cH = Math.max(0, Math.min(_bodyYVis + _bodyHVis, 0) - _cY);
              }
            }
            if (_cH > 0) {
              if (_repeat && bodyH > 0) {
                let _y = _cY;
                while (_y < _cY + _cH) {
                  const _rem = _cY + _cH - _y;
                  if (_rem >= bodyH) { this.drawNoteImage(ctx, bodyImg, -w/2, _y, w, bodyH, tint, a, 0, _bodyFlip ? bodyImg.height : 0, bodyImg.width, _bodyFlip ? -bodyImg.height : bodyImg.height); }
                  else { this.drawNoteImage(ctx, bodyImg, -w/2, _y, w, _rem, tint, a, 0, _bodyFlip ? (bodyImg.height - _rem * bodyImg.width / w) : 0, bodyImg.width, _bodyFlip ? -(_rem * bodyImg.width / w) : (_rem * bodyImg.width / w)); }
                  _y += bodyH;
                }
              } else {
                this.drawNoteImage(ctx, bodyImg, -w/2, _cY, w, _cH, tint, a, 0, _bodyFlip ? bodyImg.height : 0, bodyImg.width, _bodyFlip ? -bodyImg.height : bodyImg.height);
              }
            }
            const _flipS = tailPos > headPos;
            const _hy = _compact ? headPos - headH/2 : (tailPos > headPos ? headPos - headH : headPos);
            const _ty = _compact ? tailPos - tailH/2 : (tailPos > headPos ? tailPos : tailPos - tailH);
            const _nearImg = headImg;
            const _nearH = headH;
            const _farImg = tailImg;
            const _farH = tailH;
            this.drawNoteImage(ctx, _nearImg, -w/2, _hy, w, _nearH, tint, a, 0, _flipS ? _nearImg.height : 0, _nearImg.width, _flipS ? -_nearImg.height : _nearImg.height);
            this.drawNoteImage(ctx, _farImg, -w/2, _ty, w, _farH, tint, a, 0, _flipS ? _farImg.height : 0, _farImg.width, _flipS ? -_farImg.height : _farImg.height);
          }
              } else if (imgWhole && imgWhole.complete) {
        const ratio = imgWhole.height / imgWhole.width;
        const hHead = w * ratio;
        const _cfgW = this.hitFxAtlasConfig || {};
        const _compactW = !!_cfgW.holdCompact;
        const _keepHeadW = !!_cfgW.holdKeepHead;
        const _repeatW = !!_cfgW.holdRepeat;
        const _bodyHW = Math.abs(headPos - tailPos);
        const _bodyYW = Math.min(headPos, tailPos);
        const _bodyYWVis = _bodyYW;
        const _bodyHWVis = _bodyHW;
        if (note.holdActive) {
          if (tailPos !== 0) {
            const _actBodyYWRaw = Math.min(headPos, tailPos);
            const _actBodyHWRaw = Math.abs(tailPos - headPos);
            const _actBodyYW = _actBodyYWRaw;
            const _actBodyHW = _actBodyHWRaw;
            if (_repeatW && hHead > 0) {
              let _yW = _actBodyYW;
              while (_yW < _actBodyYW + _actBodyHW) {
                const _remW = _actBodyYW + _actBodyHW - _yW;
                if (_remW >= hHead) { this.drawNoteImage(ctx, imgWhole, -w/2, _yW, w, hHead, tint, a); }
                else { this.drawNoteImage(ctx, imgWhole, -w/2, _yW, w, _remW, tint, a, 0, 0, imgWhole.width, _remW * imgWhole.width / w); }
                _yW += hHead;
              }
            } else if (tailPos > headPos) { this.drawNoteImage(ctx, imgWhole, -w/2, _actBodyYW, w, _actBodyHW, tint, a); }
            else { this.drawNoteImage(ctx, imgWhole, -w/2, _actBodyYW, w, _actBodyHW, tint, a, 0, imgWhole.height, imgWhole.width, -imgWhole.height); }
          }
          if (_keepHeadW) {
            const _hyW = _compactW ? headPos - hHead/2 : (tailPos > headPos ? headPos - hHead : headPos);
            this.drawNoteImage(ctx, imgWhole, -w/2, _hyW, w, hHead, tint, a, 0, 0, imgWhole.width, imgWhole.height);
          }
          const _tyW = _compactW ? tailPos - hHead/2 : (tailPos > headPos ? tailPos : tailPos - hHead);
          this.drawNoteImage(ctx, imgWhole, -w/2, _tyW, w, hHead, tint, a, 0, imgWhole.height, imgWhole.width, -imgWhole.height);
          } else {
            let _cYW = _bodyYWVis, _cHW = _bodyHWVis;
            const _bodyFlipW = (_repeatW && hHead > 0) ? false : (headPos > tailPos);
            if (jl.isCover === 1 || jl.isCover === true) {
              const _fsW = this.settings.flowSpeed || 1;
              const _dirW = note.above === 1 ? 1 : -1;
              const _apprW = -Math.sign(_fsW * _dirW) || -1;
              if (_apprW > 0) {
                _cYW = Math.max(_bodyYWVis, 0);
                _cHW = Math.max(0, (_bodyYWVis + _bodyHWVis) - _cYW);
              } else {
                _cYW = _bodyYWVis;
                _cHW = Math.max(0, Math.min(_bodyYWVis + _bodyHWVis, 0) - _cYW);
              }
            }
            if (_cHW > 0) {
              if (_repeatW && hHead > 0) {
                let _yW = _cYW;
                while (_yW < _cYW + _cHW) {
                  const _remW = _cYW + _cHW - _yW;
                  if (_remW >= hHead) { this.drawNoteImage(ctx, imgWhole, -w/2, _yW, w, hHead, tint, a, 0, _bodyFlipW ? imgWhole.height : 0, imgWhole.width, _bodyFlipW ? -imgWhole.height : imgWhole.height); }
                  else { this.drawNoteImage(ctx, imgWhole, -w/2, _yW, w, _remW, tint, a, 0, _bodyFlipW ? (imgWhole.height - _remW * imgWhole.width / w) : 0, imgWhole.width, _bodyFlipW ? -(_remW * imgWhole.width / w) : (_remW * imgWhole.width / w)); }
                  _yW += hHead;
                }
              } else {
                this.drawNoteImage(ctx, imgWhole, -w/2, _cYW, w, _cHW, tint, a, 0, _bodyFlipW ? imgWhole.height : 0, imgWhole.width, _bodyFlipW ? -imgWhole.height : imgWhole.height);
              }
            }
            const _hyW2 = _compactW ? headPos - hHead/2 : (tailPos > headPos ? headPos - hHead : headPos);
            const _tyW2 = _compactW ? tailPos - hHead/2 : (tailPos > headPos ? tailPos : tailPos - hHead);
            this.drawNoteImage(ctx, imgWhole, -w/2, _hyW2, w, hHead, tint, a, 0, 0, imgWhole.width, imgWhole.height);
            this.drawNoteImage(ctx, imgWhole, -w/2, _tyW2, w, hHead, tint, a, 0, imgWhole.height, imgWhole.width, -imgWhole.height);
          }
              } else {
        const noteW = baseW;
        const noteH = 10 * this.scaleY * baseScale;
        const _keepHeadF = this.hitFxAtlasConfig && this.hitFxAtlasConfig.holdKeepHead;
        if (note.holdActive) {
          if (tailPos !== 0) {
            const _actBodyYFRaw = Math.min(headPos, tailPos);
            const _actBodyHFRaw = Math.abs(tailPos - headPos);
            const _actBodyYF = _actBodyYFRaw;
            const _actBodyHF = _actBodyHFRaw;
            ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a * 0.5})`;
            ctx.fillRect(-noteW * 0.35, _actBodyYF, noteW * 0.7, _actBodyHF);
          }
          if (_keepHeadF) {
            ctx.translate(0, (tailPos > headPos ? -noteH/2 : noteH/2));
            this.roundedRect(ctx, -noteW/2, -noteH/2, noteW, noteH, noteH/2, `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`);
          }
        } else {
          const _bodyHF = Math.abs(headPos - tailPos);
          if (_bodyHF > 0) {
            const _bodyYFRaw = Math.min(headPos, tailPos);
            const _bodyYF = _bodyYFRaw;
            const _bodyHFCl = _bodyHF;
            ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a * 0.5})`;
            ctx.fillRect(-noteW * 0.35, _bodyYF, noteW * 0.7, _bodyHFCl);
          }
          ctx.translate(0, headPos);
          this.roundedRect(ctx, -noteW/2, -noteH/2, noteW, noteH, noteH/2, `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`);
          ctx.translate(0, tailPos - headPos);
          this.roundedRect(ctx, -noteW/2, -noteH/2, noteW, noteH, noteH/2, `rgba(${tint[0]},${tint[1]},${tint[2]},${a * 0.8})`);
        }
              }
    } else if (note.type === 3) {
      const isMH = !!note.double;
      const img = tex ? (isMH ? tex.flick_mh : tex.flick) : null;
      if (img && img.complete) {
        const scaleFactor = (isMH && this.mhScale) ? this.mhScale : 1.0;
        const w = baseW * scaleFactor;
        const h = w * (img.height / img.width);
        this.drawNoteImage(ctx, img, -w/2, ly - h/2, w, h, tint, a);
              } else {
        const noteW = baseW;
        ctx.translate(0, ly);
        ctx.beginPath();
        ctx.moveTo(0, -noteW/2);
        ctx.lineTo(noteW/2, 0);
        ctx.lineTo(0, noteW/2);
        ctx.lineTo(-noteW/2, 0);
        ctx.closePath();
        ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
        ctx.fill();
              }
    } else if (note.type === 4) {
      const isMH = !!note.double;
      const img = tex ? (isMH ? tex.drag_mh : tex.drag) : null;
      if (img && img.complete) {
        const scaleFactor = (isMH && this.mhScale) ? this.mhScale : 1.0;
        const w = baseW * scaleFactor;
        const h = w * (img.height / img.width);
        this.drawNoteImage(ctx, img, -w/2, ly - h/2, w, h, tint, a);
              } else {
        const noteW = baseW;
        ctx.translate(0, ly);
        ctx.beginPath();
        ctx.arc(0, 0, noteW/2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, noteW/4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a * 0.7})`;
        ctx.fill();
      }
          }

    ctx.restore();
  }
  }
  // Flush any tap notes still batched for this line
  this._flushTapBatch(ctx);
  ctx.restore();
},
roundedRect(ctx, x, y, w, h, r, fillStyle) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
},
rotatedTex(img) {
  if (!img || img.width === 0) return img;
  if (!this._rotCache) this._rotCache = new WeakMap();
  if (this._rotCache.has(img)) return this._rotCache.get(img);
  const c = document.createElement('canvas');
  c.width = img.height;
  c.height = img.width;
  const cc = c.getContext('2d');
  cc.translate(c.width / 2, c.height / 2);
  cc.rotate(Math.PI / 2);
  cc.drawImage(img, -img.width / 2, -img.height / 2);
  this._rotCache.set(img, c);
  return c;
},
preTintedBody(bodyTex, tint) {
  const rot = this.rotatedTex(bodyTex);
  const isWhite = !tint || (tint[0] >= 255 && tint[1] >= 255 && tint[2] >= 255);
  if (isWhite) return rot;
  const key = tint.join(',');
  if (!this._bodyTintCache) this._bodyTintCache = new WeakMap();
  let m = this._bodyTintCache.get(rot);
  if (!m) { m = new Map(); this._bodyTintCache.set(rot, m); }
  if (m.has(key)) return m.get(key);
  const c = document.createElement('canvas');
  c.width = rot.width;
  c.height = rot.height;
  const cctx = c.getContext('2d');
  cctx.drawImage(rot, 0, 0);
  cctx.globalCompositeOperation = 'multiply';
  cctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  cctx.fillRect(0, 0, c.width, c.height);
  cctx.globalCompositeOperation = 'source-over';
  m.set(key, c);
  return c;
},
drawNoteImage(ctx, img, dx, dy, dw, dh, tint, alpha, sx, sy, sw, sh) {
  if (!img || !img.complete) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dw) || !Number.isFinite(dh) || dw === 0 || dh === 0) return;
  const isWhite = !tint || (tint[0] >= 255 && tint[1] >= 255 && tint[2] >= 255);
  const hasCrop = (sx !== undefined && sy !== undefined && sw !== undefined && sh !== undefined);
  const cSX = hasCrop ? sx : 0, cSY = hasCrop ? sy : 0;
  const cSW = hasCrop ? sw : img.width, cSH = hasCrop ? sh : img.height;
  if (!Number.isFinite(cSX) || !Number.isFinite(cSY) || !Number.isFinite(cSW) || !Number.isFinite(cSH) || cSW === 0 || cSH === 0) return;
  // Always flip negative sizes with scale, since drawImage with negative sw/sh does not work in some environments
  const vFlip = cSH < 0, hFlip = cSW < 0;
  const sSX = hFlip ? cSX + cSW : cSX;
  const sSY = vFlip ? cSY + cSH : cSY;
  const sSW = hFlip ? -cSW : cSW;
  const sSH = vFlip ? -cSH : cSH;
  if (isWhite) {
    ctx.globalAlpha = alpha;
    if (!vFlip && !hFlip) {
      ctx.drawImage(img, cSX, cSY, cSW, cSH, dx, dy, dw, dh);
    } else {
      ctx.save();
      if (vFlip && hFlip) { ctx.translate(dx + dw, dy + dh); ctx.scale(-1, -1); }
      else if (vFlip) { ctx.translate(0, dy + dh); ctx.scale(1, -1); }
      else { ctx.translate(dx + dw, 0); ctx.scale(-1, 1); }
      ctx.drawImage(img, sSX, sSY, sSW, sSH, vFlip && hFlip ? 0 : (hFlip ? 0 : dx), vFlip && hFlip ? 0 : (vFlip ? 0 : dy), dw, dh);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  } else {
    // Pre-render the tinted sprite once and reuse it (offscreen pre-rendering). The original
    // code re-ran the whole tint pipeline -- resize the scratch canvas, drawImage, source-in
    // fill, blit -- for every note on every frame. Resizing a canvas reallocates its backing
    // store, so this was one allocation plus six canvas ops per note per frame.
    // Keyed by image identity (WeakMap) so huge data-URL sources never end up in a key, and
    // only for uncropped sprites: crop rectangles change every frame on hold bodies.
    let spr = null;
    if (!hasCrop) {
      const qw = Math.max(1, Math.ceil(dw / 4) * 4), qh = Math.max(1, Math.ceil(dh / 4) * 4);
      const root = this._noteTintCache || (this._noteTintCache = new WeakMap());
      let cache = root.get(img);
      if (!cache) { cache = new Map(); root.set(img, cache); }
      const t0 = Math.round(tint[0]), t1 = Math.round(tint[1]), t2 = Math.round(tint[2]);
      const key = qw + 'x' + qh + '|' + t0 + ',' + t1 + ',' + t2 + '|' + (vFlip ? 1 : 0) + (hFlip ? 1 : 0);
      spr = cache.get(key);
      if (!spr) {
        spr = document.createElement('canvas');
        spr.width = qw; spr.height = qh;
        const sctx = spr.getContext('2d');
        sctx.save();
        if (vFlip && hFlip) { sctx.translate(qw, qh); sctx.scale(-1, -1); }
        else if (vFlip) { sctx.translate(0, qh); sctx.scale(1, -1); }
        else if (hFlip) { sctx.translate(qw, 0); sctx.scale(-1, 1); }
        sctx.drawImage(img, sSX, sSY, sSW, sSH, 0, 0, qw, qh);
        sctx.restore();
        // Custom note colors: replace the color with source-in, keyed on the original alpha, so the texture's own base color is not multiplied by the tint and distorts the result
        sctx.globalCompositeOperation = 'source-in';
        sctx.fillStyle = 'rgb(' + t0 + ',' + t1 + ',' + t2 + ')';
        sctx.fillRect(0, 0, qw, qh);
        sctx.globalCompositeOperation = 'source-over';
        if (cache.size > 400) cache.clear();
        cache.set(key, spr);
      }
    }
    if (spr) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    } else {
      if (!this._tintCanvas) { this._tintCanvas = document.createElement('canvas'); this._tintCtx = null; }
      const tc = this._tintCanvas;
      const tw = Math.max(1, Math.ceil(Math.abs(dw))), th = Math.max(1, Math.ceil(Math.abs(dh)));
      // Fallback path (cropped hold-body slices, or sprites that cannot be cached): resize
      // only when the size actually changes and keep the 2D context instead of re-fetching it.
      if (tc.width !== tw) tc.width = tw;
      if (tc.height !== th) tc.height = th;
      const tctx = this._tintCtx || (this._tintCtx = tc.getContext('2d'));
      tctx.clearRect(0, 0, tw, th);
      tctx.save();
      if (vFlip && hFlip) { tctx.translate(tw, th); tctx.scale(-1, -1); }
      else if (vFlip) { tctx.translate(0, th); tctx.scale(1, -1); }
      else if (hFlip) { tctx.translate(tw, 0); tctx.scale(-1, 1); }
      tctx.drawImage(img, sSX, sSY, sSW, sSH, 0, 0, tw, th);
      tctx.restore();
      // Custom note colors: replace the color with source-in, keyed on the original alpha, so the texture's own base color is not multiplied by the tint and distorts the result
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
      tctx.fillRect(0, 0, tw, th);
      tctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.drawImage(tc, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }
  }
},
drawImageEvents(jl, beat, currentTime) {
  const evs = jl.imageEvents;
  if (!evs || !evs.length) return;
  const imgs = this.imageEventTextures || {};
  const ctx = this.ctx;
  const [sx, sy] = this.judgeLineToScreen(jl);
  const lineRad = jl.rotation * Math.PI / 180;
  const map = this.bpmList;
  // Image events live on the line and their timeline uses the line bpmfactor (line beat = global beat / bpmfactor)
  const lbf = jl.bpmFactor || 1;
  const lbeat = beat / lbf;
  for (const ev of evs) {
    if (lbeat < ev.startBeat || lbeat > ev.endBeat) continue;
    const img = imgs[ev.image] || imgs[this.assetKey(ev.image)] || imgs[(ev.image || '').split('/').pop()];
    if (!img || !img.complete) continue;
    const span = ev.endBeat - ev.startBeat;
    const frames = Math.max(1, Math.round(ev.length || 1));
    let frame = 0;
    if (ev.fps > 0) {
      // fps frame advancing is chart-time based (event startBeat -> chart seconds), like notes judging at startTimeSec + offset on the raw
      // clock. Evaluate on the chart-time clock (raw clock - chart offset) so a non-zero META.offset does not desync the sprite frames
      // from the notes.
      const el = (currentTime - (this.offset || 0) - bpmListToSeconds(map, ev.startBeat, lbf)) * ev.fps + (ev.offset || 0);
      const f = Math.floor(el);
      frame = ev.loop ? ((f % frames) + frames) % frames : Math.max(0, Math.min(f, frames - 1));
    }
    const fw = Math.max(1, img.width / frames), fh = img.height;
    const dw = fw * ev.scaleX, dh = fh * ev.scaleY;
    const col = ev.color;
    const tintA = (col && col.length >= 4) ? (col[3] / 255) : 1;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(lineRad);
    ctx.scale(jl.scaleX, jl.scaleY);
    ctx.translate(ev.posX * this.scaleX, ev.posY * this.scaleY);
    ctx.rotate(ev.rotation * Math.PI / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, ev.alpha * tintA));
    ctx.drawImage(img, frame * fw, 0, fw, fh, -ev.anchorX * dw, -ev.anchorY * dh, dw, dh);
    if (col && (col[0] !== 255 || col[1] !== 255 || col[2] !== 255)) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillRect(-ev.anchorX * dw, -ev.anchorY * dh, dw, dh);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
},
drawTextEvent(jl) {
  if (!jl.currentText || jl.currentText.length === 0) return;
  const ctx = this.ctx;
  const [sx, sy] = this.judgeLineToScreen(jl);
  const anchor = (Array.isArray(jl.anchor) && jl.anchor.length >= 2) ? jl.anchor : [0.5, 0.5];
  // Text events adapt to the page size: based on the 1350x900 reference design, take the minimum ratio of both axes (same source as the UI's --uis and the note scale)
  // Do not divide by pageZoom: the main canvas draws with a dpr transform, so the visual size in CSS px stays constant under page zoom and needs (and should get) no extra compensation
  const uiScale = Math.min(this.width / 1350, this.height / 900) || 1;
  const fontSize = 36 * uiScale;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(jl.rotation * Math.PI / 180);
  ctx.scale(jl.scaleX, jl.scaleY);
  const alpha = jl.alpha / 255;
  ctx.font = `${fontSize}px "AppFont", "MiSans", "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const txtCol = jl.color || [255, 255, 255];
  ctx.fillStyle = `rgba(${txtCol[0]},${txtCol[1]},${txtCol[2]},${alpha})`;
  const lines = jl.currentText.split('\n');
  const lineHeight = fontSize * 1.2;
  // Text is treated as a judge line texture: the anchor is the 'grab point', the (ax, ay) point of the text aligns with the line position
  // x: 0 = left, 1 = right; y: 0 = bottom, 1 = top (chart coordinates, same semantics as texture anchors)
  const maxW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const totalH = lineHeight * lines.length;
  ctx.translate((0.5 - anchor[0]) * maxW, (anchor[1] - 0.5) * totalH);
  for (let i = 0; i < lines.length; i++) {
    const yOffset = (i - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(lines[i], 0, yOffset);
  }
  ctx.restore();
},
drawJudgeEffect(eff) {
  const ctx = this.ctx;
  const lifeRatio = eff.life;
  // Phigros-spec body fade: alpha = 1 - progress*(1 - HIT_ALPHA) with HIT_ALPHA=0.882,
  // i.e. 1.0 -> 0.882 (barely fades; the sprite sheet itself carries the fade-out)
  const alpha = 1 - (1 - Math.max(0, lifeRatio)) * (1 - 0.882);
  const r = eff.color[0], g = eff.color[1], b = eff.color[2];
  const img = eff.image || this.hitFxImage;

  if (img && img.complete && eff.totalFrames > 0) {
    const cols = eff.cols;
    const rows = eff.rows;
    const frameIndex = Math.min(eff.frame, eff.totalFrames - 1);
    const col = frameIndex % cols;
    const row = Math.floor(frameIndex / cols);
    const fw = img.width / cols;
    const fh = img.height / rows;
    const size = eff.radius * 2;

    // Reuse one scratch canvas. This used to allocate a fresh <canvas> plus a 2D context
    // for every hit effect on every frame -- hundreds of DOM objects and backing stores
    // per second during dense sections, which is pure allocation and GC pressure.
    const offscreen = this._fxScratch || (this._fxScratch = document.createElement('canvas'));
    const octx = this._fxScratchCtx || (this._fxScratchCtx = offscreen.getContext('2d'));
    const osz = Math.max(1, size | 0);
    if (offscreen.width !== osz || offscreen.height !== osz) {
      offscreen.width = osz;
      offscreen.height = osz;
    } else {
      octx.clearRect(0, 0, osz, osz);
    }
    octx.globalCompositeOperation = 'source-over';

    octx.drawImage(img, col * fw, row * fh, fw, fh, 0, 0, size, size);
    if (eff.tinted !== false) {
      octx.globalCompositeOperation = 'source-atop';
      octx.fillStyle = `rgb(${r},${g},${b})`;
      octx.fillRect(0, 0, size, size);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(eff.x, eff.y);
    ctx.rotate(eff.rot || 0);
    ctx.drawImage(offscreen, -size/2, -size/2);
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(eff.x, eff.y, eff.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
    ctx.restore();
  }
}
});
