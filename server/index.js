/**
 * 掼蛋服务器: 静态文件 + WebSocket 房间(局域网)
 * 启动: npm start  然后浏览器访问 http://<本机IP>:8080
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Engine } = require('../shared/engine.js');
const AI = require('../shared/ai.js');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let file = path.join(ROOT, 'public', urlPath);
  if (!fs.existsSync(file) && urlPath.startsWith('/shared/')) file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> room
const AI_NAMES = ['机器人·阿汪', '机器人·喵喵', '机器人·咕咕', '机器人·熊熊'];
const AI_AVATARS = ['🐶', '🐱', '🐔', '🐻'];
const HUMAN_AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐵', '🦁', '🐷', '🐰'];

function makeCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  return code;
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function roomSnapshot(room) {
  return {
    t: 'room', code: room.code, host: room.host, started: room.started,
    seats: room.seats.map(s => s ? { name: s.name, avatar: s.avatar, isAI: s.isAI, online: !!s.ws } : null)
  };
}

function broadcastRoom(room) {
  for (const s of room.seats) if (s && s.ws) send(s.ws, roomSnapshot(room));
}

function broadcastState(room) {
  for (let i = 0; i < 4; i++) {
    const s = room.seats[i];
    if (s && s.ws) send(s.ws, { t: 'state', seat: i, state: room.engine.getStateFor(i) });
  }
}

function scheduleAI(room) {
  clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => stepAI(room), 900);
}

function stepAI(room) {
  const e = room.engine;
  if (!e) return;
  if (e.phase === 'settle' || e.phase === 'over' || e.over) return; // 等待房主下一局
  let seat = -1;
  if (e.phase === 'tribute') seat = e.tribute.pendingReturns[0];
  else if (e.phase === 'play') seat = e.current;
  if (seat < 0) return;
  const occupant = room.seats[seat];
  if (occupant && occupant.ws) return; // 真人, 等待操作
  const res = e.applyAction(seat, AI.decide(e, seat));
  if (!res.ok) { // AI 兜底: 能不出就不出
    if (e.phase === 'play' && e.target) e.applyAction(seat, { kind: 'pass' });
    else console.error('AI stuck', res.error);
  }
  broadcastState(room);
  scheduleAI(room);
}

function maybeStartAI(room) {
  const e = room.engine;
  if (!e || e.phase === 'settle' || e.over) return;
  let seat = -1;
  if (e.phase === 'tribute') seat = e.tribute.pendingReturns[0];
  else if (e.phase === 'play') seat = e.current;
  if (seat >= 0 && !(room.seats[seat] && room.seats[seat].ws)) scheduleAI(room);
}

function handleMessage(ws, msg) {
  let m;
  try { m = JSON.parse(msg); } catch { return; }
  const ctx = ws._ctx || {};

  if (m.t === 'create' || m.t === 'join') {
    let room;
    if (m.t === 'create') {
      const code = makeCode();
      room = { code, seats: [null, null, null, null], host: 0, started: false, engine: null, aiTimer: null };
      rooms.set(code, room);
    } else {
      room = rooms.get(String(m.code || ''));
      if (!room) return send(ws, { t: 'error', msg: '房间不存在' });
      if (room.started) return send(ws, { t: 'error', msg: '该房间已开始游戏' });
      if (room.seats.every(s => s)) return send(ws, { t: 'error', msg: '房间已满' });
    }
    const seatIdx = room.seats.findIndex(s => !s);
    const name = String(m.name || '玩家').slice(0, 12);
    room.seats[seatIdx] = { name, avatar: HUMAN_AVATARS[Math.floor(Math.random() * HUMAN_AVATARS.length)], ws, isAI: false };
    ws._ctx = { code: room.code, seat: seatIdx };
    send(ws, { t: 'joined', code: room.code, seat: seatIdx });
    broadcastRoom(room);
    return;
  }

  const room = rooms.get(ctx.code);
  if (!room) return send(ws, { t: 'error', msg: '房间已关闭' });
  const seat = ctx.seat;

  if (m.t === 'addAI') {
    if (room.started || seat !== room.host) return;
    const idx = room.seats.findIndex(s => !s);
    if (idx < 0) return;
    room.seats[idx] = { name: AI_NAMES[idx], avatar: AI_AVATARS[idx], ws: null, isAI: true };
    broadcastRoom(room);
    return;
  }
  if (m.t === 'removeAI') {
    if (room.started || seat !== room.host) return;
    const s = room.seats[m.seat];
    if (s && s.isAI) room.seats[m.seat] = null;
    broadcastRoom(room);
    return;
  }
  if (m.t === 'start') {
    if (room.started || seat !== room.host) return;
    for (let i = 0; i < 4; i++) if (!room.seats[i]) room.seats[i] = { name: AI_NAMES[i], avatar: AI_AVATARS[i], ws: null, isAI: true };
    room.started = true;
    room.engine = new Engine({});
    room.engine.startHand();
    broadcastRoom(room);
    broadcastState(room);
    maybeStartAI(room);
    return;
  }
  if (m.t === 'next') {
    if (!room.started || !room.engine) return;
    const e = room.engine;
    if (e.phase !== 'settle') return;
    if (e.over) { room.engine = new Engine({}); }
    room.engine.startHand();
    broadcastState(room);
    maybeStartAI(room);
    return;
  }
  if (m.t === 'action') {
    if (!room.started || !room.engine) return;
    const res = room.engine.applyAction(seat, m.action);
    if (!res.ok) return send(ws, { t: 'error', msg: res.error });
    broadcastState(room);
    maybeStartAI(room);
    return;
  }
  if (m.t === 'leave') { cleanupSeat(ws); return; }
}

function cleanupSeat(ws) {
  const ctx = ws._ctx;
  if (!ctx) return;
  const room = rooms.get(ctx.code);
  ws._ctx = null;
  if (!room) return;
  const s = room.seats[ctx.seat];
  if (!room.started) {
    room.seats[ctx.seat] = null;
    // 重排房主
    if (ctx.seat === room.host) {
      const idx = room.seats.findIndex(x => x && !x.isAI);
      if (idx < 0) { clearTimeout(room.aiTimer); rooms.delete(room.code); return; }
      room.host = idx;
    }
    broadcastRoom(room);
  } else if (s) {
    // 对局中掉线: 转为 AI 托管
    s.ws = null; s.isAI = true; s.name = s.name + '(托管)';
    broadcastRoom(room);
    maybeStartAI(room);
  }
}

wss.on('connection', ws => {
  ws.on('message', msg => { try { handleMessage(ws, msg); } catch (e) { console.error(e); } });
  ws.on('close', () => cleanupSeat(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => i.address);
  console.log(`掼蛋服务器已启动:`);
  console.log(`  本机:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  局域网: http://${ip}:${PORT}  (同一 WiFi 下的设备可加入)`);
});
