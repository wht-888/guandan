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

// 两队独立A阶段:一队A1、二队4 → 二队升7且一队A2 → 打7 → 一队赢后下副打A2。
{
  const e = new Engine({ rng: () => 0.5 });
  e.levels = [14, 4]; e.failA = [0, 0];
  e.curLevel = 14; e.curLevelTeam = 0; e.phase = 'play';
  e.finished = [1, 3]; // 二队双上,一队双下
  ok(e.checkHandEnd(), 'A1局二队双上后应正常结算');
  ok(e.levels[0] === 14 && e.failA[0] === 1, '一队A1失败后进入A2');
  ok(e.levels[1] === 7, '二队从4双下对手后升到7');

  e.startHand();
  ok(e.curLevelTeam === 1 && e.curLevel === 7, '下一副由二队级牌权打7');
  e.phase = 'play'; e.finished = [0, 1, 2]; // 一队头游+三游,但本副不是一队A局
  ok(e.checkHandEnd() && !e.over, '一队在二队7局获胜不能直接过A');
  ok(e.levels[0] === 14 && e.failA[0] === 1, '一队仍保持A2阶段');

  e.startHand();
  ok(e.curLevelTeam === 0 && e.curLevel === 14 && e.failA[0] === 1, '下下副由一队级牌权打A2');
  e.phase = 'play'; e.finished = [0, 2];
  ok(e.checkHandEnd() && e.over && e.winnerTeam === 0, '一队A2双上后成功过A');
}

// A3仍未通过则该队独立回到2,不影响对方升级。
{
  const e = new Engine({});
  e.levels = [14, 4]; e.failA = [2, 0];
  e.curLevel = 14; e.curLevelTeam = 0; e.phase = 'play'; e.finished = [1, 3];
  ok(e.checkHandEnd(), 'A3失败局正常结算');
  ok(e.levels[0] === 2 && e.failA[0] === 0, '一队A3失败后回到2');
  ok(e.levels[1] === 7, '二队仍按双上从4升7');
}

// K升级进入A时从A1开始;A2失败后进入A3。
{
  const enter = new Engine({});
  enter.levels = [13, 4]; enter.failA = [0, 0];
  enter.curLevel = 4; enter.curLevelTeam = 1; enter.phase = 'play'; enter.finished = [0, 1, 2];
  ok(enter.checkHandEnd() && enter.levels[0] === 14 && enter.failA[0] === 0, '一队从K升级后进入A1');

  const fail = new Engine({});
  fail.levels = [14, 7]; fail.failA = [1, 0];
  fail.curLevel = 14; fail.curLevelTeam = 0; fail.phase = 'play'; fail.finished = [0, 1, 3]; // 一队头游+末游
  ok(fail.checkHandEnd() && fail.levels[0] === 14 && fail.failA[0] === 2, '一队A2未过后进入A3');
}

console.log(`OK: engine 贡牌/首出/牌型解释 ${n} 项全部通过`);
