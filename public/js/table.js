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
  let manualGroups = [];           // [{id,handNo,cardIds,type,key,label}]
  let nextManualGroupId = 1;

  function levelName(l, aFail) {
    if (l === 14) return 'A' + ((aFail || 0) + 1);
    return l <= 10 ? String(l) : { 11: 'J', 12: 'Q', 13: 'K' }[l];
  }
  function seatName(s) { return players[s] ? players[s].name : '座位' + s; }
  function relOf(seat) { return (seat - state.mySeat + 4) % 4; }

  function setPlayers(p) { players = p; }
  function resetSession() {
    selected.clear();
    hintList = [];
    hintIdx = -1;
    arranged = null;
    manualGroups = [];
    nextManualGroupId = 1;
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
      const mode = myTributeMode();
      if (!mode) return;
      const cardId = [...selected][0];
      Sound.click();
      if (onAction) onAction({ kind: mode === 'give' ? 'giveTribute' : 'returnTribute', cardId });
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
      else { doArrange(); toast('已保留炸弹并按尽量少的手数组牌, 再点一次还原'); }
      syncArrangeBtn(); renderHand();
    };
    $('btn-pin-group').onclick = () => pinSelectedGroup();
    window.addEventListener('resize', () => {
      if (state) requestAnimationFrame(() => {
        // 横竖屏切换只重排现有牌列,保留选牌和手动暂存状态。
        for (const col of $('my-hand').querySelectorAll('.rank-col')) {
          const cards = Array.from(col.children).filter(el => el.classList.contains('card'));
          stackCards(col, cards, !!col.querySelector('.col-label, .manual-group-header'));
        }
        placeActionBar();
      });
    });
    syncViewBtn();
  }

  function syncArrangeBtn() {
    const b = $('btn-arrange');
    if (!b) return;
    b.textContent = arranged ? '↩ 还原' : '✨ 一键组牌';
    b.classList.toggle('on', !!arranged);
    syncManualGroupBtn();
  }

  function selectedManualPattern() {
    if (!state || arranged || state.phase !== 'play' || selected.size < 2) return null;
    const occupied = new Set(manualGroups.flatMap(g => g.cardIds));
    if ([...selected].some(id => occupied.has(id))) return null;
    const cards = state.myHand.filter(c => selected.has(c.id));
    if (cards.length !== selected.size) return null;
    const patterns = R.analyze(cards, state.levelRanks);
    if (!patterns.length) return null;
    patterns.sort((a, b) => (R.bombPower(b) - R.bombPower(a)) || (b.key - a.key));
    return patterns[0];
  }

  function syncManualGroupBtn() {
    const b = $('btn-pin-group');
    if (!b) return;
    b.classList.toggle('hidden', !!arranged);
    const occupied = new Set(manualGroups.flatMap(g => g.cardIds));
    b.disabled = !!arranged || !state || state.phase !== 'play' || selected.size < 2 || [...selected].some(id => occupied.has(id));
  }

  function pinSelectedGroup() {
    const pattern = selectedManualPattern();
    if (!pattern) { toast('请选择一个合法且未暂存的牌组'); return; }
    const cardIds = state.myHand.filter(c => selected.has(c.id)).map(c => c.id);
    manualGroups.push({
      id: nextManualGroupId++, handNo: state.handNo, cardIds,
      type: pattern.type, key: pattern.key, label: R.patternName(pattern)
    });
    selected.clear(); hintList = []; hintIdx = -1;
    Sound.click();
    renderHand();
    toast(`已将${R.patternName(pattern)}单独放置`);
  }

  function restoreManualGroup(groupId) {
    const group = manualGroups.find(g => g.id === groupId);
    if (!group) return;
    for (const id of group.cardIds) selected.delete(id);
    manualGroups = manualGroups.filter(g => g.id !== groupId);
    Sound.click();
    renderHand();
  }

  function toggleManualGroupSelection(groupId) {
    const group = manualGroups.find(g => g.id === groupId);
    if (!group) return;
    const allSelected = group.cardIds.every(id => selected.has(id));
    for (const id of group.cardIds) allSelected ? selected.delete(id) : selected.add(id);
    Sound.select();
    refreshHandSelection();
  }

  function reconcileManualGroups() {
    if (!state) return;
    const handIds = new Set(state.myHand.map(c => c.id));
    manualGroups = manualGroups.filter(g =>
      g.handNo === state.handNo && g.cardIds.every(id => handIds.has(id)));
  }

  function syncReturnBar() {
    const bar = $('return-bar');
    if (!bar || !state) return;
    const mode = myTributeMode();
    const show = !!mode && selected.size === 1;
    bar.classList.toggle('hidden', !show);
    if (show) {
      const c = state.myHand.find(x => x.id === [...selected][0]);
      $('return-tip').textContent = (mode === 'give' ? '进贡 ' : '还贡 ') + R.cardText(c) + ' ?';
      $('btn-return-ok').textContent = mode === 'give' ? '确认进贡' : '确认还贡';
    }
  }

  function myTributeMode() {
    if (!state || state.phase !== 'tribute' || !state.tribute) return null;
    if ((state.tribute.pendingTributes || []).indexOf(state.mySeat) >= 0) return 'give';
    if ((state.tribute.pendingReturns || []).indexOf(state.mySeat) >= 0) return 'return';
    return null;
  }

  function syncViewBtn() {
    const b = $('btn-view-toggle');
    if (!b) return;
    b.textContent = viewMode === 'fan' ? '🗂 分组' : '🃏 横排';
    b.classList.toggle('on', viewMode === 'grouped');
    $('hand-tools').classList.toggle('hand-grouped', viewMode === 'grouped');
  }

  // 一键组牌:先锁定不重叠炸弹,再搜索剩余牌的最少手数拆分。
  function doArrange() {
    const ids = [], breaks = new Set(), labels = new Map();
    const groups = R.optimizeHandGroups(state.myHand, state.levelRanks);
    for (const pick of groups) {
      if (ids.length) breaks.add(pick.cards[0].id);
      labels.set(pick.cards[0].id, R.patternName(pick));
      for (const c of pick.cards) ids.push(c.id);
    }
    arranged = { handNo: state.handNo, ids, breaks, labels };
  }

  function cardEl(c, mini) {
    const el = document.createElement('div');
    const isJoker = c.suit === 4;
    el.className = 'card' + (mini ? ' mini' : '') +
      (isJoker ? ' joker' + (c.rank === 16 ? ' small' : '') : (c.suit === 1 || c.suit === 2 ? ' red' : ' black'));
    el.dataset.id = c.id;
    el.dataset.rank = c.rank;
    el.setAttribute('aria-label', R.cardText(c));
    if (isJoker) {
      el.innerHTML = `<span class="card-corner"><span class="r">${c.rank === 16 ? '小王' : '大王'}</span></span>`;
    } else {
      el.innerHTML = `<span class="card-corner"><span class="r">${R.RANK_NAMES[c.rank]}</span><span class="s">${R.SUITS[c.suit]}</span></span><span class="center">${R.SUITS[c.suit]}</span>`;
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
    reconcileManualGroups();
    selected.clear(); hintList = []; hintIdx = -1;
    renderInfo(); renderSeats(); renderPlayed(); renderHand(); placeActionBar(); renderActionBar(); renderTribute(); renderSettle(); syncReturnBar();
    handleEvent(st.lastEvent);
    lastHandKey = handKey;
    animateDeal = false;
  }

  function renderInfo() {
    const myTeam = state.mySeat % 2;
    const activeFail = state.curLevel === 14 && state.curLevelTeam !== null ? state.failA[state.curLevelTeam] : 0;
    $('info-levels').innerHTML =
      `本局打 <b style="font-size:19px;color:#ffe600">${levelName(state.curLevel, activeFail)}</b><br>` +
      `<span class="me">我方 ${levelName(state.levels[myTeam], state.failA[myTeam])}级</span> · <span class="op">对方 ${levelName(state.levels[1 - myTeam], state.failA[1 - myTeam])}级</span>`;
    $('info-hand').textContent = `第 ${state.handNo} 局`;
  }

  // 贡牌/还贡牌/抗贡大王为公开信息, 显示在对应玩家座位旁
  function pubBadges(seat) {
    const t = state.tribute;
    if (!t) return '';
    const out = [];
    for (const pr of t.pairs || []) {
      if (pr.receiver === seat && pr.card) out.push(pubBadge(pr.card, '贡'));
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

  // 叠牌尺寸从实际CSS读取,让放大的点数/花色在露出的牌头内保持可辨认。
  function stackCards(col, cardEls, hasLabel) {
    if (!cardEls.length) return;
    for (const el of cardEls) col.appendChild(el);
    const handStyle = getComputedStyle($('my-hand'));
    const cardH = parseFloat(getComputedStyle(cardEls[0]).height) || 91;
    const defStrip = parseFloat(handStyle.getPropertyValue('--stack-strip')) || 38;
    const minStrip = parseFloat(handStyle.getPropertyValue('--stack-min-strip')) || 12;
    const maxHeight = parseFloat(handStyle.getPropertyValue('--stack-max-height')) || 280;
    const header = hasLabel && col.querySelector('.col-label, .manual-group-header');
    const headerH = header ? header.offsetHeight + (parseFloat(getComputedStyle(header).marginBottom) || 0) : 0;
    const maxColH = Math.max(cardH, Math.min(maxHeight, window.innerHeight * .45) - headerH);
    const n = cardEls.length;
    let strip = defStrip;
    if (n > 1 && cardH + (n - 1) * defStrip > maxColH) {
      strip = Math.max(minStrip, Math.floor((maxColH - cardH) / (n - 1)));
    }
    cardEls.forEach((el, i) => {
      // 标签不是牌,第一张必须显式清零,其余按实际牌高计算重叠。
      el.style.marginTop = i === 0 ? '0px' : (strip - cardH) + 'px';
    });
  }

  function onCardClick(el, c, tributeMode) {
    return () => {
      if (tributeMode === 'give') {
        const legal = state.myHand.filter(x => !R.isWild(x, state.levelRanks));
        const best = Math.max.apply(null, legal.map(x => R.orderOf(x.rank, state.levelRanks)));
        if (R.isWild(c, state.levelRanks) || R.orderOf(c.rank, state.levelRanks) !== best) {
          toast('进贡必须选择手中最大的非逢人配牌'); return;
        }
        Sound.select();
        if (selected.has(c.id)) selected.delete(c.id);
        else { selected.clear(); selected.add(c.id); }
        refreshHandSelection();
        syncReturnBar();
        return;
      }
      if (tributeMode === 'return') {
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
    const tributeMode = myTributeMode();
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

    const cardById = new Map(cards.map(c => [c.id, c]));
    const visibleManualGroups = arranged ? [] : manualGroups.map(g => ({
      ...g, cards: g.cardIds.map(id => cardById.get(id)).filter(Boolean)
    }));
    const manualIds = new Set(visibleManualGroups.flatMap(g => g.cardIds));
    const regularCards = arranged ? cards : cards.filter(c => !manualIds.has(c.id));
    if (visibleManualGroups.length) box.classList.add('has-manual');

    const dealOrder = new Map(cards.map((c, i) => [c.id, i]));

    const mkEl = c => {
      const el = cardEl(c, false);
      const activate = onCardClick(el, c, tributeMode);
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

    const manualHeader = group => {
      const header = document.createElement('div');
      header.className = 'manual-group-header';
      const selectBtn = document.createElement('button');
      selectBtn.className = 'manual-group-select';
      selectBtn.dataset.groupId = group.id;
      selectBtn.textContent = group.label;
      selectBtn.title = '整组选中/取消';
      selectBtn.setAttribute('aria-pressed', 'false');
      selectBtn.onclick = e => { e.stopPropagation(); toggleManualGroupSelection(group.id); };
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'manual-group-restore';
      restoreBtn.textContent = '↩';
      restoreBtn.title = '放回普通手牌';
      restoreBtn.setAttribute('aria-label', `放回${group.label}`);
      restoreBtn.onclick = e => { e.stopPropagation(); restoreManualGroup(group.id); };
      header.append(selectBtn, restoreBtn);
      return header;
    };

    if (viewMode === 'grouped') {
      // 先收集列: 已组牌按组合分列(带牌型标签), 未组牌按点数分列
      const cols = [];
      if (breaks) {
        for (const c of regularCards) {
          if (!cols.length || breaks.has(c.id)) cols.push({ label: (labels && labels.get(c.id)) || '', els: [] });
          cols[cols.length - 1].els.push(mkEl(c));
        }
      } else {
        const lv = state.levelRanks;
        const byRank = new Map();
        for (const c of regularCards) {
          if (!byRank.has(c.rank)) byRank.set(c.rank, []);
          byRank.get(c.rank).push(c);
        }
        const ranks = Array.from(byRank.keys()).sort((a, b) => R.orderOf(b, lv) - R.orderOf(a, lv));
        for (const r of ranks) cols.push({ label: '', els: byRank.get(r).sort((a, b) => a.suit - b.suit).map(mkEl) });
        for (const group of visibleManualGroups) cols.push({ label: group.label, els: group.cards.map(mkEl), manualGroup: group });
      }
      for (const { label, els, manualGroup } of cols) {
        const col = document.createElement('div');
        col.className = manualGroup ? 'rank-col combo-col manual-col' : (breaks ? 'rank-col combo-col' : 'rank-col');
        if (manualGroup) col.appendChild(manualHeader(manualGroup));
        else if (breaks) {
          const lb = document.createElement('div');
          lb.className = 'col-label';
          lb.textContent = label;
          col.appendChild(lb);
        }
        box.appendChild(col);
        stackCards(col, els, !!breaks || !!manualGroup);
      }
      placeActionBar();
      return;
    }
    for (const c of regularCards) {
      const el = mkEl(c);
      if (breaks && breaks.has(c.id)) el.classList.add('combo-start');
      box.appendChild(el);
    }
    for (const group of visibleManualGroups) {
      const wrap = document.createElement('div');
      wrap.className = 'manual-card-group';
      wrap.dataset.groupId = group.id;
      const groupCards = document.createElement('div');
      groupCards.className = 'manual-group-cards';
      for (const c of group.cards) groupCards.appendChild(mkEl(c));
      wrap.append(manualHeader(group), groupCards);
      box.appendChild(wrap);
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
    for (const el of $('my-hand').querySelectorAll('.manual-group-select')) {
      const group = manualGroups.find(g => g.id === Number(el.dataset.groupId));
      const on = !!group && group.cardIds.every(id => selected.has(id));
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
    }
    syncManualGroupBtn();
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
    const lines = t.pairs.filter(p => p.card).map(p => `${seatName(p.giver)} 进贡 ${R.cardText(p.card)} 给 ${seatName(p.receiver)}`);
    const pendingTributes = t.pendingTributes || [];
    const pendingReturns = t.pendingReturns || [];
    if (pendingTributes.indexOf(state.mySeat) >= 0) lines.push('<b>👆 请选择最大牌的花色,再点「确认进贡」</b>');
    else if (pendingTributes.length) lines.push(`等待 ${pendingTributes.map(seatName).join('、')} 选择贡牌花色…`);
    else if (pendingReturns.indexOf(state.mySeat) >= 0) lines.push('<b>👆 点选一张 ≤10 的牌, 再点「确认还贡」</b>');
    else if (pendingReturns.length) lines.push(`等待 ${pendingReturns.map(seatName).join('、')} 还贡…`);
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
      const fails = st.failA || state.failA;
      if (st.activeATeam !== null && st.activeATeam !== undefined && !st.passedA) {
        const activeName = st.activeATeam === myTeam ? '我方' : '对方';
        const nextA = levelName(st.levels[st.activeATeam], fails[st.activeATeam]);
        lvText = `⚠️ ${activeName}本次冲A未过 → ${st.levels[st.activeATeam] === 2 ? 'A3失败，回到 <b>2</b>' : `进入 <b>${nextA}</b>`}`;
        if (st.winTeam !== st.activeATeam) {
          const winnerName = st.winTeam === myTeam ? '我方' : '对方';
          lvText += `<br>${st.doubleDown ? '双下！' : ''}${winnerName}升 <b>${st.delta}</b> 级 → <b>${levelName(st.levels[st.winTeam], fails[st.winTeam])}</b>`;
        }
      } else {
        lvText = `${st.doubleDown ? '🎉 双下！' : ''}${win ? '我方' : '对方'}升 <b>${st.delta}</b> 级 → 现在打 <b>${levelName(st.levels[st.winTeam], fails[st.winTeam])}</b>`;
      }
      if (st.levels[0] === 14 || st.levels[1] === 14) lvText += '<br>⚠️ ' + (st.levels[myTeam] === 14 ? `我方正在打${levelName(14, fails[myTeam])}!需头游且队友非末游` : `对方正在打${levelName(14, fails[1 - myTeam])},务必阻击!`);
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
    if (onAction) onAction({ kind: 'play', cardIds: cards.map(c => c.id), type: candidates[0].type, key: candidates[0].key });
  }

  return { setPlayers, resetSession, bind, render, toast, banner };
})();
