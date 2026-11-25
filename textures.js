// 程式生成貼圖（全部在瀏覽器裡用 canvas 畫出來，沒有下載任何圖片或模型檔）
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// 由高度圖算出法線貼圖（Sobel）
function heightToNormal(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h); const octx = out.getContext('2d');
  const img = octx.createImageData(w, h); const d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(c, srgb, rx = 1, ry = 1, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * 裝甲板貼圖組：板縫、檢修艙口、鉚釘、補強肋、少量發光窗/燈
 * opts: {size, seed, cols, rows, baseRough, roughVar, tone, lights, ribs, normalStrength}
 */
export function hullSet(o) {
  const S = o.size, r = rng(o.seed || 1);
  const hc = canvas(S, S), cc = canvas(S, S), mc = canvas(S, S), ec = canvas(S, S);
  const h = hc.getContext('2d'), c = cc.getContext('2d'), m = mc.getContext('2d'), e = ec.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
  c.fillStyle = o.tone || '#c8ccd2'; c.fillRect(0, 0, S, S);
  m.fillStyle = 'rgb(0,' + Math.round(o.baseRough * 255) + ',255)'; m.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  const seam = Math.max(1, Math.round(S / 512));
  const cw = S / o.cols, ch = S / o.rows;
  const panels = [];
  const split = (x, y, w, hh, depth) => {
    if (depth > 0 && r() < 0.62 && (w > S / 40 || hh > S / 40)) {
      if (w > hh ? r() < 0.8 : r() < 0.2) { const f = 0.3 + r() * 0.4; split(x, y, w * f, hh, depth - 1); split(x + w * f, y, w * (1 - f), hh, depth - 1); }
      else { const f = 0.3 + r() * 0.4; split(x, y, w, hh * f, depth - 1); split(x, y + hh * f, w, hh * (1 - f), depth - 1); }
    } else panels.push([x, y, w, hh]);
  };
  for (let i = 0; i < o.cols; i++) for (let j = 0; j < o.rows; j++) split(i * cw, j * ch, cw, ch, 3);
  for (const [x, y, w, hh] of panels) {
    const lift = 128 + (r() - 0.5) * 18;
    h.fillStyle = `rgb(${lift},${lift},${lift})`; h.fillRect(x, y, w, hh);
    const tv = 1 + (r() - 0.5) * (o.toneVar || 0.08);
    const base = new THREE.Color(o.tone || '#c8ccd2').multiplyScalar(tv);
    c.fillStyle = '#' + base.getHexString(); c.fillRect(x, y, w, hh);
    const rough = Math.min(1, Math.max(0.02, o.baseRough + (r() - 0.5) * o.roughVar));
    m.fillStyle = `rgb(0,${Math.round(rough * 255)},255)`; m.fillRect(x, y, w, hh);
    // 板縫
    h.strokeStyle = '#202020'; h.lineWidth = seam * 1.5; h.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    c.strokeStyle = 'rgba(20,22,26,0.55)'; c.lineWidth = seam; c.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    m.strokeStyle = 'rgb(0,200,255)'; m.lineWidth = seam; m.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
    // 檢修艙口
    if (r() < 0.18 && w > S / 30 && hh > S / 30) {
      const iw = w * (0.3 + r() * 0.3), ih = hh * (0.3 + r() * 0.3), ix = x + (w - iw) / 2, iy = y + (hh - ih) / 2;
      h.strokeStyle = '#3a3a3a'; h.lineWidth = seam; h.strokeRect(ix, iy, iw, ih);
      h.fillStyle = `rgb(${lift - 10},${lift - 10},${lift - 10})`; h.fillRect(ix + seam, iy + seam, iw - 2 * seam, ih - 2 * seam);
      c.strokeStyle = 'rgba(30,30,35,0.5)'; c.strokeRect(ix, iy, iw, ih);
    }
    // 鉚釘排
    if (r() < 0.3) {
      h.fillStyle = '#b8b8b8'; const step = Math.max(4, S / 128);
      for (let k = x + step; k < x + w - step / 2; k += step) { h.fillRect(k, y + step * 0.5, seam * 1.5, seam * 1.5); h.fillRect(k, y + hh - step * 0.6, seam * 1.5, seam * 1.5); }
    }
    // 補強肋
    if (o.ribs && r() < o.ribs) {
      const n = 2 + Math.floor(r() * 4);
      for (let k = 1; k <= n; k++) {
        const yy = y + hh * k / (n + 1);
        h.fillStyle = '#c4c4c4'; h.fillRect(x + 2, yy - seam, w - 4, seam * 2.5);
        h.fillStyle = '#505050'; h.fillRect(x + 2, yy + seam * 1.5, w - 4, seam);
      }
    }
    // 發光窗/燈
    if (o.lights && r() < o.lights && w > S / 25) {
      const n = Math.floor(w / (S / 90)); const yy = y + hh * (0.2 + r() * 0.6);
      const col = r() < 0.85 ? '#ffd9a0' : '#9fd8ff';
      for (let k = 0; k < n; k++) if (r() < 0.75) {
        const xx = x + (k + 0.5) * w / n;
        e.fillStyle = col; e.fillRect(xx - seam, yy - seam, seam * 2.2, seam * 1.6);
        h.fillStyle = '#404040'; h.fillRect(xx - seam, yy - seam, seam * 2.2, seam * 1.6);
        c.fillStyle = '#101218'; c.fillRect(xx - seam, yy - seam, seam * 2.2, seam * 1.6);
      }
    }
  }
  // 細微刮痕/顆粒（粗糙度與顏色）
  const grain = S * S / 600;
  for (let i = 0; i < grain; i++) {
    const x = r() * S, y = r() * S, a = r() * 0.06;
    m.fillStyle = `rgba(0,${r() < 0.5 ? 255 : 0},255,${a})`; m.fillRect(x, y, 1 + r() * S / 200, 1);
  }
  const rx = o.repeat ? o.repeat[0] : 1, ry = o.repeat ? o.repeat[1] : 1;
  return {
    map: tex(cc, true, rx, ry), normalMap: tex(heightToNormal(hc, o.normalStrength || 2.5), false, rx, ry),
    roughnessMap: tex(mc, false, rx, ry), emissiveMap: tex(ec, true, rx, ry),
  };
}

// 散熱板：鰭片條紋 + 熱輝光
export function radiatorSet(S) {
  const hc = canvas(S, S), ec = canvas(S, S), cc = canvas(S, S);
  const h = hc.getContext('2d'), e = ec.getContext('2d'), c = cc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
  c.fillStyle = '#3a3d42'; c.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  const n = 48;
  for (let i = 0; i < n; i++) {
    const y = i * S / n;
    const g = h.createLinearGradient(0, y, 0, y + S / n);
    g.addColorStop(0, '#303030'); g.addColorStop(0.5, '#e0e0e0'); g.addColorStop(1, '#303030');
    h.fillStyle = g; h.fillRect(0, y, S, S / n);
    c.fillStyle = i % 2 ? '#43464c' : '#373a40'; c.fillRect(0, y + S / n * 0.45, S, S / n * 0.1);
  }
  for (let k = 0; k < 6; k++) { const x = k * S / 6; h.fillStyle = '#1a1a1a'; h.fillRect(x, 0, Math.max(2, S / 200), S); }
  const g = e.createLinearGradient(0, 0, S, 0);
  g.addColorStop(0, 'rgba(255,80,20,0.85)'); g.addColorStop(0.35, 'rgba(160,30,8,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  e.fillStyle = g; e.fillRect(0, 0, S, S);
  return { map: tex(cc, true), normalMap: tex(heightToNormal(hc, 3), false), emissiveMap: tex(ec, true) };
}

// 簡易 value noise / fbm（木星貼圖用）
function noise2(seed) {
  const N = 256, p = new Float32Array(N * N), r = rng(seed);
  for (let i = 0; i < N * N; i++) p[i] = r();
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const a = p[((yi & 255) * N) + (xi & 255)], b = p[((yi & 255) * N) + ((xi + 1) & 255)];
    const c = p[(((yi + 1) & 255) * N) + (xi & 255)], d = p[(((yi + 1) & 255) * N) + ((xi + 1) & 255)];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// 木星：條帶 + 湍流 + 大紅斑（程式生成，非照片）
export function jupiterTexture(W) {
  const H = W / 2, cv = canvas(W, H), ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data, n = noise2(7);
  const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += a * n(x * f, y * f); a *= 0.5; f *= 2.03; } return s; };
  const pal = [[0.92, 0.86, 0.74], [0.78, 0.58, 0.40], [0.95, 0.90, 0.80], [0.66, 0.45, 0.30], [0.88, 0.78, 0.62], [0.55, 0.40, 0.30], [0.90, 0.84, 0.72]];
  const grsX = W * 0.62, grsY = H * 0.64, grsA = W * 0.045, grsB = H * 0.045;
  for (let y = 0; y < H; y++) {
    const lat = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W * 24, v = lat * 12;
      let warp = (fbm(u, v * 3) - 0.5) * 0.05 + (fbm(u * 3, v * 6) - 0.5) * 0.012;
      // 大紅斑附近的渦流
      const ex = (x - grsX) / grsA, ey = (y - grsY) / grsB, er = ex * ex + ey * ey;
      if (er < 6) { const sw = Math.exp(-er * 0.6) * 0.02; warp += sw * Math.sin(Math.atan2(ey, ex) * 2 + er); }
      const b = (lat + warp) * 17.0 + Math.sin(lat * 40) * 0.25;
      const i0 = Math.floor(Math.abs(b)) % pal.length, i1 = (i0 + 1) % pal.length, f = Math.abs(b) % 1;
      const t = f * f * (3 - 2 * f);
      let R = pal[i0][0] + (pal[i1][0] - pal[i0][0]) * t, G = pal[i0][1] + (pal[i1][1] - pal[i0][1]) * t, B = pal[i0][2] + (pal[i1][2] - pal[i0][2]) * t;
      const fine = 0.9 + 0.2 * fbm(u * 6, v * 30);
      R *= fine; G *= fine; B *= fine;
      if (er < 1.3) { const k = Math.max(0, 1 - er / 1.3); const k2 = k * k * (3 - 2 * k); R += (0.78 - R) * k2; G += (0.36 - G) * k2; B += (0.24 - B) * k2; }
      const pole = Math.pow(Math.abs(lat - 0.5) * 2, 6) * 0.5; R *= 1 - pole; G *= 1 - pole; B *= 1 - pole * 0.8;
      const i = (y * W + x) * 4;
      d[i] = Math.min(255, R * 255); d[i + 1] = Math.min(255, G * 255); d[i + 2] = Math.min(255, B * 255); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// 圓形光暈貼圖（核心、太陽、航行燈）
export function glowTexture(S = 128, inner = 'rgba(255,255,255,1)', mid = 'rgba(255,220,180,0.35)') {
  const cv = canvas(S, S), ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner); g.addColorStop(0.18, mid); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
