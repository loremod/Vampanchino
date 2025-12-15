const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const WORLD_SIZE = 960;
const GRID_SIZE = 12;
const CELL = WORLD_SIZE / GRID_SIZE;
const START_MINUTES = 20 * 60;
const END_MINUTES = 24 * 60;
const TICK_MS = 50;

const PLAYER_SPEED = {
  vampanchino: 180,
  runner: 160,
};
const CAT_SPEED = 240;

const rooms = new Map();

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`Vampanchino WS server listening on :${PORT}`);
});

function randId(prefix = 'p') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function randomPos() {
  const gx = Math.floor(Math.random() * GRID_SIZE);
  const gy = Math.floor(Math.random() * GRID_SIZE);
  return {
    x: gx * CELL + CELL / 2,
    y: gy * CELL + CELL / 2,
  };
}

function spawnCollectibles(count = 10) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const pos = randomPos();
    arr.push({ id: `c_${i}`, x: pos.x, y: pos.y, collected: false });
  }
  return arr;
}

function createRoom(code) {
  const room = {
    code,
    players: new Map(), // id -> player
    sockets: new Map(), // ws -> id
    cat: { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, vx: 0, vy: 0, mode: 'dash', modeUntil: Date.now() + 12000 },
    collectibles: spawnCollectibles(),
    clockMinutes: START_MINUTES,
    status: 'lobby',
    winner: null,
    message: '',
    timer: null,
    lastTick: Date.now(),
    minuteAccumulator: 0,
  };
  rooms.set(code, room);
  return room;
}

function serializeState(room) {
  return {
    status: room.status,
    winner: room.winner,
    message: room.message,
    clockMinutes: Math.min(room.clockMinutes, END_MINUTES),
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      avatar: p.avatar,
      x: p.x,
      y: p.y,
      tagged: p.tagged || false,
    })),
    cat: { x: room.cat.x, y: room.cat.y, mode: room.cat.mode },
    collectibles: room.collectibles,
  };
}

function broadcast(room, payload) {
  const msg = JSON.stringify(payload);
  for (const ws of room.sockets.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function startRoom(room) {
  if (room.timer) return;
  room.status = 'running';
  room.clockMinutes = START_MINUTES;
  room.minuteAccumulator = 0;
  room.lastTick = Date.now();
  room.winner = null;
  room.message = '';
  room.collectibles = spawnCollectibles();
  room.cat = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, vx: 0, vy: 0, mode: 'dash', modeUntil: Date.now() + 12000 };
  room.timer = setInterval(() => tick(room), TICK_MS);
  console.log(`Room ${room.code} started`);
}

function endRoom(room, winner, message) {
  room.status = 'ended';
  room.winner = winner;
  room.message = message;
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.timer) clearInterval(room.timer);
  rooms.delete(code);
  console.log(`Room ${code} cleaned up`);
}

