/* Mitre IPTV TV — LG webOS, Samsung Tizen e Samsung antiga (Orsay).
   Escrito em JavaScript antigo (ES5) para rodar também em TVs de 2017 em diante. */
(function () {
  'use strict';

  // ---------- Atualização automática (OTA) ----------
  // O app baixa a versão nova da interface do GitHub e passa a usá-la na próxima vez que abrir.
  // Se a versão nova der erro ao abrir, volta sozinho para a versão que veio instalada.
  var APP_VER = '1.8.0';
  var OTA_BASE = 'https://mitreimoveisvictor-pixel.github.io/mitreiptv/ota/';
  function verNum(v) {
    var p = String(v || '0').split('.'), n = 0;
    for (var i = 0; i < 3; i++) n = n * 1000 + (parseInt(p[i], 10) || 0);
    return n;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }
  var OTA_OK = !window.MITRE_KEYMAP;            // Samsung antiga (Orsay): fica na versão do pendrive
  if (OTA_OK && !window.__OTA_RUN) {
    var pack = null;
    try { pack = JSON.parse(lsGet('mp_ota') || 'null'); } catch (e) { }
    if (pack && verNum(pack.v) > verNum(APP_VER)) {
      if (lsGet('mp_ota_try') === pack.v && lsGet('mp_ota_ok') !== pack.v) {
        lsDel('mp_ota');                          // a versão baixada travou na última vez: descarta
      } else {
        lsSet('mp_ota_try', pack.v);
        try {
          var sheets = document.querySelectorAll('link[rel="stylesheet"], style');
          for (var si = 0; si < sheets.length; si++) {
            var sh = sheets[si];
            if ((sh.href && /style\.css/.test(sh.href)) || (!sh.href && (sh.textContent || '').length > 5000)) sh.disabled = true;
          }
          var css = document.createElement('style');
          css.id = 'ota-css';
          css.textContent = pack.css;
          document.getElementsByTagName('head')[0].appendChild(css);
          document.body.innerHTML = pack.body;
          window.__OTA_RUN = true;
          window.__OTA_V = pack.v;
          window.onerror = function () {                // deu erro ao abrir a versão nova: volta na hora
            if (lsGet('mp_ota_ok') !== pack.v && lsGet('mp_ota')) { lsDel('mp_ota'); location.reload(); }
          };
          var js = document.createElement('script');
          js.text = pack.js;
          document.body.appendChild(js);
          return;                                  // a versão nova assumiu o app
        } catch (e) { lsDel('mp_ota'); }
      }
    }
  }
  var CUR_VER = window.__OTA_V || APP_VER;
  function otaGet(url, ok, fail) {
    var x = new XMLHttpRequest();
    try {
      x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), true);
      x.timeout = 30000;
      x.onload = function () { if (x.status === 200) ok(x.responseText); else fail(); };
      x.onerror = fail; x.ontimeout = fail;
      x.send();
    } catch (e) { fail(); }
  }
  function otaCheck() {
    if (!OTA_OK) return;
    otaGet(OTA_BASE + 'ota.json', function (t) {
      var m = null;
      try { m = JSON.parse(t); } catch (e) { return; }
      if (!m || !m.v || verNum(m.v) <= verNum(CUR_VER)) return;
      var got = {};
      var files = ['body.html', 'style.css', 'app.js'], keys = ['body', 'css', 'js'];
      (function next(i) {
        if (i >= files.length) {
          got.v = m.v;
          if (lsSet('mp_ota', JSON.stringify(got))) {
            lsDel('mp_ota_try');
            if (typeof toast === 'function') toast('Atualização ' + m.v + ' baixada · feche e abra o app para usar', 7000);
          }
          return;
        }
        otaGet(OTA_BASE + files[i] + '?v=' + m.v, function (txt) { got[keys[i]] = txt; next(i + 1); }, function () { });
      })(0);
    }, function () { });
  }

  var UA_KEYS = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: [27, 461, 10009], // Esc (PC), Voltar LG, Voltar Samsung
    PLAYPAUSE: [10252, 179, 80],
    PLAY: [415], PAUSE: [19], STOP: [413],
    FF: [417, 228], RW: [412, 227],
    CHUP: [33, 427], CHDOWN: [34, 428],
    FAV: [404, 405, 70], // verde, amarelo, F (PC)
    IME_DONE: [65376], IME_CANCEL: [65385]
  };

  var S = {
    creds: null, kind: 'live', cats: [], catIndex: 0, items: [], filtered: [], rendered: 0,
    req: null, screen: 'login', prevScreen: 'home', homeFocus: null, seriesFocus: null,
    seriesName: '', seasons: [], play: null, backTime: 0, logoutTime: 0,
    hist: [], epg: {}, hidden: {}, fav: { live: [], movie: [], series: [] }, showHidden: false, scan: null, dirty: false
  };

  var TOUCH = 'ontouchstart' in window;
  // No app Android, o vídeo é tocado pelo player nativo (mais estável). Nas TVs e no navegador, pelo <video>.
  var NATIVE = window.MitreNative || null;
  var probeSeq = 0, probeCbs = {};

  // Ajustes para canais ao vivo de IPTV: mais vídeo guardado em memória e mais tentativas antes de desistir.
  var HLS_CFG = {
    enableWorker: true,
    lowLatencyMode: false,
    liveSyncDurationCount: 4,        // assiste ~4 segmentos atrás do "ao vivo" = sobra de buffer
    liveMaxLatencyDurationCount: 14,
    maxBufferLength: 45,
    maxMaxBufferLength: 120,
    backBufferLength: 30,
    maxBufferHole: 1.5,
    highBufferWatchdogPeriod: 3,
    nudgeMaxRetry: 10,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1000,
    levelLoadingMaxRetry: 8,
    levelLoadingRetryDelay: 1000,
    fragLoadingMaxRetry: 10,
    fragLoadingRetryDelay: 800,
    startFragPrefetch: true,
    abrEwmaDefaultEstimate: 4000000
  };
  var FAV_ID = '__fav';
  var stallTimer = null;
  var cur = null; // elemento com foco do controle
  var hls = null;
  var osdTimer = null, toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function has(arr, k) { return arr.indexOf(k) >= 0; }
  function enc(s) { return encodeURIComponent(s); }

  // ---------- Registro das teclas do controle da Samsung ----------
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward',
        'MediaRewind', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) { }
      });
    }
  } catch (e) { }

  // ---------- Armazenamento ----------
  function saveCreds(c) { try { localStorage.setItem('mp_creds', JSON.stringify(c)); } catch (e) { } }
  function loadCreds() {
    try { var c = JSON.parse(localStorage.getItem('mp_creds') || 'null'); return c && c.server ? c : null; }
    catch (e) { return null; }
  }
  function loadHidden() {
    try { return JSON.parse(localStorage.getItem('mp_hidden') || '{}') || {}; } catch (e) { return {}; }
  }
  function saveHidden() { try { localStorage.setItem('mp_hidden', JSON.stringify(S.hidden)); } catch (e) { } }
  function hiddenCount() { var n = 0; for (var k in S.hidden) if (S.hidden.hasOwnProperty(k)) n++; return n; }
  // Favoritos: { live: [...], movie: [...], series: [...] } com os dados do item
  function loadFav() {
    try { var f = JSON.parse(localStorage.getItem('mp_fav') || '{}') || {}; } catch (e) { f = {}; }
    ['live', 'movie', 'series'].forEach(function (k) { if (!(f[k] instanceof Array)) f[k] = []; });
    return f;
  }
  function saveFav() { try { localStorage.setItem('mp_fav', JSON.stringify(S.fav)); } catch (e) { } }
  function favIndex(kind, id) {
    var a = S.fav[kind];
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return i;
    return -1;
  }
  function isFav(kind, id) { return favIndex(kind, id) >= 0; }
  function toggleFav(kind, it) {
    if (!it) return;
    var i = favIndex(kind, it.id);
    if (i >= 0) { S.fav[kind].splice(i, 1); toast('Removido dos favoritos: ' + it.name, 2500); }
    else { S.fav[kind].push({ id: it.id, name: it.name, icon: it.icon || '', ext: it.ext || '' }); toast('\u2605 Adicionado aos favoritos: ' + it.name, 2500); }
    saveFav();
    if (S.screen === 'home') refreshFavMarks();
  }
  function refreshFavMarks() {
    if (S.cats[S.catIndex] && S.cats[S.catIndex].id === FAV_ID) {
      var keep = cur && /\bcard\b/.test(cur.className) ? +cur.getAttribute('data-i') : -1;
      loadItems(FAV_ID);
      var cards = $('grid').children;
      if (keep >= 0 && cards.length) setFocus(cards[Math.min(keep, cards.length - 1)]);
      else if (!cards.length) setFocus($('cats').children[S.catIndex]);
      return;
    }
    var cs = $('grid').children;
    for (var j = 0; j < cs.length; j++) {
      var it = S.filtered[+cs[j].getAttribute('data-i')];
      if (it) markCard(cs[j], isFav(S.kind, it.id));
    }
  }
  function markCard(d, on) {
    var st = d.querySelector('.star');
    if (on && !st) { st = document.createElement('span'); st.className = 'star'; st.textContent = '\u2605'; d.appendChild(st); }
    else if (!on && st) d.removeChild(st);
  }

  function clearCreds() { try { localStorage.removeItem('mp_creds'); } catch (e) { } }

  // ---------- API Xtream Codes ----------
  // As listas (canais, filmes, séries) vêm por HTTPS quando o servidor aceita: no 4G/5G a operadora
  // às vezes atrapalha respostas grandes em HTTP. Os vídeos continuam pelo endereço original.
  var API_HTTPS = (function () { try { return localStorage.getItem('mp_api_http') !== '1'; } catch (e) { return true; } })();
  function base() {
    var c = S.creds, srv = c.server;
    if (API_HTTPS && /^http:\/\//i.test(srv)) srv = 'https://' + srv.slice(7);
    return srv + '/player_api.php?username=' + enc(c.user) + '&password=' + enc(c.pass);
  }
  function httpsFailed(url) {
    if (!API_HTTPS || !/^https:/i.test(url) || !/^http:/i.test(S.creds.server)) return null;
    API_HTTPS = false;
    try { localStorage.setItem('mp_api_http', '1'); } catch (e) { }
    return 'http://' + url.slice(8);
  }

  function getJSON(url, ok, fail, progress) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 45000;
    if (progress) x.onprogress = function (e) { progress(e.loaded || 0); };
    x.onload = function () {
      if (x.status === 200) {
        var data;
        try { data = JSON.parse(x.responseText); } catch (e) { fail('Resposta inválida do servidor'); return; }
        ok(data);
      } else {
        fail('Servidor respondeu código ' + x.status);
      }
    };
    x.onerror = function () { fail('Sem conexão com o servidor'); };
    x.ontimeout = function () { fail('O servidor demorou para responder'); };
    x.send();
    return x;
  }


  // ---------- Servidor automático (lista no GitHub) ----------
  // O app lê a lista de endereços do painel em servidores.json. Se um endereço cair, tenta o próximo
  // sozinho; quando o endereço mudar, basta editar o arquivo no GitHub.
  var SRV_URL = 'https://raw.githubusercontent.com/mitreimoveisvictor-pixel/mitreiptv/main/servidores.json';
  var SRV_DEFAULT = ['http://frances.lat'];
  function origin(u) { var m = String(u || '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].toLowerCase() : ''; }
  function srvList() {
    var l = null;
    try { l = JSON.parse(localStorage.getItem('mp_srvs') || 'null'); } catch (e) { }
    return l && l.length ? l : SRV_DEFAULT;
  }
  function fetchSrvList() {
    var x = new XMLHttpRequest();
    try {
      x.open('GET', SRV_URL + '?t=' + Math.floor(Date.now() / 600000), true);
      x.timeout = 15000;
      x.onload = function () {
        if (x.status !== 200) return;
        try {
          var o = JSON.parse(x.responseText), l = (o && (o.servidores || o.servers)) || o;
          if (l && l.length) {
            var ok = [];
            for (var i = 0; i < l.length; i++) if (/^https?:\/\/[^\s]+$/i.test(String(l[i]).trim())) ok.push(String(l[i]).trim().replace(/\/+$/, ''));
            if (ok.length) localStorage.setItem('mp_srvs', JSON.stringify(ok));
          }
        } catch (e) { }
      };
      x.send();
    } catch (e) { }
  }
  // Troca para o próximo endereço da lista (só se o login atual for de um endereço da lista)
  var SRV_TRIED = {};
  function nextServer() {
    var l = srvList(), cur = origin(S.creds && S.creds.server), inList = false;
    for (var i = 0; i < l.length; i++) if (origin(l[i]) === cur) inList = true;
    if (!inList) return null;
    SRV_TRIED[cur] = 1;
    for (var j = 0; j < l.length; j++) if (!SRV_TRIED[origin(l[j])]) return l[j];
    return null;
  }
  function switchServer(url) {
    if (!/player_api\.php/.test(url)) return null;
    var n = nextServer();
    if (!n) return null;
    var oldHost = origin(S.creds.server);
    S.creds.server = n;
    if (S.creds.stream && origin(S.creds.stream) === oldHost) S.creds.stream = null;
    try { if (localStorage.getItem('mp_creds')) saveCreds(S.creds); } catch (e) { }
    API_HTTPS = (function () { try { return localStorage.getItem('mp_api_http') !== '1'; } catch (e) { return true; } })();
    toast('Servidor principal fora do ar · usando reserva', 4000);
    return url.replace(/^https?:\/\/[^\/?#]+/i, (API_HTTPS ? n.replace(/^http:/i, 'https:') : n));
  }

  // Guarda as respostas do servidor por 15 min: abrir de novo uma categoria é instantâneo
  var CACHE = {};
  function getCached(url, ok, fail, progress) {
    var c = CACHE[url];
    if (c && Date.now() - c.at < 900000) { setTimeout(function () { ok(c.data); }, 0); return null; }
    return getJSON(url, function (d) { CACHE[url] = { at: Date.now(), data: d }; ok(d); }, function (err) {
      var alt = httpsFailed(url);           // HTTPS não funcionou neste servidor: volta para HTTP
      var done = function (d) { CACHE[url] = { at: Date.now(), data: d }; ok(d); };
      var tryNext = function (e2, u2) {
        var nu = switchServer(u2);              // endereço fora do ar: tenta o próximo da lista
        if (nu) { S.req = getJSON(nu, done, function (e3) { tryNext(e3, nu); }, progress); return; }
        fail(e2);
      };
      if (alt) { S.req = getJSON(alt, done, function (e2) { tryNext(e2, alt); }, progress); return; }
      tryNext(err, url);
    }, progress);
  }
  // Na tela inicial, já baixa as listas de categorias (são pequenas)
  function prefetchCats() {
    if (!S.creds) return;
    var acts = ['get_live_categories', 'get_vod_categories', 'get_series_categories'];
    (function next() {
      var a = acts.shift();
      if (!a) return;
      getCached(base() + '&action=' + a, next, next);
    })();
  }

  function abortReq() { if (S.req) { try { S.req.abort(); } catch (e) { } S.req = null; } }

  function param(url, name) {
    var m = url.match(new RegExp('[?&]' + name + '=([^&#]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function parseInput(s, u, p) {
    s = (s || '').trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    var m = s.match(/^(https?:\/\/[^\/?#]+)/i);
    if (!m) return null;
    u = param(s, 'username') || (u || '').trim();
    p = param(s, 'password') || (p || '').trim();
    if (!u || !p) return null;
    var server = m[1];
    // Versão web aberta em site seguro (https): o navegador só aceita servidor https.
    if (location.protocol === 'https:') server = server.replace(/^http:/i, 'https:');
    return { server: server, user: u, pass: p };
  }

  function str(o, k) {
    if (!o || o[k] === null || o[k] === undefined) return null;
    var v = String(o[k]).trim();
    return v ? v : null;
  }

  // Servidor de vídeo informado pelo próprio painel (server_info). O endereço do login muitas vezes
  // passa pela Cloudflare, que bloqueia vídeo; o servidor de vídeo entrega direto.
  function streamServer() { return (S.creds && S.creds.stream) || S.creds.server; }
  function readStream(o) {
    var si = o && o.server_info;
    if (!si || !si.url) return null;
    var https = si.server_protocol === 'https';
    var port = String((https ? si.https_port : si.port) || '');
    var host = String(si.url).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!host) return null;
    return (https ? 'https://' : 'http://') + host + (port && port !== (https ? '443' : '80') && host.indexOf(':') < 0 ? ':' + port : '');
  }
  function refreshStream() {
    if (!S.creds) return;
    getCached(base() + '&t=' + Date.now(), function (o) {
      var st = readStream(o);
      if (st && S.creds && st !== S.creds.stream) { S.creds.stream = st; saveCreds(S.creds); }
    }, function () { });
  }
  function liveUrls(id) {
    var c = S.creds, tail = '/live/' + c.user + '/' + c.pass + '/' + id;
    var out = [streamServer() + tail + '.m3u8', streamServer() + tail + '.ts'];
    if (streamServer() !== c.server) out.push(c.server + tail + '.m3u8');
    return out;
  }
  // Filmes e episódios: pelo endereço seguro (HTTPS) o servidor manda direto para o servidor de vídeo,
  // sem passar pelo bloqueio da Cloudflare. O endereço comum fica de reserva.
  function vodUrls(path) {
    var srv = S.creds.server, out = [];
    if (streamServer() !== srv) out.push(streamServer() + path);
    if (/^http:\/\//i.test(srv)) out.push('https://' + srv.slice(7) + path);
    out.push(srv + path);
    return out;
  }
  function movieUrls(it) {
    if (it.url) return [it.url];
    var c = S.creds;
    return vodUrls('/movie/' + c.user + '/' + c.pass + '/' + it.id + '.' + (it.ext || 'mp4'));
  }
  function episodeUrls(ep) {
    var c = S.creds;
    return vodUrls('/series/' + c.user + '/' + c.pass + '/' + ep.id + '.' + (ep.ext || 'mp4'));
  }

  // ---------- Telas e foco ----------
  function show(name) {
    ['login', 'start', 'home', 'series', 'player'].forEach(function (n) {
      $(n).className = 'screen' + (n === name ? '' : ' hidden');
    });
    S.screen = name;
    if (name !== 'home') stopPreview();
  }

  function focusables() {
    var scr = $(S.screen);
    var all = scr.querySelectorAll('.f');
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) out.push(all[i]);
    return out;
  }

  function setFocus(el) {
    if (!el) return;
    if (cur && cur !== el) cur.className = cur.className.replace(/\s?focus\b/g, '');
    cur = el;
    if (!/\bfocus\b/.test(el.className)) el.className += ' focus';
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && ae !== el) ae.blur();
    ensureVisible(el);
    if (/\bcard\b/.test(el.className)) {
      var i = +el.getAttribute('data-i');
      if (i >= S.rendered - 18) renderMore();
      if (S.kind === 'live' && S.screen === 'home' && !S.showHidden) previewFor(S.filtered[i], i);
    }
  }

  function scrollParent(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      var oy = window.getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 2) return p;
      p = p.parentNode;
    }
    return null;
  }

  function ensureVisible(el) {
    var p = scrollParent(el);
    if (!p) return;
    var er = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (er.top < pr.top) p.scrollTop -= (pr.top - er.top) + 20;
    else if (er.bottom > pr.bottom) p.scrollTop += (er.bottom - pr.bottom) + 20;
  }

  // Navegação pelas setas: escolhe o item mais próximo na direção apertada.
  function move(dir) {
    var list = focusables();
    if (!list.length) return;
    if (!cur || list.indexOf(cur) < 0) { setFocus(list[0]); return; }
    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var best = null, bestD = 1e12;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === cur) continue;
      var q = e.getBoundingClientRect();
      var ok = dir === 'left' ? q.right <= r.left + 2 :
        dir === 'right' ? q.left >= r.right - 2 :
          dir === 'up' ? q.bottom <= r.top + 2 : q.top >= r.bottom - 2;
      if (!ok) continue;
      var dx = (q.left + q.width / 2) - cx, dy = (q.top + q.height / 2) - cy;
      var horiz = dir === 'left' || dir === 'right';
      var d = horiz ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 3;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) setFocus(best);
  }

  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.className = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'hidden'; }, ms || 3000);
  }

  function exitApp() {
    stopPreview();
    if (NATIVE) { try { NATIVE.exit(); } catch (e0) { } return; }
    if (window.MITRE_EXIT) { try { window.MITRE_EXIT(); return; } catch (e1) { } }
    try {
      if (window.tizen && tizen.application) { tizen.application.getCurrentApplication().exit(); return; }
    } catch (e) { }
    try { window.close(); } catch (e2) { }
    setTimeout(function () { toast('Para fechar, use o X da janela. Sua conta continua conectada.', 4000); }, 300);
  }

  // ---------- Login ----------
  function doLogin() {
    var sv = $('lServer').value.trim();
    if (!sv && $('lUser').value.trim() && $('lPass').value.trim()) sv = srvList()[0];   // servidor vazio: usa o da lista
    var c = parseInput(sv, $('lUser').value, $('lPass').value);
    var st = $('lStatus');
    st.className = 'status err';
    if (!c) { st.textContent = 'Preencha servidor, usuário e senha (ou cole o link da Lista M3U no primeiro campo).'; return; }
    st.textContent = 'Conectando...';
    st.className = 'status busy';
    S.creds = c;
    getCached(base() + '&t=' + Date.now(), function (o) {
      st.className = 'status err';
      var ui = o && o.user_info;
      if (!ui) { st.textContent = 'Resposta inválida do servidor'; return; }
      if (+ui.auth !== 1) { st.textContent = 'Usuário ou senha incorretos'; return; }
      var vsrv = readStream(o);
      if (vsrv) c.stream = vsrv;
      saveCreds(c);
      var exp = +ui.exp_date;
      if (exp) {
        var d = new Date(exp * 1000);
        toast('Conectado · válido até ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
          ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), 5000);
      } else toast('Conectado');
      openHome();
    }, function (err) {
      st.className = 'status err';
      st.textContent = 'Não conectou: ' + err +
        (location.protocol === 'https:' ? '. Este servidor pode não aceitar conexão segura (https) ou bloquear acesso pelo navegador.' : '');
    });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // ---------- Tela principal ----------
  // ---------- Tela inicial: Canais / Filmes / Séries ----------
  function lastCats() {
    var l = null;
    try { l = JSON.parse(localStorage.getItem('mp_last') || 'null'); } catch (e) { }
    return l && typeof l === 'object' && !l.kind ? l : {};
  }
  function openHome() {
    abortReq();
    stopPreview();
    if (cur) cur.className = cur.className.replace(/\s?focus\b/g, '');
    cur = null;
    show('start');
    if (!$('startLogo').getAttribute('src')) { var bi = document.querySelector('.brandimg'); if (bi) $('startLogo').src = bi.src; }
    var ch = null;
    try { ch = JSON.parse(localStorage.getItem('mp_lastch') || 'null'); } catch (e) { }
    S.lastCh = ch && ch.id ? ch : null;
    var cw = loadCW()[0] || null;
    S.lastVod = cw && (!S.lastCh || (cw.at || 0) > (S.lastCh.at || 0)) ? cw : null;
    $('contBtn').className = 'f cont' + (S.lastCh || S.lastVod ? '' : ' hidden');
    $('contName').textContent = S.lastVod ? S.lastVod.name + ' (' + fmtMin(S.lastVod.pos) + ')' : (S.lastCh ? S.lastCh.name : '');
    showCounts();
    setTimeout(prefetchCats, 300);
    setTimeout(refreshStream, 100);
    var k = S.kind || 'live', bigs = document.querySelectorAll('.big');
    for (var i = 0; i < bigs.length; i++) if (bigs[i].getAttribute('data-go') === k) setFocus(bigs[i]);
  }
  // Quantidade de canais/filmes/séries (guardada por 12 h para não pesar)
  function fmtN(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function loadCounts() { try { return JSON.parse(localStorage.getItem('mp_counts') || '{}') || {}; } catch (e) { return {}; } }
  function showCounts() {
    var c = loadCounts();
    var lbl = { live: ['Ao vivo', ' canais'], movie: ['', ' filmes'], series: ['', ' séries'] };
    ['live', 'movie', 'series'].forEach(function (k) {
      var el = $('cnt-' + k);
      if (c[k] && c[k].n) el.textContent = (lbl[k][0] ? lbl[k][0] + ' · ' : '') + fmtN(c[k].n) + lbl[k][1];
    });
  }
  function openKind(kind, cat) {
    if (cur) cur.className = cur.className.replace(/\s?focus\b/g, '');
    cur = null;
    S.hist = [];
    show('home');
    $('homeTitle').textContent = { live: 'Canais', movie: 'Filmes', series: 'Séries' }[kind];
    var lc = lastCats();
    loadKind(kind, cat !== undefined ? cat : (lc[kind] !== undefined ? lc[kind] : null));
  }

  function msg(t) { $('msg').textContent = t || ''; }

  function loadKind(kind, wantCat) {
    stopPreview();
    S.kind = kind;
    $('main').className = kind === 'live' ? 'live' : '';
    $('preview').className = 'empty';
    S.showHidden = false;
    var tabs = document.querySelectorAll('.tab[data-kind]');
    for (var i = 0; i < tabs.length; i++) {
      var sel = tabs[i].getAttribute('data-kind') === kind;
      tabs[i].className = tabs[i].className.replace(/\s?sel\b/g, '') + (sel ? ' sel' : '');
      if (sel && !cur) setFocus(tabs[i]);
    }
    abortReq();
    $('cats').innerHTML = '';
    $('search').value = '';
    S.items = []; S.filtered = []; S.rendered = 0;
    $('grid').innerHTML = '';
    msg('Carregando...');
    var action = { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' }[kind];
    S.req = getCached(base() + '&action=' + action, function (arr) {
      S.cats = [{ id: FAV_ID, name: '\u2605 Favoritos' }, { id: '', name: 'Todos' }];
      if (kind !== 'live') S.cats.splice(1, 0, { id: CW_ID, name: '\u25B6 Continuar assistindo' });
      if (kind === 'movie') S.cats.splice(2, 0, { id: FAM_ID, name: '\uD83C\uDFAC Filmes da Fam\u00EDlia' });
      if (arr && arr.length) {
        for (var i = 0; i < arr.length; i++) {
          var id = str(arr[i], 'category_id');
          if (id) S.cats.push({ id: id, name: str(arr[i], 'category_name') || 'Sem nome' });
        }
      }
      renderCats();
      var hasCW = kind !== 'live' && loadCW().some(function (x) { return x.kind === kind; });
      var first = kind === 'live' ? 2 : (kind === 'movie' ? 4 : 3);
      var pick = hasCW ? 1 : (S.fav[kind].length ? 0 : (S.cats.length > first ? first : first - 1));
      if (wantCat !== null && wantCat !== undefined) {
        for (var w = 0; w < S.cats.length; w++) if (S.cats[w].id === wantCat) { pick = w; break; }
      }
      selectCat(pick);
    }, function (err) { msg('Erro ao carregar: ' + err); });
  }

  function renderCats() {
    var box = $('cats'), frag = document.createDocumentFragment();
    box.innerHTML = '';
    for (var i = 0; i < S.cats.length; i++) {
      var d = document.createElement('div');
      d.className = 'f cat' + (S.cats[i].id === CW_ID ? ' cw' : '');
      d.setAttribute('data-i', i);
      d.textContent = S.cats[i].name;
      frag.appendChild(d);
    }
    box.appendChild(frag);
  }

  function selectCat(i) {
    S.catIndex = i;
    try { var lc = lastCats(); lc[S.kind] = S.cats[i].id; localStorage.setItem('mp_last', JSON.stringify(lc)); } catch (e) { }
    var all = $('cats').children;
    for (var j = 0; j < all.length; j++) {
      all[j].className = all[j].className.replace(/\s?sel\b/g, '') + (j === i ? ' sel' : '');
    }
    loadItems(S.cats[i].id);
  }

  // ---------- Voltar para a etapa anterior ----------
  function pushHist() {
    if (!S.cats[S.catIndex]) return;
    S.hist.push({ kind: S.kind, cat: S.cats[S.catIndex].id });
    if (S.hist.length > 30) S.hist.shift();
  }
  function goBack() {
    var st = S.hist.pop();
    if (!st) { openHome(); return false; }
    if (st.kind !== S.kind) { loadKind(st.kind, st.cat); }
    else {
      for (var i = 0; i < S.cats.length; i++) if (S.cats[i].id === st.cat) { selectCat(i); setFocus($('cats').children[i]); break; }
    }
    return true;
  }

  function loadItems(catId) {
    abortReq();
    S.items = []; S.filtered = []; S.rendered = 0;
    $('grid').innerHTML = '';
    if (catId === CW_ID) {
      S.items = loadCW().filter(function (x) { return x.kind === S.kind; }).map(function (x) {
        return { id: x.key, name: x.name, icon: x.icon, cw: x, pct: x.dur ? Math.min(100, Math.round(x.pos / x.dur * 100)) : 0 };
      });
      filter();
      if (!S.items.length) msg('Nada para continuar ainda. Os filmes e episódios que você começar a ver aparecem aqui.');
      return;
    }
    if (catId === FAM_ID) {
      msg('Carregando Filmes da Família...');
      S.req = loadFamily(function (arr, err) {
        if (!S.cats[S.catIndex] || S.cats[S.catIndex].id !== FAM_ID) return;
        if (!arr) { msg('Não foi possível carregar os Filmes da Família (' + err + '). Toque na categoria para tentar de novo.'); return; }
        S.items = arr;
        try { filter(); } catch (e) { msg('Erro ao mostrar a lista: ' + e.message); }
        if (!S.items.length) msg('Ainda não há filmes da família.');
      });
      return;
    }
    if (catId === FAV_ID) {
      S.items = S.fav[S.kind].slice();
      filter();
      if (!S.items.length) msg('Nenhum favorito ainda. Na lista, segure OK (ou toque e segure) num item para favoritar.');
      return;
    }
    msg('Carregando...');
    $('toolsInfo').textContent = '';
    var kind = S.kind;
    var action = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' }[kind];
    var url = base() + '&action=' + action + (catId ? '&category_id=' + enc(catId) : '');
    var myCat = catId, step = 0;
    // Filmes/séries: se a categoria não responder, busca a lista completa uma vez e separa aqui no app
    var fullUrl = base() + '&action=' + action;
    function use(arr, fromFull) {
      if (S.kind !== kind || !S.cats[S.catIndex] || S.cats[S.catIndex].id !== myCat) return;
      var out = [];
      if (arr && arr.length) {
        for (var i = 0; i < arr.length; i++) {
          var o = arr[i];
          if (fromFull && myCat && str(o, 'category_id') !== myCat) continue;
          var id = kind === 'series' ? str(o, 'series_id') : str(o, 'stream_id');
          if (!id) continue;
          out.push({
            id: id,
            name: str(o, 'name') || 'Sem nome',
            icon: kind === 'series' ? str(o, 'cover') : str(o, 'stream_icon'),
            ext: str(o, 'container_extension')
          });
        }
      }
      S.items = out;
      try { filter(); } catch (e) { msg('Erro ao mostrar a lista: ' + e.message); }
    }
    function go() {
      var u = step < 2 ? url : fullUrl;
      S.req = getCached(u, function (arr) { use(arr, step >= 2); }, function (err) {
        step++;
        if (step === 2 && (!catId || kind === 'live')) step = 3;
        if (step <= 2) { go(); return; }
        msg('Não foi possível carregar: ' + err + '. Toque na categoria para tentar de novo.');
      });
    }
    go();
  }

  function filter() {
    var q = $('search').value.trim().toLowerCase();
    var live = S.kind === 'live';
    S.filtered = S.items.filter(function (it) {
      if (live) {
        var hid = S.hidden.hasOwnProperty(it.id);
        if (S.showHidden ? !hid : hid) return false;
      }
      return !q || it.name.toLowerCase().indexOf(q) >= 0;
    });
    updateTools();
    S.rendered = 0;
    $('grid').innerHTML = '';
    $('grid').scrollTop = 0;
    if (!S.filtered.length) {
      msg(S.showHidden ? 'Nenhum canal oculto nesta categoria' : (S.items.length ? 'Nada encontrado' : 'Nenhum item nesta categoria'));
      if (S.screen === 'home' && (!cur || !$('home').contains(cur)) && $('cats').children[S.catIndex]) setFocus($('cats').children[S.catIndex]);
      return;
    }
    msg('');
    renderMore();
    if (S.screen === 'home' && (!cur || !$('home').contains(cur) || cur.offsetParent === null) && !TOUCH) setFocus($('grid').firstChild);
    else if (S.kind === 'live' && !S.showHidden && S.screen === 'home') previewFor(S.filtered[0], 0, true);
  }

  function updateTools() {
    var live = S.kind === 'live';
    $('tools').className = live ? '' : 'hidden';
    var n = hiddenCount();
    $('btnScan').className = 'f tool' + (S.showHidden ? ' hidden' : '');
    $('btnHidden').textContent = S.showHidden ? '← Voltar aos canais' : 'Ocultos (' + n + ')';
    $('toolsInfo').textContent = S.showHidden ? 'Clique num canal para mostrar de novo' :
      (S.items.length ? S.filtered.length + ' canais' : '');
  }

  // ---------- Teste automático de canais ----------
  function probe(urls, done) {
    if (NATIVE) {
      var reqId = 'p' + (++probeSeq), cancelled = false;
      probeCbs[reqId] = function (ok) { delete probeCbs[reqId]; if (!cancelled) done(ok); };
      var nu = urls.slice(); // .m3u8 primeiro, igual ao player
      NATIVE.probe(reqId, JSON.stringify(nu));
      return function () { cancelled = true; delete probeCbs[reqId]; try { NATIVE.cancelProbe(); } catch (e) { } };
    }
    var v = $('probe'), h = null, finished = false, timer = null, idx = 0;
    function cleanup() {
      clearTimeout(timer);
      if (h) { try { h.destroy(); } catch (e) { } h = null; }
      v.onloadeddata = null; v.onerror = null;
      try { v.pause(); } catch (e) { }
      v.removeAttribute('src');
      try { v.load(); } catch (e2) { }
    }
    function end(ok) {
      if (finished) return;
      cleanup();
      if (!ok && idx + 1 < urls.length) { idx++; start(); return; }
      finished = true;
      setTimeout(function () { done(ok); }, 400); // dá tempo de liberar a conexão
    }
    function start() {
      var u = urls[idx];
      timer = setTimeout(function () { end(false); }, 12000);
      v.onloadeddata = function () { end(true); };
      v.onerror = function () { if (!h) end(false); };
      var native = !!(v.canPlayType && v.canPlayType('application/vnd.apple.mpegurl'));
      if (/\.m3u8(\?|$)/.test(u) && window.Hls && window.Hls.isSupported()) {
        h = new window.Hls(HLS_CFG);
        h.on(window.Hls.Events.ERROR, function (ev, data) { if (data && data.fatal) end(false); });
        h.loadSource(u);
        h.attachMedia(v);
      } else {
        v.src = u;
      }
      v.muted = true;
      try { var pr = v.play(); if (pr && pr['catch']) pr['catch'](function () { }); } catch (e) { }
    }
    start();
    return function cancel() { finished = true; cleanup(); };
  }

  function startScan() {
    if (S.scan || S.kind !== 'live' || !S.filtered.length) return;
    var list = S.filtered.slice();
    stopPreview();
    S.scan = { list: list, i: 0, bad: [], cancel: null, stop: false };
    $('scan').className = '';
    setFocus($('scanStop'));
    nextScan();
  }

  function scanText() {
    var sc = S.scan;
    $('scanTitle').textContent = 'Testando canais... ' + Math.min(sc.i + 1, sc.list.length) + ' de ' + sc.list.length;
    $('scanName').textContent = sc.i < sc.list.length ? sc.list[sc.i].name : '';
    $('scanBad').textContent = sc.bad.length + ' com erro até agora';
    $('scanFill').style.width = Math.round(sc.i / sc.list.length * 100) + '%';
  }

  function nextScan() {
    var sc = S.scan;
    if (!sc) return;
    if (sc.stop || sc.i >= sc.list.length) { finishScan(); return; }
    scanText();
    var it = sc.list[sc.i];
    sc.cancel = probe(liveUrls(it.id), function (ok) {
      if (!S.scan || sc.stop) { finishScan(); return; }
      if (!ok) sc.bad.push(it);
      sc.i++;
      nextScan();
    });
  }

  function finishScan() {
    var sc = S.scan;
    if (!sc) return;
    if (sc.cancel) sc.cancel();
    S.scan = null;
    sc.bad.forEach(function (it) { S.hidden[it.id] = it.name; });
    saveHidden();
    $('scan').className = 'hidden';
    var tested = sc.i;
    filter();
    move('down');
    toast(tested + ' canais testados · ' + (sc.bad.length ? sc.bad.length + ' com erro foram ocultados' : 'nenhum com erro'), 6000);
  }

  function toggleHidden() {
    S.showHidden = !S.showHidden;
    filter();
  }

  function unhide(it) {
    delete S.hidden[it.id];
    saveHidden();
    toast('"' + it.name + '" voltou para a lista', 3000);
    filter();
    if (!S.filtered.length) { S.showHidden = false; filter(); }
  }

  function hideCurrent(message) {
    var p = S.play;
    if (!p || !p.live) return;
    var it = p.list[p.index];
    S.hidden[it.id] = it.name;
    saveHidden();
    S.dirty = true;
    p.list.splice(p.index, 1);
    toast(typeof message === 'string' ? message : '"' + it.name + '" foi ocultado', 5000);
    // Ocultado automático volta para a lista, para não ocultar vários seguidos se a internet cair.
    if (!p.list.length || typeof message === 'string') { leavePlayer(); return; }
    p.index = p.index % p.list.length;
    loadPlay();
  }

  function renderMore() {
    var end = Math.min(S.rendered + (S.kind === 'live' ? 60 : 36), S.filtered.length);
    if (end <= S.rendered) return;
    var frag = document.createDocumentFragment();
    for (var i = S.rendered; i < end; i++) {
      var it = S.filtered[i];
      var d = document.createElement('div');
      d.className = 'f card' + (S.kind === 'live' ? ' row' : ' poster');
      d.setAttribute('data-i', i);
      var img = document.createElement('div');
      img.className = 'img';
      if (it.icon) img.style.backgroundImage = 'url("' + it.icon.replace(/"/g, '%22') + '")';
      var nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = it.name;
      if (S.kind === 'live') {
        var num = document.createElement('span');
        num.className = 'num';
        num.textContent = pad(i + 1);
        d.appendChild(num);
        if (!it.icon) { img.className = 'img ini'; img.textContent = initials(it.name); img.style.backgroundColor = colorFor(it.name); }
        var txt = document.createElement('div');
        txt.className = 'txt';
        var sm = document.createElement('div');
        sm.className = 'prog';
        sm.textContent = S.epg[it.id] && S.epg[it.id].now ? S.epg[it.id].now.title : '';
        txt.appendChild(nm);
        txt.appendChild(sm);
        d.appendChild(img);
        d.appendChild(txt);
      } else {
        d.appendChild(img);
        d.appendChild(nm);
        if (it.cw) {
          var pb = document.createElement('div'); pb.className = 'cwbar';
          var pf = document.createElement('i'); pf.style.width = (it.pct || 2) + '%';
          pb.appendChild(pf); d.appendChild(pb);
        }
      }
      if (isFav(S.kind, it.id)) markCard(d, true);
      frag.appendChild(d);
    }
    $('grid').appendChild(frag);
    S.rendered = end;
  }

  // ---------- Continuar assistindo (filmes e séries) ----------
  var CW_ID = '__cw';
  // ---------- Filmes da Família (lista própria no GitHub, aparece em Filmes) ----------
  var FAM_ID = '__fam';
  var FAM_URL = 'https://raw.githubusercontent.com/mitreimoveisvictor-pixel/mitre-familia/main/familia.m3u';
  function parseM3U(t) {
    var out = [], lines = String(t || '').split(/\r?\n/), name = '', icon = '';
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      if (l.indexOf('#EXTINF') === 0) {
        var c = l.lastIndexOf(','); name = c >= 0 ? l.slice(c + 1).trim() : 'Sem nome';
        var m = l.match(/tvg-logo="([^"]*)"/); icon = m ? m[1] : '';
      } else if (l.charAt(0) !== '#') {
        out.push({ id: 'fam' + out.length, name: name || ('Vídeo ' + (out.length + 1)), icon: icon, url: l, ext: 'mp4' });
        name = ''; icon = '';
      }
    }
    return out;
  }
  function loadFamily(done) {
    var x = new XMLHttpRequest();
    x.open('GET', FAM_URL + '?t=' + Date.now(), true);
    x.timeout = 30000;
    x.onload = function () { done(x.status === 200 ? parseM3U(x.responseText) : null, 'código ' + x.status); };
    x.onerror = function () { done(null, 'sem conexão'); };
    x.ontimeout = function () { done(null, 'demorou para responder'); };
    x.send();
    return x;
  }
  function loadCW() { try { var a = JSON.parse(localStorage.getItem('mp_cw') || '[]'); return a instanceof Array ? a : []; } catch (e) { return []; } }
  function saveCW(a) { try { localStorage.setItem('mp_cw', JSON.stringify(a.slice(0, 30))); } catch (e) { } }
  function cwFind(key) { var a = loadCW(); for (var i = 0; i < a.length; i++) if (a[i].key === key) return a[i]; return null; }
  // guarda onde parou (em segundos); some da lista quando termina
  function cwSave(vod, pos, dur) {
    if (!vod || !(pos >= 0)) return;
    var a = loadCW().filter(function (x) { return x.key !== vod.key; });
    var done = dur > 0 && pos / dur > 0.95;
    if (!done && pos >= 20) {
      var e = {}; for (var k in vod) if (vod.hasOwnProperty(k)) e[k] = vod[k];
      e.pos = Math.floor(pos); e.dur = Math.floor(dur || 0); e.at = Date.now();
      a.unshift(e);
    }
    saveCW(a);
    if (S.screen === 'home' && S.cats[S.catIndex] && S.cats[S.catIndex].id === CW_ID) loadItems(CW_ID);
  }
  function vodMovie(it) { var v = { key: 'm' + it.id, kind: 'movie', id: it.id, name: it.name, icon: it.icon || '', ext: it.ext || '' }; if (it.url) v.url = it.url; return v; }
  function vodEpisode(ep) {
    return { key: 's' + ep.id, kind: 'series', id: ep.id, name: S.seriesName + ' · T' + ep.season + ' ' + ep.title, icon: S.seriesIcon || '', ext: ep.ext || 'mp4', seriesId: S.seriesId };
  }
  function playVod(vod) {
    var saved = cwFind(vod.key);
    var start = saved && saved.pos ? saved.pos : 0;
    var urls = vod.kind === 'movie' ? movieUrls(vod) : episodeUrls(vod);
    if (start) toast('Continuando de onde parou (' + fmtMin(start) + ')', 3000);
    startPlay({ live: false, title: vod.name, urls: urls, vod: vod, start: start });
  }
  function fmtMin(sec) { var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s2 = Math.floor(sec % 60); return (h ? h + ':' + pad(m) : m) + ':' + pad(s2); }

  function openItem(i) {
    var it = S.filtered[i];
    if (!it) return;
    S.homeFocus = cur;
    if (S.kind === 'live' && S.showHidden) { unhide(it); return; }
    if (S.kind === 'live') {
      startPlay({ live: true, list: S.filtered.slice(), index: i });
    } else if (it.cw) {
      playVod(it.cw);
    } else if (S.kind === 'movie') {
      playVod(vodMovie(it));
    } else {
      openSeries(it);
    }
  }

  // ---------- Prévia ao vivo (lista de canais) ----------
  var pv = { timer: null, epgTimer: null, id: null, hls: null, urls: null, u: 0 };
  var PALETTE = ['#2E7DFF', '#22B573', '#E53935', '#8E44AD', '#00897B', '#F39C12', '#D81B60', '#3949AB', '#6D4C41', '#0097A7'];
  function initials(n) {
    var w = String(n).replace(/[^A-Za-z0-9\u00C0-\u017F ]/g, ' ').split(' ').filter(function (x) { return x && !/^(HD|FHD|SD|4K|UHD|TV)$/i.test(x); });
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
  }
  function colorFor(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0; return PALETTE[Math.abs(h) % PALETTE.length]; }
  function hhmm(ts) { var d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function b64(t) { try { return decodeURIComponent(escape(atob(t))); } catch (e) { try { return atob(t); } catch (e2) { return t || ''; } } }

  function previewFor(it, i, noPlay) {
    if (!it) return;
    clearTimeout(pv.timer); clearTimeout(pv.epgTimer);
    $('preview').className = '';
    $('pvName').textContent = it.name;
    var lg = $('pvLogo');
    lg.style.backgroundImage = it.icon ? 'url("' + it.icon.replace(/"/g, '%22') + '")' : '';
    lg.style.backgroundColor = it.icon ? '' : colorFor(it.name);
    lg.textContent = it.icon ? '' : initials(it.name);
    showEpg(it);
    pv.epgTimer = setTimeout(function () { loadEpg(it); }, 350);
    if (pv.id === it.id) return;
    stopPreview(true);
    if (noPlay && TOUCH) return;                 // celular: só toca quando o usuário escolhe
    pv.timer = setTimeout(function () { startPreview(it); }, 900);
  }
  function startPreview(it) {
    if (S.screen !== 'home' || S.scan) return;
    pv.id = it.id; pv.urls = liveUrls(it.id); pv.u = 0;
    $('pvScreen').className = 'loading';
    playPreviewUrl();
  }
  function playPreviewUrl() {
    var v = $('pvVideo'), u = pv.urls[pv.u], id = pv.id;
    if (pv.hls) { try { pv.hls.destroy(); } catch (e) { } pv.hls = null; }
    v.muted = TOUCH;
    v.onplaying = function () { if (pv.id === id) $('pvScreen').className = 'on'; };
    v.onerror = function () { if (pv.id === id && !pv.hls) nextPreviewUrl(); };
    if (/\.m3u8(\?|$)/.test(u) && window.Hls && window.Hls.isSupported()) {
      pv.hls = new window.Hls({ maxBufferLength: 10, liveSyncDurationCount: 3, enableWorker: true });
      pv.hls.on(window.Hls.Events.ERROR, function (ev, data) { if (data && data.fatal && pv.id === id) nextPreviewUrl(); });
      pv.hls.loadSource(u);
      pv.hls.attachMedia(v);
    } else {
      v.src = u;
    }
    try {
      var pr = v.play();
      if (pr && pr['catch']) pr['catch'](function () { if (pv.id === id && !v.muted) { v.muted = true; try { var p2 = v.play(); if (p2 && p2['catch']) p2['catch'](function () { }); } catch (e2) { } } });
    } catch (e) { }
  }
  function nextPreviewUrl() {
    pv.u++;
    if (pv.urls && pv.u < pv.urls.length) playPreviewUrl();
    else $('pvScreen').className = 'fail';
  }
  function stopPreview(keepInfo) {
    clearTimeout(pv.timer);
    if (!keepInfo) clearTimeout(pv.epgTimer);
    pv.id = null;
    if (pv.hls) { try { pv.hls.destroy(); } catch (e) { } pv.hls = null; }
    var v = $('pvVideo');
    if (!v) return;
    v.onplaying = null; v.onerror = null;
    try { v.pause(); } catch (e) { }
    if (v.getAttribute('src')) { v.removeAttribute('src'); try { v.load(); } catch (e2) { } }
    $('pvScreen').className = '';
  }

  // Programação (EPG) do servidor, quando ele fornece
  function showEpg(it) {
    var e = S.epg[it.id];
    if (e && e.now) {
      $('pvNow').textContent = 'Agora: ' + e.now.title + '  ·  ' + hhmm(e.now.start) + ' – ' + hhmm(e.now.end);
      var pct = Math.max(0, Math.min(100, (Date.now() / 1000 - e.now.start) / (e.now.end - e.now.start) * 100));
      $('pvFill').style.width = pct + '%';
      $('pvBar').style.display = '';
      $('pvNext').textContent = e.next ? 'Depois: ' + e.next.title + '  ·  ' + hhmm(e.next.start) : '';
    } else {
      $('pvNow').textContent = e ? 'Programação não informada pelo servidor' : '';
      $('pvBar').style.display = 'none';
      $('pvNext').textContent = '';
    }
  }
  function loadEpg(it) {
    if (S.epg[it.id] && Date.now() - S.epg[it.id].at < 600000) return;
    getJSON(base() + '&action=get_short_epg&limit=3&stream_id=' + enc(it.id), function (o) {
      var arr = (o && o.epg_listings) || [], now = Date.now() / 1000, res = { at: Date.now(), now: null, next: null };
      for (var i = 0; i < arr.length; i++) {
        var st = +arr[i].start_timestamp, en = +arr[i].stop_timestamp;
        if (!st || !en) continue;
        var item = { title: b64(arr[i].title), start: st, end: en };
        if (st <= now && en > now) res.now = item;
        else if (st > now && !res.next) res.next = item;
      }
      S.epg[it.id] = res;
      if ($('pvName').textContent === it.name) showEpg(it);
      var cards = $('grid').children;
      for (var j = 0; j < cards.length; j++) {
        var x = S.filtered[+cards[j].getAttribute('data-i')];
        if (x && x.id === it.id) { var pg = cards[j].querySelector('.prog'); if (pg && res.now) pg.textContent = res.now.title; }
      }
    }, function () { S.epg[it.id] = { at: Date.now(), now: null, next: null }; });
  }

  // ---------- Séries ----------
  function openSeries(it) {
    show('series');
    S.seriesName = it.name;
    S.seriesIcon = it.icon || '';
    S.seriesId = it.id;
    $('sTitle').textContent = it.name;
    $('seasons').innerHTML = '';
    $('eps').innerHTML = '';
    $('sMsg').textContent = 'Carregando...';
    abortReq();
    S.req = getCached(base() + '&action=get_series_info&series_id=' + enc(it.id), function (o) {
      var eps = [];
      function add(arr, seasonKey) {
        if (!arr || !arr.length) return;
        for (var i = 0; i < arr.length; i++) {
          var e = arr[i];
          var id = str(e, 'id');
          if (!id) continue;
          var num = str(e, 'episode_num') || String(i + 1);
          eps.push({
            id: id,
            season: str(e, 'season') || seasonKey || '1',
            title: 'E' + num + ' · ' + (str(e, 'title') || 'Episódio ' + num),
            ext: str(e, 'container_extension') || 'mp4'
          });
        }
      }
      var src = o && o.episodes;
      if (src && typeof src.length === 'number') {
        for (var a = 0; a < src.length; a++) add(src[a], null);
      } else if (src) {
        for (var k in src) if (src.hasOwnProperty(k)) add(src[k], k);
      }
      var map = {}, keys = [];
      eps.forEach(function (e) {
        if (!map[e.season]) { map[e.season] = []; keys.push(e.season); }
        map[e.season].push(e);
      });
      keys.sort(function (x, y) { return (parseInt(x, 10) || 999) - (parseInt(y, 10) || 999); });
      S.seasons = keys.map(function (k) { return { name: k, eps: map[k] }; });
      if (!S.seasons.length) { $('sMsg').textContent = 'Nenhum episódio encontrado'; return; }
      $('sMsg').textContent = '';
      var box = $('seasons');
      S.seasons.forEach(function (s, i) {
        var d = document.createElement('div');
        d.className = 'f season';
        d.setAttribute('data-i', i);
        d.textContent = 'Temporada ' + s.name;
        box.appendChild(d);
      });
      selectSeason(0);
      setFocus(box.firstChild);
    }, function (err) { $('sMsg').textContent = 'Erro ao carregar: ' + err; });
  }

  function selectSeason(i) {
    var all = $('seasons').children;
    for (var j = 0; j < all.length; j++) {
      all[j].className = all[j].className.replace(/\s?sel\b/g, '') + (j === i ? ' sel' : '');
    }
    var box = $('eps');
    box.innerHTML = '';
    box.scrollTop = 0;
    S.seasons[i].eps.forEach(function (e, n) {
      var d = document.createElement('div');
      d.className = 'f ep';
      d.setAttribute('data-s', i);
      d.setAttribute('data-n', n);
      d.textContent = e.title;
      box.appendChild(d);
    });
  }

  // ---------- Player ----------
  function startPlay(p) {
    stopPreview();
    if (p.live && p.list[p.index]) {
      var lc = p.list[p.index];
      try { localStorage.setItem('mp_lastch', JSON.stringify({ id: lc.id, name: lc.name, icon: lc.icon || '', at: Date.now() })); } catch (e) { }
    }
    if (NATIVE) {
      if (S.screen === 'series') S.seriesFocus = cur;
      var payload;
      if (p.live) {
        // envia uma "janela" de até 1500 canais em volta do escolhido (limite de tamanho do Android)
        var from = Math.max(0, p.index - 750), to = Math.min(p.list.length, from + 1500);
        payload = { live: true, index: p.index - from, server: streamServer(), user: S.creds.user, pass: S.creds.pass,
          list: p.list.slice(from, to).map(function (it) { return { id: it.id, name: it.name }; }) };
      } else {
        payload = { live: false, title: p.title, urls: p.urls, start: Math.floor((p.start || 0) * 1000) };
        S.nativeVod = p.vod || null;
      }
      try { NATIVE.play(JSON.stringify(payload)); } catch (e) { toast('Não foi possível abrir o player'); }
      return;
    }
    S.prevScreen = S.screen;
    if (S.screen === 'series') S.seriesFocus = cur;
    show('player');
    if (cur) cur.className = cur.className.replace(/\s?focus\b/g, '');
    cur = null;
    S.play = p;
    if (TOUCH) $('video').controls = !p.live;
    keepAwake(true);
    $('touchBar').className = p.live ? 'live' : '';
    loadPlay();
  }

  function loadPlay() {
    var p = S.play;
    if (p.live) {
      var it = p.list[p.index];
      p.title = it.name;
      p.urls = liveUrls(it.id);
      p.info = 'Canal ' + (p.index + 1) + ' de ' + p.list.length;
      p.hint = '▲▼ trocar canal  ·  Verde/amarelo: favoritar  ·  Vermelho: ocultar  ·  Voltar para sair';
    } else {
      p.info = '';
      p.hint = 'OK pausar  ·  ◀ ▶ voltar/avançar 10s  ·  Voltar para sair';
    }
    p.attempt = 0;
    p.errReconnects = 0;
    p.started = false;
    p.netRetries = 0;
    p.mediaRetries = 0;
    clearTimeout(stallTimer);
    playUrl();
    osd();
  }

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
  }

  function playUrl() {
    var p = S.play;
    if (!p) return;
    var u = p.urls[p.attempt];
    var v = $('video');
    destroyHls();
    $('spinner').className = '';
    var isHls = /\.m3u8(\?|$)/.test(u);
    if (isHls && window.Hls && window.Hls.isSupported()) {
      p.netRetries = p.netRetries || 0;
      p.mediaRetries = p.mediaRetries || 0;
      hls = new window.Hls(HLS_CFG);
      hls.on(window.Hls.Events.ERROR, function (ev, data) {
        if (!data || !data.fatal || S.play !== p) return;
        var E = window.Hls.ErrorTypes;
        if (data.type === E.NETWORK_ERROR && p.netRetries < 6) {
          p.netRetries++;
          setTimeout(function () { if (hls && S.play === p) hls.startLoad(); }, 1000);
          return;
        }
        if (data.type === E.MEDIA_ERROR && p.mediaRetries < 3) {
          p.mediaRetries++;
          hls.recoverMediaError();
          return;
        }
        onPlayError();
      });
      hls.on(window.Hls.Events.FRAG_BUFFERED, function () { p.netRetries = 0; });
      hls.loadSource(u);
      hls.attachMedia(v);
    } else {
      v.src = u;
    }
    try {
      var pr = v.play();
      if (pr && pr['catch']) pr['catch'](function () { });
    } catch (e) { }
  }

  function onPlayError() {
    var p = S.play;
    if (!p) return;
    if (p.attempt + 1 < p.urls.length) {
      p.attempt++;
      playUrl();
    } else {
      $('spinner').className = 'hidden';
      if (p.live && !p.started) {
        // Nunca abriu: oculta sozinho. Se já estava passando e travou, não oculta (pode ser a internet).
        hideCurrent('"' + p.list[p.index].name + '" não abriu e foi ocultado. Para trazer de volta, use "Ocultos".');
      } else if (p.started && (p.errReconnects || 0) < 5) {
        // Já estava passando: tenta voltar sozinho algumas vezes antes de avisar.
        p.errReconnects = (p.errReconnects || 0) + 1;
        p.attempt = 0;
        setTimeout(function () { if (S.play === p) reconnect('Reconectando (' + p.errReconnects + '/5)...'); }, 2000);
      } else {
        toast(p.live ? 'O canal parou. Pode ser a internet ou o servidor: tente abrir de novo' : 'Não foi possível reproduzir este conteúdo', 6000);
      }
    }
  }

  function saveWebPos() {
    var p = S.play, v = $('video');
    if (p && !p.live && p.vod && p.started !== false && v.currentTime > 0) cwSave(p.vod, v.currentTime, v.duration || 0);
  }
  setInterval(function () { if (S.play && !S.play.live && !$('video').paused) saveWebPos(); }, 15000);
  function stopPlay() {
    saveWebPos();
    clearTimeout(stallTimer);
    keepAwake(false);
    S.play = null;
    destroyHls();
    var v = $('video');
    try { v.pause(); } catch (e) { }
    v.removeAttribute('src');
    try { v.load(); } catch (e2) { }
    $('spinner').className = 'hidden';
  }

  function fmt(t) {
    if (!isFinite(t) || t < 0) return '--:--';
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }

  function osd() {
    var p = S.play;
    if (!p) return;
    var v = $('video');
    $('osdTitle').textContent = p.title || '';
    $('osdInfo').textContent = p.live ? p.info :
      (fmt(v.currentTime) + ' / ' + fmt(v.duration) + (v.paused ? '  ·  Pausado' : ''));
    $('osdHint').textContent = p.hint;
    $('osd').className = '';
    $('player').className = 'screen';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      if (!$('video').paused && S.play) { $('osd').className = 'off'; $('player').className = 'screen idle'; }
    }, 4000);
  }

  function togglePause() {
    var v = $('video');
    if (v.paused) { try { var pr = v.play(); if (pr && pr['catch']) pr['catch'](function () { }); } catch (e) { } }
    else v.pause();
    osd();
  }

  function seek(sec) {
    var v = $('video');
    if (!isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + sec));
    osd();
  }

  function zap(step) {
    var p = S.play;
    var n = p.list.length;
    p.index = (p.index + step + n) % n;
    loadPlay();
  }

  function leavePlayer() {
    stopPlay();
    $('touchBar').className = 'hidden';
    show(S.prevScreen);
    if (S.dirty) { S.dirty = false; filter(); }
    var f = S.prevScreen === 'series' ? S.seriesFocus : S.homeFocus;
    if (f && f.offsetParent !== null) setFocus(f); else move('down');
  }

  function playerKey(k) {
    var p = S.play;
    if (has(UA_KEYS.BACK, k) || has(UA_KEYS.STOP, k)) { leavePlayer(); return; }
    if (!p) return;
    if (p.live) {
      if (k === 403) { hideCurrent(); return; }
      if (has(UA_KEYS.FAV, k)) { toggleFav('live', p.list[p.index]); osd(); return; }
      if (k === UA_KEYS.UP || has(UA_KEYS.CHUP, k)) { zap(1); return; }
      if (k === UA_KEYS.DOWN || has(UA_KEYS.CHDOWN, k)) { zap(-1); return; }
      osd();
      return;
    }
    if (k === UA_KEYS.ENTER || has(UA_KEYS.PLAYPAUSE, k)) { togglePause(); return; }
    if (has(UA_KEYS.PLAY, k)) { if ($('video').paused) togglePause(); return; }
    if (has(UA_KEYS.PAUSE, k)) { if (!$('video').paused) togglePause(); return; }
    if (k === UA_KEYS.RIGHT || has(UA_KEYS.FF, k)) { seek(10); return; }
    if (k === UA_KEYS.LEFT || has(UA_KEYS.RW, k)) { seek(-10); return; }
    osd();
  }

  // ---------- Voltar ----------
  function back() {
    var now = Date.now();
    if (S.screen === 'series') {
      abortReq();
      show('home');
      if (S.homeFocus && S.homeFocus.offsetParent !== null) setFocus(S.homeFocus); else move('down');
      return;
    }
    if (S.screen === 'home') { goBack(); return; }
    if (now - S.backTime < 2000) { exitApp(); return; }
    S.backTime = now;
    toast('Aperte Voltar de novo para fechar o app (sua conta continua conectada)', 2000);
  }

  // ---------- Cliques (controle, mouse da LG ou toque) ----------
  function closest(el, cls) {
    var re = new RegExp('\\b' + cls + '\\b');
    while (el && el !== document.body) {
      if (el.className && re.test(el.className)) return el;
      el = el.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var el;
    if (t.id === 'lBtn') { doLogin(); return; }
    if (t.id === 'lEye') {
      var pw = $('lPass');
      var showing = pw.type === 'text';
      pw.type = showing ? 'password' : 'text';
      t.textContent = showing ? 'Mostrar' : 'Ocultar';
      return;
    }
    if (t.id === 'closeBtn') { leavePlayer(); return; }
    if (t.id === 'hideBtn') { hideCurrent(); return; }
    if (t.id === 'favBtn') { if (S.play && S.play.live) toggleFav('live', S.play.list[S.play.index]); return; }
    if (t.id === 'btnScan') { startScan(); return; }
    if (t.id === 'btnHidden') { toggleHidden(); return; }
    if (t.id === 'scanStop') { if (S.scan) S.scan.stop = true; finishScan(); return; }
    if (t.id === 'zapUp') { if (S.play && S.play.live) zap(1); return; }
    if (t.id === 'zapDown') { if (S.play && S.play.live) zap(-1); return; }
    if (t.id === 'homeBack') { openHome(); return; }
    if (t.id === 'closeApp' || t.id === 'startClose') { exitApp(); return; }
    if (t.id === 'startFav') { openKind('live', FAV_ID); return; }
    if (t.id === 'contBtn' || closest(t, 'cont')) {
      S.homeFocus = $('contBtn');
      if (S.lastVod) playVod(S.lastVod);
      else if (S.lastCh) { S.kind = 'live'; startPlay({ live: true, list: [S.lastCh], index: 0 }); }
      return;
    }
    if ((el = closest(t, 'big'))) { openKind(el.getAttribute('data-go')); return; }
    if (t.id === 'sBack') { back(); return; }
    if (t.id === 'logout') {
      var now = Date.now();
      if (now - S.logoutTime < 3000) {
        clearCreds();
        stopPreview();
        try { localStorage.removeItem('mp_last'); } catch (e) { }
        S.creds = null;
        abortReq();
        $('lPass').value = '';
        $('lStatus').textContent = '';
        show('login');
        if (cur) cur.className = cur.className.replace(/\s?focus\b/g, '');
        cur = null;
        setFocus($('lServer'));
      } else {
        S.logoutTime = now;
        toast('Aperte OK de novo para sair da conta', 3000);
      }
      return;
    }
    if ((el = closest(t, 'tab'))) {
      var kind = el.getAttribute('data-kind');
      if (kind && kind !== S.kind) { pushHist(); loadKind(kind); }
      return;
    }
    if ((el = closest(t, 'cat'))) {
      var ci = +el.getAttribute('data-i');
      if (ci !== S.catIndex) pushHist();
      selectCat(ci);
      return;
    }
    if ((el = closest(t, 'card'))) { setFocus(el); openItem(+el.getAttribute('data-i')); return; }
    if ((el = closest(t, 'season'))) { selectSeason(+el.getAttribute('data-i')); return; }
    if ((el = closest(t, 'ep'))) {
      var ep = S.seasons[+el.getAttribute('data-s')].eps[+el.getAttribute('data-n')];
      setFocus(el);
      playVod(vodEpisode(ep));
      return;
    }
    if (S.screen === 'player') osd();
  });

  // Ponteiro do Magic Remote (LG) / mouse: segue o foco
  document.addEventListener('mouseover', function (e) {
    var el = closest(e.target, 'f');
    if (el && el !== cur) setFocus(el);
  });

  $('search').addEventListener('input', function () { filter(); });
  // App Android: garante que o teclado apareça ao tocar/entrar num campo
  ['lServer', 'lUser', 'lPass', 'search'].forEach(function (id) {
    $(id).addEventListener('focus', function () {
      if (NATIVE && NATIVE.showKeyboard) { try { NATIVE.showKeyboard(); } catch (e) { } }
    });
  });
  $('player').addEventListener('mousemove', function () { if (S.play) osd(); });
  $('player').addEventListener('touchstart', function () { if (S.play) osd(); });

  $('grid').addEventListener('scroll', function () {
    var g = $('grid');
    if (g.scrollTop + g.clientHeight > g.scrollHeight - 400) renderMore();
  });

  var v = $('video');
  v.addEventListener('error', function () { if (S.play && !hls) onPlayError(); });
  v.addEventListener('loadedmetadata', function () {
    var p = S.play;
    if (p && !p.live && p.start && !p.seeked) { p.seeked = true; try { v.currentTime = p.start; } catch (e) { } }
  });
  v.addEventListener('playing', function () {
    $('spinner').className = 'hidden';
    clearTimeout(stallTimer);
    if (S.play) S.play.started = true;
  });
  v.addEventListener('waiting', function () {
    var p = S.play;
    if (!p) return;
    $('spinner').className = '';
    clearTimeout(stallTimer);
    // Travou por mais de 8 s num canal que já estava passando: reconecta sozinho (sem ocultar).
    stallTimer = setTimeout(function () {
      if (S.play !== p || !p.started || !$('video').paused && $('video').readyState > 2) return;
      reconnect('Reconectando o canal...');
    }, 8000);
  });

  // ---------- Proteções contra travamento ----------
  function qualityRank(name) {
    var n = name.toUpperCase();
    if (/\b(4K|UHD)\b/.test(n)) return 4;
    if (/\bFHD\b|FULL ?HD|1080/.test(n)) return 3;
    if (/\bSD\b|480/.test(n)) return 1;
    return 2; // HD ou sem indicação
  }
  function baseName(name) {
    return name.toUpperCase()
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/\b(4K|UHD|FHD|FULL ?HD|HD|SD|H\.?265|HEVC|1080P?|720P?|480P?|ALT|²|³)\b/g, ' ')
      .replace(/[^A-Z0-9À-Ú]+/g, ' ').trim();
  }
  // Procura o mesmo canal em qualidade menor (ex.: "Globo FHD" -> "Globo HD" ou "Globo SD").
  function lighterVersion(it) {
    var b = baseName(it.name), r = qualityRank(it.name), best = null, bestR = 0;
    for (var i = 0; i < S.items.length; i++) {
      var o = S.items[i];
      if (o.id === it.id || S.hidden.hasOwnProperty(o.id)) continue;
      var orr = qualityRank(o.name);
      if (orr < r && orr > bestR && baseName(o.name) === b) { best = o; bestR = orr; }
    }
    return best;
  }

  function reconnect(message) {
    var p = S.play;
    if (!p) return;
    var now = Date.now();
    p.recent = (p.recent || []).filter(function (t) { return now - t < 180000; });
    p.recent.push(now);
    // Travou 3 vezes em 3 minutos: tenta a versão mais leve do canal, se existir.
    if (p.live && p.recent.length >= 3) {
      var cur = p.list[p.index], alt = lighterVersion(cur);
      if (alt) {
        p.list.splice(p.index, 1, alt);
        toast('Sinal fraco: mudando para "' + alt.name + '"', 4500);
        p.recent = [];
        loadPlay();
        return;
      }
      if (hls && hls.levels && hls.levels.length > 1) {
        hls.autoLevelCapping = Math.max(0, (hls.currentLevel > 0 ? hls.currentLevel : hls.levels.length - 1) - 1);
      }
    }
    toast(message || 'Reconectando o canal...', 2500);
    var pos = p.live ? 0 : $('video').currentTime;
    playUrl();
    if (!p.live && pos) {
      $('video').addEventListener('loadedmetadata', function once() {
        $('video').removeEventListener('loadedmetadata', once);
        try { $('video').currentTime = pos; } catch (e) { }
      });
    }
  }

  // Vigia de imagem congelada: vídeo "tocando" mas o tempo não anda.
  var lastT = -1, frozenFor = 0;
  setInterval(function () {
    var p = S.play, v = $('video');
    if (!p || !p.started || v.paused || document.hidden || !navigator.onLine) { frozenFor = 0; lastT = -1; return; }
    if (v.currentTime === lastT) frozenFor += 3; else frozenFor = 0;
    lastT = v.currentTime;
    if (frozenFor >= 12) { frozenFor = 0; reconnect('Imagem parada: reconectando...'); }
  }, 3000);

  // Internet caiu / voltou
  window.addEventListener('offline', function () {
    if (S.play) toast('Sem internet. O canal volta sozinho quando a conexão voltar.', 6000);
  });
  window.addEventListener('online', function () {
    if (S.play) setTimeout(function () { reconnect('Internet de volta: reconectando...'); }, 1500);
  });

  // Voltou para o app depois de um tempo: puxa o canal de volta para o "ao vivo".
  document.addEventListener('visibilitychange', function () {
    var p = S.play, v = $('video');
    if (document.hidden || !p || !p.live) return;
    if (hls) {
      try {
        hls.startLoad();
        if (hls.liveSyncPosition && hls.liveSyncPosition - v.currentTime > 30) v.currentTime = hls.liveSyncPosition;
      } catch (e) { }
    }
    if (v.paused) { try { var pr = v.play(); if (pr && pr['catch']) pr['catch'](function () { }); } catch (e2) { } }
  });

  // Mantém a tela ligada enquanto assiste (quando o aparelho permite).
  var wakeLock = null;
  function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; w.addEventListener('release', function () { wakeLock = null; }); })['catch'](function () { });
      } else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { }
  }

  // ---------- Teclado na tela (controle remoto) ----------
  // Abre quando o campo é ativado pelo OK do controle. Funciona em TV Box, LG, Samsung e notebook.
  var OSK = null;
  var OSK_ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '⌫'],
    ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '/'],
    ['http://', ':', '-', '_', '@', '?', '=', '&', '.com'],
    ['Espaço', 'Limpar', 'Concluir ✓']
  ];
  var OSK_NEXT = { lServer: 'lUser', lUser: 'lPass', lPass: 'lBtn' };
  function oskBuild() {
    var d = document.createElement('div');
    d.id = 'osk';
    var h = '<div class="osk-top"><span id="oskLbl"></span><div id="oskVal"></div></div>';
    for (var r = 0; r < OSK_ROWS.length; r++) {
      h += '<div class="osk-row">';
      for (var c = 0; c < OSK_ROWS[r].length; c++) {
        var key = OSK_ROWS[r][c];
        var w = key.length > 2 ? ' wide' : '';
        if (key === 'Concluir ✓') w += ' ok';
        h += '<div class="osk-k' + w + '" data-r="' + r + '" data-c="' + c + '">' + key + '</div>';
      }
      h += '</div>';
    }
    h += '<div class="osk-tip">Setas: mover · OK: digitar · Voltar: fechar · números do controle também digitam</div>';
    d.innerHTML = h;
    document.body.appendChild(d);
    d.addEventListener('mousedown', function (e) { e.preventDefault(); });
    d.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.getAttribute || t.getAttribute('data-r') === null) return;
      OSK.r = +t.getAttribute('data-r'); OSK.c = +t.getAttribute('data-c');
      oskPress();
    });
    return d;
  }
  function oskKeyEl(r, c) { return document.querySelector('#osk .osk-k[data-r="' + r + '"][data-c="' + c + '"]'); }
  function oskPaint() {
    var all = document.querySelectorAll('#osk .osk-k');
    for (var i = 0; i < all.length; i++) {
      var r = +all[i].getAttribute('data-r'), c = +all[i].getAttribute('data-c');
      var key = OSK_ROWS[r][c];
      if (key.length === 1 && /[a-z]/.test(key)) all[i].textContent = OSK.up ? key.toUpperCase() : key;
      all[i].className = all[i].className.replace(/\s?sel\b/g, '') + (r === OSK.r && c === OSK.c ? ' sel' : '');
      if (key === '⇧') all[i].className = all[i].className.replace(/\s?on\b/g, '') + (OSK.up ? ' on' : '');
    }
    var inp = OSK.inp, v = inp.value;
    var masked = inp.type === 'password' ? v.replace(/./g, '•') : v;
    $('oskVal').textContent = masked + '▏';
    var lb = document.querySelector('label[for="' + inp.id + '"]');
    $('oskLbl').textContent = lb ? lb.textContent : (inp.placeholder || 'Digite');
  }
  function oskOpen(inp) {
    if (!$('osk')) oskBuild();
    OSK = { inp: inp, r: 1, c: 0, up: false };
    $('osk').className = 'show';
    try { inp.blur(); } catch (e) { }
    oskPaint();
  }
  function oskClose(next) {
    if (!OSK) return;
    var inp = OSK.inp;
    OSK = null;
    $('osk').className = '';
    try { inp.dispatchEvent(new Event('input')); } catch (e) { }
    var n = next && OSK_NEXT[inp.id] ? $(OSK_NEXT[inp.id]) : inp;
    setFocus(n);
  }
  function oskType(ch) {
    var inp = OSK.inp;
    inp.value = inp.value + ch;
    try { inp.dispatchEvent(new Event('input')); } catch (e) { }
    oskPaint();
  }
  function oskPress() {
    var key = OSK_ROWS[OSK.r][OSK.c], inp = OSK.inp;
    if (key === '⌫') { inp.value = inp.value.slice(0, -1); oskPaint(); }
    else if (key === '⇧') { OSK.up = !OSK.up; oskPaint(); }
    else if (key === 'Espaço') oskType(' ');
    else if (key === 'Limpar') { inp.value = ''; oskPaint(); }
    else if (key === 'Concluir ✓') oskClose(true);
    else oskType(key.length === 1 && OSK.up ? key.toUpperCase() : key);
  }
  function oskMove(dr, dc) {
    if (dc) {
      var n = OSK_ROWS[OSK.r].length;
      OSK.c = (OSK.c + dc + n) % n;
    } else {
      var from = oskKeyEl(OSK.r, OSK.c).getBoundingClientRect();
      var x = from.left + from.width / 2;
      var nr = OSK.r + dr;
      if (nr < 0 || nr >= OSK_ROWS.length) return;
      var best = 0, bd = 1e9;
      for (var c = 0; c < OSK_ROWS[nr].length; c++) {
        var b = oskKeyEl(nr, c).getBoundingClientRect();
        var dd = Math.abs(b.left + b.width / 2 - x);
        if (dd < bd) { bd = dd; best = c; }
      }
      OSK.r = nr; OSK.c = best;
    }
    oskPaint();
  }
  function oskKey(e, k) {
    if (k === UA_KEYS.LEFT) oskMove(0, -1);
    else if (k === UA_KEYS.RIGHT) oskMove(0, 1);
    else if (k === UA_KEYS.UP) oskMove(-1, 0);
    else if (k === UA_KEYS.DOWN) oskMove(1, 0);
    else if (k === UA_KEYS.ENTER) oskPress();
    else if (has(UA_KEYS.BACK, k)) oskClose(false);
    else if (k === 8) { OSK.inp.value = OSK.inp.value.slice(0, -1); oskPaint(); }
    else if (k >= 48 && k <= 57 && !e.shiftKey) oskType(String(k - 48));
    else if (k >= 96 && k <= 105) oskType(String(k - 96));
    else if (e.key && e.key.length === 1) oskType(e.key);   // teclado físico (notebook)
    else return;
    e.preventDefault();
  }

  // ---------- Teclas ----------
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (window.MITRE_KEYMAP && window.MITRE_KEYMAP[k]) k = window.MITRE_KEYMAP[k]; // TVs Samsung antigas
    if (S.scan) {
      if (has(UA_KEYS.BACK, k) || k === UA_KEYS.ENTER) { S.scan.stop = true; finishScan(); }
      e.preventDefault();
      return;
    }
    if (OSK) { oskKey(e, k); return; }
    if (S.screen === 'player') { playerKey(k); e.preventDefault(); return; }

    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') {
      // Digitando: OK/Concluir fecha o teclado; seta cima/baixo sai do campo.
      if (k === UA_KEYS.ENTER || has(UA_KEYS.IME_DONE, k) || has(UA_KEYS.IME_CANCEL, k) || has(UA_KEYS.BACK, k)) {
        ae.blur();
        if (ae.id === 'lPass' && (k === UA_KEYS.ENTER || has(UA_KEYS.IME_DONE, k))) setFocus($('lBtn'));
        e.preventDefault();
      } else if (k === UA_KEYS.UP || k === UA_KEYS.DOWN) {
        ae.blur();
        move(k === UA_KEYS.UP ? 'up' : 'down');
        e.preventDefault();
      }
      return;
    }

    if (k === UA_KEYS.LEFT) { move('left'); e.preventDefault(); }
    else if (k === UA_KEYS.RIGHT) { move('right'); e.preventDefault(); }
    else if (k === UA_KEYS.UP) { move('up'); e.preventDefault(); }
    else if (k === UA_KEYS.DOWN) { move('down'); e.preventDefault(); }
    else if (k === UA_KEYS.ENTER) {
      if (cur && /\bcard\b/.test(cur.className) && !(S.kind === 'live' && S.showHidden)) {
        okDown(cur);
      } else if (cur) {
        if (cur.tagName === 'INPUT') oskOpen(cur);   // controle remoto: teclado na tela
        else cur.click();
      }
      e.preventDefault();
    } else if (has(UA_KEYS.FAV, k)) {
      if (cur && /\bcard\b/.test(cur.className)) favCard(cur);
      e.preventDefault();
    } else if (has(UA_KEYS.BACK, k)) { back(); e.preventDefault(); }
  });

  // OK rápido abre; OK segurado (~0,7 s) favorita.
  var ok = null;
  function favCard(el) {
    var it = S.filtered[+el.getAttribute('data-i')];
    if (it && it.cw) { toast('Para favoritar, abra o item pela categoria dele', 2500); return; }
    if (it) toggleFav(S.kind, it);
  }
  function okDown(el) {
    if (ok) { ok.repeats++; return; }
    ok = { el: el, repeats: 0, up: false };
    var my = ok;
    setTimeout(function () {
      if (ok !== my) return;
      ok = null;
      if (my.up) return;
      if (my.repeats >= 1) favCard(my.el);   // segurou o botão
      else my.el.click();                    // aparelho sem "soltar tecla": abre normalmente
    }, 700);
  }
  document.addEventListener('keyup', function (e) {
    var k = e.keyCode;
    if (window.MITRE_KEYMAP && window.MITRE_KEYMAP[k]) k = window.MITRE_KEYMAP[k];
    if (k !== UA_KEYS.ENTER || !ok || ok.up) return;
    ok.up = true;
    var el = ok.el;
    ok = null;
    el.click();
  });

  // Toque e segure (celular) ou botão direito (mouse): favoritar
  document.addEventListener('contextmenu', function (e) {
    var el = closest(e.target, 'card');
    if (!el || S.screen !== 'home' || (S.kind === 'live' && S.showHidden)) return;
    e.preventDefault();
    setFocus(el);
    favCard(el);
  });

  // ---------- Início ----------
  // Ponte com o app Android
  window.__probeDone = function (id, ok) { var cb = probeCbs[id]; if (cb) cb(!!ok); };
  window.__nativeHidden = function (arr) {
    if (!arr || !arr.length) return;
    // posição do filme/episódio informada pelo player nativo ("ms|ms")
    arr = arr.filter(function (it) {
      if (it.id !== '__pos') return true;
      var pr = String(it.name).split('|'), pos = +pr[0] / 1000, dur = +pr[1] / 1000;
      if (S.nativeVod) cwSave(S.nativeVod, pos, dur > 0 ? dur : 0);
      return false;
    });
    if (!arr.length) return;
    arr.forEach(function (it) { S.hidden[it.id] = it.name; });
    saveHidden();
    if (S.screen === 'home') {
      var f = S.homeFocus;
      filter();
      if (f && f.offsetParent !== null) setFocus(f); else move('down');
    }
    toast(arr.length === 1 ? '"' + arr[0].name + '" foi ocultado' : arr.length + ' canais foram ocultados', 4000);
  };
  window.__back = function () {
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') { ae.blur(); return; }
    if (S.scan) { S.scan.stop = true; finishScan(); return; }
    if (S.screen === 'player') { leavePlayer(); return; }
    back();
  };

  S.hidden = loadHidden();
  S.fav = loadFav();
  S.creds = loadCreds();
  fetchSrvList();
  lsSet('mp_ota_ok', CUR_VER);               // abriu sem erro: esta versão é confiável
  window.onerror = null;
  setTimeout(otaCheck, 8000);
  if (S.creds) {
    openHome();
  } else {
    show('login');
    setFocus($('lServer'));
  }
})();
