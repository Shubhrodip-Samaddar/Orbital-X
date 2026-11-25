// Orbital Debris Tracker — Three.js + satellite.js + CelesTrak data
const RE = 6371;          // Earth radius (km)
const K = 1 / 1000;       // km -> scene units (true scale)
const MU = 398600.4418;   // Earth's gravitational parameter (km^3/s^2)
const BASE = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&';

// What to track. `max` limits how many objects are taken from a debris group.
const SOURCES = [
  { q: 'CATNR=25544', group: 'Station' },
  { q: 'CATNR=20580', group: 'Telescope' },
  { q: 'CATNR=27386', group: 'Defunct satellite' },
  { q: 'GROUP=cosmos-2251-debris', group: 'Cosmos 2251 debris', max: 120 },
  { q: 'GROUP=iridium-33-debris', group: 'Iridium 33 debris', max: 120 },
  { q: 'GROUP=fengyun-1c-debris', group: 'Fengyun-1C debris', max: 120 },
];
const COLORS = {
  'Station': [0.2, 1, 0.4], 'Telescope': [0.3, 0.8, 1], 'Defunct satellite': [1, 0.6, 0.1],
  'Cosmos 2251 debris': [1, 0.3, 0.3], 'Iridium 33 debris': [1, 0.45, 0.8],
  'Fengyun-1C debris': [0.95, 0.85, 0.3], 'Demo': [0.8, 0.8, 1],
};
// Approximate real dimensions (metres, longest span) for well-known objects.
const HINT_M = { 25544: 109, 20580: 13.2, 27386: 26 };
const OPS = { '+': 'Active', '-': 'Inactive', P: 'Partially active', B: 'Standby', S: 'Spare',
  X: 'Extended mission', D: 'Decayed', '?': 'Unknown' };

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const objs = [];
let simTime = Date.now(), selected = null, pts = null, orbitLine = null, live = false;
let liveMode = true, lastUpdate = new Date();   // liveMode: clock follows the real time

// ---------- Data loading ----------
async function loadSource(s, refresh = false) {   // refresh=true updates orbits of already-loaded objects
  const text = await (await fetch(BASE + s.q)).text();
  const L = text.trim().split(/\r?\n/).map(x => x.trim());
  let n = 0;
  for (let i = 0; i + 2 < L.length && (!s.max || n < s.max); i += 3) {
    if (!L[i + 1].startsWith('1 ') || !L[i + 2].startsWith('2 ')) continue;
    const sat = satellite.twoline2satrec(L[i + 1], L[i + 2]);
    const rec = {
      name: L[i].replace(/^0 /, ''), id: +L[i + 1].slice(2, 7), group: s.group,
      intl: L[i + 1].slice(9, 17).trim(),
      prop: d => satellite.propagate(sat, d).position,
      period: (2 * Math.PI) / sat.no,            // minutes
    };
    if (refresh) {
      const ex = objs.find(x => x.id === rec.id && x.group === s.group);
      if (ex) { ex.prop = rec.prop; ex.period = rec.period; }
    } else objs.push(rec);
    n++;
  }
}

// Fallback so the app still works offline: simple circular orbits (clearly labelled demo).
function loadDemo() {
  [['Demo Sat A', 420, 51.6, 0, 0, 'Active'], ['Demo Sat B', 800, 98, 90, 40, 'Active'],
   ['Demo Debris 1', 780, 74, 20, 100, 'Inactive (debris)'], ['Demo Debris 2', 850, 82, 200, 10, 'Inactive (debris)'],
   ['Demo Debris 3', 1450, 81, 300, 250, 'Inactive (debris)'], ['Demo Rocket Body', 600, 65, 150, 180, 'Inactive (rocket body)'],
   ['Demo GEO Sat', 35786, 0.1, 0, 60, 'Active']].forEach(([name, alt, inc, raan, ph, st], i) => {
    const r = RE + alt, n = Math.sqrt(MU / r ** 3), I = inc * Math.PI / 180, W = raan * Math.PI / 180, p0 = ph * Math.PI / 180;
    objs.push({ name, id: 90000 + i, group: 'Demo', demo: true, status: st, intl: '', period: 2 * Math.PI / n / 60,
      prop: d => { const u = p0 + n * (d.getTime() / 1000);
        return { x: r * (Math.cos(W) * Math.cos(u) - Math.sin(W) * Math.sin(u) * Math.cos(I)),
                 y: r * (Math.sin(W) * Math.cos(u) + Math.cos(W) * Math.sin(u) * Math.cos(I)),
                 z: r * Math.sin(u) * Math.sin(I) }; } });
  });
}

