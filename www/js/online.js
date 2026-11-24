/* Sambungan dalam talian: Firestore (REST) dan OpenStreetMap. Tiada data peribadi dihantar. */
(function () {
  var P = 'istiqamah-8b89c', K = 'AIzaSyBzYCNcNIB2BZnbOXh3rPygIz0_wU3fYLc';
  var B = 'https://firestore.googleapis.com/v1/projects/' + P + '/databases/(default)/documents';
  function fv(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    return { stringValue: String(v) };
  }
  function uv(f) {
    if ('stringValue' in f) return f.stringValue;
    if ('integerValue' in f) return +f.integerValue;
    if ('doubleValue' in f) return f.doubleValue;
    if ('booleanValue' in f) return f.booleanValue;
    return null;
  }
  function row(d) { var o = { id: d.name.split('/').pop() }; for (var k in (d.fields || {})) o[k] = uv(d.fields[k]); return o; }
  function ok(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  var H = { 'Content-Type': 'application/json' };

  function add(col, obj) {
    var f = {}; for (var k in obj) f[k] = fv(obj[k]);
    return fetch(B + '/' + col + '?key=' + K, { method: 'POST', headers: H, body: JSON.stringify({ fields: f }) }).then(ok);
  }
  function query(col, field, val, limit) {
    var sq = { from: [{ collectionId: col }], limit: limit || 500 };
    if (field) sq.where = { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: fv(val) } };
    return fetch(B + ':runQuery?key=' + K, { method: 'POST', headers: H, body: JSON.stringify({ structuredQuery: sq }) }).then(ok)
      .then(function (a) { return a.filter(function (x) { return x.document; }).map(function (x) { return row(x.document); }); });
  }
  var MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  function raceOsm(q) { // tanya semua pelayan serentak, guna yang pertama menjawab; henti selepas 12 saat
    return new Promise(function (res, rej) {
      var left = MIRRORS.length, done = false;
      var tm = setTimeout(function () { if (!done) { done = true; rej(new Error('timeout')); } }, 12000);
      MIRRORS.forEach(function (m) {
        fetch(m + '?data=' + encodeURIComponent(q)).then(ok).then(function (j) {
          if (!done) { done = true; clearTimeout(tm); res(j); }
        }).catch(function (e) { if (--left === 0 && !done) { done = true; clearTimeout(tm); rej(e); } });
      });
    });
  }
  function osm(lat, lng, rad) {
    var q = '[out:json][timeout:10];(nwr["amenity"="place_of_worship"]["religion"="muslim"](around:' + rad + ',' + lat + ',' + lng + '););out center tags 150;';
    return raceOsm(q).then(function (j) {
      return (j.elements || []).map(function (e) {
        var t = e.tags || {}, la = e.lat != null ? e.lat : e.center && e.center.lat, ln = e.lon != null ? e.lon : e.center && e.center.lon;
        var n = t.name || t['name:ms'] || t['name:en'] || '';
        return la == null || !n ? null : { id: 'o' + e.type[0] + e.id, n: n, t: /pusat\s+islam|musolla|musalla|mussalla/i.test(n) ? 'pusat' : /surau|suraya/i.test(n) ? 'surau' : 'masjid', lat: la, lng: ln, ver: false };
      }).filter(Boolean);
    });
  }
  function km(a, b, c, d) {
    var R = 6371, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  window.ISTI_NET = { add: add, query: query, osm: osm, km: km };
})();
