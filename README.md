# Fruity OL 🪰💼

**Play it:** https://phongpisut.github.io/maleCNS-OL/

An office-life companion game. Meet **Ms. Fruity**, the office lady (OL) with a fruit-fly brain. Her brain is **4,804 real fruit-fly neurons**, the mushroom-body learning circuit from the MaleCNS connectome, spiking in **WebAssembly**. Train her to work efficiently, keep her caffeinated, spend your pay on food and furniture, and watch her neurons fire.

## Run

```
node serve.js        # → http://localhost:5173
```
Or any static http server. It doesn't work as a `file://` page, because browsers block `fetch` there.

## Deploy as a static website

Fruity OL is 100% static: there's no backend, and all simulation runs in the player's browser.

```
node tools/build-static.js     # → dist/ (≈52 MB with the optional whole brain, 20 files)
```
Upload `dist/` to any static host: GitHub Pages (a `.nojekyll` file is included), Netlify, Cloudflare Pages, Vercel, itch.io (HTML5 game, upload the folder as a zip), or S3.

**Brain download dialog.** On a player's first visit the game asks before downloading the brain model and shows exactly what it is:

| File | Size |
|---|---|
| Spiking-neuron engine (WebAssembly) | 42 KB |
| Connectome circuit: 4,804 neurons, 1.05 M synapses | 1.6 MB |
| Neuron roles, glomeruli & readouts | 239 KB |
| Brain map: 166,700 neuron positions | 1.3 MB |
| Cell-type names for the brain map | 117 KB |
| **Learning circuit (default)** | **3.3 MB** |
| + Whole connectome: 166,700 neurons, 25.6 M synapses (optional) | +48 MB |
| **Whole brain** | **51 MB** |

Players pick the brain size in that dialog and can switch later on the brain screen (**Brain size**).

The files are checked against SHA-256 hashes in `data/brain-manifest.json` and kept in the browser's Cache Storage, so later visits load it instantly from the device with no prompt. Players can delete them on the brain screen (**Save → 🗑️ Remove downloaded brain**). If you change the brain files (re-extract or rebuild the WASM), run `node tools/build-static.js --manifest`; players then get the new version, after being asked again.

## The game

**One display, two screens:** her life (the game) and her brain (brain map + training status). Switch with 🧠 / **← Back** (or `B`).

### Day cycle
| Phase | Where | What happens |
|---|---|---|
| ☀️ Morning (07–09) | Home | She wakes up. Pet her or feed her breakfast. |
| 💼 Work hours (09–17, **2 min**) | Office | Press 💼 to send her to work (she goes on her own if you forget). Documents keep arriving. |
| 🌙 Rest hours (17–) | Home | Work report, then you get **action points** (3, or +1 with a sofa) to pet, feed or reward her. Then 🛏️ bed → next day. |

### Work
- **Important documents** (red tab) must be **copied** and **signed**, then **filed** in the out-tray: +120฿ and a dopamine reward.
- **Memos** (yellow tab) go to the **shredder**: +60฿.
- Mistakes cost money and dopamine: shredding an important document (−100฿), copying memos, filing half-done work.
- **Energy** drains while she works. Below 30% she moves very slowly. The ☕ coffee maker refills it, and it's a habit you need to teach her.
- **Click a machine** to point her at it. That's a supervised lesson ("in this situation, go there"), and the fastest way to train her.
- End of the day: more documents than yesterday earns a treat, fewer earns a scold. Either one is shared across every choice she made that day (a round-long trace in the WASM engine).

### Affection, money & shop
- 🫳 Pet (or click her head), 🍙 Feed, 🍬 Reward raise affection; 👎 Scold lowers it.
- 🎀 Shop: food (cookie, onigiri, bento, cake: affection + energy) and furniture (cozy bed: more energy after sleep; sofa: +1 action point; plant, rug: daily affection; bookshelf: +10% pay; night lamp: better pets).
- **High affection (≥50%):** being near your cursor feels rewarding to her at home, so she learns to follow your cursor looking for rewards.

### Her reactions
Pets, scolds and food go to the social lobe, which picks a reaction (happy, shy, pout, cry, love, shocked). Reward or scold within 5 s to train the reaction, or use **Teach a reaction** on the brain screen.

## The character
A Live2D-style **2D skeleton rig** drawn entirely on canvas (`js/rig.js`):
- Bones with two-bone IK for arms and legs; poses for walking, holding papers, copying, signing, shredding, drinking coffee, stretching, eating and carrying the briefcase.
- Live2D-like parameters (angle X/Y/Z, body angle, breathing, eye open L/R, eye look, mouth open/form, brows, blush), eased every frame. Head turns use parallax: the face moves more than the back hair, and the far eye and glasses narrow.
- Spring-physics chains for the long ponytail, back hair, side locks, ahoge and skirt hem, driven by her own acceleration.
- Expressions from the reference sheet: normal, happy ^^, smile, shocked (blank eyes), wink, plus sad, cry, pout, shy, love, sleep, tired, focus and yum.