// ---------- 3D scene ----------
const cv = $('c');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
camera.position.set(0, 9, 20);
const controls = new THREE.OrbitControls(camera, cv);
controls.minDistance = 7; controls.maxDistance = 120; controls.enableDamping = true;

// Earth: day texture + city-lights night texture, blended by the Sun's real position.
// Textures come from the three.js repo; if they fail to load we fall back to a plain blue globe.
const TEX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/';
const loader = new THREE.TextureLoader();
const earth = new THREE.Group();
const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    day: { value: loader.load(TEX + 'earth_atmos_2048.jpg', undefined, undefined, () => { earthMesh.material = new THREE.MeshBasicMaterial({ color: 0x1b4f8f }); }) },
    night: { value: loader.load(TEX + 'earth_lights_2048.png') },
    sun: { value: new THREE.Vector3(1, 0, 0) },
  },
  vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform sampler2D day,night; uniform vec3 sun; varying vec2 vUv; varying vec3 vN;'
    + 'void main(){ float l=dot(normalize(vN),sun); float k=smoothstep(-.15,.15,l);'
    + 'vec3 d=texture2D(day,vUv).rgb*(.3+.8*max(l,0.)); vec3 n=texture2D(night,vUv).rgb*1.3+texture2D(day,vUv).rgb*.06;'
    + 'gl_FragColor=vec4(mix(n,d,k),1.); }',
});
const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(RE * K, 64, 48), earthMat);
earth.add(earthMesh);
scene.add(earth);

// Atmosphere glow (fresnel rim, additive) — cheap and GPU-friendly.
scene.add(new THREE.Mesh(new THREE.SphereGeometry(RE * K * 1.03, 48, 32), new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'varying vec3 vN; void main(){ float i=pow(max(.72-dot(vN,vec3(0.,0.,1.)),0.),3.); gl_FragColor=vec4(.3,.6,1.,1.)*i*1.6; }',
  side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
})));

// Starfield
const starPos = new Float32Array(2400);
for (let i = 0; i < 2400; i += 3) {
  const v = new THREE.Vector3().randomDirection ? new THREE.Vector3().randomDirection() : new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
  starPos.set([v.x * 300, v.y * 300, v.z * 300], i);
}
const stars = new THREE.BufferGeometry(); stars.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x9aa8c8, size: 1.2, sizeAttenuation: false })));

// Approximate Sun direction (ECI -> three.js axes) for the day/night line.
function sunDir(d) {
  const n = d.getTime() / 86400000 + 2440587.5 - 2451545.0, R = Math.PI / 180;
  const L = (280.46 + 0.9856474 * n) % 360, g = (357.528 + 0.9856003 * n) * R;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R, eps = 23.439 * R;
  const x = Math.cos(lam), y = Math.cos(eps) * Math.sin(lam), z = Math.sin(eps) * Math.sin(lam);
  return new THREE.Vector3(x, z, -y);
}

function ring(radiusKm, color) {      // reference ring on the equatorial plane
  const pts = Array.from({ length: 129 }, (_, i) => { const a = i / 128 * 2 * Math.PI;
    return new THREE.Vector3(Math.cos(a) * radiusKm * K, 0, Math.sin(a) * radiusKm * K); });
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
}
scene.add(ring(RE + 2000, 0x66ccff));   // top of Low Earth Orbit
scene.add(ring(42164, 0xffcc66));       // geostationary orbit

