// PhiAI-Player || General-purpose particle system
// ============================================================
//  General-purpose particle system
// ============================================================
class Particle {
  constructor(config, originPos) {
    const rand = (min, max) => Math.random() * (max - min) + min;
    this.lifetime = config.lifetime * (1 - Math.random() * config.lifetimeRandomness);
    this.lived = 0;
    this.baseSize = config.size * (1 - Math.random() * config.sizeRandomness);
    this.size = this.baseSize;
    this.sizeScale = 0;
    const dirAngle = Math.atan2(config.initialDirection.y, config.initialDirection.x) + rand(-config.initialDirectionSpread/2, config.initialDirectionSpread/2);
    const speed = config.initialVelocity * (1 - Math.random() * config.initialVelocityRandomness);
    this.startPosition = { x: originPos.x + (config.emissionShape === 'point' ? 0 : rand(-config.emissionShape.width/2, config.emissionShape.width/2)), y: originPos.y + (config.emissionShape === 'point' ? 0 : rand(-config.emissionShape.height/2, config.emissionShape.height/2)) };
    this.position = { x: this.startPosition.x, y: this.startPosition.y };
    this.velocity = { x: Math.cos(dirAngle) * speed, y: Math.sin(dirAngle) * speed };
    this.angularVelocity = config.initialAngularVelocity * (1 - Math.random() * config.initialAngularVelocityRandomness);
    this.rotation = config.initialRotation * (1 - Math.random() * config.initialRotationRandomness);
    this.alive = true;
    this.color = { r: config.baseColor.r, g: config.baseColor.g, b: config.baseColor.b, a: config.baseColor.a };
    this.frame = 0;
    this.config = config;
    this.startDelay = 0;
    this.dirX = Math.cos(dirAngle);
    this.dirY = Math.sin(dirAngle);
  }

  update(dt) {
    this.lived += dt;

    // Phigros hit particles: analytic movement + alpha fade, no per-frame integration jitter.
    // Displacement  t*(850.3997391752t^2 + 6236.3848902154t + 80.3542231806) / (6570.5817658876t^2 + 495.7977913926t + 1)
    // Alpha         1 - t
    // Size          s(t) = ((0.20783014t - 1.65243926)t + 1.6398785)t + 0.49884492
    if (this.config.phigros) {
      const base = this.config.baseColor;
      const localTime = this.lived - this.startDelay;
      if (localTime < 0) {
        this.color = { r: base.r, g: base.g, b: base.b, a: 0 };
      } else if (localTime >= this.lifetime) {
        this.alive = false;
        return;
      } else {
        const t = localTime / this.lifetime;
        const d = t * (850.3997391752 * t * t + 6236.3848902154 * t + 80.3542231806)
          / (6570.5817658876 * t * t + 495.7977913926 * t + 1);
        const travel = (this.config.initialVelocity || 0) * 0.5;
        this.position.x = this.startPosition.x + this.dirX * travel * d;
        this.position.y = this.startPosition.y + this.dirY * travel * d;
        const s = ((0.20783014 * t - 1.65243926) * t + 1.6398785) * t + 0.49884492;
        this.size = this.baseSize * s;
        this.color = { r: base.r, g: base.g, b: base.b, a: (1 - t) * base.a };
      }
      return;
    }

    const lifeRatio = Math.min(this.lived / this.lifetime, 1);

    const c = this.config.colorsCurve;
    let r, g, b, a;
    if (lifeRatio < 0.5) {
      const t = lifeRatio * 2;
      r = c.start.r + (c.mid.r - c.start.r) * t;
      g = c.start.g + (c.mid.g - c.start.g) * t;
      b = c.start.b + (c.mid.b - c.start.b) * t;
      a = c.start.a + (c.mid.a - c.start.a) * t;
    } else {
      const t = (lifeRatio - 0.5) * 2;
      r = c.mid.r + (c.end.r - c.mid.r) * t;
      g = c.mid.g + (c.end.g - c.mid.g) * t;
      b = c.mid.b + (c.end.b - c.mid.b) * t;
      a = c.mid.a + (c.end.a - c.mid.a) * t;
    }
    const alphaDuration = 0.6;
    const alphaT = Math.min(this.lived / alphaDuration, 1);
    const alphaEase = alphaT >= 1 ? 1 : (1 - Math.sqrt(1 - alphaT * alphaT));
    this.color = { r, g, b, a: a * this.config.baseColor.a * (1 - alphaEase) };

    let sizeScale;
    if (this.config.sizeCurve && this.config.sizeCurve.length > 0) {
      const points = this.config.sizeCurve;
      sizeScale = 1;
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        const next = points[i+1];
        if (lifeRatio >= p[0] && lifeRatio <= next[0]) {
          const t = (lifeRatio - p[0]) / (next[0] - p[0]);
          sizeScale = p[1] + (next[1] - p[1]) * t;
          break;
        }
      }
    } else {
      // Particles grow with an ease-out cubic curve, then shrink with an ease-in-out sine curve.
      // Keep the growth window short enough to finish before the particle's
      // existing early alpha fade makes it invisible.
      const growDuration = Math.min(0.2, this.lifetime * 0.5);
      const growT = Math.min(this.lived / growDuration, 1);
      sizeScale = 1 - Math.pow(1 - growT, 3);
    }
    const shrinkDuration = 0.3;
    const timeLeft = this.lifetime - this.lived;
    if (timeLeft < shrinkDuration && shrinkDuration > 0) {
      const shrinkT = 1 - timeLeft / shrinkDuration;
      const easeInOutSine = (1 - Math.cos(Math.PI * shrinkT)) / 2;
      sizeScale *= 1 - 0.98 * easeInOutSine;
    }
    const size = this.baseSize * sizeScale;
    this.size = size;