`dev/rig.html` is a rig playground: buttons for every expression and pose, and drag her sideways to see the hair physics.

## The brain

```
senses ──▶ olfactory projection neurons (each feature bin drives one real glomerulus type)
       ──▶ 4,064 Kenyon cells (real PN→KC wiring; the APL neuron keeps ~1–4% firing)
       ──▶ 15 readout MBON types: 9 work/move actions + 6 reactions
dopamine (PAM reward / PPL1 punishment) rewrites only KC→MBON synapses that just fired
```
- Neurons are leaky integrate-and-fire with the Shiu et al. 2024 parameters, simulated event-driven in Rust → WASM (`engine/`).
- Work actions are **commitments**: she walks to the machine and uses it before choosing again. That's essential, because if she re-decides every 0.35 s she never reaches anything.
- A trained brain (≈60 dream-minutes) files ~15 important documents and shreds ~20 memos per 10 minutes with only a few mistakes. It does take → sign → copy → file for important documents and take → shred for memos. Coffee is the one habit you have to teach.
- **Brain map:** all 166,700 neurons at their real positions, with her circuit's spikes glowing; hover any neuron to see its type. **Circuit:** the same activity as a node graph.

## Brain size: learning circuit or whole brain

| | Learning circuit (default) | Whole brain (optional) |
|---|---|---|
| Neurons simulated | 4,804 | 166,700 (the entire MaleCNS) |
| Connections | 1.05 M | 25.6 M |
| Download | 3.3 MB | 51 MB |
| Memory | ~8 MB | ~140 MB |
| Thinking time per decision | ~5 ms | ~0.4 s, spread over frames so the game stays smooth |

- The whole connectome is packed with varint-encoded target gaps: **48 MB** for 25.6 M connections, versus 76 MB in the Xenova export.
- In whole-brain mode her senses are still injected straight into her projection neurons. The rest of the brain's input to those neurons (antennal-lobe circuitry, since there are no real odours) is cut; otherwise it floods her Kenyon cells (about 30% firing instead of the fly's sparse ~1%). Everything else runs unmodified.
- The 42,201 learnable KC→MBON synapses are the same in both sizes and stored in the same order. A brain trained in one size works in the other, and dream-training always runs on the fast learning circuit.

## Project layout
| Path | What |
|---|---|
| `js/world.js` | Day cycle, office tasks, energy, money, affection, shop (runs headless too) |
| `js/flybrain.js` | Loads the circuit into WASM: sensory encoding, readout, dopamine |
| `js/rig.js` | Skeleton character: bones, IK, physics chains, expressions |
| `js/scene.js` | Office and home drawing, effects, world → rig mapping |
| `js/brainview.js` | Brain map and circuit view |
| `js/main.js` | Screens, HUD, shop, reports, training panel, saves |
| `js/assets.js` | Brain-model download dialog, progress, checksum check, browser cache |
| `tools/build-static.js` | Static-site build (`dist/`) + `data/brain-manifest.json` |
| `js/dream-worker.js` | Off-thread dream training (endless work shifts) |
| `engine/` | Rust LIF + plasticity engine → `data/flybrain.wasm` |
| `tools/` | Connectome download/extraction, tuning and learning tests (Node) |

### Rebuilding / testing
```
cd engine && cargo build --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/flybrain.wasm ../data/
node tools/fetch-connectome.js                    # ~77 MB into tools/raw (only to re-extract)
node --max-old-space-size=4096 tools/extract.js
node --max-old-space-size=6144 tools/extract-full.js   # whole-brain file (48 MB)
node --max-old-space-size=4096 tools/full-test.js      # circuit vs whole brain: speed, sparsity
node tools/tune.js                                # sparsity / overlap / speed
node tools/learn-test.js 60                       # headless work-shift learning test
node tools/build-static.js --manifest             # refresh sizes/hashes after changing brain files
```

## Credits
**Designed & refined by Phongpisut Meemuk · Co-created with Claude (Anthropic).**

**Fruit-fly brain:** MaleCNS v1.0 connectome by FlyEM / HHMI Janelia, University of Cambridge, MRC LMB and Google Research (CC BY 4.0, https://male-cns.janelia.org/). Preprocessed export and brain-map idea from [Xenova/fruit-fly-simulation](https://huggingface.co/spaces/Xenova/fruit-fly-simulation). Leaky integrate-and-fire neuron model after Shiu et al., *Nature* 2024.

Connectome: **MaleCNS v1.0**, FlyEM / HHMI Janelia, University of Cambridge, MRC LMB, Google Research (CC BY 4.0), via the preprocessed export in [Xenova/fruit-fly-simulation](https://huggingface.co/spaces/Xenova/fruit-fly-simulation). Neuron model: Shiu et al., *Nature* 2024. Details are in `data/ATTRIBUTION.md`.
