/* Istiqamah – UI, data JAKIM, notifikasi */
(function () {
  'use strict';
  var L = window.IstiLogic, I18N = window.ISTI_I18N, ZONES = window.ISTI_ZONES;
  var APP_VERSION = '0.3.1';
  var params = new URLSearchParams(location.search);
  var Cap = window.Capacitor;
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var LN = isNative && Cap.Plugins ? Cap.Plugins.LocalNotifications : null;

  /* ---------- storan ---------- */
  function load(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }

  var saved = load('isti.settings', null);
  var firstRun = !saved;
  var S = Object.assign({ zone: 'PNG01', male: true, lang: 'ms', tar: 20, bells: {} }, saved || {});
  if (params.get('male') === '0') S.male = false;
  if (params.get('male') === '1') S.male = true;
  if (params.get('lang')) S.lang = params.get('lang');
  if (params.get('tar')) S.tar = +params.get('tar');
  function persist() { save('isti.settings', S); }
  function esc(x) { return String(x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); }

  var ZDEF = [['subhanallah', 33], ['alhamdulillah', 33], ['akbar', 33], ['istighfar', 100]];
  var Z = Object.assign({ sel: 'subhanallah', counts: {}, targets: {}, vibrate: true, custom: [] }, load('isti.zikir', {}));
  function zSave() { save('isti.zikir', Z); }
  var QDEF = ['q_taubat', 'q_tahajud', 'q_hajat', 'q_tasbih', 'q_witir', 'q_zikir', 'q_doa'];
  var Q = Object.assign({ items: QDEF.map(function (k) { return { id: k, key: k }; }), night: '', done: [] }, load('isti.qiam', {}));
  function qSave() { save('isti.qiam', Q); }
  var SBELL_DEF = { aidilfitri: 1, aidiladha: 1, awalRamadan: 1 };
  function sbellOn(k) { return S.sbells && S.sbells[k] !== undefined ? !!S.sbells[k] : !!SBELL_DEF[k]; }

  var fakeNow = params.get('now') ? new Date(params.get('now')) : null;
  var fakeStart = Date.now();
  function now() { return fakeNow ? new Date(fakeNow.getTime() + (Date.now() - fakeStart)) : new Date(); }

  function T() { return I18N[S.lang] || I18N.ms; }
  function u(k) { return T().ui[k]; }

  /* ---------- zon ---------- */
  function zoneOf(code) { return ZONES.filter(function (z) { return z.c === code; })[0] || ZONES.filter(function (z) { return z.c === 'PNG01'; })[0]; }
  function zoneShort(code) {
    var z = zoneOf(code);
    var sib = ZONES.filter(function (x) { return x.s === z.s; }).length;
    if (sib === 1) return z.s;
    var first = z.d.split(',')[0].replace(/\(.*/, '').trim();
    return first;
  }

  /* ---------- data waktu solat (JAKIM) ---------- */
  var API = 'https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat';
  var cache = { zone: null, days: {}, fetched: 0 };
  var loadState = 'idle'; // idle | loading | error

  function loadCache() {
    var c = load('isti.times.' + S.zone, null);
    cache = c && c.days ? c : { zone: S.zone, days: {}, fetched: 0 };
  }
  function pruneAndSave() {
    var cutoff = L.ymd(L.addDays(now(), -3));
    Object.keys(cache.days).forEach(function (k) { if (k < cutoff) delete cache.days[k]; });
    cache.zone = S.zone;
    save('isti.times.' + S.zone, cache);
  }
  function haveRange(n) {
    for (var i = 0; i < n; i++) if (!L.validDay(cache.days[L.ymd(L.addDays(now(), i))])) return false;
    return true;
  }
  function fetchPeriod(period) {
    return fetch(API + '&period=' + period + '&zone=' + encodeURIComponent(S.zone), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return L.normalizeJakim(typeof j === 'string' ? JSON.parse(j) : j); });
  }
  function refreshData(force) {
    if (!force && haveRange(10)) return Promise.resolve(false);
    loadState = 'loading'; render();
    var zone = S.zone;
    return fetchPeriod('year').catch(function () { return {}; })
      .then(function (a) {
        if (Object.keys(a).length && L.validDay(a[L.ymd(L.addDays(now(), 9))] || a[L.ymd(now())])) return a;
        return fetchPeriod('week').then(function (b) { return Object.assign(a, b); });
      })
      .then(function (days) {
        if (zone !== S.zone) return false;
        if (!Object.keys(days).length) throw new Error('kosong');
        Object.assign(cache.days, days);
        cache.fetched = Date.now();
        pruneAndSave();
        loadState = 'idle';
        return true;
      })
      .catch(function () { loadState = L.validDay(cache.days[L.ymd(now())]) ? 'idle' : 'error'; return false; })
      .then(function (changed) { render(); reschedule(); return changed; });
  }

  /* ---------- pengiraan hari ---------- */
  function dayModel(date, adj) {
    var t = cache.days[L.ymd(date)];
    if (!L.validDay(t)) return null;
    var h = L.hijriAt(date, adj);
    var flags = L.dayFlags(date, h, S.male);
    return { date: date, t: t, h: h, flags: flags, items: L.buildItems(t, flags) };
  }
  function adjustFor(date) {
    var t = cache.days[L.ymd(date)];
    return t ? L.hijriAdjust(date, L.parseJakimHijri(t.hijri)) : 0;
  }
  function itemText(k) {
    var it = T().items[k] || [k, ''];
    return { n: it[0], s: it[1].replace('{n}', S.tar) };
  }

  /* ---------- UI ---------- */
  var root = document.getElementById('app');
  var screen = 'utama';
  var filter = 'semua';
  var installEvt = null;
  var lastKey = '';

  var ICON = {
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    grid: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
    bell: function (on) { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>' + (on ? '' : '<path d="M4 4l16 16"/>') + '</svg>'; },
    compass: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
    moon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    cal: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    tasbih: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-width="3" stroke-dasharray="1 4.2"/><circle cx="12" cy="12" r="1.5"/></svg>',
    chk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    gear: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    info: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    star: '<svg width="130" height="130" viewBox="0 0 100 100" fill="none" stroke="#E3C46F" stroke-width="0.8" aria-hidden="true" class="deco"><rect x="18" y="18" width="64" height="64"/><rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)"/></svg>',
    logo: '<svg width="56" height="56" viewBox="0 0 100 100" role="img" aria-label="Ikon Istiqamah"><rect width="100" height="100" rx="18" fill="#0A2540"/><rect x="20" y="20" width="60" height="60" fill="none" stroke="#E3C46F" stroke-width="2"/><rect x="20" y="20" width="60" height="60" fill="none" stroke="#E3C46F" stroke-width="2" transform="rotate(45 50 50)"/><text x="50" y="71" text-anchor="middle" font-family="Amiri,serif" font-size="66" font-weight="700" fill="#E3C46F" stroke="none">ا</text></svg>'
  };

  function nav() {
    var lagiGroup = ['lagi', 'tetapan', 'tentang', 'qiam', 'kal', 'kiblat'].indexOf(screen) >= 0;
    function tab(go, on, icon, label) {
      return '<button data-go="' + go + '" class="' + (on ? 'on' : '') + '" aria-current="' + (on ? 'page' : 'false') + '">' + icon + label + '</button>';
    }
    return '<nav class="nav">' + tab('utama', screen === 'utama', ICON.home, u('utama')) + tab('zikir', screen === 'zikir', ICON.tasbih, u('zikir')) + tab('lagi', lagiGroup, ICON.grid, u('lagi')) + '</nav>';
  }

  function dateLine(d, h) {
    var t = T().ui;
    return t.hari[d.getDay()] + ', ' + d.getDate() + ' ' + t.bulanM[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + h.d + ' ' + t.bulanH[h.m - 1] + ' ' + h.y;
  }
  function sambutanLine(today, adj, h) {
    var t = T(), parts = [];
    var s = L.nextSambutan(today, adj, 7);
    if (h.m === 9 && !s) parts.push(t.ui.hariKe.replace('{n}', h.d));
    if (s) {
      var name = t.sambutan[s.key];
      if (s.days === 0) parts.push(t.ui.hariIni + ' · ' + name);
      else parts.push(name + ' · ' + t.ui.lagiHari.replace('{n}', s.days) + ' · ' + t.ui.anggaran + ' ' + s.date.getDate() + ' ' + t.ui.bulanM[s.date.getMonth()]);
    }
    return parts.join(' · ');
  }

  function header(zoneText, line2, line3) {
    return '<header class="banner">' + ICON.star +
      '<div class="b1"><div class="bt">Istiqamah</div><div class="bz">' + zoneText + '</div></div>' +
      '<div class="b2">' + line2 + '</div><div class="b3"' + (line3 ? '' : ' hidden') + '>' + line3 + '</div></header>';
  }

  function viewUtama() {
    var today = now();
    var adj = adjustFor(today);
    var td = dayModel(today, adj);
    var zshort = zoneShort(S.zone);
    if (!td) {
      var msg = loadState === 'loading' ? u('memuat') : u('tiadaData');
      var hh = L.umalqura(today);
      return header(zshort, dateLine(today, hh), '') +
        '<main class="empty"><p>' + msg + '</p>' + (loadState === 'loading' ? '' : '<button class="btn" data-act="retry">' + u('cuba') + '</button>') + '</main>';
    }
    var tm = dayModel(L.addDays(today, 1), adj) || { items: td.items, h: td.h, flags: td.flags };
    var nowMin = today.getHours() * 60 + today.getMinutes();
    var nx = L.findNext([{ items: td.items }, { items: tm.items }], nowMin);
    var next = nx.next;

    var h = td.h;
    var hdr = header(zshort, dateLine(today, h), sambutanLine(today, adj, h));

    // hero
    var hero = '';
    if (next) {
      var it = next.item, tx = itemText(it.k);
      var label = it.k === 'raya' ? u('seterusnyaRaya') : (it.fardu ? u('seterusnyaFardu') : u('seterusnyaSunat'));
      var sub = (next.dayOffset ? u('besok') : '') + it.t + ' · ' + tx.s.split(' · ').slice(1).join(' · ');
      var d = next.delta;
      var count = d < 60 ? d + ' ' + u('min') : Math.floor(d / 60) + ' ' + u('j') + ' ' + (d % 60) + ' ' + u('min');
      var line = '';
      if (it.fardu) { if (nx.nextSunat) line = u('sunatNext') + itemText(nx.nextSunat.item.k).n + ' ' + (nx.nextSunat.dayOffset ? u('besok') : '') + nx.nextSunat.item.t; }
      else if (nx.nextFardu) line = u('farduNext') + itemText(nx.nextFardu.item.k).n + ' ' + (nx.nextFardu.dayOffset ? u('besok') : '') + nx.nextFardu.item.t;
      hero = '<section class="hero" aria-live="polite">' + ICON.star.replace('class="deco"', 'class="deco deco2"') +
        '<div class="hr"><div><div class="hl">' + label + '</div><div class="hn">' + tx.n + '</div><div class="hs">' + sub + '</div></div>' +
        '<div class="hc">' + count + '</div></div><div class="hline">' + line + '</div></section>';
    }

    // chips
    var chips = ['semua', 'fardu', 'sunat'].map(function (k) {
      return '<button class="chip' + (filter === k ? ' on' : '') + '" data-filter="' + k + '" aria-pressed="' + (filter === k) + '">' + u(k) + '</button>';
    }).join('');

    // tarawih
    var tar = '';
    if (td.flags.ramadan) {
      tar = '<div class="tar" role="group" aria-label="' + u('tarawih') + '"><span>' + u('tarawih') + '</span>' + [8, 10, 20].map(function (n) {
        return '<button class="chip sm' + (S.tar === n ? ' on' : '') + '" data-tar="' + n + '" aria-pressed="' + (S.tar === n) + '">' + n + ' ' + u('rakaat') + '</button>';
      }).join('') + '</div>';
    }

    // baris
    var rows = '';
    td.items.forEach(function (it) {
      if (filter === 'fardu' && !it.fardu) return;
      if (filter === 'sunat' && it.fardu) return;
      var tx = itemText(it.k), on = L.bellOn(S.bells, it.k);
      var st = it.m < nowMin ? 'done' : (next && next.dayOffset === 0 && next.item === it ? 'next' : 'later');
      rows += '<div class="row ' + st + (it.fardu ? ' fardu' : '') + (it.k === 'raya' ? ' raya' : '') + '" data-k="' + it.k + '">' +
        '<div class="rt">' + it.t + '</div><div><div class="rn">' + tx.n + '</div><div class="rs">' + tx.s + '</div></div>' +
        '<button class="bell' + (on ? ' on' : '') + '" data-bell="' + it.k + '" aria-pressed="' + on + '" aria-label="' + u('notif') + tx.n + '">' + ICON.bell(on) + '</button></div>';
    });
    if (filter !== 'fardu') {
      rows += '<div class="sec"><div class="sh">' + u('bilaBila') + '</div><div class="sn">' + u('larangan') + '</div></div>';
      L.freeItems(td.flags).forEach(function (k) {
        var tx = itemText(k);
        rows += '<div class="row later free"><div class="rt sm">' + u('bila') + '</div><div><div class="rn">' + tx.n + '</div><div class="rs">' + tx.s + '</div></div><span></span></div>';
      });
    }
    return hdr + hero + '<div class="chips" role="group" aria-label="Tapis">' + chips + '</div><div class="list" id="list">' + tar + rows + '</div>';
  }

  function viewLagi() {
    return '<header class="banner plain">' + ICON.star + '<div class="pt">' + u('lagi') + '</div><div class="ps">' + u('lagiSub') + '</div></header>' +
      '<main class="scroll"><div class="grid">' +
      '<button class="tile" data-go="qiam">' + ICON.moon + u('qiam') + '</button>' +
      '<button class="tile" data-go="kal">' + ICON.cal + u('kal') + '</button>' +
      '<button class="tile" data-go="kiblat">' + ICON.compass + u('kiblat') + '</button>' +
      '<button class="tile" data-go="tetapan">' + ICON.gear + u('tetapan') + '</button>' +
      '<button class="tile" data-go="tentang">' + ICON.info + u('tentang') + '</button></div></main>';
  }

  function topbar(title, back) {
    return '<div class="topbar">' + (back ? '<button class="back" data-go="lagi" aria-label="' + u('kembali') + '">' + ICON.back + '</button>' : '<span style="width:12px"></span>') + '<div class="tt">' + title + '</div></div>';
  }

  function viewTetapan() {
    var states = [];
    ZONES.forEach(function (z) { if (states.indexOf(z.s) < 0) states.push(z.s); });
    var opts = states.map(function (s) {
      return '<optgroup label="' + s + '">' + ZONES.filter(function (z) { return z.s === s; }).map(function (z) {
        return '<option value="' + z.c + '"' + (z.c === S.zone ? ' selected' : '') + '>' + z.c + ' · ' + z.d + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    function seg(name, val, items) {
      return '<div class="seg" role="group">' + items.map(function (i) {
        return '<button class="' + (val === i[0] ? 'on' : '') + '" data-set="' + name + '" data-val="' + i[0] + '" aria-pressed="' + (val === i[0]) + '">' + i[1] + '</button>';
      }).join('') + '</div>';
    }
    var perm = '';
    if (isNative) {
      perm = '<div class="card"><button class="btn wide" data-act="perm">' + u('izinNotif') + '</button><div class="note">' + u('izinNotifNota') + '</div>' +
        '<button class="btn wide ghost" data-act="exact" style="margin-top:10px">' + u('izinAlarm') + '</button><div class="note">' + u('izinAlarmNota') + '</div></div>';
    }
    return topbar(u('tetapan'), !firstRun) +
      '<main class="scroll">' + (firstRun ? '<div class="welcome">' + u('mulaiSetup') + '</div>' : '') +
      '<div class="card"><label class="lbl" for="zsel">' + u('zon') + '</label><select id="zsel" class="sel">' + opts + '</select></div>' +
      '<div class="card"><div class="lbl">' + u('jantina') + '</div>' + seg('male', S.male ? 1 : 0, [[1, u('lelaki')], [0, u('perempuan')]]) + '<div class="note">' + u('jantinaNota') + '</div></div>' +
      '<div class="card"><div class="lbl">' + u('bahasa') + '</div>' + seg('lang', S.lang, [['ms', 'Bahasa Melayu'], ['en', 'English']]) + '</div>' +
      '<div class="card"><div class="lbl">' + u('tarawih') + '</div>' + seg('tar', S.tar, [[8, '8'], [10, '10'], [20, '20']]) + '</div>' +
      perm +
      (firstRun ? '<button class="btn wide" data-act="done" style="margin-top:6px">' + u('selesai') + '</button>' : '<button class="btn wide ghost" data-act="refresh">' + u('kemaskini') + '</button>') +
      '</main>';
  }

  function viewTentang() {
    var showInstall = !isNative;
    return topbar(u('tentang'), true) +
      '<main class="scroll">' +
      '<div class="card about"><div class="logo">' + ICON.logo + '</div><div style="flex:1"><div class="an">Istiqamah</div><div class="av">' + u('versi') + ' ' + APP_VERSION + '</div>' +
      (showInstall ? '<button class="btn sm" data-act="install">' + u('pasang') + '</button>' : '') + '</div></div>' +
      '<div class="card"><div class="lbl gold">' + u('baharuTitle') + ' · v' + APP_VERSION + '</div><div class="bul">' + u('baharu').map(function (x) { return '<div>• ' + x + '</div>'; }).join('') + '</div></div>' +
      '<div class="card qr"><div class="lbl gold" style="text-align:left">' + u('sokongTitle') + '</div><div class="bul" style="text-align:left">' + u('sokongIntro') + '</div>' +
      '<div class="qrbox"><img src="img/duitnow-qr.jpg" alt="DuitNow QR Istiqamah, Bank Islam"></div>' +
      '<div class="note">' + u('imbas') + '</div><div class="note"><b>' + u('telefonSama') + '</b>' + u('telefonSamaRest') + '</div>' +
      '<button class="btn wide" data-act="saveqr" style="margin-top:14px">' + u('simpanQR') + '</button></div>' +
      '<div class="card"><div class="lbl gold">' + u('maklumBalas') + '</div><button class="btn wide ghost" data-act="mail" style="margin-top:8px">' + u('hantar') + '</button><div class="note">' + u('hantarNota') + '</div></div>' +
      '<div class="card dis"><div class="lbl">' + u('penafianTitle') + '</div><div class="dt">' + u('penafian') + '</div></div>' +
      '<div class="foot"><b>Istiqamah</b> • Developed by FaridAssamani • ©2026 • v' + APP_VERSION + '</div></main>';
  }

  function fmt12(hhmm) {
    var h = parseInt(hhmm.slice(0, 2), 10), m = hhmm.slice(3, 5);
    var ap = h < 12 ? u('pagi') : u('petang');
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m + ' ' + ap;
  }

  /* ----- Zikir ----- */
  function zList() {
    return ZDEF.map(function (d) { var z = T().zk[d[0]]; return { id: d[0], n: z[0], ar: z[1], t: d[1] }; })
      .concat(Z.custom.map(function (c) { return { id: c.id, n: c.n, ar: '', t: c.t, custom: true }; }));
  }
  function zCur() { var l = zList(); return l.filter(function (x) { return x.id === Z.sel; })[0] || l[0]; }
  function zTarget(it) { return Z.targets[it.id] || it.t; }
  var CIRC = 691.15, zForm = false;
  function viewZikir() {
    var it = zCur(), tg = zTarget(it), c = Z.counts[it.id] || 0, frac = Math.min(1, c / tg);
    var rows = zList().map(function (x) {
      return '<div class="zrow' + (x.id === it.id ? ' on' : '') + '"><button class="zsel" data-zsel="' + esc(x.id) + '" aria-pressed="' + (x.id === it.id) + '"><span>' + esc(x.n) + '</span><span class="zn">× ' + zTarget(x) + '</span></button>' +
        (x.custom ? '<button class="zdel" data-zdel="' + esc(x.id) + '" aria-label="' + u('buang') + ' ' + esc(x.n) + '">✕</button>' : '') + '</div>';
    }).join('');
    var form = zForm ? '<div class="zform"><input id="zname" class="inp" maxlength="40" placeholder="' + u('namaItem') + '" aria-label="' + u('namaItem') + '"><input id="zcnt" class="inp" type="number" inputmode="numeric" min="1" max="100000" value="33" aria-label="' + u('bilangan') + '"><div class="zbtns"><button class="zb gold" data-act="zsave">' + u('simpan') + '</button><button class="zb" data-act="zcancel">' + u('batal') + '</button></div></div>' : '';
    return '<div class="zhead"><div><div class="pt">' + u('zikir') + '</div><div class="ps" id="zsub">' + u('zikirSub').replace('{n}', tg) + '</div></div><div class="zcur">' + esc(it.n) + '</div></div>' +
      '<div class="zscroll"><button class="ring" data-act="zcount" aria-label="' + esc(it.n) + ' ' + u('ketikKira') + '">' +
      '<svg class="ringsvg" width="260" height="260" viewBox="0 0 260 260" fill="none" aria-hidden="true"><circle cx="130" cy="130" r="110" stroke="#1C4268" stroke-width="12"/><circle id="zr" cx="130" cy="130" r="110" stroke="#E3C46F" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (frac * CIRC).toFixed(1) + ' ' + CIRC + '" transform="rotate(-90 130 130)"/></svg>' +
      '<svg width="200" height="200" viewBox="0 0 100 100" fill="none" stroke="#E3C46F" stroke-width="0.6" aria-hidden="true" class="ringstar"><rect x="18" y="18" width="64" height="64"/><rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)"/></svg>' +
      '<span class="ringin"><span class="zar" lang="ar" dir="rtl">' + (it.ar ? esc(it.ar) : '&nbsp;') + '</span><span class="zcnum" id="zc">' + c + '</span><span class="zof" id="zof">' + u('daripada').replace('{n}', tg) + '</span></span></button>' +
      '<div class="zhint">' + u('ketikKira') + '</div>' +
      '<div class="zctl"><button data-act="zreset">' + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/></svg>' + u('setSemula') + '</button>' +
      '<button data-act="zvib" aria-pressed="' + !!Z.vibrate + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8"/></svg>' + u('getar') + (Z.vibrate ? u('hidup') : u('mati')) + '</button>' +
      '<button data-act="ztarget"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>' + u('sasaran') + tg + '</button></div>' +
      '<div class="zlh"><div class="zlt">' + u('senaraiZikir') + '</div><button class="zadd" data-act="zadd">' + u('tambah') + '</button></div>' + form +
      '<div class="zlist">' + rows + '</div></div>';
  }
  function zRefresh() {
    var it = zCur(), tg = zTarget(it), c = Z.counts[it.id] || 0;
    var zc = document.getElementById('zc'); if (!zc) return;
    zc.textContent = c;
    document.getElementById('zr').setAttribute('stroke-dasharray', (Math.min(1, c / tg) * CIRC).toFixed(1) + ' ' + CIRC);
    document.getElementById('zof').textContent = u('daripada').replace('{n}', tg);
  }
  function buzz(p) { try { if (Z.vibrate && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* abaikan */ } }

  /* ----- Qiamullail ----- */
  var qEdit = false, qForm = false;
  function nightId() {
    var d = now(), td = dayModel(d, adjustFor(d)), nm = d.getHours() * 60 + d.getMinutes();
    var fajr = td ? L.mins(td.t.fajr) : 355;
    return L.ymd(nm < fajr ? L.addDays(d, -1) : d);
  }
  function qSync() { var n = nightId(); if (Q.night !== n) { Q.night = n; Q.done = []; qSave(); } }
  function qName(i) { return i.key ? (T().items[i.key] || [i.key, ''])[0] : i.n; }
  function qSub(i) { return i.key ? (T().items[i.key] || ['', ''])[1] : (i.s || ''); }
  function viewQiam() {
    qSync();
    var d = now(), td = dayModel(d, adjustFor(d));
    var range = '';
    if (td) {
      var taj = td.items.filter(function (x) { return x.k === 'tahajud'; })[0];
      range = u('qiamSub').replace('{a}', fmt12(taj.t)).replace('{b}', fmt12(td.t.fajr.slice(0, 5)));
    }
    var total = Q.items.length, done = Q.items.filter(function (i) { return Q.done.indexOf(i.id) >= 0; }).length;
    var rows = Q.items.map(function (i) {
      var on = Q.done.indexOf(i.id) >= 0;
      return '<div class="qrow' + (on ? ' done' : '') + '"><button class="qchk" role="checkbox" aria-checked="' + on + '" data-qchk="' + esc(i.id) + '" aria-label="' + esc(qName(i)) + '">' + (on ? ICON.chk : '') + '</button>' +
        '<div class="qt"><div class="rn">' + esc(qName(i)) + '</div><div class="rs">' + esc(qSub(i)) + '</div></div>' +
        (qEdit ? '<button class="zdel" data-qdel="' + esc(i.id) + '" aria-label="' + u('buang') + ' ' + esc(qName(i)) + '">✕</button>' : '<span></span>') + '</div>';
    }).join('');
    var form = qForm ? '<div class="zform"><input id="qname" class="inp" maxlength="50" placeholder="' + u('namaItem') + '" aria-label="' + u('namaItem') + '"><div class="zbtns"><button class="zb gold" data-act="qsave">' + u('simpan') + '</button><button class="zb" data-act="qcancel">' + u('batal') + '</button></div></div>' : '';
    return '<header class="banner plain">' + ICON.star + '<div class="qtop"><button class="back" data-go="lagi" aria-label="' + u('kembali') + '">' + ICON.back + '</button><div><div class="pt">' + u('qiam') + '</div><div class="ps">' + range + '</div></div></div></header>' +
      '<main class="scroll"><div class="qh"><div class="qhl">' + u('qiamSenarai') + '</div><div class="qhn">' + done + ' / ' + total + '</div></div>' +
      '<div class="bar"><div style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></div></div><div class="note" style="margin:6px 0 12px">' + u('qiamReset') + '</div>' +
      rows + form +
      '<div class="qact"><button class="zadd dk" data-act="qadd">' + u('tambah') + '</button><button class="zadd dk" data-act="qedit">' + (qEdit ? u('siap') : u('ubah')) + '</button></div>' +
      '<div class="card dis" style="margin-top:14px"><div class="lbl">' + u('qiamNota') + '</div><div class="dt">' + u('qiamNotaTeks') + '</div></div></main>';
  }

  /* ----- Kalendar Hijrah ----- */
  function calEvents() {
    var today = now(), adj = adjustFor(today), seen = {}, out = [];
    for (var i = 0; i <= 420; i++) {
      var dt = L.addDays(today, i), h = L.hijriAt(dt, adj), k = L.sambutanOf(h);
      if (k && !seen[k]) { seen[k] = 1; out.push({ k: k, days: i, date: dt, h: h }); }
    }
    return out;
  }
  function viewKal() {
    var t = T(), ev = calEvents();
    function gline(e) { var d = e.date; return t.ui.hari[d.getDay()] + ', ' + d.getDate() + ' ' + t.ui.bulanM[d.getMonth()] + ' ' + d.getFullYear() + ' (' + t.ui.anggaran + ')'; }
    function days(e) { return e.days === 0 ? t.ui.hariIniShort : t.ui.hariLagi.replace('{n}', e.days); }
    var hero = ev[0] ? '<section class="hero kh">' + ICON.star.replace('class="deco"', 'class="deco deco2"') + '<div class="hl">' + t.ui.kalHero + '</div><div class="hn">' + t.sambutan[ev[0].k] + '</div><div class="hs">' + ev[0].h.d + ' ' + t.ui.bulanH[ev[0].h.m - 1] + ' ' + ev[0].h.y + ' · ' + gline(ev[0]) + '</div><div class="hline" style="border:0;padding-top:2px;margin-top:4px;min-height:0">' + days(ev[0]) + '</div></section>' : '';
    var rows = ev.map(function (e) {
      var on = sbellOn(e.k), big = !!SBELL_DEF[e.k], name = t.sambutan[e.k];
      return '<div class="row krow' + (big ? ' raya' : '') + '"><div class="rt kd">' + (e.days === 0 ? t.ui.hariIniShort : e.days + ' ' + (S.lang === 'en' ? 'd' : 'hari')) + '</div><div><div class="rn">' + name + '</div><div class="rs">' + e.h.d + ' ' + t.ui.bulanH[e.h.m - 1] + ' ' + e.h.y + ' · ' + gline(e) + '</div></div>' +
        '<button class="bell' + (on ? ' on' : '') + '" data-sbell="' + e.k + '" aria-pressed="' + on + '" aria-label="' + t.ui.ingatan + name + '">' + ICON.bell(on) + '</button></div>';
    }).join('');
    return '<div class="topbar"><button class="back" data-go="lagi" aria-label="' + u('kembali') + '">' + ICON.back + '</button><div class="tt">' + u('kal') + '</div></div>' +
      '<main class="scroll">' + hero + '<div class="sh" style="margin:14px 4px 8px">' + u('kalAkan') + '</div>' + rows + '<div class="note" style="margin:10px 4px 0">' + u('kalNota') + '</div></main>';
  }

  /* ----- Kiblat ----- */
  var kb = { loc: load('isti.loc', null), h: null, aligned: false, finding: false, noSensor: false, err: '', timer: null, on: false };
  function kbBearing() { return kb.loc ? L.qiblaBearing(kb.loc.lat, kb.loc.lng) : null; }
  function viewKiblat() {
    var b = kbBearing(), t = T().ui;
    var dir = b === null ? '' : t.mata[L.compassIndex(b)] + ' · ' + zoneShort(S.zone);
    var lt = t.hurufMata;
    return '<div class="topbar"><button class="back" data-go="lagi" aria-label="' + u('kembali') + '">' + ICON.back + '</button><div class="tt">' + u('kiblat') + '</div></div>' +
      '<main class="scroll kbm"><div class="kbh"><div class="kbl">' + u('kbLabel') + '</div><div class="kbdeg" id="kbdeg">' + (b === null ? '—' : Math.round(b) + '°') + '</div><div class="kbsub" id="kbsub">' + dir + '</div></div>' +
      '<div class="kbwrap"><div id="kbdial" class="kbdial"><svg width="300" height="300" viewBox="0 0 300 300" fill="none" aria-hidden="true">' +
      '<circle cx="150" cy="150" r="140" stroke="#1C4268" stroke-width="2" fill="#0C2D4D"/><circle cx="150" cy="150" r="118" stroke="#1C4268" stroke-width="1"/>' +
      '<g stroke="#2B5681" stroke-width="2"><path d="M150 14v14M150 272v14M14 150h14M272 150h14"/></g><g stroke="#2B5681" stroke-width="1"><path d="M246 54l-8 8M54 54l8 8M246 246l-8-8M54 246l8-8"/></g>' +
      '<text x="150" y="50" text-anchor="middle" fill="#F4EFE0" font-size="16" font-weight="700" font-family="Plus Jakarta Sans,sans-serif">' + lt[0] + '</text>' +
      '<text x="256" y="156" text-anchor="middle" fill="#9DB6CF" font-size="14" font-family="Plus Jakarta Sans,sans-serif">' + lt[1] + '</text>' +
      '<text x="150" y="266" text-anchor="middle" fill="#9DB6CF" font-size="14" font-family="Plus Jakarta Sans,sans-serif">' + lt[2] + '</text>' +
      '<text x="44" y="156" text-anchor="middle" fill="#9DB6CF" font-size="14" font-family="Plus Jakarta Sans,sans-serif">' + lt[3] + '</text>' +
      (b === null ? '' : '<g transform="rotate(' + b.toFixed(1) + ' 150 150)"><path d="M150 150V40" stroke="#E3C46F" stroke-width="2" stroke-dasharray="4 5"/><rect x="136" y="14" width="28" height="28" rx="6" fill="#E3C46F"/><rect x="141" y="22" width="18" height="16" fill="#0A2540"/><rect x="141" y="25" width="18" height="3" fill="#E3C46F"/></g>') +
      '</svg></div><svg class="kbptr" width="300" height="300" viewBox="0 0 300 300" fill="none" aria-hidden="true"><path id="kbptr" d="M150 6l9 16h-18z" fill="#F4EFE0"/><circle cx="150" cy="150" r="6" fill="#E3C46F"/></svg></div>' +
      '<div class="kbstat" id="kbstat" role="status" aria-live="polite"></div>' +
      '<div class="kbnote">' + u('kbTips') + '</div>' +
      '<button class="kbbtn" data-act="kbloc">' + u('kbKemas') + '</button></main>';
  }
  function kbStatusText(diff) {
    if (kb.finding) return u('kbMencari');
    if (!kb.loc) return kb.err || u('kbTiadaLoc');
    if (kb.noSensor) return u('kbTiadaSensor');
    if (kb.h === null) return '';
    if (kb.aligned) return u('kbTepat');
    return diff < 0 ? u('kbKiri') : u('kbKanan');
  }
  function kbUpdate() {
    var dial = document.getElementById('kbdial'); if (!dial) return;
    var b = kbBearing(), diff = 0;
    var heading = kb.h === null ? 0 : kb.h;
    dial.style.transform = 'rotate(' + (-heading).toFixed(1) + 'deg)';
    if (b !== null && kb.h !== null) diff = L.angDiff(kb.h, b);
    var al = b !== null && kb.h !== null && Math.abs(diff) <= 4;
    if (al && !kb.aligned) { try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* abaikan */ } }
    kb.aligned = al;
    var st = document.getElementById('kbstat'); st.textContent = kbStatusText(diff); st.className = 'kbstat' + (al ? ' ok' : '');
    document.getElementById('kbptr').setAttribute('fill', al ? '#3DDC97' : '#F4EFE0');
  }
  function kbOri(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.alpha !== null && e.alpha !== undefined && (e.absolute || e.type === 'deviceorientationabsolute')) h = (360 - e.alpha) % 360;
    if (h === null) return;
    kb.noSensor = false;
    kb.h = kb.h === null ? h : (kb.h + 0.3 * L.angDiff(kb.h, h) + 360) % 360;
    kbUpdate();
  }
  function kbStart() {
    if (kb.on) return; kb.on = true; kb.h = null; kb.noSensor = false;
    window.addEventListener('deviceorientationabsolute', kbOri, true);
    window.addEventListener('deviceorientation', kbOri, true);
    clearTimeout(kb.timer);
    kb.timer = setTimeout(function () { if (kb.h === null) { kb.noSensor = true; kbUpdate(); } }, 2000);
    if (!kb.loc) kbLocate();
  }
  function kbStop() {
    if (!kb.on) return; kb.on = false; clearTimeout(kb.timer);
    window.removeEventListener('deviceorientationabsolute', kbOri, true);
    window.removeEventListener('deviceorientation', kbOri, true);
  }
  function kbLocate() {
    if (!navigator.geolocation) { kb.err = u('kbTiadaLoc'); return kbUpdate(); }
    kb.finding = true; kb.err = ''; kbUpdate();
    navigator.geolocation.getCurrentPosition(function (pos) {
      kb.finding = false; kb.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; save('isti.loc', kb.loc);
      if (screen === 'kiblat') render();
    }, function () {
      kb.finding = false; kb.err = u('kbTiadaLoc'); kbUpdate();
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }

  /* ----- Widget skrin utama (Android) ----- */
  var WGT = isNative && Cap.Plugins ? Cap.Plugins.IstiWidget : null;
  var wReady = !WGT, wTimer = null;
  function widgetSync() {
    if (!WGT || !wReady) return;
    clearTimeout(wTimer);
    wTimer = setTimeout(doWidgetSync, 600);
  }
  function doWidgetSync() {
    var today = now(), adj = adjustFor(today), days = [], t = T();
    for (var i = 0; i < 4; i++) {
      var date = L.addDays(today, i), dm = dayModel(date, adj);
      if (!dm) continue;
      var tt = dm.t;
      days.push({
        ymd: L.ymd(date),
        hijri: dm.h.d + ' ' + t.ui.bulanH[dm.h.m - 1] + ' ' + dm.h.y,
        p: { subuh: tt.fajr.slice(0, 5), syuruk: tt.syuruk.slice(0, 5), zohor: tt.dhuhr.slice(0, 5), asar: tt.asr.slice(0, 5), maghrib: tt.maghrib.slice(0, 5), isyak: tt.isha.slice(0, 5) },
        items: dm.items.map(function (it) {
          var tx = itemText(it.k);
          return { n: tx.n, s: tx.s.split(' · ').slice(1).join(' · '), t: it.t, f: it.fardu ? 1 : 0 };
        })
      });
    }
    var labels = {
      seterusnya: t.ui.wSeterusnya, sunatNext: t.ui.wSunat, tinggal: t.ui.wTinggal, zikirTap: t.ui.wZikir,
      am: t.ui.pagi, pm: t.ui.petang, dow: t.ui.hari, mon: t.ui.bulanM,
      subuh: t.items.subuh[0], syuruk: t.ui.syuruk, zohor: t.items.zohor[0], asar: t.items.asar[0], maghrib: t.items.maghrib[0], isyak: t.items.isyak[0]
    };
    var zc = zCur();
    WGT.sync({ data: JSON.stringify({ zone: zoneShort(S.zone), days: days, labels: labels }), zid: zc.id, zn: zc.n, zt: zTarget(zc), zc: Z.counts[zc.id] || 0 }).catch(function () { /* abaikan */ });
  }
  function pullZikir() {
    if (!WGT) return Promise.resolve();
    return WGT.getZikir().then(function (r) {
      if (r && r.id && typeof r.c === 'number' && zList().some(function (x) { return x.id === r.id; })) {
        if ((Z.counts[r.id] || 0) !== r.c) { Z.counts[r.id] = r.c; zSave(); if (screen === 'zikir') render(); }
      }
    }).catch(function () { /* abaikan */ }).then(function () { wReady = true; widgetSync(); });
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function render() {
    var scrollTop = 0, l0 = document.getElementById('list');
    if (l0) scrollTop = l0.scrollTop;
    var html;
    if (firstRun) screen = 'tetapan';
    if (screen === 'utama') html = viewUtama();
    else if (screen === 'zikir') html = viewZikir();
    else if (screen === 'qiam') html = viewQiam();
    else if (screen === 'kal') html = viewKal();
    else if (screen === 'kiblat') html = viewKiblat();
    else if (screen === 'lagi') html = viewLagi();
    else if (screen === 'tetapan') html = viewTetapan();
    else html = viewTentang();
    var withNav = !firstRun;
    root.className = screen === 'zikir' || screen === 'kiblat' ? 'dark' : '';
    root.innerHTML = '<div class="screen">' + html + '</div>' + (withNav ? nav() : '');
    document.documentElement.lang = S.lang === 'en' ? 'en' : 'ms';
    if (screen === 'kiblat') { kbStart(); kbUpdate(); } else kbStop();
    widgetSync();
    var l1 = document.getElementById('list');
    if (l1) {
      var key = screen + filter + S.lang;
      if (key !== lastKey) { // skrol ke item seterusnya
        lastKey = key;
        var nxt = l1.querySelector('.row.next') || l1.querySelector('.row.later');
        l1.scrollTop = nxt ? Math.max(0, nxt.offsetTop - l1.offsetTop - 8) : 0;
      } else l1.scrollTop = scrollTop;
    }
  }

  function go(s, push) {
    screen = s;
    if (push && (s === 'tetapan' || s === 'tentang' || s === 'qiam' || s === 'kal' || s === 'kiblat')) history.pushState({ s: s }, '');
    render();
    if (s === 'utama') refreshData(false);
  }
  window.addEventListener('popstate', function () { if (!firstRun) { screen = 'lagi'; render(); } });

  /* ---------- notifikasi ---------- */
  var NT = { ms: { f: 'Masuk waktu ', s: 'Waktu sunat ' }, en: { f: 'It is time for ', s: 'Sunnah time: ' } };
  var NOTIF_DAYS = 7;
  var reschedTimer = null;
  function reschedule() {
    if (!LN) return;
    clearTimeout(reschedTimer);
    reschedTimer = setTimeout(doReschedule, 400);
  }
  function doReschedule() {
    var chain = LN.createChannel ? LN.createChannel({ id: 'waktu', name: S.lang === 'en' ? 'Prayer times' : 'Waktu solat', description: '', importance: 5, visibility: 1, vibration: true }).catch(function () {}) : Promise.resolve();
    chain.then(function () { return LN.getPending(); })
      .then(function (p) { return p.notifications && p.notifications.length ? LN.cancel({ notifications: p.notifications }) : null; })
      .then(function () {
        var list = [], today = now(), adj = adjustFor(today), nowTs = Date.now();
        for (var i = 0; i < NOTIF_DAYS; i++) {
          var date = L.addDays(today, i), dm = dayModel(date, adj);
          if (!dm) continue;
          dm.items.forEach(function (it, idx) {
            if (!L.bellOn(S.bells, it.k)) return;
            var at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(it.m / 60), it.m % 60, 0);
            if (at.getTime() <= nowTs + 5000) return;
            var tx = itemText(it.k), nt = NT[S.lang] || NT.ms;
            list.push({
              id: (L.dayIndex(date) - 18000) * 40 + idx + 1,
              title: tx.n,
              body: (it.fardu ? nt.f : nt.s) + tx.n + ' · ' + it.t + ' · ' + zoneShort(S.zone),
              schedule: { at: at, allowWhileIdle: true },
              channelId: 'waktu', smallIcon: 'ic_stat_istiqamah', iconColor: '#0E7C66'
            });
          });
        }
        calEvents().forEach(function (e, idx) {
          if (e.days > 8 || !sbellOn(e.k)) return;
          var at = new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate() - 1, 20, 0, 0);
          if (at.getTime() <= nowTs + 5000) return;
          list.push({
            id: 5000000 + (L.dayIndex(e.date) - 18000) * 10 + idx,
            title: T().sambutan[e.k], body: u('sambutanNotif') + T().sambutan[e.k],
            schedule: { at: at, allowWhileIdle: true },
            channelId: 'waktu', smallIcon: 'ic_stat_istiqamah', iconColor: '#0E7C66'
          });
        });
        return list.length ? LN.schedule({ notifications: list }) : null;
      })
      .catch(function () { /* izin belum diberi */ });
  }
  function askPermission() {
    if (!LN) return Promise.resolve();
    return LN.requestPermissions().then(function (r) {
      if (r.display !== 'granted') toast(u('tiadaNotif'));
      reschedule();
    }).catch(function () {});
  }
  function askExact() {
    if (!LN || !LN.changeExactNotificationSetting) return;
    LN.checkExactNotificationSetting().then(function (r) {
      if (r.exact_alarm !== 'granted') return LN.changeExactNotificationSetting();
    }).catch(function () {});
  }

  /* ---------- simpan QR ---------- */
  function saveQR() {
    var url = 'img/duitnow-qr.jpg';
    var Media = isNative && Cap.Plugins ? Cap.Plugins.Media : null;
    if (Media) {
      fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (res, rej) {
          var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b);
        });
      }).then(function (data) { return Media.savePhoto({ path: data, fileName: 'Istiqamah-DuitNow-QR' }); })
        .then(function () { toast(u('qrDisimpan')); })
        .catch(function () { toast(u('qrGagal')); });
      return;
    }
    var a = document.createElement('a');
    a.href = url; a.download = 'Istiqamah-DuitNow-QR.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    toast(u('qrDisimpan'));
  }

  /* ---------- acara ---------- */
  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-go],[data-filter],[data-bell],[data-tar],[data-set],[data-act],[data-zsel],[data-zdel],[data-qchk],[data-qdel],[data-sbell]');
    if (!el) return;
    if (el.dataset.go) return go(el.dataset.go, true);
    if (el.dataset.filter) { filter = el.dataset.filter; return render(); }
    if (el.dataset.bell) {
      var k = el.dataset.bell;
      S.bells[k] = L.bellOn(S.bells, k) ? 0 : 1; persist(); reschedule(); return render();
    }
    if (el.dataset.tar) { S.tar = +el.dataset.tar; persist(); reschedule(); return render(); }
    if (el.dataset.set) {
      var n = el.dataset.set, v = el.dataset.val;
      if (n === 'male') S.male = v === '1';
      else if (n === 'lang') S.lang = v;
      else if (n === 'tar') S.tar = +v;
      persist(); reschedule(); return render();
    }
    if (el.dataset.zsel) { Z.sel = el.dataset.zsel; zSave(); return render(); }
    if (el.dataset.zdel) {
      Z.custom = Z.custom.filter(function (c) { return c.id !== el.dataset.zdel; });
      if (Z.sel === el.dataset.zdel) Z.sel = 'subhanallah';
      zSave(); return render();
    }
    if (el.dataset.qchk) {
      var qi = Q.done.indexOf(el.dataset.qchk);
      if (qi >= 0) Q.done.splice(qi, 1); else Q.done.push(el.dataset.qchk);
      qSave(); return render();
    }
    if (el.dataset.qdel) { Q.items = Q.items.filter(function (i) { return i.id !== el.dataset.qdel; }); qSave(); return render(); }
    if (el.dataset.sbell) {
      var sk = el.dataset.sbell; S.sbells = S.sbells || {}; S.sbells[sk] = sbellOn(sk) ? 0 : 1; persist(); reschedule(); return render();
    }
    var a = el.dataset.act;
    if (a === 'zcount') {
      var zi = zCur(), zt = zTarget(zi), n1 = (Z.counts[zi.id] || 0) + 1;
      Z.counts[zi.id] = n1; zSave(); widgetSync(); buzz(n1 === zt ? [80, 50, 80] : 15); return zRefresh();
    }
    if (a === 'zreset') { Z.counts[zCur().id] = 0; zSave(); widgetSync(); return zRefresh(); }
    if (a === 'zvib') { Z.vibrate = !Z.vibrate; zSave(); buzz(30); return render(); }
    if (a === 'ztarget') {
      var cur = zCur(), opts = [33, 99, 100], ix = opts.indexOf(zTarget(cur));
      Z.targets[cur.id] = opts[(ix + 1) % opts.length]; zSave(); return render();
    }
    if (a === 'zadd') { zForm = true; return render(); }
    if (a === 'zcancel') { zForm = false; return render(); }
    if (a === 'zsave') {
      var zn = (document.getElementById('zname').value || '').trim(), zc2 = parseInt(document.getElementById('zcnt').value, 10);
      if (!zn) return document.getElementById('zname').focus();
      var cid = uid(); Z.custom.push({ id: cid, n: zn, t: zc2 > 0 ? zc2 : 33 }); Z.sel = cid; zForm = false; zSave(); return render();
    }
    if (a === 'qadd') { qForm = true; return render(); }
    if (a === 'qcancel') { qForm = false; return render(); }
    if (a === 'qedit') { qEdit = !qEdit; return render(); }
    if (a === 'qsave') {
      var qn = (document.getElementById('qname').value || '').trim();
      if (!qn) return document.getElementById('qname').focus();
      Q.items.push({ id: uid(), n: qn, s: '' }); qForm = false; qSave(); return render();
    }
    if (a === 'retry' || a === 'refresh') return refreshData(true).then(function (ok) { if (a === 'refresh' && ok) toast(u('dikemaskini')); });
    if (a === 'perm') return askPermission();
    if (a === 'exact') return askExact();
    if (a === 'done') {
      firstRun = false; persist(); screen = 'utama';
      askPermission().then(askExact);
      render(); return refreshData(false);
    }
    if (a === 'saveqr') return saveQR();
    if (a === 'kbloc') return kbLocate();
    if (a === 'mail') {
      var addr = ['fa.rawyadal', 'gmail.com'].join('@');
      location.href = 'mailto:' + addr + '?subject=' + encodeURIComponent(u('emelSubjek') + ' v' + APP_VERSION) + '&body=' + encodeURIComponent(u('emelBadan'));
      return;
    }
    if (a === 'install') {
      if (installEvt) { installEvt.prompt(); installEvt = null; } else toast(u('ikutSistem'));
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'zsel') {
      S.zone = e.target.value; persist(); loadCache();
      if (!firstRun) { refreshData(true); } else refreshData(false);
    }
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; });

  /* ---------- mula ---------- */
  loadCache();
  render();
  pullZikir();
  refreshData(false).then(function () { reschedule(); });

  var lastMin = -1;
  setInterval(function () {
    var d = now(), m = d.getHours() * 60 + d.getMinutes();
    if (m !== lastMin) { lastMin = m; if (screen === 'utama' && !firstRun) render(); }
  }, 15000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { wReady = !WGT; pullZikir().then(function () { render(); }); refreshData(false); reschedule(); }
  });
  if (isNative && Cap.Plugins && Cap.Plugins.App && Cap.Plugins.App.addListener) {
    Cap.Plugins.App.addListener('resume', function () { wReady = !WGT; pullZikir().then(function () { render(); }); refreshData(false); reschedule(); });
  }

  if (!isNative && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
