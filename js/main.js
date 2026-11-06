import { LocalPlayer, RemotePlayer, OBSTACLES, clampBounds } from './player.js';

// ================== SETUP ==================
const socket = io();
const $ = id => document.getElementById(id);

const CLUES = [
    { x: -8.5, z: -8.5 },
    { x: 8.5, z: 6.5 },
    { x: -9, z: 6.5 }
];
const CLUE_COUNT = 3;
const MAX_GHOST_HP = 5;
const SPAWN = { x: 0, z: 9 };
const PLAYER_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b];

let room = null;              // { code, name, isPrivate, host, started, players }
let inGame = false;
let overlayShown = false;
let collected = new Set();
let ghostHp = MAX_GHOST_HP;
let lastBanish = -10;
let msgTimer = null;

const remotes = new Map();    // socket id -> RemotePlayer
const keys = {};
let sendTimer = 0;
let ghostSendTimer = 0;

// Ghost: the host simulates it, everyone else follows the network copy
const ghostPos = new THREE.Vector3(0, 0, -5);
const ghostNet = { x: 0, z: -5, yaw: 0, hunting: false };
let ghostYaw = 0;
let ghostHunting = false;
let wasHost = false;
let wanderTo = randomPoint();

// ================== THREE.JS SCENE ==================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.display = 'none';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05040a);
scene.fog = new THREE.Fog(0x05040a, 8, 34);
scene.add(new THREE.AmbientLight(0x202030, 0.7));

const moon = new THREE.DirectionalLight(0x8fb4ff, 0.35);
moon.position.set(-8, 15, 6);
scene.add(moon);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 80);
scene.add(camera);
const local = new LocalPlayer(camera);

buildHouse();
const ghost = makeGhost();

const clueMeshes = CLUES.map(c => {
    const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3),
        new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffaa00, emissiveIntensity: 1.2 })
    );
    m.position.set(c.x, 1.0, c.z);
    scene.add(m);
    return m;
});

// ================== HOUSE AND GHOST MODELS ==================
function box(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    );
    m.position.set(x, y, z);
    scene.add(m);
    return m;
}

function buildHouse() {
    box(24, 0.2, 24, 0x2a2218, 0, -0.1, 0);     // floor
    box(24, 3, 0.4, 0x3a3550, 0, 1.5, -12);     // north wall
    box(24, 3, 0.4, 0x3a3550, 0, 1.5, 12);      // south wall
    box(0.4, 3, 24, 0x3a3550, -12, 1.5, 0);     // west wall
    box(0.4, 3, 24, 0x3a3550, 12, 1.5, 0);      // east wall

    OBSTACLES.forEach(o => {
        box(o.maxX - o.minX, 1.4, o.maxZ - o.minZ, 0x5b3b22,
            (o.minX + o.maxX) / 2, 0.7, (o.minZ + o.maxZ) / 2);
    });

    const moonWindow = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 1.6),
        new THREE.MeshBasicMaterial({ color: 0x8fb4ff })
    );
    moonWindow.position.set(0, 2, -11.75);
    scene.add(moonWindow);

    const lamp = new THREE.PointLight(0xffb866, 1.2, 14);
    lamp.position.set(0, 2.6, 0);
    scene.add(lamp);
}

function makeGhost() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xbfe9ff, emissive: 0x3a7fa8, transparent: true, opacity: 0.75
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 16), bodyMat);
    body.position.y = 1.3;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 16), bodyMat);
    tail.position.y = 0.6;
    tail.rotation.x = Math.PI;

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeMat);
    eyeL.position.set(-0.2, 1.4, 0.5);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.2;

    g.add(body, tail, eyeL, eyeR);
    g.visible = false;
    scene.add(g);
    return g;
}

// ================== HELPERS ==================
function dist2D(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

function randomPoint() {
    return { x: (Math.random() * 2 - 1) * 9, z: (Math.random() * 2 - 1) * 9 };
}

function getName() {
    return $('playerName').value.trim() || 'Hunter';
}

function setText(id, text) {
    $(id).textContent = text;
}

function setMsg(text, ms = 2500) {
    $('msg').textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { $('msg').textContent = ''; }, ms);
}

