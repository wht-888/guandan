/**
 * 掼蛋对局引擎(浏览器 / Node 共用)
 * 座位: 0,1,2,3 顺时针; 0&2 一队, 1&3 一队
 * 阶段: idle -> play(含 tribute 子阶段) -> settle -> (下一手 | over)
 */
(function (root, factory) {
  const R = (typeof module !== 'undefined' && module.exports)
    ? require('./rules.js')
    : root.GuandanRules;
  const mod = factory(R);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GuandanEngine = mod;
})(typeof self !== 'undefined' ? self : this, function (R) {

  function teamOf(seat) { return seat % 2; }
  function partnerOf(seat) { return (seat + 2) % 4; }

  class Engine {
    constructor(opts) {
      opts = opts || {};
      this.rng = opts.rng || Math.random;
      this.levels = [2, 2];       // 双方等级 2..14(14=A)
      this.curLevel = 2;          // 本局所打级数(谁升级打谁的级)
      this.curLevelTeam = null;   // 本副级牌所属队;A1/A2/A3只推进该队
      this.failA = [0, 0];        // A阶段:0=A1,1=A2,2=A3
      this.handNo = 0;
      this.over = false;
      this.winnerTeam = null;
      this.prevPlacements = null; // 上一手名次 [头游..末游]
      this.phase = 'idle';
      this.hands = [[], [], [], []];
      this.finished = [];
      this.current = -1;
      this.target = null;         // {pattern, seat, cards}
      this.passCount = 0;
      this.lastPlays = [null, null, null, null]; // 各家最后一手(出牌或'pass')
      this.tribute = null;        // {pairs:[{giver,receiver,card}], pendingReturns:[seat], kangong}
      this.settle = null;
      this.lastEvent = null;      // 供 UI 动画/音效
    }

    levelRanks() {
      // 每局仅一种级牌: 上一局头游所在队升级后的级数(第一局打2)
      return [R.levelRankOf(this.curLevel)];
    }

    startHand() {
      this.handNo++;
      if (this.prevPlacements) {
        this.curLevelTeam = teamOf(this.prevPlacements[0]);
        this.curLevel = this.levels[this.curLevelTeam];
      } else this.curLevelTeam = null;
      const lv = this.levelRanks();
      const deck = R.buildDeck();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      this.hands = [[], [], [], []];
      for (let i = 0; i < deck.length; i++) this.hands[i % 4].push(deck[i]);
      for (let s = 0; s < 4; s++) R.sortHand(this.hands[s], lv);
      this.finished = [];
      this.target = null;
      this.passCount = 0;
      this.lastPlays = [null, null, null, null];
      this.tribute = null;
      this.settle = null;

      if (!this.prevPlacements) {
        this.phase = 'play';
        this.current = Math.floor(this.rng() * 4);
        this.lastEvent = { kind: 'deal', first: this.current };
        return;
      }
      const p = this.prevPlacements;
      const doubleDown = teamOf(p[0]) === teamOf(p[1]);
      const pairs = doubleDown
        ? [{ giver: p[3], receiver: p[0] }, { giver: p[2], receiver: p[1] }]
        : [{ giver: p[3], receiver: p[0] }];
      // 抗贡: 进贡方合计抓到两张大王
      let bigJokers = 0;
      for (const pr of pairs) for (const c of this.hands[pr.giver]) if (c.rank === 17) bigJokers++;
      if (bigJokers >= 2) {
        const givers = doubleDown ? [p[2], p[3]] : [p[3]];
        const jokerHolders = givers
          .map(s2 => ({ seat: s2, count: this.hands[s2].filter(c => c.rank === 17).length }))
          .filter(h => h.count > 0);
        this.tribute = { pairs: [], pendingReturns: [], kangong: true, doubleDown, jokerHolders };
        this.phase = 'play';
        this.current = p[0]; // 抗贡: 上局头游先出
        this.lastEvent = { kind: 'kangong', jokerHolders };
        return;
      }
      this.tribute = {
        pairs: pairs.map(pr => ({ giver: pr.giver, receiver: pr.receiver })),
        kangong: false, doubleDown, pendingTributes: [], pendingReturns: []
      };
      this.phase = 'tribute';
      // 最大牌为王或只有一种花色时无需选择;同点最大普通牌有多个花色时由进贡方手选。
      for (const pr of this.tribute.pairs) {
        const choices = this.tributeChoices(pr.giver);
        const suits = new Set(choices.map(c => c.suit));
        if (choices[0].suit === 4 || suits.size <= 1) this.moveTributeCard(pr, choices[0]);
        else this.tribute.pendingTributes.push(pr.giver);
      }
      if (this.tribute.pendingTributes.length) {
        this.lastEvent = { kind: 'tributeSelect', pendingTributes: this.tribute.pendingTributes.slice() };
      } else this.finishTributeSelection();
    }

    tributeChoices(seat) {
      const lv = this.levelRanks();
      const legal = this.hands[seat].filter(c => !R.isWild(c, lv));
      let best = -1;
      for (const c of legal) best = Math.max(best, R.orderOf(c.rank, lv));
      return legal.filter(c => R.orderOf(c.rank, lv) === best);
    }

    moveTributeCard(pair, card) {
      const lv = this.levelRanks();
      const hand = this.hands[pair.giver];
      hand.splice(hand.indexOf(card), 1);
      this.hands[pair.receiver].push(card);
      R.sortHand(this.hands[pair.receiver], lv);
      pair.card = card;
    }

    finishTributeSelection() {
      const t = this.tribute;
      t.pendingReturns = t.pairs.map(p => p.receiver);
      this.lastEvent = { kind: 'tribute', pairs: t.pairs };
    }

    /** action: {kind:'play',cardIds:[...],type?,key?} | {kind:'pass'} | {kind:'giveTribute',cardId} | {kind:'returnTribute',cardId} */
    applyAction(seat, action) {
      if (this.phase === 'tribute') {
        if ((this.tribute.pendingTributes || []).indexOf(seat) >= 0 || action.kind === 'giveTribute') return this.doGiveTribute(seat, action);
        return this.doReturnTribute(seat, action);
      }
      if (this.phase !== 'play') return { ok: false, error: '当前不能操作' };
      if (seat !== this.current) return { ok: false, error: '还没轮到你' };
      if (action.kind === 'pass') return this.doPass(seat);
      if (action.kind === 'play') return this.doPlay(seat, action);
      return { ok: false, error: '未知操作' };
    }

    doGiveTribute(seat, action) {
      const t = this.tribute;
      if (!t || (t.pendingTributes || []).indexOf(seat) < 0) return { ok: false, error: '不需要你选择贡牌' };
      if (action.kind !== 'giveTribute') return { ok: false, error: '请选择贡牌花色' };
      const card = this.hands[seat].find(c => c.id === action.cardId);
      if (!card) return { ok: false, error: '没有这张牌' };
      const choices = this.tributeChoices(seat);
      if (!choices.some(c => c.id === card.id)) return { ok: false, error: '进贡必须选择手中最大的非逢人配牌' };
      const pair = t.pairs.find(p => p.giver === seat);
      this.moveTributeCard(pair, card);
      t.pendingTributes.splice(t.pendingTributes.indexOf(seat), 1);
      this.lastEvent = { kind: 'giveTribute', from: seat, to: pair.receiver, card };
      if (t.pendingTributes.length === 0) this.finishTributeSelection();
      return { ok: true };
    }

    doReturnTribute(seat, action) {
      const t = this.tribute;
      if (!t || t.pendingReturns.indexOf(seat) < 0) return { ok: false, error: '不需要你还贡' };
      if (action.kind !== 'returnTribute') return { ok: false, error: '请选择还贡牌' };
      const lv = this.levelRanks();
      const hand = this.hands[seat];
      const card = hand.find(c => c.id === action.cardId);
      if (!card) return { ok: false, error: '没有这张牌' };
      const face = card.rank === 15 ? 2 : card.rank; // 牌面点数: 2 最小
      if (card.suit === 4 || face > 10 || R.isWild(card, lv)) return { ok: false, error: '还贡必须是不大于10的普通牌' };
      const pair = t.pairs.find(p => p.receiver === seat);
      hand.splice(hand.indexOf(card), 1);
      this.hands[pair.giver].push(card);
      R.sortHand(this.hands[pair.giver], lv);
      pair.returned = card;
      t.pendingReturns.splice(t.pendingReturns.indexOf(seat), 1);
      this.lastEvent = { kind: 'returnTribute', from: seat, to: pair.giver };
      if (t.pendingReturns.length === 0) {
        this.phase = 'play';
        // 进贡牌最大者先出; 双下贡牌相同则由头游的上家先出
        let first = t.pairs[0].giver, best = -1, tie = false;
        for (const pr of t.pairs) {
          const o = R.orderOf(pr.card.rank, lv);
          if (o > best) { best = o; first = pr.giver; tie = false; }
          else if (o === best) tie = true;
        }
        if (tie && t.pairs.length > 1) first = (this.prevPlacements[0] + 3) % 4;
        this.current = first;
        this.lastEvent.firstLead = first;
      }
      return { ok: true };
    }

    doPass(seat) {
      if (!this.target || this.target.seat === seat) return { ok: false, error: '首家必须出牌' };
      this.lastPlays[seat] = { pass: true };
      this.passCount++;
      this.lastEvent = { kind: 'pass', seat };
      const alive = this.aliveSeats();
      const needed = alive.filter(s => s !== this.target.seat).length;
      if (this.passCount >= needed) {
        // 一轮结束: 最后出牌者(或其搭档接风)领出
        let leader = this.target.seat;
        if (this.finished.indexOf(leader) >= 0) {
          const partner = partnerOf(leader);
          leader = alive.indexOf(partner) >= 0 ? partner : this.nextAlive(leader);
        }
        this.target = null;
        this.passCount = 0;
        this.lastPlays = [null, null, null, null];
        this.current = leader;
        this.lastEvent.roundEnd = true;
      } else {
        this.current = this.nextAlive(seat);
      }
      return { ok: true };
    }

    doPlay(seat, action) {
      const lv = this.levelRanks();
      const hand = this.hands[seat];
      const cards = [];
      for (const id of action.cardIds) {
        const c = hand.find(x => x.id === id);
        if (!c) return { ok: false, error: '手牌中没有选中的牌' };
        cards.push(c);
      }
      if (!cards.length) return { ok: false, error: '请选择要出的牌' };
      let candidates = R.analyze(cards, lv);
      if (action.type) candidates = candidates.filter(p => p.type === action.type);
      if (action.key !== undefined && action.key !== null) candidates = candidates.filter(p => p.key === action.key);
      if (!candidates.length) return { ok: false, error: '所选牌不构成合法牌型' };
      if (this.target) {
        candidates = candidates.filter(p => R.canBeat(p, this.target.pattern));
        if (!candidates.length) return { ok: false, error: '所选牌压不过上家' };
      }
      // 旧客户端未传 key 时,同牌型采用最强解释,避免逢人配三带二被降格。
      candidates.sort((a, b) => (R.bombPower(a) - R.bombPower(b)) || (b.key - a.key));
      const pattern = candidates[0];
      for (const c of cards) hand.splice(hand.indexOf(c), 1);
      const play = { pattern, cards, seat };
      this.target = play;
      this.passCount = 0;
      this.lastPlays[seat] = play;
      this.lastEvent = { kind: 'play', seat, pattern, cards };
      if (hand.length === 0) {
        this.finished.push(seat);
        this.lastEvent.finish = seat;
        if (this.checkHandEnd()) return { ok: true };
      }
      this.current = this.nextAlive(seat);
      return { ok: true };
    }

    aliveSeats() {
      return [0, 1, 2, 3].filter(s => this.finished.indexOf(s) < 0);
    }

    nextAlive(seat) {
      for (let i = 1; i <= 4; i++) {
        const s = (seat + i) % 4;
        if (this.finished.indexOf(s) < 0) return s;
      }
      return seat;
    }

    checkHandEnd() {
      const t0done = this.finished.indexOf(0) >= 0 && this.finished.indexOf(2) >= 0;
      const t1done = this.finished.indexOf(1) >= 0 && this.finished.indexOf(3) >= 0;
      if (!t0done && !t1done && this.finished.length < 3) return false;
      const placements = this.finished.slice();
      for (let s = 0; s < 4; s++) if (placements.indexOf(s) < 0) placements.push(s);
      const winTeam = teamOf(placements[0]);
      const second = teamOf(placements[1]) === winTeam ? 1 : (teamOf(placements[2]) === winTeam ? 2 : 3);
      const delta = second === 1 ? 3 : (second === 2 ? 2 : 1);
      const doubleDown = delta === 3;
      let passedA = false;
      const activeATeam = this.curLevel === 14 && Number.isInteger(this.curLevelTeam) ? this.curLevelTeam : null;
      if (activeATeam !== null) {
        // 只有本副实际打A的队伍能过A或消耗一次A机会。
        if (winTeam === activeATeam && delta >= 2) {
          passedA = true; this.over = true; this.winnerTeam = activeATeam;
        } else {
          this.failA[activeATeam]++;
          if (this.failA[activeATeam] >= 3) {
            this.levels[activeATeam] = 2;
            this.failA[activeATeam] = 0;
          }
        }
      }
      // 非本副A方的头游队照常升级;已经在A阶段的队保持自己的A1/A2/A3。
      if (!this.over && winTeam !== activeATeam && this.levels[winTeam] < 14) {
        this.levels[winTeam] = Math.min(14, this.levels[winTeam] + delta);
        if (this.levels[winTeam] === 14) this.failA[winTeam] = 0;
      }
      this.prevPlacements = placements;
      this.settle = {
        placements, winTeam, delta, doubleDown, passedA,
        levels: this.levels.slice(), failA: this.failA.slice(),
        activeATeam, over: this.over, winnerTeam: this.winnerTeam
      };
      this.phase = 'settle';
      this.lastEvent = { kind: 'settle', settle: this.settle };
      return true;
    }

    /** 面向某座位的可见状态(隐藏他人手牌) */
    getStateFor(seat) {
      const lv = this.levelRanks();
      return {
        phase: this.phase, handNo: this.handNo,
        levels: this.levels.slice(), failA: this.failA.slice(), curLevel: this.curLevel,
        curLevelTeam: this.curLevelTeam,
        over: this.over, winnerTeam: this.winnerTeam,
        levelRanks: lv, mySeat: seat,
        myHand: seat >= 0 ? this.hands[seat] : [],
        // 结算后公开所有玩家剩余手牌(结算页展示)
        allHands: (this.phase === 'settle' || this.over) ? this.hands.map(h => h.slice()) : null,
        counts: this.hands.map(h => h.length),
        current: this.current,
        target: this.target ? { pattern: this.target.pattern, cards: this.target.cards, seat: this.target.seat } : null,
        lastPlays: this.lastPlays.map(p => !p ? null : (p.pass ? { pass: true } : { pattern: p.pattern, cards: p.cards, seat: p.seat })),
        finished: this.finished.slice(),
        tribute: this.tribute,
        settle: this.settle,
        lastEvent: this.lastEvent
      };
    }
  }

  return { Engine, teamOf, partnerOf };
});
