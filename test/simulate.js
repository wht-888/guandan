/** 4 个 AI 打完整比赛模拟, 校验引擎不变量 */
const { Engine } = require('../shared/engine.js');
const AI = require('../shared/ai.js');
const R = require('../shared/rules.js');

function runMatch(seed) {
  let s = seed;
  const rng = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const e = new Engine({ rng });
  let steps = 0;
  e.startHand();
  while (!e.over && steps < 20000) {
    steps++;
    if (e.phase === 'settle') {
      if (!e.over) e.startHand();
      continue;
    }
    if (e.phase === 'tribute') {
      const seat = (e.tribute.pendingTributes || [])[0] ?? e.tribute.pendingReturns[0];
      const res = e.applyAction(seat, AI.decide(e, seat, rng));
      if (!res.ok) throw new Error('tribute fail: ' + res.error);
      continue;
    }
    if (e.phase === 'play') {
      const seat = e.current;
      const res = e.applyAction(seat, AI.decide(e, seat, rng));
      if (!res.ok) throw new Error(`hand ${e.handNo} seat ${seat} play fail: ${res.error} | target=${JSON.stringify(e.target && e.target.pattern)} | hand=${e.hands[seat].map(R.cardText).join(' ')}`);
      continue;
    }
    throw new Error('bad phase ' + e.phase);
  }
  if (!e.over) throw new Error('match did not finish in ' + steps + ' steps');
  return { steps, hands: e.handNo, winner: e.winnerTeam, levels: e.levels };
}

const N = parseInt(process.argv[2] || '30', 10);
let totalHands = 0;
for (let i = 1; i <= N; i++) {
  const r = runMatch(i * 7919);
  totalHands += r.hands;
  if (i <= 3 || i === N) console.log(`match ${i}: winner=队伍${r.winner} hands=${r.hands} steps=${r.steps} levels=${r.levels}`);
}
console.log(`OK: ${N} 场完整比赛模拟通过, 平均每场 ${(totalHands / N).toFixed(1)} 手`);
