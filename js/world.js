/* world.js — the office-life simulation. No DOM, so it also runs headless
 * (dream training in a worker, node tests).
 *
 * Day cycle:  morning (home) → work hours (office, 2 min) → rest hours (home,
 * action points) → bed → next day.
 * Work: documents arrive in the inbox. Important ones must be copied AND signed,
 * then filed in the out-tray. Memos must be shredded. Energy drains while she
 * works; coffee refills it; when tired she moves very slowly. */
(function (G) {
  'use strict';

  const MOTOR_ACTIONS = [
    { id: 'rest',   label: 'Rest',          icon: '💤' },
    { id: 'wander', label: 'Wander',        icon: '🚶' },
    { id: 'take',   label: 'Take document', icon: '📥' },
    { id: 'copy',   label: 'Copy',          icon: '🖨️' },
    { id: 'sign',   label: 'Sign',          icon: '✍️' },
    { id: 'shred',  label: 'Shred',         icon: '🗑️' },
    { id: 'file',   label: 'File it',       icon: '📤' },
    { id: 'coffee', label: 'Coffee',        icon: '☕' },
    { id: 'follow', label: 'Follow cursor', icon: '👆' },
  ];
  const SOCIAL_ACTIONS = [
    { id: 'giggle', label: 'Happy',   icon: '😊' },
    { id: 'shy',    label: 'Shy',     icon: '😳' },
    { id: 'pout',   label: 'Pout',    icon: '😤' },
    { id: 'cry',    label: 'Cry',     icon: '😭' },
    { id: 'love',   label: 'Love it', icon: '💕' },
    { id: 'shock',  label: 'Shocked', icon: '😶' },
  ];
  // Ordered by importance: the first features get the biggest real glomeruli.
  // A plain 2-bin feature only drives its "yes" glomerulus; `both` drives one
  // glomerulus for yes and one for no. `quiet` = value at which it falls silent.
  const MOTOR_FEATURES = [
    { key: 'holding',    bins: 2, label: 'holding a document', both: true, gain: 0.7 },
    { key: 'important',  bins: 2, label: 'it is important', gain: 2.2 },
    { key: 'memo',       bins: 2, label: 'it is a memo', gain: 2.2 },
    { key: 'copied',     bins: 2, label: 'already copied', gain: 2.2 },
    { key: 'signed',     bins: 2, label: 'already signed', gain: 2.2 },
    { key: 'inbox',      bins: 2, label: 'documents waiting', both: true },
    { key: 'energy',     bins: 4, label: 'energy' },
    { key: 'atOffice',   bins: 2, label: 'at the office', both: true },
    { key: 'cursorNear', bins: 4, label: 'cursor nearby', quiet: 0 },
    { key: 'affection',  bins: 3, label: 'affection' },
  ];
  const SOCIAL_FEATURES = [
    { key: 'pet',       bins: 2, label: 'head pat', gain: 1.8 },
    { key: 'scold',     bins: 2, label: 'scolded', gain: 1.8 },
    { key: 'food',      bins: 2, label: 'given food', gain: 1.8 },
    { key: 'affection', bins: 3, label: 'affection', gain: 0.8 },
    { key: 'energy',    bins: 3, label: 'energy', gain: 0.6 },
    { key: 'streak',    bins: 3, label: 'again and again', quiet: 0 },
  ];

  const W = 960, H = 540;
  const FLOOR = { x0: 60, x1: 900, y0: 300, y1: 515 };
  // Where she stands to use each thing (office), and what each thing is for.
  const OFFICE = {
    copier:  { x: 150, y: 372, action: 'copy',   label: 'Copy machine' },
    shredder:{ x: 360, y: 335, action: 'shred',  label: 'Paper shredder' },
    coffee:  { x: 820, y: 352, action: 'coffee', label: 'Coffee maker' },
    inbox:   { x: 390, y: 432, action: 'take',   label: 'Inbox' },
    out:     { x: 530, y: 432, action: 'file',   label: 'Out-tray' },
    sign:    { x: 665, y: 432, action: 'sign',   label: 'Sign zone' },
  };
  const HOME = {
    door: { x: 880, y: 360 }, bed: { x: 170, y: 380 }, sofa: { x: 470, y: 380 }, table: { x: 700, y: 420 },
  };
  const PHASE_LEN = { morning: 15, work: 120, night: 3 };
  const USE_TIME = { take: 0.5, copy: 1.4, sign: 1.0, shred: 1.2, file: 0.6, coffee: 2.6 };
  const SPEED = 150;
  // Auto-rewards (dopamine) and pay
  const R = {
    step: -0.01, wastedTrip: -0.1, take: 0.2, copyOk: 0.3, signOk: 0.3, wasted: -0.2, again: -0.1,
    done: 1, shredOk: 1, shredImportant: -1, rejected: -0.7, coffeeLow: 1.2, coffeeHigh: -0.15,
    followLove: 0.04,
  };
  const PAY = { important: 120, memo: 60, shredImportant: -100, wasted: -5 };
  const SHOP = {
    food: [
      { id: 'cookie', name: 'Cookie', icon: '🍪', price: 30, affection: 6, energy: 0.05 },
      { id: 'onigiri', name: 'Onigiri', icon: '🍙', price: 60, affection: 8, energy: 0.25 },
      { id: 'bento', name: 'Bento', icon: '🍱', price: 120, affection: 12, energy: 0.5 },
      { id: 'cake', name: 'Strawberry cake', icon: '🍰', price: 200, affection: 25, energy: 0.2 },
    ],
    furniture: [
      { id: 'bed', name: 'Cozy bed', icon: '🛏️', price: 500, desc: '+25% energy after sleeping' },
      { id: 'sofa', name: 'Sofa', icon: '🛋️', price: 400, desc: '+1 action point every evening' },
      { id: 'plant', name: 'Potted plant', icon: '🪴', price: 150, desc: '+3 affection every day' },
      { id: 'rug', name: 'Fluffy rug', icon: '🧶', price: 200, desc: '+2 affection every day' },
      { id: 'shelf', name: 'Bookshelf', icon: '📚', price: 300, desc: '+10% pay per document' },
      { id: 'lamp', name: 'Night lamp', icon: '🪔', price: 250, desc: '+1 affection per head pat' },
    ],
  };

  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function depthScale(y) { return 0.86 + 0.22 * ((y - FLOOR.y0) / (FLOOR.y1 - FLOOR.y0)); }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const LINES = {
    giggle: ['ehehe~', 'hehe ♪', 'thank you~'], shy: ['w-wha…', 'uu… ///', 'not here…'], pout: ['hmph!', 'meanie…', 'I was trying!'],
    cry: ['uwaah…', 'sorry…', '*sniff*'], love: ['♥', 'more please~', 'I like you ♥'], shock: ['…!?', 'eh?!', '*freeze*'],
  };

  class World {
    constructor(brain, opts) {
      opts = opts || {};
      this.brain = brain;
      this.headless = !!opts.headless;
      // 'game' = full day cycle; 'shift' = endless work shifts (dream training)
      this.mode = opts.mode || 'game';
      this.time = 0;
      this.settings = Object.assign({
        autoReward: true, temp: 0.12, socialTemp: 0.15,
        lr: 0.15, socialLr: 0.4, gamma: 0.9, lambda: 0.7, decision: 0.35,
      }, opts.settings || {});
      this.buddy = {
        x: 300, y: 400, vx: 0, vy: 0, face: 1, t: 0, moving: false, walk: 0,
        action: 0, decT: 0, wanderT: 0, wx: 300, wy: 400, idleT: 0,
        held: null, busy: null, commitT: 0, react: null, reactT: 0, reactDur: 1, expr: null, exprT: 0, say: null,
        energy: 1, streak: 0, lastTouchT: -99, lifted: false,
      };
      this.cursor = { x: -999, y: -999, in: false };
      this.money = 1000;
      this.affection = 35;
      this.day = 1;
      this.phase = this.mode === 'shift' ? 'work' : 'morning';
      this.phaseT = 0;
      this.scene = this.mode === 'shift' ? 'office' : 'home';
      this.ap = 0;
      this.apUsed = 0;
      this.inventory = { cookie: 2 };
      this.furniture = new Set();
      this.docs = [];
      this.nextDocT = 2;
      this.nextDocId = 1;
      this.hints = [];
      this.events = [];
      this.pendingReward = 0;
      this.lastSocial = null;
      this.today = this.newDayStats();
      this.yesterday = null;
      this.stats = { done: 0, shredded: 0, mistakes: 0, coffees: 0, treats: 0, scolds: 0, pets: 0, decisions: 0, rewardHist: [], winR: 0, winN: 0 };
      if (this.scene === 'office') this.enterOffice(true); else this.placeAtHome('bed');
    }

    newDayStats() { return { done: 0, shredded: 0, mistakes: 0, earned: 0, coffees: 0 }; }
    emit(type, data) { if (!this.headless) this.events.push(Object.assign({ type }, data || {})); }
    inbox() { return this.docs.filter((d) => d.state === 'inbox'); }

    // ---------- day cycle ----------
    clock() {
      // morning 07:00–09:00, work 09:00–17:00, rest 17:00 → (advances with action points)
      const f = this.phase === 'morning' ? this.phaseT / PHASE_LEN.morning : this.phase === 'work' ? this.phaseT / PHASE_LEN.work : 0;
      let mins = this.phase === 'morning' ? 7 * 60 + f * 120 : this.phase === 'work' ? 9 * 60 + f * 480 : this.phase === 'rest' ? 17 * 60 + this.apUsed * 80 : 23 * 60;
      mins = Math.min(mins, 23 * 60 + 59);
      return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
    }
    setPhase(p) {
      this.phase = p; this.phaseT = 0;
      this.emit('phase', { phase: p });
      if (p === 'rest') this.startRest();
    }
    goToOffice() {
      if (this.phase !== 'work' || this.scene === 'office') return false;
      this.enterOffice(false);
      return true;
    }
    enterOffice(first) {
      this.scene = 'office';
      const b = this.buddy;
      b.x = 880; b.y = 410; b.held = null; b.busy = null; b.react = null; b.vx = b.vy = 0;
      this.docs = [];
      for (let i = 0; i < 3; i++) this.spawnDoc();
      this.nextDocT = 4;
      this.brain.motor.resetEpisode();
      if (!first) this.emit('scene', { scene: 'office' });
    }
    placeAtHome(where) {
      this.scene = 'home';
      const b = this.buddy, p = HOME[where] || HOME.sofa;
      b.x = p.x; b.y = p.y + 10; b.held = null; b.busy = null; b.vx = b.vy = 0;
      this.docs = [];
      this.brain.motor.resetEpisode();
    }
    startRest() {
      this.placeAtHome('door');
      this.ap = 3 + (this.furniture.has('sofa') ? 1 : 0);
      this.apUsed = 0;
      // compare today's work with yesterday: more done → treat, fewer → scold
      const t = this.today, y = this.yesterday, score = (d) => d.done + d.shredded;
      let verdict = 'first';
      if (y) verdict = score(t) > score(y) ? 'better' : score(t) < score(y) ? 'worse' : 'same';
      if (verdict === 'better') { this.brain.motor.roundReward(1); this.addAffection(3); }
      if (verdict === 'worse') this.brain.motor.roundReward(-1);
      this.emit('dayReport', { today: Object.assign({}, t), yesterday: y, verdict, day: this.day });
      this.yesterday = t;
      this.emit('scene', { scene: 'home' });
    }
    goToBed() {
      if (this.phase !== 'rest') return false;
      this.setPhase('night');
      return true;
    }
    startDay() {
      this.day++;
      const b = this.buddy;
      b.energy = clamp(0.75 + (this.furniture.has('bed') ? 0.25 : 0), 0, 1);
      if (this.furniture.has('plant')) this.addAffection(3);
      if (this.furniture.has('rug')) this.addAffection(2);
      this.today = this.newDayStats();
      this.placeAtHome('bed');
      this.setPhase('morning');
      this.brain.motor.roundStart();
    }
    spendAP() {
      if (this.phase !== 'rest') return true; // free outside rest hours
      if (this.ap <= 0) { this.emit('noAP'); return false; }
      this.ap--; this.apUsed++;
      return true;
    }

    // ---------- documents ----------
    spawnDoc() {
      if (this.inbox().length >= 5) return;
      this.docs.push({ id: this.nextDocId++, kind: Math.random() < 0.5 ? 'important' : 'memo', state: 'inbox', copied: false, signed: false });
    }

    // ---------- senses ----------
    sense() {
      const b = this.buddy, c = this.cursor, d = b.held;
      const cd = c.in ? dist(b.x, b.y, c.x, clamp(c.y + 60, FLOOR.y0, FLOOR.y1)) : 1e9;
      return {
        holding: !!d,
        important: !!d && d.kind === 'important',
        memo: !!d && d.kind === 'memo',
        copied: !!d && d.copied,
        signed: !!d && d.signed,
        inbox: this.scene === 'office' && this.inbox().length > 0,
        energy: b.energy,
        atOffice: this.scene === 'office',
        cursorNear: 1 - Math.min(1, cd / 400),
        affection: this.affection / 100,
      };
    }

    // ---------- main loop ----------
    step(dt) {
      const b = this.buddy, s = this.settings;
      this.time += dt; b.t += dt; this.phaseT += dt;
      if (b.exprT > 0) { b.exprT -= dt; if (b.exprT <= 0) b.expr = null; }
      if (b.say) { b.say.t -= dt; if (b.say.t <= 0) b.say = null; }
      this.hints = this.hints.filter((h) => (h.t -= dt) > 0);

      // phases
      if (this.mode === 'game') {
        if (this.phase === 'morning' && this.phaseT >= PHASE_LEN.morning) this.setPhase('work');
        else if (this.phase === 'work') {
          if (this.scene === 'home' && this.phaseT > 12) this.goToOffice(); // she goes on her own if you forget
          if (this.phaseT >= PHASE_LEN.work) this.setPhase('rest');
        } else if (this.phase === 'night' && this.phaseT >= PHASE_LEN.night) this.startDay();
      } else if (this.phaseT >= PHASE_LEN.work) {
        // endless shifts for dream training, with a night's sleep in between
        this.phaseT = 0; b.energy = 0.85; this.enterOffice(true); this.brain.motor.roundStart();
      }

      // office: documents keep coming, energy drains
      if (this.scene === 'office' && this.phase === 'work') {
        this.nextDocT -= dt;
        if (this.nextDocT <= 0) { this.spawnDoc(); this.nextDocT = 5 + Math.random() * 4; }
        b.energy = clamp(b.energy - dt * (b.moving ? 0.0085 : 0.005), 0, 1);
      } else if (MOTOR_ACTIONS[b.action].id === 'rest' && !b.moving) b.energy = clamp(b.energy + dt * 0.01, 0, 1);

      if (this.phase === 'night' || b.lifted) { b.vx = b.vy = 0; }
      else if (b.busy) this.updateBusy(dt);
      else if (b.react) this.updateReaction(dt);
      else {
        // work actions are commitments: walk there and use it, then decide again
        if (b.commitT > 0) b.commitT -= dt;
        else {
          b.decT -= dt;
          // (whole brain: perceiving already takes ~0.4 s, so think again right away)
          if (b.decT <= 0 && this.decide() !== false) b.decT = this.brain.slow ? 0 : s.decision;
        }
        this.updateMotor(dt);
      }

      b.x = clamp(b.x + b.vx * dt, FLOOR.x0, FLOOR.x1);
      b.y = clamp(b.y + b.vy * dt, FLOOR.y0, FLOOR.y1);
      const sp = Math.hypot(b.vx, b.vy);
      b.moving = sp > 15;
      if (b.moving) { b.walk += dt * sp * 0.022; if (Math.abs(b.vx) > 10) b.face = b.vx > 0 ? 1 : -1; b.turnT = 0; }
      else if (!b.busy && this.cursor.in && this.phase !== 'night') {
        // standing still: turn her whole body toward your cursor if it stays on her other side
        const c = this.cursor, want = c.x > b.x ? 1 : -1;
        if (want !== b.face && Math.abs(c.x - b.x) > 50) { b.turnT = (b.turnT || 0) + dt; if (b.turnT > 0.45) { b.face = want; b.turnT = 0; } }
        else b.turnT = 0;
      }
    }

    logReward(r) {
      const st = this.stats;
      st.winR += r; st.winN++;
      if (st.winN >= 30) { st.rewardHist.push(st.winR / st.winN); if (st.rewardHist.length > 120) st.rewardHist.shift(); st.winR = 0; st.winN = 0; }
    }

    // Returns false while a slow (whole-brain) perception is still running.
    decide() {
      const m = this.brain.motor, s = this.settings;
      const sense = this.sense();
      if (this.brain.slow) {
        if (!this.brain.pending) { this.brain.beginPerceive(m, sense); return false; }
        if (!this.brain.takePerception()) return false; // still thinking
      } else m.perceive(sense);
      let r = this.pendingReward; this.pendingReward = 0;
      if (s.autoReward && this.scene === 'office') r += R.step;
      // when she loves you, being near your cursor feels rewarding (at home)
      if (this.scene === 'home' && this.affection >= 50 && this.cursor.in && sense.cursorNear > 0.6) r += R.followLove * ((this.affection - 50) / 50) * 2;
      m.tdStep(r, s);
      this.logReward(r);
      this.doAction(m.choose(s.temp));
    }

    doAction(a) {
      const b = this.buddy;
      this.brain.motor.commit(a);
      b.action = a; this.stats.decisions++; this.brain.age++;
      const id = MOTOR_ACTIONS[a].id;
      b.commitT = this.scene === 'office' && Object.values(OFFICE).some((o) => o.action === id) ? 12 : 0;
    }

    speed() {
      const e = this.buddy.energy;
      const tired = e < 0.15 ? 0.25 : e < 0.3 ? 0.4 : e < 0.45 ? 0.75 : 1;
      return SPEED * tired * (0.9 + this.affection / 1000);
    }

    updateMotor(dt) {
      const b = this.buddy, c = this.cursor, id = MOTOR_ACTIONS[b.action].id;
      let tx = null, ty = null, stop = 6, spd = this.speed();
      const obj = this.scene === 'office' ? Object.values(OFFICE).find((o) => o.action === id) : null;
      if (obj) { tx = obj.x; ty = obj.y; }
      else if (id === 'wander') {
        b.wanderT -= dt;
        if (b.wanderT <= 0 || dist(b.x, b.y, b.wx, b.wy) < 14) {
          b.wx = FLOOR.x0 + 40 + Math.random() * (FLOOR.x1 - FLOOR.x0 - 80); b.wy = FLOOR.y0 + 10 + Math.random() * (FLOOR.y1 - FLOOR.y0 - 20); b.wanderT = 3;
        }
        tx = b.wx; ty = b.wy; spd *= 0.6;
      } else if (id === 'follow' && c.in) { tx = c.x; ty = clamp(c.y + 60, FLOOR.y0, FLOOR.y1); stop = 50; }
      let vx = 0, vy = 0;
      if (tx !== null) {
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        if (d > stop) { vx = (dx / d) * spd; vy = (dy / d) * spd * 0.85; }
        else if (obj) { this.arrive(id, obj); return; }
      }
      const k = Math.min(1, dt * 10);
      b.vx += (vx - b.vx) * k; b.vy += (vy - b.vy) * k;
      b.idleT = id === 'rest' ? b.idleT + dt : 0;
    }

    // She reached the object of her current action: try to use it.
    arrive(id, obj) {
      const b = this.buddy, d = b.held;
      b.vx = b.vy = 0;
      const can = id === 'take' ? !d && this.inbox().length > 0 : id === 'coffee' ? true : !!d;
      if (!can) {
        // nothing to do here: a wasted trip
        if (b.commitT > 0) { this.reward(R.wastedTrip); b.commitT = 0; b.decT = 0; }
        return;
      }
      b.busy = { id, t: 0, dur: USE_TIME[id] * (b.energy < 0.3 ? 1.5 : 1) };
      if (id !== 'coffee') b.energy = clamp(b.energy - 0.02, 0, 1);
      if (id === 'coffee' || id === 'copy' || id === 'shred') b.face = obj.x >= b.x ? 1 : -1;
      this.emit('use', { id });
    }

    updateBusy(dt) {
      const b = this.buddy;
      b.vx = b.vy = 0;
      b.busy.t += dt;
      if (b.busy.t >= b.busy.dur) { const id = b.busy.id; b.busy = null; b.commitT = 0; this.finishUse(id); b.decT = 0; }
    }

    reward(r) { if (this.settings.autoReward) this.pendingReward += r; }
    pay(amount) {
      const bonus = amount > 0 && this.furniture.has('shelf') ? Math.round(amount * 0.1) : 0;
      this.money += amount + bonus; this.today.earned += amount + bonus;
      return amount + bonus;
    }

    finishUse(id) {
      const b = this.buddy, d = b.held;
      const o = Object.values(OFFICE).find((x) => x.action === id), at = { x: o.x, y: o.y };
      switch (id) {
        case 'take': {
          const doc = this.inbox()[0]; if (!doc) return;
          doc.state = 'held'; b.held = doc; this.reward(R.take);
          this.emit('take', { kind: doc.kind, ...at });
          break;
        }
        case 'copy':
          if (d.kind === 'memo') { this.reward(R.wasted); this.pay(PAY.wasted); this.emit('oops', { text: 'copied a memo (wasted paper)', ...at }); }
          else if (d.copied) { this.reward(R.again); this.emit('oops', { text: 'already copied', ...at }); }
          else { d.copied = true; this.reward(R.copyOk); this.emit('progress', { text: 'copied ✓', ...at }); }
          break;
        case 'sign':
          if (d.kind === 'memo') { this.reward(R.wasted); this.emit('oops', { text: 'memos need no signature', ...at }); }
          else if (d.signed) { this.reward(R.again); this.emit('oops', { text: 'already signed', ...at }); }
          else { d.signed = true; this.reward(R.signOk); this.emit('progress', { text: 'signed ✓', ...at }); }
          break;
        case 'shred':
          b.held = null; d.state = 'shredded';
          if (d.kind === 'memo') {
            const p = this.pay(PAY.memo); this.reward(R.shredOk); this.stats.shredded++; this.today.shredded++;
            this.emit('success', { text: `memo shredded +${p}฿`, money: p, ...at });
          } else {
            this.pay(PAY.shredImportant); this.reward(R.shredImportant); this.stats.mistakes++; this.today.mistakes++;
            b.expr = 'shock'; b.exprT = 1.6; this.say('n-no! that was important!');
            this.emit('fail', { text: `shredded an important document ${PAY.shredImportant}฿`, money: PAY.shredImportant, ...at });
          }
          break;
        case 'file':
          if (d.kind === 'important' && d.copied && d.signed) {
            b.held = null; d.state = 'done';
            const p = this.pay(PAY.important); this.reward(R.done); this.stats.done++; this.today.done++;
            b.expr = 'happy'; b.exprT = 1.2;
            this.emit('success', { text: `filed! +${p}฿`, money: p, ...at });
          } else {
            this.reward(R.rejected); this.stats.mistakes++; this.today.mistakes++;
            const why = d.kind === 'memo' ? 'memos go to the shredder' : !d.copied && !d.signed ? 'needs a copy and a signature' : !d.copied ? 'needs a copy' : 'needs a signature';
            this.say('ah… ' + why); this.emit('oops', { text: why, ...at });
          }
          break;
        case 'coffee': {
          const before = b.energy;
          this.reward(before < 0.5 ? R.coffeeLow * (1 - before) : R.coffeeHigh);
          b.energy = 1; this.stats.coffees++; this.today.coffees++;
          this.emit('progress', { text: '☕ energy full', ...at });
          break;
        }
      }
    }
    say(text) { this.buddy.say = { text, t: 1.8 }; }

    // ---------- player: hints, feedback, care ----------
    // Clicking a machine "points" at it: a supervised lesson for that action here.
    hint(objKey) {
      const o = OFFICE[objKey]; if (!o || this.scene !== 'office') return false;
      const a = MOTOR_ACTIONS.findIndex((x) => x.id === o.action);
      this.hints.push({ key: objKey, t: 1.5 });
      return this.teachMotor(a);
    }
    teachMotor(a) {
      const b = this.buddy;
      if (b.react || b.busy || this.phase === 'night') return false;
      const m = this.brain.motor;
      m.perceive(this.sense());
      m.teach(a, 0.8);
      this.doAction(a);
      this.emit('learn', { lobe: 'motor', r: 1, teach: true });
      return true;
    }
    // treat / scold: trains her last reaction if one is fresh, otherwise what she's doing
    feedback(r) {
      const b = this.buddy, ls = this.lastSocial;
      if (r > 0) this.stats.treats++; else this.stats.scolds++;
      this.addAffection(r > 0 ? 2 : -6);
      if (ls && this.time - ls.t < 5) {
        this.brain.social.feedback(r, this.settings.socialLr);
        this.emit('learn', { lobe: 'social', r });
        return 'social';
      }
      this.pendingReward += r;
      if (!b.react) { b.expr = r > 0 ? 'happy' : 'sad'; b.exprT = 1.0; }
      this.emit('learn', { lobe: 'motor', r });
      return 'motor';
    }
    reward1() { if (this.phase === 'night' || !this.spendAP()) return false; this.feedback(1); return true; }
    scold() {
      if (this.phase === 'night') return false;
      if (this.feedback(-1) === 'motor') this.respond('scold');
      return true;
    }
    pet() {
      const b = this.buddy;
      if (this.phase === 'night' || b.busy || !this.spendAP()) return false;
      b.streak = this.time - b.lastTouchT < 6 ? b.streak + 1 : 0; b.lastTouchT = this.time;
      this.stats.pets++;
      this.addAffection(Math.max(1, 5 - b.streak) + (this.furniture.has('lamp') ? 1 : 0));
      this.emit('pet');
      this.respond('pet');
      return true;
    }
    feed(foodId) {
      const f = SHOP.food.find((x) => x.id === foodId);
      if (!f || !this.inventory[foodId] || this.phase === 'night' || this.buddy.busy) return false;
      if (!this.spendAP()) return false;
      this.inventory[foodId]--;
      const b = this.buddy;
      b.energy = clamp(b.energy + f.energy, 0, 1);
      this.addAffection(f.affection);
      this.emit('feed', { icon: f.icon });
      this.respond('food');
      return true;
    }
    buy(itemId) {
      const it = [...SHOP.food, ...SHOP.furniture].find((x) => x.id === itemId);
      if (!it || this.money < it.price) return false;
      const isFurn = SHOP.furniture.includes(it);
      if (isFurn && this.furniture.has(it.id)) return false;
      this.money -= it.price;
      if (isFurn) this.furniture.add(it.id); else this.inventory[it.id] = (this.inventory[it.id] || 0) + 1;
      this.emit('buy', { item: it });
      return true;
    }
    addAffection(v) { this.affection = clamp(this.affection + v, 0, 100); }

    respond(kind) {
      const b = this.buddy, so = this.brain.social;
      const ctx = { pet: kind === 'pet', scold: kind === 'scold', food: kind === 'food', affection: this.affection / 100, energy: b.energy, streak: Math.min(1, b.streak / 3) };
      so.perceive(ctx);
      const a = so.choose(this.settings.socialTemp);
      so.snapshot(a);
      this.lastSocial = { kind, ctx, action: a, t: this.time };
      this.startReaction(a);
    }
    startReaction(a) {
      const b = this.buddy, id = SOCIAL_ACTIONS[a].id;
      b.react = id; b.reactT = b.reactDur = id === 'cry' ? 2.2 : 1.8;
      b.vx *= 0.2; b.vy *= 0.2;
      this.say(pick(LINES[id]));
      if (id === 'love' || id === 'giggle') this.addAffection(1);
      this.emit('react', { id });
    }
    updateReaction(dt) {
      const b = this.buddy;
      b.reactT -= dt; b.vx *= 0.8; b.vy *= 0.8;
      if (b.reactT <= 0) { b.react = null; b.decT = 0; }
    }
    teachSocial(a) {
      const ls = this.lastSocial;
      if (!ls) return false;
      this.brain.social.teachSnap(a, 0.6);
      ls.action = a; ls.t = this.time;
      this.startReaction(a);
      this.emit('learn', { lobe: 'social', r: 1, teach: true });
      return true;
    }
    headPos() {
      const b = this.buddy, sc = depthScale(b.y);
      return { x: b.x, y: b.y - 150 * sc, r: 46 * sc, sc };
    }
  }

  G.World = World;
  G.mulberry32 = mulberry32;
  G.FB = { MOTOR_ACTIONS, SOCIAL_ACTIONS, MOTOR_FEATURES, SOCIAL_FEATURES, FLOOR, OFFICE, HOME, SHOP, PHASE_LEN, USE_TIME, REWARDS: R, PAY, W, H, depthScale, clamp, dist };
})(globalThis);