    const moveDuration = 0.5;
    if (this.config.moveMode === 'physics') {
      this.velocity.x += this.velocity.x * this.config.linearAccel * dt;
      this.velocity.y += this.velocity.y * this.config.linearAccel * dt;
      this.velocity.x += this.config.gravity.x * dt;
      this.velocity.y += this.config.gravity.y * dt;
      this.position.x += this.velocity.x * dt;
      this.position.y += this.velocity.y * dt;
    } else {
      const lerpFactor = 1 - Math.pow(2, -10 * dt);
      const targetX = this.startPosition.x + this.velocity.x * moveDuration;
      const targetY = this.startPosition.y + this.velocity.y * moveDuration;
      this.position.x += (targetX - this.position.x) * lerpFactor;
      this.position.y += (targetY - this.position.y) * lerpFactor;
    }
    this.angularVelocity += this.angularVelocity * this.config.angularAccel * dt;
    this.angularVelocity *= (1 - this.config.angularDamping);
    this.rotation += this.angularVelocity * dt;

    if (this.config.atlas) {
      const { cols, rows, startIndex, endIndex } = this.config.atlas;
      const totalFrames = endIndex - startIndex + 1;
      const frame = Math.floor(lifeRatio * totalFrames);
      this.frame = Math.min(startIndex + frame, endIndex);
    }

    if (this.lived >= this.lifetime) this.alive = false;
  }
}

