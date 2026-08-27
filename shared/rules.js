/**
 * 掼蛋规则核心模块(浏览器 / Node 共用)
 * 牌表示: { id, suit, rank, deck }
 *   suit: 0=黑桃 1=红桃 2=方块 3=梅花 4=王牌
 *   rank: 3..13=3..K, 14=A, 15=2, 16=小王, 17=大王
 * 大小: 大王 > 小王 > 级牌 > A > K > ... > 3 > 2
 * lv 参数: 当前局所有级牌的 rank 数组(双方等级可能不同, 两种级牌并存且同大)
 * 逢人配: 红桃级牌, 可配除王外任意牌
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GuandanRules = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANK_NAMES = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };

  function buildDeck() {
    const cards = [];
    let id = 0;
    for (let deck = 0; deck < 2; deck++) {
      for (let suit = 0; suit < 4; suit++)
        for (let rank = 3; rank <= 15; rank++) cards.push({ id: id++, suit, rank, deck });
      cards.push({ id: id++, suit: 4, rank: 16, deck });
      cards.push({ id: id++, suit: 4, rank: 17, deck });
    }
    return cards; // 108 张
  }

  function levelRankOf(level) { return level === 2 ? 15 : level; } // level: 2..14 (14=A)

  function isWild(card, lv) { return card.suit === 1 && lv.indexOf(card.rank) >= 0; }

  // 大小序: 2→2, 3..14→3..14, 级牌→15.5, 小王16, 大王17
  function orderOf(rank, lv) {
    if (rank === 16) return 16;
    if (rank === 17) return 17;
    if (lv.indexOf(rank) >= 0) return 15.5;
    if (rank === 15) return 2;
    return rank;
  }

  function cardText(c) {
    if (c.suit === 4) return RANK_NAMES[c.rank];
    return SUITS[c.suit] + RANK_NAMES[c.rank];
  }

  function sortHand(hand, lv) {
    hand.sort((a, b) => {
      const oa = orderOf(a.rank, lv), ob = orderOf(b.rank, lv);
      if (oa !== ob) return ob - oa;
      return a.suit - b.suit;
    });
    return hand;
  }

  const PATTERN_NAMES = {
    single: '单张', pair: '对子', triple: '三张', fullhouse: '三带二',
    straight: '顺子', pairseq: '三连对', tripleseq: '钢板',
    bomb: '炸弹', straightflush: '同花顺', jokerbomb: '四大天王'
  };

  /** 分析一组牌可能构成的牌型(考虑逢人配),返回 [{type,key,len,cards,wildUsed}] */
  function analyze(cards, lv) {
    const n = cards.length;
    if (n === 0) return [];
    const wilds = cards.filter(c => isWild(c, lv));
    const w = wilds.length;
    const rest = cards.filter(c => !isWild(c, lv));
    const jokers = rest.filter(c => c.suit === 4);
    const normals = rest.filter(c => c.suit !== 4);
    const byRank = {};
    for (const c of normals) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    const ranks = Object.keys(byRank).map(Number);
    const out = [];
    const seen = new Set();
    const add = (type, key, wildUsed) => {
      const sig = type + '|' + key + '|' + n;
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ type, key, len: n, cards, wildUsed: wildUsed || 0 });
    };

    if (n === 4 && jokers.length === 4) { add('jokerbomb', 17, 0); return out; }
    if (jokers.length > 0) { // 王只能单张/对子, 不可配
      if (n === 1) add('single', orderOf(cards[0].rank, lv), 0);
      if (n === 2 && jokers.length === 2 && jokers[0].rank === jokers[1].rank) add('pair', orderOf(jokers[0].rank, lv), 0);
      return out;
    }
    if (n === 1) { add('single', orderOf(cards[0].rank, lv), isWild(cards[0], lv) ? 1 : 0); return out; }

    const distinct = ranks.length;
    if (distinct <= 1) { // 对/三/炸
      const r = distinct === 1 ? ranks[0] : lv[0];
      const key = orderOf(r, lv);
      if (n === 2) add('pair', key, w);
      if (n === 3) add('triple', key, w);
      if (n >= 4) add('bomb', key, w);
    }
    if (n === 5) {
      for (const t of ranks) {
        const tc = byRank[t].length;
        if (tc > 3) continue;
        for (const p of ranks) {
          if (p === t) continue;
          const pc = byRank[p].length;
          if (pc > 2 || tc + pc !== rest.length) continue;
          if ((3 - tc) + (2 - pc) === w) add('fullhouse', orderOf(t, lv), w);
        }
      }
      if (distinct === 1 && w === 2 && byRank[ranks[0]].length === 3) add('fullhouse', orderOf(ranks[0], lv), 2);
      tryStraight(normals, w, lv, add);
    }
    if (n === 6) {
      trySeq(normals, w, lv, add, 3, 2, 'pairseq');
      trySeq(normals, w, lv, add, 2, 3, 'tripleseq');
    }
    return out;
  }

  // 序列链: A-2-3-...-K-A(2 接在 A 后, 不可再绕到 K 后; 级牌按自然位置参与)
  // 窗口起点索引即大小 key: AA2233/A2345/AAA222 最小, QQKKAA/10JQKA/KKKAAA 最大; KKAA22 非法
  const SEQ_CHAIN = [14, 15, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  function seqWindows(size) {
    const wins = [];
    for (let i = 0; i + size <= SEQ_CHAIN.length; i++) wins.push({ win: SEQ_CHAIN.slice(i, i + size), key: i });
    return wins;
  }

  function tryStraight(normals, w, lv, add) {
    const byRank = {};
    for (const c of normals) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    const ranks = Object.keys(byRank).map(Number);
    if (ranks.length !== normals.length) return; // 有重复 rank 不可能是顺子
    if (ranks.length + w !== 5) return;
    const suits = new Set(normals.map(c => c.suit));
    for (const { win, key } of seqWindows(5)) {
      if (ranks.every(r => win.indexOf(r) >= 0)) {
        // 同一组牌构成同花顺时只能按同花顺解释,不能降格为普通顺子。
        // 否则四张炸会错误地压过同花顺,并破坏出完后的接风牌权。
        add(suits.size <= 1 ? 'straightflush' : 'straight', key, w);
      }
    }
  }

  function trySeq(normals, w, lv, add, groups, need, type) {
    const byRank = {};
    for (const c of normals) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    const ranks = Object.keys(byRank).map(Number);
    if (ranks.length > groups) return;
    if (ranks.some(r => byRank[r].length > need)) return;
    if (!ranks.length) return;
    for (const { win, key } of seqWindows(groups)) {
      if (!ranks.every(r => win.indexOf(r) >= 0)) continue;
      let needWild = 0;
      for (const r of win) needWild += need - (byRank[r] ? byRank[r].length : 0);
      if (needWild === w) add(type, key, w);
    }
  }

  function isBombType(p) { return p.type === 'bomb' || p.type === 'straightflush' || p.type === 'jokerbomb'; }

  // 炸弹战力: 四大天王 > 6张+炸弹 > 同花顺 > 5张炸 > 4张炸; 非炸弹=0
  function bombPower(p) {
    if (p.type === 'jokerbomb') return 10000;
    if (p.type === 'bomb' && p.len >= 6) return 6000 + p.len * 100 + p.key;
    if (p.type === 'straightflush') return 5000 + p.key;
    if (p.type === 'bomb' && p.len === 5) return 4000 + p.key;
    if (p.type === 'bomb') return 3000 + p.key;
    return 0;
  }

  function canBeat(play, target) {
    if (!target) return true;
    const pb = bombPower(play), tb = bombPower(target);
    if (pb > 0 || tb > 0) return pb > tb;
    return play.type === target.type && play.len === target.len && play.key > target.key;
  }

  /** 从手牌枚举所有合理牌型(AI/提示用) */
  function findPlays(hand, lv) {
    const wilds = hand.filter(c => isWild(c, lv));
    const normals = hand.filter(c => !isWild(c, lv) && c.suit !== 4);
    const jokers = hand.filter(c => c.suit === 4);
    const byRank = {};
    for (const c of normals) (byRank[c.rank] = byRank[c.rank] || []).push(c);
    const plays = [];
    const push = (type, key, cards, wildUsed) =>
      plays.push({ type, key, len: cards.length, cards, wildUsed: wildUsed || 0 });

    for (const r of Object.keys(byRank).map(Number)) push('single', orderOf(r, lv), [byRank[r][0]]);
    for (const j of jokers) push('single', orderOf(j.rank, lv), [j]);
    for (const r of Object.keys(byRank).map(Number)) {
      const g = byRank[r], key = orderOf(r, lv);
      if (g.length >= 2) push('pair', key, g.slice(0, 2));
      if (g.length >= 3) push('triple', key, g.slice(0, 3));
      for (let k = 4; k <= g.length; k++) push('bomb', key, g.slice(0, k));
      if (g.length + wilds.length >= 4 && g.length >= 2) {
        const need = 4 - g.length;
        if (need > 0 && need <= wilds.length) push('bomb', key, g.concat(wilds.slice(0, need)), need);
      }
    }
    // 逢人配本身即级牌, 可单出/成对/成炸
    for (const wc of wilds) push('single', 15.5, [wc]);
    if (wilds.length >= 2) push('pair', 15.5, wilds.slice(0, 2));
    const small = jokers.filter(j => j.rank === 16), big = jokers.filter(j => j.rank === 17);
    if (small.length === 2) push('pair', 16, small);
    if (big.length === 2) push('pair', 17, big);
    if (jokers.length === 4) push('jokerbomb', 17, jokers);
    if (wilds.length > 0) {
      for (const r of Object.keys(byRank).map(Number)) {
        const g = byRank[r], key = orderOf(r, lv);
        if (g.length === 1) push('pair', key, g.concat(wilds.slice(0, 1)), 1);
        if (g.length <= 2 && wilds.length >= 3 - g.length) push('triple', key, g.concat(wilds.slice(0, 3 - g.length)), 3 - g.length);
      }
    }
    const rankList = Object.keys(byRank).map(Number);
    for (const t of rankList) {
      for (const p of rankList) {
        if (p === t) continue;
        if (byRank[t].length >= 3 && byRank[p].length >= 2)
          push('fullhouse', orderOf(t, lv), byRank[t].slice(0, 3).concat(byRank[p].slice(0, 2)));
        else if (byRank[t].length === 3 && byRank[p].length === 1 && wilds.length >= 1)
          push('fullhouse', orderOf(t, lv), byRank[t].slice(0, 3).concat(byRank[p].slice(0, 1), wilds.slice(0, 1)), 1);
      }
      if (byRank[t].length === 3 && wilds.length >= 2)
        push('fullhouse', orderOf(t, lv), byRank[t].slice(0, 3).concat(wilds.slice(0, 2)), 2);
    }
    // 顺子(2最小 A最大, 级牌按自然顺序参与)
    for (const { win, key } of seqWindows(5)) {
      const pick = [], wUsed = [];
      let ok = true;
      for (const r of win) {
        if (byRank[r] && byRank[r].length) pick.push(byRank[r][0]);
        else if (wUsed.length < wilds.length) wUsed.push(wilds[wUsed.length]);
        else { ok = false; break; }
      }
      if (ok) {
        // 枚举普通顺时避免选出一组实际应判为同花顺的牌。
        // 若某一点有其他花色,换入该牌后仍可作为普通顺子提示。
        const suits = new Set(pick.map(c => c.suit));
        if (suits.size <= 1) {
          const flushSuit = pick.length ? pick[0].suit : -1;
          for (const rank of win) {
            const pickIndex = pick.findIndex(c => c.rank === rank);
            if (pickIndex < 0) continue; // 该点由逢人配补齐,不占 pick 下标
            const alternatives = byRank[rank] || [];
            const alt = alternatives.find(c => c.suit !== flushSuit);
            if (alt) { pick[pickIndex] = alt; break; }
          }
        }
        if (new Set(pick.map(c => c.suit)).size > 1) push('straight', key, pick.concat(wUsed), wUsed.length);
      }
    }
    // 同花顺
    for (let s = 0; s < 4; s++) {
      const suitRank = {};
      for (const c of normals) if (c.suit === s) (suitRank[c.rank] = suitRank[c.rank] || []).push(c);
      for (const { win, key } of seqWindows(5)) {
        const pick = [], wUsed = [];
        let ok = true;
        for (const r of win) {
          if (suitRank[r] && suitRank[r].length) pick.push(suitRank[r][0]);
          else if (wUsed.length < wilds.length) wUsed.push(wilds[wUsed.length]);
          else { ok = false; break; }
        }
        if (ok) push('straightflush', key, pick.concat(wUsed), wUsed.length);
      }
    }
    // 三连对
    for (const { win, key } of seqWindows(3)) {
      const pick = [], wUsed = [];
      let ok = true;
      for (const r of win) {
        const g = byRank[r] || [];
        pick.push.apply(pick, g.slice(0, 2));
        for (let k = g.length; k < 2; k++) {
          if (wUsed.length < wilds.length) wUsed.push(wilds[wUsed.length]);
          else { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) push('pairseq', key, pick.concat(wUsed), wUsed.length);
    }
    // 钢板
    for (const { win, key } of seqWindows(2)) {
      const pick = [], wUsed = [];
      let ok = true;
      for (const r of win) {
        const g = byRank[r] || [];
        pick.push.apply(pick, g.slice(0, 3));
        for (let k = g.length; k < 3; k++) {
          if (wUsed.length < wilds.length) wUsed.push(wilds[wUsed.length]);
          else { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) push('tripleseq', key, pick.concat(wUsed), wUsed.length);
    }
    // 去重: 同型同key同长度保留用配最少的
    const best = new Map();
    for (const p of plays) {
      const sig = p.type + '|' + p.key + '|' + p.len;
      const cur = best.get(sig);
      if (!cur || p.wildUsed < cur.wildUsed) best.set(sig, p);
    }
    return Array.from(best.values());
  }

  /** 找能压过 target 的最小出牌(优先非炸弹/少用配) */
  function findBeat(hand, target, lv) {
    const plays = findPlays(hand, lv).filter(p => canBeat(p, target));
    if (!plays.length) return null;
    plays.sort((a, b) => {
      const ba = bombPower(a) > 0 ? 1 : 0, bb = bombPower(b) > 0 ? 1 : 0;
      if (ba !== bb) return ba - bb;
      if (a.wildUsed !== b.wildUsed) return a.wildUsed - b.wildUsed;
      if (bombPower(a) !== bombPower(b)) return bombPower(a) - bombPower(b);
      return a.key - b.key;
    });
    return plays[0];
  }

  function patternName(p) { return PATTERN_NAMES[p.type] || p.type; }

  return {
    SUITS, RANK_NAMES, PATTERN_NAMES,
    buildDeck, levelRankOf, isWild, orderOf, cardText, sortHand,
    analyze, canBeat, isBombType, bombPower, findPlays, findBeat, patternName
  };
});
