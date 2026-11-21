// Namespace `notify` (YÖN, HudPresenter; ui-hud §3.2). Keys: `notify.<group>.<name>.{title,detail?,chip?}`.
// Params formatted by the UI (src/ui/format.ts formatParams): `time` lap time, `delta` delta, `gap` gap, `p` percent;
// strings pass through (`reason`, `compound`, `mode` arrive already translated from `notify.reason|compound|lineMode`).
// Pre-composed uppercase strings (D-003).

const tr = {
  start: {
    jumpStart: { title: 'ERKEN KALKIŞ', chip: '+{s} SN' },
  },
  limits: {
    warning: { title: 'PİST SINIRLARI {n}/3', detail: 'T{corner}' },
    blackWhite: { title: 'SİYAH-BEYAZ BAYRAK', detail: 'BİR SONRAKİ İHLAL CEZA' },
  },
  penalty: {
    trackLimits: { title: 'CEZA · PİST SINIRLARI', chip: '+{s} SN' },
    cornerCut: { title: 'CEZA · VİRAJ KESME', chip: '+{s} SN' },
    pitSpeeding: { title: 'CEZA · PİTTE HIZ İHLALİ', chip: '+{s} SN' },
    twoCompound: { title: 'CEZA · İKİ HAMUR KURALI', chip: '+{s} SN' },
    collision: { title: 'CEZA · ÇARPIŞMAYA SEBEP OLMAK', chip: '+{s} SN' },
    safetyCar: { title: 'CEZA · GÜVENLİK ARACI ALTINDA SOLLAMA', chip: '+{s} SN' },
    served: { title: 'CEZA ÇEKİLDİ', detail: '{s} SN' },
    pending: { title: 'PİTTE ÇEKİLECEK CEZA', detail: '{s} SN' },
  },
  lap: {
    invalid: { title: 'GEÇERSİZ TUR', detail: '{reason}' },
    personalBest: { title: 'KİŞİSEL EN İYİ', detail: '{time} · {delta}' },
    fastest: { title: 'EN HIZLI TUR', detail: '{code} · {time}' },
    final: { title: 'SON TUR' },
  },
  flag: {
    yellow: { title: 'SARI BAYRAK', detail: 'SEKTÖR {sector}' },
    blue: { title: 'MAVİ BAYRAK', detail: 'ARKADAN GELEN: {code}' },
    chequered: { title: 'DAMALI BAYRAK' },
  },
  drs: {
    enabled: { title: 'DRS ETKİN' },
    disabled: { title: 'DRS DEVRE DIŞI' },
  },
  weather: {
    rainSoon: { title: 'YAĞMUR {min} DK İÇİNDE', detail: '%{p} OLASILIK' },
    rainStarted: { title: 'YAĞMUR BAŞLADI' },
    drying: { title: 'PİST KURUYOR' },
    intersNow: { title: 'PİTE GİR', detail: 'ARA LASTİK' },
    wetsNow: { title: 'PİTE GİR', detail: 'YAĞMUR LASTİĞİ' },
    slicksNow: { title: 'PİTE GİR', detail: 'KURU LASTİK' },
  },
  pit: {
    requested: { title: 'PİT TALEBİ', detail: '{compound}' },
    cancelled: { title: 'PİT TALEBİ İPTAL' },
    limiter: { title: 'PİT LİMİTÖRÜ' },
    stopTime: { title: 'PİT DURUŞU', detail: '{s} SN' },
  },
  car: {
    reset: { title: 'ARAÇ PİSTE ALINDI' },
  },
  // D-056
  collision: {
    warning: { title: 'UYARI · ÇARPIŞMA', detail: 'BİR SONRAKİ ÇARPIŞMA CEZA' },
  },
  sc: {
    deployed: { title: 'GÜVENLİK ARACI PİSTTE', detail: 'SIRANI KORU · SOLLAMA YOK' },
    ending: { title: 'GÜVENLİK ARACI BU TUR PİTE GİRİYOR', detail: 'HAZIRLAN' },
    restart: { title: 'YEŞİL BAYRAK', detail: 'YARIŞ YENİDEN BAŞLADI' },
  },
  // D-050: admin notice (server text, shown as-is).
  net: {
    notice: { title: 'SUNUCU DUYURUSU', detail: '{text}' },
  },
  // D-064: host-in-browser rooms.
  p2p: {
    hostPaused: { title: 'ODA SAHİBİ BEKLEMEDE', detail: 'SEKMESİ ARKA PLANDA · ARACI DURABİLİR' },
    hostResumed: { title: 'ODA SAHİBİ GERİ DÖNDÜ' },
    hostWasHidden: { title: 'SEKME ARKA PLANDAYDI', detail: 'ODA SAHİBİYKEN SEKMEYİ ÖN PLANDA TUT' },
  },
  quality: {
    lowered: { title: 'GRAFİK DÜŞÜRÜLDÜ', detail: 'DÜŞÜK KARE HIZI · {q}' },
  },
  flashback: {
    used: { title: 'GERİ SARILDI', detail: 'KALAN {left}' },
    none: { title: 'GERİ SARMA HAKKI YOK' },
  },
  racingLine: {
    mode: { title: 'YARIŞ ÇİZGİSİ: {mode}' },
  },
  settings: {
    modifierRefused: { title: 'CTRL, ALT VE META ATANAMAZ' },
  },
  error: {
    runtime: { title: 'BİR HATA OLUŞTU', detail: 'OYUN DEVAM EDİYOR' },
  },
  /** Param values (translated by the presenter before the banner is emitted). */
  reason: {
    trackLimits: 'PİST SINIRLARI',
    cornerCut: 'VİRAJ KESME',
    flashback: 'GERİ SARMA',
    reset: 'ARAÇ PİSTE ALINDI',
    wrongWay: 'YANLIŞ YÖN',
  },
  compound: {
    soft: 'YUMUŞAK',
    medium: 'ORTA',
    hard: 'SERT',
    inter: 'ARA',
    wet: 'YAĞMUR',
  },
  lineMode: {
    off: 'KAPALI',
    corners: 'VİRAJLAR',
    full: 'TAM',
  },
};

export default tr;
