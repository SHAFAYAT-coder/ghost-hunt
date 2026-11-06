import { EQUIPMENT, EVIDENCE, GHOSTS, MAPS, START_CASH, MAX_LOADOUT } from './data.js';
import { buildWorld, buildVan } from './world.js';
import { Me, GhostSim, GhostView } from './game.js';

const EVIDENCE_NEEDED = 3;
const PLAYER_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b];
const SPIRIT_WORDS = ['Help', 'Behind you', 'Leave', 'Cold', 'Who', 'Here', 'Run', 'Hungry'];

const socket = io();
const $ = id => document.getElementById(id);
const keys = {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (text, cls) => el('button', cls, text);
const card = (icon, title, text) => {
  const d = el('div', 'card');
  d.append(el('div', 'icon', icon), el('h4', '', title), el('p', 'help', text));
  return d;
};
const getName = () => $('playerName').value.trim() || 'Hunter';
const ghostName = id => (GHOSTS.find(g => g.id === id) || { name: '???' }).name;

// ---------- Progress (saved in this browser) ----------
let cash = localStorage.getItem('gh_cash') === null ? START_CASH : Number(localStorage.getItem('gh_cash'));
let owned = JSON.parse(localStorage.getItem('gh_owned') || '[]');
let loadout = JSON.parse(localStorage.getItem('gh_loadout') || '[]')
  .filter(k => owned.includes(k))
  .slice(0, MAX_LOADOUT);

function saveProgress() {
  localStorage.setItem('gh_cash', String(cash));
  localStorage.setItem('gh_owned', JSON.stringify(owned));
  localStorage.setItem('gh_loadout', JSON.stringify(loadout));
}

// ---------- State ----------
let selectedMap = 'school';
let room = null;
let inGame = false, finished = false, overlayOpen = null;
let hostGhostId = null;
let world = null, sim = null, ghostView = null;
let prints = [];
let netGhost = { x: 0, z: -5, yaw: 0, visible: false, hunting: false };
let remotes = new Map();          // id -> { group, x, z, yaw, dead, uv, loadout }
let shared = new Set();           // evidence found by the team
let crossedEv = new Set(), crossedGhost = new Set();
let pendingClaims = new Set(), killSent = new Set();
let myReading = { emf: null, temp: null };
let slot = 0;
const cooldowns = { photo: 0, crucifix: 0, write: 0, spirit: 0, pills: 0 };
let spiritHolding = false, spiritTime = 0;
const timers = { readings: 0, ghost: 0, pos: 0, hud: 0 };

// ---------- Three.js: the house ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.domElement.style.display = 'none';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030208);
scene.fog = new THREE.Fog(0x030208, 6, 32);
scene.add(new THREE.AmbientLight(0x202030, 0.9));

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 90);
scene.add(camera);
const me = new Me(camera);

// ---------- Three.js: the van preview in the menu ----------
const vanRenderer = new THREE.WebGLRenderer({ canvas: $('vanCanvas'), antialias: true, alpha: true });
const vanScene = new THREE.Scene();
vanScene.add(new THREE.HemisphereLight(0xffffff, 0x222244, 1.1));
const vanSun = new THREE.DirectionalLight(0xffffff, 0.8);
vanSun.position.set(5, 8, 6);
vanScene.add(vanSun);
const van = buildVan();
vanScene.add(van);
const vanCam = new THREE.PerspectiveCamera(38, 2, 0.1, 60);
vanCam.position.set(7, 3.8, 9);
vanCam.lookAt(0, 1.4, 0);

function sizeVan() {
  const w = $('vanCanvas').clientWidth || 400;
  const h = Math.round(w * 0.6);
  vanRenderer.setSize(w, h, false);
  vanCam.aspect = w / h;
  vanCam.updateProjectionMatrix();
}

// ---------- Screens and messages ----------
function showScreen(name) {
  $('menu').hidden = name !== 'menu';
  $('lobby').hidden = name !== 'lobby';
  $('game').hidden = name !== 'game';
  renderer.domElement.style.display = name === 'game' ? 'block' : 'none';
  if (name !== 'game' && document.pointerLockElement) document.exitPointerLock();
  if (name === 'menu') renderMenu();
}

