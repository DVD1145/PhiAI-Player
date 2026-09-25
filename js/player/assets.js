// PhiAI-Player || js/player/assets.js
// EnhancedRPEPlayer instance methods (loadResourcePack, loadBuiltinPack, splitHoldTextures, resolveAsset, preloadHitsounds) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  async loadResourcePack(file) {
  try {
    const result = await ResourcePackLoader.loadFromZip(file);
    this.resourcePack = result;
    this.noteTextures = result.textures;
    this.hitFxImage = result.textures.hit_fx;
    this.goodHitFxImage = result.goodHitFxImage || null;

    this.colorPerfect = result.colorPerfect || null;
    this.colorGood = result.colorGood || null;
    this.holdSFXEnabled = result.holdSFX || false;
    if (this.holdSFXEnabled && result.holdSoundBuffer) {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      try {
        const buf = await this.audioCtx.decodeAudioData(result.holdSoundBuffer);
        this.audioBuffers['hold'] = buf;
        console.log('[Player] Hold 音效已加载');
      } catch (e) {
        console.warn('[Player] Hold 音效解码失败', e);
      }
    }

    const clickW = this.noteTextures.click ? this.noteTextures.click.width : 1;
    const clickMHW = this.noteTextures.click_mh ? this.noteTextures.click_mh.width : 1;
    this.mhScale = clickMHW / clickW;

    const hitFx = result.hitFx;
    this.hitFxAtlasConfig = {
      cols: hitFx[0],
      rows: hitFx[1],
      totalFrames: hitFx[0] * hitFx[1],
      holdAtlas: result.holdAtlas,
      holdAtlasMH: result.holdAtlasMH,
      duration: 0.5, scale: 1.0, rotate: false, holdRepeat: false,
      holdKeepHead: false, holdCompact: false, hideParticles: false, hitFxTinted: true,
    };
    const infoValue = (...keys) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(result.info || {}, key)) return result.info[key];
        const match = Object.keys(result.info || {}).find(k => k.toLowerCase() === String(key).toLowerCase());
        if (match) return result.info[match];
      }
      return undefined;
    };
    const boolValue = (value, fallback = false) => {
      if (value === undefined || value === null || value === '') return fallback;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
    };
    const duration = Number(infoValue('hitFxDuration', 'hit_fx_duration'));
    const scale = Number(infoValue('hitFxScale', 'hit_fx_scale'));
    this.hitFxAtlasConfig.duration = Number.isFinite(duration) && duration > 0 ? duration : 0.5;
    this.hitFxAtlasConfig.scale = Number.isFinite(scale) && scale > 0 ? scale : 1.0;
    this.hitFxAtlasConfig.rotate = boolValue(infoValue('hitFxRotate', 'hit_fx_rotate'));
    this.hitFxAtlasConfig.holdRepeat = boolValue(infoValue('holdRepeat', 'hold_repeat'));
    this.hitFxAtlasConfig.holdKeepHead = boolValue(infoValue('holdKeepHead', 'hold_keep_head'));
    this.hitFxAtlasConfig.holdCompact = boolValue(infoValue('holdCompact', 'hold_compact'));
    this.hitFxAtlasConfig.hideParticles = boolValue(infoValue('hideParticles', 'hide_particles'));
    this.hitFxAtlasConfig.hitFxTinted = boolValue(infoValue('hitFxTinted', 'hit_fx_tinted'), true);

