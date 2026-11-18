// XSXB-Slash · 格挡 3-Bar 纯净实录渲染引擎 (PARRY_AUDIO):
//   Bar 1 grade (1..35): 实录底材选择 (已按只狼式物理撞击 + 舒适钢鸣预标定)
//   Bar 2 weight (0..1): 打击轻重 (线性低中频胸腔厚重塑形 + 干净输出响度留白)
//   Bar 3 resonance (0..1): 洪亮共鸣 (真钢鸣延音共振激励 + 精防叠层共鸣，零正弦合成/零人工白噪)
(()=>{
'use strict';
const SR = 48000;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

function bankLen(){
  const bank = window.PARRY_SFX_BANK;
  if (!bank) return 35;
  return Array.isArray(bank) ? bank.length : Object.keys(bank).length;
}
function getBankEntry(grade){
  const maxG = Math.max(1, bankLen());
  const g = clamp(Math.round(+grade || 3), 1, maxG);
  const bank = window.PARRY_SFX_BANK;
  if (!bank) return null;
  if (Array.isArray(bank)) return bank.find(x => x && +x.id === g) || bank[g - 1] || null;
  return bank[g] || bank[String(g)] || null;
}

function dataUrlToBytes(src){
  const b64 = src.includes(',') ? src.split(',')[1] : src;
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function decodeWavBytes(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s; };
  if (u8.byteLength < 44 || str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') return null;
  let pos = 12, fmt = 1, ch = 1, sr = SR, bits = 16, dataOff = 0, dataLen = 0;
  while (pos + 8 <= u8.byteLength) {
    const id = str(pos, 4), sz = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      fmt = dv.getUint16(pos + 8, true);
      ch = dv.getUint16(pos + 10, true);
      sr = dv.getUint32(pos + 12, true);
      bits = dv.getUint16(pos + 22, true);
    } else if (id === 'data') {
      dataOff = pos + 8; dataLen = Math.min(sz, u8.byteLength - dataOff); break;
    }
    pos += 8 + sz + (sz & 1);
  }
  if (!dataOff || !dataLen) return null;
  const bps = Math.max(1, bits >> 3), frames = Math.floor(dataLen / (bps * ch));
  const chans = Array.from({ length: ch }, () => new Float32Array(frames));
  let p = dataOff;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      let v = 0;
      if (fmt === 3 && bits === 32) v = dv.getFloat32(p, true);
      else if (bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (bits === 24) {
        const b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1), b2 = dv.getInt8(p + 2);
        v = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      } else if (bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else if (bits === 8) v = (dv.getUint8(p) - 128) / 128;
      chans[c][i] = v; p += bps;
    }
  }
  return { sampleRate: sr, channels: chans, length: frames };
}

const basePcmCache = new Map();
async function getBasePcm(grade){
  const maxG = Math.max(1, bankLen());
  const g = clamp(Math.round(+grade || 3), 1, maxG);
  const item = getBankEntry(g);
  if (!item || !item.src) throw new Error('Missing PARRY_SFX_BANK[' + g + ']');
  const sig = item.src.slice(0, 64) + '|' + item.src.length;
  const cached = basePcmCache.get(g);
  if (cached && cached.sig === sig) return cached.pcm;

  let pcm = null;
  if (item.src.startsWith('data:')) {
    const u8 = dataUrlToBytes(item.src);
    pcm = decodeWavBytes(u8);
    if (!pcm) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const tmp = new OAC(2, SR, SR);
      const ab = await tmp.decodeAudioData(u8.buffer.slice(0));
      const chans = [];
      for (let c = 0; c < ab.numberOfChannels; c++) chans.push(new Float32Array(ab.getChannelData(c)));
      pcm = { sampleRate: ab.sampleRate, channels: chans, length: ab.length };
    }
  } else {
    const resp = await fetch(item.src);
    const u8 = new Uint8Array(await resp.arrayBuffer());
    pcm = decodeWavBytes(u8);
    if (!pcm) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const tmp = new OAC(2, SR, SR);
      const ab = await tmp.decodeAudioData(u8.buffer.slice(0));
      const chans = [];
      for (let c = 0; c < ab.numberOfChannels; c++) chans.push(new Float32Array(ab.getChannelData(c)));
      pcm = { sampleRate: ab.sampleRate, channels: chans, length: ab.length };
    }
  }
  let pk = 0, pkIdx = 0;
  const ch0 = pcm.channels[0];
  const scanN = Math.min(pcm.length, Math.round(0.08 * pcm.sampleRate));
  for (let i = 0; i < scanN; i++) {
    const m = Math.abs(ch0[i]);
    if (m > pk) { pk = m; pkIdx = i; }
  }
  pcm.peakIndex = pkIdx;
  pcm.peakTimeS = pkIdx / pcm.sampleRate;
  basePcmCache.set(g, { sig, pcm });
  return pcm;
}

