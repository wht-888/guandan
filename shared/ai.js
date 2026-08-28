/**
 * 掼蛋 AI(浏览器 / Node 共用)
 * - 只使用当前座位可见状态, 不读取其他玩家手牌
 * - 记录本局已公开出牌与各家过牌倾向
 * - 兼顾手牌结构、队友配合、残局控制和炸弹成本
 * decide(engine, seat, rng) -> action
 */
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const R = isNode ? require('./rules.js') : root.GuandanRules;
  const E = isNode ? require('./engine.js') : root.GuandanEngine;
  const mod = factory(R, E);
  if (isNode) module.exports = mod;
  else root.GuandanAI = mod;
})(typeof self !== 'undefined' ? self : this, function (R, E) {
  const memoryByEngine = new WeakMap();
  const TYPE_BIAS = {
    tripleseq: -34, pairseq: -32, straight: -28, fullhouse: -23,
    triple: -10, pair: -4, single: 8
  };
  const PREVIOUS_BOMB_POLICY = { forceTargetCount: 3, forceEnemyMin: 2, threatTargetCount: 6, threatEnemyTotal: 12, threatBombGroups: 2, threatFinishDistance: 2 };
  const CURRENT_BOMB_POLICY = { forceTargetCount: 3, forceEnemyMin: 2, threatTargetCount: 6, threatEnemyTotal: 12, threatBombGroups: 2, threatFinishDistance: 2, multiBombTargetCount: 10, multiBombGroups: 2 };

  function playAction(play) {
    return { kind: 'play', cardIds: play.cards.map(c => c.id), type: play.type, key: play.key };
  }

  function removePlay(hand, play) {
    const used = new Set(play.cards.map(c => c.id));
    return hand.filter(c => !used.has(c.id));
  }

  function cardCounts(hand, lv) {
    const counts = new Map();
    for (const c of hand) {
      if (R.isWild(c, lv)) continue;
      const key = c.suit === 4 ? 'j' + c.rank : 'r' + c.rank;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function usedCounts(play, lv) {
    const counts = new Map();
    for (const c of play.cards) {
      if (R.isWild(c, lv)) continue;
      const key = c.suit === 4 ? 'j' + c.rank : 'r' + c.rank;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  /** 非炸弹出法尽量不拆炸、对子和三张,逢人配留到真正需要时再用。 */
  function splitPenalty(play, hand, lv) {
    const all = cardCounts(hand, lv);
    const used = usedCounts(play, lv);
    let score = play.wildUsed * 140;
    const jokerTotal = hand.filter(c => c.suit === 4).length;

    if (jokerTotal === 4 && play.type !== 'jokerbomb' && play.cards.some(c => c.suit === 4)) score += 900;

    for (const [key, n] of all) {
      const take = used.get(key) || 0;
      if (!take || take === n) continue;
      if (key[0] === 'j') {
        if (n === 2 && take === 1) score += 34;
        continue;
      }
      if (n >= 4 && R.bombPower(play) === 0) score += 900;
      else if (n >= 4) score += (n - take) * 28;
      else if (n === 3) score += (3 - take) * 24;
      else if (n === 2 && take === 1) score += 28;
    }
    return score;
  }

  /** 越低越整齐:少留孤张,保留成组牌和天然炸弹。 */
  function shapeScore(hand, lv) {
    if (!hand.length) return -1000;
    const byRank = new Map();
    let looseJokers = 0, wilds = 0;
    for (const c of hand) {
      if (R.isWild(c, lv)) { wilds++; continue; }
      if (c.suit === 4) { looseJokers++; continue; }
      byRank.set(c.rank, (byRank.get(c.rank) || 0) + 1);
    }
    let score = hand.length * .35 + looseJokers * 2 - wilds * 2;
    for (const n of byRank.values()) {
      if (n === 1) score += 8;
      else if (n === 2) score += 1;
      else if (n === 3) score -= 1;
      else score -= 5 + (n - 4);
    }
    return score;
  }

  function handSignature(hand) {
    return hand.map(c => c.id).sort((a, b) => a - b).join(',');
  }

  /** 残局两步搜索:用于优先制造“一手走完”或“两手走完”的牌形。 */
  function finishDistance(hand, lv, cache) {
    if (!hand.length) return 0;
    if (hand.length > 12) return 4;
    const sig = handSignature(hand);
    if (cache.has(sig)) return cache.get(sig);
    const plays = R.findPlays(hand, lv);
    if (plays.some(p => p.len === hand.length)) { cache.set(sig, 1); return 1; }
    if (hand.length <= 10) {
      const ordered = plays.slice().sort((a, b) => b.len - a.len || splitPenalty(a, hand, lv) - splitPenalty(b, hand, lv));
      for (let i = 0; i < ordered.length && i < 60; i++) {
        const rest = removePlay(hand, ordered[i]);
        if (!rest.length || R.findPlays(rest, lv).some(p => p.len === rest.length)) {
          cache.set(sig, 2);
          return 2;
        }
      }
    }
    cache.set(sig, 3);
    return 3;
  }

  function newMemory(st) {
    return {
      handNo: st.handNo,
      seenIds: new Set(),
      seenByRank: new Map(),
      passEvents: new Set(),
      passBySeat: [Object.create(null), Object.create(null), Object.create(null), Object.create(null)]
    };
  }

  function rememberCards(memory, cards) {
    for (const c of cards || []) {
      if (memory.seenIds.has(c.id)) continue;
      memory.seenIds.add(c.id);
      memory.seenByRank.set(c.rank, (memory.seenByRank.get(c.rank) || 0) + 1);
    }
  }

  /** 每个引擎、每个座位独立记牌,换局自动清空。 */
  function observe(engine, st) {
    let seats = memoryByEngine.get(engine);
    if (!seats) { seats = new Map(); memoryByEngine.set(engine, seats); }
    let memory = seats.get(st.mySeat);
    if (!memory || memory.handNo !== st.handNo) {
      memory = newMemory(st);
      seats.set(st.mySeat, memory);
    }

    if (st.target) rememberCards(memory, st.target.cards);
    for (const play of st.lastPlays || []) if (play && !play.pass) rememberCards(memory, play.cards);
    if (st.lastEvent && st.lastEvent.kind === 'play') rememberCards(memory, st.lastEvent.cards);

    if (st.target && st.lastEvent && st.lastEvent.kind === 'pass') {
      const s = st.lastEvent.seat;
      const targetIds = (st.target.cards || []).map(c => c.id).join('-');
      const sig = st.handNo + '|' + s + '|' + st.target.seat + '|' + st.target.pattern.type + '|' + st.target.pattern.key + '|' + targetIds;
      if (!memory.passEvents.has(sig)) {
        memory.passEvents.add(sig);
        const type = st.target.pattern.type;
        memory.passBySeat[s][type] = (memory.passBySeat[s][type] || 0) + 1;
      }
    }
    return memory;
  }

  function totalOfRank(rank) { return rank >= 16 ? 2 : 8; }

  function unseenByRank(hand, memory) {
    const own = new Map();
    for (const c of hand) own.set(c.rank, (own.get(c.rank) || 0) + 1);
    const unseen = new Map();
    for (let rank = 3; rank <= 17; rank++) {
      unseen.set(rank, Math.max(0, totalOfRank(rank) - (own.get(rank) || 0) - (memory.seenByRank.get(rank) || 0)));
    }
    return unseen;
  }

  /** 根据已出牌估计还有多少组同型牌能压过当前牌,越小越接近控制牌。 */
  function higherUnseen(play, hand, lv, memory) {
    if (R.bombPower(play) > 0) return 0;
    if (play.type === 'straight' || play.type === 'pairseq' || play.type === 'tripleseq') {
      return Math.max(0, 12 - play.key);
    }
    const need = play.type === 'pair' ? 2 : (play.type === 'triple' || play.type === 'fullhouse' ? 3 : 1);
    const unseen = unseenByRank(hand, memory);
    let groups = 0;
    for (let rank = 3; rank <= 17; rank++) {
      if (R.orderOf(rank, lv) > play.key) groups += Math.floor(unseen.get(rank) / need);
    }
    return groups;
  }

  function enemySeats(seat) {
    return [0, 1, 2, 3].filter(s => E.teamOf(s) !== E.teamOf(seat));
  }

  function minEnemyCount(st, seat) {
    const alive = enemySeats(seat).filter(s => st.finished.indexOf(s) < 0);
    return alive.length ? Math.min.apply(null, alive.map(s => st.counts[s])) : 99;
  }

  /** 将同一点的 4/5/6...张炸合并为最大库存,统计手牌中有多少牌被炸弹占用。 */
  function bombInventory(plays, hand) {
    const best = new Map();
    for (const p of plays) {
      if (R.bombPower(p) <= 0) continue;
      const key = p.type + '|' + p.key;
      const cur = best.get(key);
      if (!cur || p.len > cur.len) best.set(key, p);
    }
    const ids = new Set();
    for (const p of best.values()) for (const c of p.cards) ids.add(c.id);
    return {
      bombs: Array.from(best.values()),
      ids,
      groups: best.size,
      cards: ids.size,
      ratio: hand.length ? ids.size / hand.length : 0
    };
  }

  /**
   * 牌桌压力分:对手出完/进入 2~6 张收尾时迅速升高;
   * 自己手里炸弹越多,继续囤积的机会成本也越高。
   */
  function tablePressure(st, seat, hand, inventory) {
    const enemies = enemySeats(seat);
    const alive = enemies.filter(s => st.finished.indexOf(s) < 0);
    const finishedEnemies = enemies.length - alive.length;
    const enemyMin = alive.length ? Math.min.apply(null, alive.map(s => st.counts[s])) : 0;
    const enemyTotal = alive.reduce((sum, s) => sum + st.counts[s], 0);
    let score = finishedEnemies * 6;
    if (enemyMin <= 2) score += 6;
    else if (enemyMin <= 4) score += 4;
    else if (enemyMin <= 6) score += 2;
    else if (enemyMin <= 8) score += 1;
    if (enemyTotal <= 6) score += 4;
    else if (enemyTotal <= 10) score += 2;
    else if (enemyTotal <= 14) score += 1;
    if (st.finished.indexOf(E.partnerOf(seat)) >= 0) score += 2;
    if (hand.length <= 8) score += 3;
    else if (hand.length <= 12) score += 1;
    if (inventory.groups >= 2) score += 2;
    if (inventory.ratio >= .5) score += 3;
    else if (inventory.ratio >= .35) score += 1;
    return score;
  }

  function bombReleaseScore(play, hand, lv, cache) {
    const rest = removePlay(hand, play);
    const distance = finishDistance(rest, lv, cache);
    return distance * 180 + shapeScore(rest, lv) * 5 + R.bombPower(play) / 45 - play.len * 14;
  }

  function hasFinishedEnemy(st, seat) {
    return enemySeats(seat).some(s => st.finished.indexOf(s) >= 0);
  }

  function shouldLeadBomb(play, hand, st, seat, cache, inventory, pressure) {
    const rest = removePlay(hand, play);
    if (finishDistance(rest, st.levelRanks, cache) <= 1) return true;
    if (hasFinishedEnemy(st, seat)) return true;
    if (inventory.groups >= 2 && hand.length <= 10 && minEnemyCount(st, seat) <= 4) return true;
    if (inventory.ratio >= .6 && hand.length <= 9 && minEnemyCount(st, seat) <= 5) return true;
    return false;
  }

  function preBombShedScore(play) {
    return play.key * 10 - play.len * 3 + (play.wildUsed || 0) * 120;
  }

  /** 通常先出不碰炸的小牌,等对手接牌后再炸回;仅阻止立即出完时炸弹先行。 */
  function shouldShedBeforeBomb(shed, bomb, hand, st, seat, cache) {
    if (!shed) return false;
    const afterBomb = removePlay(hand, bomb);
    const bombLeavesOnePlay = finishDistance(afterBomb, st.levelRanks, cache) <= 1;
    const enemyMin = minEnemyCount(st, seat);
    if (bombLeavesOnePlay && shed.type === 'single' && enemyMin <= 1) return false;
    if (bombLeavesOnePlay && hasFinishedEnemy(st, seat) && enemyMin <= shed.len) return false;
    return true;
  }

  function policyBombThreat(hand, st, seat, inventory, policy) {
    if (st.counts[st.target.seat] <= policy.forceTargetCount || minEnemyCount(st, seat) <= policy.forceEnemyMin) return true;
    if (policy.multiBombTargetCount && st.counts[st.target.seat] <= policy.multiBombTargetCount && inventory.groups >= policy.multiBombGroups) return true;
    if (!policy.threatTargetCount || st.counts[st.target.seat] > policy.threatTargetCount) return false;
    const enemies = enemySeats(seat).filter(s => st.finished.indexOf(s) < 0);
    const enemyTotal = enemies.reduce((sum, s) => sum + st.counts[s], 0);
    return enemyTotal <= policy.threatEnemyTotal || inventory.groups >= policy.threatBombGroups;
  }

  function chooseReturn(hand, lv) {
    const candidates = hand.filter(c => {
      const face = c.rank === 15 ? 2 : c.rank;
      return c.suit !== 4 && face <= 10 && !R.isWild(c, lv);
    });
    const counts = cardCounts(hand, lv);
    candidates.sort((a, b) => {
      const countA = counts.get('r' + a.rank) || 0;
      const countB = counts.get('r' + b.rank) || 0;
      const breakA = countA >= 4 ? 900 : (countA === 3 ? 70 : (countA === 2 ? 36 : 0));
      const breakB = countB >= 4 ? 900 : (countB === 3 ? 70 : (countB === 2 ? 36 : 0));
      return (breakA - breakB) || (R.orderOf(a.rank, lv) - R.orderOf(b.rank, lv));
    });
    return { kind: 'returnTribute', cardId: candidates[0].id };
  }

  function chooseTribute(hand, lv) {
    const legal = hand.filter(c => !R.isWild(c, lv));
    const best = Math.max.apply(null, legal.map(c => R.orderOf(c.rank, lv)));
    const candidates = legal.filter(c => R.orderOf(c.rank, lv) === best);
    // 同点最大牌由AI代选时,优先交出同花结构最弱的花色。
    candidates.sort((a, b) => {
      const suitA = hand.filter(c => c.suit === a.suit && !R.isWild(c, lv)).length;
      const suitB = hand.filter(c => c.suit === b.suit && !R.isWild(c, lv)).length;
      return suitA - suitB || a.suit - b.suit || a.deck - b.deck;
    });
    return { kind: 'giveTribute', cardId: candidates[0].id };
  }

  function leadScore(play, hand, st, seat, memory, cache, feedType) {
    const lv = st.levelRanks;
    const rest = removePlay(hand, play);
    const bomb = R.bombPower(play);
    let score = splitPenalty(play, hand, lv) + shapeScore(rest, lv) * 4;
    score += (TYPE_BIAS[play.type] || 0) - play.len * 14 + play.key * .65 + play.wildUsed * 45;
    if (bomb > 0) score += 1500 + bomb / 12;

    const distance = finishDistance(rest, lv, cache);
    if (distance <= 2) score += distance * 150 - 650;
    else if (hand.length <= 12) score += distance * 120;

    const partner = E.partnerOf(seat);
    if (feedType && play.type !== feedType) score += 600;
    if (st.counts[partner] <= 5) score += (memory.passBySeat[partner][play.type] || 0) * 18;

    if (hand.length <= 9 || st.finished.indexOf(partner) >= 0) {
      const higher = higherUnseen(play, hand, lv, memory);
      score += higher * 5;
      if (higher === 0) score -= 85;
    }
    return score;
  }

  function chooseLead(hand, st, seat, memory, cache) {
    const lv = st.levelRanks;
    const plays = R.findPlays(hand, lv);
    if (!plays.length) return null;
    const all = plays.filter(p => p.len === hand.length).sort((a, b) => R.bombPower(a) - R.bombPower(b));
    if (all.length) return all[0];

    const partner = E.partnerOf(seat);
    const partnerAlive = st.finished.indexOf(partner) < 0;
    const enemyMin = minEnemyCount(st, seat);
    let feedType = null;
    if (partnerAlive && enemyMin > 2 && st.counts[partner] <= 2) {
      if (st.counts[partner] === 2 && plays.some(p => p.type === 'pair' && splitPenalty(p, hand, lv) < 500)) feedType = 'pair';
      else feedType = 'single';
    }

    let pool = plays.filter(p => R.bombPower(p) === 0 && splitPenalty(p, hand, lv) < 500);
    if (!pool.length) pool = plays.filter(p => R.bombPower(p) === 0);

    // 炸弹占手或牌桌进入高压收尾时准备使用,但有安全小牌时先出小牌、再炸回牌权。
    const inventory = bombInventory(plays, hand);
    const pressure = tablePressure(st, seat, hand, inventory);
    if (!feedType && inventory.bombs.length) {
      const bombs = inventory.bombs.slice().sort((a, b) => bombReleaseScore(a, hand, lv, cache) - bombReleaseScore(b, hand, lv, cache));
      if (shouldLeadBomb(bombs[0], hand, st, seat, cache, inventory, pressure)) {
        const shed = pool
          .filter(p => p.cards.every(c => !inventory.ids.has(c.id)))
          .sort((a, b) => preBombShedScore(a) - preBombShedScore(b))[0];
        if (shouldShedBeforeBomb(shed, bombs[0], hand, st, seat, cache)) return shed;
        return bombs[0];
      }
    }

    if (!pool.length) pool = plays;
    pool.sort((a, b) => leadScore(a, hand, st, seat, memory, cache, feedType) - leadScore(b, hand, st, seat, memory, cache, feedType));
    return pool[0];
  }

  function followScore(play, hand, st, seat, memory, cache, urgent) {
    const lv = st.levelRanks;
    const rest = removePlay(hand, play);
    let score = splitPenalty(play, hand, lv) + shapeScore(rest, lv) * 4 + play.wildUsed * 55;
    const bomb = R.bombPower(play);
    if (bomb > 0) score += 900 + bomb / 10;
    else score += play.key;

    const distance = finishDistance(rest, lv, cache);
    if (distance <= 2) score += distance * 140 - 580;
    else if (hand.length <= 12) score += distance * 100;

    if (urgent && bomb === 0) {
      const higher = higherUnseen(play, hand, lv, memory);
      score += higher * 7;
      if (higher === 0) score -= 100;
    }
    return score;
  }

  function shouldBomb(play, hand, st, seat, cache, inventory, pressure, policy) {
    const target = st.target;
    const rest = removePlay(hand, play);
    if (!rest.length || finishDistance(rest, st.levelRanks, cache) <= 1) return true;
    if (policy.threatTargetCount && st.counts[target.seat] <= policy.threatTargetCount &&
        finishDistance(rest, st.levelRanks, cache) <= policy.threatFinishDistance) return true;
    if (st.finished.indexOf(target.seat) >= 0) return true; // 阻止对手末手接风
    if (hasFinishedEnemy(st, seat)) return true;
    if (policyBombThreat(hand, st, seat, inventory, policy)) return true;
    if (st.counts[target.seat] <= 5 && hand.length <= 8) return true;
    if (inventory.groups >= 2 && hand.length <= 10 && minEnemyCount(st, seat) <= 4) return true;
    if (inventory.ratio >= .6 && hand.length <= 9 && pressure >= 6) return true;
    if (hand.length <= 6) return true;
    const partner = E.partnerOf(seat);
    if (st.finished.indexOf(partner) >= 0 && hand.length <= 8) return true;
    if (R.bombPower(target.pattern) > 0 && minEnemyCount(st, seat) <= 4) return true;
    return false;
  }

  function chooseFollow(hand, st, seat, memory, cache, policy) {
    const lv = st.levelRanks;
    const target = st.target;
    const partner = E.partnerOf(seat);
    const allPlays = R.findPlays(hand, lv);
    const inventory = bombInventory(allPlays, hand);
    const pressure = tablePressure(st, seat, hand, inventory);
    const plays = allPlays.filter(p => R.canBeat(p, target.pattern));
    if (!plays.length) return null;

    const goOut = plays.filter(p => p.len === hand.length)
      .sort((a, b) => R.bombPower(a) - R.bombPower(b) || a.key - b.key);
    if (goOut.length) return goOut[0];

    // 不压队友的牌,包括队友刚出完等待接风的末手。
    if (target.seat === partner) return null;

    const urgent = hasFinishedEnemy(st, seat) || policyBombThreat(hand, st, seat, inventory, policy) || st.finished.indexOf(target.seat) >= 0;
    const nonBomb = plays.filter(p => R.bombPower(p) === 0);
    const safe = nonBomb.filter(p => splitPenalty(p, hand, lv) < 500);
    let pool = safe;

    if (pool.length) {
      pool.sort((a, b) => followScore(a, hand, st, seat, memory, cache, urgent) - followScore(b, hand, st, seat, memory, cache, urgent));
      const pick = pool[0];
      // 平时宁可过牌也不拆天然炸弹;对手仅剩少量牌时才破例拦截。
      if (splitPenalty(pick, hand, lv) >= 800 && !urgent) return null;
      return pick;
    }

    const bombs = inventory.bombs.filter(p => R.canBeat(p, target.pattern))
      .sort((a, b) => followScore(a, hand, st, seat, memory, cache, urgent) - followScore(b, hand, st, seat, memory, cache, urgent));
    if (bombs.length && shouldBomb(bombs[0], hand, st, seat, cache, inventory, pressure, policy)) return bombs[0];

    // 没到出炸时机时,仍可在真正紧急的情况下拆炸拦截;平时继续保留。
    pool = nonBomb;
    if (!pool.length) return null;
    pool.sort((a, b) => followScore(a, hand, st, seat, memory, cache, urgent) - followScore(b, hand, st, seat, memory, cache, urgent));
    const pick = pool[0];
    if (splitPenalty(pick, hand, lv) >= 800 && !urgent) return null;
    return pick;
  }

  function decideWithPolicy(engine, seat, rng, policy) {
    const st = engine.getStateFor(seat);
    const lv = st.levelRanks;
    const hand = st.myHand;

    if (st.phase === 'tribute') {
      if (st.tribute && (st.tribute.pendingTributes || []).indexOf(seat) >= 0) return chooseTribute(hand, lv);
      return chooseReturn(hand, lv);
    }

    const memory = observe(engine, st);
    const cache = new Map();
    const pick = st.target
      ? chooseFollow(hand, st, seat, memory, cache, policy)
      : chooseLead(hand, st, seat, memory, cache);
    return pick ? playAction(pick) : { kind: 'pass' };
  }

  function decide(engine, seat, rng) { // rng 保留兼容旧调用;新策略本身确定性更强
    return decideWithPolicy(engine, seat, rng, CURRENT_BOMB_POLICY);
  }

  return {
    decide,
    _decidePrevious: (engine, seat, rng) => decideWithPolicy(engine, seat, rng, PREVIOUS_BOMB_POLICY)
  };
});