this.holdParts = await this.splitHoldTextures(this.noteTextures.hold, result.holdAtlas);
  this.holdPartsMH = await this.splitHoldTextures(this.noteTextures.hold_mh, result.holdAtlasMH);

    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const loadSound = async (buf) => {
      if (!buf) return null;
      try {
        return await this.audioCtx.decodeAudioData(buf);
      } catch (e) {
        console.warn('音效解码失败', e);
        return null;
      }
    };
    this.audioBuffers['click'] = await loadSound(result.soundBuffers.click);
    this.audioBuffers['drag'] = await loadSound(result.soundBuffers.drag);
    this.audioBuffers['flick'] = await loadSound(result.soundBuffers.flick);
    this.audioBuffers['ending'] = await loadSound(result.soundBuffers.ending);

    this.useResourcePack = true;
    console.log('[Player] 资源包已启用, mhScale =', this.mhScale);
    this.showStatus('资源包加载成功!');
    return true;
  } catch (e) {
    console.error('[Player] 资源包加载失败:', e);
    this.showStatus('资源包加载失败: ' + e.message);
    return false;
  }
},
async loadBuiltinPack() {
  // Preloading contract: safe to call at any time and idempotent. bootstrap.js fires it at
  // startup without awaiting; every chart-load path awaits the same cached promise before
  // play starts, so note/hold/hit-fx textures are always warm by the first frame. A user
  // resource pack takes precedence and leaves the built-in pack untouched.
  if (this._builtinPackPromise) return this._builtinPackPromise;
  if (this.resourcePack && this.useResourcePack) {
    this._builtinPackPromise = Promise.resolve(false);
    return this._builtinPackPromise;
  }
  this._builtinPackPromise = this._doLoadBuiltinPack().catch((e) => {
    console.error('[Player] 内置资源包加载失败:', e);
    // Allow a later retry (e.g. the page was later served over HTTP with real assets)
    this._builtinPackPromise = null;
    return false;
  });
  return this._builtinPackPromise;
},
async _doLoadBuiltinPack() {
  const R = (typeof window !== 'undefined' && window.BUILTIN_RESOURCES) || null;
  const DIR = (typeof window !== 'undefined' && window.AIRE_BUILTIN_DIR) || null;
  if ((!R && !DIR) || this.builtinPackLoaded) return false;
  // fetch() is blocked on file:// pages, so a double-clicked split repo cannot read
  // assets/builtin/* from disk. Fall back to the embedded base64 copy in that case
  // (window.BUILTIN_RESOURCES from js/builtin-resources.js); over HTTP the real files are used.
  const embeddedOnly = (typeof location !== 'undefined') && location.protocol === 'file:';
  this.builtinPackLoaded = true;
  const toBlob = async (name, type) => {
    if (DIR && !embeddedOnly) {
      try {
        const resp = await fetch(DIR + name);
        if (resp.ok) return await resp.blob();
      } catch (e) { /* fall through to the embedded copy */ }
    }
    const b64 = R && R[name];
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  };
  const imgOf = async (name) => {
    const blob = await toBlob(name, 'image/png');
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let loaded = false;
    await new Promise((res) => {
      img.onload = () => { loaded = true; res(); };
      img.onerror = () => res();
      img.src = url;
    });
    if (!loaded) { URL.revokeObjectURL(url); return null; }
    try { await img.decode(); } catch (e) {}
    URL.revokeObjectURL(url);
    return img;
  };
  const audioOf = async (name, type) => {
    const blob = await toBlob(name, type);
    if (!blob) return null;
    return await blob.arrayBuffer();
  };
  const clickImg = await imgOf('click.png');
  if (!clickImg) { this.builtinPackLoaded = false; console.warn('[Player] 内置资源包缺少 click.png'); return false; }
  const textures = {
    click: clickImg,
    click_mh: await imgOf('click_mh.png'),
    hold: await imgOf('hold.png'),
    hold_mh: await imgOf('hold_mh.png'),
    flick: await imgOf('flick.png'),
    flick_mh: await imgOf('flick_mh.png'),
    drag: await imgOf('drag.png'),
    drag_mh: await imgOf('drag_mh.png'),
    hit_fx: await imgOf('hit_fx.png'),
  };
  const holdAtlas = [50, 50];
  const holdAtlasMH = [98, 98];
  this.noteTextures = textures;
  this.hitFxImage = textures.hit_fx;
  this.hitFxAtlasConfig = {
    cols: 5, rows: 6, totalFrames: 30, duration: 0.5, scale: 1.0,
    rotate: false, holdRepeat: false, holdAtlas, holdAtlasMH,
    holdKeepHead: false, holdCompact: false, hideParticles: false, hitFxTinted: true,
  };
  this.holdParts = await this.splitHoldTextures(textures.hold, holdAtlas);
  this.holdPartsMH = await this.splitHoldTextures(textures.hold_mh, holdAtlasMH);
  const cwA = textures.click ? textures.click.width : 1;
  const cwB = textures.click_mh ? textures.click_mh.width : 1;
  this.mhScale = cwB / cwA;
  if (!this.audioCtx) {
    try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.audioCtx = null; }
  }
  if (this.audioCtx) {
    const loadS = async (name, type) => {
      const ab = await audioOf(name, type);
      if (!ab) return null;
      try { return await this.audioCtx.decodeAudioData(ab); } catch (e) { return null; }
    };
    this.audioBuffers['click'] = await loadS('click.ogg', 'audio/ogg');
    this.audioBuffers['drag'] = await loadS('drag.ogg', 'audio/ogg');
    this.audioBuffers['flick'] = await loadS('flick.ogg', 'audio/ogg');
    this.audioBuffers['ending'] = await loadS('ending.mp3', 'audio/mpeg');
    this.audioBuffers['tap6'] = await loadS('tap6.wav', 'audio/wav');
  }
  this.useResourcePack = true;
  console.log('[Player] 内置默认资源包已启用');
  return true;
},
async splitHoldTextures(holdImg, atlas) {
  if (!holdImg || !holdImg.complete || holdImg.width === 0) return null;
  const [tailHeight, headHeight] = atlas;
  const totalHeight = holdImg.height;
  const bodyHeight = totalHeight - tailHeight - headHeight;
  if (bodyHeight <= 0) {
    console.warn('Hold 贴图高度不足以切分，使用整图拉伸');
    return { tail: holdImg, body: holdImg, head: holdImg, tailHeight, headHeight, bodyHeight };
  }
  const crop = async (y, h) => {
    if (h <= 0) return null;
    const c = document.createElement('canvas');
    c.width = holdImg.width;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(holdImg, 0, y, holdImg.width, h, 0, 0, holdImg.width, h);
    const img = new Image();
    img.src = c.toDataURL();
    try { await img.decode(); } catch (e) {}
    return img;
  };
  const tail = await crop(0, tailHeight);
  const body = await crop(tailHeight, bodyHeight);
  const head = await crop(tailHeight + bodyHeight, headHeight);
  return { tail, body, head, tailHeight, headHeight, bodyHeight };
},
async resolveAsset(p) {
  const key = p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const base = key.split('/').pop();
  const baseNoExt = base.replace(/\.[^.]+$/, '');
  if (this.chartFiles) {
    const f = this.chartFiles.get(key) || this.chartFiles.get(base);
    if (f) return f;
    for (const [k, v] of this.chartFiles) {
      // Extension-less lookups (e.g. the sample set name soft-hitnormal) must also match soft-hitnormal.wav/.ogg
      const kBase = k.split('/').pop().replace(/\.[^.]+$/, '');
      if (k === baseNoExt || kBase === baseNoExt) return v;
    }
  }
  if (this.pezZip) {
    const entry = Object.values(this.pezZip.files).find(e => { if (e.dir) return false; const fn = e.name.replace(/\\/g, '/').toLowerCase(); return fn === key || fn === base || fn.split('/').pop() === base; });
    if (entry) return { arrayBuffer: () => entry.async('arraybuffer') };
  }
  return null;
},
async preloadHitsounds() {
  const paths = new Set();
  for (const jl of (this.chart && this.chart.judgeLineList) || []) {
    for (const n of (jl.notes) || []) {
      if (n.hitsound) paths.add(n.hitsound);
    }
    if (jl.pendingNotes) for (const p of jl.pendingNotes) {
      if (p.raw && p.raw.hitsound) paths.add(p.raw.hitsound);
    }
  }
  if (!paths.size) return;
  if (!this.audioCtx) {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  for (const p of paths) {
    const src = await this.resolveAsset(p);
    if (!src) {
      console.warn('[Player] hitsound not found: ' + p);
      continue;
    }
    try {
      const buf = await this.audioCtx.decodeAudioData(await src.arrayBuffer());
      this.audioBuffers['hs:' + p] = buf;
      this.hitsoundMap[p] = 'hs:' + p;
      console.log('[Player] hitsound loaded: ' + p);
    } catch (e) {
      console.warn('[Player] hitsound decode failed: ' + p, e);
    }
  }
}
});
