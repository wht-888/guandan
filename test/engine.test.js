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
// 进贡最大牌为同点多花色级牌时,必须由进贡方选择具体花色。
{
  const C = (id, suit, rank) => ({ id, suit, rank, deck: 0 });
  const e = new Engine({});
  e.curLevel = 5; e.phase = 'tribute';
  e.hands = [[], [], [], [C(31, 0, 5), C(32, 3, 5), C(33, 1, 5), C(34, 2, 4)]]; // ♥5为逢人配,不可进贡
  e.tribute = {
    pairs: [{ giver: 3, receiver: 0 }], pendingTributes: [3], pendingReturns: [], kangong: false
  };
  const bad = e.applyAction(3, { kind: 'giveTribute', cardId: 34 });
  ok(!bad.ok && e.tribute.pendingTributes[0] === 3, '不能用低于最大牌的♦4进贡');
  const picked = e.applyAction(3, { kind: 'giveTribute', cardId: 32 });
  ok(picked.ok && e.tribute.pairs[0].card.id === 32 && e.hands[0][0].suit === 3, '进贡方可自行选择♣5花色');
  ok(e.tribute.pendingTributes.length === 0 && e.tribute.pendingReturns[0] === 0, '选完贡牌后才进入还贡阶段');
}

// 真实发牌流程中遇到同点多花色最大普通牌时,不得提前自动转移。
{
  let found = null;
  for (let seed = 1; seed <= 200 && !found; seed++) {
    let x = seed;
    const rng = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const e = new Engine({ rng });
    e.prevPlacements = [0, 1, 2, 3];
    e.startHand();
    if (e.phase === 'tribute' && e.tribute && e.tribute.pendingTributes.length) found = e;
  }
  ok(!!found, '真实发牌应能进入手选贡牌花色阶段');
  const giver = found.tribute.pendingTributes[0];
  const pair = found.tribute.pairs.find(p => p.giver === giver);
  ok(!pair.card && found.hands[giver].length === 27, '选择前贡牌仍留在进贡方手中');
}

// 逢人配三带二多解释:动作携带key时尊重声明;旧客户端缺key时默认最强解释。
{
  const C = (id, suit, rank) => ({ id, suit, rank, deck: 0 });
  const cards = [C(41, 1, 15), C(42, 0, 14), C(43, 3, 14), C(44, 0, 7), C(45, 3, 7)];
  const makeEngine = () => {
    const e = new Engine({});
    e.curLevel = 2; e.phase = 'play'; e.current = 0;
    e.hands = [cards.slice(), [C(51, 0, 3)], [C(52, 0, 4)], [C(53, 0, 5)]];
    e.finished = []; e.target = null; e.passCount = 0; e.lastPlays = [null, null, null, null];
    return e;
  };
  const declared = makeEngine();
  ok(declared.applyAction(0, { kind: 'play', cardIds: cards.map(c => c.id), type: 'fullhouse', key: 14 }).ok && declared.target.pattern.key === 14,
    '2(配)+AA+77声明三A带对7时必须按A判定');
  const fallback = makeEngine();
  ok(fallback.applyAction(0, { kind: 'play', cardIds: cards.map(c => c.id), type: 'fullhouse' }).ok && fallback.target.pattern.key === 14,
    '缺少key的旧动作也应默认采用最强的三A解释');
}

console.log(`OK: engine 贡牌/首出/牌型解释 ${n} 项全部通过`);
