// PhiAI-Player || js/bootstrap.js
// Top-level bootstrap: wires the canvas, UI file inputs, recording and the player instance.
// ============================================================
//  Settings modal control
// ============================================================
function openSettings() {
  document.getElementById('settings-modal').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
}
document.getElementById('settings-toggle').addEventListener('click', openSettings);
document.getElementById('settings-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});

// ============================================================
//  Initialization
// ============================================================
const canvas = document.getElementById('game-canvas');
const player = new EnhancedRPEPlayer(canvas);
window.playerRef = player; // Top-level consts are not exposed on window; the custom UI runtime needs to reference them
player.loadBuiltinPack();

function formatClock(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

async function showStagedChart() {
  const ls = document.getElementById('load-screen');
  // Phase two for zip/folder imports (no-op for direct loads where the chart was already built)
  try { await player.finishLoadChart(); }
  catch (e) { player.showStatus('谱面解析失败: ' + (e && e.message || e)); return; }
  // Direct-load paths (.json/.rpe/.pec/.pcmy) have no chart assets to preload, but the built-in
  // note/hold/hit-fx textures still power every chart: await them (idempotent, cached) so the play
  // screen never starts with untextured notes. Original fire-and-forget bootstrap() call is unblocked.
  try { await player.loadBuiltinPack(); } catch (e) { /* Ignore */ }
  await player.waitBackground();
  const loadBg = document.getElementById('load-bg');
  const bgSrc = (player.blurredBg && player.blurredBg.src) || (player.backgroundImage && player.backgroundImage.src);
  if (bgSrc) {
    loadBg.style.backgroundImage = 'url("' + bgSrc + '")';
    requestAnimationFrame(() => { loadBg.style.opacity = '1'; });
  }
  ls.style.display = '';
  ls.style.transform = '';
  ls.style.opacity = '';
  ls.style.zIndex = '';
  ls.classList.remove('hidden', 'loading-mode');
  const meta = (player.chart && player.chart.META) || (player._pendingChartData && player._pendingChartData.META) || {};
  const title = meta.name || meta.title || meta.songName || 'Unknown';
  const p = ls.querySelector('p');
  if (p) p.textContent = '已载入 ' + title;
  const row = document.getElementById('chart-action-row');
  if (row) row.style.display = 'flex';
}

function undoImport() {
  player._pendingChartData = null;
  try { player.cleanup(); } catch (e) { /* Ignore */ }
  player.chart = null;
  player.judgeLines = [];
  player.notes = [];
  player.bpmList = null;
  player.totalSeconds = 0;
  player.chartFiles = null;
  player.pezZip = null;
  const row = document.getElementById('chart-action-row');
  if (row) row.style.display = 'none';
  const ls = document.getElementById('load-screen');
  const p = ls.querySelector('p');
  if (p) p.textContent = '请导入文件.';
  const loadBg = document.getElementById('load-bg');
  loadBg.style.backgroundImage = '';
  loadBg.style.opacity = '';
  try { player.ctx.fillStyle = '#000'; player.ctx.fillRect(0, 0, player.width, player.height); } catch (e) { /* Ignore */ }
}

async function afterLoad() {
  // Only enter the play screen once the offline background blur is ready, so the unblurred original is never shown first
  await player.waitBackground();
  const cv = document.getElementById('game-canvas');
  const overlay = document.getElementById('intro-overlay');
  const loadBg = document.getElementById('load-bg');
  const uiEls = ['pause-btn', 'combo-area', 'score-display', 'title-display', 'difficulty-display', 'ui-bar']
    .map(id => document.getElementById(id)).filter(Boolean);

  // After the chart finishes loading: do not render the play UI and the chart yet (everything is deferred until the overlay finishes expanding)
  for (const el of uiEls) el.style.opacity = '0';

  // 1) The main background gradient turns into the blurred chart background (0.5s fade into the #load-bg layer of load-screen)
  if (player.blurredBg && player.blurredBg.src) {
    loadBg.style.backgroundImage = 'url("' + player.blurredBg.src + '")';
  } else if (player.backgroundImage && player.backgroundImage.src) {
    loadBg.style.backgroundImage = 'url("' + player.backgroundImage.src + '")';
  }
  requestAnimationFrame(() => { loadBg.style.opacity = '1'; });

  // 2) Reset the overlay: blurred chart background, the clip-path polygon starts from the left anchor (zero width, fully invisible)
  overlay.style.transition = 'none';
  overlay.style.opacity = '1';
  overlay.style.clipPath = 'polygon(0 0, 0 0, 0 100%, 0 100%)';
  overlay.style.visibility = 'visible';
  overlay.classList.remove('bright');
  if (player.blurredBg && player.blurredBg.src) {
    overlay.style.backgroundImage = 'url("' + player.blurredBg.src + '")';
  } else if (player.backgroundImage && player.backgroundImage.src) {
    overlay.style.backgroundImage = 'url("' + player.backgroundImage.src + '")';
  }
  void overlay.offsetWidth; // Force a reflow so the starting style is committed and the following expansion always triggers the animation

  // 3) Once the background gradient finishes (0.5s): the overlay expands left to right as a polygon, -15deg slanted edge, easeOutExpo 1s
  setTimeout(() => {
    try {
      var au2 = new Audio(AIRE_SFX.boot);
      au2.preload = 'auto';
      var st2 = false;
      var clean2 = null;
      var tp2 = function () {
        if (st2) return;
        var pr = au2.play();
        if (pr && pr.then) {
          pr.then(function () { st2 = true; if (clean2) clean2(); }).catch(function () {});
        }
      };
      var rv2 = function () { tp2(); };
      clean2 = function () {
        ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
          document.removeEventListener(ev, rv2);
        });
      };
      ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
        document.addEventListener(ev, rv2, { passive: true });
      });
      tp2();
    } catch (e) {}
    const tan15 = Math.tan(15 * Math.PI / 180); // ≈ 0.2679
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const offsetPx = vh * tan15; // Horizontal offset of the slanted edge at the bottom
    const duration = 1000;
    const startTime = performance.now();
    function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
    function animateClip(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(t);
      // Top right: 0 -> (vw + offsetPx), bottom right: 0 -> vw, forming a -15deg slanted edge
      const rightTop = eased * (vw + offsetPx);
      const rightBottom = eased * vw;
      overlay.style.clipPath = 'polygon(0 0, ' + rightTop + 'px 0, ' + rightBottom + 'px 100%, 0 100%)';
      if (t < 1) requestAnimationFrame(animateClip);
    }
    requestAnimationFrame(animateClip);
  }, 500);

  // 4) Once the overlay is fully expanded (it now covers the main UI): drop the tint layer (transparent, revealing the image's own colors, easeInCubic 0.5s) and fade the loading page in (opacity 0 -> 100)
  setTimeout(async () => {
    const ls = document.getElementById('load-screen');
    overlay.classList.add('bright');
    ls.classList.remove('hidden');
    ls.style.display = '';
    ls.classList.add('loading-mode');
    // Loading page fade-in: force opacity = 0, reflow, then step it from 0 to 1 with JS (16ms steps, 0.5s).
    // No CSS transition, because styles merged within the same frame would never trigger it (the root cause of the earlier 'fade never plays' bug)
    ls.style.opacity = '0';
    void ls.offsetWidth;
    const fadeInStart = performance.now();
    const fadeInDur = 500;
    function fadeInStep() {
      const t = Math.min((performance.now() - fadeInStart) / fadeInDur, 1);
      ls.style.opacity = String(t);
      if (t < 1) setTimeout(fadeInStep, 16);
    }
    fadeInStep();
// Loading page song title: positioned after the 3.png object, shows META.name of the current chart
    const songEl = ls.querySelector('#ld-songname');
    if (songEl) {
      const meta = ((player._pendingChartData && player._pendingChartData.META) || (player.chart && player.chart.META)) || {};
      songEl.textContent = meta.name || meta.title || meta.songName || 'Unknown';
    }
// Loading page composer: positioned after the 4.png object, shows META.composer of the current chart
    const compEl = ls.querySelector('#ld-composer');
    if (compEl) {
      const meta = ((player._pendingChartData && player._pendingChartData.META) || (player.chart && player.chart.META)) || {};
      compEl.textContent = meta.composer || 'Unknown';
    }
// Loading page Tip: show one random entry (text taken from tip/Tip.txt, 36 entries); click to switch / jump
    const tipEl = ls.querySelector('#ld-tip');
    if (tipEl) {
      const TIPS = [
        'PhiU!',
        '我塞了一坨音频和图片在这里面！',
        '什么，这不是Phigros，也不是PhiTogether，还不是...太长了不念。',
        '卡死你卡死你',
        '不是ZIPPECPEZPPP1POSZ到底是什么格式...?',
        '在所有编辑器中唯独后尾为3的最特殊。',
        'JSON好用极了',
        '这里的Tip为什么没有实用内容....',
        '拆线？我拆拆拆拆拆拆拆！',
        '*Tip.txt -记事本',
        '你说这个很卡...怎么不看看他基于什么呜呜呜....',
        '冷知识，PhiAI-Player最初只是随便用AI做的读取器',
        '从明天开始游玩PhiAI 2小时将会收费5元，25元可永久使用。',
        '豆包豆包帮我生成一个网页格式的Phigros网页模拟器。',
        '本回答由 Tip: 生成，内容仅供参考，请仔细甄别',
        '细看你会发现他正在加载',
        '本项目DSv4v3R1Hy3TRAEGLM53',
        '广告招租位 联系电话+13 25733473',
        '点击视频下方链接即可玩到主播同款。',
        '在PhiAIplayer -0.9999.9.99版本中，他根本就没有发布出来。',
        '这是一条来自PhiAIplayer的Tip!',
        'XX.XXX!',
        '/bx',
        '本轮Tip话题已到上限，请开启新话题。',
        '当前时间是[HH:MM:SS]，诶？为什么读取不出来....',
        '不是谁告诉你这是Rust做的',
        '我要更新，这次该参考哪个谱面呢...',
        '5469703A',
        'UwU',
        '为什么谱面有1E+(1E+100)个音符....',
        '你肯定玩过Phira!',
        '我怀疑你是不是偷看了这条Tip....!',
        'AP来! AP来!',
        '我不告诉你24缓动几乎全部人都用过....',
        '点击此条Tip有惊喜!_{}骗你的根本就没有{}',
        '其实给谱面Tip前端加入§就可以输入对应的数字来换颜色!(什么MC特性)'
      ];
      const MC_COLORS = {
        '0':'#000000','1':'#0000AA','2':'#00AA00','3':'#00AAAA','4':'#AA0000','5':'#AA00AA',
        '6':'#FFAA00','7':'#AAAAAA','8':'#555555','9':'#5555FF','a':'#55FF55','b':'#55FFFF',
        'c':'#FF5555','d':'#FF55FF','e':'#FFFF55','f':'#FFFFFF'
      };
      const tipToHtml = (s) => {
        const esc = String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        let html = '', open = false;
        for (let i = 0; i < esc.length; i++) {
          const ch = esc[i];
          if (ch === '§' && i + 1 < esc.length) {
            const c = esc[i + 1].toLowerCase();
            if (c === 'r') { if (open) { html += '</span>'; open = false; } i++; }
            else if (MC_COLORS[c]) { if (open) html += '</span>'; html += '<span style="color:' + MC_COLORS[c] + '">'; open = true; i++; }
            else html += ch;
          } else html += ch;
        }
        if (open) html += '</span>';
        return html;
      };
      const parseTip = (content) => {
        const m = /^(.*?)_\{\}(.*?)\{\}$/.exec(content);
        return m ? { display: m[1], switchText: m[2], hasMark: true } : { display: content, hasMark: false };
      };
      const formatTip = (text) => {
        const t = String(text);
        return t.startsWith('Tip:') ? t : 'Tip: ' + t;
      };
      let tipIdx = -1;
      let tipSwitched = false;
      const showTip = (i) => {
        tipIdx = i;
        tipSwitched = false;
        const p = parseTip(TIPS[i]);
        tipEl.innerHTML = tipToHtml(formatTip(p.display + (p.hasMark ? '_' : '')));
      };
      const showRandom = () => {
        if (player.chartTip) {
          tipIdx = -1;
          tipSwitched = false;
          const cp = parseTip(player.chartTip);
          tipEl.innerHTML = tipToHtml(formatTip(cp.display + (cp.hasMark ? '_' : '')));
        } else showTip(Math.floor(Math.random() * TIPS.length));
      };
      showRandom();
      fetch('以后提供的文件都在这/tip/Tip.txt', { cache: 'no-store' }).then((r) => r.text()).then((txt) => {
        const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return;
        TIPS.length = 0;
        for (const l of lines) TIPS.push(l);
        showRandom();
      }).catch(() => {});
      const tipHandler = (ev) => {
        ev.stopPropagation();
        if (tipSwitched) return;
        const raw = tipIdx >= 0 ? TIPS[tipIdx] : (player.chartTip || '');
        const urlM = /(https?:\/\/[^\s"'<>]+|file:\/\/\/[^\s"'<>]+|[A-Za-z]:[\\/][^\s"'<>]+)/.exec(raw);
        if (urlM) {
          let url = urlM[0];
          if (/^[A-Za-z]:[\\/]/.test(url)) {
            url = 'file:///' + url.replace(/\\/g, '/').replace(/^\s*([A-Za-z]):/i, '$1:');
          }
          window.open(url, '_blank');
          return;
        }
        const p = parseTip(raw);
        if (p.switchText) { tipSwitched = true; tipEl.innerHTML = tipToHtml(formatTip(p.switchText)); }
      };
      tipEl.onclick = tipHandler;
    }
    // Cover art: the chart background (loaded in phase one) is shown on the loading page
    const bgSrc = (player.backgroundImage && player.backgroundImage.src) || (player.blurredBg && player.blurredBg.src);
    const illusEl = ls.querySelector('#ld-illus');
    if (bgSrc && illusEl) illusEl.src = bgSrc;
    // Wait for the loading page fade-in (0.5s), then load the core chart files
    await new Promise(r => setTimeout(r, 500));
    try {
      // Parse the chart files while the loading page is on screen (loadChart etc.)
      await player.finishLoadChart();
    } catch (e) {
      player.showStatus('谱面解析失败: ' + (e && e.message || e));
    }
    // While the loading page is on screen: silently warm the chart up (quickly preview a short segment around the first note),
    // warming the JIT, render caches, hit effects, the SFX layer and WebAudio so the first note does not stutter during real play
    try { await player.warmupChart(2400); } catch (e) { console.warn('[Warmup] 预热失败:', e); }
    // After the main files are loaded, wait 0.5s and slide the loading page out to the right (1s easeInExpo)
    await new Promise(r => setTimeout(r, 500));
    const vw = window.innerWidth;
    const duration = 1000;
    const startTime = performance.now();
    function easeInExpo(t) { return t === 0 ? 0 : Math.pow(2, 10 * t - 10); }
    function animateSlide(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeInExpo(t);
      ls.style.transform = 'translateX(' + (eased * vw) + 'px)';
      if (t < 1) requestAnimationFrame(animateSlide);
    }
    requestAnimationFrame(animateSlide);
    await new Promise(r => setTimeout(r, 1000));
    // Once the loading page has slid out: hide it, render the play UI and the chart, and fade the overlay out
    ls.classList.add('hidden');
    ls.classList.remove('loading-mode');
    ls.style.display = 'none';
    ls.style.zIndex = '';
    ls.style.transform = '';
    ls.style.opacity = '';
    ls.style.transition = '';
    player.startPreview();
    player.startUIEntrance(350);
    const uiKeyOf = { 'pause-btn': 'pause', 'combo-area': 'combo', 'score-display': 'score', 'title-display': 'name', 'difficulty-display': 'level' };
    for (const el of uiEls) {
      el.style.opacity = '';
      if (el.id !== 'ui-bar' && el.id !== 'combo-area') {
        const d = (player.uiEntrance.dir && player.uiEntrance.dir[uiKeyOf[el.id]]) || 1;
        el.style.transform = 'translateY(' + (d * window.innerHeight) + 'px)';
      }
    }
    overlay.style.transition = 'opacity 0.35s cubic-bezier(0.6, 0.04, 0.98, 0.335)';
    overlay.style.opacity = '0';
    // Start the chart only after the play UI entrance animation finishes (startUIEntrance: 350ms delay + 1000ms duration)
    await new Promise(r => setTimeout(r, 1350));
    player.holdTime = false;
    player.fallbackMode = false;
    cv.style.transition = '';
    overlay.style.visibility = 'hidden';
    overlay.style.transition = '';
    overlay.style.opacity = '';
    overlay.style.clipPath = '';
    player.play();
  }, 1500);
}


