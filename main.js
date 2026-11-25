import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildShip } from './ship.js';
import { jupiterTexture, glowTexture, rng } from './textures.js';
import { PARTS, TAGS } from './parts.js';

// ---------- 畫質分級（自動偵測 + 執行中依幀時間自動降級） ----------
const qs = new URLSearchParams(location.search);
const TIERS = {
  high: { name: '高', dpr: 2, shadows: true, shadowSize: 2048, bloom: true, bloomScale: 1, stars: 14000, tex: 1024, seg: 160, greebles: 420, cabins: 140, jup: 2048 },
  mid: { name: '中', dpr: 1.5, shadows: true, shadowSize: 1024, bloom: true, bloomScale: 0.5, stars: 8000, tex: 1024, seg: 128, greebles: 300, cabins: 110, jup: 1024 },
  low: { name: '低', dpr: 1, shadows: false, shadowSize: 512, bloom: false, bloomScale: 0.5, stars: 3500, tex: 512, seg: 72, greebles: 140, cabins: 70, jup: 512 },
  min: { name: '最低', dpr: 0.75, shadows: false, shadowSize: 512, bloom: false, bloomScale: 0.5, stars: 2000, tex: 512, seg: 72, greebles: 140, cabins: 70, jup: 512 },
};
const ORDER = ['high', 'mid', 'low', 'min'];
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
const cores = navigator.hardwareConcurrency || 4;
let tierKey = qs.get('q') && TIERS[qs.get('q')] ? qs.get('q') : (isMobile ? (cores >= 8 && devicePixelRatio >= 2.5 ? 'mid' : (cores <= 4 ? 'low' : 'mid')) : (cores <= 4 ? 'mid' : 'high'));
const autoTune = qs.get('auto') !== '0';
const buildTier = TIERS[tierKey];   // 幾何/貼圖細節在載入時決定；執行中只調整 DPR/陰影/bloom
let tier = buildTier;
const status = document.getElementById('status');
const setStatus = (s) => { status.textContent = s; };

// ---------- 渲染器 ----------
const renderer = new THREE.WebGLRenderer({ antialias: tierKey !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, tier.dpr));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = tier.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010103);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 60000);

