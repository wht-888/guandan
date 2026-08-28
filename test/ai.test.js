/** AI 定向策略测试:不看隐藏手牌,验证保牌、配合、威胁与记牌决策 */
const AI = require('../shared/ai.js');
const R = require('../shared/rules.js');

let nextId = 1000, n = 0;
function card(rank, suit = 0) { return { id: nextId++, rank, suit, deck: 0 }; }
function ok(cond, msg) {
  n++;
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

function baseState(hand, opts = {}) {
  const target = opts.target || null;
  return {
    phase: opts.phase || 'play', handNo: opts.handNo || 1,
    levels: [2, 2], failA: [0, 0], curLevel: 2,
    over: false, winnerTeam: null, levelRanks: [15], mySeat: 0,
    myHand: hand, counts: opts.counts || [hand.length, 8, 8, 8],
    current: 0, target,
    lastPlays: opts.lastPlays || [null, null, null, null],
    finished: opts.finished || [], tribute: opts.tribute || null,
    settle: null, lastEvent: opts.lastEvent || null
  };
}

function fakeEngine(initial) {
  return { state: initial, getStateFor() { return this.state; } };
}

function singleTarget(rank, seat = 1) {
  const c = card(rank, 3);
  return { seat, cards: [c], pattern: { type: 'single', key: R.orderOf(rank, [15]), len: 1, cards: [c], wildUsed: 0 } };
}

// 队友最后一手也不压,让队友出完后顺利接风。
{
  const hand = [card(8), card(9)];
  const st = baseState(hand, { target: singleTarget(7, 2), counts: [2, 6, 0, 6], finished: [2] });
  ok(AI.decide(fakeEngine(st), 0).kind === 'pass', '不应压已出完队友的末手');
}

// 有普通替代牌时,不从四张天然炸弹中拆一张跟牌。
{
  const bomb = [card(8, 0), card(8, 1), card(8, 2), card(8, 3)];
  const nine = card(9);
  const hand = bomb.concat([nine, card(3)]);
  const st = baseState(hand, { target: singleTarget(7), counts: [6, 6, 7, 7] });
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'play' && action.cardIds[0] === nine.id, '应使用9跟牌而不是拆8炸');
}

// 无迫切威胁时不随机炸;对手仅剩一张时则果断拦截。
{
  const bomb = [card(3, 0), card(3, 1), card(3, 2), card(3, 3)];
  const hand = bomb.concat([card(4), card(5), card(6), card(8), card(9)]);
  const targetCard = card(14);
  const target = { seat: 1, cards: [targetCard], pattern: { type: 'pair', key: 14, len: 2, cards: [targetCard], wildUsed: 0 } };
  const calm = baseState(hand, { target, counts: [9, 6, 7, 7] });
  ok(AI.decide(fakeEngine(calm), 0).kind === 'pass', '无威胁时应保留炸弹');
  const urgent = baseState(hand, { target, counts: [9, 1, 7, 6] });
  const action = AI.decide(fakeEngine(urgent), 0);
  ok(action.kind === 'play' && action.cardIds.length === 4, '对手剩一张时应使用炸弹拦截');
}

// 两组炸弹已经占据大部分手牌且对手进入收尾时,拿到牌权应主动出炸减负。
{
  const bomb3 = [card(3, 0), card(3, 1), card(3, 2), card(3, 3)];
  const bomb8 = [card(8, 0), card(8, 1), card(8, 2), card(8, 3)];
  const hand = bomb3.concat(bomb8, [card(10), card(12)]);
  const st = baseState(hand, { counts: [10, 4, 6, 5] });
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'play' && action.type === 'bomb', '炸弹占手且对手收尾时应主动领炸');
}

// 一名对手已经出完时不能继续抱炸,必须阻断另一名对手完成双下。
{
  const bomb = [card(6, 0), card(6, 1), card(6, 2), card(6, 3)];
  const hand = bomb.concat([card(3), card(4), card(8), card(10), card(12)]);
  const targetCard = card(14);
  const target = { seat: 3, cards: [targetCard], pattern: { type: 'pair', key: 14, len: 2, cards: [targetCard], wildUsed: 0 } };
  const st = baseState(hand, { target, counts: [9, 0, 6, 5], finished: [1] });
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'play' && action.type === 'bomb', '已有对手出完时应立即用炸弹夺权');
}

// 还贡优先给不破坏组合的孤张,而不是机械地拆最小对子。
{
  const pair3 = [card(3, 0), card(3, 2)];
  const single4 = card(4, 3);
  const st = baseState(pair3.concat([single4]), { phase: 'tribute' });
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'returnTribute' && action.cardId === single4.id, '还贡应保留3对子并给出孤张4');
}

// AI需要进贡同点多花色级牌时,选择对同花结构破坏更小的花色。
{
  const spadeLevel = card(5, 0), clubLevel = card(5, 3);
  const hand = [spadeLevel, clubLevel, card(5, 1), card(3, 0), card(4, 0)]; // ♥5为配
  const st = baseState(hand, {
    phase: 'tribute', tribute: { pairs: [{ giver: 0, receiver: 3 }], pendingTributes: [0], pendingReturns: [] }
  });
  st.levelRanks = [5]; st.curLevel = 5;
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'giveTribute' && action.cardId === clubLevel.id, 'AI应选择同花结构较弱的♣5进贡');
}

// 队友只剩一张时主动领单张喂牌,不抢着甩长牌型。
{
  const hand = [card(3), card(4), card(5), card(6), card(7), card(10), card(12)];
  const st = baseState(hand, { counts: [7, 6, 1, 7] });
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'play' && action.cardIds.length === 1, '队友剩一张时应领单张配合');
}

// 残局优先拆成两手:先出顺子,留下可一手走完的对子。
{
  const hand = [card(3, 0), card(4, 1), card(5, 2), card(6, 3), card(7, 0), card(9, 0), card(9, 2)];
  const st = baseState(hand, { counts: [7, 6, 5, 6] });
  const action = AI.decide(fakeEngine(st), 0);
  ok(action.kind === 'play' && action.type === 'straight', '应先出顺子并留下对子收尾');
}

// 多轮记住已经出完的高牌后,8也可视作控制牌,无需浪费A。
{
  const hand = [card(8), card(14), card(3)];
  const engine = fakeEngine(baseState(hand));
  const publicCards = [];
  for (let rank = 9; rank <= 15; rank++) for (let i = 0; i < 8; i++) publicCards.push(card(rank, i % 4));
  for (let rank = 16; rank <= 17; rank++) for (let i = 0; i < 2; i++) publicCards.push(card(rank, 4));
  for (let i = 0; i < publicCards.length; i += 6) {
    engine.state.lastPlays = [{ seat: 1, cards: publicCards.slice(i, i + 6), pattern: { type: 'single', key: 1, len: 1 } }, null, null, null];
    AI.decide(engine, 0);
  }
  engine.state.lastPlays = [null, null, null, null];
  engine.state.target = singleTarget(7, 1);
  engine.state.counts = [3, 1, 5, 6];
  const action = AI.decide(engine, 0);
  ok(action.kind === 'play' && action.cardIds[0] === hand[0].id, '记牌后应使用已成为控制牌的8');
}

console.log(`OK: AI 策略 ${n} 项全部通过`);
