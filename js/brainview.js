/* brainview.js — live displays of the connectome brain.
 *
 *  BrainMap:     every one of the 166,700 MaleCNS neurons at its real soma
 *                position (front view). Neurons of her simulated circuit are
 *                tinted by role and glow when they spike. Hover a dot to see what it is.
 *  CircuitView:  the same spikes laid out as a node diagram:
 *                glomeruli → Kenyon cells ⇄ APL → MBON readouts, with DANs.
 */
(function (G) {
  'use strict';
  const ROLE_COLORS = { PN: '#7fe3c4', KC: '#8fb0ff', APL: '#ff8fb5', DPM: '#ff8fb5', MBON: '#ffd36b', PAM: '#d4a6ff', PPL1: '#b18cff' };
  const FIRE = '#ffd180';
  const GLOW_MS = 40; // spikes younger than this (simulated ms) glow

  function makeSpark(c1, c2) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 48;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, '#fff8df'); gr.addColorStop(0.1, c1); gr.addColorStop(0.3, c2 + 'aa'); gr.addColorStop(0.6, c2 + '29'); gr.addColorStop(1, c2 + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
    return cv;
  }
  const SPARK = { fire: null, reward: null, punish: null };

  function setupCanvas(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, w, h, dpr };
  }

  // ---------------------------------------------------------------- map
  class BrainMap {
    constructor(canvas, tip, brain, circuit, map, hooks) {
      this.canvas = canvas; this.tip = tip; this.brain = brain; this.circuit = circuit; this.map = map; this.hooks = hooks || {};
      if (!SPARK.fire) { SPARK.fire = makeSpark('#ffe59d', '#ffaa33'); SPARK.reward = makeSpark('#fff3b0', '#ffd23f'); SPARK.punish = makeSpark('#eadcff', '#a678ff'); }
      this.base = document.createElement('canvas');
      this.localOf = new Int32Array(map.n).fill(-1);
      circuit.neurons.forEach((r, li) => { this.localOf[r[0]] = li; });
      this.roleOf = circuit.neurons.map((r) => r[5]);
      // sim index → brain-map index (identity in whole-brain mode)
      this.globalOfSim = (sim) => (brain.full ? sim : circuit.neurons[sim][0]);
      this.actionOf = new Map(); // keyed by brain-map index
      [...circuit.readouts.motor, ...circuit.readouts.social].forEach((ro, a) => ro.idx.forEach((sim) => this.actionOf.set(this.globalOfSim(sim), a)));
      this.bindInput();
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
    }
    resize() {
      const { c, w, h, dpr } = setupCanvas(this.canvas);
      this.c = c; this.w = w; this.h = h;
      this.base.width = this.canvas.width; this.base.height = this.canvas.height;
      const b = this.base.getContext('2d'); b.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = this.map, n = m.n;
      const scale = Math.min((w - 24) / m.aspect, h - 24);
      const ox = w / 2 - (scale * m.aspect) / 2, oy = h / 2 - scale / 2;
      this.px = new Float32Array(n); this.py = new Float32Array(n);
      this.cell = 14; this.grid = new Map();
      for (let i = 0; i < n; i++) {
        if (m.U[i] === 65535) { this.px[i] = -1e4; continue; }
        const x = ox + (m.U[i] / 65534) * scale * m.aspect, y = oy + (m.V[i] / 65534) * scale;
        this.px[i] = x; this.py[i] = y;
        const k = ((x / this.cell) | 0) * 4096 + ((y / this.cell) | 0);
        let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = [])); arr.push(i);
      }
      // background: the whole CNS, faint blue, like a night sky
      const bg = b.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#16203d'); bg.addColorStop(1, '#0a0f1f');
      b.fillStyle = bg; b.fillRect(0, 0, w, h);
      b.fillStyle = '#add5f1'; b.globalAlpha = 0.42; b.beginPath();
      for (let i = 0; i < n; i++) { if (this.px[i] < -1e3 || this.localOf[i] >= 0) continue; b.moveTo(this.px[i] + 0.6, this.py[i]); b.arc(this.px[i], this.py[i], 0.6, 0, Math.PI * 2); }
      b.fill(); b.globalAlpha = 1;
      // her circuit, tinted by role
      for (const role of Object.keys(ROLE_COLORS)) {
        b.fillStyle = ROLE_COLORS[role]; b.globalAlpha = role === 'KC' ? 0.55 : 0.9; b.beginPath();
        this.circuit.neurons.forEach((r, li) => {
          if (r[5] !== role) return; const i = r[0]; if (this.px[i] < -1e3) return;
          const rad = role === 'KC' ? 0.9 : 1.6;
          b.moveTo(this.px[i] + rad, this.py[i]); b.arc(this.px[i], this.py[i], rad, 0, Math.PI * 2);
        });
        b.fill();
      }
      b.globalAlpha = 1;
    }
    nearest(x, y, maxD) {
      let best = -1, bd = maxD * maxD;
      const gx = (x / this.cell) | 0, gy = (y / this.cell) | 0;
      for (let a = gx - 1; a <= gx + 1; a++) for (let b = gy - 1; b <= gy + 1; b++) {
        const arr = this.grid.get(a * 4096 + b); if (!arr) continue;
        for (const i of arr) {
          const d = (this.px[i] - x) ** 2 + (this.py[i] - y) ** 2;
          // prefer neurons of her circuit when they are about as close
          const dd = this.localOf[i] >= 0 ? d * 0.5 : d;
          if (dd < bd) { bd = dd; best = i; }
        }
      }
      return best;
    }
    local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    bindInput() {
      const cv = this.canvas;
      cv.addEventListener('pointermove', (e) => { this.hover = this.local(e); this.showTip(); });
      cv.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; });
    }
    showTip() {
      if (!this.hover) { this.tip.hidden = true; return; }
      const i = this.nearest(this.hover.x, this.hover.y, 8);
      if (i < 0) { this.tip.hidden = true; return; }
      const m = this.map, li = this.localOf[i];
      const side = m.S[i] === 1 ? 'Left' : m.S[i] === 2 ? 'Right' : '';
      let txt = `${m.types[m.T[i]] || 'Unclassified type'}${side ? ' · ' + side : ''}\n${m.classes[m.C[i]].replace(/_/g, ' ')} · ID ${m.B[i]}`;
      if (li >= 0) {
        const r = this.circuit.neurons[li], a = this.actionOf.get(i);
        txt += `\n★ in her circuit: ${r[5]} · ${r[4]}`;
        if (a != null) { const act = this.hooks.actionName(a); txt += `\n→ readout for “${act}”`; }
      } else txt += this.brain.full ? '\n(simulated: whole-brain mode)' : '\n(not simulated in learning-circuit mode)';
      this.tip.textContent = txt; this.tip.hidden = false;
      this.tip.style.left = Math.min(this.w - 230, this.hover.x + 16) + 'px';
      this.tip.style.top = Math.min(this.h - 90, this.hover.y + 16) + 'px';
    }
    draw() {
      const c = this.c, w = this.w, h = this.h, brain = this.brain;
      c.clearRect(0, 0, w, h);
      c.drawImage(this.base, 0, 0, w, h);
      // spikes
      const ls = brain.lastSpike, now = brain.tick, win = GLOW_MS * 10, neu = this.circuit.neurons;
      const nSim = brain.full ? brain.n : neu.length;
      const roleAt = (sim) => { const li = brain.full ? this.localOf[sim] : sim; return li >= 0 ? neu[li][5] : 'OTHER'; };
      c.fillStyle = FIRE; c.beginPath();
      let halos = 0;
      const halo = [];
      for (let sim = 0; sim < nSim; sim++) {
        const t = ls[sim]; if (t === 0xffffffff || now - t > win) continue;
        const i = brain.full ? sim : neu[sim][0]; if (this.px[i] < -1e3) continue;
        const role = roleAt(sim), r0 = role === 'OTHER' ? 1.1 : 1.5;
        c.moveTo(this.px[i] + r0, this.py[i]); c.arc(this.px[i], this.py[i], r0, 0, Math.PI * 2);
        if (halos < 90 && ((role !== 'KC' && role !== 'OTHER') || Math.random() < (role === 'OTHER' ? 0.02 : 0.25))) { halo.push(sim); halos++; }
      }
      c.fill();
      for (const sim of halo) {
        const role = roleAt(sim), i = brain.full ? sim : neu[sim][0], fresh = 1 - (now - ls[sim]) / win;
        const sp = role === 'PAM' ? SPARK.reward : role === 'PPL1' ? SPARK.punish : SPARK.fire;
        const r = (role === 'KC' ? 5 : 8) + fresh * 5;
        c.globalAlpha = 0.4 + 0.6 * fresh; c.drawImage(sp, this.px[i] - r, this.py[i] - r, r * 2, r * 2);
      }
      c.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- circuit
  class CircuitView {
    constructor(canvas, tip, brain, circuit, cfg) {
      this.canvas = canvas; this.tip = tip; this.brain = brain; this.circuit = circuit; this.cfg = cfg;
      this.nodes = []; // {x,y,r,label,li[] , kind}
      canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.showTip(); });
      canvas.addEventListener('pointerleave', () => { this.hover = null; tip.hidden = true; });
      new ResizeObserver(() => this.layout()).observe(canvas);
    }
    layout() {
      if (this.canvas.hidden) return;
      const { c, w, h } = setupCanvas(this.canvas);
      this.c = c; this.w = w; this.h = h;
      const ci = this.circuit, cfg = this.cfg, br = this.brain;
      const top = 34, bottom = h - 16;
      // column x positions
      // column x positions: labels+glomeruli | KCs | APL/DANs | MBON readouts
      const kcLeft = 230, mbonX = w - 200;
      const kcW = Math.max(120, Math.min(w * 0.26, mbonX - kcLeft - 190));
      const X = { glom: 14, kc: kcLeft + kcW / 2, mid: (kcLeft + kcW + mbonX) / 2 + 10, mbon: mbonX };
      this.X = X;
      // glomeruli grouped by feature
      this.glomRows = [];
      const lobes = [['motor', br.motor], ['social', br.social]];
      let rows = 0; lobes.forEach(([, l]) => (rows += l.features.length + 1));
      const rh = (bottom - top) / rows;
      let y = top, ch = 0;
      for (const [name, lobe] of lobes) {
        this.glomRows.push({ header: name === 'motor' ? 'MOTOR SENSES' : 'TOUCH SENSES', y: y + rh * 0.5 }); y += rh;
        for (const f of lobe.features) {
          const nodes = [];
          for (let b = 0; b < f.bins; b++) { const gl = ci.glomeruli[ch]; nodes.push({ ch, type: gl.type, li: gl.idx }); ch++; }
          this.glomRows.push({ label: f.label, y: y + rh / 2, nodes }); y += rh;
        }
      }
      // KC blocks by class
      const kcs = { 'γ (gamma)': [], "α′β′ (alpha'/beta')": [], 'αβ (alpha/beta)': [] };
      ci.neurons.forEach((r, li) => {
        if (r[5] !== 'KC') return;
        const sim = ci.simIdx ? ci.simIdx[li] : li;
        if (/^KCg/.test(r[2])) kcs['γ (gamma)'].push(sim); else if (/^KCa'b'/.test(r[2])) kcs["α′β′ (alpha'/beta')"].push(sim); else kcs['αβ (alpha/beta)'].push(sim);
      });
      const total = Object.values(kcs).reduce((s, a) => s + a.length, 0);
      const cell = Math.max(2, Math.floor(Math.sqrt((kcW * (bottom - top - 60)) / total)));
      const cols = Math.floor(kcW / cell);
      this.kcBlocks = []; let ky = top + 10;
      for (const [name, list] of Object.entries(kcs)) {
        const rowsN = Math.ceil(list.length / cols);
        this.kcBlocks.push({ name, list, x: X.kc - kcW / 2, y: ky + 12, cols, cell, h: rowsN * cell });
        ky += rowsN * cell + 26;
      }
      this.kcCenter = { x: X.kc + kcW / 2 + 4, y: (top + ky) / 2 };
      // middle column: APL, DPM, DANs
      const apl = ci.apl, dpm = ci.dpm;
      this.mid = [
        { label: 'APL (inhibition)', li: apl, y: top + 30, color: ROLE_COLORS.APL },
        { label: 'DPM', li: dpm, y: top + 70, color: ROLE_COLORS.DPM },
        { label: 'PAM dopamine (reward)', li: ci.dans.PAM, y: top + 120, color: ROLE_COLORS.PAM, grid: true },
        { label: 'PPL1 dopamine (punish)', li: ci.dans.PPL1, y: top + 230, color: ROLE_COLORS.PPL1, grid: true },
      ];
      // readout MBONs
      const ro = [...ci.readouts.motor.map((r, a) => ({ ...r, a, act: cfg.motorActions[a] })), ...ci.readouts.social.map((r, a) => ({ ...r, a: a + cfg.motorActions.length, act: cfg.socialActions[a] }))];
      const mh = (bottom - top - 30) / (ro.length + 1);
      this.mbons = ro.map((r, k) => ({ ...r, y: top + 10 + (k + (k >= cfg.motorActions.length ? 1 : 0)) * mh + mh / 2 }));
      this.mbonSplit = top + 10 + cfg.motorActions.length * mh + mh / 2;
    }
    fired(lis, now, win, ls) { let n = 0; for (const li of lis) { const t = ls[li]; if (t !== 0xffffffff && now - t <= win) n++; } return n; }
    showTip() {
      if (!this.hover || !this.hit) { this.tip.hidden = true; return; }
      let found = null;
      for (const hb of this.hit) if (Math.abs(this.hover.x - hb.x) < hb.r && Math.abs(this.hover.y - hb.y) < hb.r) { found = hb; break; }
      if (!found) { this.tip.hidden = true; return; }
      this.tip.textContent = found.text; this.tip.hidden = false;
      this.tip.style.left = Math.min(this.w - 230, this.hover.x + 16) + 'px';
      this.tip.style.top = Math.min(this.h - 80, this.hover.y + 16) + 'px';
    }
    draw() {
      if (!this.c) this.layout();
      const c = this.c, w = this.w, h = this.h, br = this.brain, X = this.X;
      const ls = br.lastSpike, now = br.tick, win = GLOW_MS * 10;
      const bg = c.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#141c36'); bg.addColorStop(1, '#0a0f1f');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      c.font = '700 11px "Baloo 2", system-ui, sans-serif'; c.textBaseline = 'middle';
      this.hit = [];
      // column titles
      c.fillStyle = '#8fa3d6'; c.textAlign = 'left';
      c.fillText('PROJECTION NEURONS (glomeruli)', X.glom, 14);
      c.textAlign = 'center'; c.fillText(`KENYON CELLS (${this.kcBlocks.reduce((s, b) => s + b.list.length, 0)})`, X.kc, 14);
      c.fillText('INHIBITION & DOPAMINE', X.mid - 20, 14);
      c.textAlign = 'left'; c.fillText('MBON READOUTS → CHOICES', X.mbon, 14);

      // glomeruli
      const glomX0 = X.glom + 128;
      for (const row of this.glomRows) {
        if (row.header) { c.fillStyle = '#5f6f9c'; c.font = '800 10px "Baloo 2", system-ui'; c.textAlign = 'left'; c.fillText(row.header, X.glom, row.y); c.font = '700 11px "Baloo 2", system-ui'; continue; }
        c.fillStyle = '#c9d6ff'; c.textAlign = 'left'; c.fillText(row.label, X.glom, row.y);
        row.nodes.forEach((nd, b) => {
          const x = glomX0 + b * 13, f = this.fired(nd.li, now, win, ls) / nd.li.length;
          if (f > 0) { c.strokeStyle = `rgba(127,227,196,${0.08 + f * 0.25})`; c.lineWidth = 1; c.beginPath(); c.moveTo(x, row.y); c.quadraticCurveTo((x + X.kc) / 2, row.y, this.kcBlocks[0].x, this.kcCenter.y); c.stroke(); }
          c.beginPath(); c.arc(x, row.y, 4.5, 0, Math.PI * 2);
          c.fillStyle = f > 0 ? FIRE : '#24305a'; c.fill(); c.lineWidth = 1.2; c.strokeStyle = ROLE_COLORS.PN; c.stroke();
          if (f > 0) { c.globalAlpha = 0.7; c.drawImage(SPARK.fire, x - 9, row.y - 9, 18, 18); c.globalAlpha = 1; }
          this.hit.push({ x, y: row.y, r: 6, text: `Glomerulus ${nd.type} (${nd.li.length} PN${nd.li.length > 1 ? 's' : ''})\nencodes: ${row.label}, bin ${b + 1}` });
        });
      }
      // KC blocks
      let kcFired = 0;
      for (const blk of this.kcBlocks) {
        c.fillStyle = '#8fa3d6'; c.textAlign = 'left'; c.fillText(blk.name, blk.x, blk.y - 7);
        c.fillStyle = '#1b2547'; c.fillRect(blk.x - 2, blk.y - 2, blk.cols * blk.cell + 4, blk.h + 4);
        for (let k = 0; k < blk.list.length; k++) {
          const li = blk.list[k], t = ls[li];
          const on = t !== 0xffffffff && now - t <= win;
          if (!on) continue;
          kcFired++;
          const x = blk.x + (k % blk.cols) * blk.cell, y = blk.y + Math.floor(k / blk.cols) * blk.cell;
          c.fillStyle = FIRE; c.fillRect(x, y, blk.cell - 0.5, blk.cell - 0.5);
        }
        this.hit.push({ x: blk.x + (blk.cols * blk.cell) / 2, y: blk.y + blk.h / 2, r: Math.max(blk.h / 2, 20), text: `${blk.list.length} ${blk.name} Kenyon cells\nreal PN→KC wiring from MaleCNS; APL keeps the code sparse` });
      }
      this.kcFired = kcFired;
      // middle
      for (const m of this.mid) {
        const f = this.fired(m.li, now, win, ls);
        const x = X.mid - 20;
        if (m.grid) {
          const cols = 24, cell = 4, x0 = x - (cols * cell) / 2;
          c.fillStyle = '#c9d6ff'; c.textAlign = 'center'; c.fillText(`${m.label}`, x, m.y - 10);
          m.li.forEach((li, k) => {
            const t = ls[li], on = t !== 0xffffffff && now - t <= win;
            c.fillStyle = on ? m.color : '#24305a';
            c.fillRect(x0 + (k % cols) * cell, m.y + Math.floor(k / cols) * cell, cell - 1, cell - 1);
          });
          if (f) { c.globalAlpha = Math.min(1, f / 20); c.drawImage(m.color === ROLE_COLORS.PAM ? SPARK.reward : SPARK.punish, x - 50, m.y - 20, 100, 90); c.globalAlpha = 1; }
          this.hit.push({ x, y: m.y + 20, r: 50, text: `${m.label}: ${m.li.length} neurons\nfiring now: ${f}` });
        } else {
          c.beginPath(); c.arc(x, m.y, 9, 0, Math.PI * 2); c.fillStyle = f ? FIRE : '#24305a'; c.fill(); c.lineWidth = 2; c.strokeStyle = m.color; c.stroke();
          if (f) c.drawImage(SPARK.fire, x - 16, m.y - 16, 32, 32);
          c.fillStyle = '#c9d6ff'; c.textAlign = 'center'; c.fillText(m.label, x, m.y + 20);
          if (m.label.startsWith('APL')) {
            c.strokeStyle = 'rgba(255,143,181,.35)'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(x - 10, m.y); c.lineTo(this.kcCenter.x, this.kcCenter.y - 40); c.stroke(); c.setLineDash([]);
          }
          this.hit.push({ x, y: m.y, r: 12, text: `${m.label}: ${m.li.length} neuron(s)` });
        }
      }
      // DAN → MBON arrow hint
      c.strokeStyle = 'rgba(212,166,255,.25)'; c.setLineDash([2, 5]); c.beginPath(); c.moveTo(X.mid + 30, this.mid[2].y + 30); c.lineTo(X.mbon - 10, this.mbons[3].y); c.stroke(); c.setLineDash([]);
      // MBON readouts
      const motorQ = br.motor.q, socQ = br.social.q, nm = this.cfg.motorActions.length;
      const qs = this.mbons.map((m) => (m.a < nm ? motorQ[m.a] : socQ[m.a - nm]));
      const lastM = br.motor.lastAction, lastS = br.social.lastAction;
      c.strokeStyle = 'rgba(143,163,214,.25)'; c.beginPath(); c.moveTo(X.mbon, this.mbonSplit); c.lineTo(w - 12, this.mbonSplit); c.stroke();
      this.mbons.forEach((m, k) => {
        const f = this.fired(m.idx, now, win * 3, ls), chosen = m.a < nm ? m.a === lastM : m.a - nm === lastS;
        const inputAct = (m.a < nm ? br.motor.input[m.a] : br.social.input[m.a - nm]) || 0;
        c.strokeStyle = chosen ? 'rgba(255,190,90,.75)' : `rgba(143,176,255,${Math.min(0.35, 0.04 + inputAct / 3000)})`;
        c.lineWidth = chosen ? 2 : 1;
        c.beginPath(); c.moveTo(this.kcCenter.x, this.kcCenter.y); c.bezierCurveTo((this.kcCenter.x + X.mbon) / 2, this.kcCenter.y, (this.kcCenter.x + X.mbon) / 2, m.y, X.mbon, m.y); c.stroke();
        c.beginPath(); c.arc(X.mbon + 8, m.y, 7, 0, Math.PI * 2);
        c.fillStyle = f ? FIRE : chosen ? '#5a4520' : '#24305a'; c.fill(); c.lineWidth = 2; c.strokeStyle = ROLE_COLORS.MBON; c.stroke();
        if (f) c.drawImage(SPARK.fire, X.mbon + 8 - 14, m.y - 14, 28, 28);
        c.textAlign = 'left'; c.fillStyle = chosen ? '#ffe7a8' : '#c9d6ff';
        c.font = `${chosen ? 800 : 600} 11px "Baloo 2", system-ui`;
        c.fillText(`${m.act.icon} ${m.act.label}`, X.mbon + 20, m.y - 5);
        c.fillStyle = '#6f80b0'; c.font = '600 9.5px "Baloo 2", system-ui'; c.fillText(m.type, X.mbon + 20, m.y + 7);
        const bx = w - 70, bw = 56, q = qs[k];
        c.fillStyle = '#1b2547'; c.fillRect(bx, m.y - 4, bw, 8);
        const len = Math.max(-1, Math.min(1, q / 1.5)) * (bw / 2);
        c.fillStyle = q >= 0 ? '#7fd6a0' : '#ff8a9a'; c.fillRect(bx + bw / 2 + Math.min(0, len), m.y - 4, Math.abs(len), 8);
        c.fillStyle = '#5f6f9c'; c.fillRect(bx + bw / 2, m.y - 6, 1, 12);
        this.hit.push({ x: X.mbon + 8, y: m.y, r: 10, text: `${m.type} (${m.idx.length} neurons) → ${m.act.label}\nlearned value ${q.toFixed(2)} · KC input ${inputAct.toFixed(0)}` });
      });
      c.font = '700 11px "Baloo 2", system-ui';
    }
  }

  G.BrainViews = { BrainMap, CircuitView, ROLE_COLORS };
})(globalThis);