document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const fn = file.name.toLowerCase();
  if (fn.endsWith('.osu') || fn.endsWith('.osz')) {
    alert('本播放器不支持 .osu/.osz 谱面(osu 专用请使用 osu-player.html)');
    return;
  }
  if (fn.endsWith('.pez') || fn.endsWith('.zip')) {
    const ok = await player.loadZipFile(file);
    if (ok) {
      if (ok === 'chart') await showStagedChart();
      else document.getElementById('load-screen').classList.add('hidden');
    }
  } else if (fn.endsWith('.pec')) {
    if (file.size > 256 * 1024 * 1024) {
      (async () => {
        const d = await parsePECStreamed(file);
        if (d && d.judgeLineList.length) { player.loadChart(d); showStagedChart(); }
        else alert('解析失败: 未识别到有效谱面');
      })();
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        player.loadPEC(ev.target.result);
        showStagedChart();
      } catch (err) { alert('解析失败: ' + err.message); }
    };
    reader.readAsText(file);
  } else if (fn.endsWith('.pcmy')) {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = parsePCMY(ev.target.result, null);
        if (!d.judgeLineList.length) throw new Error('未识别到有效 PCMY 谱面');
        player.loadChart(d);
        showStagedChart();
      } catch (err) { alert('解析失败: ' + err.message); }
    };
    reader.readAsText(file);
  } else if (fn.endsWith('.json') || fn.endsWith('.rpe')) {
    if (file.size > 256 * 1024 * 1024) {
      (async () => {
        const d = await parsePECStreamed(file);
        if (d && d.judgeLineList.length) { player.loadChart(d); showStagedChart(); }
        else alert('解析失败: 未识别到有效谱面');
      })();
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target.result);
        player.loadRPE(json);
        showStagedChart();
      } catch (err) { alert('解析失败: ' + err.message); }
    };
    reader.readAsText(file);
  }
});

