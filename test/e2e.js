/** 联机端到端: 3 个 ws 客户端 + 1 个 AI, 打完一手并进入下一手 */
const WebSocket = require('ws');
const R = require('../shared/rules.js');
const AI = require('../shared/ai.js');

const URL = 'ws://127.0.0.1:18099';
const clients = [];
let settleCount = 0;
let started = false;

function mkClient(name) {
  const c = { name, ws: new WebSocket(URL), seat: -1, code: null, state: null, room: null };
  c.ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'joined') { c.seat = m.seat; c.code = m.code; }
    else if (m.t === 'room') {
      c.room = m;
      if (c.seat === 0 && !m.started && !started) {
        const humans = m.seats.filter(s => s && !s.isAI).length;
        if (humans === 3 && m.seats.filter(s => s).length === 3) c.ws.send(JSON.stringify({ t: 'addAI' }));
        if (m.seats.every(s => s)) { started = true; c.ws.send(JSON.stringify({ t: 'start' })); }
      }
    }
    else if (m.t === 'state') {
      c.state = m.state;
      maybeAct(c);
    }
    else if (m.t === 'error') { console.error(`[${name}] error:`, m.msg); }
  });
  clients.push(c);
  return c;
}

function maybeAct(c) {
  const st = c.state;
  if (!st) return;
  if (st.phase === 'settle') {
    if (c.seat === 0 && !st.over) {
      settleCount++;
      if (settleCount === 1) {
        console.log('✔ 第一手打完, 名次:', st.settle.placements, '升级 delta=', st.settle.delta, '双下=', st.settle.doubleDown);
        setTimeout(() => c.ws.send(JSON.stringify({ t: 'next' })), 300);
      } else if (settleCount >= 2) {
        console.log('✔ 第二手(含进贡流程)打完');
        finish(true);
      }
    }
    return;
  }
  const fakeEngine = { getStateFor: () => st };
  if (st.phase === 'tribute' && ((st.tribute.pendingTributes || []).includes(st.mySeat) || st.tribute.pendingReturns.includes(st.mySeat))) {
    setTimeout(() => c.ws.send(JSON.stringify({ t: 'action', action: AI.decide(fakeEngine, st.mySeat) })), 150);
    return;
  }
  if (st.phase === 'play' && st.current === st.mySeat) {
    setTimeout(() => c.ws.send(JSON.stringify({ t: 'action', action: AI.decide(fakeEngine, st.mySeat) })), 150);
  }
}

function finish(ok) {
  console.log(ok ? 'E2E PASS' : 'E2E FAIL');
  process.exit(ok ? 0 : 1);
}

setTimeout(() => finish(false), 60000);
mkClient('甲').ws.on('open', () => clients[0].ws.send(JSON.stringify({ t: 'create', name: '甲' })));
setTimeout(() => mkClient('乙').ws.on('open', () => clients[1].ws.send(JSON.stringify({ t: 'join', code: clients[0].code, name: '乙' }))), 400);
setTimeout(() => mkClient('丙').ws.on('open', () => clients[2].ws.send(JSON.stringify({ t: 'join', code: clients[0].code, name: '丙' }))), 800);