function setMsg(text, ms = 2500) {
  $('msg').textContent = text;
  clearTimeout(setMsg.timer);
  setMsg.timer = setTimeout(() => { $('msg').textContent = ''; }, ms);
}

function flashScreen(kind) {
  const f = $('flash');
  f.className = kind;
  void f.offsetWidth;
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 300);
}

// ---------- Menu: shop and van ----------
function renderMenu() {
  $('cash').textContent = cash;
  renderShop();
  renderOwned();
  renderMapPick($('mapPick'), selectedMap, id => { selectedMap = id; renderMenu(); });
}

function renderShop() {
  const shop = $('shop');
  shop.textContent = '';
  for (const [key, it] of Object.entries(EQUIPMENT)) {
    const c = card(it.icon, it.name, it.desc);
    const b = btn(owned.includes(key) ? 'Owned' : `Buy · $${it.price}`, 'buy');
    b.disabled = owned.includes(key) || cash < it.price;
    b.onclick = () => {
      cash -= it.price;
      owned.push(key);
      saveProgress();
      renderMenu();
    };
    c.append(b);
    shop.append(c);
  }
}

function renderOwned() {
  $('loadCount').textContent = loadout.length;
  const box = $('owned');
  box.textContent = '';
  if (!owned.length) {
    box.textContent = 'Nothing in the van yet. Buy equipment in the shop.';
    return;
  }
  for (const key of owned) {
    const it = EQUIPMENT[key];
    const on = loadout.includes(key);
    const c = card(it.icon, it.name, on ? '✔ In your loadout' : 'In the van');
    const b = btn(on ? 'Unload' : 'Load', on ? 'secondary' : '');
    b.disabled = !on && loadout.length >= MAX_LOADOUT;
    b.onclick = () => {
      loadout = on ? loadout.filter(k => k !== key) : [...loadout, key];
      saveProgress();
      socket.emit('setLoadout', loadout);
      renderMenu();
    };
    c.append(b);
    box.append(c);
  }
}

function renderMapPick(container, active, onPick) {
  container.textContent = '';
  for (const [id, m] of Object.entries(MAPS)) {
    const b = btn(m.name, id === active ? 'mapOn' : 'secondary');
    b.title = m.desc;
    b.onclick = () => onPick(id);
    container.append(b);
  }
}

// ---------- Rooms and lobby ----------
function refreshList() {
  socket.emit('list', rooms => {
    const list = $('roomList');
    list.textContent = '';
    if (!rooms.length) {
      list.textContent = 'No public rooms yet. Create one!';
      return;
    }
    for (const r of rooms) {
      const row = el('div', 'roomRow');
      row.append(el('span', '', `${r.name} · ${MAPS[r.mapId].name} · ${r.players}/${r.max}${r.started ? ' · in game' : ''}`));
      const b = btn('Join');
      b.disabled = r.started || r.players >= r.max;
      b.onclick = () => socket.emit('joinRoom', { name: getName(), code: r.code, loadout }, handleJoin);
      row.append(b);
      list.append(row);
    }
  });
}

$('btnCreate').onclick = () => {
  socket.emit('createRoom', {
    name: getName(),
    roomName: $('roomName').value.trim() || 'Night Shift',
    isPrivate: $('isPrivate').checked,
    mapId: selectedMap,
    loadout
  }, handleJoin);
};

$('btnJoin').onclick = () => {
  socket.emit('joinRoom', {
    name: getName(),
    code: $('joinCode').value.trim().toUpperCase(),
    loadout
  }, handleJoin);
};

$('btnRefresh').onclick = refreshList;

function handleJoin(res) {
  if (!res || !res.ok) {
    $('menuError').textContent = res ? res.error : 'No response from the server.';
    return;
  }
  $('menuError').textContent = '';
  room = res.room;
  showScreen('lobby');
  renderLobby();
}