document.getElementById('rp-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const ok = await player.loadResourcePack(file);
  if (ok) console.log('[App] 资源包已加载并启用');
  e.target.value = '';
});

document.getElementById('dir-input').addEventListener('change', async (e) => {
  const ok = await player.loadChartFolder(e.target.files);
  if (ok) {
    await showStagedChart();
  }
  e.target.value = '';
});

async function collectDirEntries(entry, out) {
  if (entry.isFile) {
    const f = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push(f);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    while (true) {
      const ents = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!ents.length) break;
      for (const ent of ents) await collectDirEntries(ent, out);
    }
  }
}

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  const items = e.dataTransfer.items;
  let dirDropped = false;
  if (items && items.length) {
    const dirFiles = [];
    for (const it of items) {
      if (!it.webkitGetAsEntry) continue;
      const ent = it.webkitGetAsEntry();
      if (!ent) continue;
      dirDropped = true;
      await collectDirEntries(ent, dirFiles);
    }
    if (dirDropped && dirFiles.length) {
      const ok = await player.loadChartFolder(dirFiles);
      if (ok) {
        await showStagedChart();
      }
      return;
    }
  }
  const file = e.dataTransfer.files[0]; if (!file) return;
  const fn = file.name.toLowerCase();
  if (fn.endsWith('.osu') || fn.endsWith('.osz')) {
    alert('本播放器不支持 .osu/.osz 谱面(osu 专用请使用 osu-player.html)');
    return;
  }
  if (fn.endsWith('.pez') || fn.endsWith('.zip')) {
    const ok = await player.loadZipFile(file);
    if (ok) {
      if (ok === 'chart') await showStagedChart();
      else document.getElementById('load-screen').classList.add('hidden');
    }
  } else if (fn.endsWith('.pcmy')) {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = parsePCMY(ev.target.result, null);
        if (!d.judgeLineList.length) throw new Error('未识别到有效 PCMY 谱面');
        player.loadChart(d);
        showStagedChart();
      } catch (err) { alert('解析失败: ' + err.message); }
    };
    reader.readAsText(file);
  } else if (fn.endsWith('.json') || fn.endsWith('.rpe')) {
    if (file.size > 256 * 1024 * 1024) {
      (async () => {
        const d = await parsePECStreamed(file);
        if (d && d.judgeLineList.length) { player.loadChart(d); showStagedChart(); }
        else alert('解析失败: 未识别到有效谱面');
      })();
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target.result);
        player.loadRPE(json);
        showStagedChart();
      } catch (err) { alert('解析失败: ' + err.message); }
    };
    reader.readAsText(file);
  }
});


document.getElementById('pause-btn').addEventListener('click', () => player.togglePlay());

const pBack = document.getElementById('pause-back'), pRetry = document.getElementById('pause-retry'), pResume = document.getElementById('pause-resume');
if (pBack) pBack.addEventListener('click', () => player.backToMenu());
if (pRetry) pRetry.addEventListener('click', () => player.retryChart());
if (pResume) pResume.addEventListener('click', () => player.resumeWithCountdown());

// ---- 导入后的操作按钮: 撤销 / 游玩 / 录制 ----
const btnUndo = document.getElementById('btn-undo');
if (btnUndo) btnUndo.addEventListener('click', undoImport);
const btnPlayLoaded = document.getElementById('btn-play-loaded');
if (btnPlayLoaded) btnPlayLoaded.addEventListener('click', () => {
  afterLoad();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { if (player._countingDown || player._rec) return; player.hidePauseOverlay(); const ls = document.getElementById('load-screen'); ls.style.display = ''; ls.style.transform = ''; ls.classList.remove('hidden', 'loading-mode'); player.pause(); }
});

player.render(0, 0);
console.log('🎵 PEZ 播放器已就绪（特效位置修正）');

