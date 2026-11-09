/* Katalog zikir harian. n = transliterasi, ar = Arab, t = sasaran lalai, m/s = [BM, EN] maksud/sumber. */
(function () {
  var CAT = [
    { id: 'lailaha', n: 'Lailahaillallah', ar: 'لَا إِلَٰهَ إِلَّا ٱللَّهُ', t: 100,
      m: ['Tiada tuhan yang disembah melainkan Allah', 'There is no god but Allah'], s: ['Zikir paling utama', 'The most virtuous dhikr'] },
    { id: 'istighfar', n: 'Astaghfirullah', ar: 'أَسْتَغْفِرُ ٱللَّهَ', t: 100,
      m: ['Aku memohon ampun kepada Allah', 'I seek forgiveness from Allah'],
      s: ['Rasulullah beristighfar sekurang-kurangnya 70 hingga 100 kali sehari (al-Bukhari, Muslim)', 'The Prophet sought forgiveness 70 to 100 times a day (al-Bukhari, Muslim)'] },
    { id: 'selawat', n: 'Selawat', ar: 'ٱللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ', t: 100,
      m: ['Ya Allah, limpahkan selawat ke atas Muhammad', 'O Allah, send blessings upon Muhammad'], s: ['Perbanyakkan terutama hari Jumaat', 'Recite abundantly, especially on Fridays'] },
    { id: 'bihamdihi', n: 'Subhanallahi wa bihamdihi', ar: 'سُبْحَانَ ٱللَّهِ وَبِحَمْدِهِ', t: 100,
      m: ['Maha Suci Allah dan dengan memuji-Nya', 'Glory be to Allah and praise Him'],
      s: ['Dosa diampun walau sebanyak buih lautan (al-Bukhari, Muslim)', 'Sins are forgiven even if like the foam of the sea (al-Bukhari, Muslim)'] },
    { id: 'azim', n: 'Subhanallahi wa bihamdihi, Subhanallahil Azim', ar: 'سُبْحَانَ ٱللَّهِ وَبِحَمْدِهِ سُبْحَانَ ٱللَّهِ ٱلْعَظِيمِ', t: 100,
      m: ['Maha Suci Allah dan dengan memuji-Nya, Maha Suci Allah Yang Maha Agung', 'Glory be to Allah and praise Him, glory be to Allah the Magnificent'],
      s: ['Ringan di lidah, berat di timbangan, disukai Ar-Rahman (al-Bukhari, Muslim)', 'Light on the tongue, heavy on the scale, beloved to Ar-Rahman (al-Bukhari, Muslim)'] },
    { id: 'hawqala', n: 'La hawla wala quwwata illa billah', ar: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِٱللَّهِ', t: 100,
      m: ['Tiada daya dan tiada kekuatan melainkan dengan Allah', 'There is no power and no strength except with Allah'], s: ['Perbendaharaan syurga (al-Bukhari, Muslim)', 'A treasure of Paradise (al-Bukhari, Muslim)'] },
    { id: 'wahdahu', n: 'La ilaha illallahu wahdahu...', ar: 'لَا إِلَٰهَ إِلَّا ٱللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ ٱلْمُلْكُ وَلَهُ ٱلْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ', t: 100,
      m: ['Tiada tuhan melainkan Allah yang Esa, tiada sekutu bagi-Nya. Milik-Nya kerajaan dan segala puji, dan Dia Maha Berkuasa atas segalanya', 'There is no god but Allah alone, with no partner. His is the dominion and all praise, and He has power over all things'],
      s: ['Sekali sehari, 100 kali (al-Bukhari, Muslim)', 'Once a day, 100 times (al-Bukhari, Muslim)'] },
    { id: 'baqiyat', n: 'Subhanallah wal hamdulillah...', ar: 'سُبْحَانَ ٱللَّهِ وَٱلْحَمْدُ لِلَّهِ وَلَا إِلَٰهَ إِلَّا ٱللَّهُ وَٱللَّهُ أَكْبَرُ', t: 100,
      m: ['Maha Suci Allah, segala puji bagi Allah, tiada tuhan melainkan Allah, Allah Maha Besar', 'Glory be to Allah, praise be to Allah, there is no god but Allah, Allah is the Greatest'], s: ['Zikir harian yang kekal (Baqiyatus Salihat)', 'A lasting daily dhikr (al-Baqiyat as-Salihat)'] },
    { id: 'hasbunallah', n: 'Hasbunallah wa ni’mal wakil', ar: 'حَسْبُنَا ٱللَّهُ وَنِعْمَ ٱلْوَكِيلُ', t: 33,
      m: ['Cukuplah Allah bagi kami, dan Dia sebaik-baik pelindung', 'Allah is sufficient for us, and He is the best disposer of affairs'], s: ['Ali Imran: 173', 'Ali Imran: 173'] },
    { id: 'hayyu', n: 'Ya Hayyu Ya Qayyum', ar: 'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ', t: 33,
      m: ['Wahai Yang Maha Hidup, wahai Yang Maha Berdiri Sendiri, dengan rahmat-Mu aku memohon pertolongan', 'O Ever-Living, O Self-Sustaining, in Your mercy I seek help'], s: ['Doa ketika susah hati (at-Tirmizi)', 'A supplication in times of distress (at-Tirmidhi)'] },
    { id: 'yunus', n: 'Doa Nabi Yunus', ar: 'لَا إِلَٰهَ إِلَّا أَنتَ سُبْحَانَكَ إِنِّي كُنتُ مِنَ ٱلظَّالِمِينَ', t: 33,
      m: ['Tiada tuhan melainkan Engkau, Maha Suci Engkau, sesungguhnya aku termasuk orang yang zalim', 'There is no god but You, glory be to You, indeed I was among the wrongdoers'], s: ['Al-Anbiya: 87', 'Al-Anbiya: 87'] }
  ];
  window.ISTI_ZIKIR = { cat: CAT };
  if (typeof module !== 'undefined') module.exports = window.ISTI_ZIKIR;
})();
