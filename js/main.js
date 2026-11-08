/* main.js — boots the connectome brain, then runs her office life:
 * game screen (scene + HUD) and brain screen (brain map + training status). */
(async function () {
  'use strict';
  const { MOTOR_ACTIONS, SOCIAL_ACTIONS, MOTOR_FEATURES, SOCIAL_FEATURES, SHOP, PHASE_LEN, OFFICE } = FB;
  const STORE = 'flybuddy.v3';
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString();

  // ---------- load the connectome (asks before downloading) ----------
  const fmtB = BrainAssets.fmtBytes;
  const loadMsg = (t, f) => { $('loadText').textContent = t; if (f != null) $('loadBar').style.width = (f * 100).toFixed(0) + '%'; };
  // Brain size: 'circuit' (her learning circuit) or 'whole' (the whole connectome).
  const MODE_KEY = 'fruityol.brainMode';
  const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'whole' ? 'whole' : 'circuit'; } catch (e) { return 'circuit'; } };
  const writeMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* ignore */ } };

  // Download dialog: pick a brain size and see exact sizes; resolves with the chosen mode.
  function askToDownload(man, have, mode) {
    const render = () => {
      const md = document.querySelector('input[name=brainMode]:checked').value;
      const files = BrainAssets.filesFor(man, md), need = files.filter((f) => !have.has(f.path)), needBytes = need.reduce((t, f) => t + f.bytes, 0);
      $('dlTable').innerHTML = files.map((f) => `<tr><td>${f.label}</td><td>${have.has(f.path) ? '<span class="cached">on device ✓</span>' : fmtB(f.bytes)}</td></tr>`).join('')
        + `<tr class="total"><td>${need.length < files.length ? 'Left to download' : 'Total download'}</td><td>${fmtB(needBytes)}</td></tr>`;
      $('btnDownload').textContent = needBytes ? `🧠 Download her brain (${fmtB(needBytes)})` : '🧠 Wake her up';
    };
    $('sizeCircuit').textContent = fmtB(BrainAssets.bytesFor(man, 'circuit'));
    $('sizeWhole').textContent = fmtB(BrainAssets.bytesFor(man, 'whole'));
    document.querySelector(`input[name=brainMode][value=${mode}]`).checked = true;
    document.querySelectorAll('input[name=brainMode]').forEach((r) => r.addEventListener('change', render));
    render();
    $('loadTitle').textContent = 'Download her brain?';
    $('consent').hidden = false; $('progressBox').hidden = true;
    return new Promise((res) => $('btnDownload').addEventListener('click', () => {
      $('consent').hidden = true; $('progressBox').hidden = false; $('loadTitle').textContent = 'Ms. Fruity is waking up…';
      res(document.querySelector('input[name=brainMode]:checked').value);
    }, { once: true }));
  }
  let brain, mapData, circuit, wasmBytes, circuitBin, brainManifest, brainCached = false, brainMode = readMode();
  const brainCfg = { motorFeatures: MOTOR_FEATURES, motorActions: MOTOR_ACTIONS, socialFeatures: SOCIAL_FEATURES, socialActions: SOCIAL_ACTIONS };
  try {
    loadMsg('Checking for her brain on this device…', 0.02);
    brainManifest = await BrainAssets.manifest();
    const st = await BrainAssets.cachedState(brainManifest);
    if (BrainAssets.filesFor(brainManifest, brainMode).some((f) => !st.have.has(f.path))) brainMode = await askToDownload(brainManifest, st.have, brainMode);
    writeMode(brainMode);
    const files = await BrainAssets.load(brainManifest, st.cache, (done, total, f, cached) =>
      loadMsg(cached ? `Loading from this device: ${f.label}…` : `Downloading ${f.label}… ${fmtB(done)} / ${fmtB(total)}`, 0.05 + 0.6 * (done / total)), brainMode);
    brainCached = !!st.cache;
    const json = (buf) => JSON.parse(new TextDecoder().decode(buf));
    wasmBytes = files['data/flybrain.wasm'];
    circuitBin = await BrainAssets.gunzip(files['data/circuit.bin.gz']);
    circuit = json(files['data/circuit.json']);
    let opts = {};
    if (brainMode === 'whole') {
      loadMsg('Unpacking the whole connectome (25.6 million connections)…', 0.7);
      opts = { fullBin: await BrainAssets.gunzip(files['data/fullbrain.bin.gz']) };
    }
    loadMsg(brainMode === 'whole' ? 'Wiring 166,700 neurons into WebAssembly…' : `Wiring ${circuit.n.toLocaleString()} neurons · ${circuit.edges.toLocaleString()} connections into WebAssembly…`, 0.8);
    try { brain = await ConnectomeBrain.create(wasmBytes.slice(0), circuitBin.slice(0), circuit, brainCfg, opts); }
    catch (err) {
      if (brainMode !== 'whole') throw err;
      writeMode('circuit'); // e.g. not enough memory on this device: use the circuit next time
      throw Error(`the whole brain couldn't start on this device (${err.message}). Reload to use the learning circuit instead`);
    }
    opts = null;
    loadMsg('Mapping all 166,700 neurons of the fly CNS…', 0.9);
    const mapBin = await BrainAssets.gunzip(files['data/brainmap.bin.gz']), mapJson = json(files['data/brainmap.json']);
    const n = new Uint32Array(mapBin, 4, 1)[0];
    let o = 8;
    mapData = Object.assign(mapJson, { n });
    mapData.B = new Uint32Array(mapBin, o, n); o += 4 * n;
    mapData.U = new Uint16Array(mapBin, o, n); o += 2 * n;
    mapData.V = new Uint16Array(mapBin, o, n); o += 2 * n;
    mapData.T = new Uint16Array(mapBin, o, n); o += 2 * n;
    mapData.S = new Uint8Array(mapBin, o, n); o += n;
    mapData.C = new Uint8Array(mapBin, o, n);
    loadMsg('Ready!', 1);
  } catch (err) {
    console.error(err);
    $('consent').hidden = true; $('progressBox').hidden = false;
    const fileUrl = location.protocol === 'file:';
    loadMsg('Could not load her brain: ' + err.message + (fileUrl ? '. Open it from a web server or static host, not as a local file (e.g. node serve.js).' : ''), 0);
    return;
  }

  const world = new World(brain);
  const scene = new Scene($('stage'), world);

  // ---------- persistence ----------
  function snapshot() {
    return {
      brain: brain.toJSON(), settings: world.settings,
      game: { money: world.money, affection: world.affection, day: world.day, energy: world.buddy.energy, furniture: [...world.furniture], inventory: world.inventory, yesterday: world.yesterday, stats: world.stats },
    };
  }
  function restore(d) {
    if (d.brain) brain.load(d.brain);
    if (d.settings) Object.assign(world.settings, d.settings);
    const g = d.game;
    if (g) {
      world.money = g.money ?? world.money; world.affection = g.affection ?? world.affection; world.day = g.day ?? 1;
      world.buddy.energy = g.energy ?? 1; world.furniture = new Set(g.furniture || []); world.inventory = g.inventory || {};
      world.yesterday = g.yesterday || null; if (g.stats) Object.assign(world.stats, g.stats);
    }
  }
  let wiping = false;
  function saveLocal() { if (wiping) return false; try { localStorage.setItem(STORE, JSON.stringify(snapshot())); return true; } catch (e) { return false; } }
  let restored = false;
  try { const raw = localStorage.getItem(STORE); if (raw) { restore(JSON.parse(raw)); restored = true; } } catch (e) { console.warn('Could not restore save', e); }
  $('loading').classList.add('done');

  // ---------- screens ----------
  let screen = 'game';
  function showScreen(s) {
    screen = s;
    $('gameScreen').classList.toggle('on', s === 'game');
    $('brainScreen').classList.toggle('on', s === 'brain');
    if (s === 'brain') requestAnimationFrame(() => { brainTab === 'map' ? brainMap.resize() : circuitView.layout(); });
    else scene.resize();
  }
  $('btnBrain').addEventListener('click', () => showScreen('brain'));
  $('btnBack').addEventListener('click', () => showScreen('game'));
  window.addEventListener('resize', () => scene.resize());
  new ResizeObserver(() => scene.resize()).observe($('stageWrap'));

  // ---------- toast ----------
  let toastT = 0;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); toastT = 2; }

  // ---------- stage input: cursor + pointing at machines ----------
  const stage = $('stage');
  stage.addEventListener('pointermove', (e) => {
    const p = scene.toLogical(e);
    world.cursor.x = p.x; world.cursor.y = p.y; world.cursor.in = true;
    scene.hover = scene.objectAt(p.x, p.y);
    stage.style.cursor = scene.hover ? 'pointer' : 'default';
  });
  stage.addEventListener('pointerleave', () => { world.cursor.in = false; scene.hover = null; });
  stage.addEventListener('pointerdown', (e) => {
    const p = scene.toLogical(e), k = scene.objectAt(p.x, p.y);
    if (k) { if (!world.hint(k)) toast('She is busy right now'); return; }
    // clicking her head = a pat
    const h = world.headPos();
    if (Math.hypot(p.x - h.x, p.y - h.y) < h.r * 1.2) doPet();
  });

  // ---------- care buttons ----------
  function doPet() { if (!world.pet()) toast(world.phase === 'rest' && world.ap <= 0 ? 'No action points left' : 'Not now…'); }
  $('btnPet').addEventListener('click', doPet);
  $('btnScold').addEventListener('click', () => world.scold());
  $('btnReward').addEventListener('click', () => { if (!world.reward1()) toast('No action points left'); });
  $('btnFollow').addEventListener('click', () => {
    const a = MOTOR_ACTIONS.findIndex((x) => x.id === 'follow');
    if (!world.teachMotor(a)) toast('She is busy right now');
  });
  $('btnFeed').addEventListener('click', () => { renderFeed(); $('feedMenu').hidden = false; });
  $('btnGo').addEventListener('click', () => {
    if (world.phase === 'work' && world.scene === 'home') world.goToOffice();
    else if (world.phase === 'rest') world.goToBed();
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.modal').hidden = true; }));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) m.hidden = true; }));

  // ---------- shop & feeding ----------
  let shopTab = 'food';
  $('btnShop').addEventListener('click', () => { renderShop(); $('shop').hidden = false; });
  document.querySelectorAll('[data-shop]').forEach((b) => b.addEventListener('click', () => {
    shopTab = b.dataset.shop; document.querySelectorAll('[data-shop]').forEach((o) => o.classList.toggle('on', o === b)); renderShop();
  }));
  function renderShop() {
    $('shopMoney').textContent = fmt(world.money);
    const list = SHOP[shopTab];
    $('shopGrid').innerHTML = list.map((it) => {
      const owned = shopTab === 'furniture' && world.furniture.has(it.id);
      const desc = shopTab === 'food' ? `+${it.affection} affection · +${Math.round(it.energy * 100)}% energy<br>you have ${world.inventory[it.id] || 0}` : it.desc;
      return `<div class="item ${owned ? 'owned' : ''}"><span class="big">${it.icon}</span><b>${it.name}</b><small>${desc}</small>
        <button class="pill-btn" data-buy="${it.id}" ${owned || world.money < it.price ? 'disabled' : ''}>${owned ? 'Owned ✓' : `Buy · ${it.price}฿`}</button></div>`;
    }).join('');
    $('shopGrid').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => { if (world.buy(b.dataset.buy)) renderShop(); }));
  }
  function renderFeed() {
    const have = SHOP.food.filter((f) => world.inventory[f.id] > 0);
    $('feedGrid').innerHTML = have.length ? have.map((f) => `<div class="item"><span class="big">${f.icon}</span><b>${f.name} ×${world.inventory[f.id]}</b><small>+${f.affection} affection · +${Math.round(f.energy * 100)}% energy</small><button class="pill-btn" data-feed="${f.id}">Give</button></div>`).join('')
      : '<p class="hint">No food yet. Buy some in the shop 🎀</p>';
    $('feedGrid').querySelectorAll('[data-feed]').forEach((b) => b.addEventListener('click', () => {
      if (world.feed(b.dataset.feed)) $('feedMenu').hidden = true; else toast(world.phase === 'rest' && world.ap <= 0 ? 'No action points left' : 'Not now…');
    }));
  }

  // ---------- work-day report ----------
  function showReport(ev) {
    const t = ev.today, y = ev.yesterday, n = t.done + t.shredded;
    const rows = [['📤 Important documents filed', t.done], ['🗑️ Memos shredded', t.shredded], ['❌ Mistakes', t.mistakes], ['☕ Coffee breaks', t.coffees], ['💰 Earned today', `${fmt(t.earned)}฿`]];
    if (y) rows.push(['Yesterday', `${y.done + y.shredded} documents`]);
    const v = { better: `Better than yesterday (${n} documents)! She gets a treat 🍬, shared across everything she did today.`, worse: 'Fewer documents than yesterday… She gets scolded 👎, shared across today\'s choices.', same: 'Same as yesterday. Keep training her!', first: 'First day at work! Tomorrow is compared to today.' }[ev.verdict];
    $('reportTitle').textContent = `Day ${ev.day} · work report`;
    $('reportBody').innerHTML = rows.map(([a, b]) => `<div class="report-row"><span>${a}</span><b>${b}</b></div>`).join('') + `<div class="verdict ${ev.verdict}">${v}</div><p class="hint">Rest hours: spend your action points on her (pet, feed, reward) before bed.</p>`;
    $('report').hidden = false;
  }

  // ---------- brain screen ----------
  const ALL_ACTIONS = [...MOTOR_ACTIONS, ...SOCIAL_ACTIONS];
  const tip = $('neuronTip');
  const brainMap = new BrainViews.BrainMap($('brainMap'), tip, brain, brain.circuit, mapData, {
    actionName: (a) => ALL_ACTIONS[a].label,
  });
  const circuitView = new BrainViews.CircuitView($('brainCircuit'), tip, brain, brain.circuit, { motorActions: MOTOR_ACTIONS, socialActions: SOCIAL_ACTIONS });
  let brainTab = 'map';
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    brainTab = b.dataset.view;
    document.querySelectorAll('[data-view]').forEach((o) => o.classList.toggle('on', o === b));
    $('brainMap').hidden = brainTab !== 'map'; $('brainCircuit').hidden = brainTab !== 'circuit';
    document.querySelector('.legend').hidden = brainTab !== 'map';
    if (brainTab === 'circuit') circuitView.layout(); else brainMap.resize();
  }));

  const motorBtns = MOTOR_ACTIONS.map((a, i) => {
    const b = document.createElement('button');
    b.className = 'mbtn'; b.title = `Teach: ${a.label} (key ${i + 1})`;
    b.innerHTML = `<span class="k">${i + 1}</span><span class="ic">${a.icon}</span>${a.label}`;
    b.addEventListener('click', () => world.teachMotor(i));
    $('motorBtns').appendChild(b); return b;
  });
  const socialBtns = SOCIAL_ACTIONS.map((a, i) => {
    const b = document.createElement('button');
    b.className = 'mbtn'; b.title = `She should: ${a.label}`;
    b.innerHTML = `<span class="ic">${a.icon}</span>${a.label}`;
    b.addEventListener('click', () => { if (!world.teachSocial(i)) $('lastTouch').textContent = 'Pet, scold or feed her first!'; });
    $('socialBtns').appendChild(b); return b;
  });

  for (const [id, key] of [['sTemp', 'temp'], ['sLr', 'lr'], ['sLambda', 'lambda'], ['sSocialTemp', 'socialTemp']]) {
    const el = $(id), out = el.nextElementSibling;
    el.value = world.settings[key]; out.textContent = (+el.value).toFixed(2);
    el.addEventListener('input', () => { world.settings[key] = +el.value; out.textContent = (+el.value).toFixed(2); });
  }
  $('optAuto').checked = world.settings.autoReward;
  $('optAuto').addEventListener('change', (e) => { world.settings.autoReward = e.target.checked; });

  $('btnSave').addEventListener('click', () => { $('saveMsg').textContent = saveLocal() ? 'Saved to this browser ✓' : 'Could not save (storage blocked?)'; });
  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fruity-ol-day${world.day}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { restore(JSON.parse(await f.text())); $('saveMsg').textContent = 'Imported ✓'; }
    catch (err) { $('saveMsg').textContent = 'Import failed: ' + err.message; }
    e.target.value = '';
  });
  // Two-step confirm inside the page (native confirm() dialogs are blocked in
  // some embedded browsers, which made this button silently do nothing).
  let resetArmed = 0;
  $('btnReset').addEventListener('click', () => {
    const btn = $('btnReset');
    if (!resetArmed) {
      btn.textContent = '⚠️ Tap again to wipe everything';
      btn.classList.add('armed');
      $('saveMsg').textContent = 'This erases her brain, money, furniture and progress.';
      resetArmed = setTimeout(() => { resetArmed = 0; btn.textContent = '🧹 New game'; btn.classList.remove('armed'); $('saveMsg').textContent = ''; }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    wiping = true;
    try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
    btn.textContent = 'Starting over…';
    location.reload();
  });
  // downloaded brain model: where it lives, and how to remove it
  const modeBytes = BrainAssets.bytesFor(brainManifest, brainMode);
  $('brainStore').textContent = brainCached
    ? `Brain model: ${fmtB(modeBytes)} · stored on this device ✓`
    : `Brain model: ${fmtB(modeBytes)} · not stored (this browser blocks site storage), so it downloads each visit`;
  $('btnForgetBrain').addEventListener('click', async () => {
    await BrainAssets.clear();
    $('brainStore').textContent = `Downloaded brain removed (${fmtB(modeBytes)} freed). Next visit will ask before downloading it again.`;
    $('btnForgetBrain').disabled = true;
  });
  // brain size switch (restarts the page; progress is saved first)
  const MODE_TEXT = {
    circuit: `Running her <b>learning circuit</b>: ${brain.n.toLocaleString()} neurons, ${brain.m.toLocaleString()} connections. Fast and smooth. <br>Whole brain: all 166,700 neurons, ${fmtB(BrainAssets.bytesFor(brainManifest, 'whole'))} total download, ~140 MB memory.`,
    whole: `Running the <b>whole brain</b>: ${brain.n.toLocaleString()} neurons, ${brain.m.toLocaleString()} connections. She thinks ~0.4 s per decision; best on a desktop. What she learns works in both sizes.`,
  };
  $('modeInfo').innerHTML = MODE_TEXT[brainMode];
  let modeArmed = 0;
  document.querySelectorAll('#modeTabs [data-mode]').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === brainMode);
    b.addEventListener('click', () => {
      const target = b.dataset.mode;
      if (target === brainMode) return;
      if (modeArmed !== target) {
        modeArmed = target;
        document.querySelectorAll('#modeTabs [data-mode]').forEach((o) => o.classList.toggle('armed', o === b));
        $('modeInfo').innerHTML = `Tap again to switch to the ${target === 'whole' ? 'whole brain' : 'learning circuit'}. The page restarts and your progress is saved${target === 'whole' ? '; if it isn’t downloaded yet you’ll be asked first' : ''}.`;
        return;
      }
      saveLocal(); writeMode(target); location.reload();
    });
  });
  if (restored) $('saveMsg').textContent = `Welcome back. Day ${world.day} ✓`;

  // dream training in a worker
  let dreaming = false, worker = null, workerReady = null, dreamMinutes = 0;
  function getWorker() {
    if (worker) return workerReady;
    worker = new Worker('js/dream-worker.js');
    workerReady = new Promise((res) => worker.addEventListener('message', (e) => { if (e.data.type === 'ready') res(); }, { once: true }));
    worker.postMessage({ type: 'init', wasm: wasmBytes.slice(0), circuitBin: circuitBin.slice(0), circuit });
    worker.addEventListener('message', (e) => {
      const d = e.data;
      if (d.type === 'progress') {
        $('dreamBar').style.width = (d.done * 100).toFixed(1) + '%';
        $('dreamMsg').textContent = `Dreaming of work… ${d.done_} filed · ${d.shredded} shredded · ${d.mistakes} mistakes`;
      } else if (d.type === 'done') {
        dreaming = false; $('btnDream').disabled = false; $('dreamBar').style.width = '100%';
        brain.load(d.brain);
        $('dreamMsg').textContent = `Woke up! In ${dreamMinutes} dream-minutes she filed ${d.done_}, shredded ${d.shredded}, made ${d.mistakes} mistakes.`;
        world.buddy.say = { text: 'I dreamt about work…', t: 2 };
        saveLocal();
      }
    });
    return workerReady;
  }
  $('btnDream').addEventListener('click', async () => {
    if (dreaming) return;
    dreaming = true; $('btnDream').disabled = true; dreamMinutes = +$('dreamLen').value;
    $('dreamMsg').textContent = 'Falling asleep…'; $('dreamBar').style.width = '0%';
    await getWorker();
    worker.postMessage({ type: 'dream', minutes: dreamMinutes, brain: brain.toJSON(), settings: world.settings });
  });

  // "what she learned": one probe per tick (each is a real 30 ms simulation)
  const MBASE = { holding: 0, important: 0, memo: 0, copied: 0, signed: 0, inbox: 1, energy: 0.8, atOffice: 1, cursorNear: 0, affection: 0.4 };
  const SBASE = { pet: 0, scold: 0, food: 0, affection: 0.4, energy: 0.7, streak: 0 };
  const PROBES = [
    ['m', 'Hands empty, inbox full', {}],
    ['m', 'Holding a new important doc', { holding: 1, important: 1 }],
    ['m', '…important, copied', { holding: 1, important: 1, copied: 1 }],
    ['m', '…important, signed', { holding: 1, important: 1, signed: 1 }],
    ['m', '…important, copied + signed', { holding: 1, important: 1, copied: 1, signed: 1 }],
    ['m', 'Holding a memo', { holding: 1, memo: 1 }],
    ['m', 'Exhausted at work', { energy: 0.08 }],
    ['m', 'At home, you nearby, she loves you', { atOffice: 0, inbox: 0, cursorNear: 0.9, affection: 0.9 }],
    ['s', 'Head pat', { pet: 1 }],
    ['s', 'Scolded', { scold: 1 }],
    ['s', 'Given food', { food: 1 }],
    ['s', 'Head pat, loves you', { pet: 1, affection: 0.95 }],
  ];
  const probeHtml = PROBES.map(([, label]) => `<span class="sit">${label}</span><span class="ans">…</span>`);
  let probeK = 0;
  function updateLearned() {
    const [lobeK, label, s] = PROBES[probeK];
    const lobe = lobeK === 'm' ? brain.motor : brain.social, actions = lobeK === 'm' ? MOTOR_ACTIONS : SOCIAL_ACTIONS;
    const temp = lobeK === 'm' ? world.settings.temp : world.settings.socialTemp;
    const q = lobe.peek(Object.assign({}, lobeK === 'm' ? MBASE : SBASE, s));
    let best = 0; for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
    let sum = 0; for (let i = 0; i < q.length; i++) sum += Math.exp((q[i] - q[best]) / Math.max(0.02, temp));
    probeHtml[probeK] = `<span class="sit">${label}</span><span class="ans">${actions[best].icon} ${actions[best].label}<i>${Math.round(100 / sum)}%</i></span>`;
    probeK = (probeK + 1) % PROBES.length;
    const nM = PROBES.filter((p) => p[0] === 'm').length;
    $('learnedMotor').innerHTML = '<span class="head">🧭 Work & moves</span>' + probeHtml.slice(0, nM).join('');
    $('learnedSocial').innerHTML = '<span class="head">💗 Reactions</span>' + probeHtml.slice(nM).join('');
    const h = world.stats.rewardHist;
    if (h.length > 1) {
      const lo = Math.min(...h, -0.05), hi = Math.max(...h, 0.05);
      const pts = h.map((v, i) => `${(i / (h.length - 1)) * 300},${38 - ((v - lo) / (hi - lo)) * 36}`).join(' ');
      const zy = 38 - ((0 - lo) / (hi - lo)) * 36;
      $('spark').innerHTML = `<line x1="0" x2="300" y1="${zy}" y2="${zy}" stroke="#e5d8cc" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="#ff9a3c" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    }
  }

  // ---------- HUD ----------
  const PHASE_NAMES = { morning: 'Morning', work: 'Work hours', rest: 'Rest hours', night: 'Night' };
  function updateHud() {
    const b = world.buddy, st = world.stats, ph = world.phase;
    $('money').textContent = fmt(world.money);
    $('clock').textContent = world.clock();
    $('phaseLabel').textContent = PHASE_NAMES[ph];
    $('day').textContent = world.day;
    $('sceneLabel').textContent = world.scene === 'office' ? '🏢 Office' : '🏠 Home';
    $('energyFill').style.width = (b.energy * 100).toFixed(0) + '%';
    $('affFill').style.width = world.affection.toFixed(0) + '%';
    const tf = ph === 'work' ? 1 - world.phaseT / PHASE_LEN.work : ph === 'morning' ? 1 - world.phaseT / PHASE_LEN.morning : 0;
    $('timebar').hidden = !(ph === 'work' || ph === 'morning');
    $('timeFill').style.width = (tf * 100).toFixed(1) + '%';
    // go button: office in work hours, bed in rest hours
    const go = $('btnGo');
    if (ph === 'rest') { $('goIcon').textContent = '🛏️'; $('goLabel').textContent = 'Go to bed'; go.disabled = false; go.classList.add('ready'); }
    else if (ph === 'work' && world.scene === 'home') { $('goIcon').textContent = '💼'; $('goLabel').textContent = 'Go to office!'; go.disabled = false; go.classList.add('ready'); }
    else { $('goIcon').textContent = world.scene === 'office' ? '🏢' : '💼'; $('goLabel').textContent = ph === 'morning' ? `Office opens 9:00` : ph === 'night' ? 'Sleeping…' : 'At work'; go.disabled = true; go.classList.remove('ready'); }
    // action points
    $('apBox').hidden = ph !== 'rest';
    if (ph === 'rest') {
      const total = world.ap + world.apUsed;
      $('apPips').innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < world.apUsed ? 'used' : ''}"></i>`).join('');
    }
    // contextual hint
    let hint = '';
    if (world.scene === 'office' && ph === 'work') {
      if (b.energy < 0.3) hint = '⚡ She is exhausted. Click the ☕ coffee maker to point her there!';
      else if (world.today.done + world.today.shredded === 0 && world.phaseT < 30) hint = 'Click machines to show her where to go: inbox → copy + sign → out-tray, memos → shredder';
    } else if (ph === 'morning') hint = 'Good morning! Pet her or feed her breakfast before work ☀️';
    else if (ph === 'work' && world.scene === 'home') hint = '9:00! Press 💼 to send her to the office';
    else if (ph === 'rest') hint = world.ap > 0 ? `Rest hours: ${world.ap} action point${world.ap > 1 ? 's' : ''} left: pet, feed or reward her` : 'Out of action points. Press 🛏️ to sleep';
    if (world.scene === 'home' && world.affection >= 50 && ph !== 'night' && ph !== 'work') hint += (hint ? ' · ' : '') + '💗 She loves you: she follows your cursor looking for rewards';
    $('hintStrip').textContent = hint;
    // brain screen
    if (screen === 'brain') {
      $('brainStats').textContent = `${brain.full ? 'Whole brain · ' : ''}${brain.n.toLocaleString()} spiking neurons · ${brain.m.toLocaleString()} connections · ${(brain.tick / 10000).toFixed(1)} s simulated`;
      $('brainAge').textContent = `${brain.age.toLocaleString()} decisions`;
      const t = world.today;
      $('statsBox').innerHTML = [
        ['Day', world.day], ['Phase', PHASE_NAMES[ph]], ['Doing now', b.busy ? `using ${b.busy.id}` : b.react ? SOCIAL_ACTIONS.find((x) => x.id === b.react).label : MOTOR_ACTIONS[b.action].label],
        ['Today: filed / shredded', `${t.done} / ${t.shredded}`], ['Today: mistakes', t.mistakes], ['Today: earned', `${fmt(t.earned)}฿`],
        ['All time: filed / shredded', `${st.done} / ${st.shredded}`], ['All time: mistakes', st.mistakes], ['Coffee breaks', st.coffees],
        ['Treats / scolds / pets', `${st.treats} / ${st.scolds} / ${st.pets}`], ['Energy', `${Math.round(b.energy * 100)}%`], ['Affection', `${Math.round(world.affection)}%`],
      ].map(([a, v]) => `<span>${a}</span><span>${v}</span>`).join('');
      motorBtns.forEach((el, i) => el.classList.toggle('on', i === b.action && !b.react));
      const ls = world.lastSocial;
      socialBtns.forEach((el, i) => el.classList.toggle('on', !!ls && world.time - ls.t < 5 && i === ls.action));
      if (ls) $('lastTouch').textContent = `Last: ${ls.kind === 'food' ? 'food' : ls.kind === 'pet' ? 'head pat' : 'scolded'} → she chose ${SOCIAL_ACTIONS[ls.action].icon} ${SOCIAL_ACTIONS[ls.action].label}${world.time - ls.t < 5 ? ' (reward/scold now trains this reaction)' : ''}`;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= MOTOR_ACTIONS.length) world.teachMotor(n - 1);
    else if (e.key === 'r' || e.key === 'R') $('btnReward').click();
    else if (e.key === 'x' || e.key === 'X') world.scold();
    else if (e.key === 'p' || e.key === 'P') doPet();
    else if (e.key === 'f' || e.key === 'F') $('btnFollow').click();
    else if (e.key === 'b' || e.key === 'B') showScreen(screen === 'game' ? 'brain' : 'game');
  });

  // ---------- main loop ----------
  const IDLE_STEPS = brain.slow ? brain.params.fullIdleSteps : 60; // whole brain: perception spreads over frames
  let last = performance.now(), hudT = 0, learnT = 0, saveT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    world.step(dt);
    for (const ev of world.events) {
      if (ev.type === 'dayReport') showReport(ev);
      if (ev.type === 'phase' && ev.phase === 'work') toast('9:00 · Work hours!');
      if (ev.type === 'phase' && ev.phase === 'morning') toast(`☀️ Day ${world.day}`);
      if (ev.type === 'scene' && ev.scene === 'office') toast('🏢 At the office');
    }
    brain.idle(IDLE_STEPS);
    if (screen === 'game') { scene.update(dt); scene.draw(); }
    else { world.events.length = 0; if (brainTab === 'map') brainMap.draw(); else circuitView.draw(); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
    hudT -= dt; learnT -= dt; saveT += dt;
    if (hudT <= 0) { hudT = 0.12; updateHud(); }
    if (learnT <= 0 && screen === 'brain') { learnT = brain.slow ? 3 : 0.35; updateLearned(); }
    if (saveT > 15) { saveT = 0; saveLocal(); }
    requestAnimationFrame(frame);
  }
  window.addEventListener('beforeunload', saveLocal);
  window.flyBuddy = window.fruityOL = { brain, world, scene, brainMap, circuitView, wipe: () => { wiping = true; localStorage.removeItem(STORE); } };
  requestAnimationFrame(frame);
})();