class ParticleEmitter {
  constructor(config) {
    this.config = Object.assign({
      localCoords: false,
      emissionShape: 'point',
      emissionShapeWidth: 0,
      emissionShapeHeight: 0,
      oneShot: false,
      lifetime: 1.0,
      lifetimeRandomness: 0,
      amount: 8,
      explosiveness: 0,
      emitting: true,
      initialDirection: { x: 0, y: -1 },
      initialDirectionSpread: 0,
      initialVelocity: 50,
      initialVelocityRandomness: 0,
      linearAccel: 0,
      initialRotation: 0,
      initialRotationRandomness: 0,
      initialAngularVelocity: 0,
      initialAngularVelocityRandomness: 0,
      angularAccel: 0,
      angularDamping: 0,
      size: 10,
      sizeRandomness: 0,
      sizeCurve: [],
      blendMode: 'alpha',
      baseColor: { r: 1, g: 1, b: 1, a: 1 },
      colorsCurve: {
        start: { r: 1, g: 1, b: 1, a: 1 },
        mid: { r: 1, g: 1, b: 1, a: 1 },
        end: { r: 1, g: 1, b: 1, a: 1 }
      },
      gravity: { x: 0, y: 0 },
      texture: null,
      atlas: null,
    }, config);

    this.particles = [];
    this.timePassed = 0;
    this.lastEmitTime = 0;
    this.particlesSpawned = 0;
    this.position = { x: 0, y: 0 };
    this._shouldEmit = this.config.emitting;
  }

  emit(pos, n, stagger) {
    this.position = pos;
    for (let i = 0; i < n; i++) {
      if (this.particlesSpawned < this.config.amount) {
        const p = new Particle(this.config, pos);
        if (stagger) p.startDelay = i * stagger;
        this.particles.push(p);
        this.particlesSpawned++;
      }
    }
  }

  update(dt) {
    if (this.config.emitting) {
      this.timePassed += dt;
      const gap = (this.config.lifetime / this.config.amount) * (1 - this.config.explosiveness);
      let spawnCount = 0;
      if (gap < 0.001) {
        spawnCount = this.config.amount;
      } else {
        spawnCount = Math.floor((this.timePassed - this.lastEmitTime) / gap);
      }
      for (let i = 0; i < spawnCount; i++) {
        this.lastEmitTime = this.timePassed;
        if (this.particlesSpawned < this.config.amount) {
          const p = new Particle(this.config, this.position);
          this.particles.push(p);
          this.particlesSpawned++;
        }
      }
      if (this.config.oneShot && this.timePassed > this.config.lifetime) {
        this.timePassed = 0;
        this.lastEmitTime = 0;
        this.config.emitting = false;
      }
    }

    for (const p of this.particles) {
      p.update(dt);
    }
    // Compact in place: filter() allocated a fresh array every frame for every emitter
    {
      const __ps = this.particles;
      let __n = 0;
      for (let __i = 0; __i < __ps.length; __i++) { const __p = __ps[__i]; if (__p.alive) __ps[__n++] = __p; }
      __ps.length = __n;
    }
  }

  draw(ctx, pos) {
    this.position = pos;
    const blendMode = this.config.blendMode;
    const originalComposite = ctx.globalCompositeOperation;
    if (blendMode === 'additive') {
      ctx.globalCompositeOperation = 'lighter';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    for (const p of this.particles) {
      const size = p.size;
      const w = size;
      const h = size;
      const x = p.position.x;
      const y = p.position.y;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.color.a;

      if (this.config.texture && this.config.texture.complete) {
        let sx = 0, sy = 0, sw = this.config.texture.width, sh = this.config.texture.height;
        if (this.config.atlas) {
          const { cols, rows, startIndex, endIndex } = this.config.atlas;
          const totalFrames = endIndex - startIndex + 1;
          const frame = Math.min(p.frame, endIndex);
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          const fw = this.config.texture.width / cols;
          const fh = this.config.texture.height / rows;
          sx = col * fw;
          sy = row * fh;
          sw = fw;
          sh = fh;
        }
        ctx.drawImage(this.config.texture, sx, sy, sw, sh, -w/2, -h/2, w, h);
      } else {
        ctx.fillStyle = `rgba(${p.color.r*255|0},${p.color.g*255|0},${p.color.b*255|0},${p.color.a})`;
        ctx.fillRect(-w/2, -h/2, w, h);
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = originalComposite;
  }
}