function resize() {
  const v = $('view'); renderer.setSize(v.clientWidth, v.clientHeight, false);
  camera.aspect = v.clientWidth / v.clientHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- Size helpers ----------
function score(o) {   // 0..1 relative size
  const h = HINT_M[o.id]; if (h) return Math.log10(h + 1) / Math.log10(121);
  const m = o.meta || {}, s = String(m.RCS_SIZE || '').toUpperCase(), r = parseFloat(m.RCS);
  if (s === 'LARGE' || r >= 1) return 0.55;
  if (s === 'MEDIUM' || r >= 0.1) return 0.35;
  if (s === 'SMALL' || r > 0) return 0.15;
  return 0;
}
const pxSize = o => 4 + score(o) * 10 + (o === selected ? 6 : 0);

function buildPoints() {
  const n = objs.length, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('col', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  objs.forEach((o, i) => g.attributes.col.setXYZ(i, ...COLORS[o.group]));
  pts = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexShader: 'attribute float size; attribute vec3 col; varying vec3 c; void main(){ c=col; gl_PointSize=size; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 c; void main(){ if(length(gl_PointCoord-.5)>.5) discard; gl_FragColor=vec4(c,1.); }',
  }));
  pts.frustumCulled = false;
  scene.add(pts); refreshSizes();
}
function refreshSizes() { objs.forEach((o, i) => pts.geometry.attributes.size.setX(i, pxSize(o))); pts.geometry.attributes.size.needsUpdate = true; }

function updatePositions() {
  if (!pts) return;
  const d = new Date(simTime), pos = pts.geometry.attributes.position;
  objs.forEach((o, i) => {
    const p = o.prop(d);
    if (p && isFinite(p.x)) { o.p = p; pos.setXYZ(i, p.x * K, p.z * K, -p.y * K); }   // ECI (z north) -> three.js (y up)
    else { o.p = null; pos.setXYZ(i, 0, 1e4, 0); }
  });
  pos.needsUpdate = true;
}

function drawOrbit(o) {
  if (orbitLine) scene.remove(orbitLine);
  const v = []; o.track = [];
  for (let i = 0; i <= 180; i++) {
    const t = new Date(simTime + o.period * 60000 * i / 180), p = o.prop(t);
    if (p && isFinite(p.x)) { v.push(new THREE.Vector3(p.x * K, p.z * K, -p.y * K)); o.track.push(geo(p, t)); }
  }
  orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: 0xffffff }));
  scene.add(orbitLine);
}

