// PhiAI-Player || js/player/core.js
// EnhancedRPEPlayer class definition + the small core methods (sizing, particles, page metrics).
// All remaining instance methods are attached to the prototype by sibling feature files.
class EnhancedRPEPlayer {
  constructor(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.chart = null;
  this.audio = null;
  this.backgroundImage = null;
  this.blurredBg = null;
  this.pezData = null;
  this.isPlaying = false;
  this.isPaused = false;
  this.startTime = 0;
  this.pauseOffset = 0;
  this.speed = 1.0;
  this.muted = false;
  this.autoplay = true;
  this.notes = [];
  this.judgeLines = [];
  this.gifFrameCache = {};
  this.imageEventFiles = [];
  this.lineTextureFiles = [];
  this.totalNotes = 0;
  this.counts = [0, 0, 0, 0];
  this.combo = 0;
  this.maxCombo = 0;
  this.judgedNotes = new Set();
  this.judgeEffects = [];
  this.fallbackMode = false;
  this.fallbackTime = 0;
  this.animationId = null;
  this.lastFrameTime = 0;
  this.LIMIT_PERFECT_BASE = 0.08;
  this.LIMIT_GOOD_BASE = 0.16;
  this.LIMIT_BAD_BASE = 0.22;
  this.UP_TOLERANCE = 0.1;
  this.applyJudgementScale();

  this.resourcePack = null;
  this.hitFxAtlasConfig = null;
  this.hitFxImage = null;
  this.goodHitFxImage = null;
  this.noteTextures = {};
  this.useResourcePack = false;
  this.audioCtx = null;
  this.audioBuffers = {};
  this.hitsoundMap = {};
  // SFX layer: hit judgement, slider ticks and other high-frequency sound calls no longer touch Web Audio directly;
  // they are queued first and played in one batch at the end of the frame by flushSfx(), capped and with node reuse.
  // High-density charts may judge hundreds of notes in a single frame; creating a buffer source and gain node for each one
  // would instantiate thousands of AudioNodes inside one frame, freezing the main thread and stuttering the audio.
  this._sfxQueue = [];          // Flat array: [type, vol, type, vol, ...]
  this._sfxMaxPerFlush = 48;    // Maximum number of sounds played per frame (the excess is dropped to protect the main thread and the voice count)
  this._sfxGainPool = [];       // GainNodes of finished sources are recycled for reuse
  this._sfxInNoteLoop = false;  // Whether we are inside the per-note loop (this path only enqueues, never plays)
  this._sfxDroppedWarned = false;
  this._burstGain = 1;          // Per-flush loudness normalization: dense note bursts in one frame duck each voice
  this._sfxBus = null;          // Always-on SFX mix bus -> limiter -> destination
  this._sfxLimiter = null;      // DynamicsCompressor acting as a limiter (Phigros-style "no blow-out on dense hits")
  this.pezZip = null;
  this.chartFiles = null;
  this.bgaVideos = [];
  this.extraVideos = null;
  this._bgaCurrent = null;

  // Effects (extra.json effects, WebGL post-processing shaders)
  this.fxCanvas = document.getElementById('fx-canvas');
  this.fxGl = null;
  this._fxGlInit = false;
  this.fxEffects = [];
  this._fxExtraEffects = [];
  this._fxCustomShaders = {};
  this._fxPrograms = {};
  this._fxFBOs = null;
  this._fxChain = [];
  this._fxSrcTex = null;
  this._fxQuadBuf = null;
  this._fxGlobal = false;       // Whether the active effect chain shades the UI (any effect.global)
  this._fxGlobalCv = null;      // Scratch canvas: game scene + rasterized UI for global effects
  this._fxGlobalZ = null;       // Original z-index of the fx-canvas, saved while a global effect raises it over the play UI

  this.noteScale = 4.35;
  this.mhScale = 1.0;
  this.colorPerfect = null;
  this.colorGood = null;
  this.holdOffset = -0.1;

  this.holdParts = { normal: null, mh: null };
  this.holdSFXEnabled = false;

  this.settings = {
    musicVolume: 0.8,
    sfxVolume: 0.8,
    sfxLimit: true,     // limit simultaneous-hit loudness (Phigros-style) so dense bursts never blow out
    hitFxScale: 0.85,   // size multiplier for the hit ring / hit effect sprite
    particleEffect: true,
    playSpeed: 1.0,
    flowSpeed: 1.0,
    noteSize: 4.35,
    lineNumbers: false,
    viewportZoom: 1.0,
    autoplay: true,
    keyboardPlay: false,
    judgementScale: 1.25,
    chartHitsounds: false,
    followFatherRotate: true,
    syncOffsetMs: 0, // audio→note sync calibration; positive shifts the chart clock forward so notes hit earlier
  };

  this.loadSettings();

  this.uiElements = {
    pause: document.getElementById('pause-btn'),
    combonumber: document.getElementById('combo-number'),
    combo: document.getElementById('combo-label'),
    score: document.getElementById('score-display'),
    bar: document.getElementById('ui-bar'),
    name: document.getElementById('title-display'),
    level: document.getElementById('difficulty-display'),
  };
  this.defaultPositions = {};
  this.uiTransforms = {};
  this.uiEntrance = null;
  this._uiHold = {};
  this.attachUIIndex = {};
  this._sortedLinesCache = null;
  this.pageZoom = 1;
  this._pageDppxBaseline = this.measurePageDppx();
  this.refreshPageZoom();
  if (window.addEventListener) window.addEventListener('resize', () => { this.refreshPageZoom(); });

  // Watch for devicePixelRatio changes (browser page zoom / moving to a display with a different density):
  // re-measure pageZoom and re-run resize() so notes/judge lines/score keep their on-screen size.
  // The query is re-armed with the new dppx on every change (MDN-recommended pattern).
  const watchDppx = () => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = () => {
      this.refreshPageZoom();
      this.resize();
      watchDppx();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
    else if (mq.addListener) mq.addListener(() => onChange());
  };
  watchDppx();

  this.particleEmitters = [];
  this.bgEmitter = null;

  this.resize();
  window.addEventListener('resize', () => this.resize());
  this.activeFingers = new Map();
  this.activeKeys = new Map();
  this.keyDownCount = 0;
  this.holdTime = false;
  this.keyboardPlay = false;
  this.flickSwipeThreshold = 60;
  this.initPointerInput();
  this.initKeyboardInput();
  this.pauseBtn = document.getElementById('pause-btn');
  this.comboArea = document.getElementById('combo-area');
  this.comboNumber = document.getElementById('combo-number');
  this.comboLabel = document.getElementById('combo-label');
  this.scoreDisplay = document.getElementById('score-display');
  // Phigros 4.0.0 LIFE mode: console-enabled play UI override (not persisted).
  // When on, the combo area is always visible, shows "LIFE" with a fixed number,
  // black text with a red shadow outline, plus a red glow at the very top-center.
  this.lifeMode = false;
  this.lifeValue = 100;
  this.titleDisplay = document.getElementById('title-display');
  this.difficultyDisplay = document.getElementById('difficulty-display');
  this.statusMsg = document.getElementById('status-msg');

  this.captureDefaultPositions();
  this.initParticles();
  this.setupSettingsListeners();
}
}
// Core prototype methods
Object.assign(EnhancedRPEPlayer.prototype, {
  resize() {
  if (this._rec) return; // During recording the visible canvas is untouched; the recording canvas has a fixed resolution
  const rect = this.canvas.getBoundingClientRect();
  // The canvas is 0x0 before layout is ready: skip it so scaleX/scaleY = 0 does not stretch notes/UI on the first frame before they snap back
  if (rect.width < 4 || rect.height < 4) return;
  const dpr = window.devicePixelRatio || 1;
  this._dpr = dpr;
  this.canvas.width = rect.width * dpr;
  this.canvas.height = rect.height * dpr;
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (this.fxCanvas) {
    this.fxCanvas.width = this.canvas.width;
    this.fxCanvas.height = this.canvas.height;
    this._fxFBOs = null;
    this._fxScale = 1;
    this._fxDtEma = 0;
    this.hideFX();
  }
  this.width = rect.width;
  this.height = rect.height;
  this.scaleX = this.width / 1350;
  this.scaleY = this.height / 900;
  // Play UI scaling: based on the 1350x900 reference design, take the minimum ratio of both axes; the CSS side uses var(--uis) to scale font size / spacing / icons
  // x1.43: overall enlargement (users reported the UI was too small, +10% twice)
  document.documentElement.style.setProperty('--uis', (Math.min(this.width / 1350, this.height / 900) * 1.43).toFixed(4));
  this.captureDefaultPositions();
  if (this.bgEmitter) {
    this.bgEmitter.config.emissionShapeWidth = this.width * 2;
    this.bgEmitter.config.emissionShapeHeight = this.height * 2;
  }
  // The canvas is cleared while paused, so after a resize one extra frame must be drawn, otherwise nothing shows until playback resumes
  if (!this.isPlaying && this.chart) {
    try {
      const ct = this.getCurrentTime();
      const cb = secondsToBeat(this.bpmList, Math.max(0, ct - (this.offset || 0)));
      this.render(cb, ct);
    } catch (e) { /* Ignore on the first frame / when not ready */ }
  }
},
  toScreen(x, y) {
  return [this.width / 2 + x * this.scaleX, this.height / 2 - y * this.scaleY];
},
  judgeLineToScreen(jl) {
  return this.toScreen(jl.posX, jl.posY);
},
  initParticles() {
  const bgConfig = {
    localCoords: false,
    emissionShape: 'rect',
    emissionShapeWidth: this.width * 2,
    emissionShapeHeight: this.height * 2,
    oneShot: false,
    lifetime: 4.0,
    lifetimeRandomness: 0.5,
    amount: 50,
    explosiveness: 0,
    emitting: true,
    moveMode: 'physics',
    initialDirection: { x: 0, y: -1 },
    initialDirectionSpread: Math.PI * 0.3,
    initialVelocity: 10,
    initialVelocityRandomness: 0.5,
    linearAccel: 0,
    initialRotation: 0,
    initialRotationRandomness: Math.PI * 2,
    initialAngularVelocity: 0,
    initialAngularVelocityRandomness: 0.5,
    angularAccel: 0,
    angularDamping: 0.01,
    size: 3,
    sizeRandomness: 0.3,
    sizeCurve: [[0, 1], [0.5, 0.8], [1, 0]],
    blendMode: 'alpha',
    baseColor: { r: 0.6, g: 0.7, b: 1, a: 0.5 },
    colorsCurve: {
      start: { r: 0.6, g: 0.7, b: 1, a: 0.8 },
      mid: { r: 0.8, g: 0.9, b: 1, a: 0.6 },
      end: { r: 1, g: 1, b: 1, a: 0 }
    },
    gravity: { x: 0, y: 0 },
  };
  this.bgEmitter = new ParticleEmitter(bgConfig);
  this.bgEmitter.emit({ x: this.width/2, y: this.height/2 }, 30);
},
  measurePageDppx() {
  if (typeof window.matchMedia !== 'function') return window.devicePixelRatio || 1;
  let low = 0.5, high = 4;
  for (let i = 0; i < 6; i++) {
    const mid = (low + high) / 2;
    if (window.matchMedia('(min-resolution: ' + mid.toFixed(3) + 'dppx)').matches) low = mid; else high = mid;
  }
  return (low + high) / 2;
},
  refreshPageZoom() {
  const base = this._pageDppxBaseline || 1;
  const now = this.measurePageDppx();
  this.pageZoom = Math.max(0.5, Math.min(8, now / base));
},
  assetKey(name) {
  return (name || '').replace(/\\/g, '/').toLowerCase();
},
  showStatus(msg) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(this._statusTimeout);
  this._statusTimeout = setTimeout(() => el.classList.remove('show'), 3000);
},
  // Difficulty text formatting: if the level looks like "<token> Lv.X" (a single space
  // before "Lv." with any prefix/level string), insert one more space so it reads
  // "<token>  Lv.X". Non-matching values (e.g. "Hello, world Lv.15") stay untouched.
  formatLevel(level) {
    const s = (level !== undefined && level !== null && level !== '') ? String(level) : '-';
    return /^(\S+) Lv\./.test(s) ? s.replace(/^(\S+) Lv\./, '$1  Lv.') : s;
  }
});
