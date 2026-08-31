/** 还贡两步确认: 点选不直发, 确认才发送 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../public/index.html'), {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const code = ['/shared/rules.js', '/js/sound.js', '/js/table.js']
    .map(s => fs.readFileSync(path.join(__dirname, s.startsWith('/shared') ? '..' + s : '../public' + s), 'utf8')).join(';\n');
  window.eval(code + ';window.Table = Table;');
  const $ = id => window.document.getElementById(id);
  const vis = el => !el.classList.contains('hidden');

  let captured = null;
  window.Table.bind(a => { captured = a; }, () => {});
  window.Table.setPlayers([{ name: '我', avatar: '😎' }, { name: '阿汪', avatar: '🐶' }, { name: '喵喵', avatar: '🐱' }, { name: '熊熊', avatar: '🐻' }]);
  const C = (id, s, r) => ({ id, suit: s, rank: r, deck: 0 });
  let n = 0;
  const ok = (c, m) => { n++; if (!c) { console.error('FAIL:', m); process.exit(1); } };

  // 进贡最大牌为同点多花色级牌:低牌不可选,玩家可选择具体花色并确认。
  window.Table.render({
    phase: 'tribute', handNo: 2, levels: [5, 2], curLevel: 5, failA: [0, 0], over: false, winnerTeam: null,
    levelRanks: [5], mySeat: 0,
    myHand: [C(11, 0, 5), C(12, 3, 5), C(13, 1, 5), C(14, 2, 4)], counts: [4, 27, 27, 27], current: -1, target: null,
    lastPlays: [null, null, null, null], finished: [],
    tribute: { pairs: [{ giver: 0, receiver: 3 }], pendingTributes: [0], pendingReturns: [], kangong: false },
    settle: null, lastEvent: null
  });
  const giveCards = [...$('my-hand').querySelectorAll('.card')];
  giveCards.find(el => Number(el.dataset.id) === 14).click();
  ok(!vis($('return-bar')), '进贡不能选择低于最大牌的♦4');
  ok(giveCards.find(el => Number(el.dataset.id) === 14).classList.contains('selected'), '低牌可先选中用于手动理牌');
  giveCards.find(el => Number(el.dataset.id) === 14).click();
  giveCards.find(el => Number(el.dataset.id) === 12).click();
  ok(vis($('return-bar')) && $('return-tip').textContent.includes('♣5'), '可选择具体花色♣5进贡');
  ok($('btn-return-ok').textContent === '确认进贡', '进贡确认按钮文案正确');
  $('btn-return-ok').click();
  ok(captured && captured.kind === 'giveTribute' && captured.cardId === 12, '确认后发送所选花色的进贡动作');
  captured = null;

  const myHand = [C(1, 0, 15), C(2, 0, 13)]; // ♠2(可还) ♠K(不可还)
  window.Table.render({
    phase: 'tribute', handNo: 2, levels: [3, 2], curLevel: 3, failA: [0, 0], over: false, winnerTeam: null,
    levelRanks: [3], mySeat: 0, myHand, counts: [2, 26, 27, 26], current: -1, target: null,
    lastPlays: [null, null, null, null], finished: [],
    tribute: { pairs: [{ giver: 3, receiver: 0, card: C(90, 4, 17) }], pendingReturns: [0], kangong: false },
    settle: null, lastEvent: null
  });
  const cards = [...$('my-hand').querySelectorAll('.card')];

  // 不能还的K仍可选中整理,但不出现确认条且不发送
  cards[1].click();
  ok(!vis($('return-bar')), '点非法还贡牌不出现确认条');
  ok(captured === null, '点非法牌未发送');
  ok(cards[1].classList.contains('selected'), '高牌可先选中用于手动理牌');
  cards[1].click();
  // 点合法牌(2): 出现确认条但不发送
  cards[0].click();
  ok(vis($('return-bar')), '点合法牌出现确认条');
  ok(captured === null, '点选后不直发(防误触)');
  ok($('return-tip').textContent.includes('♠2'), '确认条显示所选牌');
  // 重选: 取消
  $('btn-return-cancel').click();
  ok(!vis($('return-bar')), '重选隐藏确认条');
  // 再点选并确认
  cards[0].click();
  $('btn-return-ok').click();
  ok(captured && captured.kind === 'returnTribute' && captured.cardId === 1, '确认后才发送还贡');
  // 模拟引擎应用后刷新状态(进入 play 阶段): 确认条必须消失
  window.Table.render({
    phase: 'play', handNo: 2, levels: [3, 2], curLevel: 3, failA: [0, 0], over: false, winnerTeam: null,
    levelRanks: [3], mySeat: 0, myHand: [C(2, 0, 13)], counts: [1, 26, 27, 26], current: 0, target: null,
    lastPlays: [null, null, null, null], finished: [],
    tribute: { pairs: [{ giver: 3, receiver: 0, card: C(90, 4, 17), returned: C(1, 0, 15) }], pendingReturns: [], kangong: false },
    settle: null, lastEvent: { kind: 'returnTribute', from: 0, to: 3 }
  });
  ok(!vis($('return-bar')), '确认后确认条消失');
  // 分组视图下同样消失
  window.localStorage.setItem('gd-view', 'grouped');
  window.Table.render({
    phase: 'play', handNo: 2, levels: [3, 2], curLevel: 3, failA: [0, 0], over: false, winnerTeam: null,
    levelRanks: [3], mySeat: 0, myHand: [C(2, 0, 13)], counts: [1, 26, 27, 26], current: 0, target: null,
    lastPlays: [null, null, null, null], finished: [],
    tribute: { pairs: [{ giver: 3, receiver: 0, card: C(90, 4, 17), returned: C(1, 0, 15) }], pendingReturns: [], kangong: false },
    settle: null, lastEvent: null
  });
  ok(!vis($('return-bar')), '分组视图下确认条同样消失');

  // 逢人配三带二必须把具体key传给引擎,不能只发送fullhouse类型。
  captured = null;
  const ambiguous = [C(21, 1, 15), C(22, 0, 14), C(23, 3, 14), C(24, 0, 7), C(25, 3, 7)];
  window.Table.render({
    phase: 'play', handNo: 3, levels: [2, 2], curLevel: 2, failA: [0, 0], over: false, winnerTeam: null,
    levelRanks: [15], mySeat: 0, myHand: ambiguous, counts: [5, 20, 18, 19], current: 0, target: null,
    lastPlays: [null, null, null, null], finished: [], tribute: null, settle: null, lastEvent: null
  });
  for (const el of $('my-hand').querySelectorAll('.card')) el.click();
  $('btn-play').click();
  ok(captured && captured.kind === 'play' && captured.type === 'fullhouse' && captured.key === 14,
    '2(配)+AA+77出牌动作必须携带三A的key');

  // 两队A阶段独立显示:当前打一队A2,二队仍显示7级。
  window.Table.render({
    phase: 'play', handNo: 9, levels: [14, 7], failA: [1, 0], curLevel: 14, curLevelTeam: 0,
    over: false, winnerTeam: null, levelRanks: [14], mySeat: 0, myHand: [C(31, 0, 3)],
    counts: [1, 8, 6, 9], current: 0, target: null, lastPlays: [null, null, null, null],
    finished: [], tribute: null, settle: null, lastEvent: null
  });
  ok($('info-levels').textContent.includes('本局打 A2') && $('info-levels').textContent.includes('我方 A2级') && $('info-levels').textContent.includes('对方 7级'),
    '牌桌应分别显示当前A2和对方7级');
  console.log(`OK: 还贡两步确认 ${n} 项全部通过`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
