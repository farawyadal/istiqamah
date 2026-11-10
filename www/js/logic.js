/* Istiqamah – logik tulen (tiada DOM). Dipakai oleh app dan ujian. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.IstiLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 1440;

  function mins(t) {
    return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
  }
  function hhmm(m) {
    m = ((Math.round(m) % DAY) + DAY) % DAY;
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  }
  function pad2(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);
    return x;
  }
  function dayIndex(d) {
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  /* ---------- Hijri ---------- */
  var fmtCache = null;
  function umalqura(d) {
    if (!fmtCache) {
      fmtCache = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
        day: 'numeric', month: 'numeric', year: 'numeric'
      });
    }
    var out = { d: 1, m: 1, y: 1400 };
    fmtCache.formatToParts(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)).forEach(function (p) {
      if (p.type === 'day') out.d = parseInt(p.value, 10);
      else if (p.type === 'month') out.m = parseInt(p.value, 10);
      else if (p.type === 'year') out.y = parseInt(p.value, 10);
    });
    return out;
  }
  // "1448-05-28" -> {y,m,d}
  function parseJakimHijri(s) {
    if (!s || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return null;
    var p = s.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  // Cari anjakan (-2..2 hari) supaya Umm al-Qura sama dengan tarikh Hijri JAKIM hari ini.
  function hijriAdjust(today, jakimHijri) {
    if (!jakimHijri) return 0;
    for (var a = 0; a <= 2; a++) {
      var cands = a === 0 ? [0] : [a, -a];
      for (var i = 0; i < cands.length; i++) {
        var h = umalqura(addDays(today, cands[i]));
        if (h.d === jakimHijri.d && h.m === jakimHijri.m && h.y === jakimHijri.y) return cands[i];
      }
    }
    return 0;
  }
  function hijriAt(date, adj) { return umalqura(addDays(date, adj || 0)); }

  /* ---------- Sambutan ---------- */
  // [bulan, hari, kunci]
  var SAMBUTAN = [
    [1, 1, 'awalMuharram'], [1, 10, 'asyura'], [3, 12, 'maulid'], [7, 27, 'israk'],
    [8, 15, 'nisfu'], [9, 1, 'awalRamadan'], [9, 17, 'nuzul'], [10, 1, 'aidilfitri'],
    [12, 9, 'arafah'], [12, 10, 'aidiladha']
  ];
  function sambutanOf(h) {
    for (var i = 0; i < SAMBUTAN.length; i++) {
      if (SAMBUTAN[i][0] === h.m && SAMBUTAN[i][1] === h.d) return SAMBUTAN[i][2];
    }
    return null;
  }
  // Sambutan terdekat dalam `within` hari (termasuk hari ini).
  function nextSambutan(date, adj, within) {
    for (var i = 0; i <= within; i++) {
      var dt = addDays(date, i);
      var k = sambutanOf(hijriAt(dt, adj));
      if (k) return { key: k, days: i, date: dt };
    }
    return null;
  }

  /* ---------- Mod hari ---------- */
  function dayFlags(date, hijri, male) {
    return {
      jumaat: date.getDay() === 5 && !!male,
      raya: (hijri.m === 10 && hijri.d === 1) || (hijri.m === 12 && hijri.d === 10),
      ramadan: hijri.m === 9
    };
  }

  /* ---------- Senarai solat satu hari ----------
     t = {fajr, syuruk, dhuha, dhuhr, asr, maghrib, isha} (HH:MM[:SS])
     Pulangkan [{k, m, fardu}] diisih ikut masa (qabliyah sebelum fardu). */
  // Had waktu tahajud tetap: paling awal 02:00, paling lewat 30 minit sebelum Subuh (bulat ke 5 minit).
  var TAH_MIN = 120, TAH_STEP = 5, TAH_BEFORE_SUBUH = 30;
  function tahajudMax(t) {
    var f = t && t.fajr ? mins(t.fajr) : 348;
    return Math.max(TAH_MIN, Math.floor((f - TAH_BEFORE_SUBUH) / TAH_STEP) * TAH_STEP);
  }
  function tahajudClamp(v, t) {
    v = Math.round(v / TAH_STEP) * TAH_STEP;
    return Math.min(tahajudMax(t), Math.max(TAH_MIN, v));
  }

  function buildItems(t, flags, opts) {
    var fajr = mins(t.fajr), syuruk = mins(t.syuruk), dhuha = mins(t.dhuha),
      dhuhr = mins(t.dhuhr), asr = mins(t.asr), maghrib = mins(t.maghrib), isha = mins(t.isha);
    var nightLen = (fajr + DAY) - maghrib;
    var tahajud = maghrib + Math.round(nightLen * 2 / 3);
    var L = [];
    function add(k, m, fardu) { L.push({ k: k, m: m, fardu: !!fardu }); }

    if (opts && opts.tahMode === 'fixed') tahajud = tahajudClamp(opts.tahMin == null ? 240 : opts.tahMin, t);
    add('tahajud', tahajud % DAY, 0);
    add('qsubuh', fajr, 0);
    add('subuh', fajr, 1);
    add('isyraq', syuruk + 15, 0);
    add('dhuha', dhuha, 0);
    add('dhuhaa', Math.min(syuruk + Math.round((mins(t.maghrib) - syuruk) / 4), mins(t.dhuhr) - 20), 0);
    if (flags.raya) add('raya', dhuha + 10, 0);
    if (flags.jumaat) {
      add('tahiyat', dhuhr - 8, 0);
      add('qjumaat', dhuhr, 0);
      add('jumaat', dhuhr, 1);
      add('bjumaat', dhuhr + 15, 0);
    } else {
      add('qzohor', dhuhr, 0);
      add('zohor', dhuhr, 1);
      add('bzohor', dhuhr + 15, 0);
    }
    add('qasar', asr, 0);
    add('asar', asr, 1);
    add('maghrib', maghrib, 1);
    add('bmaghrib', maghrib + 10, 0);
    add('awwabin', maghrib + 20, 0);
    add('isyak', isha, 1);
    add('bisyak', isha + 10, 0);
    if (flags.ramadan) {
      add('tarawih', isha + 30, 0);
      add('witir', isha + 100, 0);
    } else {
      add('witir', isha + 30, 0);
    }
    // isih stabil (Array.sort stabil pada enjin moden); tambah indeks untuk pasti
    L.forEach(function (x, i) { x._i = i; });
    L.sort(function (a, b) { return a.m - b.m || a._i - b._i; });
    L.forEach(function (x) { delete x._i; x.t = hhmm(x.m); });
    return L;
  }

  // Solat "bila-bila masa"
  function freeItems(flags) {
    var f = ['mutlak', 'taubat', 'hajat', 'tasbih'];
    if (!flags.jumaat) f.push('tahiyat');
    f.push('musafir');
    return f;
  }

  var DEFAULT_BELLS = {
    tahajud: 1, qsubuh: 1, subuh: 1, dhuha: 0, dhuhaa: 1, zohor: 1, qasar: 1, asar: 1, maghrib: 1,
    awwabin: 1, isyak: 1, witir: 1, jumaat: 1, qjumaat: 1, tahiyat: 1, raya: 1, tarawih: 1
  };
  function bellOn(bells, k) {
    return bells && bells[k] !== undefined ? !!bells[k] : !!DEFAULT_BELLS[k];
  }

  /* ---------- Cari seterusnya ----------
     days: [{date, items}] hari ini dahulu; nowMin = minit sejak tengah malam hari ini.
     Pulangkan {next, nextFardu, nextSunat} dengan {item, dayOffset, delta (minit)} */
  function findNext(days, nowMin) {
    var res = { next: null, nextFardu: null, nextSunat: null };
    for (var d = 0; d < days.length; d++) {
      var items = days[d].items;
      for (var i = 0; i < items.length; i++) {
        var delta = d * DAY + items[i].m - nowMin;
        if (delta < 0) continue;
        var rec = { item: items[i], dayOffset: d, delta: delta };
        if (!res.next) res.next = rec;
        if (items[i].fardu && !res.nextFardu) res.nextFardu = rec;
        if (!items[i].fardu && !res.nextSunat) res.nextSunat = rec;
      }
      if (res.next && res.nextFardu && res.nextSunat) break;
    }
    return res;
  }

  /* ---------- Data JAKIM ---------- */
  // "08-Nov-2026" -> "2026-11-08"
  var MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  function parseJakimDate(s) {
    var m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s || '');
    if (!m || !MON[m[2]]) return null;
    return m[3] + '-' + pad2(MON[m[2]]) + '-' + pad2(+m[1]);
  }
  // Tukar respons API kepada {ymd: {fajr,...,hijri}}
  function normalizeJakim(json) {
    var out = {};
    var arr = json && json.prayerTime;
    if (!arr || !arr.length) return out;
    arr.forEach(function (r) {
      var k = parseJakimDate(r.date);
      if (!k) return;
      out[k] = {
        fajr: r.fajr, syuruk: r.syuruk, dhuha: r.dhuha, dhuhr: r.dhuhr,
        asr: r.asr, maghrib: r.maghrib, isha: r.isha, hijri: r.hijri
      };
    });
    return out;
  }
  function validDay(t) {
    return !!(t && t.fajr && t.syuruk && t.dhuha && t.dhuhr && t.asr && t.maghrib && t.isha);
  }

  /* ---------- Kiblat ---------- */
  var KAABAH = { lat: 21.4225, lng: 39.8262 };
  function qiblaBearing(lat, lng) {
    var r = Math.PI / 180;
    var dl = (KAABAH.lng - lng) * r;
    var y = Math.sin(dl) * Math.cos(KAABAH.lat * r);
    var x = Math.cos(lat * r) * Math.sin(KAABAH.lat * r) - Math.sin(lat * r) * Math.cos(KAABAH.lat * r) * Math.cos(dl);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  // beza bertanda -180..180 dari a ke b
  function angDiff(a, b) { return ((b - a + 540) % 360) - 180; }
  function compassIndex(deg) { return Math.round((((deg % 360) + 360) % 360) / 45) % 8; }

  // Zon JAKIM paling hampir. pts = [[lat,lng,nama,kodZon],...]. Pulangkan null jika >150 km daripada semua titik.
  function nearestZone(lat, lng, pts) {
    var r = Math.PI / 180, best = null, bd = 1e9;
    for (var i = 0; i < pts.length; i++) {
      var dl = (pts[i][1] - lng) * r, dp = (pts[i][0] - lat) * r;
      var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(lat * r) * Math.cos(pts[i][0] * r) * Math.sin(dl / 2) * Math.sin(dl / 2);
      var d = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (d < bd) { bd = d; best = pts[i]; }
    }
    return best && bd <= 150 ? { code: best[3], name: best[2], km: Math.round(bd) } : null;
  }

  // 'v0.4.0-12' atau '0.4.0' -> [0,4,0]
  function parseVer(s) {
    var m = /(\d+)\.(\d+)\.(\d+)/.exec(s || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function newerVer(a, b) { // a lebih baharu daripada b?
    var x = parseVer(a), y = parseVer(b);
    if (!x || !y) return false;
    for (var i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
    return false;
  }

  return {
    parseVer: parseVer, newerVer: newerVer, nearestZone: nearestZone,
    TAH_MIN: TAH_MIN, tahajudMax: tahajudMax, tahajudClamp: tahajudClamp,
    qiblaBearing: qiblaBearing, angDiff: angDiff, compassIndex: compassIndex,
    mins: mins, hhmm: hhmm, ymd: ymd, addDays: addDays, dayIndex: dayIndex,
    umalqura: umalqura, parseJakimHijri: parseJakimHijri, hijriAdjust: hijriAdjust, hijriAt: hijriAt,
    SAMBUTAN: SAMBUTAN, sambutanOf: sambutanOf, nextSambutan: nextSambutan,
    dayFlags: dayFlags, buildItems: buildItems, freeItems: freeItems,
    DEFAULT_BELLS: DEFAULT_BELLS, bellOn: bellOn, findNext: findNext,
    parseJakimDate: parseJakimDate, normalizeJakim: normalizeJakim, validDay: validDay
  };
});