// ---------- Info panel ----------
function regime(alt) { return alt < 2000 ? 'Low Earth Orbit (LEO)' : alt < 35586 ? 'Medium Earth Orbit (MEO)' : alt <= 35986 ? 'Geostationary belt (GEO)' : 'High orbit'; }
function statusOf(o) {
  if (o.demo) return o.status;
  const m = o.meta; if (!m) return 'Loading…';
  if (m.OBJECT_TYPE === 'DEB') return 'Inactive (debris)';
  if (m.OBJECT_TYPE === 'R/B') return 'Inactive (rocket body)';
  return OPS[m.OPS_STATUS_CODE] || 'Unknown';
}
function launchOf(o) {
  const m = o.meta || {};
  if (m.LAUNCH_DATE) return m.LAUNCH_DATE;
  const y = parseInt(o.intl.slice(0, 2), 10);
  return isNaN(y) ? '—' : `${y >= 57 ? 1900 + y : 2000 + y} (year only)`;
}
function sizeText(o) {
  const m = o.meta || {}, h = HINT_M[o.id];
  if (h) return `≈ ${h} m (approx. longest span)`;
  if (m.RCS_SIZE || m.RCS) return `Radar cross-section: ${esc(m.RCS_SIZE || m.RCS + ' m²')}`;
  return o.meta ? 'Unknown' : 'Loading…';
}
function showInfo() {
  const o = selected; if (!o) return;
  const s = score(o);
  $('info').innerHTML = `<h2>${esc(o.name)}</h2><table>
    <tr><td>NORAD ID</td><td>${o.demo ? '— (demo)' : o.id}</td></tr>
    <tr><td>Group</td><td>${esc(o.group)}</td></tr>
    <tr><td>Status</td><td>${esc(statusOf(o))}</td></tr>
    <tr><td>Launch date</td><td>${esc(launchOf(o))}</td></tr>
    <tr><td>Type / owner</td><td>${esc((o.meta && o.meta.OBJECT_TYPE) || '—')} / ${esc((o.meta && o.meta.OWNER) || '—')}</td></tr>
    <tr><td>Size</td><td>${sizeText(o)}<div class="bar"><b style="width:${Math.round(s * 100)}%"></b></div></td></tr>
    <tr><td>Latitude</td><td id="l-lat">—</td></tr>
    <tr><td>Longitude</td><td id="l-lon">—</td></tr>
    <tr><td>Altitude</td><td id="l-alt">—</td></tr>
    <tr><td>From Earth's centre</td><td id="l-ctr">—</td></tr>
    <tr><td>Orbit regime</td><td id="l-reg">—</td></tr>
    <tr><td>Distance to ISS</td><td id="l-iss">—</td></tr></table>`;
  updateLive();
}
function updateLive() {
  const o = selected; if (!o || !o.p || !$('l-alt')) return;
  const g = geo(o.p, new Date(simTime)), alt = g.alt;
  $('l-lat').textContent = Math.abs(g.lat).toFixed(3) + '° ' + (g.lat >= 0 ? 'N' : 'S');
  $('l-lon').textContent = Math.abs(g.lon).toFixed(3) + '° ' + (g.lon >= 0 ? 'E' : 'W');
  const iss = objs.find(x => x.id === 25544 && !x.demo);
  $('l-alt').textContent = alt.toFixed(0) + ' km above surface';
  $('l-ctr').textContent = Math.hypot(o.p.x, o.p.y, o.p.z).toFixed(0) + ' km';
  $('l-reg').textContent = regime(alt);
  $('l-iss').textContent = iss && iss.p && iss !== o
    ? Math.hypot(o.p.x - iss.p.x, o.p.y - iss.p.y, o.p.z - iss.p.z).toFixed(0) + ' km' : '—';
}
async function select(o) {
  selected = o; refreshSizes(); drawOrbit(o); showInfo(); showModel(o); renderList();
  if (!o.meta && !o.demo) {
    try {   // launch date, status, owner, size class come from CelesTrak's SATCAT
      const r = await (await fetch(`https://celestrak.org/satcat/records.php?CATNR=${o.id}&FORMAT=json`)).json();
      o.meta = r[0] || {};
    } catch { o.meta = {}; }
    refreshSizes(); if (selected === o) { showInfo(); showModel(o); }
  }
}

// ---------- List, legend, picking ----------
function renderList() {
  const f = $('q').value.trim().toLowerCase();
  $('list').innerHTML = objs.filter(o => !f || o.name.toLowerCase().includes(f) || String(o.id).includes(f))
    .map(o => `<li data-i="${objs.indexOf(o)}" class="${o === selected ? 'sel' : ''}"><span>${esc(o.name)}</span><small>${esc(o.group)}</small></li>`).join('');
}
$('list').addEventListener('click', e => { const li = e.target.closest('li'); if (li) select(objs[+li.dataset.i]); });
$('q').addEventListener('input', renderList);

