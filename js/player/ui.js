// PhiAI-Player || js/player/ui.js
// EnhancedRPEPlayer instance methods (updateFileStatus, showPauseOverlay, hidePauseOverlay, retryChart, backToMenu, updateTitleAndDifficulty, startUIEntrance, updateUI, updateMissingBadge) attached to the prototype.
// updateUI runs every frame; the uiMap (and its pre-flattened entries) are constants hoisted out of
// the method so the per-frame call does not re-allocate the object plus an Object.entries array.
const __UI_MAP = {
  pause: { key: 'pause', anchor: 'top-left' },
  combonumber: { key: 'combonumber', anchor: 'center' },
  combo: { key: 'combo', anchor: 'center' },
  score: { key: 'score', anchor: 'top-right' },
  bar: { key: 'bar', anchor: 'center-left' },
  name: { key: 'name', anchor: 'bottom-left' },
  level: { key: 'level', anchor: 'bottom-right' },
};
const __UI_MAP_ENTRIES = Object.entries(__UI_MAP);
Object.assign(EnhancedRPEPlayer.prototype, {
  updateFileStatus(name, loaded, msg = '') {
  const src = this.files || this.chartFiles;
  const f = src && src.get ? src.get(name) : null;
  if (f) { f.loaded = loaded; f.error = !loaded; f.errorMsg = msg; }
},
showPauseOverlay() {
  const ov = document.getElementById('pause-overlay');
  if (!ov || ov.classList.contains('show')) return;
  void ov.offsetWidth; // Restart the animation
  ov.classList.add('show');
},
hidePauseOverlay() {
  const ov = document.getElementById('pause-overlay');
  if (ov) ov.classList.remove('show');
},
retryChart() {
  this.hidePauseOverlay();
  this.isPaused = false;
  if (this.audio && !this.fallbackMode) { this.audio.pause(); this.audio.currentTime = 0; }
  this.fallbackTime = 0;
  this.reset();
  this.play();
},
backToMenu() {
  this.hidePauseOverlay();
  this.pause();
  const ls = document.getElementById('load-screen');
  ls.style.display = '';
  ls.style.transform = '';
  ls.style.opacity = '';
  ls.style.zIndex = '';
  ls.classList.remove('hidden', 'loading-mode');
},
updateTitleAndDifficulty() {
  const meta = this.chart?.META || {};
  this.titleDisplay.textContent = meta.name || 'Unknown';
  this.difficultyDisplay.textContent = (meta.level !== undefined && meta.level !== null && meta.level !== '') ? String(meta.level) : '-';
},
startUIEntrance(delay = 0) {
  const dir = {};
  const mid = window.innerHeight / 2;
  for (const key of ['pause', 'score', 'name', 'level']) {
    const dp = this.defaultPositions[key];
    dir[key] = dp ? (dp.top < mid ? -1 : 1) : 1;
  }
  this.uiEntrance = { start: performance.now() + delay, duration: 1000, dist: window.innerHeight, dir: dir };
},
updateUI() {
  for (const [key, info] of __UI_MAP_ENTRIES) {
    const el = this.uiElements[key];
    if (!el) continue;
    const defaultPos = this.defaultPositions[key];
    if (!defaultPos) continue;

    const transform = this.uiTransforms[key];
    const scaleStr = transform ? ` scale(${transform.scaleX}, ${transform.scaleY})` : '';
    // In LIFE mode the combo number / label keep their own fixed look and must not be recolored by chart color events
    const lifeCombo = this.lifeMode && (key === 'combonumber' || key === 'combo');
    const uiColor = (transform && transform.color && !lifeCombo) ? `rgb(${transform.color[0]},${transform.color[1]},${transform.color[2]})` : '';

    // Entrance slide offset: within the first 1s after entering a chart, the UI slides back from below the screen to its place (easeOutExpo; progress bar / combo / combo label excluded).
    // UI hidden by the chart (display:none or opacity 0) is skipped; UI moved elsewhere by the chart is offset on top of its final position.
    let entranceY = 0;
    let entranceActive = false;
    if (!['bar', 'combonumber', 'combo'].includes(key) && this.uiEntrance) {
      const et = Math.max(0, (performance.now() - this.uiEntrance.start) / this.uiEntrance.duration);
      if (et >= 1) {
        this.uiEntrance = null;
      } else {
        // getComputedStyle forces a style recalculation and was called for every UI
        // element on every frame of the entrance animation. Sampling it every ~100ms is
        // visually identical at a fraction of the cost.
        const __csNow = performance.now();
        let __csVis = el._csVis;
        if (__csVis === undefined || __csNow - (el._csVisT || 0) > 100) {
          const __cs = getComputedStyle(el);
          __csVis = el._csVis = (__cs.display !== 'none' && __cs.opacity !== '0');
          el._csVisT = __csNow;
        }
        if (__csVis) {
          const d = (this.uiEntrance.dir && this.uiEntrance.dir[key]) || 1;
          const etClamped = Math.min(et, 1);
          const eased = etClamped === 1 ? 1 : 1 - Math.pow(2, -10 * etClamped);
          entranceY = Math.round(d * (1 - eased) * this.uiEntrance.dist);
          entranceActive = true;
          // UI with CSS transitions (such as the pause button) slows down the per-frame transform, so transitions are temporarily disabled during the entrance
          this._setStyle(el, 'transition', 'none');
        } else {
          this._setStyle(el, 'transition', '');
        }
      }
    } else if (!this.uiEntrance && el.style.transition === 'none') {
      this._setStyle(el, 'transition', '');
    }

    // During the entrance use default coordinates like the song title (X does not follow chart bindings); bound positions take effect once the entrance finishes
    // The combo number / combo label (and the progress bar) are CSS-flow positioned elements, so writing left/top directly has no effect;
    // while a binding is active, offset them from their original position with translate(dx, dy) and keep them in place otherwise.
    const flowUI = key === 'combonumber' || key === 'combo';
    // UI does not return to its original position once a chart position event ends: it follows the line while the binding is active, and the moment the event ends
    // it stays frozen where the event left it until the next position event moves it again.
    const act = !!(transform && !entranceActive);
    // Chart events (move / rotate / opacity) apply immediately: UI with CSS transitions (such as the pause button) lags behind or stacks gradients, so transitions are temporarily disabled
    if (act || (transform && transform.isChartActive)) {
      this._setStyle(el, 'transition', 'none');
    } else if (!entranceActive && el.style.transition === 'none') {
      this._setStyle(el, 'transition', '');
    }
    let sx, sy;
    if (act) {
      sx = defaultPos.left + transform.dx;
      sy = defaultPos.top + transform.dy;
      this._uiHold[key] = { x: sx, y: sy };
    } else if (this._uiHold[key]) {
      sx = this._uiHold[key].x;
      sy = this._uiHold[key].y;
    } else {
      sx = defaultPos.left;
      sy = defaultPos.top;
    }

    if (act || this._uiHold[key]) {
      if (flowUI) {
        this._setStyle(el, 'left', '');
        this._setStyle(el, 'top', '');
        this._setStyle(el, 'right', '');
        this._setStyle(el, 'bottom', '');
        this._setStyle(el, 'transform', `translate(${sx - defaultPos.left}px, ${sy - defaultPos.top}px) rotate(${transform ? transform.rotation : 0}deg)${scaleStr}`);
        this._setStyle(el, 'opacity', transform ? transform.alpha : '');
        this._setStyle(el, 'color', uiColor);
      } else {
        const anchor = info.anchor;
        let left = sx;
        let top = sy;
        this._setStyle(el, 'left', '');
        this._setStyle(el, 'top', '');
        this._setStyle(el, 'right', '');
        this._setStyle(el, 'bottom', '');
        if (anchor === 'top-left') {
          this._setStyle(el, 'left', left + 'px');
          this._setStyle(el, 'top', top + 'px');
        } else if (anchor === 'top-right') {
          this._setStyle(el, 'right', (defaultPos.right - (sx - defaultPos.left)) + 'px');
          this._setStyle(el, 'top', top + 'px');
        } else if (anchor === 'bottom-left') {
          this._setStyle(el, 'left', left + 'px');
          this._setStyle(el, 'bottom', (defaultPos.bottom - (sy - defaultPos.top)) + 'px');
        } else if (anchor === 'bottom-right') {
          this._setStyle(el, 'right', (defaultPos.right - (sx - defaultPos.left)) + 'px');
          this._setStyle(el, 'bottom', (defaultPos.bottom - (sy - defaultPos.top)) + 'px');
        } else if (anchor === 'center' || anchor === 'center-left') {
          this._setStyle(el, 'left', left + 'px');
          this._setStyle(el, 'top', top + 'px');
        }
        this._setStyle(el, 'transform', `translateY(${entranceY}px) rotate(${transform ? transform.rotation : 0}deg)${scaleStr}`);
        this._setStyle(el, 'opacity', transform ? transform.alpha : '');
        this._setStyle(el, 'color', uiColor);
      }
    } else {
      if (flowUI) {
        this._setStyle(el, 'left', '');
        this._setStyle(el, 'top', '');
        this._setStyle(el, 'right', '');
        this._setStyle(el, 'bottom', '');
        this._setStyle(el, 'transform', (transform ? `rotate(${transform.rotation}deg)${scaleStr}` : ''));
        this._setStyle(el, 'opacity', transform ? transform.alpha : '');
        this._setStyle(el, 'color', uiColor);
      } else {
        this._setStyle(el, 'left', '');
        this._setStyle(el, 'top', '');
        this._setStyle(el, 'right', '');
        this._setStyle(el, 'bottom', '');
        this._setStyle(el, 'transform', `translateY(${entranceY}px)` + (transform ? ` rotate(${transform.rotation}deg)${scaleStr}` : ''));
        this._setStyle(el, 'opacity', transform ? transform.alpha : '');
        this._setStyle(el, 'color', uiColor);
      }
    }
  }
},
updateMissingBadge() {
  const el = this._missingBadgeEl || (this._missingBadgeEl = document.getElementById('missing-badge'));
  if (!el) return;
  // Called every frame: cache the lookup and rebuild the text only when the missing-asset
  // list actually changes, instead of redoing a Set allocation plus three DOM writes.
  const n = (this.missingAssets && this.missingAssets.length) || 0;
  const sig = n ? this.missingAssets.join('|') : '';
  if (this._missingBadgeSig === sig) return;
  this._missingBadgeSig = sig;
  if (!n) { el.style.display = 'none'; return; }
  el.textContent = '缺少图片: ' + [...new Set(this.missingAssets)].join(', ');
  el.style.display = 'block';
}
});
