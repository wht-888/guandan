const R = require('../shared/rules.js');
let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error('FAIL:', msg); process.exit(1); } }
const C = (s, r) => ({ id: Math.random(), suit: s, rank: r, deck: 0 });
const lv2 = [15]; // 打2

// 基础大小: 2 最小, 级牌>A, 王最大
ok(R.orderOf(15, [5]) === 2, '2 是最小牌');
ok(R.orderOf(14, lv2) === 14 && R.orderOf(15, lv2) === 15.5, '打2时2是级牌');
ok(R.orderOf(17, lv2) === 17, '大王最大');

// 牌型识别
ok(R.analyze([C(0, 5)], lv2)[0].type === 'single', '单张');
ok(R.analyze([C(0, 5), C(1, 5)], lv2)[0].type === 'pair', '对子');
ok(R.analyze([C(0, 5), C(1, 5), C(2, 5)], lv2)[0].type === 'triple', '三张');
ok(R.analyze([C(0, 5), C(1, 5), C(2, 5), C(0, 9), C(1, 9)], lv2)[0].type === 'fullhouse', '三带二');
ok(R.analyze([C(0, 5), C(1, 5), C(2, 5), C(3, 5)], lv2)[0].type === 'bomb', '4张炸');
ok(R.analyze([C(0, 3), C(1, 4), C(2, 5), C(3, 6), C(0, 7)], lv2).some(p => p.type === 'straight'), '顺子');
ok(R.analyze([C(0, 3), C(0, 4), C(0, 5), C(0, 6), C(0, 7)], lv2).some(p => p.type === 'straightflush'), '同花顺');
ok(R.analyze([C(0, 6), C(1, 6), C(0, 7), C(1, 7), C(0, 8), C(1, 8)], lv2).some(p => p.type === 'pairseq'), '三连对');
ok(R.analyze([C(0, 6), C(1, 6), C(2, 6), C(0, 7), C(1, 7), C(2, 7)], lv2).some(p => p.type === 'tripleseq'), '钢板');
ok(R.analyze([C(4, 16), C(4, 16), C(4, 17), C(4, 17)], lv2)[0].type === 'jokerbomb', '四大天王');
ok(R.analyze([C(4, 16), C(4, 16)], lv2)[0].type === 'pair', '对小王');

// 逢人配
ok(R.analyze([C(1, 15), C(0, 13), C(1, 13), C(2, 13)], lv2).some(p => p.type === 'bomb'), '配+3K=4张炸');
ok(R.analyze([C(1, 15), C(0, 4), C(1, 5), C(2, 6), C(3, 7)], lv2).some(p => p.type === 'straight'), '配补顺子');
ok(R.analyze([C(1, 15)], lv2)[0].key === 15.5, '配单出=级牌');
ok(R.analyze([C(1, 15), C(0, 5)], lv2).some(p => p.type === 'pair'), '配+单=对子');

// 顺子多解释: 7-8-9-10+配 可为 7..J
const p1 = R.analyze([C(1, 15), C(0, 7), C(1, 8), C(2, 9), C(3, 10)], lv2);
ok(p1.some(p => p.type === 'straight' && p.key === 6), '顺子多解释(高位 7-J)');

// 大小比较
const straight8 = { type: 'straight', key: 8, len: 5 };
const straight9 = { type: 'straight', key: 9, len: 5 };
ok(R.canBeat(straight9, straight8) && !R.canBeat(straight8, straight9), '顺子比大小');
ok(R.canBeat({ type: 'bomb', key: 3, len: 4 }, straight9), '炸弹压顺子');
ok(R.canBeat({ type: 'straightflush', key: 5, len: 5 }, { type: 'bomb', key: 14, len: 5 }), '同花顺>5张炸');
ok(R.canBeat({ type: 'bomb', key: 3, len: 6 }, { type: 'straightflush', key: 14, len: 5 }), '6张炸>同花顺');
ok(R.canBeat({ type: 'jokerbomb', key: 17, len: 4 }, { type: 'bomb', key: 15.5, len: 8 }), '天王最大');
ok(!R.canBeat({ type: 'pair', key: 14, len: 2 }, { type: 'pair', key: 15.5, len: 2 }), '对A压不过对级牌');
ok(!R.canBeat({ type: 'single', key: 3, len: 1 }, { type: 'pair', key: 3, len: 2 }), '异型不可压');