let down = null; const tmp = new THREE.Vector3();
cv.addEventListener('pointerdown', e => down = { x: e.clientX, y: e.clientY });
cv.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !pts) return;
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 14;
  objs.forEach((o, i) => {
    if (!o.p) return;
    tmp.set(...['getX', 'getY', 'getZ'].map(k => pts.geometry.attributes.position[k](i))).project(camera);
    const d = Math.hypot((tmp.x + 1) / 2 * r.width - mx, (1 - tmp.y) / 2 * r.height - my);
    if (tmp.z < 1 && d < bd) { bd = d; best = o; }
  });
  if (best) select(best);
});

function buildLegend() {
  const groups = [...new Set(objs.map(o => o.group))];
  $('legend').innerHTML = groups.map(g => `<div><i style="background:rgb(${COLORS[g].map(c => c * 255 | 0)})"></i>${esc(g)}</div>`).join('')
    + '<div><i style="background:#66ccff"></i>LEO limit (2,000 km)</div><div><i style="background:#ffcc66"></i>GEO ring</div>';
}

// ---------- Latitude / longitude + 2D ground-track map ----------
const map = $('map'), mctx = map.getContext('2d');
const toXY = (lat, lon) => [(lon + 180) / 360 * map.width, (90 - lat) / 180 * map.height];
function geo(p, d) {
  const g = satellite.eciToGeodetic(p, satellite.gstime(d));
  return { lat: satellite.degreesLat(g.latitude), lon: satellite.degreesLong(g.longitude), alt: g.height };
}
function drawMap() {
  const img = earthMat.uniforms.day.value.image, d = new Date(simTime);
  mctx.fillStyle = '#0b1a33'; mctx.fillRect(0, 0, map.width, map.height);
  if (img && img.width) mctx.drawImage(img, 0, 0, map.width, map.height);
  mctx.strokeStyle = '#ffffff33'; mctx.beginPath();
  for (let lon = -150; lon < 180; lon += 30) { const [x] = toXY(0, lon); mctx.moveTo(x, 0); mctx.lineTo(x, map.height); }
  for (let lat = -60; lat <= 60; lat += 30) { const [, y] = toXY(lat, 0); mctx.moveTo(0, y); mctx.lineTo(map.width, y); }
  mctx.stroke();
  objs.forEach(o => {
    if (!o.p) return;
    const g = geo(o.p, d), [x, y] = toXY(g.lat, g.lon);
    mctx.fillStyle = `rgb(${COLORS[o.group].map(c => c * 255 | 0)})`; mctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  });
  if (selected && selected.track) {
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.beginPath();
    let prev = null;
    selected.track.forEach(g => {   // break the line where the track wraps around the date line
      const [x, y] = toXY(g.lat, g.lon);
      if (prev && Math.abs(g.lon - prev.lon) < 180) mctx.lineTo(x, y); else mctx.moveTo(x, y);
      prev = g;
    });
    mctx.stroke();
    if (selected.p) { const g = geo(selected.p, d), [x, y] = toXY(g.lat, g.lon); mctx.beginPath(); mctx.arc(x, y, 6, 0, 7); mctx.stroke(); }
    mctx.lineWidth = 1;
  }
}

// ---------- 3D model viewer: Blender .glb models, with simple built-in fallbacks ----------
const mc = $('mc'), mr = new THREE.WebGLRenderer({ canvas: mc, antialias: true, alpha: true });
mr.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const ms = new THREE.Scene(), mcam = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
mcam.position.set(0, 1, 6);
ms.add(new THREE.AmbientLight(0xffffff, 0.7));
const dl = new THREE.DirectionalLight(0xffffff, 1); dl.position.set(3, 4, 5); ms.add(dl);
const MODELS = {}; let curModel = null;
const std = (c, m = 0.5) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: 0.5, flatShading: true });