function renderLobby() {
  if (!room) return;
  const amHost = room.host === socket.id;
  $('lobbyCode').textContent = room.code;
  $('lobbyInfo').textContent = `${room.name} · ${MAPS[room.mapId].name} · ${room.isPrivate ? 'Private' : 'Public'}`;
  renderMapPick($('lobbyMaps'), room.mapId, id => {
    if (room.host === socket.id) socket.emit('selectMap', id);
  });

  const list = $('playerList');
  list.textContent = '';
  for (const p of room.players) {
    const crown = p.id === room.host ? ' 👑' : '';
    const you = p.id === socket.id ? ' (you)' : '';
    list.append(el('li', '', `${p.name}${crown}${you} · ${p.loadout.length} items`));
  }

  $('btnStart').hidden = !amHost;
  $('lobbyHint').textContent = amHost
    ? 'Pick a map, then start when everyone is ready.'
    : 'Waiting for the host to start the hunt.';
}

$('btnStart').onclick = () => socket.emit('startGame');

$('btnLeave').onclick = () => {
  socket.emit('leaveRoom');
  room = null;
  showScreen('menu');
  refreshList();
};

// ---------- Players and world ----------
function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#fff';
  g.font = 'bold 28px Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(text).slice(0, 14), 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.position.y = 2.3;
  return s;
}

function makeRemote(name, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.4, 12), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), new THREE.MeshStandardMaterial({ color: 0xd9b08c }));
  head.position.y = 1.8;
  g.add(body, head, nameTag(name));
  scene.add(g);
  return g;
}

function clearWorld() {
  if (world) world.meshes.forEach(o => scene.remove(o));
  prints.forEach(p => scene.remove(p.mesh));
  prints = [];
  remotes.forEach(r => scene.remove(r.group));
  remotes.clear();
  if (ghostView) scene.remove(ghostView.group);
  world = null;
  sim = null;
  ghostView = null;
}

function startGame() {
  clearWorld();
  finished = false;
  overlayOpen = null;
  shared = new Set();
  crossedEv = new Set();
  crossedGhost = new Set();
  pendingClaims = new Set();
  killSent = new Set();
  myReading = { emf: null, temp: null };

  world = buildWorld(scene, room.mapId);
  me.reset(world.spawn);
  ghostView = new GhostView(scene);
  ghostView.set({ x: world.ghostStart.x, z: world.ghostStart.z, yaw: 0, visible: false, hunting: false });

  if (hostGhostId && room.host === socket.id) {
    const def = GHOSTS.find(g => g.id === hostGhostId);
    sim = new GhostSim(def, world.ghostStart, world);
  }

  room.players.forEach((p, i) => {
    if (p.id === socket.id) return;
    const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
    const x = world.spawn.x + (i + 1) * 1.5, z = world.spawn.z;
    const group = makeRemote(p.name, color);
    group.position.set(x, 0, z);
    remotes.set(p.id, { group, x, z, yaw: 0, dead: false, uv: false, loadout: p.loadout || [] });
  });

  inGame = true;
  slot = 0;
  $('hudCode').textContent = room.code;
  showScreen('game');
  renderSlots();
  setMsg('The house is quiet... collect evidence and find the ghost.', 4000);
}

// ---------- Equipment actions ----------
function useSelected() {
  const item = loadout[slot];
  if (item === 'camera') takePhoto();
  else if (item === 'crucifix') useCrucifix();
  else if (item === 'pills') usePills();
}

function takePhoto() {
  if (cooldowns.photo > 0) return;
  cooldowns.photo = 2;
  flashScreen('white');
  socket.emit('action', { type: 'photo' });
}

function useCrucifix() {
  if (cooldowns.crucifix > 0) return;
  cooldowns.crucifix = 6;
  socket.emit('action', { type: 'crucifix' });
  setMsg('✝ You raise the crucifix...', 2000);
}

function usePills() {
  if (!loadout.includes('pills') || cooldowns.pills > 0) return;
  cooldowns.pills = 20;
  me.sanity = Math.min(100, me.sanity + 30);
  setMsg('💊 You feel calmer.', 2000);
}

