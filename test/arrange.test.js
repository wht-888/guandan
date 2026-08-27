/** 一键组牌优化测试:保留炸弹,最小化总手数并减少单张 */
const R = require('../shared/rules.js');

let id = 5000, n = 0;
const C = (suit, rank, deck = 0) => ({ id: id++, suit, rank, deck });
function ok(cond, msg) {
  n++;
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

function verifyPartition(hand, groups, lv) {
  const original = hand.map(c => c.id).sort((a, b) => a - b);
  const arranged = groups.flatMap(p => p.cards.map(c => c.id)).sort((a, b) => a - b);
  ok(JSON.stringify(arranged) === JSON.stringify(original), '组牌结果必须无遗漏、无重复地覆盖全部手牌');
  ok(groups.every(p => R.analyze(p.cards, lv).some(a => a.type === p.type && a.key === p.key)), '每个分组都必须是规则引擎认可的合法牌型');
}

// 旧优先级贪心会得到11手/5单张;优化后应保留同花顺并拆为9手/3单张。
{
  const lv = [15];
  const hand = [
    C(2, 3), C(1, 9), C(4, 16), C(1, 15), C(1, 8), C(1, 14), C(1, 13),
    C(3, 5, 0), C(3, 5, 1), C(4, 17), C(2, 6), C(1, 11), C(1, 6), C(1, 12),
    C(0, 3), C(3, 12, 0), C(3, 8), C(0, 13), C(3, 12, 1), C(3, 13), C(2, 7),
    C(2, 15), C(2, 13), C(0, 5), C(3, 6), C(0, 15), C(2, 10)
  ];
  const groups = R.optimizeHandGroups(hand, lv, { maxMs: 500, maxNodes: 50000 });
  verifyPartition(hand, groups, lv);
  ok(groups.some(p => p.type === 'straightflush'), '应保留原有同花顺炸弹');
  ok(groups.length === 9, '应由旧算法的11手降到9手, got ' + groups.length);
  ok(groups.filter(p => p.len === 1).length === 3, '单张应由5张降到3张');
}

// 天然四张炸即使能参与普通顺子,也必须整体保留。
{
  const lv = [15];
  const bomb7 = [C(0, 7), C(1, 7), C(2, 7), C(3, 7)];
  const hand = bomb7.concat([C(0, 3), C(1, 4), C(2, 5), C(3, 6), C(0, 8), C(1, 9)]);
  const groups = R.optimizeHandGroups(hand, lv, { maxMs: 500, maxNodes: 50000 });
  verifyPartition(hand, groups, lv);
  const bomb = groups.find(p => p.type === 'bomb' && p.key === 7);
  ok(bomb && bomb.cards.length === 4 && bomb7.every(c => bomb.cards.some(x => x.id === c.id)), '天然7炸必须完整保留');
}

// 两副牌可形成两组同点同花顺时,两组都应被发现并保留。
{
  const lv = [15];
  const hand = [];
  for (let deck = 0; deck < 2; deck++) for (let rank = 3; rank <= 7; rank++) hand.push(C(0, rank, deck));
  const groups = R.optimizeHandGroups(hand, lv, { maxMs: 500, maxNodes: 50000 });
  verifyPartition(hand, groups, lv);
  ok(groups.length === 2 && groups.every(p => p.type === 'straightflush'), '两组同点同花顺必须分别保留');
}

console.log(`OK: 一键组牌 ${n} 项全部通过`);
