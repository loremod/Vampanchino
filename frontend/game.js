(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const joinForm = document.getElementById('joinForm');
  const statusEl = document.getElementById('status');
  const clockEl = document.getElementById('clock');
  const collectiblesEl = document.getElementById('collectibles');
  const playersCountEl = document.getElementById('playersCount');
  const winBannerEl = document.getElementById('winBanner');
  const roleEl = document.getElementById('role');
  const runnerEl = document.getElementById('runner');
  const runnerPicker = document.getElementById('runnerPicker');

  const GRID_SIZE = 12;
  const WORLD_SIZE = canvas.width; // square
  const CELL = WORLD_SIZE / GRID_SIZE;
  const ROLE_COLORS = {
    vampanchino: '#e63946',
    runner: '#2a9d8f',
  };

  const AVATAR_COLORS = {
    vampanchino: '#e63946',
    aleena: '#1f7a8c',
    lorenzo: '#f4a261',
    lily: '#9b5de5',
  };

  const state = {
    connected: false,
    playerId: null,
    players: [],
    cat: { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, mode: 'dash' },
    collectibles: [],
    clockMinutes: 1200,
    status: 'lobby',
    winner: null,
    message: '',
  };

  let socket = null;
  let lastInputSeq = 0;
  const inputState = { up: false, down: false, left: false, right: false };

  const defaultWsUrl = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.hostname || 'localhost';
    return `${proto}://${host}:3000`;
  };

  const WS_URL = window.GAME_SERVER || defaultWsUrl();

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function formatClock(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function drawGrid() {
    ctx.fillStyle = '#d8dee9';
    ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    ctx.strokeStyle = '#9aa5b1';
    ctx.lineWidth = 2;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * CELL;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, WORLD_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(WORLD_SIZE, pos);
      ctx.stroke();
    }
  }

  function drawCollectibles() {
    for (const c of state.collectibles) {
      if (c.collected) continue;
      ctx.fillStyle = '#ff9e2c'; // Orange Thai
      ctx.fillRect(c.x - 8, c.y - 8, 16, 16);
      ctx.strokeStyle = '#c76b00';
      ctx.strokeRect(c.x - 8, c.y - 8, 16, 16);
    }
  }

  function drawCat() {
    const { x, y, mode } = state.cat;
    ctx.fillStyle = '#ff9900';
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.fillText(mode === 'rest' ? 'Z' : '🐾', x - 6, y + 4);
    ctx.fillText('Dolly', x - 14, y - 14);
  }

  function drawPlayers() {
    for (const p of state.players) {
      const color = AVATAR_COLORS[p.avatar || p.role] || ROLE_COLORS[p.role] || '#555';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();

      if (p.tagged) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x - 10, p.y - 10);
        ctx.lineTo(p.x + 10, p.y + 10);
        ctx.moveTo(p.x + 10, p.y - 10);
        ctx.lineTo(p.x - 10, p.y + 10);
        ctx.stroke();
      }

      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      const label = p.id === state.playerId ? `You (${p.name})` : p.name;
      ctx.fillText(label, p.x - 20, p.y - 18);
    }
  }

  function drawBanner() {
    if (state.status === 'running') return;
    const text = state.winner
      ? `${state.winner === 'team' ? 'Team' : 'Vampanchino'} wins!`
      : 'Waiting for players...';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, WORLD_SIZE / 2 - 30, WORLD_SIZE, 60);
    ctx.fillStyle = '#fff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, WORLD_SIZE / 2, WORLD_SIZE / 2 + 8);
    ctx.textAlign = 'left';
  }

  function loop() {
    drawGrid();
    drawCollectibles();
    drawCat();
    drawPlayers();
    if (state.status !== 'running') drawBanner();
    requestAnimationFrame(loop);
  }

  loop();

  function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    lastInputSeq += 1;
    socket.send(
      JSON.stringify({
        type: 'input',
        seq: lastInputSeq,
        keys: { ...inputState },
      }),
    );
  }

  function setupControls() {
    window.addEventListener('keydown', (e) => {
      const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (isFormField) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
        e.preventDefault();
      }
      const before = { ...inputState };
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') inputState.up = true;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') inputState.down = true;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') inputState.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') inputState.right = true;
      if (JSON.stringify(before) !== JSON.stringify(inputState)) sendInput();
    });
    window.addEventListener('keyup', (e) => {
      const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (isFormField) return;
      const before = { ...inputState };
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') inputState.up = false;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') inputState.down = false;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') inputState.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') inputState.right = false;
      if (JSON.stringify(before) !== JSON.stringify(inputState)) sendInput();
    });
  }

  setupControls();

  function applyState(next) {
    state.players = next.players || [];
    state.cat = next.cat || state.cat;
    state.collectibles = next.collectibles || [];
    state.clockMinutes = next.clockMinutes ?? state.clockMinutes;
    state.status = next.status || state.status;
    state.winner = next.winner || null;
    state.message = next.message || '';

    clockEl.textContent = formatClock(state.clockMinutes);
    const remaining = state.collectibles.filter((c) => !c.collected).length;
    collectiblesEl.textContent = `${remaining}/${state.collectibles.length}`;
    playersCountEl.textContent = `${state.players.length}`;
    winBannerEl.textContent = state.winner
      ? `${state.winner === 'team' ? 'Team wins!' : 'Vampanchino wins!'}`
      : '';
  }

  function handleMessage(ev) {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'welcome') {
        state.playerId = msg.playerId;
        applyState(msg.state || {});
        setStatus('Connected to room ' + msg.roomCode);
        state.connected = true;
      } else if (msg.type === 'state') {
        applyState(msg.state);
      } else if (msg.type === 'error') {
        setStatus('Error: ' + msg.message);
      }
    } catch (err) {
      console.error('Bad message', err);
    }
  }

  function connect(roomCode, role, name, avatar) {
    if (socket) {
      socket.close();
    }
    setStatus('Connecting...');
    socket = new WebSocket(WS_URL);
    socket.addEventListener('open', () => {
      setStatus('Connected, joining room...');
      socket.send(JSON.stringify({ type: 'join', roomCode, role, name, avatar }));
    });
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', () => {
      setStatus('Disconnected');
      state.connected = false;
    });
    socket.addEventListener('error', () => setStatus('Connection error'));
  }

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(joinForm);
    const name = (data.get('name') || 'Player').toString().slice(0, 20);
    const roomCode = (data.get('room') || 'SANT20').toString().toUpperCase();
    const role = data.get('role') || 'runner';
    const avatar = role === 'runner' ? (data.get('runner') || 'aleena') : 'vampanchino';
    connect(roomCode, role, name, avatar);
  });

  roleEl.addEventListener('change', () => {
    const role = roleEl.value;
    if (role === 'runner') {
      runnerPicker.style.display = 'block';
    } else {
      runnerPicker.style.display = 'none';
    }
  });
  roleEl.dispatchEvent(new Event('change'));
})();

