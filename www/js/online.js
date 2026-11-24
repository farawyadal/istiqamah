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
  var LASTERR = [];
  function why(e) { return String(e && e.message || e || '?').replace(/^Error: /, '').slice(0, 40); }
  function raceOsm(q) { // tanya semua pelayan serentak, guna yang pertama menjawab
    return new Promise(function (res, rej) {
      var left = MIRRORS.length, done = false, errs = [];
      var tm = setTimeout(function () { if (!done) { done = true; errs.push('timeout'); LASTERR = errs; rej(new Error('timeout')); } }, 28000);
      MIRRORS.forEach(function (m, ix) {
        fetch(m + '?data=' + encodeURIComponent(q)).then(ok).then(function (j) {
          if (j && j.remark && /runtime error|timed out/i.test(j.remark) && !(j.elements || []).length) throw new Error('server sibuk');
          if (!done) { done = true; clearTimeout(tm); res(j); }
        }).catch(function (e) { errs[ix] = why(e); if (--left === 0 && !done) { done = true; clearTimeout(tm); LASTERR = errs; rej(e); } });
      });
    });
  }
  function mapOver(j) {
    return (j.elements || []).map(function (e) {
      var t = e.tags || {}, la = e.lat != null ? e.lat : e.center && e.center.lat, ln = e.lon != null ? e.lon : e.center && e.center.lon;
      var n = t.name || t['name:ms'] || t['name:en'] || '';
      return la == null || !n ? null : { id: 'o' + e.type[0] + e.id, n: n, t: kind(n), lat: la, lng: ln, ver: false };
    }).filter(Boolean);
  }
  function kind(n) { return /pusat\s+islam|musolla|musalla|mussalla/i.test(n) ? 'pusat' : /surau|suraya/i.test(n) ? 'surau' : 'masjid'; }
  /* Pelan sandaran bila Overpass lambat: carian Nominatim (OpenStreetMap) dalam kotak sekitar lokasi */
  function nomi(lat, lng, rad) {
    var d = rad / 111000, dl = d / Math.max(0.2, Math.cos(lat * Math.PI / 180));
    var vb = [lng - dl, lat + d, lng + dl, lat - d].join(',');
    var seen = {}, out = [];
    function one(term) {
      return fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&viewbox=' + vb + '&q=' + encodeURIComponent(term)).then(ok).then(function (a) {
        (a || []).forEach(function (r) {
          if (r.type !== 'place_of_worship' || !r.name || seen[r.osm_id]) return; seen[r.osm_id] = 1;
          out.push({ id: 'n' + r.osm_type[0] + r.osm_id, n: r.name, t: kind(r.name), lat: +r.lat, lng: +r.lon, ver: false });
        });
      }).catch(function () { /* abaikan */ });
    }
    return one('masjid').then(function () { return one('surau'); }).then(function () { return one('pusat islam'); }).then(function () { if (!out.length) throw new Error('nominatim kosong'); return out; });
  }
  function osm(lat, lng, rad) {
    var q = '[out:json][timeout:25];(nwr["amenity"="place_of_worship"]["religion"="muslim"](around:' + rad + ',' + lat + ',' + lng + '););out center tags 150;';
    return new Promise(function (res, rej) {
      var done = false, ovFail = false, noFail = false, started = false, ft;
      function ok1(r) { if (!done) { done = true; clearTimeout(ft); res(r); } }
      function startNomi() { if (started || done) return; started = true; nomi(lat, lng, Math.min(rad, 8000)).then(function (r) { if (r.length) ok1(r); else throw new Error('x'); }).catch(function () { noFail = true; if (ovFail && !done) { done = true; rej(new Error('semua gagal')); } }); }
      ft = setTimeout(startNomi, 7000); // sandaran dimulakan jika Overpass belum menjawab dalam 7 saat
      raceOsm(q).then(function (j) { ok1(mapOver(j)); }).catch(function () { ovFail = true; startNomi(); if (noFail && !done) { done = true; rej(new Error('semua gagal')); } });
    });
  }
  function km(a, b, c, d) {
    var R = 6371, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  window.ISTI_NET = { add: add, query: query, osm: osm, km: km, why: function () { return LASTERR.filter(Boolean).join(', '); } };
})();
