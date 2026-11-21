// Namespace `common` (YÖN): key labels, units, sandbox index, debug overlay. Keys: `common.<path>`.

const tr = {
  keys: {
    Space: 'Boşluk',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
    Escape: 'Esc',
    Backspace: 'Geri Sil',
    Tab: 'Tab',
    ShiftLeft: 'Sol Shift',
    ShiftRight: 'Sağ Shift',
    CapsLock: 'Caps Lock',
    Delete: 'Del',
    Insert: 'Ins',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
  },
  units: {
    kmh: 'km/sa',
    mph: 'mph',
  },
  sandbox: {
    title: 'Sandbox sahneleri',
    unknown: '"{id}" adlı sahne bulunamadı.',
    hint: 'Bir sahne açmak için adresin sonuna ?scene=<id> ekle.',
  },
  raceLogic: {
    header: '{phase} · yarış {time} · ışık {lit}{out} · sarı {yellow} · DRS {drs}',
    on: 'açık',
    off: 'kapalı',
    out: ' (söndü)',
    cols: 'S|No|Kod|Tur|Fark|Son|En iyi|Ceza|PS|Durum|Bayrak|Pit|Duruş',
    events: 'Olaylar',
  },
  weatherScene: {
    header: 'Hava {preset} · tohum {seed} · {laps} tur ({min} dk) · hava {air} °C · pist {track} °C',
    legend: 'yağmur|bulut|ıslaklık|yarış çizgisi|tahmin +10 dk (yağmur)',
    time: '{min} dk',
  },
  debug: {
    fps: 'FPS {fps} · p95 {p95} ms',
    sim: 'Tik {tick} · aşım {overrun}',
    car: '{kmh} km/sa · vites {gear} · s {s} m',
  },
};

export default tr;
