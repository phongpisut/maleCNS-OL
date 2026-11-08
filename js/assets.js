/* assets.js — downloads the brain model once, with the player's consent, and
 * keeps it in the browser (Cache Storage) so later visits load from the device.
 *
 * data/brain-manifest.json (written by tools/build-static.js) lists each file
 * with its exact size and SHA-256. Works on any static host; needs http(s)
 * (Cache Storage needs https or localhost; without it, files are just fetched). */
(function (G) {
  'use strict';
  const CACHE = 'flybuddy-brain';

  function fmtBytes(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' MB';
    if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
    return n + ' B';
  }

  async function manifest() {
    const r = await fetch('data/brain-manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw Error(`data/brain-manifest.json: HTTP ${r.status} (run "node tools/build-static.js --manifest")`);
    return r.json();
  }

  // cache key carries the file's hash, so a new brain version is downloaded fresh
  const keyOf = (f) => new URL(f.path + '?sha=' + f.sha256.slice(0, 16), location.href).href;

  async function openCache() {
    try { return typeof caches !== 'undefined' ? await caches.open(CACHE) : null; } catch (e) { return null; }
  }

  // Files needed for a brain mode: 'circuit' = core only, 'whole' = core + whole connectome.
  function filesFor(m, mode) { return m.files.filter((f) => (f.group || 'core') === 'core' || mode === 'whole'); }
  function bytesFor(m, mode) { return filesFor(m, mode).reduce((t, f) => t + f.bytes, 0); }

  // Which files are already on this device? Also drops outdated versions.
  async function cachedState(m) {
    const cache = await openCache(), have = new Set();
    if (!cache) return { cache: null, have, bytes: 0 };
    const wanted = new Set(m.files.map(keyOf));
    try { for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req); } catch (e) { /* ignore */ }
    let bytes = 0;
    for (const f of m.files) if (await cache.match(keyOf(f))) { have.add(f.path); bytes += f.bytes; }
    return { cache, have, bytes };
  }

  async function download(f, onBytes) {
    const r = await fetch(f.path, { cache: 'no-cache' });
    if (!r.ok) throw Error(`${f.path}: HTTP ${r.status}`);
    if (!r.body || !r.body.getReader) { const b = await r.arrayBuffer(); onBytes(b.byteLength); return b; }
    const reader = r.body.getReader(), chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length; onBytes(value.length);
    }
    const out = new Uint8Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
  }

  async function sha256(buf) {
    if (!(G.crypto && crypto.subtle)) return null; // not available on plain-http hosts
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Load the files for a mode (cache first, then network), verifying fresh downloads.
  async function load(m, cache, onProgress, mode) {
    const out = {}, files = filesFor(m, mode || 'circuit'), total = bytesFor(m, mode || 'circuit');
    let done = 0;
    for (const f of files) {
      let buf = null;
      if (cache) { try { const r = await cache.match(keyOf(f)); if (r) buf = await r.arrayBuffer(); } catch (e) { /* ignore */ } }
      if (buf) { done += f.bytes; onProgress(Math.min(done, total), total, f, true); }
      else {
        buf = await download(f, (n) => { done += n; onProgress(Math.min(done, total), total, f, false); });
        const h = await sha256(buf);
        // a host may have un-gzipped a .gz file on the fly; that changes the hash legitimately
        const inflated = f.path.endsWith('.gz') && new Uint8Array(buf)[0] !== 0x1f;
        if (h && h !== f.sha256 && !inflated) throw Error(`${f.path} failed its checksum. Please reload to try again`);
        if (cache) { try { await cache.put(keyOf(f), new Response(buf)); } catch (e) { /* storage full or blocked */ } }
      }
      out[f.path] = buf;
    }
    return out;
  }

  async function clear() { try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch (e) { /* ignore */ } }

  // Inflate a .gz buffer (or pass it through if the server already did).
  async function gunzip(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  G.BrainAssets = { manifest, cachedState, load, clear, gunzip, fmtBytes, filesFor, bytesFor };
})(globalThis);
