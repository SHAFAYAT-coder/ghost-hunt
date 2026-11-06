const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const ROOT = __dirname;
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(ROOT, 'style.css')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Keep this in sync with js/data.js. The server alone knows the ghost's evidence.
const GHOST_EVIDENCE = {
  spirit:  ['spirit', 'writing', 'emf'],
  wraith:  ['spirit', 'fingers', 'freezing'],
  phantom: ['fingers', 'emf', 'freezing'],
  demon:   ['writing', 'fingers', 'freezing']
};
const GHOST_IDS = Object.keys(GHOST_EVIDENCE);
const MAP_IDS = ['school', 'camp', 'hostel'];
const EQUIP_IDS = ['emf', 'thermo', 'spirit', 'writing', 'uv', 'pills', 'crucifix', 'camera'];
const ACTIONS = ['photo', 'crucifix', 'spirit', 'write'];
const BROADCASTS = ['huntStart', 'print', 'repel', 'flash'];
const MAX_PLAYERS = 4, MAX_LOADOUT = 4, EVIDENCE_NEEDED = 3;

const rooms = new Map();    // code -> room
const roomOf = new Map();   // socket id -> room code

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clean = (v, max, fallback) => String(v || '').replace(/[<>]/g, '').trim().slice(0, max) || fallback;
const cleanLoadout = list => [...new Set(Array.isArray(list) ? list : [])]
  .filter(k => EQUIP_IDS.includes(k))
  .slice(0, MAX_LOADOUT);

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function roomFor(socket) {
  const code = roomOf.get(socket.id);
  return code ? rooms.get(code) : null;
}

function roomView(room) {
  return {
    code: room.code,
    name: room.name,
    isPrivate: room.isPrivate,
    host: room.host,
    mapId: room.mapId,
    started: room.started,
    players: room.players.map(p => ({
      id: p.id, name: p.name, loadout: p.loadout, dead: room.dead.has(p.id)
    }))
  };
}

function sendRoomUpdate(room) {
  io.to(room.code).emit('roomUpdate', roomView(room));
}

function publicList() {
  return [...rooms.values()]
    .filter(r => !r.isPrivate)
    .map(r => ({
      code: r.code, name: r.name, mapId: r.mapId,
      players: r.players.length, max: MAX_PLAYERS, started: r.started
    }));
}

function endRound(room, win, reason, guessed, by) {
  room.started = false;
  io.to(room.code).emit('gameOver', {
    win, ghostId: room.ghostId, guessed: guessed || null, by: by || '', reason: reason || ''
  });
  sendRoomUpdate(room);
}

function markDead(room, id) {
  if (!room.started || room.dead.has(id)) return;
  room.dead.add(id);
  const p = room.players.find(x => x.id === id);
  io.to(room.code).emit('playerDied', { id, name: p ? p.name : 'Someone' });
  if (room.players.every(x => room.dead.has(x.id))) {
    endRound(room, false, 'All hunters were taken.');
  }
}

function leaveRoom(socket) {
  const room = roomFor(socket);
  if (!room) return;
  roomOf.delete(socket.id);
  socket.leave(room.code);

  if (room.started && room.host === socket.id) {
    endRound(room, false, 'The host left the hunt.');
  } else if (room.started) {
    markDead(room, socket.id);
  }

  room.players = room.players.filter(p => p.id !== socket.id);
  room.dead.delete(socket.id);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.host === socket.id) room.host = room.players[0].id;
  sendRoomUpdate(room);
}

