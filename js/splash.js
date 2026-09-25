// PhiAI-Player | js/splash.js
// Splash overlay + boot audio. `AIRE_SFX` is defined in js/config.js and inlined at build time.
// The splash logo (cropped logo.svg) is pure vector `<path>` strokes that carry their home
// position in a `translate(x,y)` attribute -- exactly like the original AIRE splash. So the
// original animation is fully preserved: every stroke is gathered to the centre point, then
// while the logo blinks each stroke flies back to its own spot with an ease-out-expo.
(function () {
  var ov = document.getElementById('splash-overlay');
  if (!ov) return;
  var svg = document.getElementById('splash-svg');
  var paths = Array.prototype.slice.call(svg.querySelectorAll('path')).filter(function (p) { return p.getAttribute('d'); });
  var CX = 3391 / 2, CY = 628 / 2;
  var orig = paths.map(function (p) {
    var m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(p.getAttribute('transform') || '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
  });
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var easeOutExpo = function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  var easeInCirc = function (t) { return 1 - Math.sqrt(1 - t * t); };
  function animOpacity(el, from, to, dur, ease) {
    el.style.opacity = String(from);
    var t0 = performance.now();
    return new Promise(function (res) {
      (function step() {
        var t = Math.min((performance.now() - t0) / dur, 1);
        el.style.opacity = String(from + (to - from) * ease(t));
        if (t < 1) setTimeout(step, 16); else res();
      })();
    });
  }
  function animToHome(ps, ds, dur) {
    var t0 = performance.now();
    return new Promise(function (res) {
      (function step() {
        var t = Math.min((performance.now() - t0) / dur, 1);
        var k = easeOutExpo(t);
        for (var i = 0; i < ps.length; i++) {
          ps[i].setAttribute('transform', 'translate(' + (CX + (ds[i].x - CX) * k) + ',' + (CY + (ds[i].y - CY) * k) + ')');
        }
        if (t < 1) setTimeout(step, 16); else res();
      })();
    });
  }
  paths.forEach(function (p) { p.setAttribute('transform', 'translate(' + CX + ',' + CY + ')'); });
  svg.style.opacity = '0';
  var retryEvt = null;
  var seq = (async function () {
    await sleep(500);
    try {
      var au = new Audio(AIRE_SFX.splash);
      var started = false;
      var tryPlay = function () {
        if (started) return;
        var pr = au.play();
        if (pr && pr.then) {
          pr.then(function () { started = true; }).catch(function () {});
        }
      };
      retryEvt = function () { tryPlay(); };
      ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
        document.addEventListener(ev, retryEvt, { passive: true });
      });
      tryPlay();
    } catch (e) {}
    var flash = (async function () {
      var seg = 200 / 4;
      for (var i = 0; i < 4; i++) {
        svg.style.opacity = String(i % 2 === 0 ? 0 : 1);
        await sleep(seg);
      }
    })();
    var move = animToHome(paths, orig, 1000);
    await Promise.all([flash, move]);
    await animOpacity(svg, 1, 0, 1000, easeInCirc);
    ov.classList.add('splash-done');
    await sleep(800);
    ov.style.display = 'none';
    document.body.classList.add('splash-finished');
    if (retryEvt) {
      ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
        document.removeEventListener(ev, retryEvt);
      });
      retryEvt = null;
    }
  })();
  seq.catch(function () { ov.style.display = 'none'; });
})();