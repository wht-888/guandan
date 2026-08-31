/** 牌面布局回归:底对齐、大号点数/花色、按实际牌高叠放、缩放保留选择。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../public/index.html'), {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;
  const style = document.createElement('style');
  style.textContent = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
  document.head.appendChild(style);
  const scripts = ['../shared/rules.js', '../public/js/sound.js', '../public/js/table.js'];
  window.eval(scripts.map(p => fs.readFileSync(path.join(__dirname, p), 'utf8')).join(';\n') + ';window.Table = Table;');
  const $ = id => document.getElementById(id);
  const c = (id, rank, suit) => ({ id, rank, suit, deck: 0 });
  const cards = [c(1, 7, 0), c(2, 7, 1), c(3, 7, 2), c(4, 7, 3), c(5, 10, 0), c(6, 10, 2), c(7, 13, 3)];
  window.Table.bind(() => {}, () => {});
  window.Table.render({
    phase: 'play', handNo: 1, mySeat: 0, myHand: cards, levelRanks: [15],
    levels: [2, 2], failA: [0, 0], curLevel: 2, curLevelTeam: null,
    counts: [7, 20, 20, 20], current: 0, finished: [], target: null,
    lastPlays: [null, null, null, null], tribute: null, settle: null, lastEvent: null
  });
  $('btn-view-toggle').click();
  const hand = $('my-hand');
  const seven = hand.querySelector('.card[data-id="1"]');
  const sevenCol = seven.parentElement;
  assert.equal(window.getComputedStyle(hand).alignItems, 'flex-end', '分组容器必须底对齐');
  assert.equal(hand.querySelectorAll('.card-corner').length, cards.length, '每张牌都应保留点数/花色角标');
  assert.equal(window.getComputedStyle(seven.querySelector('.card-corner')).flexDirection, 'row', '分组牌头点数花色应并排');
  assert.equal(window.getComputedStyle(seven.querySelector('.r')).fontSize, '26px');
  assert.equal(window.getComputedStyle(seven.querySelector('.s')).fontSize, '21px');
  assert.equal(seven.style.marginTop, '0px');
  assert.equal(sevenCol.querySelectorAll('.card')[1].style.marginTop, '-53px', '91px牌高/38px露头应重叠53px');

  seven.click();
  hand.style.setProperty('--stack-strip', '23px');
  hand.style.setProperty('--stack-max-height', '170px');
  for (const card of hand.querySelectorAll('.card')) card.style.height = '56px';
  window.dispatchEvent(new window.Event('resize'));
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  assert.equal(sevenCol.querySelectorAll('.card')[1].style.marginTop, '-33px', '重新排布必须使用实际56px牌高');
  assert.ok(seven.classList.contains('selected'), '重新排布不能丢失选中状态');
  assert.equal(hand.querySelectorAll('.card').length, cards.length, '重排不能增删手牌');
  assert.equal(seven.querySelector('.s').textContent, '♠', '花色必须保持正确');

  dom.window.close();
  console.log('OK: 牌面布局 11 项全部通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
