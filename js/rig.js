/* rig.js — a Live2D-style skeleton character drawn on canvas.
 *
 *  - Bones: root → hips → legs; spine → chest → neck → head; shoulders → arms
 *    (two-bone IK for arms and legs).
 *  - Parameters like Live2D (angleX/Y/Z, bodyZ, breath, eye open L/R, eye
 *    look, mouth open/form, brow, blush) are eased toward targets every frame.
 *  - Head turns use parallax: face parts slide further than the back hair and
 *    the far eye narrows, so the flat drawing reads as turning in 3D.
 *  - Hair (ponytail, back hair, side locks, ahoge) and the skirt hem are spring
 *    chains, pushed by her movement (inertia), so they swing and settle.
 *
 * Coordinates: origin at her feet, y up is negative, ~290 px tall at scale 1.
 */
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;
  const OUT = '#4e2c2e';
  const C = {
    skin: '#ffeee6', hand: '#ffe2d8', skinSh: '#f7d9cf', blush: 'rgba(255,128,140,0.55)',
    hair: '#25232b', hairMid: '#36323c', hairHi: 'rgba(170,160,190,0.35)', hairTip: '#8a6a52',
    iris: '#a9d75c', irisDark: '#557f26', lash: '#2a1c22',
    sweater: '#d2b88f', sweaterSh: '#b0956d', rib: 'rgba(130,100,70,0.35)',
    shirt: '#fbfaf8', shirtSh: '#dcd8e3', skirt: '#3e4036', skirtSh: '#2d2f27',
    tights: '#4d3d3c', shoe: '#272325', clip: '#a8d56c', glasses: '#5c3038', tie: '#f0c75e',
    case: '#e9ebef', caseSh: '#b9bdc6', caseDark: '#4b4a50', cross: '#a8d56c',
  };

  // ---------- small helpers ----------
  const lerp = (a, b, t) => a + (b - a) * t;
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
  // two-bone IK: returns elbow/knee point. bend = +1 / -1 picks the side.
  function ik(sx, sy, tx, ty, l1, l2, bend) {
    let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy);
    const maxD = l1 + l2 - 0.01;
    if (d > maxD) { tx = sx + (dx / d) * maxD; ty = sy + (dy / d) * maxD; dx = tx - sx; dy = ty - sy; d = maxD; }
    const a = Math.atan2(dy, dx);
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const b = Math.acos(Math.max(-1, Math.min(1, cosA))) * bend;
    return { ex: sx + Math.cos(a + b) * l1, ey: sy + Math.sin(a + b) * l1, tx, ty };
  }
  // A ribbon (tapered strand) along a list of points.
  function ribbon(c, pts, w0, w1, bulge) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let tx = q.x - o.x, ty = q.y - o.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const f = i / (n - 1);
      const w = (lerp(w0, w1, f) + (bulge || 0) * Math.sin(f * Math.PI)) / 2;
      L.push([p.x - ty * w, p.y + tx * w]); R.push([p.x + ty * w, p.y - tx * w]);
    }
    c.beginPath(); c.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) { const m = [(L[i - 1][0] + L[i][0]) / 2, (L[i - 1][1] + L[i][1]) / 2]; c.quadraticCurveTo(L[i - 1][0], L[i - 1][1], m[0], m[1]); }
    c.lineTo(L[n - 1][0], L[n - 1][1]);
    c.quadraticCurveTo(pts[n - 1].x + (pts[n - 1].x - pts[n - 2].x) * 0.6, pts[n - 1].y + (pts[n - 1].y - pts[n - 2].y) * 0.6, R[n - 1][0], R[n - 1][1]);
    for (let i = n - 2; i >= 0; i--) { const m = [(R[i + 1][0] + R[i][0]) / 2, (R[i + 1][1] + R[i][1]) / 2]; c.quadraticCurveTo(R[i + 1][0], R[i + 1][1], m[0], m[1]); }
    c.lineTo(R[0][0], R[0][1]); c.closePath();
  }

  // ---------- spring chain (hair physics) ----------
  class Chain {
    // rest: absolute rest angle per segment (0 = straight down, +π/2 = right)
    constructor(lens, rest, opt) {
      this.lens = lens; this.rest = rest;
      this.stiff = opt.stiff ?? 0.12; this.damp = opt.damp ?? 0.86; this.grav = opt.grav ?? 900;
      this.pts = []; this.ready = false;
    }
    reset(x, y, base) {
      this.pts = [{ x, y, px: x, py: y }];
      let cx = x, cy = y;
      for (let i = 0; i < this.lens.length; i++) {
        const a = base + this.rest[i]; cx += Math.sin(a) * this.lens[i]; cy += Math.cos(a) * this.lens[i];
        this.pts.push({ x: cx, y: cy, px: cx, py: cy });
      }
      this.ready = true;
    }
    update(dt, x, y, base, ax, ay) {
      if (!this.ready) this.reset(x, y, base);
      const p = this.pts;
      p[0].x = x; p[0].y = y;
      for (let i = 1; i < p.length; i++) {
        const q = p[i], prev = p[i - 1], a = base + this.rest[i - 1];
        const tx = prev.x + Math.sin(a) * this.lens[i - 1], ty = prev.y + Math.cos(a) * this.lens[i - 1];
        const vx = (q.x - q.px) * this.damp, vy = (q.y - q.py) * this.damp;
        q.px = q.x; q.py = q.y;
        const k = this.stiff * (1 - (i / p.length) * 0.4);
        q.x += vx + (tx - q.x) * k - ax * dt * dt;
        q.y += vy + (ty - q.y) * k + (this.grav - ay) * dt * dt * 0.15;
      }
      for (let it = 0; it < 2; it++) for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i], L = this.lens[i - 1];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        b.x = a.x + (dx / d) * L; b.y = a.y + (dy / d) * L;
      }
    }
  }

  // ---------- expressions ----------
  // eyes: open | happy (^^) | blank (shock) | closed | wink | heart | tired | look-away
  const EXPR = {
    normal:  { eyes: 'open', eyeOpen: 0.72, mouth: 'o', mouthOpen: 0.35, form: 0.3, brow: 0, blush: 0.6 },
    focus:   { eyes: 'open', eyeOpen: 0.7, mouth: 'line', mouthOpen: 0, form: 0, brow: -0.4, blush: 0.4 },
    happy:   { eyes: 'happy', eyeOpen: 0, mouth: 'smileOpen', mouthOpen: 0.7, form: 1, brow: 0.3, blush: 0.8 },
    smile:   { eyes: 'happy', eyeOpen: 0, mouth: 'smile', mouthOpen: 0, form: 1, brow: 0.2, blush: 0.7 },
    shock:   { eyes: 'blank', eyeOpen: 1, mouth: 'o', mouthOpen: 0.6, form: 0, brow: 0.6, blush: 0.5 },
    wink:    { eyes: 'wink', eyeOpen: 0.8, mouth: 'line', mouthOpen: 0, form: -0.1, brow: 0.2, blush: 0.6 },
    sad:     { eyes: 'open', eyeOpen: 0.6, mouth: 'frown', mouthOpen: 0.1, form: -0.8, brow: 1, blush: 0.4 },
    cry:     { eyes: 'closed', eyeOpen: 0, mouth: 'wail', mouthOpen: 0.8, form: -1, brow: 1, blush: 0.8, tears: true },
    pout:    { eyes: 'open', eyeOpen: 0.6, mouth: 'pout', mouthOpen: 0, form: -0.5, brow: -1, blush: 0.9, puff: true },
    shy:     { eyes: 'away', eyeOpen: 0.75, mouth: 'wavy', mouthOpen: 0, form: 0, brow: 0.8, blush: 1.4 },
    love:    { eyes: 'heart', eyeOpen: 1, mouth: 'smileOpen', mouthOpen: 0.6, form: 1, brow: 0.3, blush: 1.2 },
    sleep:   { eyes: 'closed', eyeOpen: 0, mouth: 'o', mouthOpen: 0.15, form: 0, brow: 0.2, blush: 0.5 },
    tired:   { eyes: 'tired', eyeOpen: 0.35, mouth: 'o', mouthOpen: 0.2, form: -0.3, brow: 0.7, blush: 0.3, sweat: true },
    sip:     { eyes: 'closed', eyeOpen: 0, mouth: 'o', mouthOpen: 0.15, form: 0.4, brow: 0.35, blush: 0.95 },
    blow:    { eyes: 'open', eyeOpen: 0.55, mouth: 'o', mouthOpen: 0.1, form: 0, brow: 0.2, blush: 0.75 },
    yum:     { eyes: 'happy', eyeOpen: 0, mouth: 'cat', mouthOpen: 0, form: 1, brow: 0.2, blush: 0.9 },
  };

  // ---------- poses: hand targets (root space) and extras ----------
  // 2.5D: her torso faces mostly forward with a slight turn toward +x (mirrored
  // when she faces left). Both shoulders sit on the outer edges of the torso and
  // both arms hang beside her body; hr = near arm (+x side), hl = far arm.
  // Near shoulder (27,-168), far shoulder (-19,-169). Feet near (12,0), far (-3,0).
  const POSES = {
    idle:     { hl: [-25, -116], hr: [33, -116] },
    twirl:    { hl: [-25, -116], hr: [40, -188] },       // fiddling with her hair, like the reference
    walk:     { hl: [-25, -116], hr: [33, -116] },
    holdDoc:  { hl: [-2, -124], hr: [26, -124], item: 'doc', front: true, elbowPin: true },
    copy:     { hl: [-25, -116], hr: [44, -146], elbowR: 'in' },  // near hand taps the copier buttons
    reach:    { hl: [-25, -116], hr: [58, -134], nearBehind: true },  // near arm reaches out to the desk tray, behind her body
    sign:     { hl: [0, -122], hr: [26, -122], item: 'doc', front: true, elbowPin: true },
    shred:    { hl: [2, -122], hr: [28, -122], item: 'doc', front: true, elbowPin: true },
    coffee:   { hl: [-6, -180], hr: [30, -112], item: 'cup', front: true },  // right (far) hand drinks, left arm hangs, hand at her hip
    cheer:    { hl: [-34, -206], hr: [40, -206] },
    cheeks:   { hl: [-30, -196], hr: [38, -196] },
    chest:    { hl: [-2, -150], hr: [18, -150], front: true },
    stretch:  { hl: [-14, -254], hr: [24, -256] },
    case:     { hl: [-30, -100], hr: [33, -116], item: 'case', behind: true },
    eat:      { hl: [0, -180], hr: [30, -112], item: 'food', front: true },  // right (far) hand feeds her, left hand on her hip
  };
  // How far her head is turned toward the way she faces (Live2D ParamAngleX).
  const BASE_TURN = 0.55;

  // A hand above this height (root space) is drawn in front of the head.
  const RAISED = -162;

  const DEFAULTS = {
    angleX: 0, angleY: 0, angleZ: 0, bodyZ: 0, breath: 0, eyeOpenL: 0.85, eyeOpenR: 0.85, lookX: 0, lookY: 0,
    mouthOpen: 0.3, form: 0.3, brow: 0, blush: 0.6, hlx: -25, hly: -116, hrx: 33, hry: -116, bob: 0, squash: 0,
  };

  class Character {
    constructor() {
      this.p = Object.assign({}, DEFAULTS);
      this.t = 0; this.blinkT = 2; this.blink = 0;
      this.expr = 'normal'; this.pose = 'idle'; this.item = null; this.itemKind = null;
      this.twirlT = 6;
      this.saccade = { x: 0, y: 0, t: 0 };
      // hair chains (character space, unflipped)
      this.pony = new Chain([14, 18, 24, 30, 34, 36, 36, 36, 34, 30], [-3.0, -2.5, -1.6, -0.6, -0.18, -0.06, 0.0, 0.03, 0.05, 0.06], { stiff: 0.2, damp: 0.72 });
      this.backL = new Chain([28, 30, 26], [0.02, 0.04, 0.05], { stiff: 0.18 });
      this.backR = new Chain([28, 30, 26], [-0.02, -0.04, -0.05], { stiff: 0.18 });
      this.lockL = new Chain([20, 22, 20], [-0.1, 0, 0.08], { stiff: 0.18 });
      this.lockR = new Chain([20, 22, 20], [0.1, 0, -0.08], { stiff: 0.18 });
      this.ahoge = new Chain([14, 12, 9], [3.5, 2.6, 1.9], { stiff: 0.3, damp: 0.8, grav: 200 });
      this.hem = new Chain([10, 10], [0, 0], { stiff: 0.25 });
      this.lastV = { x: 0, y: 0 };
    }

    // state: { face, moving, walk, vx, vy, expr, pose, look:{x,y}|null, energy, busyId, busyT, held }
    update(dt, st) {
      this.t += dt;
      const p = this.p, t = this.t;
      // expression + pose targets
      let expr = st.expr || 'normal', pose = st.pose || 'idle';
      if (pose === 'idle' && !st.moving) {
        this.twirlT -= dt;
        if (this.twirlT < 0) { pose = 'twirl'; if (this.twirlT < -2.4) this.twirlT = 5 + Math.random() * 6; }
      }
      if (st.moving && pose === 'idle') pose = 'walk';
      // coffee: hold the mug under the spout while it fills, then sip ↔ blow,
      // timed by how long she has been at the machine
      let coffee = null;
      if (pose === 'coffee') {
        const ct = st.busyT || 0;
        if (ct < 0.6) coffee = { stage: 'fill', k: ct / 0.6 };
        else {
          const ph = ((ct - 0.6) % 1.4) / 1.4;
          coffee = { stage: ph < 0.55 ? 'sip' : 'blow', k: ph };
        }
        expr = coffee.stage === 'sip' ? 'sip' : coffee.stage === 'blow' ? 'blow' : 'smile';
      }
      this.coffee = coffee;
      this.expr = expr; this.pose = pose;
      const E = EXPR[expr] || EXPR.normal, P = POSES[pose] || POSES.idle;
      this.item = P.item || st.item || null; this.itemKind = st.itemKind || null;

      // blinking (not when eyes are already shut / blank)
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2.5 + Math.random() * 3.5; }
      this.blink = Math.max(0, this.blink - dt * 8);
      const blinkMul = 1 - Math.sin(Math.min(1, this.blink) * Math.PI);

      // eye saccades / looking at the cursor
      this.saccade.t -= dt;
      if (this.saccade.t <= 0) { this.saccade = { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.3, t: 1 + Math.random() * 2 }; }
      let lx = this.saccade.x, ly = this.saccade.y, ax = Math.sin(t * 0.7) * 0.15, ay = Math.sin(t * 0.9) * 0.08;
      if (st.look) { lx = Math.max(-1, Math.min(1, st.look.x)); ly = Math.max(-1, Math.min(1, st.look.y)); ax = lx * 0.6; ay = ly * 0.4; }
      if (st.moving) { ax = 0.15; ay = 0.05; } // body already faces the way she walks
      if (expr === 'shy') { ax = -0.7; ay = 0.3; lx = -1; ly = 0.5; }
      if (expr === 'sleep' || expr === 'tired') ay = 0.45;

      const T = {
        angleX: Math.max(-0.2, Math.min(0.72, BASE_TURN + ax * 0.55)), angleY: ay,
        angleZ: (pose === 'twirl' ? 0.08 : 0) + (expr === 'love' || expr === 'happy' ? Math.sin(t * 3) * 0.07 : 0) + (expr === 'sleep' ? 0.18 : 0) + (st.busyId === 'sign' ? 0.06 : 0) + (expr === 'tired' ? Math.sin(t * 1.3) * 0.06 : 0),
        bodyZ: st.moving ? 0.07 : Math.sin(t * 0.8) * 0.015,
        eyeOpenL: E.eyeOpen * blinkMul, eyeOpenR: (E.eyes === 'wink' ? 0 : E.eyeOpen) * blinkMul,
        lookX: lx, lookY: ly, mouthOpen: E.mouthOpen, form: E.form, brow: E.brow, blush: E.blush,
        hlx: P.hl[0], hly: P.hl[1], hrx: P.hr[0], hry: P.hr[1],
      };
      // pose animation layers
      if (pose === 'walk') {
        // arms swing front/back along the walking direction, opposite to the legs
        const s = Math.sin(st.walk * TAU);
        T.hlx += s * 5; T.hrx -= s * 6; T.hly -= Math.max(0, s) * 4; T.hry -= Math.max(0, -s) * 4;
      }
      if (pose === 'twirl') { T.hrx += Math.sin(t * 5) * 3; T.hry += Math.cos(t * 5) * 3; }
      if (pose === 'copy') { const tap = Math.max(0, Math.sin(t * 9)); T.hry += tap * 6; T.hrx += tap * 1.5; }
      if (pose === 'reach') { const r = Math.sin(Math.min(1, (st.busyT || 0) / 0.6) * Math.PI); T.hrx += r * 5; T.hry += r * 4; }
      if (pose === 'sign') { T.hrx += Math.sin(t * 14) * 4; T.hry += Math.cos(t * 7) * 2; }
      if (pose === 'shred') { const f = ((st.busyT || 0) * 1.5) % 1; T.hly -= f * 10; T.hry -= f * 10; }
      if (pose === 'cheer') { T.hly += Math.sin(t * 10) * 6; T.hry += Math.cos(t * 10) * 6; }
      if (pose === 'eat') { T.hly += Math.abs(Math.sin(t * 6)) * 5; } // little bites
      if (coffee) {
        // her RIGHT hand (the far arm, hl) holds the mug; her left hand stays
        // still on her hip the whole time (POSES.coffee.hr)
        if (coffee.stage === 'fill') {        // holding the mug out under the spout
          T.hlx = 22; T.hly = -132;
          T.angleX = 0.85; T.angleY = 0.2; lx = 1; ly = 0.6; T.lookX = lx; T.lookY = ly;
        } else if (coffee.stage === 'sip') {  // tipping it at her lips
          T.hlx = -5; T.hly = -186;
          T.angleY = -0.3; T.angleX = 0.6; T.angleZ += 0.06;
        } else {                              // holding it just under her lips, blowing
          T.hlx = -6; T.hly = -180;
          T.angleY = 0.14; T.lookX = 0.4; T.lookY = 0.5;
        }
      }
      this.cupTilt = lerp(this.cupTilt || 0, coffee && coffee.stage === 'sip' ? 0.6 : 0, 1 - Math.exp(-dt * 9));
      const k = 1 - Math.exp(-dt * 10), kf = 1 - Math.exp(-dt * 18);
      for (const key of Object.keys(T)) p[key] = lerp(p[key], T[key], key.startsWith('eyeOpen') || key === 'mouthOpen' ? kf : k);
      p.eyes = E.eyes; p.mouth = E.mouth; p.puff = !!E.puff; p.tears = !!E.tears; p.sweat = !!E.sweat || (st.energy != null && st.energy < 0.3);
      // breathing, walking bob
      p.breath = Math.sin(t * 2.1);
      p.bob = st.moving ? -Math.abs(Math.sin(st.walk * TAU)) * 5 : (expr === 'happy' || expr === 'love' ? -Math.abs(Math.sin(t * 6)) * 4 : 0);
      p.squash = lerp(p.squash, 0, k);
      this.walk = st.walk || 0; this.moving = !!st.moving;
      // turning around: ease the facing (−1…1) so the whole body flips in ~0.15 s
      const want = st.face || 1;
      if (this.faceS == null) this.faceS = want;
      this.faceS += (want - this.faceS) * (1 - Math.exp(-dt * 22));
      if (Math.abs(want - this.faceS) < 0.01) this.faceS = want;

      // hair physics: inertia from her own acceleration, in character space
      const face = st.face || 1;
      const vx = (st.vx || 0) * face, vy = st.vy || 0;
      const rawAX = (vx - this.lastV.x) / Math.max(dt, 1e-3), rawAY = (vy - this.lastV.y) / Math.max(dt, 1e-3);
      const ks = 1 - Math.exp(-dt * 6);
      this.acc = this.acc || { x: 0, y: 0 };
      this.acc.x += (rawAX - this.acc.x) * ks; this.acc.y += (rawAY - this.acc.y) * ks;
      const accX = this.acc.x, accY = this.acc.y;
      this.lastV = { x: vx, y: vy };
      const wind = vx * 1.6; // moving pushes hair back
      const H = this.headFrame();
      const sub = 2, sdt = dt / sub;
      for (let i = 0; i < sub; i++) {
        const pr = H.pt(-20, -284, -1), lb = H.pt(-58, -236, -1), rb = H.pt(36, -236, -0.6), ll = H.pt(-44, -236, -0.4), lr = H.pt(46, -236, 0.6), ah = H.pt(-2, -286);
        const hz = p.angleZ;
        this.pony.update(sdt, pr.x, pr.y, hz * 0.3, accX * 0.2 + wind * 0.45, accY * 0.15);
        this.backL.update(sdt, lb.x, lb.y, hz * 0.5, accX * 0.4 + wind * 0.4, accY * 0.3);
        this.backR.update(sdt, rb.x, rb.y, hz * 0.5, accX * 0.4 + wind * 0.4, accY * 0.3);
        this.lockL.update(sdt, ll.x, ll.y, hz, accX * 0.5 + wind * 0.5, accY * 0.4);
        this.lockR.update(sdt, lr.x, lr.y, hz, accX * 0.5 + wind * 0.5, accY * 0.4);
        this.ahoge.update(sdt, ah.x, ah.y, hz, accX * 0.8 + wind * 0.4, accY);
        this.hem.update(sdt, 2, -50, p.bodyZ, accX * 0.3 + wind * 0.2, accY * 0.2);
      }
    }
    poke(s) { this.p.squash = Math.max(this.p.squash, s); }

    // Head transform (neck pivot + roll + parallax shift), in root space.
    headFrame() {
      const p = this.p, nx = 0, ny = -172 + p.bob;
      const cz = Math.cos(p.angleZ + p.bodyZ), sz = Math.sin(p.angleZ + p.bodyZ);
      const ox = p.angleX * 3, oy = p.angleY * 3;
      return {
        nx, ny, cz, sz, ox, oy,
        pt: (x, y, par) => {
          // par = parallax depth (1 = face surface, 0 = skull centre, -1 = back)
          const dx = x + ox + (par || 0) * p.angleX * 7, dy = y + 172 + oy + (par || 0) * p.angleY * 5;
          return { x: nx + dx * cz - dy * sz, y: ny + dx * sz + dy * cz };
        },
      };
    }

    // ------------------------------------------------------------ drawing
    draw(c, x, y, scale, face) {
      const p = this.p;
      // mid-turn she is squashed toward the centre line, never to a sliver
      if (this.faceS != null) { const f = this.faceS; face = Math.sign(f || face) * Math.max(0.18, Math.abs(f)); }
      c.save();
      c.translate(x, y);
      c.scale(scale * face * (1 + p.squash * 0.12), scale * (1 - p.squash * 0.12));
      c.lineJoin = 'round'; c.lineCap = 'round';
      this.drawPonytail(c);
      this.drawBackHair(c);
      // Arms raised to her face/hair (twirl, coffee, cheeks…) go in front of
      // the head. Lowered: the far arm sits behind her body, the near one in front.
      const hiL = p.hly + p.bob < RAISED, hiR = p.hry + p.bob < RAISED, itemHigh = hiL || hiR;
      // Both arms sit on the same layer, in front of her body, in every pose
      // except ones marked `behind` (carrying the briefcase at her back side).
      const farFront = !(POSES[this.pose] && POSES[this.pose].behind);
      // A pose can also tuck the NEAR arm behind her body (reaching out sideways).
      const nearBehind = !!(POSES[this.pose] && POSES[this.pose].nearBehind);
      if (!hiL && !farFront) this.drawArm(c, -1);
      if (!hiR && nearBehind) this.drawArm(c, 1);
      if (this.item === 'case') this.drawItem(c);
      this.drawLegs(c);
      this.drawSkirt(c);
      this.drawBody(c);
      if (!hiL && farFront) this.drawArm(c, -1);
      if (!hiR && !nearBehind) this.drawArm(c, 1);
      if (!itemHigh && this.item !== 'case') this.drawItem(c);
      this.drawHead(c);
      if (hiL) this.drawArm(c, -1);
      if (hiR) this.drawArm(c, 1);
      if (itemHigh && this.item !== 'case') this.drawItem(c);
      c.restore();
    }

    hairFill(c, y0, y1) {
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, C.hair); g.addColorStop(0.55, C.hairMid); g.addColorStop(1, C.hairTip);
      return g;
    }

    drawPonytail(c) {
      const pts = this.pony.pts; if (!pts.length) return;
      ribbon(c, pts, 18, 6, 40);
      c.fillStyle = this.hairFill(c, pts[0].y, pts[pts.length - 1].y); c.fill(); c.lineWidth = 2.2; c.strokeStyle = OUT; c.stroke();
      // strand lines
      c.save(); ribbon(c, pts, 18, 6, 40); c.clip();
      c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 3;
      c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x - 4, q.y) : c.moveTo(q.x - 4, q.y))); c.stroke();
      c.restore();
      // hair tie (scrunchie)
      const a = pts[0], b = pts[1];
      ell(c, (a.x + b.x) / 2, (a.y + b.y) / 2, 7, 5, Math.atan2(b.y - a.y, b.x - a.x)); fs(c, C.tie, 1.8);
    }

    // Hair hanging behind her shoulders: one sheet whose two edges are the
    // physics chains, with a jagged bottom.
    drawBackHair(c) {
      const H = this.headFrame(), L = this.backL.pts, R = this.backR.pts;
      if (!L.length) return;
      const tl = H.pt(-64, -262, -1), tr = H.pt(38, -262, -0.6);
      const bl = L[L.length - 1], br = R[R.length - 1];
      c.beginPath(); c.moveTo(tl.x, tl.y);
      for (const q of L) c.lineTo(q.x - 4, q.y);
      const n = 6;
      for (let i = 1; i <= n; i++) {
        const f = i / n, x = bl.x + (br.x - bl.x) * f, y = bl.y + (br.y - bl.y) * f;
        c.lineTo(x - (br.x - bl.x) / n / 2, y - 12 - (i % 2) * 6); c.lineTo(x, y);
      }
      for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i].x + 4, R[i].y);
      c.lineTo(tr.x, tr.y); c.closePath();
      const g = c.createLinearGradient(0, tl.y, 0, bl.y); g.addColorStop(0, C.hair); g.addColorStop(1, C.hairMid);
      c.fillStyle = g; c.fill(); c.lineWidth = 2.2; c.strokeStyle = OUT; c.stroke();
    }

    // Legs stride front/back (along x). Far leg first and a shade darker.
    drawLegs(c) {
      const p = this.p, w = this.walk * TAU;
      for (const s of [-1, 1]) {
        const ph = this.moving ? Math.sin(w + (s > 0 ? 0 : Math.PI)) : 0;
        const lift = this.moving ? Math.max(0, Math.cos(w + (s > 0 ? 0 : Math.PI))) * 7 : 0;
        const hipX = s > 0 ? 13 : -9, hipY = -80 + p.bob * 0.6;
        const fx = (s > 0 ? 17 : -11) + ph * 13, fy = (s > 0 ? -5 : -7) - lift; // far foot sits a touch higher (further away)
        const k = ik(hipX, hipY, fx, fy, 40, 36, -0.7); // knees bend forward (+x)
        c.beginPath(); c.moveTo(hipX, hipY); c.lineTo(k.ex, k.ey); c.lineTo(k.tx, k.ty);
        c.lineWidth = 17; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 13; c.strokeStyle = s > 0 ? C.tights : '#3f3231'; c.stroke();
        c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.moveTo(k.ex + 3, k.ey); c.lineTo(k.tx + 2, k.ty - 6); c.stroke();
        // shoe pointing the way she faces
        ell(c, k.tx + (s > 0 ? 5 : 3), k.ty + 1, s > 0 ? 12.5 : 11, 6.5); fs(c, C.shoe, 2);
        ell(c, k.tx + 7, k.ty - 1.5, 4, 1.8); c.fillStyle = 'rgba(255,255,255,.25)'; c.fill();
      }
    }

    // High-waisted pencil skirt: wide hips, tapering to the knees, slit at the back.
    drawSkirt(c) {
      const p = this.p, b = p.bob, hem = this.hem.pts, sway = hem.length ? (hem[hem.length - 1].x - 2) * 0.5 : 0;
      const path = () => {
        c.beginPath(); c.moveTo(-18, -142 + b); c.quadraticCurveTo(4, -147 + b, 26, -142 + b);
        c.quadraticCurveTo(35, -132 + b, 34, -112 + b);        // front hip
        c.quadraticCurveTo(33, -80, 25 + sway, -52);           // taper to the hem
        c.quadraticCurveTo(4, -48, -18 + sway, -52);
        c.quadraticCurveTo(-29, -80, -29, -110 + b);           // back hip
        c.quadraticCurveTo(-29, -134 + b, -18, -142 + b); c.closePath();
      };
      path(); fs(c, C.skirt, 2.2);
      c.save(); path(); c.clip();
      // shading on the back half, a highlight on the front hip
      c.fillStyle = C.skirtSh; c.beginPath(); c.moveTo(-6, -142 + b); c.quadraticCurveTo(-22, -96, -14 + sway, -44); c.lineTo(-60, -40); c.lineTo(-60, -150); c.fill();
      // back slit + front pocket flap
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-22, -84); c.lineTo(-18 + sway, -52); c.stroke();
      c.beginPath(); c.moveTo(6, -122 + b); c.quadraticCurveTo(16, -117 + b, 27, -120 + b); c.stroke();
      c.restore();
    }

    // Small 3/4 torso: chest bulges toward the front (+x), back is flatter.
    drawBody(c) {
      const p = this.p, b = p.bob, br = 1 + p.breath * 0.014;
      c.save(); c.translate(0, -142 + b); c.rotate(p.bodyZ); c.scale(1, br); c.translate(0, 142);
      // shirt hem peeking above the skirt waistband
      rr(c, -20, -149, 48, 9, 4); fs(c, C.shirt, 2);
      ell(c, 12, -144.5, 2, 2); fs(c, '#fff', 1.1);
      const sw = () => {
        c.beginPath(); c.moveTo(-9, -186); c.lineTo(12, -186);
        c.quadraticCurveTo(18, -178, 27, -171);              // near shoulder
        c.quadraticCurveTo(35, -158, 28, -146);              // chest, near side
        c.quadraticCurveTo(5, -141, -18, -146);              // waist
        c.quadraticCurveTo(-25, -158, -20, -172);            // far side
        c.quadraticCurveTo(-14, -180, -9, -186); c.closePath();
      };
      sw(); fs(c, C.sweater, 2.2);
      c.save(); sw(); c.clip();
      c.strokeStyle = C.rib; c.lineWidth = 1.2;
      for (let x = -22; x <= 34; x += 4.2) { c.beginPath(); c.moveTo(x, -188); c.quadraticCurveTo(x + (x - 8) * 0.12, -164, x, -140); c.stroke(); }
      // cable braid along the front centre line (shifted toward the near side)
      c.strokeStyle = 'rgba(120,90,60,.55)'; c.lineWidth = 1.6;
      for (let y = -180; y < -146; y += 7) { c.beginPath(); c.ellipse(9, y, 2.8, 3.8, 0.5, 0, TAU); c.stroke(); c.beginPath(); c.ellipse(13.5, y + 3.5, 2.8, 3.8, -0.5, 0, TAU); c.stroke(); }
      // chest shading + back shadow
      c.fillStyle = 'rgba(150,120,85,.28)'; ell(c, 12, -150, 22, 5); c.fill();
      c.fillStyle = 'rgba(120,90,60,.18)'; c.fillRect(-26, -190, 12, 50);
      c.restore();
      // turtleneck fold
      rr(c, -9, -192, 22, 10, 4); fs(c, C.sweater, 2);
      // open white shirt collar: the near flap shows fully, the far one peeks
      c.beginPath(); c.moveTo(13, -186); c.lineTo(30, -176); c.lineTo(23, -165); c.lineTo(15, -176); c.closePath(); fs(c, C.shirt, 1.8);
      c.beginPath(); c.moveTo(-9, -186); c.lineTo(-20, -178); c.lineTo(-15, -170); c.closePath(); fs(c, C.shirt, 1.8);
      // lanyard down to the ID badge clipped at her waist
      c.strokeStyle = '#333'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(2, -186); c.quadraticCurveTo(10, -164, 16, -146); c.moveTo(14, -186); c.quadraticCurveTo(20, -166, 19, -146); c.stroke();
      c.restore();
      rr(c, 11, -146 + b, 13, 17, 2); fs(c, '#fff', 1.4);
      c.fillStyle = '#4a4650'; c.fillRect(14, -143 + b, 7, 6); c.fillStyle = '#c9c4cf'; c.fillRect(14, -135 + b, 7, 1.2); c.fillRect(14, -132.5 + b, 5, 1.2);
    }

    drawArm(c, s) {
      const p = this.p, b = p.bob;
      const sx = s > 0 ? 27 : -19, sy = (s > 0 ? -168 : -169) + b;
      const tx = s < 0 ? p.hlx : p.hrx, ty = (s < 0 ? p.hly : p.hry) + b;
      // Elbows: each pose fixes which side every elbow bends to. Default is
      // outward (away from her body): arms hang naturally and the choice can
      // never flip mid-animation. A pose can tuck an elbow in (elbowL / elbowR).
      const kA = ik(sx, sy, tx, ty, 30, 28, 1), kB = ik(sx, sy, tx, ty, 30, 28, -1);
      const out = s * kA.ex > s * kB.ex ? kA : kB, inward = out === kA ? kB : kA;
      const pz = POSES[this.pose] || {};
      let k = ((s > 0 ? pz.elbowR : pz.elbowL) || 'out') === 'in' ? inward : out;
      // Holding a document: upper arms hang down at her sides (elbow pinned just
      // below and outside the shoulder); forearms come forward to the paper.
      if (pz.elbowPin) k = { ex: sx + s * 6, ey: sy + 27, tx, ty };
      // Drinking arm: pin the elbow low at her side (just under the shoulder) and
      // let the forearm reach up to the mug, so the arm never folds onto itself.
      if ((this.pose === 'coffee' || this.pose === 'eat') && s < 0) k = { ex: sx + 3, ey: sy + 31, tx, ty };
      const far = s < 0 && !!(POSES[this.pose] && POSES[this.pose].behind); // shaded only when tucked behind her
      // bare forearm, then the puffy off-shoulder shirt sleeve over the upper arm
      c.beginPath(); c.moveTo(k.ex, k.ey); c.lineTo(k.tx, k.ty);
      c.lineWidth = 12; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 9; c.strokeStyle = far ? C.skinSh : C.skin; c.stroke();
      const ang = Math.atan2(k.ey - sy, k.ex - sx), mx = (sx + k.ex) / 2, my = (sy + k.ey) / 2;
      ell(c, mx, my, far ? 16 : 19, far ? 9.5 : 11, ang); fs(c, far ? C.shirtSh : C.shirt, 2);
      c.save(); ell(c, mx, my, 19, 11, ang); c.clip();
      c.strokeStyle = C.shirtSh; c.lineWidth = 2; c.beginPath(); c.moveTo(mx - Math.cos(ang) * 10 + s * 4, my - Math.sin(ang) * 10 + 4); c.lineTo(mx + Math.cos(ang) * 12 + s * 4, my + Math.sin(ang) * 12 + 4); c.stroke();
      c.restore();
      // hand
      if (!(this.item === 'cup' && s < 0)) { ell(c, k.tx, k.ty, 7, 7.5); fs(c, C.hand, 1.8); }
      this['hand' + (s < 0 ? 'L' : 'R')] = { x: k.tx, y: k.ty };
    }

    drawItem(c) {
      const it = this.item, hl = this.handL, hr = this.handR;
      if (!it || !hr && it !== 'case') return;
      if (it === 'doc') {
        const x = (hl.x + hr.x) / 2, y = (hl.y + hr.y) / 2 - 10;
        c.save(); c.translate(x, y); c.rotate(-0.06);
        rr(c, -15, -19, 30, 38, 2); fs(c, '#fff', 1.8);
        c.fillStyle = '#c9c4cf'; for (let i = 0; i < 5; i++) c.fillRect(-10, -12 + i * 6, i === 4 ? 12 : 20, 1.6);
        if (this.itemKind === 'important') { c.strokeStyle = '#e04f5f'; c.lineWidth = 2; ell(c, 7, 10, 6, 6); c.stroke(); c.fillStyle = '#e04f5f'; c.font = 'bold 8px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', 7, 10.5); }
        else { c.fillStyle = '#ffe48a'; c.fillRect(-14, -18, 12, 10); }
        c.restore();
        // hands over the paper
        ell(c, hl.x, hl.y, 7, 7.5); fs(c, C.hand, 1.8); ell(c, hr.x, hr.y, 7, 7.5); fs(c, C.hand, 1.8);
        if (this.pose === 'sign') { c.strokeStyle = '#333'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(hr.x + 2, hr.y - 4); c.lineTo(hr.x + 10, hr.y - 18); c.stroke(); }
      } else if (it === 'cup') {
        // mug held by its handle; it fills under the spout, tips toward her
        // mouth when she sips, and steams when she blows on it
        const cf = this.coffee, tilt = this.cupTilt || 0;
        const fill = cf && cf.stage === 'fill' ? Math.min(1, cf.k * 1.2) : 1;
        // held in her right hand (hl); mirrored so the handle faces that hand
        // the hand grips the handle; the mug (centre 11 px from the grip) tilts around it
        c.save(); c.translate(hl.x, hl.y); c.rotate(tilt); c.translate(11, -1); c.scale(-1, 1);
        const body = () => rr(c, -7.5, -9, 15, 17, 3.5);
        c.beginPath(); c.arc(8, -0.5, 4.5, -1.3, 1.3); c.lineWidth = 4.5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
        body(); fs(c, '#fff', 1.8);
        c.save(); body(); c.clip();
        c.fillStyle = '#7a4a2e'; c.fillRect(-8, -7 + (1 - fill) * 12, 16, 20);
        c.fillStyle = '#fff'; c.fillRect(-8, -3, 16, 12);
        c.restore();
        ell(c, 0, -9, 7.5, 2.4); fs(c, fill > 0.1 ? '#8b5a3a' : '#f1ece6', 1.6);
        heart(c, 0, 1.5, 3.4); c.fillStyle = '#ff9aa6'; c.fill();
        c.restore();
        // steam: lazy wisps; blown away from her face while she blows
        if (fill >= 1 && Math.abs(tilt) < 0.3) {
          const blow = cf && cf.stage === 'blow' ? 1 : 0;
          c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.8;
          for (let i = 0; i < 3; i++) {
            const ph = (this.t * (1.2 + blow) + i / 3) % 1, x0 = hl.x + 7 + i * 3.5, y0 = hl.y - 14 - ph * 14;
            c.globalAlpha = 1 - ph;
            c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 + 3 + blow * 6, y0 - 5, x0 + blow * 10 * ph, y0 - 9); c.stroke();
          }
          c.globalAlpha = 1;
        }
        // her fingers around the handle (the one and only hand)
        ell(c, hl.x, hl.y, 6.5, 7); fs(c, C.hand, 1.8);
      } else if (it === 'case') {
        drawBriefcase(c, hl.x - 4, hl.y + 4, 0.8);
        ell(c, hl.x, hl.y, 7, 7.5); fs(c, C.hand, 1.8);
      } else if (it === 'food') {
        c.save(); c.translate(hl.x + 4, hl.y - 6); c.font = '16px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(this.itemKind || '🍪', 0, 0); c.restore();
      }
    }

    drawHead(c) {
      const p = this.p, H = this.headFrame();
      c.save();
      c.translate(H.nx, H.ny); c.rotate(p.angleZ + p.bodyZ); c.translate(H.ox, H.oy + 172);
      const ax = p.angleX, ay = p.angleY;
      // back of the hair dome
      ell(c, -ax * 9, -236, 62, 58); c.fillStyle = C.hair; c.fill(); c.lineWidth = 2.2; c.strokeStyle = OUT; c.stroke();
      // face
      const fx = ax * 6, fy = ay * 2;
      c.beginPath(); c.moveTo(-48 + fx, -236 + fy);
      c.bezierCurveTo(-50 + fx, -196 + fy, -26 + fx, -176 + fy, 0 + fx * 1.5, -175 + fy);
      c.bezierCurveTo(26 + fx, -176 + fy, 50 + fx, -196 + fy, 48 + fx, -236 + fy);
      c.closePath();
      fs(c, C.skin, 2.2);
      // ear on the turned-away side peeks out
      if (Math.abs(ax) > 0.25) { const s = ax > 0 ? -1 : 1; ell(c, s * 50 + fx, -214 + fy, 6, 10); fs(c, C.skin, 1.8); }
      this.drawFace(c, ax, ay);
      this.drawFrontHair(c, ax, ay);
      c.restore();
      // side locks + ahoge (physics, in root space)
      for (const ch of [this.lockL, this.lockR]) {
        ribbon(c, ch.pts, 15, 3, 6);
        c.fillStyle = this.hairFill(c, ch.pts[0].y, ch.pts[ch.pts.length - 1].y + 40); c.fill(); c.lineWidth = 2; c.strokeStyle = OUT; c.stroke();
      }
      ribbon(c, this.ahoge.pts, 7, 1.5, 3); c.fillStyle = C.hair; c.fill(); c.lineWidth = 1.8; c.strokeStyle = OUT; c.stroke();
    }

    drawFace(c, ax, ay) {
      const p = this.p, px = ax * 12, py = ay * 6; // facial parallax (3/4 turn)
      // blush
      const bl = p.blush;
      if (bl > 0.05) {
        for (const s of [-1, 1]) {
          const g = c.createRadialGradient(s * 31 + px, -200 + py, 1, s * 31 + px, -200 + py, 16 + bl * 3);
          g.addColorStop(0, `rgba(255,120,135,${0.55 * Math.min(1, bl)})`); g.addColorStop(1, 'rgba(255,120,135,0)');
          c.fillStyle = g; ell(c, s * 31 + px, -200 + py, 18 + bl * 3, 12 + bl * 2); c.fill();
        }
        if (bl > 1.1) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { c.strokeStyle = 'rgba(220,70,90,.6)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(s * 26 + i * 5 + px, -196 + py); c.lineTo(s * 26 + i * 5 + 3 + px, -203 + py); c.stroke(); }
      }
      // eyes
      for (const s of [-1, 1]) {
        const far = (ax > 0 && s < 0) || (ax < 0 && s > 0);
        const sx = 1 - (far ? Math.abs(ax) * 0.3 : 0);
        this.drawEye(c, s * 19 + px * (far ? 0.8 : 1.1), -212 + py, sx, s < 0 ? p.eyeOpenL : p.eyeOpenR, s);
      }
      // brows: brow > 0 = worried (inner ends up), brow < 0 = cross (inner ends down)
      c.strokeStyle = OUT; c.lineWidth = 2;
      for (const s of [-1, 1]) {
        const x = s * 19 + px, y = -233 + py, inner = x - s * 8, outer = x + s * 8;
        c.beginPath(); c.moveTo(outer, y + p.brow * 1.5); c.quadraticCurveTo(x, y - 2.5, inner, y - p.brow * 3.5); c.stroke();
      }
      // mouth
      this.drawMouth(c, px * 1.1, -193 + py);
      // glasses: thin round frames riding a bit further out than the eyes, a
      // faint lens tint, a small curved glint along each lens rim (never across
      // the eye), a bridge, and temple arms going back toward her ears
      const lens = [-1, 1].map((s) => {
        const far = (ax > 0 && s < 0) || (ax < 0 && s > 0);
        return { s, far, x: s * 20 + px * 1.15, y: -211 + py, rx: 15, ry: 14 }; // both lenses the same size
      });
      for (const L of lens) {
        ell(c, L.x, L.y, L.rx, L.ry); c.fillStyle = 'rgba(205,232,255,0.16)'; c.fill();
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.7;
        c.beginPath(); c.ellipse(L.x, L.y, L.rx - 3, L.ry - 3, 0, -Math.PI * 0.44, -Math.PI * 0.16); c.stroke();
        c.beginPath(); c.arc(L.x - L.rx * 0.5, L.y + L.ry * 0.55, 1.1, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
      }
      c.strokeStyle = C.glasses; c.lineWidth = 1.8;
      for (const L of lens) {
        const ox = L.x + L.s * L.rx;
        c.beginPath(); c.moveTo(ox, L.y - 3); c.quadraticCurveTo(ox + L.s * 6, L.y - 5, ox + L.s * (L.far ? 15 : 7), L.y - 4); c.stroke();
      }
      for (const L of lens) { ell(c, L.x, L.y, L.rx, L.ry); c.stroke(); }
      c.beginPath(); c.moveTo(lens[0].x + lens[0].rx, -213 + py);
      c.quadraticCurveTo((lens[0].x + lens[1].x) / 2, -217 + py, lens[1].x - lens[1].rx, -213 + py); c.stroke();
      // tears / sweat
      if (p.tears) for (const s of [-1, 1]) {
        const len = 16 + Math.sin(this.t * 10 + s) * 4;
        rr(c, s * 22 + px - 3.5, -206 + py, 7, len, 3.5); c.fillStyle = 'rgba(143,211,255,.9)'; c.fill(); c.lineWidth = 1.4; c.strokeStyle = '#4a9ad3'; c.stroke();
      }
      if (p.sweat) { c.beginPath(); c.moveTo(44 + px, -246 + py); c.quadraticCurveTo(51 + px, -233 + py, 44 + px, -229 + py); c.quadraticCurveTo(37 + px, -233 + py, 44 + px, -246 + py); fs(c, '#c4ebff', 1.4); }
      if (p.puff) for (const s of [-1, 1]) { ell(c, s * 40 + px, -196 + py, 8, 6); c.fillStyle = 'rgba(255,150,160,.5)'; c.fill(); }
    }

    drawEye(c, x, y, sx, open, s) {
      const p = this.p, kind = p.eyes;
      c.save(); c.translate(x, y); c.scale(sx, 1);
      const lineEye = (curveUp) => { c.beginPath(); if (curveUp) c.arc(0, 5, 9, Math.PI * 1.15, Math.PI * 1.85); else c.arc(0, -4, 8, Math.PI * 0.15, Math.PI * 0.85); c.lineWidth = 2.6; c.strokeStyle = C.lash; c.stroke(); };
      if (kind === 'happy') { lineEye(true); c.restore(); return; }
      if (kind === 'blank') {
        ell(c, 0, 0, 9, 11); fs(c, '#fff', 2); c.restore(); return;
      }
      if (kind === 'heart') { heart(c, 0, 1, 9 + Math.sin(this.t * 9)); fs(c, '#ff5f80', 1.6); c.restore(); return; }
      if (kind === 'closed' || open < 0.12) { lineEye(false); c.restore(); return; }
      // open eye: droopy upper lid that closes with `open`
      const h = 11, lid = -h + (1 - open) * 2 * h * 0.85;
      c.save();
      c.beginPath(); c.ellipse(0, 0, 9.5, h, 0, 0, TAU); c.clip();
      c.fillStyle = '#fff'; c.fillRect(-11, -12, 22, 24);
      const lx = p.lookX * 3, ly = p.lookY * 2 + (kind === 'tired' ? 2 : 0);
      const g = c.createLinearGradient(0, -h, 0, h); g.addColorStop(0, C.irisDark); g.addColorStop(0.55, C.iris); g.addColorStop(1, '#d9f39a');
      ell(c, lx, 1 + ly, 7.5, 9.5); c.fillStyle = g; c.fill();
      ell(c, lx, 1 + ly, 3.2, 4.5); c.fillStyle = C.irisDark; c.fill();
      ell(c, lx - 2.5, -3 + ly, 2.4, 3); c.fillStyle = '#fff'; c.fill();
      ell(c, lx + 3, 5 + ly, 1.2, 1.2); c.fill();
      // eyelid (skin) coming down
      c.fillStyle = C.skin; c.fillRect(-12, -14, 24, lid + 14);
      c.restore();
      // upper lash line follows the lid
      c.beginPath(); c.moveTo(-10, lid + 1.5); c.quadraticCurveTo(0, lid - 2.5, 10.5, lid + 2.5);
      c.lineWidth = 3; c.strokeStyle = C.lash; c.stroke();
      c.lineWidth = 1.3; c.beginPath(); c.moveTo(10.5, lid + 2.5); c.lineTo(13, lid + 5); c.stroke();
      c.restore();
    }

    drawMouth(c, x, y) {
      const p = this.p, m = p.mouth, o = p.mouthOpen;
      c.save(); c.translate(x, y);
      c.lineWidth = 1.8; c.strokeStyle = OUT;
      switch (m) {
        case 'o': ell(c, 0, 1, 3.2 + o * 2, 2 + o * 4); fs(c, '#c45a66', 1.6); ell(c, 0, 2 + o * 2, 2 + o, 1 + o); c.fillStyle = '#ff9aa6'; c.fill(); break;
        case 'smileOpen': c.beginPath(); c.moveTo(-6, -1); c.quadraticCurveTo(0, 1, 6, -1); c.quadraticCurveTo(5, 6 + o * 4, 0, 7 + o * 4); c.quadraticCurveTo(-5, 6 + o * 4, -6, -1); c.closePath(); fs(c, '#c45a66', 1.6); ell(c, 0, 5 + o * 2.5, 3, 2); c.fillStyle = '#ff9aa6'; c.fill(); break;
        case 'smile': c.beginPath(); c.arc(0, -2, 4.5, Math.PI * 0.2, Math.PI * 0.8); c.stroke(); break;
        case 'cat': c.beginPath(); c.arc(-2.6, 0, 2.6, 0, Math.PI); c.arc(2.6, 0, 2.6, 0, Math.PI); c.stroke(); break;
        case 'frown': c.beginPath(); c.arc(0, 4, 4, Math.PI * 1.2, Math.PI * 1.8); c.stroke(); break;
        case 'wail': { const w = 6 + Math.sin(this.t * 12) * 1; ell(c, 0, 2, w, 5 + Math.sin(this.t * 8)); fs(c, '#c45a66', 1.6); break; }
        case 'pout': c.beginPath(); c.moveTo(-4, 1); c.quadraticCurveTo(0, -3, 4, 1); c.stroke(); break;
        case 'wavy': c.beginPath(); for (let i = 0; i <= 8; i++) c.lineTo(-6 + i * 1.5, Math.sin(i * 1.6) * 1.2); c.stroke(); break;
        default: c.beginPath(); c.moveTo(-3.5, 0); c.lineTo(3.5, 0); c.stroke();
      }
      c.restore();
    }

    drawFrontHair(c, ax, ay) {
      const hx = ax * 10, hy = ay * 3;
      const g = this.hairFill(c, -300, -150);
      // bangs: messy strands, tips placed between/around the eyes
      c.beginPath(); c.moveTo(-58 + hx * 0.5, -224);
      c.bezierCurveTo(-64 + hx * 0.5, -300, 64 + hx * 0.5, -300, 58 + hx * 0.5, -224);
      const tips = [[54, -214], [46, -232], [38, -206], [28, -236], [14, -222], [2, -232], [-2, -198], [-10, -234], [-24, -224], [-34, -238], [-42, -204], [-50, -230], [-58, -216]];
      for (let i = 0; i < tips.length; i++) {
        const [tx, ty] = tips[i], valley = i % 2 === 1;
        c.quadraticCurveTo(tx + hx + (valley ? 0 : 4), ty + hy - (valley ? 6 : 14), tx + hx, ty + hy);
      }
      c.closePath();
      c.fillStyle = g; c.fill(); c.lineWidth = 2.2; c.strokeStyle = OUT; c.stroke();
      // glossy highlight band
      c.save(); c.beginPath(); c.ellipse(hx * 0.6, -262, 46, 16, 0, Math.PI * 1.05, Math.PI * 1.95); c.lineWidth = 5; c.strokeStyle = C.hairHi; c.stroke(); c.restore();
      // green cross hair clip
      c.save(); c.translate(-30 + hx * 0.3, -260 + hy); c.rotate(-0.35);
      rr(c, -3, -9, 6, 18, 2.5); fs(c, C.clip, 1.6); rr(c, -9, -3, 18, 6, 2.5); fs(c, C.clip, 1.6);
      c.fillStyle = C.clip; c.fillRect(-2, -2, 4, 4);
      c.restore();
    }
  }

  function drawBriefcase(c, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.beginPath(); c.moveTo(-9, 0); c.lineTo(-9, -7); c.quadraticCurveTo(0, -11, 9, -7); c.lineTo(9, 0); c.lineWidth = 4; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = C.caseDark; c.stroke();
    rr(c, -30, 0, 60, 42, 5); fs(c, C.case, 2);
    c.fillStyle = C.caseSh; c.fillRect(-28, 34, 56, 6);
    for (const [cx, cy] of [[-27, 3], [27, 3], [-27, 39], [27, 39]]) { ell(c, cx, cy, 4.5, 4.5); c.fillStyle = C.caseDark; c.fill(); }
    rr(c, -4, 9, 8, 22, 2); fs(c, C.cross, 1.5); rr(c, -11, 16, 22, 8, 2); fs(c, C.cross, 1.5); c.fillStyle = C.cross; c.fillRect(-3, 17, 6, 6);
    c.restore();
  }

  G.Rig = { Character, EXPR, POSES, drawBriefcase, C };
})(globalThis);
