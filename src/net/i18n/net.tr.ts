// Namespace `net` (YÖN): online status strings for the online / lobby screens (D-050). Pre-composed uppercase titles (D-003).
// `{until}` is a formatted date/time (the UI formats NetLobbyModel.kicked.until); server text (notice) is shown as-is.

const tr = {
  notice: { title: 'SUNUCU DUYURUSU' },
  /** D-058: shown instead of the team-traits bars online. */
  equalCars: 'Online: eşit araçlar',
  kicked: { title: 'ODADAN ÇIKARILDIN', detail: 'Sunucu yöneticisi seni oyundan çıkardı.' },
  banned: { title: 'ERİŞİMİN ENGELLENDİ', detail: 'Bu sunucuya şu an bağlanamazsın.', until: '{until} tarihine kadar engellisin.' },
  maintenance: { title: 'BAKIM ÇALIŞMASI', detail: 'Şu an yeni oda kurulamıyor ve odalara katılınamıyor. Biraz sonra tekrar dene.' },
};

export default tr;
