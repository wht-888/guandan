/** 牌桌渲染与交互(单机/联机共用): 只依赖 state + players 元信息 */
const Table = (() => {
  const R = GuandanRules;
  const $ = id => document.getElementById(id);
  const POS = ['bottom', 'right', 'top', 'left']; // 相对位置
  const RANK_LABEL = ['头游', '二游', '三游', '末游'];

  let state = null, players = [], selected = new Set();
  let hintList = [], hintIdx = -1;
  let onAction = null, onNext = null;
  let lastEventRef = null;
  let viewMode = 'fan';            // fan=横排 grouped=分组
  let lastHandKey = null;
  let animateDeal = false;
  try { viewMode = localStorage.getItem('gd-view') || 'fan'; } catch (e) {}
  let arranged = null;             // {handNo, ids:[], breaks:Set}

  function levelName(l) { return l <= 10 ? String(l) : { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[l]; }
  function seatName(s) { return players[s] ? players[s].name : '座位' + s; }
  function relOf(seat) { return (seat - state.mySeat + 4) % 4; }

  function setPlayers(p) { players = p; }
  function resetSession() {
    selected.clear();
    hintList = [];
    hintIdx = -1;
    arranged = null;
    lastEventRef = null;
    lastHandKey = null;
  }
  function bind(actionCb, nextCb) {
    onAction = actionCb; onNext = nextCb;
    $('btn-play').onclick = () => doPlay();
    $('btn-pass').onclick = () => { Sound.click(); if (onAction) onAction({ kind: 'pass' }); };
    $('btn-hint').onclick = () => doHint();
    $('btn-reset').onclick = () => { selected.clear(); hintIdx = -1; refreshHandSelection(); Sound.click(); };
    $('btn-return-ok').onclick = () => {
      if (selected.size !== 1) return;
      const cardId = [...selected][0];
      Sound.click();
      if (onAction) onAction({ kind: 'returnTribute', cardId });
    };
    $('btn-return-cancel').onclick = () => {
      selected.clear();
      refreshHandSelection();
      syncReturnBar();
      Sound.click();
    };
    $('btn-view-toggle').onclick = () => {
      viewMode = viewMode === 'fan' ? 'grouped' : 'fan';
      try { localStorage.setItem('gd-view', viewMode); } catch (e) {}
      Sound.click(); syncViewBtn(); renderHand();
    };
    $('btn-arrange').onclick = () => {
      if (!state || !state.myHand.length) return;
      Sound.click();
      if (arranged) { arranged = null; }
      else { doArrange(); toast('已按 同花顺>炸弹>钢板>顺子 组牌, 再点一次还原'); }
      syncArrangeBtn(); renderHand();
    };
    window.addEventListener('resize', () => {
      if (state) requestAnimationFrame(placeActionBar);
    });
    syncViewBtn();
  }

  function syncArrangeBtn() {
    const b = $('btn-arrange');
    if (!b) return;
    b.textContent = arranged ? '↩ 还原' : '✨ 一键组牌';
    b.classList.toggle('on', !!arranged);
  }

  function syncReturnBar() {
    const bar = $('return-bar');
    if (!bar || !state) return;
    const myTurnReturn = state.phase === 'tribute' && state.tribute && state.tribute.pendingReturns.indexOf(state.mySeat) >= 0;
    const show = myTurnReturn && selected.size === 1;
    bar.classList.toggle('hidden', !show);
    if (show) {
      const c = state.myHand.find(x => x.id === [...selected][0]);
      $('return-tip').textContent = '还贡 ' + R.cardText(c) + ' ?';
    }
  }

  function syncViewBtn() {
    const b = $('btn-view-toggle');
    if (!b) return;
    b.textContent = viewMode === 'fan' ? '🗂 分组' : '🃏 横排';
    b.classList.toggle('on', viewMode === 'grouped');
    $('hand-tools').classList.toggle('hand-grouped', viewMode === 'grouped');
  }

  // 一键组牌: 贪心按优先级拆组合 同花顺>天王>炸弹>钢板>三连对>顺子>三带二>三张>对子>单张
  function comboPrio(p) {
    if (p.type === 'straightflush') return 100;
    if (p.type === 'jokerbomb') return 99;
    if (p.type === 'bomb') return 90 + p.len;
    if (p.type === 'tripleseq') return 80;
    if (p.type === 'pairseq') return 70;
    if (p.type === 'straight') return 60;
    if (p.type === 'fullhouse') return 50;
    if (p.type === 'triple') return 40;
    if (p.type === 'pair') return 30;
    return 10;
  }
  function doArrange() {
    const lv = state.levelRanks;
    const remaining = state.myHand.slice();
    const ids = [], breaks = new Set(), labels = new Map();
    while (remaining.length) {
      const plays = R.findPlays(remaining, lv);
      plays.sort((a, b) => (comboPrio(b) - comboPrio(a)) || (a.wildUsed - b.wildUsed) || (b.key - a.key));
      const pick = plays[0];
      if (ids.length) breaks.add(pick.cards[0].id);
      labels.set(pick.cards[0].id, R.patternName(pick));
      for (const c of pick.cards) {
        ids.push(c.id);
        remaining.splice(remaining.indexOf(c), 1);
      }
    }
    arranged = { handNo: state.handNo, ids, breaks, labels };
  }

  function cardEl(c, mini) {
    const el = document.createElement('div');
    const isJoker = c.suit === 4;
    el.className = 'card' + (mini ? ' mini' : '') +
      (isJoker ? ' joker' + (c.rank === 16 ? ' small' : '') : (c.suit === 1 || c.suit === 2 ? ' red' : ' black'));
    el.dataset.id = c.id;
    el.setAttribute('aria-label', R.cardText(c));
    if (isJoker) {
      el.innerHTML = `<span class="r">${c.rank === 16 ? '小王' : '大王'}</span>`;
    } else {
      el.innerHTML = `<span class="r">${R.RANK_NAMES[c.rank]}</span><span class="s">${R.SUITS[c.suit]}</span><span class="center">${R.SUITS[c.suit]}</span>`;
    }
    if (state && R.isWild(c, state.levelRanks)) {
      const b = document.createElement('span');
      b.className = 'wild-badge'; b.textContent = '配';
      el.appendChild(b);
    }
    return el;
  }

  function render(st) {
    const handKey = `${st.handNo}:${st.mySeat}`;
    animateDeal = handKey !== lastHandKey;
    state = st;
    selected.clear(); hintList = []; hintIdx = -1;
    renderInfo(); renderSeats(); renderPlayed(); renderHand(); placeActionBar(); renderActionBar(); renderTribute(); renderSettle(); syncReturnBar();
    handleEvent(st.lastEvent);
    lastHandKey = handKey;
    animateDeal = false;
  }

  function renderInfo() {
    const myTeam = state.mySeat % 2;
    $('info-levels').innerHTML =
      `本局打 <b style="font-size:19px;color:#ffe600">${levelName(state.curLevel)}</b><br>` +
      `<span class="me">我方 ${levelName(state.levels[myTeam])}级</span> · <span class="op">对方 ${levelName(state.levels[1 - myTeam])}级</span>`;
    $('info-hand').textContent = `第 ${state.handNo} 局`;
  }

  // 贡牌/还贡牌/抗贡大王为公开信息, 显示在对应玩家座位旁
  function pubBadges(seat) {
    const t = state.tribute;
    if (!t) return '';
    const out = [];
    for (const pr of t.pairs || []) {
      if (pr.receiver === seat) out.push(pubBadge(pr.card, '贡'));
      if (pr.giver === seat && pr.returned) out.push(pubBadge(pr.returned, '还'));
    }
    if (t.kangong && t.jokerHolders) {
      const h = t.jokerHolders.find(x => x.seat === seat);
      if (h) for (let i = 0; i < h.count; i++) out.push('<span class="pub-card jk">大王</span>');
    }
    return out.length ? `<div class="pub-cards">${out.join('')}</div>` : '';
  }
  function pubBadge(c, label) {
    const cls = c.suit === 4 ? (c.rank === 16 ? 'black' : 'jk') : (c.suit === 1 || c.suit === 2 ? 'red' : 'black');
    const txt = c.suit === 4 ? R.RANK_NAMES[c.rank] : R.SUITS[c.suit] + R.RANK_NAMES[c.rank];
    return `<span class="pub-card ${cls}"><span class="lb">${label}</span>${txt}</span>`;
  }

  function renderSeats() {
    for (let rel = 0; rel < 4; rel++) {
      const seat = (state.mySeat + rel) % 4;
      const box = $('seat-' + POS[rel]);
      const p = players[seat] || { name: '座位' + seat, avatar: '❔' };
      const isOut = state.finished.indexOf(seat) >= 0;
      const active = state.phase === 'play' && state.current === seat;
      const tag = rel === 0 ? '' : (seat % 2 === state.mySeat % 2 ? '<span class="tag">队友</span>' : '<span class="tag foe">对方</span>');
      const finIdx = state.finished.indexOf(seat);
      box.className = `seat seat-${POS[rel]}${active ? ' active' : ''}${isOut ? ' out' : ''}`;
      box.innerHTML = `
        <div class="avatar">${p.avatar}${finIdx >= 0 ? `<span class="rank-badge">${RANK_LABEL[finIdx]}</span>` : ''}</div>
        <div class="seat-info">
          <div><span class="nm">${p.name}</span>${tag}</div>
          ${rel !== 0 && state.finished.indexOf(seat) < 0 && state.counts[seat] <= 10 ? `<div class="card-count report">🂠 ${state.counts[seat]}</div>` : ''}
          ${pubBadges(seat)}
        </div>`;
    }
  }

  function renderPlayed() {
    const freshEvent = state.lastEvent && state.lastEvent !== lastEventRef ? state.lastEvent : null;
    for (let rel = 0; rel < 4; rel++) {
      const seat = (state.mySeat + rel) % 4;
      const zone = $('played-' + POS[rel]);
      zone.innerHTML = '';
      const lp = state.lastPlays[seat];
      if (!lp) continue;
      if (lp.pass) {
        const freshPass = freshEvent && freshEvent.kind === 'pass' && freshEvent.seat === seat;
        zone.innerHTML = `<div class="pass-label${freshPass ? ' pass-in' : ''}">不出</div>`;
      } else {
        const tag = document.createElement('div');
        tag.className = 'pattern-tag';
        tag.textContent = R.patternName(lp.pattern);
        zone.appendChild(tag);
        const freshPlay = freshEvent && freshEvent.kind === 'play' && freshEvent.seat === seat;
        lp.cards.forEach((c, i) => {
          const el = cardEl(c, true);
          if (freshPlay) {
            el.classList.add('play-in', 'play-from-' + POS[rel]);
            el.style.setProperty('--play-delay', (i * 34) + 'ms');
          }
          zone.appendChild(el);
        });
      }
    }
  }

  // 分组列限高: 默认每张露出30px, 超过 maxColH 则加大重叠
  function stackCards(col, cardEls, hasLabel) {
    const mobile = window.matchMedia ? window.matchMedia('(max-width: 900px)').matches : false;
    const cardH = mobile ? 48 : 88;
    const defStrip = mobile ? 24 : 40;   // 露出 点数+花色
    const maxColH = (mobile ? 140 : 300) - (hasLabel ? (mobile ? 12 : 14) : 0);
    const n = cardEls.length;
    let strip = defStrip;
    if (n > 1 && cardH + (n - 1) * defStrip > maxColH) {
      strip = Math.max(mobile ? 12 : 24, Math.floor((maxColH - cardH) / (n - 1)));
    }
    cardEls.forEach((el, i) => {
      // 显式设置 marginTop: 列内有标签时第一张牌不再是 :first-child, 必须覆盖 CSS 的 -58px
      el.style.marginTop = i === 0 ? '0px' : (strip - cardH) + 'px';
      col.appendChild(el);
    });
  }

  function onCardClick(el, c, myTurnReturn) {
    return () => {
      if (myTurnReturn) {
        const face = c.rank === 15 ? 2 : c.rank;
        if (c.suit === 4 || face > 10 || R.isWild(c, state.levelRanks)) { toast('还贡必须是不大于10的普通牌'); return; }
        Sound.select();
        // 还贡两步确认: 点选(单选) -> 确认还贡
        if (selected.has(c.id)) selected.delete(c.id);
        else { selected.clear(); selected.add(c.id); }
        refreshHandSelection();
        syncReturnBar();
        return;
      }
      if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
      Sound.select();
      refreshHandSelection();
    };
  }

  function renderHand() {
    const box = $('my-hand');
    box.innerHTML = '';
    box.className = viewMode === 'grouped' ? 'grouped' : '';
    const myTurnReturn = state.phase === 'tribute' && state.tribute && state.tribute.pendingReturns.indexOf(state.mySeat) >= 0;
    // 应用组牌顺序(仅本局有效)
    let cards = state.myHand;
    let breaks = null, labels = null;
    if (arranged && arranged.handNo === state.handNo) {
      const byId = new Map(cards.map(c => [c.id, c]));
      const ordered = arranged.ids.filter(id => byId.has(id)).map(id => byId.get(id));
      for (const c of cards) if (arranged.ids.indexOf(c.id) < 0) ordered.push(c);
      if (ordered.length === cards.length) { cards = ordered; breaks = arranged.breaks; labels = arranged.labels; }
      else arranged = null;
    } else arranged = null;
    syncArrangeBtn();

    const dealOrder = new Map(cards.map((c, i) => [c.id, i]));

    const mkEl = c => {
      const el = cardEl(c, false);
      const activate = onCardClick(el, c, myTurnReturn);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', 'false');
      el.tabIndex = 0;
      el.onclick = activate;
      el.onkeydown = e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activate();
      };
      if (animateDeal) {
        el.classList.add('deal-in');
        el.style.setProperty('--deal-delay', (Math.min(dealOrder.get(c.id) || 0, 18) * 24) + 'ms');
      }
      return el;
    };

    if (viewMode === 'grouped') {
      // 先收集列: 已组牌按组合分列(带牌型标签), 未组牌按点数分列
      const cols = [];
      if (breaks) {
        for (const c of cards) {
          if (!cols.length || breaks.has(c.id)) cols.push({ label: (labels && labels.get(c.id)) || '', els: [] });
          cols[cols.length - 1].els.push(mkEl(c));
        }
      } else {
        const lv = state.levelRanks;
        const byRank = new Map();
        for (const c of cards) {
          if (!byRank.has(c.rank)) byRank.set(c.rank, []);
          byRank.get(c.rank).push(c);
        }
        const ranks = Array.from(byRank.keys()).sort((a, b) => R.orderOf(b, lv) - R.orderOf(a, lv));
        for (const r of ranks) cols.push({ label: '', els: byRank.get(r).sort((a, b) => a.suit - b.suit).map(mkEl) });
      }
      for (const { label, els } of cols) {
        const col = document.createElement('div');
        col.className = breaks ? 'rank-col combo-col' : 'rank-col';
        if (breaks) {
          const lb = document.createElement('div');
          lb.className = 'col-label';
          lb.textContent = label;
          col.appendChild(lb);
        }
        box.appendChild(col);
        stackCards(col, els, !!breaks);
      }
      placeActionBar();
      return;
    }
    for (const c of cards) {
      const el = mkEl(c);
      if (breaks && breaks.has(c.id)) el.classList.add('combo-start');
      box.appendChild(el);
    }
    placeActionBar();
  }

  function placeActionBar() {
    // 用实际位置计算间距, 同时兼容分组牌高、横竖屏切换与 iPhone 安全区
    const hand = $('my-hand');
    const table = hand.parentElement;
    const handTop = hand.getBoundingClientRect().top;
    const tableBottom = table.getBoundingClientRect().bottom;
    const bottom = Math.max(0, tableBottom - handTop + 10);
    $('action-bar').style.bottom = bottom + 'px';
    const rb = $('return-bar');
    if (rb) rb.style.bottom = bottom + 'px';
  }

  function refreshHandSelection() {
    for (const el of $('my-hand').querySelectorAll('.card')) {
      const isSelected = selected.has(Number(el.dataset.id));
      el.classList.toggle('selected', isSelected);
      el.setAttribute('aria-pressed', String(isSelected));
    }
  }

  function renderActionBar() {
    const myTurn = state.phase === 'play' && state.current === state.mySeat;
    $('action-bar').classList.toggle('hidden', !myTurn);
    if (myTurn) {
      const leading = !state.target || state.target.seat === state.mySeat;
      $('btn-pass').disabled = leading;
    }
  }

  function renderTribute() {
    const b = $('tribute-banner');
    if (state.phase !== 'tribute' || !state.tribute) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    const t = state.tribute;
    const lines = t.pairs.map(p => `${seatName(p.giver)} 进贡 ${R.cardText(p.card)} 给 ${seatName(p.receiver)}`);
    if (t.pendingReturns.indexOf(state.mySeat) >= 0) lines.push('<b>👆 点选一张 ≤10 的牌, 再点「确认还贡」</b>');
    else if (t.pendingReturns.length) lines.push(`等待 ${t.pendingReturns.map(seatName).join('、')} 还贡…`);
    b.innerHTML = lines.join('<br>');
  }

  function renderSettle() {
    const m = $('modal-settle');
    if (state.phase !== 'settle' || !state.settle) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    const st = state.settle;
    const myTeam = state.mySeat % 2;
    const win = st.winTeam === myTeam;
    const rows = st.placements.map((seat, i) => {
      const p = players[seat] || { name: '座位' + seat, avatar: '❔' };
      // 斗地主式: 结算时展示其余玩家剩余手牌
      let cardsHtml = '';
      if (state.allHands && state.allHands[seat].length) {
        cardsHtml = `<div class="settle-cards" data-seat="${seat}"></div>`;
      }
      const row = `<div class="settle-row"><span class="rk">${RANK_LABEL[i]}</span><span style="font-size:22px">${p.avatar}</span><span>${p.name}</span>${seat === state.mySeat ? '<span class="tag">我</span>' : (seat % 2 === myTeam ? '<span class="tag">队友</span>' : '')}${cardsHtml}</div>`;
      return row;
    }).join('');
    let lvText;
    if (st.over) {
      lvText = st.winnerTeam === myTeam ? '🏆 恭喜！我方成功打A,赢得整场比赛！' : '😭 对方打A成功,比赛结束';
    } else {
      lvText = `${st.doubleDown ? '🎉 双下！' : ''}${win ? '我方' : '对方'}升 <b>${st.delta}</b> 级 → 现在打 <b>${levelName(st.levels[st.winTeam])}</b>`;
      if (st.levels[0] === 14 || st.levels[1] === 14) lvText += '<br>⚠️ ' + (st.levels[myTeam] === 14 ? '我方正在打A!需头游且队友非末游' : '对方正在打A,务必阻击!');
    }
    // 先渲染再填充剩余手牌卡片
    $('settle-content').innerHTML = `
      <div class="settle-title ${win ? 'win' : 'lose'}">${st.over ? (st.winnerTeam === myTeam ? '🏆 胜利' : '💔 惜败') : (win ? '🎉 本局获胜' : '😅 本局失利')}</div>
      <div class="settle-rows">${rows}</div>
      <div class="settle-lv">${lvText}</div>
      <button class="btn btn-big" id="btn-next">${st.over ? '再来一场' : '下一局'}</button>`;
    if (state.allHands) {
      for (const box of $('settle-content').querySelectorAll('.settle-cards')) {
        const seat = Number(box.dataset.seat);
        for (const c of state.allHands[seat]) box.appendChild(cardEl(c, true));
      }
    }
    $('btn-next').onclick = () => { Sound.click(); m.classList.add('hidden'); if (onNext) onNext(); };
  }

  function handleEvent(ev) {
    if (!ev || ev === lastEventRef) return;
    lastEventRef = ev;
    if (ev.kind === 'play') {
      const bp = R.bombPower(ev.pattern);
      if (bp > 0) {
        Sound.bomb();
        banner(ev.pattern.type === 'jokerbomb' ? '四大天王!!' : R.patternName(ev.pattern) + '!');
        const felt = document.querySelector('.felt');
        felt.classList.remove('shake'); void felt.offsetWidth; felt.classList.add('shake');
      } else Sound.play();
    } else if (ev.kind === 'pass') Sound.pass();
    else if (ev.kind === 'kangong') { banner('双大王抗贡!'); Sound.win(); }
    else if (ev.kind === 'settle') {
      if (ev.settle.over) (ev.settle.winnerTeam === state.mySeat % 2 ? Sound.win : Sound.lose)();
      else (ev.settle.winTeam === state.mySeat % 2 ? Sound.win : Sound.pass)();
    }
  }

  function banner(text) {
    const b = $('center-banner');
    b.textContent = text;
    b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.add('hidden'), 1600);
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.add('hidden'), 2000);
  }

  function doHint() {
    const lv = state.levelRanks;
    const hand = state.myHand;
    if (!hintList.length) {
      let plays = R.findPlays(hand, lv);
      if (state.target && state.target.seat !== state.mySeat) {
        plays = plays.filter(p => R.canBeat(p, state.target.pattern));
        plays.sort((a, b) => ((R.bombPower(a) > 0) - (R.bombPower(b) > 0)) || (a.wildUsed - b.wildUsed) || (R.bombPower(a) - R.bombPower(b)) || (a.key - b.key));
      } else {
        plays.sort((a, b) => ((R.bombPower(a) > 0) - (R.bombPower(b) > 0)) || (a.wildUsed - b.wildUsed) || (b.len - a.len) || (a.key - b.key));
      }
      hintList = plays;
      hintIdx = -1;
    }
    if (!hintList.length) { toast('没有能出的牌'); return; }
    hintIdx = (hintIdx + 1) % hintList.length;
    selected = new Set(hintList[hintIdx].cards.map(c => c.id));
    Sound.select();
    refreshHandSelection();
  }

  function doPlay() {
    if (!selected.size) { toast('请先选择要出的牌'); return; }
    const cards = state.myHand.filter(c => selected.has(c.id));
    const lv = state.levelRanks;
    let candidates = R.analyze(cards, lv);
    if (!candidates.length) { toast('所选牌不构成合法牌型'); return; }
    if (state.target && state.target.seat !== state.mySeat) {
      candidates = candidates.filter(p => R.canBeat(p, state.target.pattern));
      if (!candidates.length) { toast('所选牌压不过上家'); return; }
      candidates.sort((a, b) => (R.bombPower(a) - R.bombPower(b)) || (a.key - b.key));
    } else {
      candidates.sort((a, b) => (R.bombPower(a) - R.bombPower(b)) || (b.key - a.key));
    }
    Sound.click();
    if (onAction) onAction({ kind: 'play', cardIds: cards.map(c => c.id), type: candidates[0].type });
  }

  return { setPlayers, resetSession, bind, render, toast, banner };
})();
