/** 引擎定向测试: 进贡后首出规则 */
const { Engine } = require('../shared/engine.js');
let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

// 单贡: 末游(进贡者)先出
{
  const e = new Engine({});
  e.prevPlacements = [0, 1, 2, 3];
  e.phase = 'tribute';
  e.hands = [[{ id: 1, suit: 0, rank: 3, deck: 0 }], [], [], []];
  e.tribute = { pairs: [{ giver: 3, receiver: 0, card: { id: 9, suit: 4, rank: 17, deck: 0 } }], pendingReturns: [0], kangong: false };
  const res = e.applyAction(0, { kind: 'returnTribute', cardId: 1 });
  ok(res.ok && e.phase === 'play', '还贡后进入出牌阶段');
  ok(e.current === 3, '单贡: 末游先出');
}
// 双下: 进贡牌大者先出
{
  const e = new Engine({});
  e.prevPlacements = [0, 2, 1, 3]; // 0,2 双下 1,3
  e.phase = 'tribute';
  e.hands = [[{ id: 1, suit: 0, rank: 3, deck: 0 }], [], [{ id: 2, suit: 1, rank: 4, deck: 0 }], []];
  e.tribute = {
    pairs: [
      { giver: 3, receiver: 0, card: { id: 9, suit: 0, rank: 5, deck: 0 } },
      { giver: 1, receiver: 2, card: { id: 10, suit: 0, rank: 14, deck: 0 } }
    ],
    pendingReturns: [0, 2], kangong: false, doubleDown: true
  };
  e.applyAction(0, { kind: 'returnTribute', cardId: 1 });
  const res = e.applyAction(2, { kind: 'returnTribute', cardId: 2 });
  ok(res.ok && e.phase === 'play', '双下还贡完成');
  ok(e.current === 1, '双下: 贡大牌者(座位1)先出, got ' + e.current);
}
// 双下贡牌相同: 头游的上家先出
{
  const e = new Engine({});
  e.prevPlacements = [0, 2, 1, 3];
  e.phase = 'tribute';
  e.hands = [[{ id: 1, suit: 0, rank: 3, deck: 0 }], [], [{ id: 2, suit: 1, rank: 4, deck: 0 }], []];
  e.tribute = {
    pairs: [
      { giver: 3, receiver: 0, card: { id: 9, suit: 0, rank: 14, deck: 0 } },
      { giver: 1, receiver: 2, card: { id: 10, suit: 1, rank: 14, deck: 1 } }
    ],
    pendingReturns: [0, 2], kangong: false, doubleDown: true
  };
  e.applyAction(0, { kind: 'returnTribute', cardId: 1 });
  e.applyAction(2, { kind: 'returnTribute', cardId: 2 });
  ok(e.current === 3, '贡牌相同: 头游上家(座位3)先出, got ' + e.current);
}
console.log(`OK: engine 首出规则 ${n} 项全部通过`);
