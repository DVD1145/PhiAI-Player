// PhiAI-Player || js/player/scoring.js
// EnhancedRPEPlayer instance methods (accuracy, computeScore, _sortedDrawLines, _setStyle, _setComboLabel, updateScoreDisplay, updateAutoplayStatus) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  accuracy() {
  if (this.totalNotes === 0) return 1.0;
  const perfect = this.counts[0];
  const good = this.counts[1];
  return (perfect + good * 0.65) / this.totalNotes;
},
computeScore() {
  const TOTAL = 1000000;
  if (this.counts[0] === this.totalNotes && this.totalNotes > 0) return TOTAL;
  const acc = this.accuracy();
  const comboFactor = this.maxCombo / this.totalNotes;
  const score = (0.9 * acc + 0.1 * comboFactor) * TOTAL;
  return Math.round(score);
},
_sortedDrawLines() {
  const c = this._sortedLinesCache;
  if (c && c.lines === this.judgeLines && c.n === this.judgeLines.length) return c.list;
  const list = this.judgeLines
    .filter((_, idx) => !this.attachUIIndex || !Object.values(this.attachUIIndex).some(l => Array.isArray(l) && l.indexOf(idx) >= 0))
    .sort((a, b) => a.zOrder - b.zOrder);
  this._sortedLinesCache = { lines: this.judgeLines, n: this.judgeLines.length, list };
  return list;
},
_setStyle(el, prop, value) {
  if (el.style[prop] === value) return;
  el.style[prop] = value;
},
_setComboLabel(v) {
  if (this._comboLabelV === v) return;
  this._comboLabelV = v;
  this.comboLabel.textContent = v;
},
updateScoreDisplay() {
  const score = this.computeScore();
  const clamped = Math.min(1000000, Math.max(0, score));
  // Guarded writes: this method runs every frame, and re-assigning an unchanged
  // value still costs a DOM write plus, for the score, a fresh formatted string.
  if (this._lastScoreShown !== clamped) {
    this._lastScoreShown = clamped;
    this.scoreDisplay.textContent = String(clamped).padStart(7, '0');
  }

  const life = this.lifeMode;
  const showCombo = life ? true : (this.combo >= 3);
  this._setComboLabel(life ? 'LIFE' : (this.autoplay ? 'AUTOPLAY' : 'COMBO'));
  if (life) {
    const lifeNum = String(Math.max(0, this.lifeValue));
    if (this._lastComboShown !== lifeNum) {
      this._lastComboShown = lifeNum;
      this.comboNumber.textContent = lifeNum;
    }
  }

  if (this._lastComboDisp !== showCombo) {
    this._lastComboDisp = showCombo;
    this.comboArea.style.display = showCombo ? 'block' : 'none';
  }
  if (!life && showCombo && this._lastComboShown !== this.combo) {
    this._lastComboShown = this.combo;
    this.comboNumber.textContent = this.combo;
  }
  if (this.comboArea) this.comboArea.classList.toggle('life-mode', life);

  const progress = this.totalSeconds > 0 ? Math.min(1, this.getCurrentTime() / this.totalSeconds) : 0;
  const fillWidth = progress * 100;
  // Cache the lookups (they used to hit the DOM twice per frame) and write only on change
  const __barFill = this._barFillEl || (this._barFillEl = document.getElementById('ui-bar-fill'));
  const __wpc = fillWidth.toFixed(2) + '%';
  if (__barFill && this._barFillW !== __wpc) {
    this._barFillW = __wpc;
    __barFill.style.width = __wpc;
  }
  let headOpacity = 1;
  if (!this.isPlaying && progress >= 1) {
    headOpacity = 0;
  }
  const __barHead = this._barHeadEl || (this._barHeadEl = document.getElementById('ui-bar-head'));
  if (__barHead && this._barHeadO !== headOpacity) {
    this._barHeadO = headOpacity;
    __barHead.style.opacity = headOpacity;
  }
  if (window.CustomUI) window.CustomUI.update(this); // Refresh the custom play UI every frame
},
updateAutoplayStatus() {
  this.updateScoreDisplay();
}
});