function show(screen) {
    $('menu').hidden = screen !== 'menu';
    $('lobby').hidden = screen !== 'lobby';
    $('game').hidden = screen !== 'game';
    renderer.domElement.style.display = screen === 'game' ? 'block' : 'none';
    if (screen !== 'game' && document.pointerLockElement) document.exitPointerLock();
}

function showOverlay(title, text) {
    overlayShown = true;
    setText('overlayTitle', title);
    setText('overlayText', text);
    $('overlay').hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
}

// ================== MENU ==================
function refreshList() {
    socket.emit('list', rooms => {
        const list = $('roomList');
        list.textContent = '';
        if (rooms.length === 0) {
            list.textContent = 'No public rooms yet. Create one!';
            return;
        }
        rooms.forEach(r => {
            const row = document.createElement('div');
            row.className = 'room-row';
            const label = document.createElement('span');
            label.textContent = `${r.name} · ${r.players}/${r.max}${r.started ? ' · in game' : ''}`;
            const btn = document.createElement('button');
            btn.textContent = 'Join';
            btn.disabled = r.started || r.players >= r.max;
            btn.onclick = () => socket.emit('joinRoom', { name: getName(), code: r.code }, handleJoinResult);
            row.append(label, btn);
            list.appendChild(row);
        });
    });
}

$('btnCreate').onclick = () => { $('createOpts').hidden = !$('createOpts').hidden; };

$('btnCreateGo').onclick = () => {
    socket.emit('createRoom', {
        name: getName(),
        roomName: $('roomName').value.trim() || 'Haunted House',
        isPrivate: $('isPrivate').checked
    }, handleJoinResult);
};

$('btnJoin').onclick = () => {
    socket.emit('joinRoom', { name: getName(), code: $('joinCode').value.trim().toUpperCase() }, handleJoinResult);
};

$('btnRefresh').onclick = refreshList;

function handleJoinResult(res) {
    if (!res.ok) return setText('menuError', res.error);
    setText('menuError', '');
    room = res.room;
    syncRemotes();
    show('lobby');
    renderLobby();
}

// ================== LOBBY ==================
function renderLobby() {
    if (!room) return;
    setText('lobbyCode', room.code);
    setText('lobbyName', room.name + (room.isPrivate ? ' · Private' : ' · Public'));

    const list = $('playerList');
    list.textContent = '';
    room.players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name
            + (p.id === room.host ? '  (host)' : '')
            + (p.id === socket.id ? '  (you)' : '');
        list.appendChild(li);
    });

    const amHost = room.host === socket.id;
    $('btnStart').hidden = !amHost;
    setText('lobbyHint', amHost
        ? 'Share the room code with friends, then start when ready.'
        : 'Waiting for the host to start the hunt.');
}

$('btnStart').onclick = () => socket.emit('startGame');

$('btnLeave').onclick = leaveRoom;

function leaveRoom() {
    socket.emit('leaveRoom');
    cleanupRoom();
    show('menu');
    refreshList();
}

function cleanupRoom() {
    room = null;
    inGame = false;
    overlayShown = false;
    $('overlay').hidden = true;
    remotes.forEach(r => r.remove());
    remotes.clear();
}

function syncRemotes() {
    if (!room) return;
    const ids = new Set(room.players.map(p => p.id));
    for (const [id, r] of remotes) {
        if (!ids.has(id)) {
            r.remove();
            remotes.delete(id);
        }
    }
    room.players.forEach((p, i) => {
        if (p.id === socket.id || remotes.has(p.id)) return;
        remotes.set(p.id, new RemotePlayer(scene, p.name, PLAYER_COLORS[i % PLAYER_COLORS.length]));
    });
}

// ================== SOCKET EVENTS ==================
socket.on('connect', refreshList);

socket.on('roomUpdate', r => {
    room = r;
    syncRemotes();
    if (!inGame) renderLobby();
});

socket.on('gameStarted', r => {
    room = r;
    syncRemotes();
    startGame();
});

socket.on('pos', d => {
    const r = remotes.get(d.id);
    if (r) r.setState(d);
});

