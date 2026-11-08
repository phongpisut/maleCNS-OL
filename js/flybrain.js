/* flybrain.js — host side of the WASM connectome simulator.
 *
 * Ms. Fruity's brain is her real mushroom-body circuit from the MaleCNS
 * connectome (olfactory projection neurons → Kenyon cells ⇄ APL → MBONs, plus
 * dopamine neurons), simulated as spiking LIF neurons in WebAssembly.
 *
 *   senses → Poisson spike trains on one glomerulus (PN type) per feature bin
 *   KCs    → whatever the real wiring + APL inhibition makes fire
 *   MBONs  → 14 real MBON types are "readouts", one per action; their KC→MBON
 *            synapses are plastic and dopamine (δ) rewrites the ones whose KCs
 *            just fired.
 *
 * Exposes `brain.motor` / `brain.social` with the same lobe API the world uses.
 */
(function (G) {
  'use strict';

  const ROLE = { PN: 0, KC: 1, APL: 2, DPM: 3, MBON: 4, PAM: 5, PPL1: 6, OTHER: 7 };
  const PARAMS = {
    window: 300,      // simulated steps (×0.1 ms) per perception burst = 30 ms
    maxRate: 220,     // Hz on a fully-on glomerulus
    plasticGain: 0.25, // how much learned θ changes real KC→MBON transmission
    // Optional per-pathway scales (1 = raw connectome). See tools/tune.js.
    scales: [],
    // Whole-brain mode: her senses are injected straight into her projection
    // neurons, so the rest of the brain's input to them (antennal-lobe
    // circuitry we don't simulate odours for) is cut, or it floods her Kenyon
    // cells (~30% firing instead of the fly's sparse ~1-5%).
    fullScales: [['OTHER', 'PN', 0]],
    fullIdleSteps: 14,   // whole brain: simulated steps per frame (perception spreads over frames)
  };

  // Feature value → firing rates of a few glomeruli (population code).
  function encode(features, sense, out) {
    let o = 0;
    for (const f of features) {
      let v = sense[f.key];
      if (typeof v === 'boolean') v = v ? 1 : 0;
      v = Math.max(0, Math.min(1, v || 0));
      const g = f.gain || 1;
      if (f.quiet != null && v <= f.quiet + 0.02) { for (let i = 0; i < f.bins; i++) out[o + i] = 0; o += f.bins; continue; }
      // Sparse code: a binary feature only drives its "yes" glomerulus when
      // true (the other stays silent unless the feature is marked `both`);
      // graded features drive the one or two glomeruli nearest the value.
      if (f.bins === 2) { out[o] = f.both ? (1 - v) * g : 0; out[o + 1] = v * g; }
      else {
        const sig = 0.5 / (f.bins - 1);
        for (let i = 0; i < f.bins; i++) {
          const c = i / (f.bins - 1), a = Math.exp(-((v - c) ** 2) / (2 * sig * sig));
          out[o + i] = a > 0.3 && !(f.quietBins && f.quietBins.includes(i)) ? g * a : 0;
        }
      }
      o += f.bins;
    }
    return out;
  }

  function f32ToB64(arr) {
    const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  }
  function b64ToF32(b) {
    const s = typeof atob !== 'undefined' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return new Float32Array(u8.buffer);
  }

  class Lobe {
    constructor(brain, name, features, actions, first, glomFirst) {
      this.brain = brain; this.name = name; this.features = features; this.actions = actions;
      this.first = first; this.count = actions.length;
      this.nBins = features.reduce((s, f) => s + f.bins, 0);
      this.glomFirst = glomFirst;
      this.pn = new Float32Array(this.nBins);
      this.q = new Float32Array(this.count);
      this.input = new Float32Array(this.count);
      this._p = new Float32Array(this.count);
      this.prevAction = -1; this.prevQ = 0; this.dan = 0; this.lastAction = -1;
      this.labels = [];
      features.forEach((f) => { for (let i = 0; i < f.bins; i++) this.labels.push(f.label || f.key); });
    }
    // Present the situation to the antennal lobe and let the circuit run.
    perceive(sense) {
      encode(this.features, sense, this.pn);
      this.brain.present(this);
      this.readout(false);
      return this;
    }
    readout(snap) {
      const ex = this.brain.ex, mem = this.brain.mem();
      const ptr = ex.fb_readout(this.first, this.count, snap ? 1 : 0);
      const out = new Float32Array(mem.buffer, ptr, this.count * 2);
      this.q.set(out.subarray(0, this.count)); this.input.set(out.subarray(this.count));
      return this.q;
    }
    choose(temp, rnd) {
      rnd = rnd || Math.random;
      const q = this.q, n = q.length, p = this._p;
      let m = -Infinity, best = 0;
      for (let i = 0; i < n; i++) if (q[i] > m) { m = q[i]; best = i; }
      if (temp <= 1e-3) return best;
      let sum = 0;
      for (let i = 0; i < n; i++) { p[i] = Math.exp((q[i] - m) / temp); sum += p[i]; }
      let r = rnd() * sum;
      for (let i = 0; i < n; i++) { r -= p[i]; if (r <= 0) return i; }
      return n - 1;
    }
    tdStep(reward, opt) {
      let maxQ = -Infinity;
      for (let a = 0; a < this.count; a++) if (this.q[a] > maxQ) maxQ = this.q[a];
      if (this.prevAction >= 0) {
        this.dan = reward + opt.gamma * maxQ - this.prevQ;
        this.brain.ex.fb_dopamine(this.dan, opt.lr, opt.gamma * opt.lambda, this.first, this.count);
        this.brain.dopaminePulse(this.dan);
        this.readout(false);
      } else this.dan = 0;
      return this.dan;
    }
    commit(action) {
      this.brain.ex.fb_commit(this.first + action, this.first, this.count);
      this.prevAction = action; this.prevQ = this.q[action]; this.lastAction = action;
    }
    resetEpisode() { this.brain.ex.fb_reset_traces(); this.prevAction = -1; }
    // Round-level credit: every choice made since roundStart() shares a treat/scold.
    roundStart() { this.brain.ex.fb_round_start(); }
    roundReward(amount) {
      this.brain.ex.fb_round_reward(amount, this.first, this.count);
      this.dan = amount; this.brain.dopaminePulse(amount);
      this.readout(false);
    }
    nudge(action, amount, snap) { this.brain.ex.fb_nudge(this.first + action, amount, snap ? 1 : 0); }
    // Supervised lesson: lift `action` above its rivals in the current context.
    teach(action, lr) {
      lr = lr == null ? 0.8 : lr;
      const q = this.q;
      let maxOther = -Infinity;
      for (let a = 0; a < this.count; a++) if (a !== action && q[a] > maxOther) maxOther = q[a];
      const target = Math.max(q[action], maxOther + 0.4);
      this.nudge(action, lr * (target - q[action]), false);
      for (let a = 0; a < this.count; a++) if (a !== action && q[a] > target - 0.4) this.nudge(a, lr * 0.5 * ((target - 0.4) - q[a]), false);
      this.dan = target - q[action];
      this.brain.dopaminePulse(this.dan);
      this.readout(false);
    }
    // Social lobe: feedback can arrive seconds after the reaction.
    snapshot(action) { this.brain.ex.fb_snapshot(); this.snap = { action }; this.lastAction = action; }
    feedback(r, lr, action) {
      if (!this.snap) return 0;
      const a = action == null ? this.snap.action : action;
      const qa = this.readout(true)[a];
      this.nudge(a, lr * (r - qa), true);
      this.dan = r - qa;
      if (action == null) this.brain.dopaminePulse(this.dan);
      return this.dan;
    }
    teachSnap(action, lr) {
      if (!this.snap) return;
      const q = this.readout(true).slice();
      for (let a = 0; a < this.count; a++) if (a !== action && q[a] > -0.3) this.nudge(a, lr * 0.5 * (-0.3 - q[a]), true);
      this.nudge(action, lr * (1 - q[action]), true);
      this.snap.action = action; this.lastAction = action;
      this.dan = 1 - q[action]; this.brain.dopaminePulse(this.dan);
    }
    // Ask "what would you do here?" without disturbing the live input.
    peek(sense) {
      const keep = this.brain.channels.slice(), q0 = this.q.slice(), in0 = this.input.slice();
      const spikes = this.brain.lastSpike.slice(), tick = this.brain.tick;
      this.perceive(sense);
      const out = this.q.slice();
      this.brain.channels.set(keep); this.q.set(q0); this.input.set(in0);
      // hide the probe's spikes from the live display
      const ls = this.brain.lastSpike;
      for (let i = 0; i < ls.length; i++) if (ls[i] !== 0xffffffff && ls[i] >= tick) ls[i] = spikes[i];
      return out;
    }
  }

  class ConnectomeBrain {
    // wasmBytes: ArrayBuffer of flybrain.wasm; circuitBin: decompressed circuit.bin;
    // circuit: parsed circuit.json; cfg: features/actions from world.js.
    // opts.fullBin: decompressed fullbrain.bin → simulate the WHOLE connectome.
    static async create(wasmBytes, circuitBin, circuit, cfg, opts) {
      const { instance } = await WebAssembly.instantiate(wasmBytes, {});
      return new ConnectomeBrain(instance.exports, circuitBin, circuit, cfg, opts || {});
    }

    constructor(ex, bin, circuitRaw, cfg, opts) {
      this.ex = ex; this.age = 0;
      this.full = !!opts.fullBin;
      const full = this.full;
      let n, m, pO, pT, pC, pS, pR;
      if (!full) {
        // her learning circuit (circuit-local indices, 16-bit targets)
        const hdr = new Uint32Array(bin, 0, 3);
        if (hdr[0] !== 0x31434246) throw Error('Bad circuit file');
        n = hdr[1]; m = hdr[2];
        let o = 12;
        const offsets = new Uint32Array(bin.slice(o, o + (n + 1) * 4)); o += (n + 1) * 4;
        const targets16 = new Uint16Array(bin.slice(o, o + m * 2)); o += m * 2;
        const counts = new Uint8Array(bin, o, m); o += m;
        const sign = new Uint8Array(bin, o, n);
        pO = ex.fb_alloc_u32(n + 1); pT = ex.fb_alloc_u32(m); pC = ex.fb_alloc(m); pS = ex.fb_alloc(n); pR = ex.fb_alloc(n);
        const B = ex.memory.buffer;
        new Uint32Array(B, pO, n + 1).set(offsets);
        new Uint32Array(B, pT, m).set(targets16);
        new Uint8Array(B, pC, m).set(counts);
        new Uint8Array(B, pS, n).set(sign);
      } else {
        // the WHOLE MaleCNS connectome (brain-map indices, varint-packed targets)
        const fb = opts.fullBin, hdr = new Uint32Array(fb, 0, 5);
        if (hdr[0] !== 0x31574246) throw Error('Bad whole-brain file');
        n = hdr[1]; m = hdr[2];
        const degLen = hdr[3], tgtLen = hdr[4], u8 = new Uint8Array(fb);
        pO = ex.fb_alloc_u32(n + 1); pT = ex.fb_alloc_u32(m); pC = ex.fb_alloc(m); pS = ex.fb_alloc(n); pR = ex.fb_alloc(n);
        const B = ex.memory.buffer, off = new Uint32Array(B, pO, n + 1), tgt = new Uint32Array(B, pT, m);
        let q = 20;
        for (let i = 0; i < n; i++) { let v = 0, sh = 0, c; do { c = u8[q++]; v |= (c & 0x7f) << sh; sh += 7; } while (c & 0x80); off[i + 1] = off[i] + v; }
        q = 20 + degLen;
        for (let i = 0; i < n; i++) {
          let prev = 0;
          for (let k = off[i], end = off[i + 1]; k < end; k++) { let v = 0, sh = 0, c; do { c = u8[q++]; v |= (c & 0x7f) << sh; sh += 7; } while (c & 0x80); prev += v; tgt[k] = prev; }
        }
        q = 20 + degLen + tgtLen;
        new Uint8Array(B, pC, m).set(u8.subarray(q, q + m)); q += m;
        new Uint8Array(B, pS, n).set(u8.subarray(q, q + n));
      }
      // Circuit roles, re-indexed into simulation space (identical in circuit mode;
      // brain-map/global indices in whole-brain mode).
      const simIdx = circuitRaw.neurons.map((r, li) => (full ? r[0] : li));
      const map = (list) => list.map((li) => simIdx[li]);
      const circuit = Object.assign({}, circuitRaw, {
        simIdx,
        glomeruli: circuitRaw.glomeruli.map((g) => Object.assign({}, g, { idx: map(g.idx) })),
        readouts: { motor: circuitRaw.readouts.motor.map((r) => Object.assign({}, r, { idx: map(r.idx) })), social: circuitRaw.readouts.social.map((r) => Object.assign({}, r, { idx: map(r.idx) })) },
        dans: { PAM: map(circuitRaw.dans.PAM), PPL1: map(circuitRaw.dans.PPL1) },
        apl: map(circuitRaw.apl), dpm: map(circuitRaw.dpm),
      });
      this.circuit = circuit;
      this.n = n; this.m = m;
      const role = new Uint8Array(ex.memory.buffer, pR, n);
      role.fill(ROLE.OTHER);
      circuitRaw.neurons.forEach((r, li) => { role[simIdx[li]] = ROLE[r[5]]; });
      this.role = role.slice();
      ex.fb_init(n, m, pO, pT, pC, pS, pR, 12345);
      for (const [rs, rt, s] of [...PARAMS.scales, ...(full ? PARAMS.fullScales : [])]) ex.fb_set_role_scale(ROLE[rs], ROLE[rt], s);
      this.slow = full; // whole brain: perceive over several frames (beginPerceive / idle)

      this.motorActions = cfg.motorActions; this.socialActions = cfg.socialActions;
      const ro = circuit.readouts;
      this.readoutOf = new Int16Array(n).fill(-1);
      ro.motor.forEach((r, a) => r.idx.forEach((i) => { ex.fb_add_readout(i, a); this.readoutOf[i] = a; }));
      ro.social.forEach((r, a) => r.idx.forEach((i) => { ex.fb_add_readout(i, cfg.motorActions.length + a); this.readoutOf[i] = cfg.motorActions.length + a; }));
      ex.fb_finalize();
      ex.fb_set_plastic_gain(PARAMS.plasticGain);
      this.nPlastic = ex.fb_n_plastic();

      this.motor = new Lobe(this, 'motor', cfg.motorFeatures, cfg.motorActions, 0, 0);
      const nm = this.motor.nBins;
      this.social = new Lobe(this, 'social', cfg.socialFeatures, cfg.socialActions, cfg.motorActions.length, nm);
      if (nm + this.social.nBins > circuit.glomeruli.length) throw Error('Not enough glomeruli for the features');
      // per-neuron input channel: which feature bin drives this PN
      this.channelOf = new Int16Array(n).fill(-1);
      circuit.glomeruli.forEach((gl, k) => gl.idx.forEach((i) => { this.channelOf[i] = k; }));
      this.channels = new Float32Array(circuit.glomeruli.length);
      this.drivable = Int32Array.from(new Set([...circuit.glomeruli.flatMap((g) => g.idx), ...circuit.dans.PAM, ...circuit.dans.PPL1]));
      this.danBoost = { PAM: 0, PPL1: 0 };
      this.params = PARAMS;
    }

    mem() { return this.ex.memory; }
    view(Type, ptr, len) { return new Type(this.ex.memory.buffer, ptr, len); }
    get lastSpike() { return this.view(Uint32Array, this.ex.fb_last_spike_ptr(), this.n); }
    get win() { return this.view(Uint16Array, this.ex.fb_win_ptr(), this.n); }
    get v() { return this.view(Float32Array, this.ex.fb_v_ptr(), this.n); }
    get tick() { return this.ex.fb_tick(); }

    // Write PN (+ dopamine) rates into the simulator.
    writeRates() {
      // only her sense (PN) and dopamine neurons are ever driven, so only touch those
      const rates = this.view(Float32Array, this.ex.fb_rates_ptr(), this.n);
      const ch = this.channels, maxR = PARAMS.maxRate;
      for (const i of this.drivable) { const c = this.channelOf[i]; rates[i] = c >= 0 ? ch[c] * maxR : 0; }
      if (this.danBoost.PAM > 0) for (const i of this.circuit.dans.PAM) rates[i] += this.danBoost.PAM;
      if (this.danBoost.PPL1 > 0) for (const i of this.circuit.dans.PPL1) rates[i] += this.danBoost.PPL1;
      this.ex.fb_rates_changed();
    }

    // Whole brain: start a perception and let idle() run its window over frames.
    beginPerceive(lobe, sense) {
      encode(lobe.features, sense, lobe.pn);
      this.channels.fill(0);
      this.channels.set(lobe.pn, lobe.glomFirst);
      this.ex.fb_quiet();
      this.writeRates();
      this.ex.fb_begin_window();
      this.activeLobe = lobe;
      this.pending = { lobe, left: PARAMS.window };
    }
    // The finished perception's lobe (readout done), or null while still thinking.
    takePerception() {
      const p = this.pending;
      if (!p || p.left > 0) return null;
      this.pending = null;
      return p.lobe;
    }

    // Light up one lobe's glomeruli, silence the other's, and run a window.
    present(lobe) {
      this.pending = null; // a synchronous perception replaces any in-progress one
      this.channels.fill(0);
      this.channels.set(lobe.pn, lobe.glomFirst);
      this.ex.fb_quiet();
      this.writeRates();
      this.ex.fb_begin_window();
      this.ex.fb_run(PARAMS.window);
      this.activeLobe = lobe;
    }

    // Keep the circuit ticking between decisions (for the live display).
    idle(steps) {
      if (this.danBoost.PAM > 0 || this.danBoost.PPL1 > 0) {
        this.danBoost.PAM *= 0.9; this.danBoost.PPL1 *= 0.9;
        if (this.danBoost.PAM < 5) this.danBoost.PAM = 0;
        if (this.danBoost.PPL1 < 5) this.danBoost.PPL1 = 0;
      }
      this.writeRates();
      const p = this.pending;
      if (p && p.left > 0) {
        const k = Math.min(steps, p.left);
        const n = this.ex.fb_run(k);
        p.left -= k;
        if (p.left === 0) p.lobe.readout(false);
        return n;
      }
      return this.ex.fb_run(steps);
    }

    // Reward → PAM cluster fires; punishment → PPL1 fires (visual + real circuit effect).
    dopaminePulse(delta) {
      if (delta > 0.02) this.danBoost.PAM = Math.min(300, 120 + delta * 200);
      else if (delta < -0.02) this.danBoost.PPL1 = Math.min(300, 120 - delta * 200);
    }

    reset() { this.ex.fb_reset_weights(); this.age = 0; this.motor.prevAction = -1; this.social.snap = null; }
    toJSON() {
      const th = this.view(Float32Array, this.ex.fb_theta_ptr(), this.nPlastic);
      return { format: 'fly-buddy-connectome', version: 2, dataset: this.circuit.dataset, n: this.n, edges: this.m, plastic: this.nPlastic, age: this.age, theta: f32ToB64(th.slice()) };
    }
    load(o) {
      if (!o || o.format !== 'fly-buddy-connectome') throw Error('Not a Fruity OL brain file');
      if (o.plastic !== this.nPlastic) throw Error('This brain file was made for a different circuit');
      const th = b64ToF32(o.theta);
      this.view(Float32Array, this.ex.fb_theta_ptr(), this.nPlastic).set(th);
      this.age = o.age || 0;
      this.motor.resetEpisode();
    }
  }

  G.ConnectomeBrain = ConnectomeBrain;
  G.FLYBRAIN_ROLE = ROLE;
})(globalThis);
