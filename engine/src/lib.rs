//! flybrain — event-driven leaky integrate-and-fire simulator for a real
//! connectome circuit, compiled to WebAssembly.
//!
//! Dynamics follow Shiu et al. 2024 (Nature) as adapted in the Xenova
//! fruit-fly-simulation demo: dt 0.1 ms, rest −52 mV, threshold −45 mV,
//! τm 20 ms, τs 5 ms, refractory 2.2 ms, synaptic delay 1.8 ms, 0.275 mV per
//! synapse, Poisson input events of 68.75 mV.
//!
//! Learning: KC→MBON synapses onto "readout" MBONs carry a plastic weight θ.
//! Dopamine (a δ computed by the host) changes θ only on synapses whose KC
//! fired recently (eligibility trace) — a three-factor rule.
//!
//! It runs either her learning circuit (4,804 neurons) or the WHOLE MaleCNS
//! connectome (166,700 neurons, 25.6 M connections). Synaptic weights are
//! computed on the fly (count × sign × 0.275 mV × role scale), so memory is
//! ~5 bytes per connection. Plastic synapses are found through a per-neuron
//! index, and their order is the same in both modes, so learning transfers.
//!
//! The host (JS) talks to it through the `fb_*` C ABI below.
#![allow(static_mut_refs)]

const DT: f32 = 0.1;
const REST: f32 = -52.0;
const THRESH: f32 = -45.0;
const TAU_M: f32 = 20.0;
const TAU_S: f32 = 5.0;
const REFRACT: u32 = 22;
const DELAY: usize = 18;
const RING: usize = DELAY + 1;
const SYN: f32 = 0.275;
const POISSON_W: f32 = 68.75;
const ROLES: usize = 8;
const KC_ROLE: u8 = 1;

struct Sim {
    n: usize,
    offsets: Vec<u32>,
    targets: Vec<u32>,
    counts: Vec<u8>,
    sign: Vec<i8>,
    role: Vec<u8>,
    role_scale: [f32; ROLES * ROLES],
    readout: Vec<i16>,
    p_off: Vec<u32>,   // plastic synapses of neuron i: p_off[i]..p_off[i+1]
    p_tgt: Vec<u32>,
    // state
    v: Vec<f32>,
    g: Vec<f32>,
    until: Vec<u32>,
    present: Vec<u8>,
    active: Vec<u32>,
    ring: Vec<Vec<u32>>,
    fired: Vec<u32>,
    tick: u32,
    rates: Vec<f32>,
    driven: Vec<u32>,
    rng: u32,
    phase: Vec<f32>,
    jitter: f32,
    plastic_gain: f32,
    em: f32,
    es: f32,
    coupling: f32,
    // activity
    last_spike: Vec<u32>,
    win: Vec<u16>,
    snap: Vec<u16>,
    // plasticity
    p_src: Vec<u32>,
    p_action: Vec<u8>,
    p_count: Vec<f32>,
    theta: Vec<f32>,
    trace: Vec<f32>,
    round_trace: Vec<f32>,
    round_commits: u32,
    n_actions: usize,
    readout_out: Vec<f32>,
}

static mut SIM: Option<Sim> = None;

fn sim() -> &'static mut Sim {
    unsafe { SIM.as_mut().expect("fb_init first") }
}