socket.on('ghost', d => {
    ghostNet.x = d.x;
    ghostNet.z = d.z;
    ghostNet.yaw = d.yaw;
    ghostNet.hunting = d.hunting;
});

socket.on('clues', ({ ids }) => {
    collected = new Set(ids);
    clueMeshes.forEach((m, i) => { m.visible = !collected.has(i); });
});

socket.on('ghostHp', ({ hp }) => {
    ghostHp = hp;
});

socket.on('gameWon', ({ by }) => {
    showOverlay('👻 Ghost banished!', `${by} banished the ghost. The house is safe... for now.`);
});

socket.on('playerDead', ({ name }) => {
    setMsg(`${name} was taken by the ghost.`, 4000);
});

// ================== GAME START ==================
function startGame() {
    inGame = true;
    overlayShown = false;
    $('overlay').hidden = true;

    collected = new Set();
    ghostHp = MAX_GHOST_HP;
    clueMeshes.forEach(m => { m.visible = true; });
    local.reset(SPAWN.x, SPAWN.z);
    remotes.forEach(r => { r.dead = false; });

    ghostPos.set(0, 0, -5);
    ghostNet.x = 0;
    ghostNet.z = -5;
    ghostHunting = false;
    wasHost = false;

    setText('hudCode', room.code);
    show('game');
    setMsg('The house is quiet... find 3 pieces of evidence.', 4000);
}

// ================== PLAYER ACTIONS ==================
function interact() {
    if (!inGame || local.dead || overlayShown) return;

    // Collect evidence first
    for (let i = 0; i < CLUE_COUNT; i++) {
        if (!collected.has(i) && dist2D(local.pos, CLUES[i]) < 2.2) {
            socket.emit('clue', { id: i });
            return;
        }
    }

    // Then banish the ghost with the flashlight
    const now = performance.now() / 1000;
    const ghostAt = new THREE.Vector3(ghostPos.x, 1.2, ghostPos.z);
    if (collected.size >= CLUE_COUNT
        && dist2D(local.pos, ghostPos) < 3
        && local.canSee(ghostAt)
        && now - lastBanish > 0.8) {
        lastBanish = now;
        socket.emit('banish');
    }
}

function updatePrompt() {
    let hint = '';
    for (let i = 0; i < CLUE_COUNT; i++) {
        if (!collected.has(i) && dist2D(local.pos, CLUES[i]) < 2.2) {
            hint = 'Press E to collect evidence';
            break;
        }
    }
    if (!hint && ghost.visible && dist2D(local.pos, ghostPos) < 3) {
        hint = collected.size < CLUE_COUNT
            ? 'Something is here... find 3 evidence first'
            : 'Point your flashlight at it and press E to banish';
    }
    $('prompt').textContent = hint;
}

function updateHudBars() {
    $('sanityBar').style.width = Math.max(0, local.sanity) + '%';
    $('ghostBar').style.width = (ghostHp / MAX_GHOST_HP * 100) + '%';
    $('hudClues').textContent = `${collected.size}/${CLUE_COUNT}`;
}

function updateSanity(dt) {
    if (local.dead) return;
    const d = dist2D(local.pos, ghostPos);
    if (ghostHunting && d < 10) {
        local.sanity -= (10 - d) * 1.6 * dt;
    } else {
        local.sanity += 3 * dt;
    }
    local.sanity = Math.max(0, Math.min(100, local.sanity));

    if (local.sanity <= 0) {
        local.dead = true;
        socket.emit('dead');
        setMsg('You lost your mind...', 4000);
    }
}

