// Namespace `loading` (Grafik-UI): loading screen (DESIGN §6.15). `tips.*` rotate every 7 s; the loading
// store's `tipKey` picks the first one. Tips: calm sentence case, second person singular, ≤ 140 characters.

const tr = {
  heading: 'Yükleniyor',
  tip: 'İpucu',
  stage: 'Yükleniyor · {p}',
  mode: { race: 'hızlı yarış', timeTrial: 'zamana karşı' },
  tips: {
    gears: 'E ve Q ile vites büyütüp küçültebilirsin.',
    camera: 'C tuşu kamerayı değiştirir.',
    pause: 'Esc ya da P ile oyunu duraklatabilirsin.',
    drs: 'DRS bölgesinde rakibine bir saniyeden yakınsan boşluk tuşu arka kanadı açar.',
    ers: 'ERS modunu Tab ile açılan ekrandan seçebilirsin; sollamada F tuşu ek güç verir.',
    flashback: 'Bir hata mı yaptın? R tuşu son saniyeleri geri sarar.',
    mfd: 'Tab tuşu strateji, ERS, fren, hava ve lastik sayfaları arasında gezinir.',
    limits: 'Dört tekerleğin de beyaz çizginin dışına çıkarsa tur geçersiz sayılır.',
    tyres: 'Yumuşak lastik hızlıdır ama çabuk aşınır; sert lastik uzun dayanır.',
    brake: 'Viraja girmeden önce düz giderken fren yap, sonra direksiyonu çevir.',
    rain: 'Pist ıslanırsa ara lastiğe geç; yağmur lastiği yalnızca çok ıslak pistte hızlıdır.',
    hud: 'H tuşu HUD görünümünü tam, sade ve kapalı arasında değiştirir.',
    line: 'Y tuşu yarış çizgisini kapalı, virajlar ve tam arasında değiştirir.',
    pitLimiter: 'Pit yolunda hız sınırı 80 km/sa; sınırlayıcıyı L ile açmayı unutma.',
  },
};

export default tr;