// Typed buffers for the host to fill; fb_init takes ownership (no copy).
#[no_mangle]
pub extern "C" fn fb_alloc(bytes: usize) -> *mut u8 {
    let mut v: Vec<u8> = vec![0; bytes.max(1)];
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}
#[no_mangle]
pub extern "C" fn fb_alloc_u32(len: usize) -> *mut u32 {
    let mut v: Vec<u32> = vec![0; len.max(1)];
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// Hand the connectome over. offsets/targets come from fb_alloc_u32 (lengths
/// n+1 and m), counts/sign/role from fb_alloc (lengths m, n, n).
#[no_mangle]
pub unsafe extern "C" fn fb_init(n: usize, m: usize, offsets: *mut u32, targets: *mut u32, counts: *mut u8, sign: *mut i8, role: *mut u8, seed: u32) {
    let take_u32 = |p: *mut u32, len: usize| Vec::from_raw_parts(p, len, len.max(1));
    let take_u8 = |p: *mut u8, len: usize| Vec::from_raw_parts(p, len, len.max(1));
    let s = Sim {
        n,
        offsets: take_u32(offsets, n + 1),
        targets: take_u32(targets, m),
        counts: take_u8(counts, m),
        sign: Vec::from_raw_parts(sign, n, n.max(1)),
        role: take_u8(role, n),
        role_scale: [1.0; ROLES * ROLES],
        readout: vec![-1; n],
        p_off: Vec::new(),
        p_tgt: Vec::new(),
        v: vec![REST; n],
        g: vec![0.0; n],
        until: vec![0; n],
        present: vec![0; n],
        active: Vec::with_capacity(n),
        ring: (0..RING).map(|_| Vec::new()).collect(),
        fired: Vec::new(),
        tick: 0,
        rates: vec![0.0; n],
        driven: Vec::new(),
        rng: seed | 1,
        phase: { let mut r = seed | 1; (0..n).map(|_| rand01(&mut r)).collect() },
        jitter: 0.0,
        plastic_gain: 0.75,
        em: (-DT / TAU_M).exp(),
        es: (-DT / TAU_S).exp(),
        coupling: (TAU_S / (TAU_M - TAU_S)) * ((-DT / TAU_M).exp() - (-DT / TAU_S).exp()),
        last_spike: vec![u32::MAX; n],
        win: vec![0; n],
        snap: vec![0; n],
        p_src: Vec::new(),
        p_action: Vec::new(),
        p_count: Vec::new(),
        theta: Vec::new(),
        trace: Vec::new(),
        round_trace: Vec::new(),
        round_commits: 0,
        n_actions: 0,
        readout_out: Vec::new(),
    };
    SIM = Some(s);
}

/// Scale every synapse from role `rs` onto role `rt` (call before fb_finalize).
#[no_mangle]
pub extern "C" fn fb_set_role_scale(rs: usize, rt: usize, scale: f32) {
    sim().role_scale[rs * ROLES + rt] = scale;
}

/// Mark neuron `idx` as a readout for `action`.
#[no_mangle]
pub extern "C" fn fb_add_readout(idx: usize, action: i32) {
    let s = sim();
    s.readout[idx] = action as i16;
    s.n_actions = s.n_actions.max(action as usize + 1);
}

/// Build the plastic KC→readout synapse list (same order in every mode:
/// KCs ascending, each KC's targets ascending).
#[no_mangle]
pub extern "C" fn fb_finalize() {
    let s = sim();
    s.p_src.clear(); s.p_action.clear(); s.p_count.clear(); s.p_tgt.clear();
    s.p_off = vec![0; s.n + 1];
    for i in 0..s.n {
        if s.role[i] == KC_ROLE {
            for e in s.offsets[i] as usize..s.offsets[i + 1] as usize {
                let j = s.targets[e] as usize;
                if s.readout[j] >= 0 {
                    s.p_src.push(i as u32);
                    s.p_tgt.push(j as u32);
                    s.p_action.push(s.readout[j] as u8);
                    s.p_count.push(s.counts[e] as f32);
                }
            }
        }
        s.p_off[i + 1] = s.p_src.len() as u32;
    }
    let np = s.p_src.len();
    s.theta = vec![0.0; np];
    s.trace = vec![0.0; np];
    s.round_trace = vec![0.0; np];
    s.round_commits = 0;
    s.readout_out = vec![0.0; s.n_actions * 2];
}

#[inline]
fn activate(present: &mut [u8], active: &mut Vec<u32>, i: usize) {
    if present[i] == 0 { present[i] = 1; active.push(i as u32); }
}

#[inline]
fn rand01(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    *state = x;
    (x >> 8) as f32 / 16777216.0
}

#[inline]
fn plastic_mult(theta: f32, gain: f32) -> f32 {
    let m = 1.0 + theta * gain;
    if m < 0.0 { 0.0 } else if m > 4.0 { 4.0 } else { m }
}

/// Advance `steps` × 0.1 ms. Returns the number of spikes.
#[no_mangle]
pub extern "C" fn fb_run(steps: u32) -> u32 {
    let s = sim();
    let mut total = 0u32;
    for _ in 0..steps {
        let t = s.tick;
        // 1. integrate active neurons
        s.fired.clear();
        let mut kept = 0usize;
        for k in 0..s.active.len() {
            let i = s.active[k] as usize;
            if s.v[i] == REST && s.g[i] == 0.0 { s.present[i] = 0; continue; }
            s.active[kept] = i as u32; kept += 1;
            if t >= s.until[i] {
                s.v[i] = REST + (s.v[i] - REST) * s.em + s.g[i] * s.coupling;
                s.g[i] *= s.es;
                if s.g[i].abs() < 1e-6 { s.g[i] = 0.0; }
                if (s.v[i] - REST).abs() < 1e-4 && s.g[i] == 0.0 { s.v[i] = REST; }
                if s.v[i] > THRESH { s.fired.push(i as u32); }
            }
        }
        s.active.truncate(kept);
        // 2. deliver spikes emitted DELAY steps ago
        let slot = t as usize % RING;
        let due = core::mem::take(&mut s.ring[slot]);
        for &iu in due.iter() {
            let i = iu as usize;
            let sg = s.sign[i] as f32 * SYN;
            if sg == 0.0 { continue; } // no fast transmitter (e.g. dopamine): no direct effect
            let rs = s.role[i] as usize * ROLES;
            let (p0, p1) = (s.p_off[i] as usize, s.p_off[i + 1] as usize);
            for e in s.offsets[i] as usize..s.offsets[i + 1] as usize {
                let j = s.targets[e] as usize;
                if t >= s.until[j] {
                    let mut w = s.counts[e] as f32 * sg * s.role_scale[rs + s.role[j] as usize];
                    if p1 > p0 && s.readout[j] >= 0 {
                        for p in p0..p1 { if s.p_tgt[p] as usize == j { w *= plastic_mult(s.theta[p], s.plastic_gain); break; } }
                    }
                    s.g[j] += w;
                    activate(&mut s.present, &mut s.active, j);
                }
            }
        }
        let mut recycled = due; recycled.clear();
        // 3. sensory drive: regular spike trains with a fixed random phase,
        //    blended with Poisson noise by `jitter` (0 = clockwork, 1 = Poisson)
        for k in 0..s.driven.len() {
            let i = s.driven[k] as usize;
            if t < s.until[i] { continue; }
            let p = s.rates[i] * DT / 1000.0;
            let spike = if s.jitter > 0.0 && rand01(&mut s.rng) < s.jitter {
                rand01(&mut s.rng) < p
            } else {
                s.phase[i] += p;
                if s.phase[i] >= 1.0 { s.phase[i] -= 1.0; true } else { false }
            };
            if spike {
                s.v[i] += POISSON_W;
                activate(&mut s.present, &mut s.active, i);
            }
        }
        // 4. reset fired neurons, schedule delivery
        for &iu in s.fired.iter() {
            let i = iu as usize;
            s.v[i] = REST; s.g[i] = 0.0;
            s.until[i] = t + if s.rates[i] > 0.0 { 0 } else { REFRACT };
            s.last_spike[i] = t;
            s.win[i] = s.win[i].saturating_add(1);
        }
        total += s.fired.len() as u32;
        recycled.extend_from_slice(&s.fired);
        s.ring[(t as usize + DELAY) % RING] = recycled;
        s.tick += 1;
    }
    total
}

#[no_mangle] pub extern "C" fn fb_rates_ptr() -> *mut f32 { sim().rates.as_mut_ptr() }
#[no_mangle] pub extern "C" fn fb_last_spike_ptr() -> *const u32 { sim().last_spike.as_ptr() }
#[no_mangle] pub extern "C" fn fb_win_ptr() -> *const u16 { sim().win.as_ptr() }
#[no_mangle] pub extern "C" fn fb_v_ptr() -> *const f32 { sim().v.as_ptr() }
#[no_mangle] pub extern "C" fn fb_theta_ptr() -> *mut f32 { sim().theta.as_mut_ptr() }
#[no_mangle] pub extern "C" fn fb_plastic_action_ptr() -> *const u8 { sim().p_action.as_ptr() }
#[no_mangle] pub extern "C" fn fb_n_plastic() -> usize { sim().p_src.len() }
#[no_mangle] pub extern "C" fn fb_tick() -> u32 { sim().tick }

/// How strongly learned θ changes real KC→MBON transmission (0 = readout only).
#[no_mangle] pub extern "C" fn fb_set_plastic_gain(g: f32) { sim().plastic_gain = g; }
#[no_mangle] pub extern "C" fn fb_set_jitter(j: f32) { sim().jitter = j; }

/// Call after writing rates through fb_rates_ptr.
#[no_mangle]
pub extern "C" fn fb_rates_changed() {
    let s = sim();
    s.driven.clear();
    for i in 0..s.n {
        if s.rates[i] > 0.0 { s.driven.push(i as u32); }
    }
}

#[no_mangle]
pub extern "C" fn fb_begin_window() { let s = sim(); for x in s.win.iter_mut() { *x = 0; } }

#[no_mangle]
pub extern "C" fn fb_snapshot() { let s = sim(); s.snap.copy_from_slice(&s.win); }

/// Learned value of each action in [first, first+count): the mean θ over
/// KC→readout synapses, weighted by how much each KC fired in the window.
/// Writes q[a] then input[a] (total weighted KC input) into the out buffer.
#[no_mangle]
pub extern "C" fn fb_readout(first: usize, count: usize, use_snap: i32) -> *const f32 {
    let s = sim();
    let act = if use_snap != 0 { &s.snap } else { &s.win };
    let mut num = [0f32; 32];
    let mut den = [0f32; 32];
    for p in 0..s.p_src.len() {
        let a = s.p_action[p] as usize;
        if a < first || a >= first + count { continue; }
        let k = act[s.p_src[p] as usize];
        if k == 0 { continue; }
        let w = k as f32 * s.p_count[p];
        num[a - first] += w * s.theta[p];
        den[a - first] += w;
    }
    for a in 0..count {
        s.readout_out[a] = if den[a] > 0.0 { num[a] / den[a] } else { 0.0 };
        s.readout_out[count + a] = den[a];
    }
    s.readout_out.as_ptr()
}

/// Tag the synapses that just carried input as eligible for `action`.
/// (Every active synapse gets trace 1, so a dopamine δ shifts the value by lr·δ.)
#[no_mangle]
pub extern "C" fn fb_commit(action: usize, first: usize, count: usize) {
    let s = sim();
    for p in 0..s.p_src.len() {
        let a = s.p_action[p] as usize;
        if a < first || a >= first + count { continue; }
        if s.win[s.p_src[p] as usize] == 0 { continue; }
        s.trace[p] = if a == action { 1.0 } else { 0.0 };
        if a == action { s.round_trace[p] += 1.0; }
    }
    s.round_commits += 1;
}

/// Start collecting a round-long trace (every choice made until fb_round_reward).
#[no_mangle]
pub extern "C" fn fb_round_start() {
    let s = sim();
    for x in s.round_trace.iter_mut() { *x = 0.0; }
    s.round_commits = 0;
}

/// Reward / punish a whole round: each synapse gets credit in proportion to
/// how often it was part of a chosen action during the round.
#[no_mangle]
pub extern "C" fn fb_round_reward(amount: f32, first: usize, count: usize) {
    let s = sim();
    if s.round_commits == 0 { return; }
    let k = amount / s.round_commits as f32;
    for p in 0..s.p_src.len() {
        let a = s.p_action[p] as usize;
        if a < first || a >= first + count { continue; }
        let rt = s.round_trace[p];
        if rt == 0.0 { continue; }
        s.theta[p] = (s.theta[p] + k * rt).clamp(-4.0, 4.0);
    }
    for x in s.round_trace.iter_mut() { *x = 0.0; }
    s.round_commits = 0;
}

/// Dopamine: θ += lr·δ·trace, then traces decay.
#[no_mangle]
pub extern "C" fn fb_dopamine(delta: f32, lr: f32, decay: f32, first: usize, count: usize) {
    let s = sim();
    let step = lr * delta;
    for p in 0..s.p_src.len() {
        let a = s.p_action[p] as usize;
        if a < first || a >= first + count { continue; }
        let tr = s.trace[p];
        if tr == 0.0 { continue; }
        s.theta[p] = (s.theta[p] + step * tr).clamp(-4.0, 4.0);
        let d = tr * decay;
        s.trace[p] = if d < 1e-4 { 0.0 } else { d };
    }
}

/// Shift the value of `action` in the current (or snapshot) context by `amount`.
#[no_mangle]
pub extern "C" fn fb_nudge(action: usize, amount: f32, use_snap: i32) {
    let s = sim();
    let snap = use_snap != 0;
    for p in 0..s.p_src.len() {
        if s.p_action[p] as usize != action { continue; }
        let k = if snap { s.snap[s.p_src[p] as usize] } else { s.win[s.p_src[p] as usize] };
        if k == 0 { continue; }
        s.theta[p] = (s.theta[p] + amount).clamp(-4.0, 4.0);
    }
}

#[no_mangle]
pub extern "C" fn fb_reset_traces() { for x in sim().trace.iter_mut() { *x = 0.0; } }

#[no_mangle]
pub extern "C" fn fb_reset_weights() { let s = sim(); for x in s.theta.iter_mut() { *x = 0.0; } for x in s.trace.iter_mut() { *x = 0.0; } }

/// Silence the network (membranes to rest, pending spikes dropped). The clock
/// and the last-spike record keep running so displays stay continuous.
#[no_mangle]
pub extern "C" fn fb_quiet() {
    let s = sim();
    let mut r = 0x9E3779B9u32;
    for i in 0..s.n { s.v[i] = REST; s.g[i] = 0.0; s.until[i] = 0; s.present[i] = 0; s.phase[i] = rand01(&mut r); }
    s.active.clear();
    for r in s.ring.iter_mut() { r.clear(); }
}