const renderCache = new Map();
async function renderSfx(cfg){
  const maxG = Math.max(1, bankLen());
  const g = clamp(Math.round(+(cfg && cfg.grade) || 3), 1, maxG);
  const w = clamp(+(cfg && cfg.weight != null ? cfg.weight : 0.34), 0, 1);
  const res = clamp(+(cfg && cfg.resonance != null ? cfg.resonance : 0.22), 0, 1);
  const bankItem = getBankEntry(g) || { id: g, tier: 'normal', name: '#' + g, desc: '', src: '' };
  const bankArr = Array.isArray(window.PARRY_SFX_BANK) ? window.PARRY_SFX_BANK : [];
  // resonance layer source: entries tagged 'perfect', else (bank is all 'all', sorted light -> heavy) the heavier half,
  // same split the 🎲 uses for 精防 (bank.slice(floor(n*0.45))). Never ring with the base sample itself.
  let perfPool = bankArr.filter(x => x && x.tier === 'perfect');
  if (!perfPool.length) perfPool = bankArr.slice(Math.max(0, Math.floor(bankArr.length * 0.45))).filter(Boolean);
  let ringIdx = Math.min(perfPool.length - 1, Math.floor(perfPool.length * 0.45));
  if (perfPool.length > 1 && perfPool[ringIdx] && +perfPool[ringIdx].id === g) ringIdx = (ringIdx + 1) % perfPool.length;
  const ringEntry = perfPool.length ? perfPool[ringIdx] : getBankEntry(maxG);
  const ringBankId = ringEntry ? +ringEntry.id : maxG;
  const ringItem = getBankEntry(ringBankId) || bankItem;
  const sigKey = (bankItem.src || '').slice(0, 24) + ':' + (bankItem.src || '').length + '|' + (ringItem.src || '').length;
  const key = `v6|${g}|${w.toFixed(3)}|${res.toFixed(3)}|${sigKey}`;
  if (renderCache.has(key)) return renderCache.get(key);

  const [base, ringPcm] = await Promise.all([getBasePcm(g), getBasePcm(ringBankId)]);
  const rate = lerp(1.03, 0.94, w);
  const ringRate = 0.96;
  const durS = Math.min(2.2, (base.length / base.sampleRate) / rate + 0.04);
  const totalFrames = Math.max(1024, Math.ceil(durS * SR));

  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new OAC(2, totalFrames, SR);

  const srcBuf = octx.createBuffer(base.channels.length, base.length, base.sampleRate);
  for (let c = 0; c < base.channels.length; c++) srcBuf.getChannelData(c).set(base.channels[c]);

  const src = octx.createBufferSource();
  src.buffer = srcBuf;
  src.playbackRate.value = rate;

  // 100% linear acoustic EQ sculpting on real recorded source (NO WaveShaper, NO synthetic sine/noise IR!)
  const subShelf = octx.createBiquadFilter();
  subShelf.type = 'lowshelf'; subShelf.frequency.value = 110; subShelf.gain.value = lerp(-2.5, 4.8, w);

  const bodyBell = octx.createBiquadFilter();
  bodyBell.type = 'peaking'; bodyBell.frequency.value = 240; bodyBell.Q.value = 0.85; bodyBell.gain.value = lerp(-1.5, 4.2, w);

  const steelBell = octx.createBiquadFilter();
  steelBell.type = 'peaking'; steelBell.frequency.value = 1950; steelBell.Q.value = 0.80;
  steelBell.gain.value = lerp(0.0, 2.5, w) + lerp(0.0, 3.2, res);

  const comfortLp = octx.createBiquadFilter();
  comfortLp.type = 'lowpass'; comfortLp.frequency.value = lerp(6200, 7800, 0.4 * w + 0.6 * res); comfortLp.Q.value = 0.65;

  const dryGain = octx.createGain();
  dryGain.gain.value = 1.0;

  src.connect(subShelf); subShelf.connect(bodyBell); bodyBell.connect(steelBell);
  steelBell.connect(comfortLp); comfortLp.connect(dryGain);

  const masterBus = octx.createGain();
  dryGain.connect(masterBus);

  // Subtle organic real-recording sustain reinforcement when Resonance > 0.25 (zero synthetic oscillators)
  let ringSrc = null, ringStart = 0, ringOffset = 0;
  if (res > 0.25 && ringPcm && ringBankId !== g) {
    const rBuf = octx.createBuffer(ringPcm.channels.length, ringPcm.length, ringPcm.sampleRate);
    for (let c = 0; c < ringPcm.channels.length; c++) rBuf.getChannelData(c).set(ringPcm.channels[c]);
    ringSrc = octx.createBufferSource();
    ringSrc.buffer = rBuf;
    ringSrc.playbackRate.value = ringRate;

    const mainPeakT = base.peakTimeS / rate;
    const rPeakT = ringPcm.peakTimeS / ringRate;
    const dt = mainPeakT - rPeakT;
    if (dt >= 0) ringStart = dt;
    else ringOffset = Math.min(Math.max(0, rBuf.duration - 0.02), -dt * ringRate);

    const rBp = octx.createBiquadFilter();
    rBp.type = 'bandpass'; rBp.frequency.value = 1750; rBp.Q.value = 0.75;
    const rGain = octx.createGain();
    rGain.gain.value = clamp((res - 0.25) / 0.75, 0, 1) * 0.26;
    ringSrc.connect(rBp); rBp.connect(rGain); rGain.connect(masterBus);
  }

  // Transparent dynamics leveling
  const comp = octx.createDynamicsCompressor();
  comp.threshold.value = lerp(-4, -22, Math.max(w, res));
  comp.knee.value = 12;
  comp.ratio.value = lerp(1.1, 3.8, 0.6 * w + 0.4 * res);
  comp.attack.value = lerp(0.024, 0.007, w);
  comp.release.value = lerp(0.08, 0.24, res);
  masterBus.connect(comp); comp.connect(octx.destination);

  src.start(0);
  if (ringSrc) ringSrc.start(ringStart, ringOffset);
  const rendered = await octx.startRendering();
  const L = rendered.getChannelData(0), R = rendered.getChannelData(1);

  // Clean linear peak scaling (weight scales headroom 0.34 -> 0.93 cleanly with ZERO tanh distortion)
  let rawPeak = 1e-6;
  for (let i = 0; i < rendered.length; i++) {
    const m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (m > rawPeak) rawPeak = m;
  }
  const targetCeiling = clamp(lerp(0.34, 0.93, Math.min(1, w * 0.72 + res * 0.28)), 0.32, 0.93);
  const scale = targetCeiling / rawPeak;
  for (let i = 0; i < rendered.length; i++) {
    L[i] *= scale;
    R[i] *= scale;
  }

  let postPeak = 0, peakIdx = 0;
  const pkSearchLen = Math.min(rendered.length, Math.round(0.12 * SR));
  for (let i = 0; i < pkSearchLen; i++) {
    const m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (m > postPeak) { postPeak = m; peakIdx = i; }
  }

  let endIdx = rendered.length - 1;
  const minFrames = Math.min(rendered.length, Math.round(0.25 * SR));
  while (endIdx > minFrames && Math.max(Math.abs(L[endIdx]), Math.abs(R[endIdx])) < 0.0005) endIdx--;
  const trimLen = Math.min(rendered.length, endIdx + Math.round(0.015 * SR));

  const nameStr = bankItem.name || bankItem.label || ('音色 ' + g);
  const entry = {
    key, grade: g, label: nameStr.startsWith('#') ? nameStr : `#${g} ${nameStr}`,
    desc: bankItem.desc || '', weight: w, resonance: res,
    sampleRate: SR, length: trimLen, durationS: +(trimLen / SR).toFixed(4),
    peakIndex: peakIdx, peakOffsetS: +(peakIdx / SR).toFixed(5),
    buffer: rendered, L: L.subarray(0, trimLen), R: R.subarray(0, trimLen)
  };
  if (renderCache.size > 64) renderCache.delete(renderCache.keys().next().value);
  renderCache.set(key, entry);
  return entry;
}

