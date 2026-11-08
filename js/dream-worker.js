/* dream-worker.js — trains a copy of her connectome brain through endless
 * offscreen work shifts, so the page stays smooth. The page sends the current
 * synaptic weights; the worker sends back the trained ones. */
importScripts('world.js', 'flybrain.js');

let brain = null;
const cfg = () => ({ motorFeatures: FB.MOTOR_FEATURES, motorActions: FB.MOTOR_ACTIONS, socialFeatures: FB.SOCIAL_FEATURES, socialActions: FB.SOCIAL_ACTIONS });

onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'init') {
    brain = await ConnectomeBrain.create(d.wasm, d.circuitBin, d.circuit, cfg());
    postMessage({ type: 'ready' });
  } else if (d.type === 'dream') {
    brain.load(d.brain);
    const sim = new World(brain, { headless: true, mode: 'shift', settings: Object.assign({}, d.settings, { autoReward: true }) });
    const dt = 0.05, total = Math.round((d.minutes * 60) / dt);
    const report = () => ({ done_: sim.stats.done, shredded: sim.stats.shredded, mistakes: sim.stats.mistakes });
    for (let i = 0; i < total; i++) {
      sim.step(dt);
      if (i % 200 === 0) postMessage({ type: 'progress', done: i / total, ...report() });
    }
    brain.motor.resetEpisode();
    postMessage({ type: 'done', brain: brain.toJSON(), decisions: sim.stats.decisions, ...report() });
  }
};