function doWrite() {
  if (!loadout.includes('writing') || cooldowns.write > 0) return;
  cooldowns.write = 6;
  socket.emit('action', { type: 'write' });
  setMsg('📖 You try to write in the book...', 2000);
}

function startSpirit() {
  if (!loadout.includes('spirit') || cooldowns.spirit > 0) return;
  spiritHolding = true;
  spiritTime = 0;
  setMsg('📻 Hold R to keep talking...', 2000);
}

function stopSpirit() {
  spiritHolding = false;
}

function toggleLight() {
  if (loadout[slot] === 'uv' && !me.uvOn) {
    me.uvOn = true;
    me.flashOn = false;
  } else if (me.uvOn) {
    me.uvOn = false;
    me.flashOn = true;
  } else {
    me.flashOn = !me.flashOn;
  }
  me.applyLights();
}

// ---------- Overlays ----------
function toggleOverlay(name) {
  if (overlayOpen === 'result') return;
  overlayOpen = overlayOpen === name ? null : name;
  if (overlayOpen === 'journal') renderJournal();
  if (overlayOpen === 'box') renderBox();
  $('journal').hidden = overlayOpen !== 'journal';
  $('box').hidden = overlayOpen !== 'box';
  if (overlayOpen && document.pointerLockElement) document.exitPointerLock();
}

