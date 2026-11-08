const assert = require('assert');
const L = require('../www/js/logic.js');

const t = { fajr: '05:55:00', syuruk: '07:04:00', dhuha: '07:29:00', dhuhr: '13:05:00', asr: '16:25:00', maghrib: '19:01:00', isha: '20:12:00' };
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('mins/hhmm', () => { assert.strictEqual(L.mins('13:05:00'), 785); assert.strictEqual(L.hhmm(785), '13:05'); assert.strictEqual(L.hhmm(-10), '23:50'); });

ok('hari biasa', () => {
  const it = L.buildItems(t, { jumaat: false, raya: false, ramadan: false });
  const keys = it.map(x => x.k);
  assert.deepStrictEqual(keys, ['tahajud','qsubuh','subuh','isyraq','dhuha','qzohor','zohor','bzohor','qasar','asar','maghrib','bmaghrib','awwabin','isyak','bisyak','witir']);
  assert.strictEqual(it.filter(x => x.fardu).length, 5);
  assert.strictEqual(it.find(x => x.k === 'subuh').t, '05:55');
  assert.strictEqual(it.find(x => x.k === 'isyraq').t, '07:19');
  assert.strictEqual(it.find(x => x.k === 'tahajud').t, '02:17');
  assert.ok(keys.indexOf('qsubuh') < keys.indexOf('subuh'));
});

ok('jumaat lelaki', () => {
  const it = L.buildItems(t, { jumaat: true, raya: false, ramadan: false });
  const keys = it.map(x => x.k);
  assert.ok(keys.includes('jumaat') && !keys.includes('zohor') && keys.includes('tahiyat') && keys.includes('qjumaat') && keys.includes('bjumaat'));
  assert.ok(it.find(x => x.k === 'jumaat').fardu);
});

ok('raya & ramadan', () => {
  assert.ok(L.buildItems(t, { raya: true }).some(x => x.k === 'raya'));
  const r = L.buildItems(t, { ramadan: true }).map(x => x.k);
  assert.ok(r.indexOf('tarawih') < r.indexOf('witir'));
  assert.ok(r.includes('tarawih'));
});

ok('dayFlags', () => {
  // Jumaat 13 Nov 2026
  assert.deepStrictEqual(L.dayFlags(new Date(2026, 10, 13), { m: 5, d: 3 }, true).jumaat, true);
  assert.deepStrictEqual(L.dayFlags(new Date(2026, 10, 13), { m: 5, d: 3 }, false).jumaat, false);
  assert.ok(L.dayFlags(new Date(2027, 2, 9), { m: 10, d: 1 }, true).raya);
  assert.ok(L.dayFlags(new Date(2027, 1, 19), { m: 9, d: 12 }, true).ramadan);
});

ok('hijri umalqura & laras JAKIM', () => {
  const d = new Date(2026, 10, 8);
  const h = L.umalqura(d);
  assert.strictEqual(h.m, 5);
  const jk = L.parseJakimHijri('1448-05-28');
  const adj = L.hijriAdjust(d, jk);
  assert.ok(adj === 0 || adj === 1);
  const h2 = L.hijriAt(d, adj);
  assert.strictEqual(h2.d, 28);
});

ok('sambutan', () => {
  // Aidilfitri 1448 ~ 9 Mac 2027
  const s = L.nextSambutan(new Date(2027, 2, 5), 0, 7);
  assert.ok(s && s.key === 'aidilfitri', JSON.stringify(s));
  assert.strictEqual(L.nextSambutan(new Date(2026, 10, 8), 0, 7), null);
});

ok('findNext lintas hari', () => {
  const flags = { jumaat: false, raya: false, ramadan: false };
  const days = [{ items: L.buildItems(t, flags) }, { items: L.buildItems(t, flags) }];
  const now = L.mins('21:30');
  const r = L.findNext(days, now);
  assert.strictEqual(r.next.dayOffset, 1);
  assert.strictEqual(r.next.item.k, 'tahajud');
  assert.strictEqual(r.nextFardu.item.k, 'subuh');
  const mid = L.findNext(days, L.mins('16:05'));
  assert.strictEqual(mid.next.item.k, 'qasar');
  assert.strictEqual(mid.nextFardu.item.k, 'asar');
});

ok('parse JAKIM', () => {
  assert.strictEqual(L.parseJakimDate('08-Nov-2026'), '2026-11-08');
  const o = L.normalizeJakim({ prayerTime: [{ hijri: '1448-05-28', date: '08-Nov-2026', fajr: '05:55:00', syuruk: '07:04:00', dhuha: '07:29:00', dhuhr: '13:05:00', asr: '16:25:00', maghrib: '19:01:00', isha: '20:12:00' }] });
  assert.ok(L.validDay(o['2026-11-08']));
});

ok('bellOn', () => { assert.ok(L.bellOn({}, 'subuh')); assert.ok(!L.bellOn({}, 'isyraq')); assert.ok(!L.bellOn({ subuh: 0 }, 'subuh')); });

ok('kiblat', () => {
  const pen = L.qiblaBearing(5.4164, 100.3327); // Pulau Pinang ~292
  assert.ok(Math.abs(pen - 292) < 1.5, String(pen));
  const kl = L.qiblaBearing(3.139, 101.6869); // KL ~292.6
  assert.ok(Math.abs(kl - 292.6) < 1.5, String(kl));
  assert.strictEqual(L.compassIndex(292), 6);
  assert.strictEqual(L.compassIndex(359), 0);
  assert.strictEqual(L.angDiff(350, 10), 20);
  assert.strictEqual(L.angDiff(10, 350), -20);
});

console.log(n + ' ujian lulus');
