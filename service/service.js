/*
 * Home - Hintergrunddienst.
 *
 * TizenBrew startet diese Datei mit Node.js auf dem TV, sobald das Modul
 * geoeffnet wird. Die Seite selbst hat keinen Zugriff auf die TV-Funktionen,
 * dieser Dienst schon (TizenBrew reicht ihm das Objekt `tizen` durch).
 *
 *   GET  /ping          Lebenszeichen und Infos
 *   GET  /apps          installierte Apps (Kennung, Name, Symbolpfad)
 *   POST /launch        { ids: ["..."] }  oeffnet die erste App, die startet
 *   POST /key           { key: "KEY_HDMI1" }  sendet eine Fernbedienungstaste
 *   GET  /icon?path=    App-Symbol aus dem Dateisystem des TV
 *
 * Abgesichert: lauscht nur auf 127.0.0.1 und beantwortet nur Anfragen der
 * TizenBrew-Seite. Nur Node-Bordmittel, nur ES5 (alte Node-Versionen).
 *
 * Zum Testen am Rechner:  TV_HOST=192.168.x.x node service/service.js
 */
(function () {
  'use strict';

  var http = require('http');
  var tls = require('tls');
  var crypto = require('crypto');
  var urlLib = require('url');
  var fs = require('fs');
  var pathLib = require('path');

  var VERSION = '0.1.0';
  var PORT = 8098;
  var ENV = (typeof process !== 'undefined' && process.env) || {};
  var TV_HOST = ENV.TV_HOST || '127.0.0.1';
  var DEV = !!ENV.TV_HOST || !!ENV.HOME_DEV;
  var HAS_TIZEN = typeof tizen !== 'undefined' && !!tizen && !!tizen.application;
  var SHARE_DIR = '/home/owner/share';
  var STATE_FILE = fs.existsSync(SHARE_DIR) ? SHARE_DIR + '/tvhome.json' : pathLib.resolve('.tvhome.json');
  var ORIGINS = ['http://127.0.0.1:8081', 'http://localhost:8081'];
  var ICON_ROOTS = ['/opt/', '/usr/'];
  var ICON_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  var ID_RE = /^[A-Za-z0-9._-]{3,80}$/;
  var KEY_RE = /^KEY_[A-Z0-9_]{1,30}$/;
  var MAX_BODY = 16 * 1024;

  function log(text) { try { console.log('[home] ' + text); } catch (e) { /* kein Log */ } }

  function bufFrom(data, enc) { return Buffer.from ? Buffer.from(data, enc) : new Buffer(data, enc); }
  function bufAlloc(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n).fill(0); }

  /* ---------- gespeicherter Zustand (nur das Fernbedienungs-Token) ---------- */

  var state = { remoteToken: '' };
  try {
    var saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved && typeof saved.remoteToken === 'string') state.remoteToken = saved.remoteToken;
  } catch (e) { /* erster Start */ }

  function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { log('Zustand nicht gespeichert: ' + e.message); }
  }

  /* ---------- Apps ---------- */

  var appsCache = null;

  function listApps(cb) {
    if (!HAS_TIZEN) return cb(new Error('App-Liste hier nicht verfuegbar'));
    try {
      tizen.application.getAppsInfo(function (infos) {
        var out = [];
        for (var i = 0; i < infos.length; i++) {
          var a = infos[i];
          if (!a || !a.id) continue;
          out.push({ id: a.id, name: a.name || a.id, icon: a.iconPath || '', show: a.show !== false });
        }
        appsCache = out;
        cb(null, out);
      }, function (err) { cb(new Error((err && err.message) || 'App-Liste fehlgeschlagen')); });
    } catch (e) { cb(e); }
  }

  // Startet eine App ueber die eigene Schnittstelle des TV (Port 8001).
  function launchRest(id, cb) {
    var req = http.request({
      host: TV_HOST, port: 8001, method: 'POST',
      path: '/api/v2/applications/' + encodeURIComponent(id)
    }, function (res) {
      res.resume();
      res.on('end', function () {
        cb(res.statusCode === 200 ? null : new Error(res.statusCode === 404 ? 'nicht installiert' : 'TV lehnt ab (' + res.statusCode + ')'));
      });
    });
    req.on('error', function () { cb(new Error('TV-Schnittstelle nicht erreichbar')); });
    req.setTimeout(6000, function () { req.abort(); });
    req.end();
  }

  function launchOne(id, cb) {
    var done = false;
    function finish(err) { if (!done) { done = true; cb(err); } }
    if (!HAS_TIZEN) return launchRest(id, finish);
    try {
      tizen.application.launch(id, function () { finish(null); }, function () { launchRest(id, finish); });
    } catch (e) { launchRest(id, finish); }
  }

  // Probiert die Kennungen der Reihe nach, bis eine App startet.
  function launchAny(ids, cb) {
    var i = 0;
    var lastError = new Error('keine Kennung');
    (function next() {
      if (i >= ids.length) return cb(lastError);
      var id = ids[i++];
      launchOne(id, function (err) {
        if (!err) return cb(null, id);
        lastError = err;
        next();
      });
    })();
  }

  /* ---------- Fernbedienungstasten (wss://TV:8002) ---------- */

  // Kleiner WebSocket-Client (RFC 6455) ueber TLS: Textnachrichten, Ping, Close.
  function wsConnect(url, handlers) {
    var parsed = urlLib.parse(url);
    var key = crypto.randomBytes(16).toString('base64');
    var buffer = bufAlloc(0);
    var upgraded = false;
    var socket = tls.connect({ host: parsed.hostname, port: +parsed.port || 443, rejectUnauthorized: false }, function () {
      socket.write('GET ' + parsed.path + ' HTTP/1.1\r\nHost: ' + parsed.host + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });

    function frame(payload, opcode) {
      var len = payload.length;
      var header;
      if (len < 126) { header = bufAlloc(2); header[1] = 0x80 | len; }
      else { header = bufAlloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
      header[0] = 0x80 | opcode;
      var mask = crypto.randomBytes(4);
      var body = bufAlloc(len);
      for (var i = 0; i < len; i++) body[i] = payload[i] ^ mask[i % 4];
      socket.write(Buffer.concat([header, mask, body]));
    }

    function readFrames() {
      while (buffer.length >= 2) {
        var len = buffer[1] & 127;
        var offset = 2;
        if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4; }
        else if (len === 127) { if (buffer.length < 10) return; len = buffer.readUInt32BE(6); offset = 10; }
        if (buffer[1] & 128) offset += 4;
        if (buffer.length < offset + len) return;
        var opcode = buffer[0] & 15;
        var payload = buffer.slice(offset, offset + len);
        buffer = buffer.slice(offset + len);
        if (opcode === 1 && handlers.message) handlers.message(payload.toString('utf8'));
        else if (opcode === 8) socket.end();
        else if (opcode === 9) frame(payload, 10);
      }
    }

    socket.on('data', function (chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        var end = buffer.toString('binary').indexOf('\r\n\r\n');
        if (end === -1) return;
        if (!/^HTTP\/1\.1 101/.test(buffer.slice(0, end).toString())) return socket.destroy();
        upgraded = true;
        buffer = buffer.slice(end + 4);
      }
      readFrames();
    });
    socket.on('close', function () { if (handlers.close) handlers.close(); });
    socket.on('error', function () { /* close folgt */ });

    return {
      send: function (text) { frame(bufFrom(String(text), 'utf8'), 1); },
      close: function () { socket.end(); }
    };
  }

  var remote = { socket: null, ready: false, queue: [], lastError: '' };

  function remoteUrl() {
    var url = 'wss://' + TV_HOST + ':8002/api/v2/channels/samsung.remote.control?name=' + bufFrom('Home').toString('base64');
    return state.remoteToken ? url + '&token=' + state.remoteToken : url;
  }

  // Verbindet erst bei der ersten Taste. Der TV fragt dann einmal "Home zulassen?".
  function connectRemote() {
    if (remote.socket) return;
    remote.socket = wsConnect(remoteUrl(), {
      message: function (raw) {
        var msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (msg.event === 'ms.channel.connect') {
          if (msg.data && msg.data.token && String(msg.data.token) !== state.remoteToken) {
            state.remoteToken = String(msg.data.token);
            saveState();
          }
          remote.ready = true;
          remote.lastError = '';
          flushKeys();
        } else if (msg.event === 'ms.channel.unauthorized') {
          remote.lastError = 'vom TV abgelehnt';
          remote.queue = [];
          remote.socket.close();
        }
      },
      close: function () { remote.socket = null; remote.ready = false; }
    });
  }

  function flushKeys() {
    while (remote.ready && remote.queue.length) {
      remote.socket.send(JSON.stringify({
        method: 'ms.remote.control',
        params: { Cmd: 'Click', DataOfCmd: remote.queue.shift(), Option: 'false', TypeOfRemote: 'SendRemoteKey' }
      }));
    }
  }

  function sendKey(key) {
    if (remote.queue.length > 5) remote.queue = [];
    remote.queue.push(key);
    if (remote.ready) flushKeys(); else connectRemote();
  }

  /* ---------- HTTP ---------- */

  function send(req, res, status, body, type) {
    var origin = req.headers.origin;
    var isJson = !Buffer.isBuffer(body);
    var headers = {
      'Content-Type': type || 'application/json',
      'Cache-Control': type ? 'max-age=86400' : 'no-store',
      'Vary': 'Origin'
    };
    if (origin && (DEV || ORIGINS.indexOf(origin) !== -1)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }
    res.writeHead(status, headers);
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function readBody(req, cb) {
    var chunks = [];
    var size = 0;
    var failed = false;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) { failed = true; req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (failed) return cb(new Error('zu gross'));
      try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { cb(e); }
    });
  }

  function serveIcon(req, res, file) {
    file = pathLib.normalize(String(file || ''));
    var ext = pathLib.extname(file).toLowerCase();
    var allowed = false;
    for (var i = 0; i < ICON_ROOTS.length; i++) if (file.indexOf(ICON_ROOTS[i]) === 0) allowed = true;
    if (!allowed || !ICON_TYPES[ext]) return send(req, res, 404, { ok: false });
    fs.readFile(file, function (err, data) {
      if (err) return send(req, res, 404, { ok: false });
      send(req, res, 200, data, ICON_TYPES[ext]);
    });
  }

  function handle(req, res) {
    var url = urlLib.parse(req.url, true);
    var origin = req.headers.origin;
    var route = req.method + ' ' + url.pathname;

    // Fremde Webseiten duerfen diesen Dienst nicht benutzen.
    if (origin && !DEV && ORIGINS.indexOf(origin) === -1) return send(req, res, 403, { ok: false, error: 'nicht erlaubt' });
    if (req.method === 'OPTIONS') return send(req, res, 204, {});

    if (route === 'GET /ping') {
      return send(req, res, 200, { ok: true, version: VERSION, tizen: HAS_TIZEN, remoteError: remote.lastError });
    }
    if (route === 'GET /apps') {
      return listApps(function (err, apps) {
        if (err) return send(req, res, 200, { ok: false, error: err.message, apps: appsCache || [] });
        send(req, res, 200, { ok: true, apps: apps });
      });
    }
    if (route === 'GET /icon') return serveIcon(req, res, url.query.path);

    if (route === 'POST /launch') {
      return readBody(req, function (err, body) {
        var ids = (!err && body && body.ids instanceof Array) ? body.ids : [];
        var clean = [];
        for (var i = 0; i < ids.length && clean.length < 6; i++) if (ID_RE.test(String(ids[i]))) clean.push(String(ids[i]));
        if (!clean.length) return send(req, res, 400, { ok: false, error: 'keine gueltige Kennung' });
        launchAny(clean, function (e, id) {
          if (e) return send(req, res, 200, { ok: false, error: e.message });
          send(req, res, 200, { ok: true, id: id });
        });
      });
    }
    if (route === 'POST /key') {
      return readBody(req, function (err, body) {
        var key = (!err && body && String(body.key)) || '';
        if (!KEY_RE.test(key)) return send(req, res, 400, { ok: false, error: 'ungueltige Taste' });
        sendKey(key);
        send(req, res, 200, { ok: true });
      });
    }
    send(req, res, 404, { ok: false, error: 'unbekannt' });
  }

  var server = http.createServer(function (req, res) {
    try { handle(req, res); } catch (e) { try { send(req, res, 500, { ok: false, error: e.message }); } catch (e2) { /* schon gesendet */ } }
  });
  server.on('error', function (e) { log('Dienst nicht gestartet: ' + e.message); });
  server.listen(PORT, '127.0.0.1', function () { log('Dienst laeuft auf Port ' + PORT); });
})();