function toggleIn(set, key) {
  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function renderJournal() {
  const body = $('journalBody');
  body.textContent = '';

  const ev = el('div', 'col');
  ev.append(el('h3', '', `Evidence: ${shared.size}/${EVIDENCE_NEEDED} needed to guess`));
  for (const [key, name] of Object.entries(EVIDENCE)) {
    const row = el('div',
      'row-item' + (shared.has(key) ? ' found' : '') + (crossedEv.has(key) ? ' cross' : ''),
      (shared.has(key) ? '✔ ' : '☐ ') + name);
    row.onclick = () => { toggleIn(crossedEv, key); renderJournal(); };
    ev.append(row);
  }

  const gh = el('div', 'col');
  gh.append(el('h3', '', 'Ghost suspects'));
  for (const g of GHOSTS) {
    const fits = [...shared].every(k => g.evidence.includes(k));
    const row = el('div', 'ghostRow' + (crossedGhost.has(g.id) ? ' cross' : '') + (fits ? '' : ' dim'));
    row.append(el('b', '', g.name), el('small', '', g.evidence.map(k => EVIDENCE[k]).join(' · ')));
    const guess = btn('Guess', 'small');
    guess.disabled = finished || shared.size < EVIDENCE_NEEDED;
    guess.onclick = e => {
      e.stopPropagation();
      socket.emit('guess', { ghostId: g.id });
    };
    row.append(guess);
    row.onclick = () => { toggleIn(crossedGhost, g.id); renderJournal(); };
    gh.append(row);
  }

  body.append(ev, gh);
}

function renderBox() {
  const body = $('boxBody');
  body.textContent = '';
  if (!loadout.length) {
    body.textContent = 'Nothing loaded. Equip items in the van before the hunt.';
    return;
  }
  loadout.forEach((k, i) => {
    const it = EQUIPMENT[k];
    let extra = '';
    if (k === 'emf' && myReading.emf !== null) extra = ` (reading: ${myReading.emf})`;
    if (k === 'thermo' && myReading.temp !== null) extra = ` (reading: ${myReading.temp}°C)`;
    body.append(card(it.icon, `${i + 1}. ${it.name}${extra}`, it.desc));
  });
}

function renderSlots() {
  const box = $('slots');
  box.textContent = '';
  for (let i = 0; i < MAX_LOADOUT; i++) {
    const k = loadout[i];
    const it = k ? EQUIPMENT[k] : null;
    let extra = '';
    if (k === 'emf' && myReading.emf !== null) extra = ` · EMF ${myReading.emf}`;
    if (k === 'thermo' && myReading.temp !== null) extra = ` · ${myReading.temp}°C`;
    box.append(el('div', 'slot' + (i === slot ? ' active' : ''),
      `${i + 1}  ${it ? it.icon + ' ' + it.name + extra : '—'}`));
  }
}

function showResult(d) {
  finished = true;
  overlayOpen = 'result';
  $('journal').hidden = true;
  $('box').hidden = true;
  $('resultTitle').textContent = d.win ? '🏆 Ghost identified!' : '💀 The hunt is over';

  let text = `The ghost was a ${ghostName(d.ghostId)}.`;
  if (d.guessed && d.by) text += ` ${d.by} guessed ${ghostName(d.guessed)}.`;
  if (d.reason) text += ` ${d.reason}`;
  $('resultText').textContent = text;
  $('result').hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();

  const reward = d.win ? 200 : 50;
  cash += reward;
  saveProgress();
  setMsg(`+$${reward}`, 3000);
}

// ---------- Host logic: ghost AI, readings, evidence ----------
function allPlayers() {
  const list = [{
    id: socket.id, x: me.x, z: me.z, dead: me.dead,
    uv: me.uvOn && loadout.includes('uv'), loadout
  }];
  remotes.forEach((r, id) => list.push({ id, x: r.x, z: r.z, dead: r.dead, uv: r.uv, loadout: r.loadout }));
  return list;
}

// Sends evidence to the server, which checks it against the ghost
function claim(key) {
  if (shared.has(key) || pendingClaims.has(key)) return;
  pendingClaims.add(key);
  socket.emit('evidence', { key });
}

// Sends a private reading to one player (or applies it if it's you)
function deliver(id, data) {
  if (id === socket.id) {
    Object.assign(myReading, data);
    if (data.word) setMsg('📻 ' + data.word, 3000);
    if (data.write) setMsg('📖 ' + data.write, 4000);
  } else {
    socket.emit('reading', { to: id, ...data });
  }
}

function addPrint(x, z) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 12),
    new THREE.MeshBasicMaterial({ color: 0x4a1f1f, transparent: true, opacity: 0.8 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  m.visible = me.uvOn;
  scene.add(m);
  prints.push({ mesh: m, life: 120, x, z });
}

function killPlayer(id) {
  if (killSent.has(id)) return;
  killSent.add(id);
  socket.emit('kill', { id });
}

function onHuntStart() {
  setMsg('😱 The ghost is hunting! Hide or use the crucifix!', 5000);
  flashScreen('red');
}

function hostTick(dt, now) {
  const players = allPlayers();
  const events = sim.update(dt, now, players);

  for (const ev of events) {
    if (ev.name === 'print') {
      addPrint(ev.x, ev.z);
      socket.emit('broadcast', { name: 'print', data: { x: ev.x, z: ev.z } });
    }
    if (ev.name === 'huntStart') {
      socket.emit('broadcast', { name: 'huntStart' });
      onHuntStart();
    }
  }

  // The hunting ghost attacks anyone it touches
  if (sim.hunting) {
    for (const p of players) {
      if (!p.dead && Math.hypot(p.x - sim.x, p.z - sim.z) < 1.3) killPlayer(p.id);
    }
  }

  timers.readings -= dt;
  if (timers.readings <= 0) {
    timers.readings = 0.25;
    doReadings(players);
  }

  timers.ghost -= dt;
  if (timers.ghost <= 0) {
    timers.ghost = 0.1;
    socket.volatile.emit('ghost', {
      x: sim.x, z: sim.z, yaw: sim.yaw, visible: sim.visible, hunting: sim.hunting
    });
  }
}

function doReadings(players) {
  for (const p of players) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - sim.x, p.z - sim.z);
    const reading = {};

    if (p.loadout.includes('emf')) {
      reading.emf = sim.def.evidence.includes('emf')
        ? (d < 2 ? 5 : d < 4 ? 4 : d < 6 ? 2 : 0)
        : 0;
      if (reading.emf === 5) claim('emf');
    }
    if (p.loadout.includes('thermo')) {
      const cold = sim.def.evidence.includes('freezing') && d < 4;
      reading.temp = cold ? -4 : 12;
      if (cold) claim('freezing');
    }
    if (Object.keys(reading).length) deliver(p.id, reading);
  }

  // Fingerprints: someone with UV on, standing near a footprint
  for (const p of players) {
    if (p.dead || !p.uv) continue;
    if (prints.some(pr => Math.hypot(pr.x - p.x, pr.z - p.z) < 1.5)) claim('fingers');
  }
}

