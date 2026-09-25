// PhiAI-Player || Resource pack (.zip) loader for note skins / audio
class ResourcePackLoader {
  static async loadFromZip(file) {
    console.log('[RP] 开始加载资源包:', file.name);
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const findPackFile = (name, alternatives = []) => {
      const candidates = [name, ...alternatives].filter(Boolean).map(s => String(s));
      for (const cand of candidates) {
        const exact = zip.file(cand);
        if (exact) return exact;
      }
      const entries = Object.keys(zip.files || {});
      const lower = candidates.map(c => c.toLowerCase());
      for (const path of entries) {
        if (zip.files[path].dir) continue;
        const base = path.replace(/\\/g, '/').split('/').pop().toLowerCase();
        if (lower.includes(base)) return zip.file(path);
      }
      return null;
    };
    const firstTruthy = (...values) => {
      for (const v of values) {
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    const getInfoValue = (...keys) => {
      const infoObj = (typeof info !== 'undefined' && info) ? info : {};
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(infoObj, key)) return infoObj[key];
        const match = Object.keys(infoObj).find(k => k && k.toLowerCase() === String(key).toLowerCase());
        if (match) return infoObj[match];
      }
      return undefined;
    };
    const parseTruthy = (v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') return ['1', 'true', 'yes', 'y', 'on'].includes(v.trim().toLowerCase());
      return false;
    };

    const clickFile = findPackFile('click.png');
    const hasClick = !!clickFile;
    if (!hasClick) {
      console.warn('[RP] 未找到 click.png，可能不是有效资源包');
      throw new Error('不是有效的资源包（缺少 click.png）');
    }

    const infoFile = findPackFile('info.yml', ['info.yaml', 'manifest.yaml', 'info.txt']);
    if (!infoFile) throw new Error('PEZ 文件中未找到 info.yml / info.yaml / info.txt');
    const rawText = await infoFile.async('string');
    const cleanText = rawText.replace(/^\uFEFF/, '');
    console.log('[RP] 资源包配置内容 (前200字符):', cleanText.substring(0, 200));

    const extensionMarkerPhi = '#以下为PhiAI扩展信息段';
    const extensionMarkerOld = '#以下为AiRE扩展信息段';
    const extensionEnabled = cleanText.includes(extensionMarkerPhi) || cleanText.includes(extensionMarkerOld);
    console.log('[RP] PhiAI 扩展启用:', extensionEnabled);

    let info;
    try {
      if (/\.txt$/i.test(infoFile.name || '')) {
        info = parseInfoTxt(cleanText);
      } else {
        info = jsyaml.load(cleanText);
      }
    } catch (e) {
      console.error('[RP] 配置解析失败:', e);
      throw new Error('info.yml 解析失败: ' + e.message);
    }
    if (!info || typeof info !== 'object') info = {};
    console.log('[RP] 解析后的 info 对象:', info);

    const hitFx = firstTruthy(
      getInfoValue('hitFx', 'hit_fx', 'hitfx'),
      getInfoValue('HitFx', 'Hit_Fx', 'HitFX'),
      getInfoValue('hitFxCols', 'hit_fx_cols', 'hitfxcols'),
      getInfoValue('hitFxRows', 'hit_fx_rows', 'hitfxrows')
    );
    if (!hitFx || !Array.isArray(hitFx) || hitFx.length !== 2) {
      console.error('[RP] hitFx 无效:', hitFx);
      throw new Error('配置信息缺少有效的 hitFx: [列数, 行数]');
    }

    const holdAtlas = firstTruthy(getInfoValue('holdAtlas', 'hold_atlas', 'holdatlas'), [10, 10]);
    const holdAtlasMH = firstTruthy(getInfoValue('holdAtlasMH', 'hold_atlas_mh', 'holdatlasmh'), [10, 10]);

    const loadImageFromZip = async (name) => {
      const file = findPackFile(name);
      if (!file) return null;
      const blob = await file.async('blob');
      const url = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
          // Pre-decode: the browser would otherwise decode the bitmap lazily on the main
          // thread the first time drawImage() touches it mid-frame (the playback stutter).
          try { await img.decode(); } catch (e) {}
          console.log(`[RP] 加载贴图成功: ${name}`); resolve(img);
        };
        img.onerror = () => { console.warn(`[RP] 加载贴图失败: ${name}`); resolve(null); };
        img.src = url;
      });
    };

    const loadAudioFromZip = async (basename) => {
      for (const ext of ['ogg', 'wav', 'mp3']) {
        const f = findPackFile(`${basename}.${ext}`);
        if (f) {
          const blob = await f.async('blob');
          const url = URL.createObjectURL(blob);
          try {
            const resp = await fetch(url);
            const buf = await resp.arrayBuffer();
            console.log(`[RP] 加载音效成功: ${basename}.${ext}`);
            return buf;
          } catch (e) {
            console.warn(`[RP] 加载音效失败: ${basename}.${ext}`, e);
            return null;
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
      return null;
    };

    const textures = {
      click: await loadImageFromZip('click.png'),
      click_mh: await loadImageFromZip('click_mh.png'),
      hold: await loadImageFromZip('hold.png'),
      hold_mh: await loadImageFromZip('hold_mh.png'),
      flick: await loadImageFromZip('flick.png'),
      flick_mh: await loadImageFromZip('flick_mh.png'),
      drag: await loadImageFromZip('drag.png'),
      drag_mh: await loadImageFromZip('drag_mh.png'),
      hit_fx: await loadImageFromZip('hit_fx.png'),
    };

    const soundBuffers = {
      click: await loadAudioFromZip('click'),
      drag: await loadAudioFromZip('drag'),
      flick: await loadAudioFromZip('flick'),
      ending: await loadAudioFromZip('ending'),
    };

    let colorPerfect = firstTruthy(getInfoValue('colorPerfect', 'color_perfect', 'colorperfect'), getInfoValue('ColorPerfect')) || null;
    let colorGood = firstTruthy(getInfoValue('colorGood', 'color_good', 'colorgood'), getInfoValue('ColorGood')) || null;
    let holdSFX = parseTruthy(firstTruthy(getInfoValue('HoldSFX', 'holdSFX', 'hold_sfx', 'holdsfx'), getInfoValue('HoldSfx')));
    let goodHitFX = parseTruthy(firstTruthy(getInfoValue('GoodHitFX', 'goodHitFX', 'good_hit_fx', 'goodhitfx'), getInfoValue('GoodHitFx')));
    let holdSoundBuffer = null;
    let goodHitFxImage = null;

    // These settings are used by common resource packs even when the optional
    // PhiAI/AiRE marker section is absent from info.yml.
    if (holdSFX) {
      holdSoundBuffer = await loadAudioFromZip('Hold');
      if (!holdSoundBuffer) console.warn('[RP] HoldSFX 启用但未找到 Hold 音效');
    }
    if (goodHitFX) {
      goodHitFxImage = await loadImageFromZip('hit_fx2.png');
      if (!goodHitFxImage) console.warn('[RP] GoodHitFX 启用但未找到 hit_fx2.png');
    }

    console.log('[RP] 资源包加载完成');
    return {
      info, textures, soundBuffers, hitFx, holdAtlas, holdAtlasMH,
      extensionEnabled, colorPerfect, colorGood, holdSFX, goodHitFX,
      holdSoundBuffer, goodHitFxImage,
    };
  }
}

// ============================================================
//  Main player (with integrated particle system)
// ============================================================
// Sum every stacked event layer at the given line beat. Hoisted out of the
// per-line loop: it used to allocate a fresh closure for every judge line on every frame.
function sumLayers(arrs, lb) { let s = 0; for (let i = 0; i < arrs.length; i++) s += evaluateEvent(arrs[i], lb, 0); return s; }

// Draw passes used by drawNotesOnLine: 0 = holds first, 1 = everything else.
// Hoisted so the literal array stops being reallocated per line per frame.
const __NOTE_PASSES = [0, 1];