function encodeWavStereo16(entry){
  const n = entry.length, sr = entry.sampleRate, dataBytes = n * 4, total = 44 + dataBytes;
  const buf = new ArrayBuffer(total), dv = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, total - 8, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  wr(36, 'data'); dv.setUint32(40, dataBytes, true);
  const L = entry.L, R = entry.R;
  let p = 44;
  for (let i = 0; i < n; i++) {
    const sl = clamp(L[i], -1, 1), sr0 = clamp(R[i], -1, 1);
    dv.setInt16(p, sl < 0 ? Math.round(sl * 32768) : Math.round(sl * 32767), true);
    dv.setInt16(p + 2, sr0 < 0 ? Math.round(sr0 * 32768) : Math.round(sr0 * 32767), true);
    p += 4;
  }
  return new Uint8Array(buf);
}

let liveCtx = null, muted = false;
const activeNodes = new Set();
function ensureLiveCtx(){
  if (!liveCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) liveCtx = new AC({ sampleRate: SR });
  }
  if (liveCtx && liveCtx.state === 'suspended') liveCtx.resume().catch(() => {});
  return liveCtx;
}
// playGen: bumped by stopAll() so an async render that finishes after a stop/pause never starts playing
let playGen = 0;
function stopNodes(){
  for (const s of activeNodes) { try { s.stop(); } catch (_) {} }
  activeNodes.clear();
}
function stopAll(){
  playGen++;
  for (const s of activeNodes) { try { s.stop(); } catch (_) {} }
  activeNodes.clear();
}
function playEntryAt(entry, timeUntilT0){
  if (muted) return false;
  const ctx = ensureLiveCtx();
  if (!ctx || ctx.state !== 'running') return false;
  const src = ctx.createBufferSource();
  src.buffer = entry.buffer;
  src.connect(ctx.destination);
  activeNodes.add(src);
  src.onended = () => activeNodes.delete(src);
  const lead = timeUntilT0 - entry.peakOffsetS;
  if (lead >= 0) src.start(ctx.currentTime + lead, 0, entry.durationS);
  else {
    const off = Math.min(Math.max(0, entry.durationS - 0.01), -lead);
    src.start(ctx.currentTime, off, Math.max(0.01, entry.durationS - off));
  }
  return true;
}

