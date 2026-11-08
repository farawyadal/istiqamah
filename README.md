# Istiqamah

Waktu solat fardu dan sunat harian ikut zon JAKIM. Android dahulu (Capacitor), iPhone kemudian.

Developed by FaridAssamani

## Struktur
- `www/` – UI web (HTML/CSS/JS tanpa framework). `www/js/logic.js` ialah logik tulen yang diuji.
- `android/` – projek Android (Capacitor 7).
- `.github/workflows/android.yml` – bina APK secara automatik bila push ke `main`, dan terbitkan di Releases.

## Bangun
```
npm ci
npm test
npx cap sync android
```
Buka `www/index.html` melalui pelayan statik untuk uji dalam pelayar. Parameter ujian: `?now=2026-11-13T12:40&male=1&lang=en`.
