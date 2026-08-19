/**
 * 掼蛋 AI(浏览器 / Node 共用): 简单启发式
 * decide(engine, seat) -> action
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const R = isNode ? require('./rules.js') : root.GuandanRules;
  const E = isNode ? require('./engine.js') : root.GuandanEngine;
  const mod = factory(R, E);
  if (isNode) module.exports = mod;
  else root.GuandanAI = mod;
})(typeof self !== 'undefined' ? self : this, function (R, E) {

  function decide(engine, seat, rng) {
    rng = rng || Math.random;
    const st = engine.getStateFor(seat);
    const lv = st.levelRanks;
    const hand = st.myHand;

    // 还贡: 给最小的 ≤10 普通牌
    if (st.phase === 'tribute') {
      const candidates = hand
        .filter(c => { const f = c.rank === 15 ? 2 : c.rank; return c.suit !== 4 && f <= 10 && !R.isWild(c, lv); })
        .sort((a, b) => R.orderOf(a.rank, lv) - R.orderOf(b.rank, lv));
      return { kind: 'returnTribute', cardId: candidates[0].id };
    }

    const partner = E.partnerOf(seat);
    const partnerAlive = st.finished.indexOf(partner) < 0;

    // 领出
    if (!st.target) {
      const plays = R.findPlays(hand, lv);
      if (!plays.length) return { kind: 'pass' };
      // 能一手出完直接出
      const all = plays.find(p => p.len === hand.length);
      if (all) return { kind: 'play', cardIds: all.cards.map(c => c.id), type: all.type };
      // 优先出长牌型(顺子/连对/钢板/三带二), 不用配, 越小越好
      const nonBomb = plays.filter(p => R.bombPower(p) === 0);
      const groups = [
        nonBomb.filter(p => p.wildUsed === 0 && ['straight', 'pairseq', 'tripleseq'].indexOf(p.type) >= 0),
        nonBomb.filter(p => p.wildUsed === 0 && ['fullhouse', 'triple'].indexOf(p.type) >= 0),
        nonBomb.filter(p => p.wildUsed === 0 && p.type === 'pair'),
        nonBomb.filter(p => p.wildUsed === 0 && p.type === 'single'),
        nonBomb.filter(p => p.wildUsed > 0 && ['straight', 'pairseq', 'tripleseq', 'fullhouse'].indexOf(p.type) >= 0),
        nonBomb
      ];
      for (const g of groups) {
        if (!g.length) continue;
        g.sort((a, b) => (b.len - a.len) || (a.key - b.key));
        const pick = g[0];
        // 单张不主动领出大王
        if (pick.type === 'single' && pick.key >= 17 && groups.some(x => x.length && x !== g)) continue;
        return { kind: 'play', cardIds: pick.cards.map(c => c.id), type: pick.type };
      }
      const bombs = plays.filter(p => R.bombPower(p) > 0).sort((a, b) => R.bombPower(a) - R.bombPower(b));
      const pick = bombs[0];
      return { kind: 'play', cardIds: pick.cards.map(c => c.id), type: pick.type };
    }

    // 跟牌
    const target = st.target;
    const beat = R.findBeat(hand, target.pattern, lv);
    if (!beat) return { kind: 'pass' };
    const goOut = beat.len === hand.length;
    const isPartner = target.seat === partner;

    if (isPartner && partnerAlive) {
      // 搭档的牌不压, 除非能直接出完
      if (goOut) return { kind: 'play', cardIds: beat.cards.map(c => c.id), type: beat.type };
      return { kind: 'pass' };
    }
    if (goOut) return { kind: 'play', cardIds: beat.cards.map(c => c.id), type: beat.type };

    const isBomb = R.bombPower(beat) > 0;
    if (!isBomb) {
      // 搭档已走完, 或对手牌的牌, 小牌就跟
      return { kind: 'play', cardIds: beat.cards.map(c => c.id), type: beat.type };
    }
    // 需要炸弹: 手牌少 / 对手快出完 / 小概率, 否则忍
    const threat = Math.min.apply(null, [0, 1, 2, 3]
      .filter(s => E.teamOf(s) !== E.teamOf(seat) && st.finished.indexOf(s) < 0)
      .map(s => st.counts[s]));
    if (hand.length <= 6 || threat <= 3 || rng() < 0.25) {
      return { kind: 'play', cardIds: beat.cards.map(c => c.id), type: beat.type };
    }
    return { kind: 'pass' };
  }

  return { decide };
});
