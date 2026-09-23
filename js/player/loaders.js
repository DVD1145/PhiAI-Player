// PhiAI-Player || js/player/loaders.js
// EnhancedRPEPlayer instance methods (loadZipFile, loadChartZipFile, finishLoadChart, loadLyricsFromFiles, loadPEZ, loadRPE, loadPEC, cleanup, loadChartFolder, readChartMetaFile, firstAudioFile, firstImageFile, loadImageEventsFromZip, warmImages, loadFontFromFolder) attached to the prototype.
Object.assign(EnhancedRPEPlayer.prototype, {
  async loadZipFile(file) {
  try {
    const parser = new PEZParser();
    const result = await parser.loadFromFile(file);
    if (result.success && result.chart) {
      await this.loadPEZ(result);
      return 'chart';
    }
  } catch (e) { /* Not a PEZ chart package */ }
  if (await this.loadChartZipFile(file)) return 'chart';
  try {
    const ok = await this.loadResourcePack(file);
    if (ok) return 'pack';
  } catch (e) { /* Not a resource pack */ }
  this.showStatus('无法识别该压缩包(非谱面包,也非资源包)');
  return false;
},
async loadChartZipFile(file) {
  this.cleanup();
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = [];
    zip.forEach((rel, obj) => { if (!obj.dir) entries.push(rel); });
    const keyOf = (rel) => rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    this.chartFiles = new Map();
    this.pezZip = zip;
    this.extraVideos = null;
    // extra.json may sit in a subfolder (when a folder is zipped directly), so look it up by file name
    let exf = zip.file('extra.json');
    if (!exf) {
      const ek = entries.find(r => keyOf(r).split('/').pop() === 'extra.json');
      if (ek) exf = zip.file(ek);
    }
    if (exf) {
      try {
        const extraObj = JSON.parse(await exf.async('string'));
        this.extraVideos = extraObj.videos || null;
        // Chart-custom Tip: extra.json tip (string) or tips (array) takes precedence over the built-in random list
        this.chartTip = pickChartTip(extraObj.tip ?? extraObj.tips);
        // Effects (extra.json effects): record the raw effect list and load the custom shader sources
        this._fxExtraEffects = Array.isArray(extraObj.effects) ? extraObj.effects : [];
        this._fxCustomShaders = {};
        for (const ef of this._fxExtraEffects) {
          if (!ef || typeof ef.shader !== 'string' || !ef.shader.startsWith('/')) continue;
          const p = ef.shader.replace(/^\/+/, '');
          let cf = zip.file(p);
          if (!cf) {
            const ek2 = entries.find(r => keyOf(r).split('/').pop() === p.split('/').pop());
            if (ek2) cf = zip.file(ek2);
          }
          if (cf) { try { this._fxCustomShaders[ef.shader] = await cf.async('string'); } catch (e) { /* Ignore */ } }
        }
      }
      catch (e) { /* A failure to parse extra.json must not break loading */ }
    }
    for (const rel of entries) {
      const key = keyOf(rel);
      try {
        const blob = await zip.file(rel).async('blob');
        blob.name = key.split('/').pop();
        if (!this.chartFiles.has(key)) this.chartFiles.set(key, blob);
        if (!this.chartFiles.has(blob.name)) this.chartFiles.set(blob.name, blob);
      } catch (e) { console.warn('[zip] 跳过无法读取的文件: ' + rel); }
    }
    await this.loadLyricsFromFiles();
let chartData = null;
    for (const rel of entries) {
      const key = keyOf(rel);
      if (!/\.(json|pec|pcmy)$/i.test(key)) continue;
      try {
        const ent0 = zip.file(rel);
        const uz0 = ent0 && ent0._data ? (ent0._data.uncompressedSize || 0) : 0;
        if (uz0 > 256 * 1024 * 1024) { this.showStatus('谱面文件过大(>256MB),请直接拖入文件夹模式'); continue; }
        const text = await zip.file(rel).async('string');
        if (/\.pcmy$/i.test(key)) {
          // PCMY charts: the companion metadata is the .txt with the same basename (e.g. 1.pcmy <-> 1.txt)
          const base = key.split('/').pop().replace(/\.pcmy$/i, '');
          let pcmMeta = null;
          const metaRel = entries.find(r => keyOf(r).split('/').pop() === (base + '.txt').toLowerCase()) ||
            entries.find(r => /\.txt$/i.test(keyOf(r)) && keyOf(r).split('/').length === 1);
          if (metaRel) {
            try { pcmMeta = JSON.parse(await zip.file(metaRel).async('string')); } catch (e) { /* No metadata */ }
          }
          const d = parsePCMY(text, pcmMeta);
          if (d.judgeLineList.length) { chartData = d; break; }
        } else if (/\.pec$/i.test(key)) {
          const d = parsePEC(text);
          if (d.judgeLineList.length) { chartData = d; break; }
        } else {
          const d = JSON.parse(text);
          if (Array.isArray(d.judgeLineList) && d.judgeLineList.length) { chartData = d; break; }
        }
      } catch (e) { /* Not a chart file */ }
    }
    if (!chartData) { this.showStatus('压缩包内未找到有效谱面'); return false; }
    const fileMeta = await this.readChartMetaFile();
    if (fileMeta) {
      chartData.META = Object.assign({}, fileMeta, chartData.META || {});
      this.infoOffsetSec = fileMeta.offsetSec || 0;
      this._hasInfoOffset = fileMeta.offsetSec !== undefined && fileMeta.offsetSec !== null;
    }
    const meta = chartData.META || {};
    const grab = (name) => {
      if (!name) return null;
      const key = name.replace(/\\/g, '/').toLowerCase();
      return this.chartFiles.get(key) || this.chartFiles.get(key.split('/').pop()) || null;
    };
    const songF = grab(meta.song) || this.firstAudioFile();
    const bgF = grab(meta.background) || this.firstImageFile();
    const unlockName = (fileMeta && fileMeta.unlockVideo) || meta.unlockVideo;
    this.unlockVideoFile = unlockName ? grab(unlockName) : null;
    if (songF) this.setupAudio(songF);
    else this.fallbackMode = true;
    if (bgF) this.setupBackground(bgF);
    await this.loadFontFromFolder();
    // End of phase one: assets / images / info are ready (background, audio, unlock video); chart data is parsed while the loading page is on screen (loadChart etc.)
    this._pendingChartData = chartData;
    return true;
  } catch (e) {
    this.showStatus('ZIP 解析失败: ' + (e && e.message || e));
    return false;
  }
},
async finishLoadChart() {
  const chartData = this._pendingChartData;
  if (!chartData) return;
  this._pendingChartData = null;
  this.loadChart(chartData);
  this.setupBGA(this.extraVideos);
  this.updateTitleAndDifficulty();
  this.updateScoreDisplay();
  this.updateAutoplayStatus();
  // Load chart image assets (image events / line textures) and warm them, and make sure the
  // built-in note/hold/hit-fx textures are ready too so the first frames never draw untextured.
  await this.loadBuiltinPack();
  await this.preloadHitsounds();
  await this.loadImageEventsFromZip();
},
async loadLyricsFromFiles() {
  this.lyricLines = null;
  const findFile = (pred) => {
    if (this.chartFiles) {
      for (const [k, f] of this.chartFiles) if (pred(k)) return f;
    }
    return null;
  };
  const lrcF = findFile((k) => /\.lrc$/i.test(k));
  if (lrcF) {
    try { this.lyricLines = parseLRC(await lrcF.text()); } catch (e) { this.lyricLines = null; }
  }
  if (!this.lyricLines || !this.lyricLines.length) {
    const ttmlF = findFile((k) => /\.ttml$/i.test(k));
    if (ttmlF) {
      try { this.lyricLines = parseTTMLLyrics(await ttmlF.text()); } catch (e) { this.lyricLines = null; }
    }
  }
  if (!this.lyricLines && this.pezZip) {
    try {
      const keys = Object.keys(this.pezZip.files).filter(k => !this.pezZip.files[k].dir);
      let k = keys.find(x => /\.lrc$/i.test(x));
      if (k) this.lyricLines = parseLRC(await this.pezZip.file(k).async('string'));
      if (!this.lyricLines || !this.lyricLines.length) {
        k = keys.find(x => /\.ttml$/i.test(x));
        if (k) this.lyricLines = parseTTMLLyrics(await this.pezZip.file(k).async('string'));
      }
    } catch (e) { this.lyricLines = null; }
  }
},
async loadPEZ(pezResult) {
  this.cleanup();
  this.chartFiles = new Map();
  this.pezData = pezResult;
  if (pezResult.audioBlob) this.setupAudio(pezResult.audioBlob);
  else this.fallbackMode = true;
  if (pezResult.imageBlob) this.setupBackground(pezResult.imageBlob);
  this.extraVideos = (pezResult.extra && Array.isArray(pezResult.extra.videos)) ? pezResult.extra.videos : null;
  this._fxExtraEffects = (pezResult.extra && Array.isArray(pezResult.extra.effects)) ? pezResult.extra.effects : [];
  this._fxCustomShaders = {};
  const pz = pezResult.zip || null;
  for (const ef of this._fxExtraEffects) {
    if (!ef || typeof ef.shader !== 'string' || !ef.shader.startsWith('/')) continue;
    const p = ef.shader.replace(/^\/+/, '');
    if (pz) {
      let cf = pz.file(p);
      if (!cf && pz.files) {
        const k = Object.keys(pz.files).find(kk => !pz.files[kk].dir && kk.replace(/\\/g, '/').split('/').pop() === p.split('/').pop());
        if (k) cf = pz.file(k);
      }
      if (cf) { try { this._fxCustomShaders[ef.shader] = await cf.async('string'); } catch (e) { /* Ignore */ } }
    }
  }
  this.chartTip = pickChartTip(pezResult.extra && (pezResult.extra.tip ?? pezResult.extra.tips));
  this.pezZip = pezResult.zip || null;
  this.loadLyricsFromFiles();
  if (pezResult.chart) {
    // Compatibility: the offset (seconds) from info.yml/info.txt is fully honored, with info.yml taking precedence and overriding the in-chart offset
    const yOff = pezResult.yamlInfo && pezResult.yamlInfo.offsetSec;
    const rawInfo = pezResult.info || {};
    const tOff = rawInfo.Offset ?? rawInfo.offset ?? rawInfo.OFFSET;
    this._hasInfoOffset = false;
    if (typeof yOff === 'number' && !isNaN(yOff)) { this.infoOffsetSec = yOff; this._hasInfoOffset = true; }
    else if (tOff !== undefined && tOff !== '' && !isNaN(parseFloat(tOff))) { this.infoOffsetSec = parseFloat(tOff); this._hasInfoOffset = true; }
    else this.infoOffsetSec = 0;
    // Compatibility: DynamicBackground is read from info.yml (preferred) or info.txt inside the package and merged into META for loadChart to consume
    const yDyn = pezResult.yamlInfo && pezResult.yamlInfo.dynamicBackground;
    const tDyn = parseInt(pezResult.info && (pezResult.info.DynamicBackground ?? pezResult.info.dynamicbackground), 10);
    const dyn = (yDyn === 1 || yDyn === 2) ? yDyn : ((tDyn === 1 || tDyn === 2) ? tDyn : 0);
    if (dyn) pezResult.chart.META = Object.assign({}, pezResult.chart.META, { dynamicBackground: dyn });
    this.loadChart(pezResult.chart); this.setupBGA(this.extraVideos);
  }
  this.preloadHitsounds();
  await this.loadBuiltinPack();
  await this.loadImageEventsFromZip();
  this.updateTitleAndDifficulty();
  this.updateScoreDisplay();
  this.updateAutoplayStatus();
},
loadRPE(jsonData) {
  this.cleanup();
  this.fallbackMode = true;
  this.loadChart(jsonData);
  this.updateTitleAndDifficulty();
  this.updateScoreDisplay();
  this.updateAutoplayStatus();
},
loadPEC(text) {
  this.cleanup();
  this.fallbackMode = true;
  this.loadChart(parsePEC(text));
  this.updateTitleAndDifficulty();
  this.updateScoreDisplay();
  this.updateAutoplayStatus();
},
cleanup() {
  this._sfxQueue.length = 0;
  this._warmupDone = false;
  this.unlockVideoFile = null;
  this.infoOffsetSec = 0;
  this._hasInfoOffset = false;
  // Drop the tint cache geometry (its key embeds the image src, which is revoked on the next
  // chart) and reset the pixel ledger so the next song starts with a clean tint cache.
  if (this._tintCache) { this._tintCache.clear(); this._tintCache = null; }
  this._tintPx = 0;
  this.lyricLines = null;
  this._lyricIdx = -1;
  this._lyricSlot = null;
  clearTimeout(this._lyricT);
  const la = document.getElementById('lyric-a');
  const lb = document.getElementById('lyric-b');
  if (la) { la.className = 'lyric-slot'; la.textContent = ''; }
  if (lb) { lb.className = 'lyric-slot'; lb.textContent = ''; }
  // Clear the frozen position of UI events when switching charts, so no docking point from the previous chart lingers
  if (this._uiHold) this._uiHold = {};
  if (this.audio) { this.audio.pause(); URL.revokeObjectURL(this.audio.src); this.audio = null; }
  if (this.backgroundImage) { URL.revokeObjectURL(this.backgroundImage.src); this.backgroundImage = null; }
  if (this.blurredBg) { URL.revokeObjectURL(this.blurredBg.src); this.blurredBg = null; }
  this.cleanupBGA();
  this.extraVideos = null;
  this.chartTip = null;
  this.dynamicBackground = 0;
  this.bgPalette = null;
  this._fluidCanvas = null;
  this._fluidCtx = null;
  this._fluidBlobs = null;
  this._fluidEnergy = undefined;
  if (this.pausedRAF) { cancelAnimationFrame(this.pausedRAF); this.pausedRAF = null; }
  this.bgReady = null;
  this.pause(); this.reset();
  this.particleEmitters = [];
  this.imageEventTextures = {};
  this.lineTextures = {};
  this.fxEffects = [];
  this._fxChain = [];
  this._fxPrograms = {};
  this._fxExtraEffects = [];
  this._fxCustomShaders = {};
  this.hideFX();
},
async loadChartFolder(fileList) {
  this.cleanup();
  const files = Array.from(fileList || []);
  if (!files.length) {
    this.showStatus('Folder is empty');
    return false;
  }
  this.chartFiles = new Map();
  for (const f of files) {
    const rel = f.webkitRelativePath ? f.webkitRelativePath : f.name;
    const key = rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    this.chartFiles.set(key, f);
    const base = key.split('/').pop();
    if (!this.chartFiles.has(base)) this.chartFiles.set(base, f);
  }
  this.pezZip = null;
  this.extraVideos = null;
  const exf = this.chartFiles.get('extra.json');
  if (exf) {
    try {
      const exObj = JSON.parse(await exf.text());
      this.extraVideos = exObj.videos || null;
      this._fxExtraEffects = Array.isArray(exObj.effects) ? exObj.effects : [];
      this._fxCustomShaders = {};
      for (const ef of this._fxExtraEffects) {
        if (!ef || typeof ef.shader !== 'string' || !ef.shader.startsWith('/')) continue;
        const p = ef.shader.replace(/^\/+/, '');
        const sf = this.chartFiles.get(p) || this.chartFiles.get(p.split('/').pop());
        if (sf) { try { this._fxCustomShaders[ef.shader] = await sf.text(); } catch (e) { /* Ignore */ } }
      }
    }
    catch (e) { /* A failure to parse extra.json must not break loading */ }
  }
  await this.loadLyricsFromFiles();
  let chartData = null;
  for (const f of files) {
    if (!/\.(json|pec|rpe|pcmy)$/i.test(f.name)) continue;
    try {
      if (f.size > 256 * 1024 * 1024) {
        // Very large charts (>256MB): reading the whole file exceeds the V8 string limit, so switch to streaming chunked indexing
        this.showStatus('超大谱面:正在流式索引 (' + (f.size / 1048576).toFixed(0) + 'MB)...');
        const d = await parsePECStreamed(f);
        if (d && d.judgeLineList.length) { chartData = d; break; }
      } else if (/\.pcmy$/i.test(f.name)) {
        const base = f.name.replace(/\.pcmy$/i, '').toLowerCase();
        let pcmMeta = null;
        const metaF = files.find(x => (x.webkitRelativePath || x.name).replace(/\\/g, '/').split('/').pop().toLowerCase() === (base + '.txt'))
          || files.find(x => /\.txt$/i.test(x.name) && (x.webkitRelativePath ? (x.webkitRelativePath.split('/').length === 1) : true));
        if (metaF) { try { pcmMeta = JSON.parse(await metaF.text()); } catch (e) { /* No metadata */ } }
        const d = parsePCMY(await f.text(), pcmMeta);
        if (d.judgeLineList.length) { chartData = d; break; }
      } else if (/\.pec$/i.test(f.name)) {
        const d = parsePEC(await f.text());
        if (d.judgeLineList.length) { chartData = d; break; }
      } else {
        const d = JSON.parse(await f.text());
        if (Array.isArray(d.judgeLineList) && d.judgeLineList.length) { chartData = d; break; }
      }
    } catch (e) { /* not a chart json */ }
  }
  if (!chartData) {
    this.showStatus('No valid chart file (.json/.rpe/.pec/.pcmy) in folder');
    return false;
  }
  const fileMeta = await this.readChartMetaFile();
  if (fileMeta) {
    chartData.META = Object.assign({}, fileMeta, chartData.META || {});
    this.infoOffsetSec = fileMeta.offsetSec || 0;
    this._hasInfoOffset = fileMeta.offsetSec !== undefined && fileMeta.offsetSec !== null;
  }
const meta = chartData.META || {};
    const grab = (name) => {
    if (!name) return null;
    const key = name.replace(/\\/g, '/').toLowerCase();
    return this.chartFiles.get(key) || this.chartFiles.get(key.split('/').pop()) || null;
  };
  const songF = grab(meta.song) || this.firstAudioFile();
  const bgF = grab(meta.background) || this.firstImageFile();
  const unlockName = (fileMeta && fileMeta.unlockVideo) || meta.unlockVideo;
  this.unlockVideoFile = unlockName ? grab(unlockName) : null;
  if (songF) this.setupAudio(songF);
  else this.fallbackMode = true;
  if (bgF) this.setupBackground(bgF);
  await this.loadFontFromFolder();
  this.loadChart(chartData);
  this.setupBGA(this.extraVideos);
  this.updateTitleAndDifficulty();
  this.updateScoreDisplay();
  this.updateAutoplayStatus();
  await this.loadBuiltinPack();
  await this.preloadHitsounds();
  await this.loadImageEventsFromZip();
  return true;
},
async readChartMetaFile() {
  if (!this.chartFiles) return null;
  const yml = this.chartFiles.get('info.yml') || this.chartFiles.get('manifest.yaml') || this.chartFiles.get('info.yaml');
  if (yml) { try { const info = parseInfoYaml(await yml.text()); if (info) return info; } catch (e) { /* ignore */ } }
  if (this.pezZip) {
    const zy = this.pezZip.file('info.yml') || this.pezZip.file('info.yaml') || this.pezZip.file('manifest.yaml');
    if (zy) { try { const info = parseInfoYaml(await zy.async('string')); if (info) return info; } catch (e) {} }
  }
  const itxt = this.chartFiles.get('info.txt');
  if (itxt) { try { const info = parseInfoTxt(await itxt.text()); if (info) return info; } catch (e) {} }
  const csv = this.chartFiles.get('info.csv');
  if (csv) { try { const info = parseInfoCsv(await csv.text()); if (info) return info; } catch (e) {} }
  return null;
},
firstAudioFile() {
  if (!this.chartFiles) return null;
  let best = null;
  for (const [k, f] of this.chartFiles) {
    if (!/\.(ogg|mp3|wav|flac|m4a)$/i.test(k)) continue;
    const base = k.split('/').pop();
    const s = base === 'music.ogg' ? 3 : /^(music|audio)\.(mp3|ogg)$/i.test(base) ? 2 : 1;
    if (!best || s > best.s) best = { f, s };
  }
  return best ? best.f : null;
},
firstImageFile() {
  if (!this.chartFiles) return null;
  let best = null;
  for (const [k, f] of this.chartFiles) {
    if (!/\.(png|jpg|jpeg|webp)$/i.test(k)) continue;
    const base = k.split('/').pop();
    if (/(icon|jacket|cover|hit|fx|note)/i.test(base)) continue;
    const s = base === 'bg.png' ? 3 : /^bg/i.test(base) ? 2 : 1;
    if (!best || s > best.s) best = { f, s };
  }
  return best ? best.f : null;
},
async loadImageEventsFromZip() {
  this.imageEventTextures = this.imageEventTextures || {};
  this.lineTextures = this.lineTextures || {};
  this.missingAssets = this.missingAssets || [];
  const queue = [];
  for (const name of (this.imageEventFiles || [])) queue.push([name, 'ev']);
  for (const name of (this.lineTextureFiles || [])) queue.push([name, 'line']);
  for (const [name, kind] of queue) {
    const src = await this.resolveAsset(name);
    if (!src) {
      console.warn('[Player] image asset not found: ' + name);
      this.missingAssets.push(name);
      continue;
    }
    try {
      const buf = await src.arrayBuffer();
      const img = new Image();
      const objUrl = URL.createObjectURL(new Blob([buf]));
      img.src = objUrl;
      // Pre-decode so the browser never decodes this image synchronously mid-frame; the
      // blob URL can be released once the bitmap is available.
      try { await img.decode(); } catch (e) {}
      URL.revokeObjectURL(objUrl);
      const cache = kind === 'line' ? this.lineTextures : this.imageEventTextures;
      cache[name] = img;
      const key = this.assetKey(name);
      if (key !== name) cache[key] = img;
      // GIF textures: extract the frames with omggif (needed by the gifEvents playback progress control of isGif lines)
      if (kind === 'line' && /\.gif$/i.test(name)) {
        try {
          const reader = new GifReader(new Uint8Array(buf));
          const n = reader.numFrames();
          if (n > 0) {
            const W = reader.width, H = reader.height;
            const canvasBuf = new Uint8ClampedArray(W * H * 4);
            const frames = [];
            const delays = [];
            for (let fi = 0; fi < n; fi++) {
              const info = reader.frameInfo(fi);
              const px = new Uint8ClampedArray(info.width * info.height * 4);
              reader.decodeAndBlitFrameRGBA(fi, px);
              const composed = new Uint8ClampedArray(W * H * 4);
              for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                  const o = (y * W + x) * 4;
                  if (y >= info.y && y < info.y + info.height && x >= info.x && x < info.x + info.width) {
                    const s = ((y - info.y) * info.width + (x - info.x)) * 4;
                    composed[o] = px[s]; composed[o + 1] = px[s + 1]; composed[o + 2] = px[s + 2]; composed[o + 3] = px[s + 3];
                  } else {
                    composed[o] = canvasBuf[o]; composed[o + 1] = canvasBuf[o + 1]; composed[o + 2] = canvasBuf[o + 2]; composed[o + 3] = canvasBuf[o + 3];
                  }
                }
              }
              if (info.disposal === 2) canvasBuf.fill(0);
              else if (info.disposal === 3) { /* Keep: the previous frame is canvasBuf (it already holds the last rendered frame) */ }
              else canvasBuf.set(composed);
              const c = document.createElement('canvas');
              c.width = W; c.height = H;
              const cctx = c.getContext('2d');
              cctx.putImageData(new ImageData(composed, W, H), 0, 0);
              frames.push(c);
              delays.push(Math.max(1, info.delay || 10) * 10);
            }
            const gifDec = { width: W, height: H, frames: frames, delays: delays };
            this.gifFrameCache[key] = gifDec;
            if (key !== name) this.gifFrameCache[name] = gifDec;
          }
        } catch (ge) { console.warn('[Player] gif frame extract failed: ' + name, ge); }
      }
    } catch (e) { console.warn('[Player] image load failed: ' + name, e); }
  }
  if (this.missingAssets && this.missingAssets.length) {
    const list = [...new Set(this.missingAssets)].join(', ');
    this.showStatus('缺少图片: ' + list);
  }
  await this.warmImages();
},
async warmImages() {
  // GPU-texture warm-up lives on the MAIN canvas context, not an off-screen scratch: Chrome keys
  // the decoded-bitmap -> GPU-texture cache by the destination context, so drawing images only to
  // _warmCv left the very first ctx.drawImage(img) on the visible canvas to pay the full upload
  // -> '图片出现时卡一小帧' regardless of any preprocessing. Draw once here under the default
  // transform, then clear, so the first real frame reuses the already-uploaded texture.
  const ctx = this.ctx;
  const warm = (img) => {
    if (!img || !img.width || !img.height) return;
    if (typeof img.complete === 'boolean' && !img.complete) return;
    if (!ctx || !ctx.canvas || !ctx.canvas.width || !ctx.canvas.height) return;
    try {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } catch (e) { /* Ignore */ }
  };
  for (const k in this.imageEventTextures) warm(this.imageEventTextures[k]);
  for (const k in this.lineTextures) warm(this.lineTextures[k]);
  if (this.gifFrameCache) for (const k in this.gifFrameCache) {
    const g = this.gifFrameCache[k];
    if (g && g.frames) for (const f of g.frames) { if (f && f.width) warm(f); }
  }
  warm(this.backgroundImage);
  warm(this.blurredBg);
  if (this.noteTextures) for (const k in this.noteTextures) warm(this.noteTextures[k]);
  if (this.holdParts) { warm(this.holdParts.head); warm(this.holdParts.body); warm(this.holdParts.tail); }
  if (this.holdPartsMH) { warm(this.holdPartsMH.head); warm(this.holdPartsMH.body); warm(this.holdPartsMH.tail); }
  if (this.holdPartsMHF) { warm(this.holdPartsMHF.head); warm(this.holdPartsMHF.body); warm(this.holdPartsMHF.tail); }
  // Pre-compute the multiply tint for every in-chart judge-line texture at its draw size.
  // jl.color is only interpolated during play (playback.js), so do not rely on it here: evaluate
  // the event colors directly. Texture lines with colorEvents are almost always big art and a tint
  // rebuilds 4 full-size canvas passes, so building the colors now moves that cost into the loading
  // screen instead of the first frame the picture appears on. Small/medium textures get every
  // discrete color pre-built (covers the whole gradient cheaply); very large textures get only the
  // first-seen color so the loading page does not grind through dozens of ~72MB tint canvases.
  const baseW = this.width || 1350;
  const lines = this.chart && this.chart.judgeLineList;
  if (baseW && lines) {
    const qv = (v) => v >= 255 ? 255 : Math.min(255, Math.round(v / 2) * 2);
    const qk = (c) => `${qv(c[0])},${qv(c[1])},${qv(c[2])}`;
    // Aggregate every distinct event color per (texture, draw size): many textured lines share one
    // texture (GlowLine1/omega/by are used by several lines), so collecting line-by-line and then
    // pre-warming duplicates would waste loading time. Cache keys are (src|size|color), so one
    // pre-built tint covers all lines that share the same art and color.
    const perTex = new Map();
    for (const jl of lines) {
      if (jl.isGif) continue;
      if (!(jl.texture && this.lineTextures)) continue;
      const tex = this.lineTextures[jl.texture] || this.lineTextures[this.assetKey(jl.texture)];
      if (!tex || !tex.width || !tex.complete) continue;
      const ce = jl.colorEvents || [];
      if (!ce.length) continue;
      const imgW = Math.max(1, tex.width * (baseW / 1350));
      const imgH = Math.max(1, tex.height * (baseW / 1350));
      const key = ((tex.src || tex.currentSrc) || tex.width + 'x' + tex.height) + '|' + imgW + 'x' + imgH;
      let set = perTex.get(key);
      if (!set) { set = { colors: new Set(), w: imgW, h: imgH, tex: tex, px: imgW * imgH }; perTex.set(key, set); }
      const want = set.colors;
      if (Array.isArray(jl.color)) want.add(qk(jl.color));
      for (const ev of ce) {
        if (Array.isArray(ev.start)) want.add(qk(ev.start));
        if (Array.isArray(ev.end)) want.add(qk(ev.end));
        if (want.size >= 8) break;
      }
    }
    // Very large textures: each tint is a ~60-70MB canvas, so only keep the colors that actually
    // open/end a colorEvent on lines that carry it; skip colors that are pure white (those return
    // the raw image with no canvas at all).
    for (const [k, s] of perTex) {
      const big = s.px > 2000000;
      let n = 0;
      for (const c of s.colors) {
        const [cr, cg, cb] = c.split(',').map(Number);
        if (cr >= 255 && cg >= 255 && cb >= 255) continue;
        const tinted = this.tintImage(s.tex, s.w, s.h, cr, cg, cb, true);
        if (tinted && tinted.width) warm(tinted);
        if (big && ++n >= 6) break;
      }
    }
  }
  // The GPU warm-ups drew all textures to (0,0) on the main canvas; clear it so nothing leaks
  // into the first real frame (the loading screen is opaque, but a clear here is free insurance).
  if (ctx && ctx.canvas && ctx.canvas.width && ctx.canvas.height) {
    try { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore(); } catch (e) { /* Ignore */ }
  }
},
async loadFontFromFolder() {
  const f = this.chartFiles.get('misans-normal.ttf');
  if (!f) return;
  try {
    const fa = new FontFace('MiSans', await f.arrayBuffer());
    await fa.load();
    document.fonts.add(fa);
    console.log('[Player] font loaded: MiSans');
  } catch (e) {
    console.warn('[Player] font load failed', e);
  }
}
});