// 提示枚举
const hand = [C(0, 4), C(1, 4), C(2, 5), C(3, 6), C(0, 7), C(3, 13), C(4, 17)];
const beat = R.findBeat(hand, { type: 'single', key: 10, len: 1 }, lv2);
ok(beat && beat.type === 'single' && beat.key === 13, '提示找最小单张(K)');


// 回归: 打3时(单一级牌), 三个2 不能压 三个K
ok(!R.canBeat({ type: 'triple', key: R.orderOf(15, [3]), len: 3 }, { type: 'triple', key: R.orderOf(13, [3]), len: 3 }), '打3时三个2压不过三个K');
ok(R.orderOf(15, [3]) === 2, '打3时2是最小牌');

// 回归: 2 和级牌可按自然顺序参与序列(竞赛规则)
const lv7 = [7];
ok(R.analyze([C(0, 15), C(1, 15), C(0, 3), C(1, 3), C(2, 4), C(3, 4)], lv7).some(p => p.type === 'pairseq'), '223344 是三连对');
ok(R.analyze([C(0, 15), C(1, 15), C(2, 15), C(0, 3), C(1, 3), C(2, 3)], lv7).some(p => p.type === 'tripleseq'), '222333 是钢板');
ok(R.analyze([C(0, 15), C(0, 3), C(1, 4), C(2, 5), C(3, 6)], lv7).some(p => p.type === 'straight'), '23456 是顺子');
ok(R.analyze([C(0, 5), C(1, 5), C(0, 4), C(1, 4), C(2, 6), C(3, 6)], [5]).some(p => p.type === 'pairseq'), '打5时 445566 是三连对(级牌按自然顺序)');
ok(R.analyze([C(0, 12), C(1, 12), C(0, 13), C(1, 13), C(2, 14), C(3, 14)], lv7).some(p => p.type === 'pairseq'), 'QQKKAA 是三连对');
ok(R.analyze([C(0, 14), C(1, 14), C(0, 15), C(1, 15), C(2, 3), C(3, 3)], lv7).some(p => p.type === 'pairseq'), 'AA2233 是三连对');
ok(!R.analyze([C(0, 13), C(1, 13), C(0, 14), C(1, 14), C(2, 15), C(3, 15)], [15]).length, '打2时 KKAA22 非法');
ok(!R.analyze([C(0, 13), C(1, 13), C(0, 14), C(1, 14), C(2, 15), C(3, 15)], lv7).length, 'KKAA22 无条件非法');
ok(R.canBeat({ type: 'pairseq', key: 4, len: 6 }, { type: 'pairseq', key: 3, len: 6 }), '223344 压 334455');

// 回归: A-2-3 衔接序列
ok(R.analyze([C(0, 14), C(0, 15), C(1, 3), C(2, 4), C(3, 5)], lv7).some(p => p.type === 'straight' && p.key === 0), 'A2345 是最小顺子');
ok(R.analyze([C(0, 14), C(1, 14), C(0, 15), C(1, 15), C(2, 3), C(3, 3)], lv7).some(p => p.type === 'pairseq' && p.key === 0), 'AA2233 是最小三连对');
ok(R.analyze([C(0, 14), C(1, 14), C(2, 14), C(0, 15), C(1, 15), C(2, 15)], lv7).some(p => p.type === 'tripleseq'), 'AAA222 是钢板');
ok(R.canBeat({ type: 'straight', key: 1, len: 5 }, { type: 'straight', key: 0, len: 5 }), '23456 压 A2345');
ok(R.canBeat({ type: 'pairseq', key: 1, len: 6 }, { type: 'pairseq', key: 0, len: 6 }), '223344 压 AA2233');

// 回归: 同花顺同样适用 A-2-3 链
ok(R.analyze([C(1, 14), C(1, 15), C(1, 3), C(1, 4), C(1, 5)], lv7).some(p => p.type === 'straightflush' && p.key === 0), 'A2345同花顺合法且最小');
ok(R.analyze([C(0, 10), C(0, 11), C(0, 12), C(0, 13), C(0, 14)], lv7).some(p => p.type === 'straightflush' && p.key === 9), '10JQKA同花顺最大');
ok(!R.analyze([C(1, 13), C(1, 14), C(1, 15), C(1, 3), C(1, 4)], lv7).some(p => p.type === 'straightflush'), 'KA234同花顺非法');
ok(R.canBeat({ type: 'straightflush', key: 1, len: 5 }, { type: 'straightflush', key: 0, len: 5 }), '23456同花顺压A2345同花顺');

console.log(`OK: rules 单测 ${n} 项全部通过`);