// Actions sent by players (routed through the server to the host)
socket.on('action', ({ from, type }) => {
  if (!sim || finished) return;
  const p = allPlayers().find(x => x.id === from);
  if (!p || p.dead) return;
  const d = Math.hypot(p.x - sim.x, p.z - sim.z);
  const now = performance.now() / 1000;

  if (type === 'photo') {
    if (p.loadout.includes('camera') && d < 8) {
      sim.anger = Math.min(100, sim.anger + 25);
      socket.emit('broadcast', { name: 'flash' });
    }
  } else if (type === 'crucifix') {
    if (p.loadout.includes('crucifix') && d < 5) {
      sim.repelUntil = now + 12;
      socket.emit('broadcast', { name: 'repel' });
    }
  } else if (type === 'spirit') {
    const ok = p.loadout.includes('spirit') && sim.def.evidence.includes('spirit') && d < 6;
    if (ok) claim('spirit');
    deliver(from, { word: ok ? SPIRIT_WORDS[Math.floor(Math.random() * SPIRIT_WORDS.length)] : '...silence...' });
  } else if (type === 'write') {
    const ok = p.loadout.includes('writing') && sim.def.evidence.includes('writing') && d < 3;
    if (ok) claim('writing');
    deliver(from, { write: ok ? 'The ghost wrote: "HELP ME"' : 'Nothing was written.' });
  }
});

// ---------- Socket events ----------
socket.on('connect', refreshList);

socket.on('roomUpdate', r => {
  room = r;
  if (!inGame && !$('lobby').hidden) renderLobby();
});

socket.on('hostInfo', d => { hostGhostId = d.ghostId; });

socket.on('gameStarted', r => {
  room = r;
  startGame();
});

socket.on('pos', d => {
  const r = remotes.get(d.id);
  if (!r) return;
  r.x = d.x; r.z = d.z; r.yaw = d.yaw; r.dead = d.dead; r.uv = d.uv;
});

socket.on('ghost', g => { netGhost = g; });

socket.on('reading', d => {
  Object.assign(myReading, d);
  if (d.word) setMsg('📻 ' + d.word, 3000);
  if (d.write) setMsg('📖 ' + d.write, 4000);
});

socket.on('evidence', ({ ids }) => {
  shared = new Set(ids);
  pendingClaims.clear();
  setMsg('📋 New evidence logged!', 2500);
  if (overlayOpen === 'journal') renderJournal();
});

socket.on('playerDied', ({ id, name }) => {
  if (id === socket.id) {
    me.dead = true;
    setMsg('💀 You were taken by the ghost.', 5000);
  } else {
    const r = remotes.get(id);
    if (r) r.dead = true;
    setMsg(`${name} was taken by the ghost.`, 4000);
  }
});

socket.on('gameOver', showResult);
socket.on('guessError', msg => setMsg(msg, 3000));
socket.on('huntStart', onHuntStart);
socket.on('print', ({ x, z }) => addPrint(x, z));
socket.on('repel', () => setMsg('✝ The ghost is pushed back!', 3000));
socket.on('flash', () => flashScreen('white'));

// ---------- Input ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!inGame || !world) return;
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;

  if (e.code === 'KeyJ') toggleOverlay('journal');
  else if (e.code === 'KeyB') toggleOverlay('box');
  else if (e.code === 'KeyF') toggleLight();
  else if (e.code === 'KeyQ') doWrite();
  else if (e.code === 'KeyX') usePills();
  else if (e.code === 'KeyR') startSpirit();
  else if (/^Digit[1-4]$/.test(e.code)) {
    const n = Number(e.code.slice(5)) - 1;
    if (n < loadout.length) {
      slot = n;
      renderSlots();
    }
  }
});

addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyR') stopSpirit();
});

