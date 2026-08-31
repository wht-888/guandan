/** 贡还阶段手动理牌:多选不受贡还限制,提交始终为单张合法牌。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { Engine } = require('../shared/engine.js');

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../public/index.html'), {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const scripts = ['../shared/rules.js', '../public/js/sound.js', '../public/js/table.js'];
  window.eval(scripts.map(p => fs.readFileSync(path.join(__dirname, p), 'utf8')).join(';\n') + ';window.Table = Table;');
  const $ = id => window.document.getElementById(id);
  const card = id => $('my-hand').querySelector(`.card[data-id="${id}"]`);
  const selectedCount = () => $('my-hand').querySelectorAll('.card.selected').length;
  const groupCount = () => $('my-hand').querySelectorAll('.manual-group-select').length;
  const confirmVisible = () => !$('return-bar').classList.contains('hidden');
  const actions = [];
  let checks = 0, handNo = 0;
  const ok = (condition, message) => { assert.ok(condition, message); checks++; };
  const C = (id, suit, rank) => ({ id, suit, rank, deck: 0 });
  window.Table.bind(action => actions.push(action), () => {});
  ok($('btn-pin-group').textContent.includes('手动理牌'), '入口应改名为手动理牌');

  for (const mode of ['give', 'return']) for (const view of ['fan', 'grouped']) {
    const e = new Engine({});
    e.phase = 'tribute'; e.handNo = ++handNo;
    e.curLevel = 5; e.curLevelTeam = 0; e.levels = [5, 2];
    e.hands = [
      [C(1, 0, 5), C(2, 3, 5), C(3, 1, 5), C(4, 0, 13), C(5, 2, 13), C(6, 2, 4)],
      [C(7, 0, 3)], [C(8, 1, 3)], [C(9, 2, 3)]
    ];
    e.tribute = mode === 'give'
      ? { pairs: [{ giver: 0, receiver: 3 }], pendingTributes: [0], pendingReturns: [] }
      : { pairs: [{ giver: 3, receiver: 0, card: C(90, 4, 17) }], pendingTributes: [], pendingReturns: [0] };
    window.Table.resetSession();
    window.Table.render(e.getStateFor(0));
    if ($('my-hand').classList.contains('grouped') !== (view === 'grouped')) $('btn-view-toggle').click();
    actions.length = 0;

    // K不是可贡还候选,但可先把对子拎出,再判断给哪张。
    card(4).click(); card(5).click();
    ok(!$('btn-pin-group').disabled && selectedCount() === 2, `${mode}/${view}:不可贡还的高牌也能多选整理`);
    ok(!confirmVisible(), '多选时不显示贡还确认');
    $('btn-pin-group').click();
    ok(groupCount() === 1 && selectedCount() === 0, '高牌对子成功暂存后清空选择');
    ok(actions.length === 0 && e.hands[0].length === 6, '理牌不能发送动作或改变引擎手牌');

    // 连不能贡还的红桃级牌也能参与理牌,但不能作为提交对象。
    card(1).click(); card(2).click(); card(3).click();
    $('btn-pin-group').click();
    ok(groupCount() === 2, '可用赖子与普通级牌一起暂存三张');
    const triple = [...$('my-hand').querySelectorAll('.manual-group-select')].find(el => el.textContent === '三张');
    triple.click();
    ok(selectedCount() === 3 && !confirmVisible(), '暂存组标签全选不会误显示贡还确认');
    $('btn-return-ok').onclick();
    ok(actions.length === 0, '即使直接调用确认处理也不能提交多张牌');
    triple.click();
    card(3).click();
    ok(selectedCount() === 1 && !confirmVisible() && $('btn-return-ok').disabled, '单选赖子不可确认贡还');
    $('btn-return-ok').onclick();
    ok(actions.length === 0, '提交处理必须再次拒绝赖子');
    card(3).click();

    card(1).click();
    ok(confirmVisible() && $('return-tip').textContent.includes('♠5'), '整理后仍可从暂存组选择准确花色贡还');
    $('btn-arrange').click();
    ok(groupCount() === 0 && confirmVisible(), '一键组牌暂时隐藏牌组但保留单张合法选择');
    $('btn-arrange').click();
    ok(groupCount() === 2 && selectedCount() === 1 && confirmVisible(), '还原布局后暂存组和确认牌保持一致');
    $('btn-view-toggle').click();
    ok(selectedCount() === 1 && card(1).getAttribute('aria-pressed') === 'true', '切换横排/分组不能丢失贡还选择');
    card(2).click();
    ok(!confirmVisible(), '单选扩展为理牌多选时立即隐藏确认栏');
    $('btn-return-ok').onclick();
    ok(actions.length === 0, '多选不能触发上一次的单张确认');
    card(2).click();
    $('btn-return-ok').click();
    ok(actions.length === 1 && actions[0].cardId === 1 && actions[0].kind === (mode === 'give' ? 'giveTribute' : 'returnTribute'), '最终仅提交明确选择的合法单张');
    ok(e.applyAction(0, actions[0]).ok, '真实引擎接受贡还动作');
    window.Table.render(e.getStateFor(0));
    ok(groupCount() === 1 && $('my-hand').querySelector('.manual-group-select').textContent === '对子', '贡还消耗牌组的一张后自动解散该组,保留其他组');
    ok(!confirmVisible() && selectedCount() === 0, '贡还完成刷新后没有残留确认');
    $('my-hand').querySelector('.manual-group-restore').click();
    ok(groupCount() === 0 && actions.length === 1, '放回剩余牌组不触发额外贡还动作');
  }

  dom.window.close();
  console.log(`OK: 贡还阶段手动理牌 ${checks} 项全部通过`);
})().catch(error => { console.error(error); process.exitCode = 1; });
