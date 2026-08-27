/** AI 抱炸统计:结算时统计败方仍未使用的炸弹库存 */
const { Engine, teamOf } = require('../shared/engine.js');
const AI = require('../shared/ai.js');
const R = require('../shared/rules.js');

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function bombInventory(hand, lv) {
  const best = new Map();
  for (const p of R.findPlays(hand, lv)) {
    if (R.bombPower(p) <= 0) continue;
    const key = p.type + '|' + p.key;
    const cur = best.get(key);
    if (!cur || p.len > cur.len) best.set(key, p);
  }
  const cards = new Set();
  for (const p of best.values()) for (const c of p.cards) cards.add(c.id);
  return { groups: best.size, cards: cards.size };
}

const matches = Number(process.argv[2] || 50);
let hands = 0, lossesWithBomb = 0, doubleDowns = 0, doubleDownsWithBomb = 0;
let bombGroups = 0, bombCards = 0;

for (let m = 1; m <= matches; m++) {
  const rng = seeded(m * 7919);
  const e = new Engine({ rng });
  e.startHand();
  let steps = 0;
  while (!e.over && steps++ < 25000) {
    if (e.phase === 'settle') {
      hands++;
      const losingTeam = 1 - e.settle.winTeam;
      let held = false;
      for (let seat = 0; seat < 4; seat++) {
        if (teamOf(seat) !== losingTeam) continue;
        const inv = bombInventory(e.hands[seat], e.levelRanks());
        if (inv.groups) held = true;
        bombGroups += inv.groups;
        bombCards += inv.cards;
      }
      if (held) lossesWithBomb++;
      if (e.settle.doubleDown) {
        doubleDowns++;
        if (held) doubleDownsWithBomb++;
      }
      if (!e.over) e.startHand();
      continue;
    }
    const seat = e.phase === 'tribute' ? e.tribute.pendingReturns[0] : e.current;
    const action = AI.decide(e, seat, rng);
    const result = e.applyAction(seat, action);
    if (!result.ok) {
      const chosen = (action.cardIds || []).map(id => e.hands[seat].find(c => c.id === id)).filter(Boolean).map(R.cardText);
      throw new Error(`match=${m} hand=${e.handNo} seat=${seat}: ${result.error}; action=${action.type}:${chosen.join(',')}; target=${e.target ? R.patternName(e.target.pattern) + '/' + e.target.pattern.key : 'lead'}`);
    }
  }
  if (!e.over) throw new Error('bomb benchmark timeout match=' + m);
}

const pct = (n, d) => d ? (n / d * 100).toFixed(1) : '0.0';
console.log(`BOMB BENCH: ${matches}场/${hands}手, 败方抱炸 ${lossesWithBomb}手(${pct(lossesWithBomb, hands)}%)`);
console.log(`BOMB BENCH: 双下 ${doubleDowns}手, 败方抱炸 ${doubleDownsWithBomb}手(${pct(doubleDownsWithBomb, doubleDowns)}%), 剩余炸弹 ${bombGroups}组/${bombCards}张`);
