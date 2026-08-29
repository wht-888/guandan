/** 手动暂存牌组:创建/整组选中/放回/一键组牌暂时隐藏/部分出牌自动解散 */
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
  const C = (id, suit, rank) => ({ id, suit, rank, deck: 0 });
  const sf = [C(1, 0, 3), C(2, 0, 4), C(3, 0, 5), C(4, 0, 6), C(5, 0, 7)];
  const pair9 = [C(6, 1, 9), C(7, 3, 9)];
  const extras = [C(8, 2, 11), C(9, 3, 13)];
  const fullHand = sf.concat(pair9, extras);
  let n = 0;
  const ok = (cond, msg) => { n++; if (!cond) { console.error('FAIL:', msg); process.exit(1); } };
  const state = hand => ({
    phase: 'play', handNo: 2, levels: [2, 2], failA: [0, 0], curLevel: 2, curLevelTeam: 0,
    over: false, winnerTeam: null, levelRanks: [15], mySeat: 0, myHand: hand,
    counts: [hand.length, 18, 20, 19], current: 1, target: null,
    lastPlays: [null, null, null, null], finished: [], tribute: null, settle: null, lastEvent: null
  });
  const cardEl = id => $(`unused-${id}`) || $('my-hand').querySelector(`.card[data-id="${id}"]`);
  const selectIds = ids => ids.forEach(id => cardEl(id).click());

  window.Table.bind(() => {}, () => {});
  window.Table.setPlayers([]);
  window.Table.render(state(fullHand));
  ok($('btn-pin-group').disabled, '未选牌时单拎按钮应禁用');

  selectIds(sf.map(c => c.id));
  ok(!$('btn-pin-group').disabled, '选中合法同花顺后单拎按钮可用');
  $('btn-pin-group').click();
  ok($('my-hand').querySelectorAll('.manual-card-group').length === 1, '创建一个手动暂存牌组');
  ok($('my-hand').querySelector('.manual-group-select').textContent === '同花顺', '显示同花顺标签');
  ok($('my-hand').querySelectorAll('.manual-card-group .card').length === 5, '同花顺五张牌均在暂存区');

  $('btn-view-toggle').click();
  ok($('my-hand').classList.contains('grouped') && $('my-hand').querySelectorAll('.manual-col .card').length === 5, '分组视图同样显示手动暂存牌组');
  $('btn-view-toggle').click();
  ok(!$('my-hand').classList.contains('grouped') && !!$('my-hand').querySelector('.manual-card-group'), '切回横排后暂存牌组保持');

  $('my-hand').querySelector('.manual-group-select').click();
  ok($('my-hand').querySelectorAll('.manual-card-group .card.selected').length === 5, '点击标签整组选中');
  $('my-hand').querySelector('.manual-group-select').click();
  ok($('my-hand').querySelectorAll('.manual-card-group .card.selected').length === 0, '再次点击标签整组取消');

  $('btn-arrange').click();
  ok(!$('my-hand').querySelector('.manual-card-group') && $('btn-pin-group').classList.contains('hidden'), '一键组牌时暂时隐藏手动牌组');
  $('btn-arrange').click();
  ok(!!$('my-hand').querySelector('.manual-card-group'), '还原一键组牌后恢复手动牌组');

  $('my-hand').querySelector('.manual-group-restore').click();
  ok(!$('my-hand').querySelector('.manual-card-group'), '放回后移除暂存牌组');
  ok($('my-hand').querySelectorAll('.card').length === fullHand.length, '放回后所有牌仍在普通手牌区');

  // 同时暂存同花顺和对子。
  selectIds(sf.map(c => c.id)); $('btn-pin-group').click();
  selectIds(pair9.map(c => c.id)); $('btn-pin-group').click();
  ok($('my-hand').querySelectorAll('.manual-card-group').length === 2, '支持多个互不重叠的暂存牌组');
  const restoreButtons = $('my-hand').querySelectorAll('.manual-group-restore');
  restoreButtons[1].click();
  ok($('my-hand').querySelectorAll('.manual-card-group').length === 1 && $('my-hand').querySelector('.manual-group-select').textContent === '同花顺', '单独放回对子不影响同花顺');

  // 同花顺少一张后应整组解散,其余牌自动回普通区。
  window.Table.render(state(fullHand.filter(c => c.id !== sf[0].id)));
  ok(!$('my-hand').querySelector('.manual-card-group'), '暂存牌组部分出牌后自动解散');
  ok($('my-hand').querySelectorAll('.card').length === fullHand.length - 1, '解散后剩余牌完整回到普通区');

  // 非法组合可点击按钮,但不会建立牌组。
  selectIds([8, 9]);
  $('btn-pin-group').click();
  ok(!$('my-hand').querySelector('.manual-card-group'), '非法牌组不会被暂存');
  ok(!$('toast').classList.contains('hidden') && $('toast').textContent.includes('合法'), '非法牌组显示提示');

  console.log(`OK: 手动暂存牌组 ${n} 项全部通过`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
