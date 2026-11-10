/* Istiqamah – UI, data JAKIM, notifikasi */
(function () {
  'use strict';
  var L = window.IstiLogic, I18N = window.ISTI_I18N, ZONES = window.ISTI_ZONES, ZPTS = window.ISTI_ZONEPTS || [];
  var APP_VERSION = '0.9.1';
  var params = new URLSearchParams(location.search);
  var Cap = window.Capacitor;
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  var LN = isNative && Cap.Plugins ? Cap.Plugins.LocalNotifications : null;

  /* ---------- storan ---------- */
  function load(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }

  var saved = load('isti.settings', null);
  var firstRun = !saved, mulaDone = false, renderedScreen = '';
  var S = Object.assign({ zone: 'PNG01', male: true, lang: 'ms', tar: 20, tahMode: 'fixed', tahMin: 240, zoneAuto: true, bells: {} }, saved || {});
  if (params.get('male') === '0') S.male = false;
  if (params.get('male') === '1') S.male = true;
  if (params.get('lang')) S.lang = params.get('lang');
  if (params.get('tar')) S.tar = +params.get('tar');
  function persist() { save('isti.settings', S); }
  function esc(x) { return String(x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36); }

  var ZG = ['subhanallah', 'alhamdulillah', 'akbar'];
  var Z = Object.assign({ sel: 'g_solat', step: 0, gdone: false, counts: {}, targets: {}, vibrate: true, custom: [], list: ['istighfar', 'lailaha'] }, load('isti.zikir', {}));
  if (ZG.indexOf(Z.sel) >= 0) { Z.step = ZG.indexOf(Z.sel); Z.sel = 'g_solat'; }
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
    if (S.zoneAuto && S.autoPlace && S.autoPlace.code === code && code === S.zone) return S.autoPlace.name;
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

  /* ---------- zon automatik (GPS) ---------- */
  var Zst = { busy: false, err: false, last: 0 };
  function autoZone(manual) {
    if (!S.zoneAuto || firstRun && !manual || Zst.busy || !navigator.geolocation) return Promise.resolve();
    if (!manual && Date.now() - Zst.last < 5 * 60 * 1000) return Promise.resolve();
    Zst.busy = true; Zst.last = Date.now();
    if (screen === 'tetapan') render();
    return new Promise(function (res) {
      navigator.geolocation.getCurrentPosition(res, function () { res(null); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
    }).then(function (pos) {
      Zst.busy = false;
      if (!pos) { Zst.err = true; if (manual) toast(u('zonLocGagal')); if (screen === 'tetapan') render(); return; }
      Zst.err = false;
      var loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      save('isti.loc', loc); if (typeof kb !== 'undefined') kb.loc = loc;
      var z = L.nearestZone(loc.lat, loc.lng, ZPTS);
      if (!z) { if (manual) toast(u('zonDiLuar')); if (screen === 'tetapan') render(); return; }
      S.autoPlace = { name: z.name, code: z.code, at: Date.now() };
      if (z.code === S.zone) { persist(); if (screen === 'tetapan' || screen === 'utama') render(); return; }
      var old = S.zone;
      S.zone = z.code; loadCache();
      return refreshData(true).then(function () {
        if (!L.validDay(cache.days[L.ymd(now())])) { // tiada data: kembali ke zon lama
          S.zone = old; S.autoPlace = null; loadCache(); persist(); render(); reschedule(); toast(u('zonTiadaData')); return;
        }
        S.zoneHist = [{ t: Date.now(), c: z.code, n: z.name }].concat(S.zoneHist || []).slice(0, 5);
        persist(); render(); reschedule();
        toast(u('zonBertukar').replace('{z}', z.name));
      });
    });
  }

  /* ---------- pengiraan hari ---------- */
  function dayModel(date, adj) {
    var t = cache.days[L.ymd(date)];
    if (!L.validDay(t)) return null;
    var h = L.hijriAt(date, adj);
    var flags = L.dayFlags(date, h, S.male);
    return { date: date, t: t, h: h, flags: flags, items: L.buildItems(t, flags, { tahMode: S.tahMode, tahMin: S.tahMin }) };
  }
  function adjustFor(date) {
    var t = cache.days[L.ymd(date)];
    return t ? L.hijriAdjust(date, L.parseJakimHijri(t.hijri)) : 0;
  }
  function itemText(k) {
    var it = T().items[k] || [k, ''];
    if (k === 'tahajud' && S.tahMode === 'fixed') return { n: it[0], s: u('tahSubTetap') };
    return { n: it[0], s: it[1].replace('{n}', S.tar) };
  }

  /* ---------- UI ---------- */
  var root = document.getElementById('app');
  var screen = 'utama';
  var filter = 'semua';
  var installEvt = null;
  var lastKey = '';

  var ICON = {
    trophy: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>',
    calnav: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
    grid: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
    bell: function (on) { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>' + (on ? '' : '<path d="M4 4l16 16"/>') + '</svg>'; },
    compass: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
    moon: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    cal: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    tasbih: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-width="3" stroke-dasharray="1 4.2"/><circle cx="12" cy="12" r="1.5"/></svg>',
    chk: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    mosque: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20v-7a7 7 0 0 1 14 0v7M3 20h18M12 3v3"/></svg>',
    speaker: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
    flag: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v18M6 4h11l-2 4 2 4H6"/></svg>',
    book: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 5.5C5 4.5 8.5 4.5 12 6c3.5-1.5 7-1.5 9-.5V19c-2-1-5.5-1-9 .5-3.5-1.5-7-1.5-9-.5z"/><path d="M12 6v13.5"/></svg>',
    doc: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/></svg>',
    bars: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 20V11M12 20V5M17 20v-6"/></svg>',
    plus: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9A8F6E" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/></svg>',
    gear: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    info: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    star: '<svg width="130" height="130" viewBox="0 0 100 100" fill="none" stroke="#E3C46F" stroke-width="0.8" aria-hidden="true" class="deco"><rect x="18" y="18" width="64" height="64"/><rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)"/></svg>',
    logo: '<svg width="56" height="56" viewBox="0 0 100 100" role="img" aria-label="Ikon Istiqamah"><rect width="100" height="100" rx="18" fill="#0A2540"/><rect x="20" y="20" width="60" height="60" fill="none" stroke="#E3C46F" stroke-width="2"/><rect x="20" y="20" width="60" height="60" fill="none" stroke="#E3C46F" stroke-width="2" transform="rotate(45 50 50)"/><text x="50" y="71" text-anchor="middle" font-family="Amiri,serif" font-size="66" font-weight="700" fill="#E3C46F" stroke="none">ا</text></svg>'
  };

  function nav() {
    var lagiGroup = ['lagi', 'tetapan', 'tentang', 'qiam', 'kiblat', 'hadis', 'khatam', 'pss', 'umr', 'rnk', 'buk'].indexOf(screen) >= 0 && !(retTo && ['kiblat', 'hadis', 'khatam'].indexOf(screen) >= 0);
    function tab(go, on, icon, label) {
      return '<button data-go="' + go + '" class="' + (on ? 'on' : '') + '" aria-current="' + (on ? 'page' : 'false') + '">' + icon + label + '</button>';
    }
    return '<nav class="nav">' + tab('utama', screen === 'utama' || retTo === 'utama' && ['kiblat', 'hadis', 'khatam'].indexOf(screen) >= 0, ICON.home, u('utama')) + tab('cab', screen === 'cab' || screen === 'cabnew' || retTo === 'cab' && screen === 'khatam', ICON.trophy, u('cabaran')) + tab('zikir', screen === 'zikir' || screen === 'zkat', ICON.tasbih, u('zikir')) + tab('kal', screen === 'kal', ICON.calnav, u('kalNav')) + tab('lagi', lagiGroup, ICON.grid, u('lagi')) + '</nav>';
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
      '<div class="b1"><div class="bt">Istiqamah</div><div class="bzw"><div class="bz">' + zoneText + '</div>' + (screen === 'utama' ? '<button class="bk" data-go="kiblat" aria-label="' + u('kiblat') + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg></button>' : '') + '</div></div>' +
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
    var tz = zToday(), hi = dayIndex(today) % F.hadis.length, hd = F.hadis[hi], hk = S.lang === 'en' ? 1 : 0;
    var cards = '<div class="tcards"><button class="tc tz" data-act="tozikir"><span class="tcl">' + tt('ZIKIR HARI INI', 'DHIKR OF THE DAY') + '</span><span class="tca" lang="ar" dir="rtl">' + esc(tz.ar) + '</span><span class="tcs">' + esc(tz.n) + '</span></button>' +
      '<button class="tc th" data-go="hadis"><span class="tcl">' + tt('HADIS HARI INI', 'HADITH OF THE DAY') + ' · ' + (hi + 1) + '</span><span class="tct">' + esc(hd[hk]) + '</span><span class="tcs">' + esc(hd[2 + hk]) + '</span></button></div>';
    return hdr + hero + cards + '<div class="chips" role="group" aria-label="Tapis">' + chips + '</div><div class="list" id="list">' + tar + rows + '</div>';
  }

  function viewLagi() {
    var soon = [['mas', 'masjid', ICON.mosque], ['azn', 'azan', ICON.speaker], ['zkt', 'zakat', ICON.plus], ['haj', 'haji', ICON.doc]];
    return '<header class="banner plain">' + ICON.star + '<div class="pt">' + u('lagi') + '</div><div class="ps">' + u('lagiSub') + '</div></header>' +
      '<main class="scroll"><div class="grid">' +
      '<button class="tile" data-go="qiam">' + ICON.moon + u('qiam') + '</button>' +
      '<button class="tile" data-go="kiblat">' + ICON.compass + u('kiblat') + '</button>' +
      '<button class="tile" data-go="hadis">' + ICON.doc + u('hadisHari') + '</button>' +
      '<button class="tile" data-go="pss">' + ICON.moon.replace('#7A5C12', '#9A8F6E') + u('puasaSunat') + '</button>' +
      '<button class="tile" data-go="khatam">' + ICON.book + u('khatam') + '</button>' +
      '<button class="tile" data-go="umr">' + ICON.doc + u('umrah') + '</button>' +
      '<button class="tile" data-go="rnk">' + ICON.bars + u('ranking') + '</button>' +
      '<button class="tile" data-go="buk">' + ICON.book + u('buku') + '</button>' +
      '<button class="tile" data-go="tetapan">' + ICON.gear + u('tetapan') + '</button>' +
      '<button class="tile" data-go="tentang">' + ICON.info + u('tentang') + '</button></div>' +
      '<div class="sech" style="display:flex;justify-content:space-between"><span>' + u('akanDatang') + '</span><span style="font-weight:500;letter-spacing:0;color:var(--muted)">' + u('akanDatangNota') + '</span></div>' +
      '<div class="grid">' + soon.map(function (x) {
        return '<button class="tile soon" data-act="soon" aria-label="' + esc(u(x[1])) + ', ' + esc(u('tiba')) + '">' + x[2] + '<span>' + u(x[1]) + '</span><span class="sb">' + u('tibaCap') + '</span></button>';
      }).join('') + '</div></main>';
  }

  function topbar(title, back) {
    return '<div class="topbar">' + (back ? '<button class="back" data-go="' + (typeof back === 'string' ? back : 'lagi') + '" aria-label="' + u('kembali') + '">' + ICON.back + '</button>' : '<span style="width:12px"></span>') + '<div class="tt">' + title + '</div></div>';
  }

  function seg(name, val, items) {
    return '<div class="seg" role="group">' + items.map(function (i) {
      return '<button class="' + (val === i[0] ? 'on' : '') + '" data-set="' + name + '" data-val="' + i[0] + '" aria-pressed="' + (val === i[0]) + '">' + i[1] + '</button>';
    }).join('') + '</div>';
  }
  function hmOf(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function zonCard() {
    var auto = !!S.zoneAuto, body;
    if (auto) {
      var ap = S.autoPlace, zi = zoneOf(S.zone), hist = (S.zoneHist || []).slice(0, 3);
      var place = ap && ap.code === S.zone ? esc(ap.name) + ', ' + esc(zi.s) : (Zst.busy ? u('zonMencari') : (Zst.err ? u('zonLocGagal') : '—'));
      body = '<div class="zbox">' + ICON.pin + '<div class="zbt"><div class="zk">' + u('zonDikesan') + '</div><div class="zp">' + place + '</div><div class="zs">' + S.zone + (ap ? ' · ' + u('zonKemas') + ' ' + hmOf(ap.at) : '') + '</div></div></div>' +
        '<button class="btn wide ghost" data-act="zoncheck" style="margin-top:10px"' + (Zst.busy ? ' disabled' : '') + '>' + (Zst.busy ? u('zonMencari') : u('zonSemak')) + '</button>' +
        '<div class="note">' + u('zonAutoNota') + '</div>' +
        (hist.length ? '<div class="hist"><div class="lbl" style="margin:0">' + u('zonSejarah') + '</div>' + hist.map(function (h) {
          var d = new Date(h.t);
          return '<div><span>' + T().ui.hari[d.getDay()] + ' ' + hmOf(h.t) + '</span><b>' + esc(h.n) + ' · ' + h.c + '</b></div>';
        }).join('') + '</div>' : '');
    } else {
      var states = [];
      ZONES.forEach(function (z) { if (states.indexOf(z.s) < 0) states.push(z.s); });
      var opts = states.map(function (st) {
        return '<optgroup label="' + st + '">' + ZONES.filter(function (z) { return z.s === st; }).map(function (z) {
          return '<option value="' + z.c + '"' + (z.c === S.zone ? ' selected' : '') + '>' + z.c + ' · ' + z.d + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
      body = '<select id="zsel" class="sel" style="margin-top:12px" aria-label="' + u('zon') + '">' + opts + '</select><div class="note">' + u('zonManualNota') + '</div>';
    }
    return '<div class="card"><div class="lbl">' + u('zon') + '</div>' + seg('zoneAuto', auto ? 1 : 0, [[1, u('zonAuto')], [0, u('zonManual')]]) + body + '</div>';
  }
  function viewMula() {
    var auto = !!S.zoneAuto;
    function opt(on, v, title, body, rec) {
      return '<button class="mopt' + (on ? ' on' : '') + '" data-set="zoneAuto" data-val="' + v + '" aria-pressed="' + on + '"><div class="mh"><span class="dot"></span><b>' + title + '</b>' + (rec ? '<i>' + u('disyorkan') + '</i>' : '') + '</div><div class="mb">' + body + '</div></button>';
    }
    return '<main class="scroll" style="padding-top:calc(28px + env(safe-area-inset-top,0px))"><div style="text-align:center"><div class="mlogo">' + ICON.logo + '</div>' +
      '<div class="mt">' + u('selamatDatang') + '</div><div class="note" style="font-size:14px">' + u('mulaZonTanya') + '</div></div>' +
      '<div style="margin-top:18px">' + opt(auto, 1, u('zonAuto0'), u('zonAutoMula'), true) + opt(!auto, 0, u('zonManual'), u('zonManualMula'), false) + '</div>' +
      '<div class="note">' + (auto ? u('zonAutoIzin') : u('zonManualLepas')) + '</div>' +
      '<button class="btn wide" data-act="mulaNext" style="margin-top:14px">' + u('teruskan') + '</button></main>';
  }
  function sech(t) { return '<div class="sech">' + t + '</div>'; }
  function viewTetapan() {
    var perm = '';
    if (isNative) {
      perm = '<div class="card"><button class="btn wide" data-act="perm">' + u('izinNotif') + '</button><div class="note">' + u('izinNotifNota') + '</div>' +
        '<button class="btn wide ghost" data-act="exact" style="margin-top:10px">' + u('izinAlarm') + '</button><div class="note">' + u('izinAlarmNota') + '</div></div>';
    }
    var last = cache && cache.fetched ? '<div class="note">' + u('dataTerakhir') + ' ' + new Date(cache.fetched).toLocaleDateString(S.lang === 'en' ? 'en-GB' : 'ms-MY', { day: 'numeric', month: 'short' }) + ' ' + hmOf(cache.fetched) + '. ' + u('dataLuarTalian') + '</div>' : '<div class="note">' + u('dataLuarTalian') + '</div>';
    return topbar(u('tetapan'), !firstRun) +
      '<main class="scroll">' + (firstRun ? '<div class="welcome">' + u('mulaiSetup') + '</div>' : '') +
      sech(u('secZon')) + zonCard() +
      sech(u('secSolat')) +
      '<div class="card"><div class="lbl">' + u('jantina') + '</div>' + seg('male', S.male ? 1 : 0, [[1, u('lelaki')], [0, u('perempuan')]]) + '<div class="note">' + u('jantinaNota') + '</div></div>' +
      '<div class="card"><div class="lbl">' + u('tarawih') + '</div>' + seg('tar', S.tar, [[8, '8'], [10, '10'], [20, '20']]) + '</div>' +
      tahCard() +
      '<div class="card"><div class="lbl">' + tt('NOTIFIKASI DHUHA', 'DUHA NOTIFICATION') + '</div>' + seg('dhuhaN', L.bellOn(S.bells, 'dhuhaa') ? 'afdhal' : 'mula', [['mula', tt('Waktu mula', 'Earliest time')], ['afdhal', tt('Waktu afdhal', 'Best time')]]) + '<div class="note">' + tt('Waktu afdhal ialah kira-kira suku hari dari Syuruk hingga Maghrib, ketika matahari terik. Solat Dhuha bila-bila masa antara waktu mula dan sebelum Zohor tetap sah.', 'The best time is about a quarter of the day from sunrise to sunset, when the sun is hot. Duha at any time between its start and before Dhuhr is valid.') + '</div></div>' +
      sech(u('secBahasa')) +
      '<div class="card"><div class="lbl">' + u('bahasa') + '</div>' + seg('lang', S.lang, [['ms', 'Bahasa Melayu'], ['en', 'English']]) + '</div>' +
      (isNative ? sech(u('secNotif')) + perm : '') +
      sech(u('secData')) +
      '<div class="card">' + (firstRun ? '' : '<button class="btn wide ghost" data-act="refresh">' + u('kemaskini') + '</button>') + last + '</div>' +
      (firstRun ? '<button class="btn wide" data-act="done" style="margin-top:10px">' + u('selesai') + '</button>' : '') +
      '</main>';
  }

  /* ---------- waktu tahajud tetap ---------- */
  function todayT() { var t = cache.days[L.ymd(now())]; return L.validDay(t) ? t : null; }
  function tahCard() {
    var fixed = S.tahMode === 'fixed';
    var t = todayT(), tmax = L.tahajudMax(t), tmin = L.TAH_MIN;
    var seg = '<div class="seg" role="group">' + [['fixed', u('tahTetap')], ['third', u('tahSepertiga')]].map(function (i) {
      return '<button class="' + (S.tahMode === i[0] || (i[0] === 'fixed' && !S.tahMode) ? 'on' : '') + '" data-set="tahMode" data-val="' + i[0] + '" aria-pressed="' + (S.tahMode === i[0]) + '">' + i[1] + '</button>';
    }).join('') + '</div>';
    var body;
    if (fixed) {
      var hrs = '', mi = '', h, m;
      for (h = 2; h <= Math.max(2, Math.floor(tmax / 60)); h++) hrs += '<div class="wi">' + ('0' + h).slice(-2) + '</div>';
      for (m = 0; m < 60; m += 5) mi += '<div class="wi">' + ('0' + m).slice(-2) + '</div>';
      body = '<div class="wheelbox"><div class="wl"><span>' + u('jam') + '</span><span></span><span>' + u('minit') + '</span></div>' +
        '<div class="wh"><div class="wband"></div><div class="wcol" id="whH" aria-label="' + u('jam') + '">' + hrs + '</div><div class="wcolon">:</div><div class="wcol" id="whM" aria-label="' + u('minit') + '">' + mi + '</div></div>' +
        '<div class="note" style="text-align:center">' + u('tahSkrol') + '</div></div>' +
        '<div class="lim"><div><b>' + u('tahAwal') + '</b><span>' + L.hhmm(tmin) + '</span></div><div><b>' + u('tahLewat') + '</b><span>' + L.hhmm(tmax) + '</span></div></div>' +
        '<div class="note">' + u('tahHadNota').replace('{s}', t ? t.fajr.slice(0, 5) : '--:--') + '</div>' +
        '<div class="warnbox" id="whWarn" hidden>' + u('tahDihad').replace('{a}', L.hhmm(tmin)).replace('{b}', L.hhmm(tmax)) + '</div>';
    } else {
      body = '<div class="lim one"><div>' + u('tahSepertigaNota') + '</div></div>';
    }
    return '<div class="card"><div class="lbl">' + u('tahTitle') + '</div><div class="note" style="margin:0 0 10px">' + u('tahNota') + '</div>' + seg + body + '</div>';
  }
  function setupWheel() {
    var H = document.getElementById('whH'), M = document.getElementById('whM');
    if (!H || !M) return;
    var ROW = 44, warn = document.getElementById('whWarn'), tm = null, wt = null;
    var v0 = L.tahajudClamp(S.tahMin == null ? 240 : S.tahMin, todayT());
    var ph = Math.floor(v0 / 60), pm = v0 % 60;
    function paint() {
      [].forEach.call(H.children, function (c, i) { c.classList.toggle('on', i + 2 === ph); });
      [].forEach.call(M.children, function (c, i) { c.classList.toggle('on', i * 5 === pm); });
    }
    function place(v, smooth) {
      var o = smooth ? { behavior: 'smooth' } : null;
      var top1 = (Math.floor(v / 60) - 2) * ROW, top2 = Math.round((v % 60) / 5) * ROW;
      if (o) { H.scrollTo({ top: top1, behavior: 'smooth' }); M.scrollTo({ top: top2, behavior: 'smooth' }); }
      else { H.scrollTop = top1; M.scrollTop = top2; }
    }
    function settle() {
      var raw = ph * 60 + pm, v = L.tahajudClamp(raw, todayT());
      if (v !== raw) {
        ph = Math.floor(v / 60); pm = v % 60; place(v, true); paint();
        if (warn) { warn.hidden = false; clearTimeout(wt); wt = setTimeout(function () { warn.hidden = true; }, 3500); }
      }
      if (S.tahMin !== v) { S.tahMin = v; persist(); reschedule(); }
    }
    function onScroll(col, isH) {
      col.addEventListener('scroll', function () {
        var idx = Math.round(col.scrollTop / ROW);
        if (isH) ph = Math.max(2, Math.min(2 + H.children.length - 1, 2 + idx));
        else pm = Math.max(0, Math.min(11, idx)) * 5;
        paint();
        clearTimeout(tm); tm = setTimeout(settle, 160);
      }, { passive: true });
    }
    place(v0, false); paint();
    onScroll(H, true); onScroll(M, false);
  }

  /* ---------- semakan versi baharu ---------- */
  var REL_API = 'https://api.github.com/repos/farawyadal/istiqamah/releases/latest';
  var U = { state: '', newer: null, toasted: false };
  function checkUpdate(force) {
    if (!isNative) return Promise.resolve();
    if (!force && Date.now() - load('isti.updchk', 0) < 6 * 3600 * 1000) return Promise.resolve();
    U.state = 'busy'; if (screen === 'tentang') render();
    return fetch(REL_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (j) {
        save('isti.updchk', Date.now());
        var apk = (j.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
        U.state = 'ok'; U.checked = (function (d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); })(new Date());
        U.newer = apk && L.newerVer(j.tag_name, APP_VERSION) ? { v: L.parseVer(j.tag_name).join('.'), url: apk.browser_download_url } : null;
        if (U.newer && !U.toasted) { U.toasted = true; toast(u('updToast')); }
        if (screen === 'tentang') render();
      })
      .catch(function () { U.state = 'err'; if (force) toast(u('updGagal')); if (screen === 'tentang') render(); });
  }
  function updCard() {
    if (!isNative) return '';
    if (U.newer) {
      return '<div class="card upd"><div class="lbl gold" style="color:var(--gold)">' + u('updTitle') + '</div>' +
        '<div class="ut">' + u('updBody').replace('{n}', U.newer.v).replace('{o}', APP_VERSION) + '</div>' +
        '<button class="btn wide gold" data-act="upd">' + u('updBtn') + '</button><div class="un">' + u('updNota') + '</div></div>';
    }
    var busy = U.state === 'busy', tm = U.checked || (function (t) { if (!t) return ''; var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); })(load('isti.updchk', 0));
    return '<div class="card"><div class="okrow"><div class="okic">✓</div><div><div class="okt">' + (busy ? u('updMenyemak') : u('updTerkiniTitle')) + '</div><div class="oks">' +
      (busy ? u('updTunggu') : u('updDisemak').replace('{v}', APP_VERSION).replace('{t}', tm)) + '</div></div></div>' +
      '<button class="btn wide ghost" data-act="updcheck" style="margin-top:12px"' + (busy ? ' disabled' : '') + '>' + (busy ? u('updMenyemak2') : u('updSemak')) + '</button></div>';
  }

  function viewTentang() {
    var showInstall = !isNative;
    return topbar(u('tentang'), true) +
      '<main class="scroll">' +
      '<div class="card about"><div class="logo">' + ICON.logo + '</div><div style="flex:1"><div class="an">Istiqamah</div><div class="av">' + u('versi') + ' ' + APP_VERSION + '</div>' +
      (showInstall ? '<button class="btn sm" data-act="install">' + u('pasang') + '</button>' : '') + '</div></div>' +
      updCard() +
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
  function zCat() { return (window.ISTI_ZIKIR && window.ISTI_ZIKIR.cat) || []; }
  function zFind(id) {
    var gi = ZG.indexOf(id);
    if (gi >= 0) { var z = T().zk[id]; return { id: id, n: z[0], ar: z[1], t: 33, grp: true }; }
    var c = zCat().filter(function (x) { return x.id === id; })[0];
    if (c) return { id: c.id, n: c.n, ar: c.ar, t: c.t, m: c.m, s: c.s };
    var cu = Z.custom.filter(function (x) { return x.id === id; })[0];
    return cu ? { id: cu.id, n: cu.n, ar: '', t: cu.t, custom: true } : null;
  }
  function zList() {
    return Z.list.map(zFind).filter(Boolean)
      .concat(Z.custom.map(function (c) { return zFind(c.id); }));
  }
  function zCur() {
    if (Z.sel === 'g_solat') return zFind(ZG[Math.min(2, Z.step || 0)]);
    return zFind(Z.sel) || zFind(ZG[0]);
  }
  function zTarget(it) { return it.grp ? 33 : (Z.targets[it.id] || it.t); }
  function zToday() {
    var d = now(), cat = zCat();
    if (d.getDay() === 5) return cat.filter(function (x) { return x.id === 'selawat'; })[0];
    var pool = cat.filter(function (x) { return x.id !== 'selawat'; });
    var di = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
    return pool[di % pool.length];
  }
  function zl(arr) { return arr[S.lang === 'en' ? 1 : 0]; }
  function arSize(t) { var n = t.length; return n <= 22 ? 34 : n <= 45 ? 28 : n <= 80 ? 24 : 21; }
  var CIRC = 691.15, zForm = false;
  function viewZikir() {
    var grp = Z.sel === 'g_solat', it = zCur(), tg = zTarget(it), c = Z.counts[it.id] || 0;
    var gd = grp && Z.gdone, frac = Math.min(1, gd ? 1 : c / tg);
    var td = zToday(), tdOn = !grp && Z.sel === td.id;
    var tdCard = '<div class="ztoday"><div class="ztr"><span class="ztl">' + u('zHariIni') + ' · ' + u('hari')[now().getDay()].toUpperCase() + '</span><span class="ztn">' + u('zBertukar') + '</span></div>' +
      '<div class="ztar" lang="ar" dir="rtl">' + esc(td.ar) + '</div><div class="ztm">' + esc(zl(td.m)) + '. ' + esc(zl(td.s)) + '.</div>' +
      '<div class="ztr" style="margin-top:8px"><span class="ztn">' + u('sasaranLbl').replace('{n}', td.t) + '</span><button class="ztb' + (tdOn ? ' on' : '') + '" data-act="ztoday">' + (tdOn ? u('zSedang') : u('zMula')) + '</button></div></div>';
    var steps = grp ? '<div class="zsteps">' + ZG.map(function (g, i) {
      var st = gd || i < Z.step ? 'done' : i === Z.step ? 'now' : 'next';
      return '<div class="zstep ' + st + '"><div class="zst">' + (st === 'done' ? '✓ ' : '') + (i + 1) + ' · 33</div><div class="zsn">' + esc(T().zk[g][0]) + '</div></div>';
    }).join('') + '</div>' : '';
    var single = Z.list.map(zFind).filter(Boolean).concat(Z.custom.map(function (cu) { return zFind(cu.id); }));
    var rows = single.map(function (x) {
      var rem = true;
      return '<div class="zrow' + (!grp && x.id === it.id ? ' on' : '') + '"><button class="zsel" data-zsel="' + esc(x.id) + '" aria-pressed="' + (!grp && x.id === it.id) + '"><span>' + esc(x.n) + '</span><span class="zn">× ' + zTarget(x) + '</span></button>' +
        (rem ? '<button class="zdel" data-zdel="' + esc(x.id) + '" aria-label="' + u('buang') + ' ' + esc(x.n) + '">✕</button>' : '') + '</div>';
    }).join('');
    var sub = grp ? (gd ? u('gTitle') + ' · ' + u('gSelesai').toLowerCase() : u('gLangkah').replace('{i}', Math.min(2, Z.step) + 1)) : esc(it.n) + ' · ' + u('sasaranLbl').replace('{n}', tg).toLowerCase();
    var ringIn = gd
      ? '<span class="ringin zdone"><span class="zdt">' + u('gSelesai') + '</span><span class="zcnum" style="font-size:44px">99</span><span class="zof">' + u('gSelesaiSub') + '</span></span>'
      : '<span class="ringin"><span class="zcnum" id="zc">' + c + '</span><span class="zof" id="zof">' + u('daripada').replace('{n}', tg) + '</span></span>';
    var hint = gd ? u('zUlang') : (grp ? u('zHintGrp').replace('{n}', 33) : u('ketikKira'));
    return '<div class="zhead"><div><div class="pt">' + u('zikir') + '</div><div class="ps" id="zsub">' + sub + '</div></div></div>' +
      '<div class="zscroll">' + tdCard + steps +
      '<div class="zar" id="zar" lang="ar" dir="rtl" style="font-size:' + arSize(it.ar || '') + 'px">' + (it.ar ? esc(it.ar) : '&nbsp;') + '</div>' +
      '<button class="ring" data-act="zcount" aria-label="' + esc(it.n) + ' ' + u('ketikKira') + '">' +
      '<svg class="ringsvg" width="260" height="260" viewBox="0 0 260 260" fill="none" aria-hidden="true"><circle cx="130" cy="130" r="110" stroke="#1C4268" stroke-width="12"/><circle id="zr" cx="130" cy="130" r="110" stroke="' + (gd ? '#3DDC97' : '#E3C46F') + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (frac * CIRC).toFixed(1) + ' ' + CIRC + '" transform="rotate(-90 130 130)"/></svg>' +
      '<svg width="200" height="200" viewBox="0 0 100 100" fill="none" stroke="#E3C46F" stroke-width="0.6" aria-hidden="true" class="ringstar"><rect x="18" y="18" width="64" height="64"/><rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)"/></svg>' +
      ringIn + '</button>' +
      '<div class="zhint">' + hint + '</div>' +
      '<div class="zctl"><button data-act="zreset">' + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/></svg>' + u('setSemula') + '</button>' +
      '<button data-act="zvib" aria-pressed="' + !!Z.vibrate + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8"/></svg>' + u('getar') + (Z.vibrate ? u('hidup') : u('mati')) + '</button>' +
      (grp ? '' : '<button data-act="ztarget"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>' + u('sasaran') + tg + '</button>') + '</div>' +
      '<div class="zlh"><div class="zlt">' + u('senaraiZikir') + '</div><button class="zadd" data-go="zkat">' + u('tambah') + '</button></div>' +
      '<div class="zgl">' + u('zKumpulan') + '</div>' +
      '<button class="zgrp' + (grp ? ' on' : '') + '" data-zsel="g_solat" aria-pressed="' + grp + '"><span style="text-align:left"><span class="zgn">' + u('gTitle') + '</span><span class="zgs">' + u('gSub') + '</span></span><span class="zn">33 + 33 + 33</span></button>' +
      '<div class="zgl" style="margin-top:12px">' + u('zSingle') + '</div>' +
      '<div class="zlist">' + rows + '</div></div>';
  }
  function viewZkat() {
    var cat = zCat();
    var items = cat.map(function (x) {
      var on = Z.list.indexOf(x.id) >= 0;
      return '<div class="zk"><div class="zkh"><div class="zkn">' + esc(x.n) + '</div><button class="zkb' + (on ? ' on' : '') + '" data-zkadd="' + esc(x.id) + '" aria-pressed="' + on + '">' + (on ? u('zDitambah') : u('zTambahBtn')) + '</button></div>' +
        '<div class="zkar" lang="ar" dir="rtl">' + esc(x.ar) + '</div><div class="zkm">' + esc(zl(x.m)) + '</div><div class="zks">' + esc(zl(x.s)) + ' · ' + u('sasaranLbl').replace('{n}', x.t) + '</div></div>';
    }).join('');
    var form = zForm ? '<div class="zform"><input id="zname" class="inp" maxlength="40" placeholder="' + u('namaItem') + '" aria-label="' + u('namaItem') + '"><input id="zcnt" class="inp" type="number" inputmode="numeric" min="1" max="100000" value="33" aria-label="' + u('bilangan') + '"><div class="zbtns"><button class="zb gold" data-act="zsave">' + u('simpan') + '</button><button class="zb" data-act="zcancel">' + u('batal') + '</button></div></div>'
      : '<button class="zkown" data-act="zadd">+ ' + u('zTulis') + '</button>';
    return topbar(u('zkatTitle'), 'zikir') + '<div class="zscroll"><div class="zkintro">' + u('zkatSub') + '</div>' + items + '<div class="zkcus">' + form + '</div></div>';
  }
  function zRefresh() {
    var it = zCur(), tg = zTarget(it), c = Z.counts[it.id] || 0;
    var zc = document.getElementById('zc'); if (!zc) return;
    zc.textContent = c;
    document.getElementById('zr').setAttribute('stroke-dasharray', (Math.min(1, c / tg) * CIRC).toFixed(1) + ' ' + CIRC);
    document.getElementById('zof').textContent = u('daripada').replace('{n}', tg);
  }
  function buzz(p) {
    if (!Z.vibrate) return;
    var H = isNative && Cap.Plugins ? Cap.Plugins.Haptics : null, dur = Array.isArray(p) ? 150 : p;
    try {
      if (H && H.vibrate) {
        H.vibrate({ duration: Math.max(40, dur) }).catch(function () { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e2) { /* abaikan */ } });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(p);
    } catch (e) { /* abaikan */ }
  }

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
  var KM = { off: 0 };
  function hijriMonth(off) {
    var today = now(), adj = adjustFor(today), h = L.hijriAt(today, adj), start = L.addDays(today, -(h.d - 1)), i, hh;
    for (i = 0; i < Math.abs(off); i++) {
      if (off > 0) { start = L.addDays(start, 29); while (L.hijriAt(start, adj).d !== 1) start = L.addDays(start, 1); }
      else { start = L.addDays(start, -1); hh = L.hijriAt(start, adj); start = L.addDays(start, -(hh.d - 1)); }
    }
    var days = [], d = start;
    for (i = 0; i < 31; i++) {
      hh = L.hijriAt(d, adj);
      if (days.length && hh.d === 1) break;
      days.push({ date: d, h: hh }); d = L.addDays(d, 1);
    }
    return days;
  }
  function viewKal() {
    var t = T(), ev = calEvents(), todayY = L.ymd(now());
    function gline(e) { var d = e.date; return t.ui.hari[d.getDay()] + ', ' + d.getDate() + ' ' + t.ui.bulanM[d.getMonth()] + ' ' + d.getFullYear() + ' (' + t.ui.anggaran + ')'; }
    function days(e) { return e.days === 0 ? t.ui.hariIniShort : t.ui.hariLagi.replace('{n}', e.days); }
    var hero = ev[0] ? '<section class="hero kh">' + ICON.star.replace('class="deco"', 'class="deco deco2"') + '<div class="hl">' + t.ui.kalHero + '</div><div class="hn">' + t.sambutan[ev[0].k] + '</div><div class="hs">' + ev[0].h.d + ' ' + t.ui.bulanH[ev[0].h.m - 1] + ' ' + ev[0].h.y + ' · ' + gline(ev[0]) + '</div><div class="hc">' + days(ev[0]) + '</div></section>' : '';
    var md = hijriMonth(KM.off), f = md[0], l = md[md.length - 1];
    var mTitle = t.ui.bulanH[f.h.m - 1] + ' ' + f.h.y;
    var mSub = t.ui.bulanM[f.date.getMonth()] + (f.date.getMonth() !== l.date.getMonth() ? ' – ' + t.ui.bulanM[l.date.getMonth()] : '') + ' ' + l.date.getFullYear();
    var dn = t.ui.hari.map(function (x) { return '<div class="kwd">' + esc(x.slice(0, 3)) + '</div>'; }).join('');
    var cells = '', i;
    for (i = 0; i < f.date.getDay(); i++) cells += '<div></div>';
    md.forEach(function (x) {
      var k = L.sambutanOf(x.h), g = x.date.getDate() + (x.h.d === 1 || g1(x) ? ' ' + t.ui.bulanM[x.date.getMonth()].slice(0, 3) : '');
      var cls = 'kc' + (k ? ' ev' : '') + (L.ymd(x.date) === todayY ? ' td' : '');
      cells += (k ? '<button class="' + cls + '" data-act="kalev" data-k="' + k + '" aria-label="' + esc(t.sambutan[k]) + '">' : '<div class="' + cls + '">') + '<b>' + x.h.d + '</b><i>' + g + '</i>' + (k ? '</button>' : '</div>');
    });
    function g1(x) { return x.date.getDate() === 1; }
    var mcard = '<div class="card kmc"><div class="kmh"><button class="kmb" data-act="kalm" data-d="-1" aria-label="' + tt('Bulan sebelum', 'Previous month') + '">‹</button><button class="kmt" data-act="kalm" data-d="0"><span>' + mTitle + '</span><small>' + mSub + '</small></button><button class="kmb" data-act="kalm" data-d="1" aria-label="' + tt('Bulan seterusnya', 'Next month') + '">›</button></div>' +
      '<div class="kgr">' + dn + cells + '</div><div class="kleg"><span><b class="kdot"></b> ' + tt('Sambutan Islam', 'Islamic occasion') + '</span><span>' + tt('Kecil = tarikh Masihi', 'Small = Gregorian date') + '</span></div></div>';
    var rows = ev.map(function (e) {
      var on = sbellOn(e.k), big = !!SBELL_DEF[e.k], name = t.sambutan[e.k];
      return '<div class="row krow' + (big ? ' raya' : '') + '" id="kev-' + e.k + '"><div class="rt kd">' + (e.days === 0 ? t.ui.hariIniShort : e.days + ' ' + (S.lang === 'en' ? 'd' : 'hari')) + '</div><div><div class="rn">' + name + '</div><div class="rs">' + e.h.d + ' ' + t.ui.bulanH[e.h.m - 1] + ' · ' + gline(e) + '</div></div>' +
        '<button class="bell' + (on ? ' on' : '') + '" data-sbell="' + e.k + '" aria-pressed="' + on + '" aria-label="' + t.ui.ingatan + name + '">' + ICON.bell(on) + '</button></div>';
    }).join('');
    return topbar(u('kal'), false) +
      '<main class="scroll">' + hero + mcard + '<div class="sh" style="margin:14px 4px 8px">' + u('kalAkan') + '</div>' + rows + '<div class="note" style="margin:10px 4px 0">' + u('kalNota') + '</div></main>';
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
  var WGRP = { subuh: ['qsubuh', 'isyraq'], syuruk: ['isyraq', 'dhuha'], zohor: ['qzohor', 'qjumaat', 'bzohor', 'bjumaat'], asar: ['qasar'], maghrib: ['bmaghrib', 'awwabin'], isyak: ['bisyak', 'tarawih', 'witir'] };
  function wGroups(items) {
    var out = {};
    Object.keys(WGRP).forEach(function (g) {
      var a = [];
      WGRP[g].forEach(function (k) {
        items.forEach(function (it) { if (it.k === k && a.length < 2) a.push([itemText(k).n, it.t]); });
      });
      out[g] = a;
    });
    return out;
  }
  function doWidgetSync() {
    var today = now(), adj = adjustFor(today), days = [], t = T();
    for (var i = 0; i < 4; i++) {
      var date = L.addDays(today, i), dm = dayModel(date, adj);
      if (!dm) continue;
      var pt = dm.t;
      days.push({
        ymd: L.ymd(date),
        hijri: dm.h.d + ' ' + t.ui.bulanH[dm.h.m - 1] + ' ' + dm.h.y,
        p: { subuh: pt.fajr.slice(0, 5), syuruk: pt.syuruk.slice(0, 5), zohor: pt.dhuhr.slice(0, 5), asar: pt.asr.slice(0, 5), maghrib: pt.maghrib.slice(0, 5), isyak: pt.isha.slice(0, 5) },
        items: dm.items.map(function (it) {
          var tx = itemText(it.k);
          return { n: tx.n, s: tx.s.split(' · ').slice(1).join(' · '), t: it.t, f: it.fardu ? 1 : 0, b: L.bellOn(S.bells, it.k) ? 1 : 0 };
        }),
        g: wGroups(dm.items)
      });
    }
    var labels = {
      seterusnya: t.ui.wSeterusnya, sunatNext: t.ui.wSunat, tinggal: t.ui.wTinggal, zikirTap: t.ui.wZikir,
      am: t.ui.pagi, pm: t.ui.petang, dow: t.ui.hari, mon: t.ui.bulanM,
      masuk: tt('MASUK WAKTU', 'PRAYER TIME'), waktu: tt('WAKTU', 'TIME'), zikirHari: tt('ZIKIR HARI INI', 'DHIKR OF THE DAY'), hadisHari: tt('HADIS HARI INI', 'HADITH OF THE DAY'),
      subuh: t.items.subuh[0], syuruk: t.ui.syuruk, zohor: t.items.zohor[0], asar: t.items.asar[0], maghrib: t.items.maghrib[0], isyak: t.items.isyak[0]
    };
    var zc = zCur(), tz = zToday(), hi = dayIndex(today) % F.hadis.length, hd = F.hadis[hi], hk = S.lang === 'en' ? 1 : 0;
    WGT.sync({ data: JSON.stringify({ zone: zoneShort(S.zone), days: days, labels: labels, zk: { ar: tz.ar, n: tz.n }, hd: { i: hi + 1, t: hd[hk], s: hd[2 + hk] } }), zid: zc.id, zn: zc.n, zt: zTarget(zc), zc: Z.counts[zc.id] || 0 }).catch(function () { /* abaikan */ });
  }
  function pullOpen() {
    if (!WGT || !WGT.getOpen) return Promise.resolve();
    return WGT.getOpen().then(function (r) {
      var o = r && r.o;
      if (!o) return;
      if (o === 'zone') { if (screen !== 'utama') go('utama', false); return autoZone(true); }
      if (o === 'kiblat') return go('kiblat', true);
      if (o === 'zikir') { Z.sel = zToday().id; zSave(); return go('zikir', false); }
      if (o === 'hadis') return go('hadis', true);
    }).catch(function () { /* abaikan */ });
  }
  function pullZikir() {
    if (!WGT) return Promise.resolve();
    return WGT.getZikir().then(function (r) {
      if (r && r.id && typeof r.c === 'number' && zFind(r.id)) {
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
    var m0 = root.querySelector('main.scroll') || root.querySelector('.zscroll'), mTop = m0 ? m0.scrollTop : 0, mScreen = renderedScreen;
    var html;
    if (firstRun) screen = mulaDone ? 'tetapan' : 'mula';
    if (screen === 'utama') html = viewUtama();
    else if (screen === 'zikir') html = viewZikir();
    else if (screen === 'zkat') html = viewZkat();
    else if (screen === 'hadis') html = viewHadis();
    else if (screen === 'khatam') html = viewKhatam();
    else if (screen === 'cab') html = viewCab();
    else if (screen === 'cabnew') html = viewCabNew();
    else if (screen === 'pss') html = viewPuasa();
    else if (screen === 'umr') html = viewUmrah();
    else if (screen === 'rnk') html = viewRank();
    else if (screen === 'buk') html = viewBuku();
    else if (screen === 'qiam') html = viewQiam();
    else if (screen === 'kal') html = viewKal();
    else if (screen === 'kiblat') html = viewKiblat();
    else if (screen === 'lagi') html = viewLagi();
    else if (screen === 'mula') html = viewMula();
    else if (screen === 'tetapan') html = viewTetapan();
    else html = viewTentang();
    var withNav = !firstRun;
    root.className = screen === 'zikir' || screen === 'zkat' || screen === 'kiblat' || screen === 'khatam' ? 'dark' : '';
    root.innerHTML = '<div class="screen">' + html + '</div>' + (withNav ? nav() : '');
    var m1 = root.querySelector('main.scroll') || root.querySelector('.zscroll');
    if (m1 && mScreen === screen && mTop) m1.scrollTop = mTop; // kekal di tempat yang sama selepas klik
    renderedScreen = screen;
    document.documentElement.lang = S.lang === 'en' ? 'en' : 'ms';
    if (screen === 'kiblat') { kbStart(); kbUpdate(); } else kbStop();
    if (screen === 'tetapan' && S.tahMode === 'fixed') setupWheel();
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

  var retTo = null;
  function go(s, push) {
    if (['kiblat', 'hadis', 'khatam'].indexOf(s) >= 0) retTo = (screen === 'utama' || screen === 'cab') ? screen : null;
    screen = s;
    if (push && (['zkat', 'hadis', 'khatam', 'cabnew', 'pss', 'umr', 'rnk', 'buk'].indexOf(s) >= 0 || s === 'tetapan' || s === 'tentang' || s === 'qiam' || s === 'kiblat')) history.pushState({ s: s }, '');
    render();
    if (s === 'utama') refreshData(false);
  }
  window.addEventListener('popstate', function () { if (!firstRun) { screen = screen === 'zkat' ? 'zikir' : screen === 'cabnew' ? 'cab' : (retTo && ['kiblat', 'hadis', 'khatam'].indexOf(screen) >= 0) ? retTo : 'lagi'; retTo = null; render(); } });


  /* ----- Ciri baharu: Hadis, Khatam, Cabaran, Puasa Sunat, Umrah ----- */
  var F = window.ISTI_FITUR || { hadis: [], umrah: [], cab: [], pdf: '' };
  function tt(a, b) { return S.lang === 'en' ? b : a; }
  function dayIndex(d) { return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); }
  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((new Date(+pb[0], pb[1] - 1, +pb[2]) - new Date(+pa[0], pa[1] - 1, +pa[2])) / 86400000);
  }
  function shareText(txt) {
    if (navigator.share) navigator.share({ text: txt }).catch(function () { /* batal */ });
    else toast(tt('Perkongsian tidak disokong pada peranti ini', 'Sharing is not supported on this device'));
  }
  function ymdLabel(ymd) { var p = ymd.split('-'); return +p[2] + ' ' + T().ui.bulanM[p[1] - 1] + ' ' + p[0]; }
  function hjOf(d, adj) { var h = L.hijriAt(d, adj); return h.d + ' ' + T().ui.bulanH[h.m - 1]; }

  /* Hadis */
  var hdOpen = -1;
  function viewHadis() {
    var H = F.hadis, d = now(), ti = dayIndex(d) % H.length, h = H[ti], en = S.lang === 'en', k = en ? 1 : 0;
    var hero = '<section class="hero hadhero"><div class="hl">' + tt('HADIS HARI INI', 'HADITH OF THE DAY') + ' · ' + tt('Hadis ke-', 'Hadith ') + (ti + 1) + '</div><div class="hn">' + esc(h[k]) + '</div>' +
      '<div class="hbody">' + esc(h[2 + k]) + '</div><div class="hsrc">' + esc(h[4]) + '</div>' +
      '<button class="hshare" data-act="hdshare" data-n="' + ti + '">' + tt('Kongsi', 'Share') + '</button></section>';
    var rows = H.map(function (x, i) {
      var open = hdOpen === i;
      return '<button class="hrow' + (open ? ' on' : '') + '" data-act="hdopen" data-n="' + i + '" aria-expanded="' + open + '"><span class="hn2">' + (i + 1) + '</span><span class="ht">' + esc(x[k]) + '</span></button>' +
        (open ? '<div class="hdet"><div>' + esc(x[2 + k]) + '</div><div class="hsrc2">' + esc(x[4]) + '</div></div>' : '');
    }).join('');
    return topbar(u('hadisHari'), true) + '<main class="scroll">' + hero +
      '<div class="sech">' + tt('SEMUA 42 HADIS', 'ALL 42 HADITHS') + '</div><div class="hlist">' + rows + '</div>' +
      '<div class="note" style="margin:10px 4px 0">' + tt('Ringkasan dalam bahasa sendiri berdasarkan Hadis 40 Imam Nawawi (sebenarnya 42 hadis). Ia bukan teks penuh. Rujuk kitab untuk lafaz sebenar dan huraian.', 'Plain-language summaries based on Imam an-Nawawi’s Forty Hadith (42 in total). Not the full text. Refer to the book for the exact wording and explanation.') + '</div>' +
      '<button class="btn wide ghost" data-act="hdpdf" style="margin-top:10px">' + tt('Buka kitab penuh (PDF)', 'Open the full book (PDF)') + '</button></main>';
  }

  /* Khatam Quran */
  var K = Object.assign({ upTo: 0, start: '', count: 1 }, load('isti.khatam', {}));
  if (!K.start) K.start = L.ymd(now());
  function kSave() { save('isti.khatam', K); }
  function viewKhatam() {
    var today = L.ymd(now()), days = Math.max(1, daysBetween(K.start, today) + 1), up = Math.min(30, K.upTo || 0);
    var pct = Math.round(up / 30 * 100), avg = up / days, eta = '-';
    if (up >= 30) eta = tt('Khatam', 'Completed');
    else if (up > 0) {
      var need = Math.ceil((30 - up) / avg), ed = L.addDays(now(), need);
      eta = ed.getDate() + ' ' + T().ui.bulanM[ed.getMonth()];
    }
    var grid = '';
    for (var n = 1; n <= 30; n++) {
      var done = n <= up, nx = n === up + 1;
      grid += '<button class="jz' + (done ? ' on' : nx ? ' nx' : '') + '" data-act="kjz" data-n="' + n + '" aria-pressed="' + done + '" aria-label="' + tt('Juzuk ', 'Juz ') + n + (done ? ', ' + tt('sudah dibaca', 'read') : '') + '">' + n + '</button>';
    }
    return topbar(u('khatam'), true) + '<div class="zscroll kscroll">' +
      '<div class="ksub">' + tt('Khatam kali ke-', 'Completion no. ') + K.count + ' · ' + tt('tiada tempoh', 'no time limit') + '</div>' +
      '<div class="kring"><svg width="160" height="160" viewBox="0 0 160 160" fill="none" aria-hidden="true"><circle cx="80" cy="80" r="64" stroke="#1C4268" stroke-width="12"/><circle cx="80" cy="80" r="64" stroke="#E3C46F" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (up / 30 * 402.1).toFixed(1) + ' 402.1" transform="rotate(-90 80 80)"/></svg>' +
      '<div class="kin"><b>' + pct + '%</b><span>' + up + ' / 30 ' + tt('juzuk', 'juz') + '</span></div></div>' +
      '<div class="kstats"><div><span>' + tt('Hari', 'Day') + '</span><b>' + tt('Ke-', '') + days + '</b></div><div><span>' + tt('Purata', 'Average') + '</span><b>' + avg.toFixed(1) + ' ' + tt('juzuk/hari', 'juz/day') + '</b></div><div><span>' + tt('Anggaran khatam', 'Est. finish') + '</span><b>' + eta + '</b></div></div>' +
      '<div class="krow2"><label class="kdate">' + tt('Tarikh mula', 'Start date') + '<input id="kstart" type="date" value="' + K.start + '" max="' + today + '"></label>' +
      '<button class="kbtn" data-act="kshare">' + tt('Kongsi', 'Share') + '</button></div>' +
      '<div class="klbl">' + tt('Klik juzuk terakhir yang sudah dibaca', 'Tap the last juz you have read') + '</div><div class="kgrid">' + grid + '</div>' +
      (up >= 30 ? '<button class="kbtn gold" data-act="knext" style="margin:14px 20px 0;width:calc(100% - 40px)">' + tt('Mulakan khatam seterusnya', 'Start the next completion') + '</button>' : '') +
      '<button class="kbtn" data-act="kquran" style="margin:14px 20px 24px;width:calc(100% - 40px)">' + tt('Baca di Quran.com', 'Read on Quran.com') + ' ›</button></div>';
  }

  /* Cabaran */
  var C = Object.assign({ list: [] }, load('isti.cab', {}));
  function cSave() { save('isti.cab', C); }
  var cn = { dur: 'none', days: 30, name: '', start: '' };
  function cabName(c) { if (c.k) { var t = F.cab.filter(function (x) { return x[0] === c.k; })[0]; if (t) return S.lang === 'en' ? t[2] : t[1]; } return c.n; }
  function viewCab() {
    var today = L.ymd(now());
    var mine = C.list.map(function (c) {
      var n = c.done.length, tg = c.target, ticked = c.done.indexOf(today) >= 0, fin = tg > 0 && n >= tg, day = Math.max(1, daysBetween(c.start, today) + 1);
      var prog = tg > 0 ? n + ' / ' + tg : n + ' ' + tt('kali', 'times');
      var sub = tt('Hari ke-', 'Day ') + day + ' · ' + tt('mula ', 'started ') + ymdLabel(c.start);
      return '<div class="card cabc"><div class="cabh"><div><div class="cabn">' + esc(cabName(c)) + '</div><div class="cabs">' + sub + '</div></div><button class="cabx" data-act="cabdel" data-id="' + c.id + '" aria-label="' + u('buang') + '">✕</button></div>' +
        '<div class="cabp"><b>' + prog + '</b>' + (fin ? '<span class="cabok">' + tt('Selesai ✓', 'Done ✓') + '</span>' : '') + '</div>' +
        (tg > 0 ? '<div class="bar"><div style="width:' + Math.min(100, n / tg * 100) + '%"></div></div>' : '') +
        '<button class="btn wide' + (ticked ? ' ghost' : '') + '" data-act="cabtick" data-id="' + c.id + '" style="margin-top:10px">' + (ticked ? tt('✓ Hari ini sudah ditanda (klik untuk batal)', '✓ Done today (tap to undo)') : tt('Tanda siap hari ini', 'Mark today done')) + '</button>' +
        '<button class="cabshare" data-act="cabshare" data-id="' + c.id + '">' + tt('Kongsi', 'Share') + '</button></div>';
    }).join('') || '<div class="note" style="margin:0 4px 6px">' + tt('Belum ada cabaran. Pilih satu di bawah atau cipta sendiri.', 'No challenges yet. Pick one below or create your own.') + '</div>';
    var avail = F.cab.filter(function (t) { return !C.list.some(function (c) { return c.k === t[0]; }); }).map(function (t) {
      return '<div class="cabrow"><div><div class="cabn">' + esc(S.lang === 'en' ? t[2] : t[1]) + '</div><div class="cabs">' + t[3] + ' ' + tt('kali', 'times') + '</div></div><button class="btn sm" data-act="cabadd" data-k="' + t[0] + '" style="margin:0">' + tt('Mula', 'Start') + '</button></div>';
    }).join('');
    var kup = Math.min(30, K.upTo || 0), kdays = Math.max(1, daysBetween(K.start, today) + 1);
    var kcard = '<button class="card cabc kcab" data-go="khatam"><div class="cabh"><div><div class="kcl">' + tt('KHATAM QURAN', 'QURAN COMPLETION') + '</div><div class="cabn">' + (kup >= 30 ? tt('Khatam ✓', 'Completed ✓') : tt('Hari ke-', 'Day ') + kdays + ' · ' + kup + ' / 30 ' + tt('juzuk', 'juz')) + '</div></div><span class="kchev">›</span></div>' +
      '<div class="bar"><div style="width:' + Math.round(kup / 30 * 100) + '%"></div></div><div class="cabs" style="margin-top:6px">' + tt('Klik untuk buka skrin juzuk', 'Tap to open the juz screen') + '</div></button>';
    return topbar(u('cabaran'), false) + '<main class="scroll"><div class="sech" style="margin-top:4px">' + tt('CABARAN SAYA', 'MY CHALLENGES') + '</div>' + kcard + mine +
      '<button class="btn wide ghost" data-go="cabnew" style="margin:6px 0 4px">+ ' + tt('Cipta cabaran sendiri', 'Create your own challenge') + '</button>' +
      '<div class="sech">' + tt('CABARAN SEDIA ADA', 'READY-MADE CHALLENGES') + '</div><div class="card">' + (avail || '<div class="note" style="margin:0">' + tt('Semua sudah dimulakan.', 'All started.') + '</div>') + '</div>' +
      '<div class="note" style="margin:6px 4px 0">' + tt('Papan kedudukan dalam talian belum ada. Kemajuan disimpan pada telefon ini sahaja.', 'There is no online leaderboard yet. Progress is stored on this phone only.') + '</div></main>';
  }
  function viewCabNew() {
    var today = L.ymd(now());
    var durs = [['none', tt('Tiada tempoh', 'No limit')], ['30', tt('30 hari', '30 days')], ['own', tt('Bilangan sendiri', 'Own number')]];
    return topbar(tt('Cabaran Baharu', 'New Challenge'), 'cab') + '<main class="scroll">' +
      '<div class="card"><span class="lbl">' + tt('NAMA CABARAN', 'CHALLENGE NAME') + '</span><input id="cnname" class="inp cin" maxlength="50" value="' + esc(cn.name) + '" placeholder="' + tt('Contoh: Baca al-Mulk setiap malam', 'e.g. Read al-Mulk every night') + '">' +
      '<span class="lbl" style="margin-top:14px">' + tt('TEMPOH', 'DURATION') + '</span><div class="seg">' + durs.map(function (x) { return '<button class="' + (cn.dur === x[0] ? 'on' : '') + '" data-act="cabdur" data-v="' + x[0] + '" aria-pressed="' + (cn.dur === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      (cn.dur === 'own' ? '<input id="cndays" class="inp cin" type="number" inputmode="numeric" min="1" max="365" value="' + cn.days + '" style="margin-top:10px" aria-label="' + tt('Bilangan hari', 'Number of days') + '">' : '') +
      '<span class="lbl" style="margin-top:14px">' + tt('TARIKH MULA', 'START DATE') + '</span><input id="cnstart" class="inp cin" type="date" value="' + (cn.start || today) + '"><div class="note">' + tt('Boleh pilih tarikh lepas jika sudah mula lebih awal.', 'You may pick a past date if you already started.') + '</div></div>' +
      '<button class="btn wide" data-act="cabsave">' + tt('Cipta cabaran', 'Create challenge') + '</button></main>';
  }
  function cnRead() {
    var a = document.getElementById('cnname'), b = document.getElementById('cndays'), c = document.getElementById('cnstart');
    if (a) cn.name = a.value; if (b) cn.days = parseInt(b.value, 10) || 30; if (c && c.value) cn.start = c.value;
  }

  /* Puasa Sunat */
  var P = Object.assign({ done: {} }, load('isti.puasa', {}));
  function pSave() { save('isti.puasa', P); }
  function puasaDay(d, adj) {
    var h = L.hijriAt(d, adj), dow = d.getDay(), out = [], bad = null;
    if (h.m === 9) return { wajib: true, tags: [], bad: null, h: h };
    if (h.m === 10 && h.d === 1) bad = tt('Hari Raya Aidilfitri, haram berpuasa', 'Eid al-Fitr, fasting is forbidden');
    if (h.m === 12 && h.d >= 10 && h.d <= 13) bad = h.d === 10 ? tt('Hari Raya Aidiladha, haram berpuasa', 'Eid al-Adha, fasting is forbidden') : tt('Hari Tasyrik, haram berpuasa', 'Days of Tashriq, fasting is forbidden');
    if (bad) return { wajib: false, tags: [], bad: bad, h: h };
    if (dow === 1) out.push(tt('Isnin', 'Monday'));
    if (dow === 4) out.push(tt('Khamis', 'Thursday'));
    if (h.d >= 13 && h.d <= 15) out.push(tt('Ayyamul Bidh', 'Ayyam al-Bid'));
    if (h.m === 12 && h.d === 9) out.push(tt('Hari Arafah', 'Day of Arafah'));
    if (h.m === 1 && h.d === 9) out.push(tt('Tasu’a', 'Tasu’a'));
    if (h.m === 1 && h.d === 10) out.push(tt('Asyura', 'Ashura'));
    if (h.m === 10 && h.d >= 2 && h.d <= 7) out.push(tt('Puasa 6 Syawal', '6 days of Shawwal'));
    return { wajib: false, tags: out, bad: null, h: h };
  }
  function viewPuasa() {
    var t0 = now(), adj = adjustFor(t0), today = L.ymd(t0), rows = '', cnt = 0, doneMonth = 0, td = puasaDay(t0, adj);
    for (var key in P.done) { if (P.done[key] && key.slice(0, 7) === today.slice(0, 7)) doneMonth++; }
    for (var i = 0; i < 45 && cnt < 14; i++) {
      var d = L.addDays(t0, i), pd = puasaDay(d, adj), ymd = L.ymd(d);
      if (!pd.tags.length && !pd.bad) continue;
      cnt++;
      var dn = i === 0 ? tt('Hari ini', 'Today') : i === 1 ? tt('Esok', 'Tomorrow') : '';
      var on = !!P.done[ymd];
      rows += '<div class="prow' + (pd.bad ? ' bad' : '') + '"><div class="pd"><b>' + T().ui.hari[d.getDay()].slice(0, 3) + ' ' + d.getDate() + '</b><span>' + T().ui.bulanM[d.getMonth()].slice(0, 3) + '</span></div>' +
        '<div class="pm"><div class="pn">' + (pd.bad ? esc(pd.bad) : esc(pd.tags.join(' · '))) + '</div><div class="ps2">' + hjOf(d, adj) + (dn ? ' · ' + dn : '') + '</div></div>' +
        (pd.bad ? '<span class="pnone"></span>' : '<button class="pchk' + (on ? ' on' : '') + '" data-act="ptick" data-d="' + ymd + '" aria-pressed="' + on + '" aria-label="' + tt('Tanda puasa', 'Mark fasted') + ' ' + ymd + '">' + (on ? '✓' : '') + '</button>') + '</div>';
    }
    var statusTxt = td.wajib ? tt('Ramadan: puasa wajib', 'Ramadan: obligatory fast') : td.bad ? td.bad : td.tags.length ? tt('Hari ini sunat berpuasa: ', 'Sunnah to fast today: ') + td.tags.join(' · ') : tt('Hari ini tiada puasa sunat khusus.', 'No specific sunnah fast today.');
    return topbar(u('puasaSunat'), true) + '<main class="scroll">' +
      '<section class="hero pshero"><div class="hl">' + tt('HARI INI', 'TODAY') + '</div><div class="hn">' + esc(statusTxt) + '</div><div class="hs">' + tt('Bulan ini: ', 'This month: ') + doneMonth + ' ' + tt('hari berpuasa sunat', 'sunnah fasts') + '</div></section>' +
      '<div class="sech">' + tt('SENARAI AKAN DATANG', 'UPCOMING') + '</div><div class="plist">' + (rows || '<div class="note">-</div>') + '</div>' +
      '<div class="note" style="margin:10px 4px 0">' + tt('Tarikh Hijrah dikira daripada data JAKIM dan Umm al-Qura, boleh berbeza sehari mengikut rukyah. Isnin dan Khamis setiap minggu, Ayyamul Bidh (13 hingga 15 Hijrah), Arafah, Tasu’a dan Asyura, serta 6 hari Syawal.', 'Hijri dates come from JAKIM and Umm al-Qura data and may differ by a day with moon sighting. Mondays and Thursdays, Ayyam al-Bid (13th to 15th), Arafah, Tasu’a and Ashura, and 6 days of Shawwal.') + '</div></main>';
  }

  /* Umrah */
  var UM = Object.assign({ done: {} }, load('isti.umrah', {}));
  function uSave() { save('isti.umrah', UM); }
  function viewUmrah() {
    var en = S.lang === 'en', n = 0;
    var rows = F.umrah.map(function (x, i) {
      var d = !!UM.done[i]; if (d) n++;
      var tag = x[4] === 'R' ? tt('Rukun', 'Pillar') : tt('Sunat', 'Sunnah');
      return '<button class="urow' + (d ? ' on' : '') + '" data-act="utick" data-n="' + i + '" aria-pressed="' + d + '"><span class="uc">' + (d ? '✓' : '') + '</span><span class="um"><b>' + (i + 1) + '. ' + esc(x[en ? 1 : 0]) + '</b><span>' + esc(x[en ? 3 : 2]) + '</span></span><span class="utag ' + x[4] + '">' + tag + '</span></button>';
    }).join('');
    return topbar(u('umrah'), true) + '<main class="scroll"><div class="card"><div class="ucount">' + n + ' / ' + F.umrah.length + '</div><div class="bar"><div style="width:' + (n / F.umrah.length * 100) + '%"></div></div></div>' +
      '<div class="ulist">' + rows + '</div><button class="btn wide ghost" data-act="ureset" style="margin-top:10px">' + tt('Set semula senarai', 'Reset list') + '</button>' +
      '<div class="note" style="margin:10px 4px 0">' + tt('Senarai ini hanya ringkasan turutan untuk semakan sendiri. Cara dan bacaan sebenar, rujuk nota kursus dan mutawwif anda.', 'This is only a summary of the order for your own checking. For the exact method and recitations, refer to your course notes and mutawwif.') + '</div></main>';
  }


  /* Ranking peribadi (mata, tahap, streak) */
  var R = Object.assign({ log: {} }, load('isti.rank', {}));
  function rSave() { save('isti.rank', R); }
  function award(pts) { var t = L.ymd(now()); R.log[t] = Math.max(0, (R.log[t] || 0) + pts); rSave(); }
  var LVL = [0, 200, 800, 1500, 3000, 6000, 10000];
  var LVN = [['Pemula', 'Beginner'], ['Perintis', 'Pioneer'], ['Penekun', 'Devoted'], ['Istiqamah', 'Steadfast'], ['Mujahid', 'Striver'], ['Muttaqin', 'God-fearing'], ['Abid', 'Worshipper']];
  function rankInfo() {
    var tot = 0, k; for (k in R.log) tot += R.log[k];
    var lv = 0; for (var i = 0; i < LVL.length; i++) if (tot >= LVL[i]) lv = i;
    var next = lv < LVL.length - 1 ? LVL[lv + 1] : null;
    var pct = next ? Math.round((tot - LVL[lv]) / (next - LVL[lv]) * 100) : 100;
    var keys = Object.keys(R.log).filter(function (x) { return R.log[x] > 0; }).sort();
    var has = {}; keys.forEach(function (x) { has[x] = 1; });
    var cur = 0, d = now(); if (!has[L.ymd(d)]) d = L.addDays(d, -1);
    while (has[L.ymd(d)]) { cur++; d = L.addDays(d, -1); }
    var best = 0, run = 0, prev = null;
    keys.forEach(function (x) { run = prev && daysBetween(prev, x) === 1 ? run + 1 : 1; if (run > best) best = run; prev = x; });
    return { tot: tot, lv: lv, next: next, pct: pct, cur: cur, best: Math.max(best, cur) };
  }
  function viewRank() {
    var r = rankInfo(), en = S.lang === 'en', t0 = now(), days = [], mx = 1;
    for (var i = 6; i >= 0; i--) { var d = L.addDays(t0, -i); days.push({ d: d, v: R.log[L.ymd(d)] || 0 }); }
    days.forEach(function (x) { if (x.v > mx) mx = x.v; });
    var bars = days.map(function (x, i) {
      return '<div class="rbc"><div class="rb' + (i === 6 ? ' td' : '') + '" style="height:' + Math.max(3, Math.round(x.v / mx * 70)) + 'px"></div><span>' + T().ui.hari[x.d.getDay()].slice(0, 3) + '</span></div>';
    }).join('');
    var pts = [['Zikir capai sasaran', 'Dhikr target reached', 5], ['Tasbih selepas solat selesai', 'Post-prayer tasbih complete', 10], ['Tanda cabaran hari ini', 'Challenge marked today', 10], ['Satu juzuk dibaca', 'One juz read', 10], ['Puasa sunat', 'Sunnah fast', 20], ['Item Qiamullail', 'Qiyam al-Layl item', 5], ['Cabaran selesai', 'Challenge completed', 50]];
    return topbar(tt('Ranking Saya', 'My Ranking'), true) + '<main class="scroll">' +
      '<div class="rhero"><div class="rhl">' + tt('TAHAP ', 'LEVEL ') + (r.lv + 1) + ' · ' + LVN[r.lv][en ? 1 : 0].toUpperCase() + '</div><div class="rbig">' + r.tot.toLocaleString() + ' <span>' + tt('mata', 'points') + '</span></div>' +
      '<div class="rpb"><div style="width:' + r.pct + '%"></div></div><div class="rhs">' + (r.next ? tt((r.next - r.tot) + ' mata lagi ke Tahap ' + (r.lv + 2) + ' · ' + LVN[r.lv + 1][0], (r.next - r.tot) + ' points to Level ' + (r.lv + 2) + ' · ' + LVN[r.lv + 1][1]) : tt('Tahap tertinggi dicapai', 'Top level reached')) + '</div></div>' +
      '<div class="rrow"><div class="rbox"><b>' + tt('BERTURUT-TURUT', 'CURRENT STREAK') + '</b><span>' + r.cur + ' ' + tt('hari', 'days') + (r.cur > 0 ? ' 🔥' : '') + '</span></div><div class="rbox"><b>' + tt('TERPANJANG', 'LONGEST') + '</b><span>' + r.best + ' ' + tt('hari', 'days') + '</span></div></div>' +
      '<div class="card" style="margin-top:10px"><span class="lbl gold" style="margin-bottom:6px">' + tt('MATA 7 HARI LEPAS', 'POINTS, LAST 7 DAYS') + '</span><div class="rbars">' + bars + '</div></div>' +
      '<div class="card"><span class="lbl gold" style="margin-bottom:6px">' + tt('BAGAIMANA MATA DIPEROLEH', 'HOW POINTS ARE EARNED') + '</span>' + pts.map(function (x) { return '<div class="rpt"><span>' + x[en ? 1 : 0] + '</span><b>+' + x[2] + '</b></div>'; }).join('') + '</div>' +
      '<div class="note" style="margin:6px 4px 0">' + tt('Hari dikira berturut bila ada sekurang-kurangnya satu amalan. Data hanya pada telefon ini. Tiada ranking dengan orang lain.', 'A day counts toward the streak when you do at least one deed. Data stays on this phone. There is no ranking against other people.') + '</div></main>';
  }
  function viewBuku() {
    return topbar(u('buku'), true) + '<main class="scroll"><div class="bkempty"><div style="font-size:40px">📚</div><div class="bkt">' + tt('Akan datang', 'Coming soon') + '</div><div class="note" style="margin-top:6px">' + tt('Senarai buku agama pilihan akan dipaparkan di sini, insya-Allah.', 'A list of recommended Islamic books will appear here, insha’Allah.') + '</div></div></main>';
  }

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
      }).then(function (data) {
        return Media.getAlbumsPath().then(function (r) {
          var base = r.path;
          return Media.createAlbum({ name: 'Istiqamah' }).catch(function () { /* sudah ada */ }).then(function () {
            return Media.savePhoto({ path: data, albumIdentifier: base + '/Istiqamah', fileName: 'Istiqamah-DuitNow-QR' });
          });
        });
      })
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
    var el = e.target.closest('[data-go],[data-filter],[data-bell],[data-tar],[data-set],[data-act],[data-zsel],[data-zkadd],[data-zdel],[data-qchk],[data-qdel],[data-sbell]');
    if (!el) return;
    if (el.dataset.go) {
      var gt = el.dataset.go;
      if (gt === 'lagi' && retTo && ['kiblat', 'hadis', 'khatam'].indexOf(screen) >= 0) { gt = retTo; retTo = null; return go(gt, false); }
      return go(gt, true);
    }
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
      else if (n === 'tahMode') S.tahMode = v;
      else if (n === 'dhuhaN') { S.bells = S.bells || {}; S.bells.dhuha = v === 'mula' ? 1 : 0; S.bells.dhuhaa = v === 'afdhal' ? 1 : 0; }
      else if (n === 'zoneAuto') {
        S.zoneAuto = v === '1'; persist();
        if (S.zoneAuto && !firstRun) { render(); return autoZone(true); }
        return render();
      }
      persist(); reschedule(); return render();
    }
    if (el.dataset.zsel) { Z.sel = el.dataset.zsel; zSave(); return render(); }
    if (el.dataset.zdel) {
      var did = el.dataset.zdel;
      Z.custom = Z.custom.filter(function (c) { return c.id !== did; });
      Z.list = Z.list.filter(function (x) { return x !== did; });
      if (Z.sel === did) Z.sel = 'g_solat';
      zSave(); return render();
    }
    if (el.dataset.zkadd) {
      var kid = el.dataset.zkadd, ki = Z.list.indexOf(kid);
      if (ki >= 0) Z.list.splice(ki, 1); else Z.list.push(kid);
      zSave(); return render();
    }
    if (el.dataset.qchk) {
      var qi = Q.done.indexOf(el.dataset.qchk);
      if (qi >= 0) { Q.done.splice(qi, 1); award(-5); } else { Q.done.push(el.dataset.qchk); award(5); }
      qSave(); return render();
    }
    if (el.dataset.qdel) { Q.items = Q.items.filter(function (i) { return i.id !== el.dataset.qdel; }); qSave(); return render(); }
    if (el.dataset.sbell) {
      var sk = el.dataset.sbell; S.sbells = S.sbells || {}; S.sbells[sk] = sbellOn(sk) ? 0 : 1; persist(); reschedule(); return render();
    }
    var a = el.dataset.act;
    if (a === 'kalm') { var dd = +el.dataset.d; KM.off = dd === 0 ? 0 : KM.off + dd; return render(); }
    if (a === 'kalev') {
      var ek = el.dataset.k, er = document.getElementById('kev-' + ek);
      Array.prototype.forEach.call(document.querySelectorAll('.krow.hl'), function (x) { x.classList.remove('hl'); });
      if (er) { er.classList.add('hl'); er.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    }
    if (a === 'tozikir') { Z.sel = zToday().id; zSave(); return go('zikir', false); }
    if (a === 'hdopen') { var hi = +el.dataset.n; hdOpen = hdOpen === hi ? -1 : hi; return render(); }
    if (a === 'hdshare') { var hh = F.hadis[+el.dataset.n], k2 = S.lang === 'en' ? 1 : 0; return shareText(hh[k2] + '\n' + hh[2 + k2] + '\n(' + hh[4] + ')\n— Istiqamah'); }
    if (a === 'hdpdf') { location.href = F.pdf; return; }
    if (a === 'kjz') { var jn = +el.dataset.n, mc = K.claimed || 0; if (jn > mc) { award((jn - mc) * 10); K.claimed = jn; } K.upTo = jn === K.upTo ? jn - 1 : jn; kSave(); return render(); }
    if (a === 'kshare') return shareText(tt('Khatam Quran: ', 'Quran completion: ') + K.upTo + '/30 ' + tt('juzuk', 'juz') + '\n— Istiqamah');
    if (a === 'knext') { K.count++; K.upTo = 0; K.claimed = 0; K.start = L.ymd(now()); kSave(); return render(); }
    if (a === 'kquran') { location.href = 'https://quran.com'; return; }
    if (a === 'cabadd') {
      var ct = F.cab.filter(function (x) { return x[0] === el.dataset.k; })[0];
      if (ct) { C.list.push({ id: uid(), k: ct[0], n: ct[1], target: ct[3], start: L.ymd(now()), done: [] }); cSave(); }
      return render();
    }
    if (a === 'cabtick') {
      var cc = C.list.filter(function (x) { return x.id === el.dataset.id; })[0], td = L.ymd(now());
      if (cc) { var ix = cc.done.indexOf(td); if (ix >= 0) { cc.done.splice(ix, 1); award(-10); } else { cc.done.push(td); award(10); if (cc.target > 0 && cc.done.length === cc.target) { award(50); } if (cc.target > 0 && cc.done.length === cc.target) toast(tt('Alhamdulillah, cabaran selesai!', 'Alhamdulillah, challenge complete!')); } cSave(); }
      return render();
    }
    if (a === 'cabdel') { C.list = C.list.filter(function (x) { return x.id !== el.dataset.id; }); cSave(); return render(); }
    if (a === 'cabshare') {
      var cs = C.list.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (cs) shareText(cabName(cs) + ': ' + cs.done.length + (cs.target ? '/' + cs.target : '') + '\n— Istiqamah');
      return;
    }
    if (a === 'cabdur') { cnRead(); cn.dur = el.dataset.v; return render(); }
    if (a === 'cabsave') {
      cnRead();
      var nm = (cn.name || '').trim(); if (!nm) return document.getElementById('cnname').focus();
      var tgt = cn.dur === '30' ? 30 : cn.dur === 'own' ? Math.max(1, Math.min(365, cn.days)) : 0;
      C.list.push({ id: uid(), n: nm, target: tgt, start: cn.start || L.ymd(now()), done: [] }); cSave();
      cn = { dur: 'none', days: 30, name: '', start: '' }; screen = 'cab'; return render();
    }
    if (a === 'ptick') { P.done[el.dataset.d] = !P.done[el.dataset.d]; award(P.done[el.dataset.d] ? 20 : -20); pSave(); return render(); }
    if (a === 'utick') { var un = el.dataset.n; UM.done[un] = !UM.done[un]; uSave(); return render(); }
    if (a === 'ureset') { UM.done = {}; uSave(); return render(); }
    if (a === 'zcount') {
      var grp = Z.sel === 'g_solat', zi = zCur(), zt = zTarget(zi);
      if (grp && Z.gdone) return;
      var n1 = (Z.counts[zi.id] || 0) + 1;
      Z.counts[zi.id] = n1;
      if (grp && n1 >= zt) {
        buzz([80, 50, 100]);
        if (Z.step < 2) { Z.step++; toast(u('zSeterusnya').replace('{n}', zFind(ZG[Z.step]).n)); }
        else { Z.gdone = true; award(10); toast(u('gSelesai')); }
        zSave(); widgetSync(); return render();
      }
      zSave(); widgetSync(); buzz(n1 === zt ? [80, 50, 100] : 60);
      if (!grp && n1 === zt) { award(5); toast(u('zCapai')); }
      return zRefresh();
    }
    if (a === 'zreset') {
      if (Z.sel === 'g_solat') { ZG.forEach(function (g) { Z.counts[g] = 0; }); Z.step = 0; Z.gdone = false; }
      else Z.counts[zCur().id] = 0;
      zSave(); widgetSync(); return render();
    }
    if (a === 'ztoday') { var tdd = zToday(); Z.sel = tdd.id; zSave(); return render(); }
    if (a === 'zvib') { Z.vibrate = !Z.vibrate; zSave(); buzz(60); return render(); }
    if (a === 'ztarget') {
      var cur = zCur(), opts = [33, 99, 100], ix = opts.indexOf(zTarget(cur));
      Z.targets[cur.id] = opts[(ix + 1) % opts.length]; zSave(); return render();
    }
    if (a === 'zadd') { zForm = true; return render(); }
    if (a === 'zcancel') { zForm = false; return render(); }
    if (a === 'zsave') {
      var zn = (document.getElementById('zname').value || '').trim(), zc2 = parseInt(document.getElementById('zcnt').value, 10);
      if (!zn) return document.getElementById('zname').focus();
      var cid = uid(); Z.custom.push({ id: cid, n: zn, t: zc2 > 0 ? zc2 : 33 }); Z.sel = cid; zForm = false; zSave(); screen = 'zikir'; return render();
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
      render(); return refreshData(false).then(function () { return autoZone(true); });
    }
    if (a === 'saveqr') return saveQR();
    if (a === 'soon') return toast(u('tibaToast'));
    if (a === 'zoncheck') return autoZone(true);
    if (a === 'mulaNext') {
      mulaDone = true; persist();
      if (S.zoneAuto) { return autoZone(true).then(function () { render(); }); }
      return render();
    }
    if (a === 'upd') { if (U.newer) location.href = U.newer.url; return; }
    if (a === 'updcheck') return checkUpdate(true);
    if (a === 'kbloc') return kbLocate();
    if (a === 'mail') {
      var addr = 'farid.assamani@gmail.com';
      location.href = 'mailto:' + addr + '?subject=' + encodeURIComponent(u('emelSubjek') + ' v' + APP_VERSION) + '&body=' + encodeURIComponent(u('emelBadan'));
      return;
    }
    if (a === 'install') {
      if (installEvt) { installEvt.prompt(); installEvt = null; } else toast(u('ikutSistem'));
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'kstart' && e.target.value) { K.start = e.target.value; kSave(); render(); return; }
    if (e.target.id === 'zsel') {
      S.zone = e.target.value; persist(); loadCache();
      if (!firstRun) { refreshData(true); } else refreshData(false);
    }
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; });

  /* ---------- mula ---------- */
  loadCache();
  render();
  pullZikir().then(pullOpen);
  refreshData(false).then(function () { reschedule(); return autoZone(false); });
  checkUpdate(false);

  var lastMin = -1;
  setInterval(function () {
    var d = now(), m = d.getHours() * 60 + d.getMinutes();
    if (m !== lastMin) { lastMin = m; if (screen === 'utama' && !firstRun) render(); }
  }, 15000);
  function wake() {
    wReady = !WGT; pullZikir().then(function () { render(); return pullOpen(); }); refreshData(false); reschedule(); checkUpdate(false); autoZone(false);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
  if (isNative && Cap.Plugins && Cap.Plugins.App && Cap.Plugins.App.addListener) {
    Cap.Plugins.App.addListener('resume', wake);
  }

  if (!isNative && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
