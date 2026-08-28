/** 前端冒烟: jsdom 加载真实页面与脚本, 点击"单机模式"打完整整一手 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../public/index.html'), {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  // AI 延时加速
  const origST = window.setTimeout;
  window.setTimeout = (fn, t, ...a) => origST(fn, Math.min(t || 0, 1), ...a);

  const scripts = ['/shared/rules.js', '/shared/engine.js', '/shared/ai.js', '/js/sound.js', '/js/net.js', '/js/table.js', '/js/app.js'];
  const code = scripts.map(s => {
    const rel = s.startsWith('/shared') ? '..' + s : '../public' + s;
    return fs.readFileSync(path.join(__dirname, rel), 'utf8');
  }).join(';\n');
  window.eval(code);
  const $ = id => window.document.getElementById(id);
  const vis = el => !el.classList.contains('hidden');
  const sleep = ms => new Promise(r => origST(r, ms));

  if (!vis($('screen-home'))) throw new Error('首页未显示');
  $('btn-single').click();
  if (!vis($('screen-table'))) throw new Error('牌桌未显示');

  // 新增功能: 一键组牌(可还原) + 分组视图(独立)
  $('btn-arrange').click();
  await sleep(5);
  if (!$('my-hand').querySelector('.combo-start')) throw new Error('一键组牌未产生组合间隔');
  // 分组视图 + 已组牌 => 组合竖排 + 牌型标签
  $('btn-view-toggle').click();
  await sleep(5);
  if (!$('my-hand').querySelector('.combo-col')) throw new Error('组牌后分组视图未按组合竖排');
  if (!$('my-hand').querySelector('.col-label')) throw new Error('组合列缺少牌型标签');
  const groupedCount = $('my-hand').querySelectorAll('.card').length;
  if (groupedCount !== 27) throw new Error('组合竖排牌数不对: ' + groupedCount);
  // 还原组牌 => 回到按点数分列
  $('btn-arrange').click();
  await sleep(5);
  if ($('my-hand').querySelector('.combo-col')) throw new Error('还原后仍有组合列');
  if (!$('my-hand').querySelector('.rank-col')) throw new Error('还原后分组视图无列');
  const anyCard = $('my-hand').querySelector('.rank-col .card');
  anyCard.click();
  await sleep(2);
  if (!anyCard.classList.contains('selected')) throw new Error('分组模式选牌失败');
  anyCard.click();
  $('btn-view-toggle').click(); // 切回横排
  await sleep(5);
  if ($('my-hand').querySelector('.combo-start')) throw new Error('还原后横排仍有组合间隔');
  console.log('✔ 组牌可还原/视图独立/组合竖排正常');

  let moves = 0, tributes = 0;
  const t0 = Date.now();
  while (!vis($('modal-settle'))) {
    if (Date.now() - t0 > 60000) throw new Error('超时未打完一手');
    await sleep(2);
    // 需要我进贡/还贡: 点选合法牌 -> 二步确认
    if (vis($('tribute-banner')) && ($('tribute-banner').innerHTML.includes('确认还贡') || $('tribute-banner').innerHTML.includes('确认进贡'))) {
      const modeText = $('tribute-banner').innerHTML.includes('确认进贡') ? '确认进贡' : '确认还贡';
      for (const el of [...$('my-hand').querySelectorAll('.card')]) {
        el.click();
        await sleep(2);
        if (vis($('return-bar'))) {
          $('btn-return-ok').click();
          await sleep(2);
          if (!$('tribute-banner').innerHTML.includes(modeText)) { tributes++; }
          break;
        }
      }
      continue;
    }
    if (vis($('action-bar'))) {
      $('btn-hint').click();
      await sleep(1);
      $('btn-play').click();
      await sleep(1);
      if (vis($('action-bar'))) { $('btn-pass').click(); } // 提示无牌可出
      moves++;
    }
  }
  const html = $('settle-content').innerHTML;
  if (!html.includes('头游')) throw new Error('结算信息缺失');
  if (!$('settle-content').querySelector('.settle-cards .card')) throw new Error('结算页未展示剩余手牌');
  console.log('✔ 结算页展示剩余手牌');
  console.log(`✔ 一手打完(我方操作 ${moves} 次, 还贡 ${tributes} 次)`);
  console.log('✔ 结算弹窗正常');
  // 下一局继续能打
  $('btn-next').click();
  await sleep(50);
  if (!vis($('screen-table'))) throw new Error('下一局未进入牌桌');
  console.log('✔ 下一局正常开始');
  console.log('UI SMOKE PASS');
  process.exit(0);
})().catch(e => { console.error('UI SMOKE FAIL:', e.message); process.exit(1); });