renderer.domElement.addEventListener('click', () => {
  if (inGame && !overlayOpen && !finished) renderer.domElement.requestPointerLock();
});

renderer.domElement.addEventListener('mousedown', e => {
  if (e.button === 0 && document.pointerLockElement === renderer.domElement) useSelected();
});

document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement) me.look(e.movementX, e.movementY);
});

$('btnBackLobby').onclick = () => {
  if (room && room.host === socket.id) socket.emit('endGame');
  inGame = false;
  finished = false;
  overlayOpen = null;
  hostGhostId = null;
  $('result').hidden = true;
  $('journal').hidden = true;
  $('box').hidden = true;
  clearWorld();
  showScreen('lobby');
  renderLobby();
};

// ---------- Game frame ----------
function updateSanity(dt) {
  if (me.dead) return;
  const gx = sim ? sim.x : netGhost.x;
  const gz = sim ? sim.z : netGhost.z;
  const hunting = sim ? sim.hunting : netGhost.hunting;
  const visible = sim ? sim.visible : netGhost.visible;
  const d = Math.hypot(me.x - gx, me.z - gz);

  if (hunting && d < 9) me.sanity -= (9 - d) * 2.2 * dt;
  else if (visible && d < 5) me.sanity -= 3 * dt;
  else me.sanity += 2 * dt;
  me.sanity = clamp(me.sanity, 0, 100);

  if (me.sanity <= 0) {
    me.dead = true;
    socket.emit('dead');
    setMsg('💀 You lost your mind...', 5000);
  }
}

function updateHud() {
  $('sanityBar').style.width = Math.round(me.sanity) + '%';
  $('hudEvidence').textContent = `${shared.size}/${EVIDENCE_NEEDED}`;

  const prompt = $('prompt');
  const gx = sim ? sim.x : netGhost.x, gz = sim ? sim.z : netGhost.z;
  const near = Math.hypot(me.x - gx, me.z - gz) < 3;
  prompt.textContent = near && loadout.includes('writing') && !me.dead ? 'Press Q to write in the book' : '';
}

function gameFrame(dt, now) {
  for (const k in cooldowns) cooldowns[k] = Math.max(0, cooldowns[k] - dt);

  me.update(dt, overlayOpen ? {} : keys, world);

  if (spiritHolding) {
    spiritTime += dt;
    if (spiritTime >= 2) {
      spiritHolding = false;
      cooldowns.spirit = 8;
      socket.emit('action', { type: 'spirit' });
      setMsg('📻 Listening for voices...', 2500);
    }
  }

  if (sim && !finished) hostTick(dt, now);

  ghostView.set(sim
    ? { x: sim.x, z: sim.z, yaw: sim.yaw, visible: sim.visible, hunting: sim.hunting }
    : netGhost);
  ghostView.update(dt, now);

  updateSanity(dt);

  prints = prints.filter(p => {
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      return false;
    }
    p.mesh.visible = me.uvOn;
    return true;
  });

  remotes.forEach(r => {
    r.group.position.x += (r.x - r.group.position.x) * Math.min(1, dt * 10);
    r.group.position.z += (r.z - r.group.position.z) * Math.min(1, dt * 10);
    r.group.rotation.y = r.yaw;
    r.group.rotation.x = r.dead ? -Math.PI / 2 : 0;
  });

  timers.pos -= dt;
  if (timers.pos <= 0) {
    timers.pos = 0.1;
    socket.volatile.emit('pos', {
      x: me.x, z: me.z, yaw: me.yaw, dead: me.dead,
      uv: me.uvOn && loadout.includes('uv')
    });
  }

  timers.hud -= dt;
  if (timers.hud <= 0) {
    timers.hud = 0.25;
    renderSlots();
    updateHud();
  }
}

const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;

  if (inGame && world) {
    gameFrame(dt, now);
    renderer.render(scene, camera);
  } else if (!$('menu').hidden) {
    van.rotation.y += dt * 0.4;
    vanRenderer.render(vanScene, vanCam);
  }
}

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizeVan();
});

// ---------- Start ----------
sizeVan();
renderMenu();
showScreen('menu');
loop();
