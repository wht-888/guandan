/** 应用主控: 首页 / 大厅 / 单机驱动 / 联机逻辑 */
(() => {
  const $ = id => document.getElementById(id);
  const LOCAL_PLAYERS = [
    { name: '我', avatar: '😎' }, { name: '阿汪', avatar: '🐶' },
    { name: '喵喵', avatar: '🐱' }, { name: '熊熊', avatar: '🐻' }
  ];
  let mode = 'local';
  let engine = null, aiTimer = null;
  let mySeat = 0, roomCode = null, roomSnap = null;

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    $(id).classList.remove('hidden');
  }
  function toast(msg) { Table.toast(msg); }

  /* ============ 单机模式 ============ */
  function startLocal() {
    mode = 'local';
    engine = new GuandanEngine.Engine({});
    engine.startHand();
    Table.setPlayers(LOCAL_PLAYERS);
    show('screen-table');
    renderLocal();
    driveLocalAI();
  }
  function renderLocal() { Table.render(engine.getStateFor(0)); }
  function driveLocalAI() {
    clearTimeout(aiTimer);
    if (!engine || engine.phase === 'settle' || engine.over) return;
    let seat = -1;
    if (engine.phase === 'tribute') seat = engine.tribute.pendingReturns[0];
    else if (engine.phase === 'play') seat = engine.current;
    if (seat < 0 || seat === 0) return; // 等待真人
    aiTimer = setTimeout(() => {
      const res = engine.applyAction(seat, GuandanAI.decide(engine, seat));
      if (!res.ok && engine.phase === 'play' && engine.target) engine.applyAction(seat, { kind: 'pass' });
      renderLocal();
      driveLocalAI();
    }, 800 + Math.random() * 500);
  }

  /* ============ 联机模式 ============ */
  async function enterLobby() {
    try { await Net.connect(); } catch (e) { alert('无法连接服务器,请确认通过 npm start 启动后访问'); return; }
    show('screen-lobby');
    $('lobby-entry').classList.remove('hidden');
    $('lobby-room').classList.add('hidden');
  }
  function myName() { return $('input-name').value.trim() || '玩家' + Math.floor(Math.random() * 100); }

  function renderRoom() {
    $('lobby-entry').classList.add('hidden');
    $('lobby-room').classList.remove('hidden');
    $('room-code').textContent = roomSnap.code;
    const box = $('room-seats');
    box.innerHTML = '';
    roomSnap.seats.forEach((s, i) => {
      const div = document.createElement('div');
      if (s) {
        div.className = 'room-seat';
        div.innerHTML = `<span class="avatar">${s.avatar}</span><span>${s.name}${i === roomSnap.host ? ' 👑' : ''}${i === mySeat ? '(我)' : ''}</span>` +
          (s.isAI && mySeat === roomSnap.host && !roomSnap.started ? `<span class="kick" data-seat="${i}">✕</span>` : '');
      } else {
        div.className = 'room-seat empty';
        div.innerHTML = '<span>空位</span>';
      }
      box.appendChild(div);
    });
    box.querySelectorAll('.kick').forEach(el => el.onclick = () => Net.send({ t: 'removeAI', seat: Number(el.dataset.seat) }));
    $('btn-start').style.display = (mySeat === roomSnap.host && !roomSnap.started) ? '' : 'none';
    $('btn-add-ai').style.display = (mySeat === roomSnap.host && !roomSnap.started) ? '' : 'none';
  }

  Net.on('joined', m => { mySeat = m.seat; roomCode = m.code; });
  Net.on('room', m => {
    roomSnap = m;
    if (!m.started) { show('screen-lobby'); renderRoom(); }
    else Table.setPlayers(m.seats);
  });
  Net.on('state', m => {
    mode = 'online';
    mySeat = m.seat;
    if (roomSnap) Table.setPlayers(roomSnap.seats);
    show('screen-table');
    Table.render(m.state);
  });
  Net.on('error', m => toast(m.msg || '出错了'));
  Net.on('_close', () => { if (mode === 'online') { alert('与服务器断开连接'); location.reload(); } });

  /* ============ 绑定 ============ */
  Table.bind(
    action => { // 出牌/不出/还贡
      if (mode === 'local') {
        const res = engine.applyAction(0, action);
        if (!res.ok) { toast(res.error); return; }
        renderLocal(); driveLocalAI();
      } else Net.send({ t: 'action', action });
    },
    () => { // 下一局 / 再来一场
      if (mode === 'local') {
        if (engine.over) engine = new GuandanEngine.Engine({});
        engine.startHand();
        renderLocal(); driveLocalAI();
      } else Net.send({ t: 'next' });
    }
  );

  $('btn-single').onclick = () => { Sound.click(); startLocal(); };
  $('btn-online').onclick = () => { Sound.click(); enterLobby(); };
  $('btn-rules').onclick = () => { Sound.click(); $('modal-rules').classList.remove('hidden'); };
  $('btn-rules-close').onclick = () => $('modal-rules').classList.add('hidden');
  $('btn-lobby-back').onclick = () => show('screen-home');
  $('btn-create').onclick = () => { Sound.click(); Net.send({ t: 'create', name: myName() }); };
  $('btn-join').onclick = () => {
    const code = $('input-code').value.trim();
    if (!/^\d{4}$/.test(code)) { alert('请输入4位房间号'); return; }
    Sound.click(); Net.send({ t: 'join', code, name: myName() });
  };
  $('btn-add-ai').onclick = () => { Sound.click(); Net.send({ t: 'addAI' }); };
  $('btn-start').onclick = () => { Sound.click(); Net.send({ t: 'start' }); };
  $('btn-leave').onclick = () => { Net.send({ t: 'leave' }); location.reload(); };
  // 调试: ?auto=single 自动进入单机模式
  if (location.search.indexOf('auto=single') >= 0) setTimeout(startLocal, 100);

  $('btn-exit').onclick = () => {
    if (!confirm('确定退出当前对局吗?')) return;
    clearTimeout(aiTimer);
    if (mode === 'online') { Net.send({ t: 'leave' }); location.reload(); }
    else show('screen-home');
  };
})();