async function scheduleAtClash(sfxCfg, timeUntilT0){
  if (!sfxCfg || !sfxCfg.on || muted) return null;
  const tReq = performance.now(), g = playGen;
  const entry = await renderSfx(sfxCfg);
  if (g !== playGen || muted) return null;
  const elapsed = (performance.now() - tReq) / 1000;
  playEntryAt(entry, timeUntilT0 - elapsed);
  return entry;
}

async function previewNow(sfxCfg){
  if (!sfxCfg) return null;
  ensureLiveCtx();
  const g = ++playGen;
  const entry = await renderSfx(sfxCfg);
  if (g !== playGen) return entry;   // a newer preview / stop happened while rendering
  if (!muted) {
    stopNodes();
    const ctx = ensureLiveCtx();
    if (ctx && ctx.state === 'running') {
      const src = ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.connect(ctx.destination);
      activeNodes.add(src);
      src.onended = () => activeNodes.delete(src);
      src.start(ctx.currentTime, 0, entry.durationS);
    }
  }
  return entry;
}

function drawWave(canvas, entry){
  if (!canvas || !entry) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.clientWidth || 320) * dpr, H = (canvas.clientHeight || 58) * dpr;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const x = canvas.getContext('2d');
  x.fillStyle = '#14161a'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(245,241,232,0.10)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, H * 0.5); x.lineTo(W, H * 0.5); x.stroke();
  const L = entry.L, R = entry.R, showLen = Math.min(entry.length, Math.round(Math.min(entry.durationS, 0.95) * entry.sampleRate));
  const step = Math.max(1, Math.floor(showLen / W));
  x.fillStyle = '#ffb347';
  for (let px = 0; px < W; px++) {
    const i0 = Math.floor((px / W) * showLen), i1 = Math.min(showLen, i0 + step);
    let pk = 0;
    for (let i = i0; i < i1; i++) { const m = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (m > pk) pk = m; }
    const hh = Math.max(1.2, pk * H * 0.88);
    x.fillRect(px, (H - hh) * 0.5, 1, hh);
  }
  const pxPeak = clamp((entry.peakIndex / showLen) * W, 2, W - 2);
  x.strokeStyle = '#4d88ff'; x.lineWidth = Math.max(1.5, 1.5 * dpr);
  x.beginPath(); x.moveTo(pxPeak, 0); x.lineTo(pxPeak, H); x.stroke();
  x.fillStyle = 'rgba(245,241,232,0.88)';
  x.font = `600 ${Math.round(10.5 * dpr)}px "Segoe UI",system-ui,sans-serif`;
  x.fillText(`波峰对齐 T0 (${(entry.peakOffsetS * 1000).toFixed(1)} ms) · 总长 ${entry.durationS.toFixed(2)}s`, Math.min(W - 188 * dpr, pxPeak + 5 * dpr), 13 * dpr);
}

async function exportWav(sfxCfg){
  const entry = await renderSfx(sfxCfg);
  return {
    wavBytes: encodeWavStereo16(entry),
    peakOffsetS: entry.peakOffsetS,
    durationS: entry.durationS,
    sampleRate: entry.sampleRate,
    grade: entry.grade,
    label: entry.label,
    weight: entry.weight,
    resonance: entry.resonance
  };
}

['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (!muted) ensureLiveCtx(); }, { passive: true }));

window.PARRY_AUDIO = {
  SR, getBankEntry, renderSfx, encodeWavStereo16, exportWav, scheduleAtClash, previewNow, stopAll, drawWave,
  unlock: ensureLiveCtx,
  get muted(){ return muted; },
  setMuted(m){ muted = !!m; if (muted) stopAll(); else ensureLiveCtx(); return muted; }
};
window.dispatchEvent(new Event('parry-audio'));
})();
