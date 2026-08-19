/** WebSocket 客户端封装 */
const Net = (() => {
  let ws = null;
  const handlers = {};
  function connect() {
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === 1) return resolve();
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('连接服务器失败'));
      ws.onclose = () => { if (handlers._close) handlers._close(); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (handlers[m.t]) handlers[m.t](m);
      };
    });
  }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function on(type, cb) { handlers[type] = cb; }
  return { connect, send, on };
})();