function fit(obj) {   // centre the model and scale it to a common size
  const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const k = 3 / Math.max(s.x, s.y, s.z); obj.scale.multiplyScalar(k); obj.position.sub(c.multiplyScalar(k));
  const g = new THREE.Group(); g.add(obj); return g;
}
function fallback(name) {
  const g = new THREE.Group();
  if (name === 'satellite') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.4), std(0xbbbbbb)));
    [-1.9, 1.9].forEach(x => { const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 1), std(0x2a5ca8, 0.2)); p.position.x = x; g.add(p); });
  } else if (name === 'rocket_body') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.2, 20), std(0xd0d0d0)));
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.6, 20), std(0x555555)); n.position.y = -1.8; n.rotation.x = Math.PI; g.add(n);
  } else {
    const geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.6 + Math.random() * 0.6), p.getY(i) * (0.6 + Math.random() * 0.6), p.getZ(i) * (0.6 + Math.random() * 0.6));
    geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, std(0x8a7f78, 0.3)));
  }
  return g;
}
['satellite', 'rocket_body', 'fragment'].forEach(name => {
  new THREE.GLTFLoader().load(`models/${name}.glb`,
    gltf => { MODELS[name] = fit(gltf.scene); if (selected) showModel(selected); },
    undefined,
    () => { MODELS[name] = fit(fallback(name)); if (selected) showModel(selected); });   // no .glb found -> built-in shape
});
function modelKind(o) {
  const t = (o.meta && o.meta.OBJECT_TYPE) || '';
  if (t === 'R/B' || /R\/B|ROCKET/i.test(o.name)) return 'rocket_body';
  if (t === 'DEB' || /DEB/i.test(o.name)) return 'fragment';
  return 'satellite';
}
function showModel(o) {
  const m = MODELS[modelKind(o)]; if (!m) return;
  if (curModel) ms.remove(curModel);
  curModel = m.clone(); ms.add(curModel);
  mc.style.display = 'block'; mr.setSize(mc.clientWidth, mc.clientHeight, false);
  mcam.aspect = mc.clientWidth / mc.clientHeight; mcam.updateProjectionMatrix();
}

// ---------- Main loop ----------
let last = performance.now(), acc = 0;
function frame(t) {
  const dt = t - last; last = t; acc += dt;
  if (liveMode) simTime = Date.now(); else simTime += dt * +$('speed').value;
  $('badge').textContent = liveMode ? '● LIVE' : '◷ SIMULATED';
  $('badge').style.color = liveMode ? '#4dff88' : '#ffcc66';
  updatePositions();
  const now = new Date(simTime);
  earth.rotation.y = satellite.gstime(now);
  earthMat.uniforms.sun.value.copy(sunDir(now));
  $('clock').textContent = new Date(simTime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  if (acc > 500) { acc = 0; updateLive(); drawMap(); }
  controls.update(); renderer.render(scene, camera);
  if (curModel) { curModel.rotation.y += 0.01; mr.render(ms, mcam); }
  requestAnimationFrame(frame);
}

(async () => {
  $('speed').addEventListener('change', () => { liveMode = false; });
  $('live').addEventListener('click', () => { liveMode = true; $('speed').value = '1'; });
  await Promise.allSettled(SOURCES.map(s => loadSource(s)));
  live = objs.length > 0;
  if (!live) loadDemo();
  objs.sort((a, b) => Object.keys(COLORS).indexOf(a.group) - Object.keys(COLORS).indexOf(b.group));
  setStatus();
  buildPoints(); buildLegend(); renderList();
  requestAnimationFrame(frame);
  // CelesTrak updates its data every few hours; re-fetch every 2 hours (please don't poll faster).
  if (live) setInterval(async () => {
    await Promise.allSettled(SOURCES.map(s => loadSource(s, true)));
    lastUpdate = new Date(); setStatus();
  }, 2 * 3600 * 1000);
})();

function setStatus() {
  $('status').textContent = live
    ? `CelesTrak data · ${objs.length} objects · orbits fetched ${lastUpdate.toLocaleTimeString()}`
    : 'CelesTrak unreachable — showing offline DEMO data';
}
