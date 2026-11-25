/*
 * Home - Startbildschirm. Nur ES5, damit es auf dem alten Browser-Kern
 * von Tizen 5 laeuft (kein let/const, keine Pfeilfunktionen, kein fetch).
 *
 * Die Seite selbst darf keine TV-Funktionen aufrufen. Sie fragt deshalb den
 * eigenen Dienst (service/service.js) auf Port 8098. TizenBrew-Module wie
 * TizenTube startet sie ueber die Verbindung zu TizenBrew (Port 8081).
 */
(function () {
  'use strict';

  var CFG = window.HOME_CONFIG || { favorites: [], hide: '', extras: [] };
  var SVC = 'http://127.0.0.1:8098';
  var TB_SOCKET = 'ws://localhost:8081';
  var TB = { GetModules: 4, LaunchModule: 5 };
  var IS_TV = /Tizen|SMART-TV/i.test(navigator.userAgent);
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 10009, RED: 403, YELLOW: 405 };
  var IDLE_MS = 10 * 60 * 1000;
  var MAX_MORE = 30;
  // Apps aus dem Store haben Kennungen wie "AbCdEfGhIj.Name" oder nur Ziffern.
  // Alles andere sind Systembausteine, die niemand auf dem Startbildschirm braucht.
  var STORE_ID = /^([A-Za-z0-9]{10}\.[A-Za-z0-9_-]+|\d{9,})$/;
  var BUILT_IN = { 'org.tizen.browser': 1, 'org.tizen.netflix-app': 1, 'org.tizen.primevideo': 1, 'com.samsung.tv.store': 1 };

  var rows = [];            // rows[r] = Liste von Kacheln { el, def, ids }
  var pos = { r: 0, c: 0 };
  var apps = null;          // App-Liste vom TV, null = noch unbekannt
  var serviceInfo = null;
  var diagOpen = false;
  var diagPage = 0;
  var idleTimer = null;
  var toastTimer = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function rx(source) { try { return source ? new RegExp(source, 'i') : null; } catch (e) { return null; } }

  /* ---------- Dienst ---------- */

  function svc(method, path, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    function finish(err, json) { if (!done) { done = true; cb(err, json); } }
    try {
      x.open(method, SVC + path, true);
      x.timeout = 9000;
      // text/plain erspart dem Browser eine Vorab-Anfrage.
      if (body) x.setRequestHeader('Content-Type', 'text/plain');
      x.onload = function () {
        var json = null;
        try { json = JSON.parse(x.responseText); } catch (e) { /* keine Antwort */ }
        finish(json ? null : 'keine Antwort', json);
      };
      x.onerror = function () { finish('Dienst nicht erreichbar'); };
      x.ontimeout = function () { finish('Zeit abgelaufen'); };
      x.send(body ? JSON.stringify(body) : null);
    } catch (e) { finish('Dienst nicht erreichbar'); }
  }

  function toast(text, ms) {
    el('toastText').textContent = text;
    el('toast').className = 'on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el('toast').className = ''; }, ms || 3200);
  }

  /* ---------- Kacheln bauen ---------- */

  function bigTile(def) {
    var t = document.createElement('div');
    var color = def.color || ['#3a4150', '#1b1f28'];
    t.className = 'tile' + (def.name.length > 11 ? ' long' : '');
    t.style.background = 'linear-gradient(145deg,' + color[0] + ',' + color[1] + ')';
    t.innerHTML = '<div class="shine"></div><div class="text"><div class="name"></div><div class="sub"></div></div><div class="ring"></div>';
    t.querySelector('.name').textContent = def.name;
    t.querySelector('.sub').textContent = def.sub || '';
    return { el: t, def: def, ids: (def.ids || []).slice(), big: true };
  }

  function miniTile(def) {
    var t = document.createElement('div');
    t.className = 'mini';
    t.innerHTML = '<div class="pic"></div><div class="label"></div><div class="ring"></div>';
    var pic = t.querySelector('.pic');
    pic.textContent = def.name.charAt(0).toUpperCase();
    if (def.icon) {
      var img = new Image();
      img.onload = function () { pic.textContent = ''; pic.appendChild(img); };
      img.src = def.icon.charAt(0) === '/' ? SVC + '/icon?path=' + encodeURIComponent(def.icon) : def.icon;
    }
    t.querySelector('.label').textContent = def.name;
    return { el: t, def: def, ids: def.id ? [def.id] : [] };
  }

  function buildFavorites() {
    rows = [];
    for (var r = 0; r < CFG.favorites.length && r < 2; r++) {
      var host = el('fav' + r);
      var list = [];
      host.innerHTML = '';
      for (var c = 0; c < CFG.favorites[r].length; c++) {
        var tile = bigTile(CFG.favorites[r][c]);
        host.appendChild(tile.el);
        list.push(tile);
      }
      if (list.length) rows.push(list);
    }
  }

  // Ordnet den Favoriten die echten Kennungen vom TV zu und baut die untere Zeile.
  function applyApps() {
    var used = {};
    var hide = rx(CFG.hide);
    var r, c, i;

    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) {
        var tile = rows[r][c];
        if (!tile.big || tile.def.type !== 'app') continue;
        var match = rx(tile.def.match);
        var ids = [];
        for (i = 0; apps && match && i < apps.length; i++) {
          if (match.test(apps[i].name)) { ids.push(apps[i].id); used[apps[i].id] = 1; }
        }
        var fallback = tile.def.ids || [];
        for (i = 0; i < fallback.length; i++) { if (ids.indexOf(fallback[i]) === -1) ids.push(fallback[i]); used[fallback[i]] = 1; }
        tile.ids = ids;
        var missing = !!apps && apps.length > 0 && ids.length === 0;
        tile.el.className = tile.el.className.replace(/ missing/g, '') + (missing ? ' missing' : '');
      }
    }

    var more = [];
    for (i = 0; apps && i < apps.length; i++) {
      var a = apps[i];
      if (a.show === false || used[a.id]) continue;
      if (!STORE_ID.test(a.id) && !BUILT_IN[a.id]) continue;
      if (hide && hide.test(a.name)) continue;
      more.push({ name: a.name, id: a.id, icon: a.icon, type: 'app' });
    }
    more.sort(function (x, y) { return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1; });
    more = more.slice(0, MAX_MORE).concat(CFG.extras || []);

    var host = el('more');
    host.innerHTML = '';
    host.style.transform = 'translateX(0px)';
    var list = [];
    for (i = 0; i < more.length; i++) {
      var mini = miniTile(more[i]);
      host.appendChild(mini.el);
      list.push(mini);
    }
    // Die untere Zeile ist immer die letzte.
    while (rows.length && !rows[rows.length - 1][0].big) rows.pop();
    if (list.length) rows.push(list);
    el('moreLabel').style.display = list.length ? 'block' : 'none';
    if (pos.r >= rows.length) { pos.r = 0; pos.c = 0; }
    focus(pos.r, pos.c);
  }

  /* ---------- Fokus ---------- */

  function current() { return rows[pos.r] && rows[pos.r][pos.c]; }

  function focus(r, c) {
    if (!rows.length) return;
    var old = current();
    if (old) old.el.className = old.el.className.replace(/ focus/g, '');
    r = Math.max(0, Math.min(rows.length - 1, r));
    c = Math.max(0, Math.min(rows[r].length - 1, c));
    pos.r = r; pos.c = c;
    var tile = rows[r][c];
    tile.el.className += ' focus';
    if (tile.big) {
      el('bg').style.backgroundColor = (tile.def.color || [0, '#141821'])[1];
    } else {
      el('bg').style.backgroundColor = '#141821';
      // Zeile so verschieben, dass die Kachel sichtbar bleibt.
      var shift = Math.max(0, tile.el.offsetLeft - 1380);
      el('more').style.transform = 'translateX(' + (-shift) + 'px)';
    }
  }

  // Beim Wechsel der Zeile die Kachel nehmen, die am naechsten darueber oder darunter liegt.
  function moveRow(delta) {
    var target = pos.r + delta;
    if (target < 0 || target >= rows.length) return;
    var from = current().el.getBoundingClientRect();
    var center = from.left + from.width / 2;
    var best = 0;
    var bestDist = Infinity;
    for (var i = 0; i < rows[target].length; i++) {
      var rect = rows[target][i].el.getBoundingClientRect();
      var dist = Math.abs(rect.left + rect.width / 2 - center);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    focus(target, best);
  }

  /* ---------- Aktionen ---------- */

  function launchModule(tile) {
    var match = rx(tile.def.match);
    if (!IS_TV) return toast('(Vorschau) würde das Modul ' + tile.def.name + ' starten');
    var socket;
    var done = false;
    var tries = 0;
    function fail(text) { if (!done) { done = true; try { socket.close(); } catch (e) { /* zu */ } toast(text, 5000); } }
    try { socket = new WebSocket(TB_SOCKET); } catch (e) { return fail('TizenBrew antwortet nicht'); }
    toast(tile.def.name + ' wird geöffnet …');
    socket.onopen = function () { socket.send(JSON.stringify({ type: TB.GetModules })); };
    socket.onerror = function () { fail('TizenBrew antwortet nicht'); };
    socket.onmessage = function (event) {
      var data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (done || data.type !== TB.GetModules) return;
      if (!data.payload) {
        // TizenBrew hat seine Modulliste noch nicht geladen: erneut fragen.
        if (++tries > 12) return fail('TizenBrew hat keine Modulliste geliefert');
        return setTimeout(function () {
          if (!done) socket.send(JSON.stringify({ type: TB.GetModules, payload: tries > 2 ? true : undefined }));
        }, 600);
      }
      var mod = null;
      for (var i = 0; i < data.payload.length; i++) {
        var m = data.payload[i];
        if (match && match.test((m.fullName || '') + ' ' + (m.appName || '') + ' ' + (m.name || ''))) { mod = m; break; }
      }
      if (!mod) return fail(tile.def.name + ' ist in TizenBrew nicht installiert');
      done = true;
      socket.send(JSON.stringify({ type: TB.LaunchModule, payload: mod }));
      // Wie in TizenBrew selbst: Manche Module oeffnet TizenBrew, die anderen die Seite.
      if (!mod.evaluateScriptOnDocumentStart && mod.appPath) {
        setTimeout(function () { location.href = mod.appPath; }, 150);
      }
    };
    setTimeout(function () { fail('TizenBrew antwortet nicht'); }, 12000);
  }

  function activate(tile) {
    var def = tile.def;
    if (def.type === 'module') return launchModule(tile);
    if (def.type === 'key') {
      toast(def.name + ' …', 1500);
      return svc('POST', '/key', { key: def.key }, function (err, json) {
        if (err || !json || !json.ok) toast(def.name + ' geht nicht: ' + (err || (json && json.error) || 'Fehler'), 5000);
      });
    }
    if (!tile.ids.length) return toast(def.name + ' wurde auf diesem TV nicht gefunden. Gelbe Taste zeigt alle Apps.', 5000);
    toast(def.name + ' wird geöffnet …');
    svc('POST', '/launch', { ids: tile.ids }, function (err, json) {
      if (err) return toast(def.name + ' geht nicht: ' + err, 5000);
      if (!json.ok) toast(def.name + ' geht nicht: ' + (json.error || 'Fehler'), 5000);
    });
  }

  /* ---------- Diagnose (gelbe Taste) ---------- */

  function showDiag(on) {
    diagOpen = on;
    el('diag').style.display = on ? 'block' : 'none';
    if (!on) return;
    diagPage = 0;
    var info = 'Dienst: ' + (serviceInfo ? 'läuft (Version ' + serviceInfo.version + ', TV-Zugriff ' + (serviceInfo.tizen ? 'ja' : 'nein') + ')' : 'nicht erreichbar');
    if (serviceInfo && serviceInfo.remoteError) info += ' · Fernbedienung: ' + serviceInfo.remoteError;
    info += '<br>Apps vom TV: ' + (apps ? apps.length : 'unbekannt') + '<br>Browser: ' + esc(navigator.userAgent);
    el('diagInfo').innerHTML = info;
    renderDiag();
  }

  function renderDiag() {
    var list = (apps || []).slice().sort(function (x, y) { return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1; });
    var perPage = 30;
    var pages = Math.max(1, Math.ceil(list.length / perPage));
    diagPage = Math.max(0, Math.min(pages - 1, diagPage));
    var html = '';
    for (var i = diagPage * perPage; i < list.length && i < (diagPage + 1) * perPage; i++) {
      html += '<div>' + esc(list[i].name) + ' &nbsp;<b>' + esc(list[i].id) + '</b></div>';
    }
    el('diagList').innerHTML = html || '<div>Keine App-Liste. Der Dienst läuft nicht oder hat keinen TV-Zugriff.</div>';
    el('diagFoot').textContent = 'Seite ' + (diagPage + 1) + ' von ' + pages + ' · Hoch / Runter blättern · Zurück schließen';
  }

  /* ---------- Tasten ---------- */

  function wake() {
    var wasIdle = document.body.className === 'idle';
    document.body.className = '';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { document.body.className = 'idle'; }, IDLE_MS);
    return wasIdle;
  }

  function onKey(e) {
    var k = e.keyCode;
    // Am Rechner: Esc = Zurueck, Y = Gelb, R = Rot.
    if (k === 27 || k === 8) k = KEY.BACK;
    if (k === 89) k = KEY.YELLOW;
    if (k === 82) k = KEY.RED;
    var known = k === KEY.LEFT || k === KEY.RIGHT || k === KEY.UP || k === KEY.DOWN || k === KEY.OK || k === KEY.BACK || k === KEY.RED || k === KEY.YELLOW;
    if (!known) return;
    e.preventDefault();
    if (wake()) return; // Die erste Taste weckt nur auf.

    if (diagOpen) {
      if (k === KEY.DOWN) { diagPage++; renderDiag(); }
      else if (k === KEY.UP) { diagPage--; renderDiag(); }
      else if (k === KEY.BACK || k === KEY.YELLOW || k === KEY.OK) showDiag(false);
      return;
    }
    if (k === KEY.LEFT) focus(pos.r, pos.c - 1);
    else if (k === KEY.RIGHT) focus(pos.r, pos.c + 1);
    else if (k === KEY.UP) moveRow(-1);
    else if (k === KEY.DOWN) moveRow(1);
    else if (k === KEY.OK) { if (current()) activate(current()); }
    else if (k === KEY.YELLOW) showDiag(true);
    else if (k === KEY.RED) location.reload();
    // Zurueck macht auf dem Startbildschirm absichtlich nichts.
  }

  /* ---------- Uhr und Groesse ---------- */

  var DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  function tick() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    el('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    el('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()];
  }

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    el('stage').style.transform = 'translate(' + ((window.innerWidth - 1920 * s) / 2) + 'px,' + ((window.innerHeight - 1080 * s) / 2) + 'px) scale(' + s + ')';
  }

  /* ---------- Start ---------- */

  // Beispieldaten nur fuer die Vorschau am Rechner. Die Kennungen sind teils erfunden.
  var MOCK_APPS = [
    { id: '3201910019365', name: 'Prime Video' }, { id: '3201901017640', name: 'Disney+' },
    { id: '3201412000679', name: 'ARD Mediathek' }, { id: '3201705012365', name: 'ZDFmediathek' },
    { id: '3201503001543', name: 'ARTE' }, { id: '3201907018807', name: 'Netflix' },
    { id: '3201606009684', name: 'Spotify' }, { id: 'org.tizen.browser', name: 'Internet' },
    { id: '3201512006963', name: 'Plex' }, { id: '3201807016597', name: 'Apple TV' },
    { id: '3202203026841', name: 'Twitch' }, { id: 'com.samsung.tv.store', name: 'Apps' },
    { id: 'abcdefghij.SamsungTVPlus', name: 'Samsung TV Plus' }, { id: 'org.tizen.system-thing', name: 'Systemdienst' }
  ];

  function loadApps(attempt) {
    svc('GET', '/ping', null, function (err, info) {
      if (err) {
        // Der Dienst startet erst, wenn TizenBrew das Modul oeffnet. Kurz warten.
        if (attempt < 8) return setTimeout(function () { loadApps(attempt + 1); }, 1200);
        if (!IS_TV) { apps = MOCK_APPS; el('status').textContent = 'Vorschau am Rechner'; return applyApps(); }
        el('status').textContent = 'Dienst nicht erreichbar';
        return;
      }
      serviceInfo = info;
      el('status').textContent = '';
      svc('GET', '/apps', null, function (err2, json) {
        if (err2 || !json || !json.apps || !json.apps.length) {
          if (!apps) apps = [];
          return applyApps();
        }
        apps = json.apps;
        try { localStorage.setItem('home.apps', JSON.stringify(apps)); } catch (e) { /* kein Speicher */ }
        applyApps();
      });
    });
  }

  buildFavorites();
  // Die App-Liste vom letzten Mal sofort zeigen, damit der Start schnell ist.
  try { apps = JSON.parse(localStorage.getItem('home.apps') || 'null'); } catch (e) { apps = null; }
  applyApps();
  fit(); tick(); wake();
  window.addEventListener('resize', fit);
  document.addEventListener('keydown', onKey);
  setInterval(tick, 15000);
  loadApps(0);
})();
