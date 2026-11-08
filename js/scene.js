/* scene.js — draws the office and home, objects, effects, and drives the rig
 * from the world state. Logical canvas: 960 × 540. */
(function (G) {
  'use strict';
  const { OFFICE, HOME, FLOOR, depthScale, SOCIAL_ACTIONS, MOTOR_ACTIONS } = G.FB;
  const TAU = Math.PI * 2;
  const OUT = '#4e2c2e';

  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU); }
  function fs(c, fill, lw) { if (fill) { c.fillStyle = fill; c.fill(); } c.lineWidth = lw || 2.2; c.strokeStyle = OUT; c.stroke(); }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function heart(c, x, y, s) {
    c.beginPath(); c.moveTo(x, y + s * 0.6);
    c.bezierCurveTo(x - s * 1.1, y - s * 0.1, x - s * 0.55, y - s * 0.95, x, y - s * 0.35);
    c.bezierCurveTo(x + s * 0.55, y - s * 0.95, x + s * 1.1, y - s * 0.1, x, y + s * 0.6); c.closePath();
  }
  function star(c, x, y, r, ri, n, rot) {
    n = n || 5; rot = rot || -Math.PI / 2; c.beginPath();
    for (let i = 0; i < n * 2; i++) { const rad = i % 2 ? ri : r, a = rot + (i * Math.PI) / n; c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    c.closePath();
  }
  function text(c, t, x, y, size, fill, opt) {
    opt = opt || {};
    c.font = `${opt.weight || 800} ${size}px "Baloo 2", system-ui, sans-serif`;
    c.textAlign = opt.align || 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    if (opt.outline !== false) { c.lineWidth = size * 0.36; c.strokeStyle = '#fff'; c.strokeText(t, x, y); c.lineWidth = size * 0.12; c.strokeStyle = OUT; c.strokeText(t, x, y); }
    c.fillStyle = fill; c.fillText(t, x, y);
  }

  // Clickable office objects (screen rects) → world keys.
  const HIT = {
    copier: { x: 64, y: 210, w: 160, h: 150 },
    shredder: { x: 318, y: 225, w: 90, h: 100 },
    coffee: { x: 780, y: 180, w: 110, h: 90 },
    inbox: { x: 345, y: 448, w: 92, h: 50 },
    out: { x: 485, y: 448, w: 92, h: 50 },
    sign: { x: 620, y: 448, w: 92, h: 50 },
  };

  class Scene {
    constructor(canvas, world) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.world = world;
      this.W = 960; this.H = 540;
      this.rig = new G.Rig.Character();
      this.particles = [];
      this.hover = null;
      this.flash = {};          // per-object activity glow
      this.temp = null;         // temporary pose (eat / pet / stretch)
      this.pat = 0;             // head-pat hand animation timer
      this.fade = 0;            // scene transition fade
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.scale = Math.max(0.1, (r.width * dpr) / this.W);
      this.canvas.width = Math.round(this.W * this.scale); this.canvas.height = Math.round(this.H * this.scale);
    }
    toLogical(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * this.W, y: ((e.clientY - r.top) / r.height) * this.H };
    }
    objectAt(x, y) {
      if (this.world.scene !== 'office') return null;
      for (const [k, h] of Object.entries(HIT)) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return k;
      return null;
    }
    add(p) { this.particles.push(Object.assign({ vx: 0, vy: 0, g: 0, life: 1, max: 1, rot: 0, vr: 0, size: 1 }, p)); }

    // ---------------- world events → effects ----------------
    handleEvents() {
      const w = this.world, h = w.headPos();
      for (const ev of w.events) {
        switch (ev.type) {
          case 'success':
            this.add({ kind: 'text', x: ev.x, y: ev.y - 120, text: ev.text, color: '#4fbf7a', fs: 20, vy: -30, life: 1.6, max: 1.6 });
            for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2; this.add({ kind: i % 2 ? 'coin' : 'sparkle', x: ev.x, y: ev.y - 80, vx: Math.cos(a) * 160, vy: Math.sin(a) * 180, g: 400, life: 1, max: 1 }); }
            break;
          case 'fail':
            this.add({ kind: 'text', x: ev.x, y: ev.y - 120, text: ev.text, color: '#e8566a', fs: 18, vy: -25, life: 2, max: 2 });
            break;
          case 'oops':
            this.add({ kind: 'text', x: ev.x, y: ev.y - 110, text: ev.text, color: '#8a8fb0', fs: 16, vy: -20, life: 1.5, max: 1.5 });
            break;
          case 'progress':
            this.add({ kind: 'text', x: ev.x, y: ev.y - 110, text: ev.text, color: '#5aa7e0', fs: 17, vy: -25, life: 1.2, max: 1.2 });
            break;
          case 'take':
            this.add({ kind: 'text', x: ev.x, y: ev.y - 100, text: ev.kind === 'important' ? 'important doc!' : 'just a memo', color: ev.kind === 'important' ? '#e8566a' : '#d9a520', fs: 15, vy: -25, life: 1, max: 1 });
            break;
          case 'use': this.flash[ev.id] = 1; break;
          case 'learn': {
            const txt = ev.teach ? (ev.lobe === 'social' ? 'learned!' : 'got it!') : ev.r > 0 ? '+♥ reward' : 'scolded';
            this.add({ kind: 'text', x: h.x + 60, y: h.y - 60, text: txt, color: ev.r > 0 ? '#ff9a3c' : '#8aa3d6', fs: 18, vy: -35, life: 1.1, max: 1.1 });
            if (!ev.teach && ev.r > 0) for (let i = 0; i < 4; i++) this.add({ kind: 'heart', x: h.x + (Math.random() - 0.5) * 60, y: h.y - 30, vy: -70, vx: (Math.random() - 0.5) * 40, life: 1.1, max: 1.1, size: 0.8 });
            if (!ev.teach && ev.r < 0) this.add({ kind: 'cloud', x: h.x + 46, y: h.y - 64, vy: -8, life: 1.3, max: 1.3 });
            break;
          }
          case 'pet': this.pat = 1.1; this.rig.poke(0.25); break;
          case 'feed': this.temp = { pose: 'eat', expr: 'yum', t: 1.8, itemKind: ev.icon }; break;
          case 'react':
            if (ev.id === 'love') for (let i = 0; i < 6; i++) this.add({ kind: 'heart', x: h.x + (Math.random() - 0.5) * 90, y: h.y - 20, vy: -60 - Math.random() * 40, vx: (Math.random() - 0.5) * 30, life: 1.4, max: 1.4, size: 0.7 + Math.random() * 0.4 });
            if (ev.id === 'giggle') for (let i = 0; i < 3; i++) this.add({ kind: 'note', x: h.x + (i - 1) * 50, y: h.y - 40, vy: -50, life: 1.1, max: 1.1 });
            break;
          case 'buy': this.add({ kind: 'text', x: 480, y: 120, text: `${ev.item.icon} ${ev.item.name} bought!`, color: '#ff8fb5', fs: 22, vy: -15, life: 1.6, max: 1.6 }); break;
          case 'noAP': this.add({ kind: 'text', x: h.x, y: h.y - 90, text: 'no action points left — time for bed', color: '#8aa3d6', fs: 16, vy: -15, life: 1.6, max: 1.6 }); break;
          case 'scene': case 'phase':
            this.fade = 1;
            if (ev.type === 'phase' && ev.phase === 'morning') this.temp = { pose: 'stretch', expr: 'wink', t: 2.4 };
            break;
        }
      }
      w.events.length = 0;
    }

    // ---------------- world → rig state ----------------
    rigState() {
      const w = this.world, b = w.buddy, c = w.cursor;
      let pose = 'idle', expr = 'normal', item = null, itemKind = null;
      if (b.held) { pose = 'holdDoc'; itemKind = b.held.kind; }
      if (b.busy) {
        const id = b.busy.id;
        pose = id === 'copy' ? 'copy' : id === 'sign' ? 'sign' : id === 'shred' ? 'shred' : id === 'coffee' ? 'coffee' : 'reach';
        expr = id === 'coffee' ? 'smile' : 'focus';
        if (b.held) itemKind = b.held.kind;
      } else if (b.held) expr = 'focus';
      if (w.scene === 'home' && w.phase === 'work') { pose = 'case'; }
      if (b.energy < 0.3 && !b.busy) expr = 'tired';
      if (w.scene === 'home' && w.phase === 'rest' && w.affection >= 70 && expr === 'normal') expr = 'smile';
      if (b.expr) expr = { happy: 'happy', sad: 'sad', shock: 'shock' }[b.expr] || expr;
      if (b.react) {
        const m = { giggle: ['happy', 'chest'], shy: ['shy', 'cheeks'], pout: ['pout', 'idle'], cry: ['cry', 'cheeks'], love: ['love', 'chest'], shock: ['shock', 'idle'] }[b.react];
        expr = m[0]; pose = m[1];
      }
      if (this.temp) { pose = this.temp.pose; expr = this.temp.expr; if (this.temp.itemKind) itemKind = this.temp.itemKind; }
      if (this.pat > 0 && !b.react) { expr = 'smile'; }
      if (w.phase === 'night') expr = 'sleep';
      let look = null;
      if (c.in && !b.moving) {
        const hp = w.headPos();
        look = { x: ((c.x - b.x) / 220) * b.face, y: (c.y - hp.y) / 220 };
      }
      return { face: b.face, moving: b.moving, walk: b.walk, vx: b.vx, vy: b.vy, expr, pose, item, itemKind, look, energy: b.energy, busyId: b.busy && b.busy.id, busyT: b.busy && b.busy.t };
    }

    update(dt) {
      if (this.temp) { this.temp.t -= dt; if (this.temp.t <= 0) this.temp = null; }
      if (this.pat > 0) this.pat -= dt;
      this.fade = Math.max(0, this.fade - dt * 1.6);
      for (const k of Object.keys(this.flash)) this.flash[k] = Math.max(0, this.flash[k] - dt * 0.8);
      this.rig.update(dt, this.rigState());
      // continuous effects
      const w = this.world, b = w.buddy;
      if (b.busy && b.busy.id === 'shred' && Math.random() < dt * 14) {
        const o = OFFICE.shredder; this.add({ kind: 'shred', x: o.x - 6 + Math.random() * 14, y: 300, vy: 40 + Math.random() * 30, vx: (Math.random() - 0.5) * 20, g: 60, life: 0.8, max: 0.8, rot: Math.random() * 3 });
      }
      if (b.busy && b.busy.id === 'coffee' && Math.random() < dt * 4) this.add({ kind: 'steam', x: 832 + Math.random() * 8, y: 196, vy: -30, life: 1, max: 1 });
      if (b.idleT > 6 && w.scene === 'home' && Math.random() < dt * 0.8) { const h = w.headPos(); this.add({ kind: 'z', x: h.x + 40, y: h.y - 40, vy: -20, vx: 8, life: 1.6, max: 1.6 }); }
      for (const p of this.particles) { p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
      this.particles = this.particles.filter((p) => p.life > 0);
    }

    // ---------------- drawing ----------------
    draw() {
      const c = this.ctx, w = this.world;
      this.handleEvents();
      c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (w.scene === 'office') this.drawOffice(c); else this.drawHome(c);
      for (const p of this.particles) this.drawParticle(c, p);
      this.drawSpeech(c);
      // time-of-day tint
      const tint = w.phase === 'morning' ? 'rgba(255,200,140,0.10)' : w.phase === 'rest' ? 'rgba(120,80,160,0.16)' : w.phase === 'night' ? 'rgba(20,20,60,0.62)' : null;
      if (tint) { c.fillStyle = tint; c.fillRect(0, 0, this.W, this.H); }
      if (w.phase === 'night') {
        text(c, `Good night… Day ${w.day} is over`, 480, 250, 28, '#fff3c4');
        text(c, 'z z z', 480, 300, 22, '#c9b9ff');
      }
      if (this.fade > 0) { c.fillStyle = `rgba(255,248,235,${this.fade})`; c.fillRect(0, 0, this.W, this.H); }
    }

    drawBuddy(c) {
      const w = this.world, b = w.buddy, sc = depthScale(b.y) * 0.72;
      ell(c, b.x, b.y + 2, 42 * sc / 0.72, 9 * sc / 0.72); c.fillStyle = 'rgba(80,60,40,.18)'; c.fill();
      this.rig.draw(c, b.x, b.y, sc, b.face);
      if (this.pat > 0) {
        const h = w.headPos(), k = this.pat;
        c.save(); c.translate(h.x + Math.sin(k * 18) * 10, h.y - 55 * h.sc - (1 - k) * 4);
        ell(c, 0, 0, 20, 15); fs(c, '#fff1ea', 2); ell(c, -17, 5, 6, 8, 0.5); fs(c, '#fff1ea', 2);
        for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-7 + i * 7, -13); c.lineTo(-7 + i * 7, -6); c.lineWidth = 1.6; c.stroke(); }
        c.restore();
      }
    }

    // ---------- office ----------
    drawOffice(c) {
      const w = this.world, t = w.time;
      // wall + floor
      const wall = c.createLinearGradient(0, 0, 0, 260); wall.addColorStop(0, '#e9f2ec'); wall.addColorStop(1, '#dbe9e1');
      c.fillStyle = wall; c.fillRect(0, 0, 960, 262);
      c.fillStyle = '#c9dccf'; c.fillRect(0, 248, 960, 14);
      const fl = c.createLinearGradient(0, 262, 0, 540); fl.addColorStop(0, '#efe3cf'); fl.addColorStop(1, '#e2d2b8');
      c.fillStyle = fl; c.fillRect(0, 262, 960, 278);
      c.strokeStyle = 'rgba(160,130,90,.18)'; c.lineWidth = 1.5;
      for (let x = -200; x < 1100; x += 80) { c.beginPath(); c.moveTo(480 + (x - 480) * 0.45, 262); c.lineTo(x, 540); c.stroke(); }
      // window with city skyline
      rr(c, 420, 40, 230, 130, 10); fs(c, '#bfe3f7', 3);
      c.fillStyle = '#a9c9de'; for (const [x, h] of [[440, 60], [470, 90], [505, 50], [540, 100], [580, 70], [615, 85]]) c.fillRect(x, 170 - h, 26, h);
      c.fillStyle = 'rgba(255,255,255,.7)'; for (const [x, y] of [[450, 125], [480, 100], [550, 90], [590, 120]]) c.fillRect(x, y, 5, 6);
      c.strokeStyle = OUT; c.lineWidth = 3; c.beginPath(); c.moveTo(535, 40); c.lineTo(535, 170); c.moveTo(420, 105); c.lineTo(650, 105); c.stroke();
      rr(c, 420, 40, 230, 130, 10); c.lineWidth = 3; c.stroke();
      // wall clock + work progress hand
      const f = w.phase === 'work' ? Math.min(1, w.phaseT / G.FB.PHASE_LEN.work) : 0;
      ell(c, 720, 80, 28, 28); fs(c, '#fffaf2', 3);
      c.strokeStyle = OUT; c.lineWidth = 3; const a = -Math.PI / 2 + f * TAU * 0.67 + Math.PI * 0.0;
      c.beginPath(); c.moveTo(720, 80); c.lineTo(720 + Math.cos(a) * 18, 80 + Math.sin(a) * 18); c.stroke();
      c.beginPath(); c.moveTo(720, 80); c.lineTo(720, 66); c.stroke();
      // corkboard
      rr(c, 220, 60, 150, 100, 8); fs(c, '#e7c595', 3);
      for (const [x, y, col] of [[240, 75, '#fff'], [290, 85, '#ffe48a'], [330, 72, '#ffd1dc'], [255, 115, '#d6f0ff'], [315, 118, '#fff']]) { rr(c, x, y, 30, 28, 2); fs(c, col, 1.5); ell(c, x + 15, y + 2, 3, 3); c.fillStyle = '#e8566a'; c.fill(); }

      // y-sorted: machines, buddy, desk
      const items = [
        { y: 345, d: () => this.drawCopier(c) },
        { y: 315, d: () => this.drawShredder(c) },
        { y: 330, d: () => this.drawCoffee(c) },
        { y: 480, d: () => this.drawDesk(c) },
        { y: 300, d: () => this.drawPlant(c, 285, 300, 0.75) },
        { y: w.buddy.y, d: () => this.drawBuddy(c) },
      ];
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.d();
      // hover + hints
      for (const [k, hb] of Object.entries(HIT)) {
        const hinted = w.hints.find((h) => h.key === k);
        if (this.hover === k || hinted) {
          c.save(); rr(c, hb.x - 4, hb.y - 4, hb.w + 8, hb.h + 8, 12);
          c.setLineDash([6, 5]); c.lineDashOffset = -t * 30; c.lineWidth = 3; c.strokeStyle = hinted ? '#ff8fb5' : '#7cc8ff'; c.stroke(); c.restore();
          text(c, OFFICE[k].label + (hinted ? '  ← go here!' : '  (click to point)'), hb.x + hb.w / 2, hb.y - 16, 14, hinted ? '#ff6f91' : '#3d8fd1');
        }
        if (hinted) {
          const bob = Math.sin(t * 10) * 4;
          ell(c, hb.x + hb.w / 2, hb.y - 40 + bob, 14, 14); fs(c, '#ff8fb5', 2.5);
          text(c, '!', hb.x + hb.w / 2, hb.y - 40 + bob, 18, '#fff', { outline: false });
        }
      }
    }
    drawCopier(c) {
      const fl = this.flash.copy || 0;
      rr(c, 70, 250, 150, 100, 10); fs(c, '#eef0f4', 3);
      rr(c, 66, 228, 158, 28, 8); fs(c, '#dfe3ea', 3);
      rr(c, 84, 262, 120, 20, 4); fs(c, '#c9ced8', 2);
      rr(c, 160, 290, 46, 26, 4); fs(c, '#3e4250', 2);
      c.fillStyle = fl > 0 ? `rgba(140,255,170,${0.6 + Math.sin(this.world.time * 30) * 0.4})` : '#76e0a0'; c.fillRect(166, 296, 10, 6);
      c.fillStyle = '#ffd36b'; c.fillRect(182, 296, 8, 6); c.fillStyle = '#ff7d8d'; c.fillRect(194, 296, 8, 6);
      rr(c, 80, 318, 70, 20, 3); fs(c, '#fff', 2);
      c.beginPath(); c.moveTo(70, 228); c.quadraticCurveTo(110, 170, 175, 196); c.lineWidth = 3; c.strokeStyle = OUT; c.stroke();
      if (fl > 0) { c.fillStyle = `rgba(190,255,210,${fl * 0.6})`; c.fillRect(70, 250, 150, 8); }
      text(c, 'COPY', 108, 304, 12, '#8a90a0', { outline: false });
    }
    drawShredder(c) {
      const fl = this.flash.shred || 0, shake = fl > 0 ? Math.sin(this.world.time * 50) * 1.5 : 0;
      c.save(); c.translate(shake, 0);
      rr(c, 328, 250, 70, 70, 6); fs(c, '#9aa3b5', 3);
      rr(c, 322, 232, 82, 24, 6); fs(c, '#5c6478', 3);
      rr(c, 336, 240, 54, 6, 3); c.fillStyle = '#222'; c.fill();
      c.fillStyle = 'rgba(255,255,255,.65)'; for (let i = 0; i < 6; i++) c.fillRect(338 + i * 9, 270 + (i % 2) * 6, 4, 30);
      c.restore();
    }
    drawCoffee(c) {
      // counter
      rr(c, 740, 255, 200, 80, 6); fs(c, '#d9b48a', 3);
      c.fillStyle = '#c9a378'; c.fillRect(744, 300, 192, 4);
      rr(c, 732, 246, 216, 14, 5); fs(c, '#efe0c8', 3);
      // machine
      rr(c, 800, 172, 70, 76, 8); fs(c, '#4a4550', 3);
      rr(c, 808, 182, 54, 16, 4); fs(c, '#6b6475', 2);
      ell(c, 852, 190, 4, 4); c.fillStyle = (this.flash.coffee || 0) > 0 ? '#ff7d8d' : '#76e0a0'; c.fill();
      rr(c, 820, 214, 30, 30, 4); c.fillStyle = '#2c2930'; c.fill();
      rr(c, 826, 224, 18, 18, 3); fs(c, '#fff', 1.8);
      // mugs
      for (const x of [760, 900]) { rr(c, x, 226, 18, 20, 4); fs(c, x < 800 ? '#ffd1dc' : '#d6f0ff', 2); }
    }
    drawDesk(c) {
      const w = this.world;
      // desk top + front
      rr(c, 300, 452, 440, 30, 8); fs(c, '#c79a6c', 3);
      rr(c, 312, 480, 416, 60, 4); fs(c, '#b5875a', 3);
      c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(316, 484, 408, 8);
      // inbox tray with its stack
      const inbox = w.inbox();
      rr(c, 350, 440, 82, 26, 5); fs(c, '#e7ecf3', 2.4);
      inbox.slice(0, 5).forEach((d, i) => {
        rr(c, 356 + i * 2, 434 - i * 5, 66, 14, 2); fs(c, '#fff', 1.6);
        c.fillStyle = d.kind === 'important' ? '#e8566a' : '#ffd36b'; c.fillRect(358 + i * 2 + 50, 434 - i * 5 + 2, 10, 9);
      });
      text(c, `INBOX ${inbox.length}`, 391, 474, 11, '#6b7280', { outline: false });
      // out-tray
      rr(c, 490, 440, 82, 26, 5); fs(c, '#e2f3e6', 2.4);
      const doneN = Math.min(6, w.today.done);
      for (let i = 0; i < doneN; i++) { rr(c, 498, 436 - i * 3, 66, 12, 2); fs(c, '#fff', 1.4); }
      text(c, 'OUT', 531, 474, 11, '#5a9a6a', { outline: false });
      // sign zone: mat + pen
      rr(c, 624, 440, 84, 26, 5); fs(c, '#f4e1ff', 2.4);
      c.save(); c.translate(690, 446); c.rotate(-0.7); rr(c, -3, -16, 6, 30, 3); fs(c, '#3e4250', 1.8); c.restore();
      c.strokeStyle = '#9d7bd8'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(634, 456); c.bezierCurveTo(644, 446, 650, 462, 662, 452); c.stroke();
      text(c, 'SIGN', 650, 474, 11, '#8d6bc8', { outline: false });
      // nameplate
      rr(c, 300, 500, 70, 18, 3); fs(c, '#efe0c8', 2); text(c, 'Ms. Fruity', 335, 509, 10, OUT, { outline: false, weight: 700 });
    }
    drawPlant(c, x, y, s) {
      c.save(); c.translate(x, y); c.scale(s, s);
      for (const [a, l] of [[-0.5, 50], [-0.15, 64], [0.25, 56], [0.6, 44]]) { c.save(); c.rotate(a); ell(c, 0, -l / 2 - 20, 10, l / 2); fs(c, '#8fd18a', 2); c.restore(); }
      rr(c, -20, -24, 40, 28, 4); fs(c, '#e8a07a', 2.4);
      c.restore();
    }

    // ---------- home ----------
    drawHome(c) {
      const w = this.world, f = w.furniture, ph = w.phase;
      const wall = c.createLinearGradient(0, 0, 0, 262); wall.addColorStop(0, '#fbe7e4'); wall.addColorStop(1, '#f6d9d6');
      c.fillStyle = wall; c.fillRect(0, 0, 960, 262);
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 6; for (let x = 20; x < 960; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 250); c.stroke(); }
      c.fillStyle = '#e9c1bc'; c.fillRect(0, 248, 960, 14);
      const fl = c.createLinearGradient(0, 262, 0, 540); fl.addColorStop(0, '#e2bf98'); fl.addColorStop(1, '#d3a87c');
      c.fillStyle = fl; c.fillRect(0, 262, 960, 278);
      c.strokeStyle = 'rgba(120,80,40,.15)'; c.lineWidth = 2; for (let y = 290; y < 540; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(960, y); c.stroke(); }
      // window: sky follows the time of day
      const sky = c.createLinearGradient(0, 50, 0, 180);
      if (ph === 'morning') { sky.addColorStop(0, '#ffd9a8'); sky.addColorStop(1, '#ffeccc'); }
      else if (ph === 'rest' || ph === 'night') { sky.addColorStop(0, '#3b3a78'); sky.addColorStop(1, '#a27bb8'); }
      else { sky.addColorStop(0, '#9fd6f5'); sky.addColorStop(1, '#d8f0fb'); }
      rr(c, 380, 50, 200, 130, 10); c.fillStyle = sky; c.fill();
      if (ph === 'rest' || ph === 'night') { ell(c, 540, 90, 14, 14); c.fillStyle = '#fff6c9'; c.fill(); for (const [x, y] of [[410, 80], [450, 120], [500, 70], [560, 140]]) { star(c, x, y, 4, 1.6); c.fillStyle = '#fff6c9'; c.fill(); } }
      else { ell(c, 430, 100, 18, 18); c.fillStyle = '#fff3b0'; c.fill(); }
      c.strokeStyle = OUT; c.lineWidth = 3; c.beginPath(); c.moveTo(480, 50); c.lineTo(480, 180); c.stroke();
      rr(c, 380, 50, 200, 130, 10); c.lineWidth = 3; c.stroke();
      // curtains
      for (const s of [-1, 1]) { c.beginPath(); const x = 480 + s * 112; c.moveTo(x, 40); c.quadraticCurveTo(x + s * -20, 110, x + s * 4, 190); c.lineTo(x + s * 26, 190); c.lineTo(x + s * 26, 40); c.closePath(); fs(c, '#ffb3c1', 2.4); }
      // door
      rr(c, 840, 110, 90, 160, 6); fs(c, '#c08a5c', 3); ell(c, 916, 196, 5, 5); fs(c, '#ffd36b', 2);
      // furniture (y-sorted with her)
      const items = [{ y: w.buddy.y, d: () => this.drawBuddy(c) }];
      if (f.has('rug')) { ell(c, 470, 440, 180, 50); fs(c, '#c9b9ff', 3); ell(c, 470, 440, 150, 38); c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 3; c.stroke(); }
      items.push({ y: 360, d: () => this.drawBed(c, f.has('bed')) });
      items.push({ y: 400, d: () => this.drawTable(c) });
      if (f.has('sofa')) items.push({ y: 330, d: () => this.drawSofa(c) });
      if (f.has('shelf')) items.push({ y: 262, d: () => this.drawShelf(c) });
      if (f.has('plant')) items.push({ y: 520, d: () => this.drawPlant(c, 640, 520, 1) });
      if (f.has('lamp')) items.push({ y: 300, d: () => this.drawLamp(c) });
      items.push({ y: 300, d: () => G.Rig.drawBriefcase(c, 820, 262, 0.8) });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.d();
    }
    drawBed(c, cozy) {
      const col = cozy ? '#ffd1dc' : '#e7ecf3';
      rr(c, 40, 280, 220, 70, 10); fs(c, cozy ? '#c99268' : '#b9a58f', 3);
      rr(c, 30, 220, 26, 130, 8); fs(c, cozy ? '#c99268' : '#b9a58f', 3);
      rr(c, 56, 268, 198, 46, 12); fs(c, col, 2.6);
      ell(c, 90, 270, 30, 14); fs(c, '#fff', 2.4);
      if (cozy) { heart(c, 180, 292, 9); fs(c, '#ff8fb5', 1.8); }
    }
    drawTable(c) {
      rr(c, 640, 360, 150, 18, 6); fs(c, '#e8c9a0', 3);
      for (const x of [652, 768]) { rr(c, x, 376, 10, 34, 3); fs(c, '#c9a378', 2.4); }
      rr(c, 690, 344, 22, 18, 4); fs(c, '#fff', 2); rr(c, 730, 348, 30, 12, 3); fs(c, '#ffd1dc', 2);
    }
    drawSofa(c) {
      rr(c, 360, 250, 220, 60, 16); fs(c, '#9fd3c7', 3);
      rr(c, 344, 280, 252, 50, 14); fs(c, '#8cc7ba', 3);
      for (const x of [380, 470]) { rr(c, x, 286, 84, 22, 8); fs(c, '#b9e6dc', 2); }
    }
    drawShelf(c) {
      rr(c, 640, 110, 120, 150, 6); fs(c, '#c08a5c', 3);
      for (let r = 0; r < 3; r++) { c.fillStyle = '#a8744a'; c.fillRect(646, 150 + r * 45, 108, 5); for (let i = 0; i < 6; i++) { rr(c, 650 + i * 17, 118 + r * 45, 13, 32, 2); fs(c, ['#ff9aa2', '#9fd3ff', '#ffd36b', '#a8d56c', '#c9b9ff', '#fff'][(i + r) % 6], 1.5); } }
    }
    drawLamp(c) {
      rr(c, 300, 230, 8, 70, 3); fs(c, '#c9a378', 2);
      c.beginPath(); c.moveTo(284, 236); c.lineTo(324, 236); c.lineTo(314, 206); c.lineTo(294, 206); c.closePath(); fs(c, '#fff3c4', 2.4);
      const g = c.createRadialGradient(304, 230, 4, 304, 230, 90); g.addColorStop(0, 'rgba(255,230,150,.35)'); g.addColorStop(1, 'rgba(255,230,150,0)'); c.fillStyle = g; c.fillRect(204, 140, 200, 180);
    }

    // ---------- particles & speech ----------
    drawParticle(c, p) {
      const a = Math.min(1, p.life / Math.min(0.35, p.max));
      c.save(); c.globalAlpha = a; c.translate(p.x, p.y); c.rotate(p.rot); c.scale(p.size, p.size);
      switch (p.kind) {
        case 'text': text(c, p.text, 0, 0, p.fs, p.color); break;
        case 'heart': heart(c, 0, 0, 10); c.lineWidth = 6; c.strokeStyle = '#fff'; c.stroke(); fs(c, '#ff6b88', 2); break;
        case 'sparkle': star(c, 0, 0, 8, 2.2, 4, 0); c.fillStyle = '#fff6b0'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#e8b64a'; c.stroke(); break;
        case 'coin': ell(c, 0, 0, 7, 7); fs(c, '#ffd65c', 1.8); text(c, '฿', 0, 0.5, 9, '#b8860b', { outline: false }); break;
        case 'note': text(c, '♪', 0, 0, 22, '#7cb8ff'); break;
        case 'z': text(c, 'z', 0, 0, 18 + (1 - p.life / p.max) * 8, '#b9a6ff'); break;
        case 'shred': c.fillStyle = '#fff'; c.fillRect(-1.5, -6, 3, 12); c.strokeStyle = 'rgba(0,0,0,.2)'; c.lineWidth = 0.6; c.strokeRect(-1.5, -6, 3, 12); break;
        case 'steam': ell(c, 0, 0, 6, 8); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill(); break;
        case 'cloud':
          for (const [x, y, r] of [[-8, 0, 8], [0, -5, 9], [9, 0, 7]]) { ell(c, x, y, r, r); c.fillStyle = '#9aa7c2'; c.fill(); }
          c.strokeStyle = '#7da4e8'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, 9); c.lineTo(-8, 16); c.moveTo(3, 9); c.lineTo(1, 16); c.stroke();
          break;
      }
      c.restore();
    }
    drawSpeech(c) {
      const b = this.world.buddy; if (!b.say || this.world.phase === 'night') return;
      const h = this.world.headPos();
      const x = Math.min(800, h.x + 50), y = h.y - 80 * h.sc;
      c.font = '800 15px "Baloo 2", system-ui, sans-serif';
      const tw = c.measureText(b.say.text).width + 22, th = 28;
      c.save(); c.globalAlpha = Math.min(1, b.say.t / 0.25);
      c.beginPath(); c.moveTo(x + 6, y + th / 2 - 2); c.lineTo(x - 8, y + th / 2 + 12); c.lineTo(x + 18, y + th / 2 - 2); c.closePath(); fs(c, '#fff', 2.2);
      rr(c, x - 4, y - th / 2, tw, th, 13); fs(c, '#fff', 2.2);
      c.fillStyle = '#fff'; c.fillRect(x + 8, y + th / 2 - 4, 9, 4);
      c.fillStyle = OUT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(b.say.text, x + 7, y + 1);
      c.restore();
    }
  }

  G.Scene = Scene;
  G.SceneHit = HIT;
})(globalThis);
