// 自然選擇號：全部以程式建模（Three.js 幾何體 + 程式貼圖），不使用任何外部模型檔
// 座標：1 單位 ≈ 10 公尺；艦首朝 +Z，發動機在 -Z。
import * as THREE from 'three';
import { hullSet, radiatorSet, glowTexture, rng } from './textures.js';

const R_FACE = 14;                       // 圓盤面板到艦緣的半徑
export const FRONT = r => 0.9 + 5.0 * Math.pow(Math.max(0, 1 - (r / R_FACE) ** 2), 0.9);
export const REAR = r => -(0.9 + 4.4 * Math.pow(Math.max(0, 1 - (r / R_FACE) ** 2), 0.9));
const Y = new THREE.Vector3(0, 1, 0);

function surfacePoint(d, a, front, lift = 0) {
  const f = front ? FRONT : REAR, e = 0.01;
  const z = f(d), dz = (f(d + e) - f(d - e)) / (2 * e);
  const rad = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
  const n = front ? new THREE.Vector3(-dz * rad.x, -dz * rad.y, 1) : new THREE.Vector3(dz * rad.x, dz * rad.y, -1);
  n.normalize();
  const p = new THREE.Vector3(d * rad.x, d * rad.y, z).addScaledVector(n, lift);
  return { p, n, rad };
}
function placeOn(obj, d, a, front, lift = 0) {
  const { p, n, rad } = surfacePoint(d, a, front, lift);
  obj.position.copy(p);
  obj.quaternion.setFromUnitVectors(Y, n);
  // 讓物件自身的 +Z 大致朝徑向
  const localRad = rad.clone().applyQuaternion(obj.quaternion.clone().invert());
  obj.rotateY(Math.atan2(localRad.x, localRad.z));
  return obj;
}

