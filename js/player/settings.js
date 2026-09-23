// PhiAI-Player || js/player/settings.js
// EnhancedRPEPlayer instance methods (loadSettings, saveSettings, applySettings, applyJudgementScale, setupSettingsListeners, captureDefaultPositions) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  loadSettings() {
  try {
    const saved = localStorage.getItem('pez-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(this.settings, parsed);
      this.noteScale = this.settings.noteSize;
      this.speed = this.settings.playSpeed;
      this.autoplay = this.settings.autoplay;
this.keyboardPlay = this.settings.keyboardPlay;
    this.applyJudgementScale();
      this.applySettings();
    }
  } catch (e) { console.warn('设置加载失败', e); }
},
saveSettings() {
  try {
    localStorage.setItem('pez-settings', JSON.stringify(this.settings));
  } catch (e) { console.warn('设置保存失败', e); }
},
applySettings() {
  this.applyJudgementScale();
  if (this.audio) {
    this.audio.volume = this.settings.musicVolume;
    this.audio.playbackRate = this.settings.playSpeed;
  }
  this.updateScoreDisplay();
},
applyJudgementScale() {
  const s = this.settings && this.settings.judgementScale ? this.settings.judgementScale : 1.0;
  this.LIMIT_PERFECT = this.LIMIT_PERFECT_BASE * s;
  this.LIMIT_GOOD = this.LIMIT_GOOD_BASE * s;
  this.LIMIT_BAD = this.LIMIT_BAD_BASE * s;
},
setupSettingsListeners() {
  const musicVol = document.getElementById('music-volume');
  const sfxVol = document.getElementById('sfx-volume');
  const autoPlay = document.getElementById('autoplay-toggle');
  const kbPlay = document.getElementById('keyboard-play');
  const jsScale = document.getElementById('judgement-scale');
  const particle = document.getElementById('particle-effect');
  const speed = document.getElementById('play-speed');
  const flowSpeed = document.getElementById('flow-speed');
  const noteSize = document.getElementById('note-size');
  const lineNums = document.getElementById('line-numbers');
  const chartHs = document.getElementById('chart-hitsounds');
  const followFatherRotate = document.getElementById('follow-father-rotate');
  const syncOffset = document.getElementById('sync-offset');

  musicVol.value = this.settings.musicVolume * 100;
  sfxVol.value = this.settings.sfxVolume * 100;
  autoPlay.checked = this.settings.autoplay;
  kbPlay.checked = this.settings.keyboardPlay;
  jsScale.value = this.settings.judgementScale;
  particle.checked = this.settings.particleEffect;
  speed.value = this.settings.playSpeed;
  flowSpeed.value = this.settings.flowSpeed;
  noteSize.value = this.settings.noteSize;
  lineNums.checked = this.settings.lineNumbers;
  chartHs.checked = this.settings.chartHitsounds;
  followFatherRotate.checked = this.settings.followFatherRotate;
  syncOffset.value = this.settings.syncOffsetMs || 0;

  document.getElementById('music-volume-val').textContent = Math.round(this.settings.musicVolume * 100);
  document.getElementById('sfx-volume-val').textContent = Math.round(this.settings.sfxVolume * 100);
  document.getElementById('play-speed-val').textContent = this.settings.playSpeed.toFixed(2);
  document.getElementById('flow-speed-val').textContent = this.settings.flowSpeed.toFixed(2);
  document.getElementById('judgement-scale-val').textContent = this.settings.judgementScale.toFixed(2);
  document.getElementById('note-size-val').textContent = this.settings.noteSize.toFixed(2);
  document.getElementById('sync-offset-val').textContent = (this.settings.syncOffsetMs || 0) | 0;

  const saveAndApply = () => {
    this.settings.musicVolume = parseFloat(musicVol.value) / 100;
    this.settings.sfxVolume = parseFloat(sfxVol.value) / 100;
    this.settings.autoplay = autoPlay.checked;
    this.settings.keyboardPlay = kbPlay.checked;
    this.settings.judgementScale = parseFloat(jsScale.value);
    this.settings.particleEffect = particle.checked;
    this.settings.playSpeed = parseFloat(speed.value);
    this.settings.flowSpeed = parseFloat(flowSpeed.value);
    this.settings.noteSize = parseFloat(noteSize.value);
    this.settings.lineNumbers = lineNums.checked;
    this.settings.chartHitsounds = chartHs.checked;
    this.settings.followFatherRotate = followFatherRotate.checked;
    this.settings.syncOffsetMs = parseFloat(syncOffset.value) || 0;
    this.noteScale = this.settings.noteSize;
    this.speed = this.settings.playSpeed;
    this.autoplay = this.settings.autoplay;
    this.keyboardPlay = this.settings.keyboardPlay;
    if (this.audio) {
      this.audio.volume = this.settings.musicVolume;
      this.audio.playbackRate = this.settings.playSpeed;
    }
    this.saveSettings();
    this.updateScoreDisplay();
  };

  musicVol.addEventListener('input', () => {
    document.getElementById('music-volume-val').textContent = musicVol.value;
    saveAndApply();
  });
  sfxVol.addEventListener('input', () => {
    document.getElementById('sfx-volume-val').textContent = sfxVol.value;
    saveAndApply();
  });
  autoPlay.addEventListener('change', saveAndApply);
  kbPlay.addEventListener('change', saveAndApply);
  jsScale.addEventListener('input', () => {
    document.getElementById('judgement-scale-val').textContent = parseFloat(jsScale.value).toFixed(2);
    saveAndApply();
  });
  particle.addEventListener('change', saveAndApply);
  speed.addEventListener('input', () => {
    document.getElementById('play-speed-val').textContent = parseFloat(speed.value).toFixed(2);
    saveAndApply();
  });
  noteSize.addEventListener('input', () => {
    document.getElementById('note-size-val').textContent = parseFloat(noteSize.value).toFixed(2);
    saveAndApply();
  });
  flowSpeed.addEventListener('input', () => {
    document.getElementById('flow-speed-val').textContent = parseFloat(flowSpeed.value).toFixed(2);
    saveAndApply();
  });
  lineNums.addEventListener('change', saveAndApply);
  chartHs.addEventListener('change', saveAndApply);
  syncOffset.addEventListener('input', () => {
    document.getElementById('sync-offset-val').textContent = syncOffset.value;
    saveAndApply();
  });
},
captureDefaultPositions() {
  const uiMap = {
    pause: { el: this.uiElements.pause, anchor: 'top-left' },
    combonumber: { el: this.uiElements.combonumber, anchor: 'center' },
    combo: { el: this.uiElements.combo, anchor: 'center' },
    score: { el: this.uiElements.score, anchor: 'top-right' },
    bar: { el: this.uiElements.bar, anchor: 'center-left' },
    name: { el: this.uiElements.name, anchor: 'bottom-left' },
    level: { el: this.uiElements.level, anchor: 'bottom-right' },
  };
  // Stash inline positioning/transform so the measurement is captured from the pure CSS layout,
  // not from wherever a chart bind / entrance moved the element; otherwise after a window resize
  // the DOM re-anchors off the moved value while the shader-composited raster stays clean → they diverge
  const stash = [];
  for (const info of Object.values(uiMap)) {
    const el = info.el;
    if (!el) continue;
    for (const prop of ['left', 'top', 'right', 'bottom', 'transform', 'opacity', 'color']) {
      const v = el.style.getPropertyValue(prop);
      if (v) { stash.push([el, prop, v]); el.style.removeProperty(prop); }
    }
  }
  // Elements hidden by default (e.g. the combo number / label of #combo-area) report a 0x0 rect while hidden,
  // so chart bindings would write them as left:0/top:0 (top-left corner); when a 0x0 rect is detected, walk up to the hidden ancestor
  // and temporarily show it (still invisible) while measuring
  const tmpVisible = [];
  const ensureVisible = (el) => {
    let node = el;
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
  for (const info of Object.values(uiMap)) {
    const el = info.el;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) ensureVisible(el);
  }
  // Force a reflow so the cleared styles take effect before measuring
  void (document.body && document.body.offsetWidth);
  for (const [key, info] of Object.entries(uiMap)) {
    const el = info.el;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    this.defaultPositions[key] = {
      left: rect.left,
      top: rect.top,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      anchor: info.anchor,
    };
  }
  for (const s of stash) { s[0].style[s[1]] = s[2]; }
  for (const el of tmpVisible) {
    el.style.display = '';
    el.style.visibility = '';
  }
}
});