// ---------- 太空背景：星空 + 銀河 ----------
const SUN_DIR = new THREE.Vector3(0.85, 0.35, -0.1).normalize();
function makeStars(n) {
  const r = rng(99), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const gal = new THREE.Vector3(0.3, 1, 0.2).normalize(); const tmp = new THREE.Vector3();
  const pal = [[0.7, 0.8, 1], [1, 1, 1], [1, 0.95, 0.85], [1, 0.85, 0.65], [1, 0.7, 0.5]];
  for (let i = 0; i < n; i++) {
    tmp.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    if (i % 3 === 0) { const d = tmp.dot(gal); tmp.addScaledVector(gal, -d * (0.85 + r() * 0.15)); }
    tmp.normalize().multiplyScalar(40000);
    pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const c = pal[Math.floor(r() * pal.length)], b = 0.35 + Math.pow(r(), 3) * 1.4;
    col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    size[i] = 0.8 + Math.pow(r(), 8) * 3.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uPR;
      void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=size*uPR*1.6; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vC*a*a,1.); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.userData.noPick = true; return pts;
}
let stars = makeStars(tier.stars); scene.add(stars);
// 銀河淡光帶（程式雜訊）
const sky = new THREE.Mesh(new THREE.SphereGeometry(45000, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec3 vD; float h(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
    float n(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);}
    void main(){ vec3 g=normalize(vec3(.3,1.,.2)); float d=dot(vD,g); float band=exp(-d*d/0.03);
      float f=n(vD*6.)*.5+n(vD*13.)*.3+n(vD*29.)*.2; float dust=smoothstep(.45,.75,n(vD*9.+3.));
      vec3 c=mix(vec3(.10,.09,.13),vec3(.16,.13,.10),f)*band*(f*1.3)*(1.-dust*.7)*0.55; gl_FragColor=vec4(c,1.); }`,
}));
sky.userData.noPick = true; scene.add(sky);

// ---------- 木星（程式生成條帶貼圖） & 遠方太陽 ----------
const jupTex = jupiterTexture(tier.jup);
const JUP_POS = new THREE.Vector3(-0.3, -0.35, 0.88).normalize().multiplyScalar(15500);
const jupiter = new THREE.Mesh(new THREE.SphereGeometry(3400, 96, 64), new THREE.MeshStandardMaterial({ map: jupTex, color: 0x9a9088, roughness: 1, metalness: 0 }));
jupiter.position.copy(JUP_POS); jupiter.rotation.set(0.05, 0.6, 0.06); jupiter.userData.noPick = true; scene.add(jupiter);
// 大氣邊緣光
const atmo = new THREE.Mesh(new THREE.SphereGeometry(3460, 64, 48), new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN_DIR } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW; void main(){ vec3 v=normalize(cameraPosition-vW); float rim=pow(1.-abs(dot(vN,v)),3.); float lit=clamp(dot(vN,uSun)*1.3+.05,0.,1.); gl_FragColor=vec4(vec3(1.,.75,.5)*rim*lit*.6,1.); }`,
}));
atmo.position.copy(JUP_POS); atmo.userData.noPick = true; scene.add(atmo);
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(256, 'rgba(255,255,255,1)', 'rgba(255,240,210,0.25)'), color: new THREE.Color(6, 5.6, 5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
sunSprite.position.copy(SUN_DIR).multiplyScalar(30000); sunSprite.scale.setScalar(1400); sunSprite.userData.noPick = true; scene.add(sunSprite);

// ---------- 光源 ----------
const sunLight = new THREE.DirectionalLight(0xfff3e6, 3.2);
sunLight.position.copy(SUN_DIR).multiplyScalar(80); sunLight.target.position.set(0, 0, -12);
sunLight.castShadow = tier.shadows;
sunLight.shadow.mapSize.set(tier.shadowSize, tier.shadowSize);
Object.assign(sunLight.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 200 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);
scene.add(new THREE.HemisphereLight(0x2a3550, 0x3a2414, 0.3)); // 星光 + 木星反光的微弱補光

// ---------- 艦船 ----------
const ship = buildShip({ tex: buildTier.tex, seg: buildTier.seg, greebles: buildTier.greebles, cabins: buildTier.cabins, shadows: true });
scene.add(ship.group);

// ---------- 環境反射（PMREM：程式產生的木星 + 太陽 + 深空，讓鏡面艦體映出木星） ----------
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vD; void main(){ float u=vD.y*.5+.5; vec3 c=mix(vec3(.012,.010,.012),vec3(.02,.025,.04),u); gl_FragColor=vec4(c,1.); }` })));
  const jd = JUP_POS.clone().normalize();
  const ej = new THREE.Mesh(new THREE.SphereGeometry(34, 64, 32), new THREE.MeshStandardMaterial({ map: jupTex, roughness: 1, metalness: 0 }));
  ej.position.copy(jd).multiplyScalar(85); ej.rotation.copy(jupiter.rotation); env.add(ej);
  const el = new THREE.DirectionalLight(0xffffff, 4.5); el.position.copy(SUN_DIR); env.add(el, new THREE.AmbientLight(0xffffff, 0.06));
  const es = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.5) }));
  es.position.copy(SUN_DIR).multiplyScalar(90); env.add(es);
  // 幾道淡淡的「港口/艦隊」光帶，讓鏡面不是一片死黑
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(60, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.3, 0.4) })); b.position.set(0, -40 + i * 16, -70); b.rotation.z = 0.2; env.add(b); }
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture; pm.dispose();
}

// ---------- 後製：Bloom ----------
let composer, bloom;
function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * tier.bloomScale, innerHeight * tier.bloomScale), 0.75, 0.32, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
setupComposer();

// ---------- 相機與操作（單指旋轉、雙指縮放＋平移） ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.minDistance = 12; controls.maxDistance = 260;
controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
const HOME = { pos: new THREE.Vector3(17.4, 34.1, -61), target: new THREE.Vector3(1.5, 0, -12) };
const portrait = () => innerHeight > innerWidth;
function home() {
  const k = portrait() ? 1.75 : 1.05;
  camera.position.copy(HOME.target).addScaledVector(HOME.pos.clone().sub(HOME.target), k);
  controls.target.copy(HOME.target); controls.update();
}
home();
let idleTimer = 0;
controls.addEventListener('start', () => { fly = null; controls.autoRotate = false; clearTimeout(idleTimer); });
controls.addEventListener('end', () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { controls.autoRotate = true; }, 6000); });

// ---------- 點擊部位：高亮 + 資訊面板 ----------
const hlMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 p=vec4(position,1.);
    #ifdef USE_INSTANCING
      p=instanceMatrix*p; vN=normalize(normalMatrix*mat3(instanceMatrix)*normal);
    #else
      vN=normalize(normalMatrix*normal);
    #endif
    vec4 mv=modelViewMatrix*p; vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `uniform float uT; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.); float pulse=.65+.35*sin(uT*4.); gl_FragColor=vec4(vec3(.25,.85,1.)*(f*1.1+.035)*pulse,1.); }`,
});
const overlays = {};
for (const [id, g] of Object.entries(ship.parts)) {
  const list = [];
  g.traverse(o => {
    if (!o.isMesh || o.userData.noPick || o.material?.blending === THREE.AdditiveBlending || o.isSprite) return;
    const ov = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, hlMat, o.count) : new THREE.Mesh(o.geometry, hlMat);
    if (o.isInstancedMesh) ov.instanceMatrix = o.instanceMatrix;
    ov.visible = false; ov.userData.noPick = true; ov.renderOrder = 10; ov.raycast = () => {};
    o.add(ov); list.push(ov);
  });
  overlays[id] = list;
}
let selected = null;
const panel = document.getElementById('info'), pName = document.getElementById('pname'), pTag = document.getElementById('ptag'), pText = document.getElementById('ptext');
function select(id) {
  if (selected) overlays[selected].forEach(o => { o.visible = false; });
  selected = id;
  if (!id) { panel.classList.remove('show'); return; }
  overlays[id].forEach(o => { o.visible = true; });
  const p = PARTS[id], [tl, tc] = TAGS[p.tag];
  pName.textContent = p.name; pTag.textContent = tl; pTag.style.background = tc; pText.textContent = p.text;
  panel.classList.add('show');
}
document.getElementById('pclose').addEventListener('click', () => select(null));
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const pickables = [];
ship.group.traverse(o => { if (o.isMesh && !o.userData.noPick && !(o.material && o.material.blending === THREE.AdditiveBlending)) pickables.push(o); });
function partOf(o) { while (o) { if (o.userData.partId) return o.userData.partId; o = o.parent; } return null; }
function pickAt(x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickables, false).filter(h => {
    if (!h.object.visible) return false;
    let o = h.object; while (o) { if (!o.visible) return false; o = o.parent; }
    if (cutaway && h.point.x > 0.3 && partOf(h.object) !== 'cabins' && ['disc', 'rim', 'gamma', 'railgun', 'torpedo', 'hangar', 'particle'].includes(partOf(h.object))) return false;
    return true;
  });
  return hits.length ? partOf(hits[0].object) : null;
}
let down = null;
const TAP_MS = +(qs.get('tapms') || 450); // 測試用：無頭瀏覽器很慢時可放寬
renderer.domElement.addEventListener('pointerdown', e => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: e.timeStamp, multi: false }; });
renderer.domElement.addEventListener('touchstart', e => { if (e.touches.length > 1 && down) down.multi = true; }, { passive: true });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || !e.isPrimary) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = e.timeStamp - down.t;
  if (!down.multi && moved < 8 && dt < TAP_MS) select(pickAt(e.clientX, e.clientY));
  down = null;
});

// ---------- 按鈕 ----------
let cutaway = false;
const bBoost = document.getElementById('bBoost'), bCut = document.getElementById('bCut'), bHome = document.getElementById('bHome');
bBoost.addEventListener('click', () => { ship.setBoost(!ship.boost); bBoost.classList.toggle('on', ship.boost); bBoost.textContent = ship.boost ? '前進四（開）' : '前進四'; });
bCut.addEventListener('click', () => {
  cutaway = !cutaway; ship.setCutaway(cutaway); bCut.classList.toggle('on', cutaway);
  if (!cutaway && selected === 'cabins') select(null);
  if (cutaway) flyTo(new THREE.Vector3(portrait() ? 74 : 52, 22, 8), new THREE.Vector3(0, 0, -4));
});
let fly = null;
function flyTo(pos, target) { fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, k: 0 }; controls.autoRotate = false; }
bHome.addEventListener('click', () => { const k = portrait() ? 1.75 : 1.05; flyTo(HOME.target.clone().addScaledVector(HOME.pos.clone().sub(HOME.target), k), HOME.target.clone()); setTimeout(() => { controls.autoRotate = true; }, 1500); });

// ---------- 自動降級 ----------
function applyTier(k) {
  tierKey = k; tier = TIERS[k];
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier.dpr));
  renderer.shadowMap.enabled = tier.shadows; sunLight.castShadow = tier.shadows;
  if (!tier.shadows && sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
  scene.traverse(o => { if (o.material && o.isMesh) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); } });
  scene.remove(stars); stars.geometry.dispose(); stars = makeStars(tier.stars); scene.add(stars);
  setupComposer(); onResize();
}
const perf = { frames: 0, acc: 0, warm: 0, fps: 0, downgrades: [] };
function sample(dt) {
  perf.warm += dt; if (perf.warm < 1.5) return;
  perf.frames++; perf.acc += dt;
  if (perf.frames >= 60 || (perf.acc >= 1.5 && perf.frames >= 4)) {
    const avg = perf.acc / perf.frames; perf.fps = 1 / avg; perf.frames = 0; perf.acc = 0;
    if (autoTune && avg > 1 / 32 && ORDER.indexOf(tierKey) < ORDER.length - 1) {
      const next = ORDER[ORDER.indexOf(tierKey) + 1];
      perf.downgrades.push(`${tierKey}->${next} @${(1 / avg).toFixed(1)}fps`);
      applyTier(next); perf.warm = 0;
    }
    updateStatus();
  }
}
function updateStatus() { setStatus(`畫質：${tier.name}${autoTune ? '（自動）' : ''}${perf.fps ? ' · ' + perf.fps.toFixed(0) + ' fps' : ''}`); }
updateStatus();

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
  if (bloom) bloom.setSize(innerWidth * renderer.getPixelRatio() * tier.bloomScale, innerHeight * renderer.getPixelRatio() * tier.bloomScale);
  stars.material.uniforms.uPR.value = renderer.getPixelRatio();
}
addEventListener('resize', onResize);

// ---------- 主迴圈 ----------
const clock = new THREE.Clock(); let t = 0;
function frame() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.1); t += dt;
  ship.update(t, dt); hlMat.uniforms.uT.value = t;
  jupiter.rotation.y += dt * 0.004;
  if (fly) { fly.k = Math.min(1, fly.k + dt / 1.4); const e = fly.k * fly.k * (3 - 2 * fly.k); camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e); if (fly.k >= 1) fly = null; }
  controls.update();
  if (tier.bloom) composer.render(); else renderer.render(scene, camera);
  sample(raw);
  requestAnimationFrame(frame);
}
document.getElementById('loading').remove();
frame();

// 測試用掛鉤
window.__ns = { get tier() { return tierKey; }, perf, select, pickAt, camera, controls, ship, applyTier, home,
  screenOf(id) { const b = new THREE.Box3().setFromObject(ship.parts[id]); const c = b.getCenter(new THREE.Vector3()).project(camera); return { x: (c.x + 1) / 2 * innerWidth, y: (1 - c.y) / 2 * innerHeight }; } };
