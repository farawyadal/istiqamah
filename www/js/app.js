/* Istiqamah – UI, data JAKIM, notifikasi */
(function () {
  'use strict';
  var L = window.IstiLogic, I18N = window.ISTI_I18N, ZONES = window.ISTI_ZONES;
  var APP_VERSION = '0.1.1';
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
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    gear: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
    info: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7A5C12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    star: '<svg width="130" height="130" viewBox="0 0 100 100" fill="none" stroke="#E3C46F" stroke-width="0.8" aria-hidden="true" class="deco"><rect x="18" y="18" width="64" height="64"/><rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)"/></svg>',
    logo: '<svg width="56" height="56" viewBox="0 0 100 100" role="img" aria-label="Ikon Istiqamah"><rect width="100" height="100" rx="18" fill="#0A2540"/><rect x="20" y="20" width="60" height="60" fill="none" stroke="#E3C46F" stroke-width="2"/><rect x="20" y="20" width="60" height="60" fill="none" stroke="#E3C46F" stroke-width="2" transform="rotate(45 50 50)"/><text x="50" y="71" text-anchor="middle" font-family="Amiri,serif" font-size="66" font-weight="700" fill="#E3C46F" stroke="none">ا</text></svg>'
  };

  function nav() {
    var a = screen === 'utama' ? 'on' : '';
    var b = screen === 'lagi' || screen === 'tetapan' || screen === 'tentang' ? 'on' : '';
    return '<nav class="nav"><button data-go="utama" class="' + a + '" aria-current="' + (a ? 'page' : 'false') + '">' + ICON.home + u('utama') + '</button>' +
      '<button data-go="lagi" class="' + b + '" aria-current="' + (b ? 'page' : 'false') + '">' + ICON.grid + u('lagi') + '</button></nav>';
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
    else if (screen === 'lagi') html = viewLagi();
    else if (screen === 'tetapan') html = viewTetapan();
    else html = viewTentang();
    var withNav = !firstRun;
    root.innerHTML = '<div class="screen">' + html + '</div>' + (withNav ? nav() : '');
    document.documentElement.lang = S.lang === 'en' ? 'en' : 'ms';
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
    if (push && (s === 'tetapan' || s === 'tentang')) history.pushState({ s: s }, '');
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
    var el = e.target.closest('[data-go],[data-filter],[data-bell],[data-tar],[data-set],[data-act]');
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
    var a = el.dataset.act;
    if (a === 'retry' || a === 'refresh') return refreshData(true).then(function (ok) { if (a === 'refresh' && ok) toast(u('dikemaskini')); });
    if (a === 'perm') return askPermission();
    if (a === 'exact') return askExact();
    if (a === 'done') {
      firstRun = false; persist(); screen = 'utama';
      askPermission().then(askExact);
      render(); return refreshData(false);
    }
    if (a === 'saveqr') return saveQR();
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
  refreshData(false).then(function () { reschedule(); });

  var lastMin = -1;
  setInterval(function () {
    var d = now(), m = d.getHours() * 60 + d.getMinutes();
    if (m !== lastMin) { lastMin = m; if (screen === 'utama' && !firstRun) render(); }
  }, 15000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { render(); refreshData(false); reschedule(); }
  });
  if (isNative && Cap.Plugins && Cap.Plugins.App && Cap.Plugins.App.addListener) {
    Cap.Plugins.App.addListener('resume', function () { render(); refreshData(false); reschedule(); });
  }

  if (!isNative && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