function tick(room) {
  const now = Date.now();
  const dt = (now - room.lastTick) / 1000;
  room.lastTick = now;

  if (room.status !== 'running') {
    broadcast(room, { type: 'state', state: serializeState(room) });
    return;
  }

  // Update time
  room.minuteAccumulator += dt;
  if (room.minuteAccumulator >= 1) {
    const add = Math.floor(room.minuteAccumulator);
    room.clockMinutes += add;
    room.minuteAccumulator -= add;
  }

  // Update players
  for (const p of room.players.values()) {
    const speed = PLAYER_SPEED[p.role] || 150;
    const dirX = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    const dirY = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    const norm = Math.hypot(dirX, dirY) || 1;
    const vx = (dirX / norm) * speed;
    const vy = (dirY / norm) * speed;
    p.x = clamp(p.x + vx * dt, 10, WORLD_SIZE - 10);
    p.y = clamp(p.y + vy * dt, 10, WORLD_SIZE - 10);
  }

  // Cat AI
  if (now >= room.cat.modeUntil) {
    if (room.cat.mode === 'dash') {
      room.cat.mode = 'rest';
      room.cat.modeUntil = now + 60000; // rest around a minute
      room.cat.vx = 0;
      room.cat.vy = 0;
    } else {
      room.cat.mode = 'dash';
      room.cat.modeUntil = now + 12000;
      const angle = Math.random() * Math.PI * 2;
      room.cat.vx = Math.cos(angle) * CAT_SPEED;
      room.cat.vy = Math.sin(angle) * CAT_SPEED;
    }
  }
  if (room.cat.mode === 'dash') {
    room.cat.x = clamp(room.cat.x + room.cat.vx * dt, 12, WORLD_SIZE - 12);
    room.cat.y = clamp(room.cat.y + room.cat.vy * dt, 12, WORLD_SIZE - 12);
  }

  // Collectibles pickup
  for (const p of room.players.values()) {
    if (p.role !== 'runner') continue; // Vampanchino cannot collect Orange Thais
    if (p.tagged) continue;
    for (const c of room.collectibles) {
      if (c.collected) continue;
      if (dist(p, c) < 18) {
        c.collected = true;
      }
    }
  }

  // Tagging logic
  const vampPlayers = Array.from(room.players.values()).filter((p) => p.role === 'vampanchino');
  const runnerPlayers = Array.from(room.players.values()).filter((p) => p.role === 'runner');
  for (const vamp of vampPlayers) {
    for (const runner of runnerPlayers) {
      if (runner.tagged) continue;
      if (dist(vamp, runner) < 22) {
        runner.tagged = true;
      }
    }
  }

  // Win conditions
  const allCollected = room.collectibles.every((c) => c.collected);
  const allRunnersTagged = runnerPlayers.length > 0 && runnerPlayers.every((r) => r.tagged);
  if (allRunnersTagged) {
    endRoom(room, 'vampanchino', 'All runners tagged');
  } else if (room.clockMinutes >= END_MINUTES) {
    endRoom(room, 'team', 'Reached midnight');
  } else if (allCollected) {
    endRoom(room, 'team', 'All collectibles gathered');
  }

  broadcast(room, { type: 'state', state: serializeState(room) });
}

function handleJoin(ws, msg) {
  const roomCode = (msg.roomCode || '').toString().toUpperCase().slice(0, 6);
  const role = msg.role === 'vampanchino' ? 'vampanchino' : 'runner';
  const avatarRaw = (msg.avatar || '').toString().toLowerCase();
  const allowedAvatars = ['aleena', 'lorenzo', 'lily'];
  const avatar = role === 'runner'
    ? (allowedAvatars.includes(avatarRaw) ? avatarRaw : 'aleena')
    : 'vampanchino';
  const name = (msg.name || 'Player').toString().slice(0, 20);
  if (!roomCode) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing room code' }));
    return;
  }
  let room = rooms.get(roomCode);
  if (!room) room = createRoom(roomCode);

  if (role === 'vampanchino') {
    const alreadyVamp = Array.from(room.players.values()).some((p) => p.role === 'vampanchino');
    if (alreadyVamp) {
      ws.send(JSON.stringify({ type: 'error', message: 'Room already has a Vampanchino' }));
      return;
    }
  }

  const player = {
    id: randId('p'),
    name,
    role,
    avatar,
    x: randomPos().x,
    y: randomPos().y,
    input: { up: false, down: false, left: false, right: false },
    tagged: false,
  };
  room.players.set(player.id, player);
  room.sockets.set(ws, player.id);

  ws.send(JSON.stringify({ type: 'welcome', playerId: player.id, roomCode, state: serializeState(room) }));
  broadcast(room, { type: 'state', state: serializeState(room) });

  startRoom(room);
}

function handleInput(ws, msg) {
  for (const [roomCode, room] of rooms.entries()) {
    const playerId = room.sockets.get(ws);
    if (!playerId) continue;
    const player = room.players.get(playerId);
    if (!player) continue;
    const keys = msg.keys || {};
    player.input = {
      up: !!keys.up,
      down: !!keys.down,
      left: !!keys.left,
      right: !!keys.right,
    };
    return;
  }
}

function handleClose(ws) {
  for (const [code, room] of rooms.entries()) {
    const playerId = room.sockets.get(ws);
    if (!playerId) continue;
    room.sockets.delete(ws);
    room.players.delete(playerId);
    broadcast(room, { type: 'state', state: serializeState(room) });
    if (room.players.size === 0) cleanupRoom(code);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Bad JSON' }));
      return;
    }
    if (msg.type === 'join') handleJoin(ws, msg);
    else if (msg.type === 'input') handleInput(ws, msg);
  });
  ws.on('close', () => handleClose(ws));
});