// ================== GHOST AI (host only) ==================
function simulateGhost(dt) {
    const targets = [{ x: local.pos.x, z: local.pos.z, dead: local.dead }];
    remotes.forEach(r => targets.push({ x: r.target.x, z: r.target.z, dead: r.dead }));

    let best = null;
    let bestD = Infinity;
    for (const t of targets) {
        if (t.dead) continue;
        const d = Math.hypot(t.x - ghostPos.x, t.z - ghostPos.z);
        if (d < bestD) {
            bestD = d;
            best = t;
        }
    }

    ghostHunting = !!best && bestD < 14;
    let tx, tz, speed;
    if (ghostHunting) {
        tx = best.x;
        tz = best.z;
        speed = 2.4;
    } else {
        if (Math.hypot(wanderTo.x - ghostPos.x, wanderTo.z - ghostPos.z) < 0.8) {
            wanderTo = randomPoint();
        }
        tx = wanderTo.x;
        tz = wanderTo.z;
        speed = 1.1;
    }

    const dx = tx - ghostPos.x;
    const dz = tz - ghostPos.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, speed * dt);
    ghostPos.x += (dx / d) * step;
    ghostPos.z += (dz / d) * step;

    const p = clampBounds(ghostPos.x, ghostPos.z, 0.6);
    ghostPos.x = p.x;
    ghostPos.z = p.z;
    ghostYaw = Math.atan2(dx, dz);
}

function updateGhost(dt) {
    const isHost = room && room.host === socket.id;
    if (isHost) {
        wasHost = true;
        simulateGhost(dt);
    } else {
        wasHost = false;
        const k = Math.min(1, dt * 8);
        ghostPos.x += (ghostNet.x - ghostPos.x) * k;
        ghostPos.z += (ghostNet.z - ghostPos.z) * k;
        ghostYaw = ghostNet.yaw;
        ghostHunting = ghostNet.hunting;
    }
}

// ================== INPUT ==================
window.addEventListener('keydown', e => {
    if (!inGame) return;
    keys[e.code] = true;
    if (e.code === 'KeyF' && !e.repeat) {
        local.flashOn = !local.flashOn;
        local.spot.visible = local.flashOn;
    }
    if (e.code === 'KeyE' && !e.repeat) interact();
});

window.addEventListener('keyup', e => {
    keys[e.code] = false;
});

renderer.domElement.addEventListener('click', () => {
    if (inGame && !overlayShown) renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', e => {
    if (document.pointerLockElement === renderer.domElement) {
        local.look(e.movementX, e.movementY);
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

$('btnBackLobby').onclick = () => {
    if (room && room.host === socket.id) socket.emit('endGame');
    inGame = false;
    overlayShown = false;
    $('overlay').hidden = true;
    show('lobby');
    renderLobby();
};

$('btnQuit').onclick = leaveRoom;

// ================== MAIN LOOP ==================
const clock = new THREE.Clock();

function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (inGame) {
        local.update(dt, keys);
        updateSanity(dt);
        updateGhost(dt);

        // Only the flashlight beam or being very close reveals the ghost
        const ghostWorld = new THREE.Vector3(ghostPos.x, 1.2, ghostPos.z);
        ghost.visible = dist2D(local.pos, ghostPos) < 3 || local.canSee(ghostWorld);

        // Animate the ghost and evidence
        const t = clock.elapsedTime;
        ghost.position.set(ghostPos.x, Math.sin(t * 2) * 0.1, ghostPos.z);
        ghost.rotation.y = ghostYaw;
        clueMeshes.forEach((m, i) => {
            m.rotation.y += dt * 2;
            m.position.y = 1.0 + Math.sin(t * 3 + i) * 0.1;
        });

        remotes.forEach(r => r.update(dt));

        // Network sends
        sendTimer -= dt;
        ghostSendTimer -= dt;
        if (sendTimer <= 0) {
            sendTimer = 0.05;
            socket.volatile.emit('pos', {
                x: local.pos.x, z: local.pos.z, yaw: local.yaw, dead: local.dead
            });
        }
        if (room && room.host === socket.id && ghostSendTimer <= 0) {
            ghostSendTimer = 0.1;
            socket.volatile.emit('ghost', {
                x: ghostPos.x, z: ghostPos.z, yaw: ghostYaw, hunting: ghostHunting
            });
        }

        // Everyone has been taken
        if (local.dead && !overlayShown &&
            (remotes.size === 0 || [...remotes.values()].every(r => r.dead))) {
            showOverlay('Everyone was taken', 'The ghost claimed the whole team. Go back to the lobby to try again.');
        }

        updatePrompt();
        updateHudBars();
        renderer.render(scene, camera);
    }
}

frame();