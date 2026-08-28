/** 新旧 AI 对打基准:每个种子交换一次阵营,降低座位与发牌偏差 */
const { Engine, teamOf, partnerOf } = require('../shared/engine.js');
const R = require('../shared/rules.js');
const NewAI = require('../shared/ai.js');
const path = require('path');
const { execFileSync } = require('child_process');
const NodeModule = require('module');

function loadAIAtRef(ref) {
  if (!/^[0-9a-zA-Z._/-]+$/.test(ref)) throw new Error('invalid baseline ref: ' + ref);
  const source = execFileSync('git', ['show', `${ref}:shared/ai.js`], { encoding: 'utf8' });
  const filename = path.join(__dirname, '../shared/.benchmark-ai-' + ref.replace(/[^\w.-]/g, '_') + '.js');
  const loaded = new NodeModule(filename, module);
  loaded.filename = filename;
  loaded.paths = NodeModule._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

function legacyDecide(engine, seat, rng) {
  const st = engine.getStateFor(seat), lv = st.levelRanks, hand = st.myHand;
  if (st.phase === 'tribute') {
    if ((st.tribute.pendingTributes || []).includes(seat)) {
      const legal = hand.filter(c => !R.isWild(c, lv));
      const best = Math.max.apply(null, legal.map(c => R.orderOf(c.rank, lv)));
      return { kind: 'giveTribute', cardId: legal.find(c => R.orderOf(c.rank, lv) === best).id };
    }
    const candidates = hand.filter(c => {
      const f = c.rank === 15 ? 2 : c.rank;
      return c.suit !== 4 && f <= 10 && !R.isWild(c, lv);
    }).sort((a, b) => R.orderOf(a.rank, lv) - R.orderOf(b.rank, lv));
    return { kind: 'returnTribute', cardId: candidates[0].id };
  }
  const partner = partnerOf(seat), partnerAlive = st.finished.indexOf(partner) < 0;
  if (!st.target) {
    const plays = R.findPlays(hand, lv);
    const all = plays.find(p => p.len === hand.length);
    if (all) return action(all);
    const nonBomb = plays.filter(p => R.bombPower(p) === 0);
    const groups = [
      nonBomb.filter(p => p.wildUsed === 0 && ['straight', 'pairseq', 'tripleseq'].includes(p.type)),
      nonBomb.filter(p => p.wildUsed === 0 && ['fullhouse', 'triple'].includes(p.type)),
      nonBomb.filter(p => p.wildUsed === 0 && p.type === 'pair'),
      nonBomb.filter(p => p.wildUsed === 0 && p.type === 'single'),
      nonBomb.filter(p => p.wildUsed > 0 && ['straight', 'pairseq', 'tripleseq', 'fullhouse'].includes(p.type)),
      nonBomb
    ];
    for (const group of groups) {
      if (!group.length) continue;
      group.sort((a, b) => b.len - a.len || a.key - b.key);
      const pick = group[0];
      if (pick.type === 'single' && pick.key >= 17 && groups.some(x => x.length && x !== group)) continue;
      return action(pick);
    }
    const bomb = plays.filter(p => R.bombPower(p) > 0).sort((a, b) => R.bombPower(a) - R.bombPower(b))[0];
    return action(bomb);
  }
  const beat = R.findBeat(hand, st.target.pattern, lv);
  if (!beat) return { kind: 'pass' };
  const goOut = beat.len === hand.length;
  if (st.target.seat === partner && partnerAlive) return goOut ? action(beat) : { kind: 'pass' };
  if (goOut || R.bombPower(beat) === 0) return action(beat);
  const threats = [0, 1, 2, 3].filter(s => teamOf(s) !== teamOf(seat) && st.finished.indexOf(s) < 0).map(s => st.counts[s]);
  const threat = threats.length ? Math.min.apply(null, threats) : 99;
  return hand.length <= 6 || threat <= 3 || rng() < .25 ? action(beat) : { kind: 'pass' };
}

function action(play) { return { kind: 'play', cardIds: play.cards.map(c => c.id), type: play.type }; }
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const pairs = Number(process.argv[2] || 50);
const baselineRef = process.argv[3] || 'legacy';
const startPair = Number(process.argv[4] || 1);
const BaselineAI = baselineRef === 'legacy' ? null : loadAIAtRef(baselineRef);

function baselineDecide(engine, seat, rng) {
  const st = engine.getStateFor(seat);
  // 历史AI不认识后来新增的手选贡牌协议;这里只做协议适配,不改变其出牌策略。
  if (st.phase === 'tribute' && (st.tribute.pendingTributes || []).includes(seat)) {
    const legal = st.myHand.filter(c => !R.isWild(c, st.levelRanks));
    const best = Math.max.apply(null, legal.map(c => R.orderOf(c.rank, st.levelRanks)));
    return { kind: 'giveTribute', cardId: legal.find(c => R.orderOf(c.rank, st.levelRanks) === best).id };
  }
  return baselineRef === 'legacy' ? legacyDecide(engine, seat, rng) : BaselineAI.decide(engine, seat, rng);
}

function run(seed, newTeam) {
  const engineRng = seeded(seed), decisionRng = seeded(seed ^ 0x9e3779b9);
  const e = new Engine({ rng: engineRng });
  e.startHand();
  let steps = 0;
  while (!e.over && steps++ < 25000) {
    if (e.phase === 'settle') { e.startHand(); continue; }
    const seat = e.phase === 'tribute' ? ((e.tribute.pendingTributes || [])[0] ?? e.tribute.pendingReturns[0]) : e.current;
    const brain = teamOf(seat) === newTeam ? NewAI.decide : baselineDecide;
    const result = e.applyAction(seat, brain(e, seat, decisionRng));
    if (!result.ok) throw new Error(`seed=${seed} seat=${seat}: ${result.error}`);
  }
  if (!e.over) throw new Error('benchmark timeout seed=' + seed);
  return { won: e.winnerTeam === newTeam, hands: e.handNo };
}

let wins = 0, hands = 0;
const winsByTeam = [0, 0];
for (let offset = 0; offset < pairs; offset++) {
  const i = startPair + offset;
  for (let team = 0; team < 2; team++) {
    const result = run(i * 7919, team);
    if (result.won) { wins++; winsByTeam[team]++; }
    hands += result.hands;
  }
}
const games = pairs * 2;
console.log(`AI BENCH[vs ${baselineRef}]: 新AI ${wins}/${games} 胜 (${(wins / games * 100).toFixed(1)}%), 队伍0/1=${winsByTeam[0]}/${winsByTeam[1]}, 平均 ${(hands / games).toFixed(1)} 手/场`);
if (wins / games < .5) process.exitCode = 1;
