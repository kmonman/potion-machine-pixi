// Charge Orb — the electric-nebula collectible (Rob). Prototyped first as a
// standalone canvas demo (recursive-midpoint-displacement lightning arcs
// that wrap around the sphere, brightness traveling along them as a wave,
// a soft particle corona) before being wired in here as a placeholder to
// feel out the actual mechanic: touch one on a platform, it starts a short
// respawn cooldown, and every ENERGY_SHARDS_PER_CHARGE collected banks a
// bonus Potion Blast charge — a second way to climb besides waiting out
// the score-based charge timer or catching a jet.
//
// One shared offscreen canvas drives ONE PIXI.Texture that every orb
// sprite in the tower reuses — the animation itself only gets drawn once
// per frame no matter how many orbs are on screen, at the cost of every
// visible orb crackling in exact lockstep. Fine for a placeholder; giving
// each orb its own independent animation (its own canvas, or a shader)
// is real future work if this is worth keeping.
const ChargeOrbFX = {
  size: 128,
  canvas: null,
  ctx: null,
  texture: null,
  t: 0,
  arcs: [],
  particles: [],

  build() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d');
    this.cx = this.size / 2;
    this.cy = this.size / 2;
    this.r = this.size * 0.42;

    for (let i = 0; i < 3; i++) this.arcs.push(this._makeArc());
    for (let i = 0; i < 26; i++){
      const edgeWeighted = Math.pow(Math.random(), 0.4);
      this.particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: this.r * (0.55 + edgeWeighted * 0.75),
        speed: (Math.random() - 0.5) * 0.4,
        size: 0.8 + Math.random() * 2.2,
        phase: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.14,
      });
    }

    this.texture = PIXI.Texture.from(this.canvas);
  },

  _smooth(arr, passes){
    let a = arr.slice();
    for (let p = 0; p < passes; p++){
      const next = a.slice();
      for (let i = 1; i < a.length - 1; i++) next[i] = (a[i - 1] + a[i] * 2 + a[i + 1]) / 4;
      a = next;
    }
    return a;
  },

  _makeArc(){
    const steps = 18;
    const seed = [];
    for (let i = 0; i <= steps; i++) seed.push((Math.random() - 0.5) * 2);
    return {
      r: this.r * (0.32 + Math.random() * 0.58),
      a0: Math.random() * Math.PI * 2,
      span: Math.PI * (0.85 + Math.random() * 1.3),
      steps,
      seed: this._smooth(seed, 2),
      life: Math.random() * 2,
      maxLife: 1.6 + Math.random() * 1.4,
      flowSpeed: 1.1 + Math.random() * 1.6,
      flowDir: Math.random() < 0.5 ? 1 : -1,
      flowK: 2 + Math.floor(Math.random() * 3),
    };
  },

  _strokeArc(arc){
    const ctx = this.ctx, cx = this.cx, cy = this.cy, t0 = this.t;
    const pts = [];
    for (let i = 0; i <= arc.steps; i++){
      const u = i / arc.steps;
      const ang = arc.a0 + u * arc.span;
      const rad = arc.r + arc.seed[i] * this.r * 0.09 + Math.sin(t0 * 1.6 + i * 0.6 + arc.a0) * this.r * 0.018;
      pts.push({ x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
    }
    const fade = Math.min(1, arc.life / 0.5) * Math.min(1, Math.max(0, (arc.maxLife - arc.life) / 0.6));
    if (fade <= 0.01) return;
    for (let i = 0; i < pts.length - 1; i++){
      const u = i / (pts.length - 1);
      const flow = 0.18 + 0.82 * Math.pow(0.5 + 0.5 * Math.sin(u * Math.PI * 2 * arc.flowK - t0 * arc.flowSpeed * arc.flowDir), 3);
      const a = fade * flow;
      if (a < 0.04) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.strokeStyle = '#5fd4ff';
      ctx.lineWidth = this.size * 0.024;
      ctx.shadowColor = '#5fd4ff';
      ctx.shadowBlur = this.size * 0.05;
      ctx.stroke();
      ctx.strokeStyle = '#f4feff';
      ctx.lineWidth = this.size * 0.008;
      ctx.shadowBlur = this.size * 0.02;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  update(dt){
    this.t += dt;
    const ctx = this.ctx, cx = this.cx, cy = this.cy, r = this.r;
    ctx.clearRect(0, 0, this.size, this.size);

    const core = ctx.createRadialGradient(cx - r * 0.18, cy - r * 0.22, r * 0.05, cx, cy, r);
    core.addColorStop(0, '#3a6488');
    core.addColorStop(0.42, '#123453');
    core.addColorStop(0.8, '#061424');
    core.addColorStop(1, '#01050a');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles){
      p.angle += p.speed * dt;
      p.phase += dt * 2.2;
      const rr = p.radius + Math.sin(p.phase * 0.6) * r * 0.05;
      const x = cx + Math.cos(p.angle) * rr;
      const y = cy + Math.sin(p.angle) * rr;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase));
      const hue = p.warm ? '255,150,80' : '130,225,255';
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.size * 5);
      g.addColorStop(0, `rgba(${hue},${0.9 * tw})`);
      g.addColorStop(1, `rgba(${hue},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, p.size * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const a of this.arcs) a.life += dt;
    this.arcs = this.arcs.filter((a) => a.life < a.maxLife);
    while (this.arcs.length < 3) this.arcs.push(this._makeArc());
    for (const a of this.arcs) this._strokeArc(a);
    ctx.restore();

    this.texture.source.update();
  },
};