io.on('connection', socket => {
  socket.on('list', cb => cb(publicList()));

  socket.on('createRoom', (d, cb) => {
    leaveRoom(socket);
    const code = makeCode();
    const room = {
      code,
      name: clean(d.roomName, 24, 'Night Shift'),
      isPrivate: !!d.isPrivate,
      host: socket.id,
      mapId: MAP_IDS.includes(d.mapId) ? d.mapId : 'school',
      started: false,
      ghostId: null,
      evidence: new Set(),
      dead: new Set(),
      players: [{ id: socket.id, name: clean(d.name, 14, 'Hunter'), loadout: cleanLoadout(d.loadout) }]
    };
    rooms.set(code, room);
    roomOf.set(socket.id, code);
    socket.join(code);
    cb({ ok: true, room: roomView(room) });
  });

  socket.on('joinRoom', (d, cb) => {
    const room = rooms.get(String(d.code || '').toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full.' });
    if (room.started) return cb({ ok: false, error: 'That hunt has already started.' });

    leaveRoom(socket);
    room.players.push({ id: socket.id, name: clean(d.name, 14, 'Hunter'), loadout: cleanLoadout(d.loadout) });
    roomOf.set(socket.id, room.code);
    socket.join(room.code);
    sendRoomUpdate(room);
    cb({ ok: true, room: roomView(room) });
  });

  socket.on('leaveRoom', () => leaveRoom(socket));

  socket.on('setLoadout', list => {
    const room = roomFor(socket);
    if (!room || room.started) return;
    const p = room.players.find(x => x.id === socket.id);
    if (!p) return;
    p.loadout = cleanLoadout(list);
    sendRoomUpdate(room);
  });

  socket.on('selectMap', mapId => {
    const room = roomFor(socket);
    if (!room || room.host !== socket.id || room.started) return;
    if (!MAP_IDS.includes(mapId)) return;
    room.mapId = mapId;
    sendRoomUpdate(room);
  });

  socket.on('startGame', () => {
    const room = roomFor(socket);
    if (!room || room.host !== socket.id || room.started) return;
    room.started = true;
    room.ghostId = GHOST_IDS[Math.floor(Math.random() * GHOST_IDS.length)];
    room.evidence = new Set();
    room.dead = new Set();
    socket.emit('hostInfo', { ghostId: room.ghostId });   // only the host learns the ghost
    io.to(room.code).emit('gameStarted', roomView(room));
  });

  socket.on('endGame', () => {
    const room = roomFor(socket);
    if (!room || room.host !== socket.id) return;
    room.started = false;
    room.ghostId = null;
    sendRoomUpdate(room);
  });

  // Positions go to everyone else, and drops are fine since they update 10 times a second
  socket.on('pos', d => {
    const room = roomFor(socket);
    if (!room) return;
    socket.to(room.code).volatile.emit('pos', {
      id: socket.id, x: num(d.x), z: num(d.z), yaw: num(d.yaw), dead: !!d.dead, uv: !!d.uv
    });
  });

  // The host's ghost state goes to everyone else
  socket.on('ghost', d => {
    const room = roomFor(socket);
    if (!room || !room.started || room.host !== socket.id) return;
    socket.to(room.code).volatile.emit('ghost', {
      x: num(d.x), z: num(d.z), yaw: num(d.yaw), visible: !!d.visible, hunting: !!d.hunting
    });
  });

  // Private readings from the host to one player
  socket.on('reading', d => {
    const room = roomFor(socket);
    if (!room || !room.started || room.host !== socket.id) return;
    if (!room.players.some(p => p.id === d.to)) return;
    const out = {};
    if ('emf' in d) out.emf = num(d.emf);
    if ('temp' in d) out.temp = num(d.temp);
    if ('word' in d) out.word = clean(d.word, 60, '');
    if ('write' in d) out.write = clean(d.write, 80, '');
    io.to(d.to).emit('reading', out);
  });

  // Evidence can only be added if the ghost really has it
  socket.on('evidence', d => {
    const room = roomFor(socket);
    if (!room || !room.started || room.host !== socket.id) return;
    const list = GHOST_EVIDENCE[room.ghostId] || [];
    const key = String(d.key);
    if (!list.includes(key) || room.evidence.has(key)) return;
    room.evidence.add(key);
    io.to(room.code).emit('evidence', { ids: [...room.evidence] });
  });

  // Players ask for actions, and the host decides what happens
  socket.on('action', d => {
    const room = roomFor(socket);
    if (!room || !room.started) return;
    if (!ACTIONS.includes(d.type)) return;
    io.to(room.host).emit('action', { from: socket.id, type: d.type });
  });

  // Guessing the ghost ends the hunt
  socket.on('guess', d => {
    const room = roomFor(socket);
    if (!room || !room.started) return;
    if (room.evidence.size < EVIDENCE_NEEDED) {
      return socket.emit('guessError', `Find ${EVIDENCE_NEEDED} pieces of evidence before you guess.`);
    }
    const guessed = String(d.ghostId);
    const by = (room.players.find(p => p.id === socket.id) || { name: 'Someone' }).name;
    const win = guessed === room.ghostId;
    endRound(room, win, win ? '' : 'Wrong guess.', guessed, by);
  });

  // The host reports who the ghost has taken
  socket.on('kill', d => {
    const room = roomFor(socket);
    if (!room || !room.started || room.host !== socket.id) return;
    if (room.players.some(p => p.id === d.id)) markDead(room, String(d.id));
  });

  // A player reports their own death (sanity ran out)
  socket.on('dead', () => {
    const room = roomFor(socket);
    if (room) markDead(room, socket.id);
  });

  // The host shares short events with everyone else
  socket.on('broadcast', d => {
    const room = roomFor(socket);
    if (!room || room.host !== socket.id || !BROADCASTS.includes(d.name)) return;
    socket.to(room.code).emit(d.name, d.data || {});
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => console.log(`Ghost Hunt running on port ${PORT}`));