export function buildShip(Q) {
  const ship = new THREE.Group(); ship.name = 'NaturalSelection';
  const parts = {};
  const part = id => { const g = new THREE.Group(); g.userData.partId = id; parts[id] = g; ship.add(g); return g; };
  const TS = Q.tex; const seg = Q.seg;
  const R = rng(2024);
  const discMats = [];
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

  // ---------- 材質（PBR + 程式貼圖） ----------
  const mirrorT = hullSet({ size: TS, seed: 11, cols: 6, rows: 6, baseRough: 0.13, roughVar: 0.035, tone: '#d0d5dc', toneVar: 0.035, lights: 0.025, normalStrength: 1.8, repeat: [28, 9] });
  const darkT = hullSet({ size: TS, seed: 23, cols: 8, rows: 8, baseRough: 0.4, roughVar: 0.3, tone: '#8d939b', toneVar: 0.1, lights: 0.02, ribs: 0.25, normalStrength: 3.2, repeat: [12, 6] });
  const engT = hullSet({ size: TS, seed: 37, cols: 8, rows: 8, baseRough: 0.34, roughVar: 0.28, tone: '#9aa0a8', toneVar: 0.12, lights: 0.012, ribs: 0.35, normalStrength: 3.2, repeat: [10, 14] });
  const radT = radiatorSet(Math.min(512, TS));

  const mkMirror = () => new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: mirrorT.map, metalness: 1, roughness: 1, roughnessMap: mirrorT.roughnessMap,
    normalMap: mirrorT.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), emissive: 0xffffff, emissiveMap: mirrorT.emissiveMap,
    emissiveIntensity: 1.6, envMapIntensity: 1.25, clearcoat: 0.5, clearcoatRoughness: 0.06, side: THREE.DoubleSide,
  });
  const mkDark = (t = darkT) => new THREE.MeshStandardMaterial({
    color: 0xffffff, map: t.map, metalness: 0.85, roughness: 1, roughnessMap: t.roughnessMap, normalMap: t.normalMap,
    emissive: 0xffffff, emissiveMap: t.emissiveMap, emissiveIntensity: 1.3, envMapIntensity: 1.0,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6a7079, metalness: 0.8, roughness: 0.5, envMapIntensity: 0.9 });
  const trimDisc = trim.clone();
  const dark = new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.6, roughness: 0.7 });
  const darkDisc = dark.clone();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bec6, metalness: 1, roughness: 0.25 });
  const steelDisc = steel.clone();
  const hullMirror = mkMirror(), rimMat = mkDark(), engMat = mkDark(engT), engMat2 = mkDark(darkT);
  discMats.push(hullMirror, rimMat, trimDisc, darkDisc, steelDisc);
  const glow = (c, i = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), toneMapped: true });

  const shadow = o => { o.traverse(m => { if (m.isMesh) { m.castShadow = Q.shadows; m.receiveShadow = Q.shadows; } }); return o; };

  // ---------- 1. 圓盤形主艦體（原著） ----------
  const disc = part('disc');
  {
    const pts = [];
    const N = Math.round(seg / 3);
    for (let i = 0; i <= N; i++) { const r = R_FACE * i / N; pts.push(new THREE.Vector2(r, REAR(r))); }
    pts.push(new THREE.Vector2(14.55, -0.86), new THREE.Vector2(14.95, -0.62), new THREE.Vector2(15.15, -0.2), new THREE.Vector2(15.15, 0.2), new THREE.Vector2(14.95, 0.62), new THREE.Vector2(14.55, 0.86));
    for (let i = N; i >= 0; i--) { const r = R_FACE * i / N; pts.push(new THREE.Vector2(r, FRONT(r))); }
    const g = new THREE.LatheGeometry(pts, seg); g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, hullMirror); disc.add(m);
    // 艦面上的分段環帶（略高於表面，像一圈圈接合的大型裝甲環）
    const band = (r0, r1, front, lift, mat) => {
      const p = []; const f = front ? FRONT : REAR; const n = 10;
      for (let i = 0; i <= n; i++) { const r = r0 + (r1 - r0) * i / n; p.push(new THREE.Vector2(r, f(r) + (front ? lift : -lift))); }
      if (front) p.reverse();
      const bg = new THREE.LatheGeometry(p, seg); bg.rotateX(Math.PI / 2);
      return new THREE.Mesh(bg, mat);
    };
    disc.add(band(12.6, 14.0, true, 0.07, rimMat), band(12.6, 14.0, false, 0.07, rimMat));
    disc.add(band(6.2, 6.6, true, 0.04, trimDisc), band(9.6, 9.85, true, 0.04, trimDisc), band(7.5, 7.8, false, 0.04, trimDisc));
    shadow(disc);
  }

  // ---------- 2. 艦緣環帶 + 航行燈（自行設計） ----------
  const rim = part('rim');
  const navLights = [];
  {
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(15.25, 15.25, 1.15, seg, 1, true), rimMat);
    belt.rotateX(Math.PI / 2); rim.add(belt);
    for (const z of [-0.6, 0.6]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(15.22, 0.09, 8, seg), trimDisc); t.position.z = z; rim.add(t);
    }
    // 環帶上的設備艙（instanced greebles）
    const n = Q.greebles;
    const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), trimDisc, n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, w = 0.2 + R() * 0.9, h = 0.1 + R() * 0.25, d = 0.15 + R() * 0.5;
      o.position.set(Math.cos(a) * (15.25 + h / 2), Math.sin(a) * (15.25 + h / 2), (R() - 0.5) * 0.9);
      o.rotation.set(0, 0, a); o.scale.set(h, w, d); o.updateMatrix(); gm.setMatrixAt(i, o.matrix);
    }
    rim.add(gm);
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2; const strobe = i % 9 === 0;
      const col = strobe ? 0xffffff : (Math.cos(a) > 0 ? 0x33ff66 : 0xff3030);
      const l = new THREE.Mesh(new THREE.SphereGeometry(strobe ? 0.13 : 0.08, 8, 6), glow(col, strobe ? 6 : 3));
      l.position.set(Math.cos(a) * 15.42, Math.sin(a) * 15.42, 0); l.userData.strobe = strobe; l.userData.phase = i * 0.37;
      rim.add(l); navLights.push(l);
    }
    shadow(rim);
  }

  // ---------- 3. 伽馬射線雷射砲塔（武器原著；外形與位置自行設計） ----------
  const lasers = part('gamma');
  {
    const lens = glow(0x7fe8ff, 2.2);
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * Math.PI * 2;
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.55, 20), rimMat); base.position.y = 0.27; t.add(base);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), trimDisc); head.position.y = 0.55; t.add(head);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 16), steelDisc); barrel.position.set(0, 0.95, 0.55); barrel.rotation.x = Math.PI / 2.6; t.add(barrel);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), lens); l.position.set(0, 1.27, 1.31); l.rotation.x = -Math.PI / 2 + Math.PI / 2.6 - Math.PI / 2; t.add(l);
      for (let k = 0; k < 3; k++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), steelDisc); ring.position.set(0, 0.75 + k * 0.17, 0.2 + k * 0.33); ring.rotation.x = Math.PI / 2.6 - Math.PI / 2; t.add(ring); }
      // 放在艦緣外側，砲塔底座朝外
      t.position.set(Math.cos(a) * 15.3, Math.sin(a) * 15.3, 0);
      t.quaternion.setFromUnitVectors(Y, new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      lasers.add(t);
    }
    shadow(lasers);
  }

  // ---------- 4. 電磁動能砲（武器原著；外形自行設計） ----------
  const rails = part('railgun');
  {
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + Math.PI / 6;
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 0.45, 24), trimDisc); base.position.y = 0.2; t.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 6, 24), steelDisc); ring.rotation.x = Math.PI / 2; ring.position.y = 0.44; t.add(ring);
      const gun = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.6, 1.7), rimMat); gun.add(body);
      for (const sx of [-0.24, 0.24]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.22, 4.4), steelDisc); rail.position.set(sx, 0.05, 2.7); gun.add(rail);
      }
      for (let k = 0; k < 5; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.36, 0.13), trimDisc); c.position.set(0, 0.05, 1.3 + k * 0.8); gun.add(c); }
      const coil = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 3.9), glow(0x5aa8ff, 1.8)); coil.position.set(0, 0.1, 2.7); gun.add(coil);
      placeOn(t, 10.6, a, true, -0.05);
      rails.add(t);
      // 砲管抬向艦首方向（法線與徑向之間）
      const { p, n, rad } = surfacePoint(10.6, a, true, 0.5);
      const D = new THREE.Vector3(0, 0, 1).addScaledVector(rad, 0.22).normalize();
      gun.position.copy(p); gun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), D);
      gun.position.addScaledVector(D, 0.5);
      rails.add(gun);
    }
    shadow(rails);
  }

  // ---------- 5. 艦首粒子束發射器 / 感測陣列（武器原著；外形自行設計） ----------
  const beam = part('particle');
  let beamCore;
  {
    const z0 = FRONT(0) - 0.3;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 0.8, seg / 2), rimMat); collar.rotation.x = Math.PI / 2; collar.position.z = z0 + 0.3; beam.add(collar);
    for (let k = 0; k < 4; k++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.0 - k * 0.42, 0.12, 10, seg / 2), k % 2 ? steelDisc : trimDisc);
      r.position.z = z0 + 0.75 + k * 0.2; beam.add(r);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), hullMirror); dish.rotation.x = Math.PI / 2; dish.position.z = z0 + 0.7; dish.scale.set(1, 0.6, 1); beam.add(dish);
    beamCore = new THREE.Mesh(new THREE.CircleGeometry(0.38, 24), glow(0xb48cff, 3)); beamCore.position.z = z0 + 1.38; beam.add(beamCore);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2; const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.5), trimDisc);
      fin.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.6, z0 + 0.8); fin.rotation.z = a + Math.PI / 2; beam.add(fin);
    }
    shadow(beam);
  }

  // ---------- 6. 橢圓形入口（原著） ----------
  const bay = part('hangar');
  let bayRing;
  {
    const t = new THREE.Group();
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), darkDisc); hole.scale.set(1, 0.55, 1); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.03; t.add(hole);
    bayRing = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 8, 64), glow(0xffb45a, 3)); bayRing.scale.set(1, 0.55, 1); bayRing.rotation.x = -Math.PI / 2; bayRing.position.y = 0.06; t.add(bayRing);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.12, 8, 64), trimDisc); frame.scale.set(1, 0.55, 1); frame.rotation.x = -Math.PI / 2; frame.position.y = 0.05; t.add(frame);
    for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow(0xffe0a0, 4)); l.position.set(0, 0.06, 1.4 + i * 0.4); t.add(l); }
    placeOn(t, 8.2, Math.PI / 2, true, 0.02);
    bay.add(t);
    shadow(bay);
  }

  // ---------- 7. 星際魚雷發射口（武器原著；位置自行設計） ----------
  const torp = part('torpedo');
  {
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const t = new THREE.Group();
      const rimH = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.22, 6), trimDisc); rimH.position.y = 0.1; t.add(rimH);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.24, 6), darkDisc); hole.position.y = 0.13; t.add(hole);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), glow(0xff5a3a, 3)); l.position.set(0, 0.24, 0.62); t.add(l);
      placeOn(t, 10.6, a, false, -0.02); torp.add(t);
    }
    shadow(torp);
  }

  // ---------- 8. 連接主幹（自行設計：原著說兩部分完全分離，未說明如何連接） ----------
  const spine = part('spine');
  {
    const z0 = REAR(0) + 0.2, z1 = -12.3, L = z0 - z1, mid = (z0 + z1) / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 1.4, seg / 2), engMat2); hub.rotation.x = Math.PI / 2; hub.position.z = z0 - 0.3; spine.add(hub);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, L, 24), engMat); core.rotation.x = Math.PI / 2; core.position.z = mid; spine.add(core);
    const lon = 3, rr = 1.75, segs = 8, rods = [];
    for (let k = 0; k < lon; k++) {
      const a = k / lon * Math.PI * 2;
      rods.push([new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, z0), new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, z1)]);
      for (let s = 0; s < segs; s++) {
        const a2 = (k + 1) / lon * Math.PI * 2, za = z0 - L * s / segs, zb = z0 - L * (s + 1) / segs;
        rods.push([new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, za), new THREE.Vector3(Math.cos(a2) * rr, Math.sin(a2) * rr, zb)]);
        rods.push([new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, zb), new THREE.Vector3(Math.cos(a2) * rr, Math.sin(a2) * rr, zb)]);
      }
    }
    const rm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), steel, rods.length);
    const o = new THREE.Object3D();
    rods.forEach(([a, b], i) => {
      const d = b.clone().sub(a), len = d.length();
      o.position.copy(a).add(b).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(Y, d.normalize());
      o.scale.set(i % (1 + 2 * segs) === 0 ? 0.13 : 0.07, len, i % (1 + 2 * segs) === 0 ? 0.13 : 0.07); o.updateMatrix(); rm.setMatrixAt(i, o.matrix);
    });
    spine.add(rm);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.3; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, L, 8), trim); p.rotation.x = Math.PI / 2; p.position.set(Math.cos(a) * 1.15, Math.sin(a) * 1.15, mid); spine.add(p); }
    for (const z of [z0 - 1.6, mid, z1 + 0.6]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.35, 24), engMat2); c.rotation.x = Math.PI / 2; c.position.z = z; spine.add(c); }
    shadow(spine);
  }

  // ---------- 9. 圓柱形發動機艙（原著） ----------
  const eng = part('engine');
  {
    const prof = [[0, -31.6], [2.4, -31.6], [3.2, -31.1], [3.55, -30.4], [3.6, -29.6], [3.45, -29.4], [3.45, -29.1], [3.6, -28.9],
      [3.6, -25.3], [3.45, -25.1], [3.45, -24.8], [3.6, -24.6], [3.6, -21.2], [3.45, -21.0], [3.45, -20.7], [3.6, -20.5],
      [3.6, -14.3], [3.45, -13.4], [3.0, -12.7], [2.2, -12.3], [1.1, -12.1], [0, -12.05]].map(([r, z]) => new THREE.Vector2(r, z));
    const g = new THREE.LatheGeometry(prof, seg); g.rotateX(Math.PI / 2);
    eng.add(new THREE.Mesh(g, engMat));
    // 加強環
    for (const z of [-14.8, -20.85, -25, -29.25, -31.0]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.85, 0.55, seg, 1, true), engMat2); b.rotation.x = Math.PI / 2; b.position.z = z; eng.add(b);
      const t1 = new THREE.Mesh(new THREE.TorusGeometry(3.86, 0.06, 6, seg), trim); t1.position.z = z + 0.28; eng.add(t1);
      const t2 = t1.clone(); t2.position.z = z - 0.28; eng.add(t2);
    }
    // 發動機表面設備（instanced）
    const n = Math.round(Q.greebles * 1.4);
    const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), trim, n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      let a = R() * Math.PI * 2; const z = -21.2 - R() * 7.6;
      const w = 0.15 + R() * 0.6, h = 0.06 + R() * 0.25, d = 0.2 + R() * 1.2;
      o.position.set(Math.cos(a) * (3.6 + h / 2), Math.sin(a) * (3.6 + h / 2), z); o.rotation.set(0, 0, a); o.scale.set(h, w, d); o.updateMatrix(); gm.setMatrixAt(i, o.matrix);
    }
    eng.add(gm);
    // 縱向導管
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + 0.13;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 14.6, 8), steel); p.rotation.x = Math.PI / 2; p.position.set(Math.cos(a) * 3.72, Math.sin(a) * 3.72, -22.3); eng.add(p);
    }
    shadow(eng);
  }

  // ---------- 10. 聚變燃料儲槽（自行設計） ----------
  const fuel = part('fuel');
  {
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 4.6, 8, 24), engMat2); t.rotation.x = Math.PI / 2;
      t.position.set(Math.cos(a) * 4.45, Math.sin(a) * 4.45, -17.6); fuel.add(t);
      for (const z of [-15.8, -17.6, -19.4]) { const s = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.07, 6, 24), trim); s.position.set(Math.cos(a) * 4.45, Math.sin(a) * 4.45, z); fuel.add(s); }
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 4.0), trim); st.position.set(Math.cos(a) * 3.85, Math.sin(a) * 3.85, -17.6); st.rotation.z = a + Math.PI / 2; fuel.add(st);
    }
    shadow(fuel);
  }

  // ---------- 11. 散熱板（自行設計） ----------
  const rads = part('radiator');
  const radMat = new THREE.MeshStandardMaterial({ map: radT.map, normalMap: radT.normalMap, emissive: 0xffffff, emissiveMap: radT.emissiveMap, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide });
  {
    const w = 7.4, L = 7.2, zc = -25.1;
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2 + Math.PI / 4;
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, L), radMat); p.position.x = 3.7 + w / 2; g.add(p);
      for (const z of [-L / 2, L / 2]) { const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, 0.18), trim); e.position.set(3.7 + w / 2, 0, z); g.add(e); }
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, L), trim); tip.position.x = 3.7 + w; g.add(tip);
      const root = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, L + 0.4), engMat2); root.position.x = 3.85; g.add(root);
      for (let s = 1; s < 4; s++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.08), trim); sp.position.set(3.7 + w / 2, 0, -L / 2 + L * s / 4); g.add(sp); }
      g.rotation.z = a; g.position.z = zc; rads.add(g);
    }
    shadow(rads);
  }

  // ---------- 12. 輻射推進反射鏡（自行詮釋：無工質輻射推進） ----------
  const refl = part('reflector');
  const FOCUS = new THREE.Vector3(0, 0, -33.6);
  {
    const f = 2.0, zv = -31.4, Rm = 7.6, n = 28;
    const outer = [], inner = [];
    for (let i = 0; i <= n; i++) { const r = Rm * i / n, z = zv - r * r / (4 * f); outer.push(new THREE.Vector2(r + 0.0, z + 0.28)); inner.push(new THREE.Vector2(r, z)); }
    const go = new THREE.LatheGeometry(outer.reverse(), seg); go.rotateX(Math.PI / 2);
    const gi = new THREE.LatheGeometry(inner, seg); gi.rotateX(Math.PI / 2);
    refl.add(new THREE.Mesh(go, engMat2));
    const goldMat = new THREE.MeshPhysicalMaterial({ color: 0xffd7a0, metalness: 1, roughness: 0.14, envMapIntensity: 0.8, emissive: 0x552200, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    refl.userData.gold = goldMat;
    const innerMesh = new THREE.Mesh(gi, goldMat); refl.add(innerMesh);
    // 反射鏡內面的分段環（像蜂巢鏡片）
    for (let i = 1; i < 6; i++) { const r = Rm * i / 6; const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, seg), trim); t.position.z = zv - r * r / (4 * f) - 0.02; refl.add(t); }
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; const pts = []; for (let i = 1; i <= 12; i++) { const r = Rm * i / 12; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, zv - r * r / (4 * f) - 0.03)); } refl.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.04, 4), trim)); }
    const lip = new THREE.Mesh(new THREE.TorusGeometry(Rm, 0.3, 12, seg), engMat2); lip.position.z = zv - Rm * Rm / (4 * f) + 0.1; refl.add(lip);
    // 約束場線圈支架（固定聚變核心）
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + Math.PI / 2; const p0 = new THREE.Vector3(Math.cos(a) * Rm, Math.sin(a) * Rm, lip.position.z); const d = FOCUS.clone().sub(p0);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, d.length(), 8), steel); s.position.copy(p0).addScaledVector(d, 0.5); s.quaternion.setFromUnitVectors(Y, d.normalize()); refl.add(s);
    }
    const coil = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 10, 40), steel); coil.position.copy(FOCUS); refl.add(coil);
    const coil2 = coil.clone(); coil2.rotation.y = Math.PI / 2; refl.add(coil2);
    shadow(refl);
    innerMesh.castShadow = false;
  }

  // ---------- 13. 聚變核心「小太陽」與尾焰（原著提到；外觀為視覺化） ----------
  const sun = part('fusion');
  const plumeMats = [];
  {
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.93, 0.85).multiplyScalar(12) });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), coreMat); core.position.copy(FOCUS); sun.add(core);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256, 'rgba(255,250,240,1)', 'rgba(255,200,140,0.45)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    spr.scale.set(10, 10, 1); spr.position.copy(FOCUS); sun.add(spr); spr.userData.noPick = true;
    const mk = (r0, r1, L, ca, cb, inten, fall) => {
      const g = new THREE.CylinderGeometry(r0, r1, L, 64, 24, true); g.translate(0, -L / 2, 0); g.rotateX(Math.PI / 2);
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPower: { value: 1 }, uA: { value: new THREE.Color(ca) }, uB: { value: new THREE.Color(cb) }, uI: { value: inten }, uF: { value: fall } },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `uniform float uTime,uPower,uI,uF; uniform vec3 uA,uB; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ float s=1.-vUv.y; float facing=abs(dot(normalize(vN),normalize(vV)));
            float body=pow(facing,1.6);
            float fall=exp(-s*uF/uPower)*smoothstep(0.,.03,s);
            float shock=.78+.22*sin(s*70.-uTime*30.);
            float streak=.8+.2*sin(vUv.x*6.2832*9.+s*12.-uTime*4.)*sin(vUv.x*6.2832*5.-uTime*2.3);
            vec3 c=mix(uA,uB,clamp(s*1.4,0.,1.));
            gl_FragColor=vec4(c*body*fall*shock*streak*uI*uPower,1.); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m); mesh.position.copy(FOCUS); mesh.userData.noPick = true; plumeMats.push(m); return mesh;
    };
    sun.add(mk(6.8, 9.5, 80, 0xd8e6ff, 0x6a4cff, 0.55, 3.2));   // 反射鏡準直後的輻射光柱
    sun.add(mk(0.7, 3.2, 55, 0xffffff, 0x8fb8ff, 1.6, 4.0));     // 中央高溫噴流
    const light = new THREE.PointLight(0xffd2a0, 160, 40, 1.8); light.position.copy(FOCUS).add(new THREE.Vector3(0, 0, 0.5)); sun.add(light);
    sun.userData.core = core; sun.userData.sprite = spr; sun.userData.light = light; sun.userData.coreMat = coreMat;
  }

  // ---------- 14. 姿態控制推進器（自行設計） ----------
  const rcs = part('rcs');
  {
    const mkPod = () => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), trim); b.position.y = 0.25; g.add(b);
      for (const [x, z] of [[0, 0.45], [0, -0.45], [0.45, 0], [-0.45, 0]]) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.3, 10, 1, true), dark); n.position.set(x, 0.25, z); n.rotation.set(z ? Math.PI / 2 * Math.sign(z) : 0, 0, x ? -Math.PI / 2 * Math.sign(x) : 0); g.add(n); }
      return g;
    };
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * Math.PI * 2;
      const p = mkPod(); p.position.set(Math.cos(a) * 3.6, Math.sin(a) * 3.6, -13.6); p.quaternion.setFromUnitVectors(Y, new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); rcs.add(p);
      const p2 = mkPod(); placeOn(p2, 13.2, a + Math.PI / 4, false, 0.05); rcs.add(p2);
    }
    shadow(rcs);
  }

  // ---------- 15. 內部球形艙室（剖面模式；原著：艙室都是球形） ----------
  const cabins = part('cabins');
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.55, metalness: 0.0, emissive: 0x334455, emissiveIntensity: 0.15, side: THREE.DoubleSide, clippingPlanes: [clipPlane] });
  {
    const hang = new THREE.Mesh(new THREE.SphereGeometry(4.5, 48, 32), cabinMat); hang.position.z = (FRONT(0) + REAR(0)) / 2 - 0.1; cabins.add(hang);
    const list = [[0, 0, hang.position.z, 4.5]];
    for (let tries = 0; tries < 6000 && list.length < Q.cabins; tries++) {
      const rs = 0.35 + Math.pow(R(), 2) * 1.6, d = R() * 13.2, a = R() * Math.PI * 2;
      const zMin = REAR(d) + 0.35 + rs, zMax = FRONT(d) - 0.35 - rs; if (zMax < zMin) continue;
      const x = Math.cos(a) * d, y = Math.sin(a) * d, z = zMin + R() * (zMax - zMin);
      if (list.some(([X, Yy, Z, Rr]) => (X - x) ** 2 + (Yy - y) ** 2 + (Z - z) ** 2 < (Rr + rs + 0.15) ** 2)) continue;
      list.push([x, y, z, rs]);
    }
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), cabinMat, list.length - 1);
    const o = new THREE.Object3D();
    list.slice(1).forEach(([x, y, z, r], i) => { o.position.set(x, y, z); o.scale.setScalar(r); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    cabins.add(im);
    cabins.visible = false;
    cabins.userData.count = list.length;
  }

  // ---------- 動畫 / 狀態 ----------
  let boost = 0, boostTarget = 0;
  const api = {
    group: ship, parts, FOCUS, cabinCount: cabins.userData.count,
    setCutaway(on) {
      for (const m of discMats) { m.clippingPlanes = on ? [clipPlane] : null; m.needsUpdate = true; }
      const v = new THREE.Vector3();
      for (const id of ['gamma', 'railgun', 'torpedo', 'hangar', 'particle', 'rim']) parts[id].traverse(o => {
        if (o.isMesh && !o.userData.noPick && !discMats.includes(o.material)) { o.getWorldPosition(v); o.visible = !(on && v.x > 0.3); }
      });
      cabins.visible = on;
    },
    setBoost(on) { boostTarget = on ? 1 : 0; },
    get boost() { return boostTarget; },
    update(t, dt) {
      boost += (boostTarget - boost) * Math.min(1, dt * 1.5);
      const p = 1 + boost * 1.4;
      for (const m of plumeMats) { m.uniforms.uTime.value = t; m.uniforms.uPower.value = p; }
      const fl = 1 + 0.04 * Math.sin(t * 41) + 0.03 * Math.sin(t * 23);
      sun.userData.sprite.scale.setScalar(10 * (1 + boost * 0.8) * fl);
      sun.userData.light.intensity = 160 * p * fl;
      sun.userData.coreMat.color.setRGB(1, 0.93, 0.85).multiplyScalar(12 * p);
      for (const l of navLights) if (l.userData.strobe) l.visible = ((t + l.userData.phase) % 1.6) < 0.09;
      bayRing.material.color.setRGB(1, 0.7, 0.35).multiplyScalar(2.2 + Math.sin(t * 2) * 0.8);
      beamCore.material.color.setRGB(0.7, 0.55, 1).multiplyScalar(2.5 + Math.sin(t * 1.3) * 1.0);
      // 深海狀態：前進四時艙室注滿深海加速液（變成藍綠色）
      cabinMat.color.setRGB(0.62 - boost * 0.5, 0.64 - boost * 0.3, 0.66 - boost * 0.2);
      cabinMat.emissive.setRGB(0.2 * (1 - boost) + 0.02, 0.27 * (1 - boost) + boost * 0.25, 0.33 * (1 - boost) + boost * 0.4);
      cabinMat.emissiveIntensity = 0.15 + boost * 0.9;
    },
  };
  return api;
}
