const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const ROOT = __dirname;

// Serve only the game files (not server.js or package.json)
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(ROOT, 'style.css')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const CLUE_COUNT = 3;

const rooms = new Map();       // room code -> room
const playerRoom = new Map();  // socket id -> room code

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function clean(value, max, fallback) {
  const s = String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
  return s || fallback;
}

function roomOf(socket) {
  const code = playerRoom.get(socket.id);
  return code ? rooms.get(code) : null;
}

function nameOf(room, id) {
  const p = room.players.find(p => p.id === id);
  return p ? p.name : 'Someone';
}

function roomView(room) {
  return {
    code: room.code,
    name: room.name,
    isPrivate: room.isPrivate,
    host: room.host,
    started: room.started,
    players: room.players.map(p => ({ id: p.id, name: p.name }))
  };
}

function publicList() {
  return [...rooms.values()]
    .filter(r => !r.isPrivate)
    .map(r => ({
      code: r.code,
      name: r.name,
      players: r.players.length,
      max: MAX_PLAYERS,
      started: r.started
    }));
}

function sendRoomUpdate(room) {
  io.to(room.code).emit('roomUpdate', roomView(room));
}

function leaveRoom(socket) {
  const code = playerRoom.get(socket.id);
  if (!code) return;
  playerRoom.delete(socket.id);
  socket.leave(code);

  const room = rooms.get(code);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.host === socket.id) room.host = room.players[0].id;
  sendRoomUpdate(room);
}

io.on('connection', socket => {
  socket.on('list', cb => cb(publicList()));

  socket.on('createRoom', ({ name, roomName, isPrivate }, cb) => {
    leaveRoom(socket);
    const code = makeCode();
    const room = {
      code,
      name: clean(roomName, 24, 'Haunted House'),
      isPrivate: !!isPrivate,
      host: socket.id,
      started: false,
      players: [{ id: socket.id, name: clean(name, 14, 'Hunter') }],
      clues: new Set(),
      ghostHp: 5
    };
    rooms.set(code, room);
    playerRoom.set(socket.id, code);
    socket.join(code);
    cb({ ok: true, id: socket.id, room: roomView(room) });
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (room.players.length >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full.' });
    if (room.started) return cb({ ok: false, error: 'That hunt has already started.' });

    leaveRoom(socket);
    room.players.push({ id: socket.id, name: clean(name, 14, 'Hunter') });
    playerRoom.set(socket.id, room.code);
    socket.join(room.code);
    sendRoomUpdate(room);
    cb({ ok: true, id: socket.id, room: roomView(room) });
  });

  socket.on('leaveRoom', () => leaveRoom(socket));

  socket.on('startGame', () => {
    const room = roomOf(socket);
    if (!room || room.host !== socket.id) return;
    room.started = true;
    room.clues = new Set();
    room.ghostHp = 5;
    io.to(room.code).emit('gameStarted', roomView(room));
  });

  socket.on('endGame', () => {
    const room = roomOf(socket);
    if (!room || room.host !== socket.id) return;
    room.started = false;
    sendRoomUpdate(room);
  });

  // Player position (sent often, so volatile drops are fine)
  socket.on('pos', d => {
    const room = roomOf(socket);
    if (!room) return;
    socket.to(room.code).volatile.emit('pos', {
      id: socket.id,
      x: Number(d.x) || 0,
      z: Number(d.z) || 0,
      yaw: Number(d.yaw) || 0,
      dead: !!d.dead
    });
  });

  // The host's ghost position is shared with everyone else
  socket.on('ghost', d => {
    const room = roomOf(socket);
    if (!room || room.host !== socket.id) return;
    socket.to(room.code).volatile.emit('ghost', {
      x: Number(d.x) || 0,
      z: Number(d.z) || 0,
      yaw: Number(d.yaw) || 0,
      hunting: !!d.hunting
    });
  });

  socket.on('clue', ({ id }) => {
    const room = roomOf(socket);
    if (!room || !room.started) return;
    if (!Number.isInteger(id) || id < 0 || id >= CLUE_COUNT) return;
    room.clues.add(id);
    io.to(room.code).emit('clues', { ids: [...room.clues] });
  });

  socket.on('banish', () => {
    const room = roomOf(socket);
    if (!room || !room.started) return;
    if (room.clues.size < CLUE_COUNT || room.ghostHp <= 0) return;

    room.ghostHp -= 1;
    io.to(room.code).emit('ghostHp', { hp: room.ghostHp });

    if (room.ghostHp <= 0) {
      room.started = false;
      io.to(room.code).emit('gameWon', { by: nameOf(room, socket.id) });
      sendRoomUpdate(room);
    }
  });

  socket.on('dead', () => {
    const room = roomOf(socket);
    if (!room) return;
    io.to(room.code).emit('playerDead', { id: socket.id, name: nameOf(room, socket.id) });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => console.log(`Ghost Hunt running on port ${PORT}`));