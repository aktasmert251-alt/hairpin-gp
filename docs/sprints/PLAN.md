# APEX GP — F1 25 esinli tarayıcı yarış oyunu: ekip ve uygulama planı

## Bağlam

F1 25'i referans alan, klavyeyle oynanan ve tarayıcı oyunu ölçüsünde yüksek grafikli bir Formula yarış oyunu sıfırdan yapılacak. İşi 7 rollü bir alt ajan ekibi üstlenecek. Ben (ana oturum) orkestratörüm: ajanları başlatır, işi dağıtır, teslimleri birleştirir, kalite kapılarını işletir, her sprint sonunda commit alıp sana kısa durum raporu veririm. Skill kullanımı bana bırakıldı. Sonradan eklediğin OpenDesign ve motion design skill'leri de plana dahil edildi (bkz. "Skill kullanımı").

**Senin kararların**
- **Pist:** İstanbul Park esinli, oyundaki adı "İstanbul Circuit". Saat yönünün tersine, yaklaşık 5,35 km, 14 viraj, 4 apeksli T8 ve gerçek yükseklik profili.
- **Çekirdek özellikler:** Zamana Karşı (ghost, mor/yeşil/sarı sektörler), 20 araçlı Hızlı Yarış, F1 25 tarzı HUD, 5 kamera, sürüş yardımları ve flashback.
- **Ek özellikler:**
  - Gün batımı ve projektörlü gece yarışı.
  - Yağmur ve ıslak pist: ara ve yağmur lastikleri, değişken hava.
  - Pit stop ve lastik stratejisi.
- **Konum:** `<repo>` (OneDrive dışında).
- **Git:** winget ile kurulacak; depo yalnızca yerel kalacak.

**Ortam:** Windows 11, PowerShell 5.1, Node 24.15 / npm 11.12, Python 3.14, Chrome ve Edge. Donanım: RTX 4060 Laptop (1080p, 144 Hz), Ryzen 7 7435HS, 16 GB RAM.

**Fikri mülkiyet:** Oyunda "F1" / "Formula 1" ifadeleri, gerçek takım ya da pilot adları ve logolar kullanılmaz. Onların yerine:
- 10 kurgusal takım; biri Türk takımı Anka Racing.
- Kurgusal sponsorlar (Lale Çay, Simit Express, Kervan Bank…).
- Kurgusal lastik markası "ORBIS".
- Çalışma adı "APEX GP".

**Planlayıcının ayrıntılı raporu:** Mimari, sözleşmeler, fizik, yapay zekâ ve pist bölümlerini (§2–§7) içeriyor. Şu dosyada duruyor: `<home>\.claude\projects\c--\4fa308c0-ff1b-47c0-8db6-a701a9178a64\tool-results\toolu_014ZBtbrp2Utr4yvu3cmrMRZ.json`. Sprint 0'da projeye `docs/design/planner-report.md` olarak kopyalanır. Raporun §8–§16 kısmı kesildi; bu bölümlerin özü aşağıdaki eklerde, ayrıntısını Sprint 0'da Planlayıcı yazacak.

---

## Ekip ve yönetim modeli

| Rol | Sorumluluk | Yazma alanı |
|---|---|---|
| **Orkestratör (ben)** | Ajanları başlatma, sprint kapıları, entegrasyon doğrulaması, commit, skill'ler, sana rapor | `.claude/agents/`, `docs/sprints/`, `docs/design/skills/`, git |
| **Planlayıcı** | GDD, mimari ve tasarım dokümanları, sprint ve düzeltme planları | `docs/` (`docs/design/DESIGN*` hariç) |
| **Yönetici** (teknik lider / entegratör) | İskelet, çekirdek motor, `src/contracts`, oyun akışı, yarış direktörü, pit prosedürü, hava ve koşullar, flashback, ghost, replay kaydı, HUD sunucusu, entegrasyon, build | `src/{main.ts,contracts,core,game,race,data,sandbox}`, `scripts/shot.mjs`, kök config |
| **Çevre Dizaynlayıcı** | Pist verisi ve geometrisi, `TrackQuery`, yüzeyler, arazi ve çevre, gökyüzü ve gün saati ışıkları, gece projektörleri, ıslak pist görünümü | `src/track/**`, `scripts/fetch-track.mjs`, `public/assets/env/` |
| **Grafik Dizaynlayıcı** | Tasarım sözleşmesi (DESIGN.md), render ve post-process, kalite önayarları, araç, livery, LOD, VFX, kameralar, HUD ve menüler, hareket dili, tanıtım fragmanı | `src/graphics/**`, `src/ui/**`, `src/trailer/**`, `docs/design/{DESIGN,design-contract,implementation-handoff}.md`, `scripts/render-trailer.mjs`, `scripts/trailer-audio.mjs`, `public/assets/gra/`, `media/` |
| **Sürüş Motoru Mühendisi** | Araç dinamiği, lastik, aero, güç ünitesi/ERS/DRS, vites, yardımlar, klavye filtresi, çarpışma, yapay zekâ pilotlar, motor ve çevre sesleri | `src/physics/**`, `src/ai/**`, `src/audio/**`, `public/assets/sur/` |
| **Kalite Kontrolcü** | Kod ve mimari, performans, görsel (F1 25 kontrol listesi), UI, sürüş hissi; fragmanda hareket ve tasarım eleştirmenliği | `docs/qa/qc-*.md` (`src`'ye yazmaz) |
| **Testçi** | Vitest ve Playwright altyapısı; sim, entegrasyon, E2E, performans ve sızıntı testleri; ekran görüntüsü galerisi | `tests/**`, `vitest.config.ts`, `playwright.config.ts` (Sprint 1'den sonra), `docs/qa/test-*.md` |

- Bütün ajanlar general-purpose tipinde, arka planda ve paralel çalışır; modeli ana oturumdan alır.
- Sprint 2'den sonra Grafik Dizaynlayıcı iki paralel örnek olarak çalışır: **Grafik-3B** (`src/graphics`, `src/trailer`) ve **Grafik-UI** (`src/ui`).
- Proje içindeki `.claude/agents/` klasörüne rol tanımları yazılır; sonraki oturumlarda ekip bu adlarla çağrılabilir.

**Her ajan istemine eklenecek ortak kurallar**
1. **Yazma alanı:** Ajan yalnızca kendi alanına yazar. `src/contracts/` dosyalarını yalnızca Yönetici değiştirir. Diğer ajanlar sözleşme değişikliği isterse bunu raporuna yazar; sprint aralarında ben toplayıp Yönetici'ye uygulatırım.
2. **Kurulum ve git:** `npm install` çalıştırılmaz; bağımlılık talebi rapora yazılır. Git komutu da kullanılmaz; commit'leri ben alırım.
3. **Portlar ve süreçler:** Her ajanın kendi dev portu vardır: YÖN 5173, ÇEV 5174, GRA-3B 5175, SÜR 5176, TEST 5177, QC 5178, GRA-UI 5179. Ajan yalnızca kendi başlattığı süreçleri durdurur; node süreçlerini toplu öldürmek yasaktır.
4. **Görsel doğrulama:** Her modülün bir sandbox sahnesi (`?scene=...`) olur. Ajan işini `node scripts/shot.mjs` ile ekran görüntüsü alıp Read ile bakarak kendisi doğrular.
5. **Testler:** Modül birim testleri `src/<modül>/__tests__/` altında olur ve modül sahibi yazar. Modüller arası testler ve E2E testleri `tests/` altında olur ve Testçi yazar. Typecheck hatalarını her ajan yalnızca kendi dizininde düzeltir.
6. **Final rapor:** Tek mesaj ve en fazla 8 KB olur. İçeriği: yapılanlar, dosyalar, çalıştırılan komutlar ve sonuçları, ekran görüntüsü yolları, sözleşme talepleri, bilinen sorunlar. Daha uzun ayrıntılar `docs/` altına dosya olarak yazılır. Bu kural, Planlayıcı raporunun kesilmesinden çıkan derstir.
7. **Kod kuralları:** TypeScript strict modda yazılır. Sim katmanı three.js ya da DOM import etmez. Hiçbir kısayol Ctrl, Alt veya Meta tuşunu kullanmaz, çünkü Ctrl+W ile sekmenin kapanması engellenemez.
8. **Skill'ler:** Ajan, isteminde adı geçen skill'leri Skill aracıyla yükler. Yükleyemezse bunu raporlar; o skill'i ben yükleyip özünü `docs/design/skills/<skill>.md` dosyasına yazarım ve ajana bu dosyayı veririm.

---

## Teknik kararlar (özet)

**Sabitlenmiş yığın**

| Paket | Sürüm | Not |
|---|---|---|
| `three` | 0.186.1 | postprocessing'in peer aralığı `<0.187` |
| `@types/three` | 0.186.0 | |
| `postprocessing` | 6.39.5 | |
| `n8ao` | 2.0.1 | |
| `gsap` | 3.15.0 | Standard "no charge" lisansı; UI animasyonları ve fragman zaman çizelgesi |
| `vite` | 8.3.2 | |
| `typescript` | 6.0.3 | 7.x native port yerine; araç uyumluluğu için |
| `vitest` | 5.0.3 | |
| `@playwright/test` | 1.63.0 | Sistemdeki Chrome kullanılır (`channel: 'chrome'`), tarayıcı indirilmez |
| `lil-gui` | 0.21.0 | Yalnızca sandbox |
| `@types/node` | 24 | |
| `ffmpeg-static` | 5.3.0 | devDependency; yalnızca fragman encode için; GPL araç, oyunla dağıtılmaz |

**Üst dizin sızıntısı:** `<home>\node_modules` var ve paketler oradan çözülebilir. Önlemler:
- tsconfig'de `typeRoots: ["./node_modules/@types"]` ve açık bir `types` listesi.
- Vite'ta `resolve.dedupe: ['three']`.
- Bağımlılıkların proje içinden çözüldüğünü doğrulayan bir test.

**Mimari** (Planlayıcı §3)
- **Sim katmanı:** physics, ai, race, game/sim, track/{data,build,query,authoring}, core/{math,rng}. Saf TS'dir. `SimState` düz veridir ve deterministiktir; Node'da başsız çalışır.
- **Sunum katmanı:** graphics, ui, audio, track/{mesh,scenery,terrain,sky}. `RenderFrame` ve sim olaylarını okur, sim'i değiştirmez.
- **Döngü:** Sim 240 Hz sabit adımla çalışır; tekerlek dönüşü 4 alt adımda hesaplanır. Kare başına en fazla 12 tik işlenir, render interpolasyonla yapılır. Yapay zekâ 60 Hz'de kademeli çalışır. Flashback için 10 Hz'de snapshot alınır ve 15 saniyelik bir halka tamponda tutulur.
- **Sistem sırası** (tek yazar kuralı): Conditions → PlayerInput → AI → Vehicle → Collision → RaceDirector+Pit → Snapshot.
- **Test kancaları:** URL parametreleri (`?mode=race&autostart=1&autodrive=1&weather=heavy&tod=night&quality=ultra&laps=3&ai=19&scene=...`) ve `window.__APEX__` API'si (`whenReady`, `startSession`, `teleport`, `input.press`, `getTelemetry`, `getRace`, `getPerf`, `hashState`, `errors`).

**Sözleşmeler:** Planlayıcı raporu §4'teki TypeScript arayüzleri aynen `src/contracts/*.ts` olarak yazılır.

**Şartnameler:** Aşağıdakilerin hepsi Planlayıcı raporundadır:
- Fizik (§5): parametreler, lastik hamurları, ıslak tutuş tablosu, klavye filtresi, yardımlar, kabul değerleri.
- Yapay zekâ (§6).
- Pist (§7): OSM yolları, EU-DEM yükseklikleri, viraj listesi, DRS, pit, grid, gömülü yedek geometri.

## Tasarım ve hareket dili

**Görsel kaynak:** Tek görsel kaynak `docs/design/DESIGN.md` olur. Sprint 0'da reference-design-contract skill'iyle hazırlanır ve 9 bölümden oluşur. Planlayıcı'nın `ui-hud.md` dokümanı yalnızca işlevi tarif eder (veri, yerleşim, davranış); görsel kararlar DESIGN.md'de kalır.

**F1 25 referansında neyin alınıp neyin alınmayacağı**

| | İçerik |
|---|---|
| **Korunacak** | Yayın grafiği netliği, yoğun ama okunur zamanlama bilgisi, takım renklerinin işlevsel kullanımı, dar/kondanse büyük harf tipografi ritmi, koyu yarı saydam paneller, keskin açılar, mor/yeşil/sarı sektör anlamları |
| **Değişecek** | Marka (APEX GP), takımlar, sponsorlar, yerleşim ayrıntıları |
| **Kopyalanmayacak** | F1, FIA, EA ve Codemasters logoları; "Formula1" fontu; oyunun UI varlıkları; birebir ekran düzenleri |

**3B sanat yönü:** DESIGN.md'nin "Visual Theme & Atmosphere" bölümünde tanımlanır: gün saatine göre renk derecelendirme, livery tasarım dili, ışık havası.

**Hareket kuralları** (emilkowalski-motion ve GSAP skill'leri)
- Kontrol animasyonları 140–220 ms sürer. Yalnızca `transform` ve `opacity` canlandırılır.
- Tek bir easing ailesi kullanılır (GSAP CustomEase). Yaylarda sönüm oranı en az 0,72'dir; çizgi film tarzı zıplama olmaz.
- Hareket `prefers-reduced-motion` tercihine ve "Arayüz animasyonları" ayarına uyar.
- **HUD sayıları GSAP ile canlandırılmaz.** Hız, devir ve zamanlar 30 Hz'de doğrudan güncellenir.
- GSAP yalnızca ayrık olaylarda kullanılır:
  - bildirimler,
  - sıralama kulesindeki yer değişimleri (Flip),
  - sektör flaşı,
  - menü geçişleri,
  - start ışıkları,
  - sonuç ekranı açılışı.
- `dispose` sırasında tüm tween ve timeline'lar öldürülür; sızıntı testi bunu denetler.

---

## Sprint planı

### Sprint 0 — Kurulum, tasarım sözleşmesi ve yürüyen iskelet

**Benim adımlarım**
1. Git kurulumu: `winget install --id Git.Git -e`. UAC onay penceresi çıkabilir.
2. Proje klasörü ve `git init`.
   - `.gitignore`: `node_modules`, `dist`, `test-results`, `media`.
   - Yerel commit yazarı olarak senin e-postan kullanılır; bu ayar yalnızca bu repoda geçerlidir.
3. Planlayıcı raporu `docs/design/planner-report.md` dosyasına çıkarılır.
4. `.claude/agents/` altına 7 rol tanımı yazılır.

**Paralel ajanlar**
- **Yönetici**
  - npm projesi ve sabit sürümler; vite, tsconfig (strict), vitest ve playwright yapılandırmaları.
  - `src/contracts/*`.
  - Çekirdek: döngü, EventBus, durum makinesi, InputManager ve varsayılan tuşlar, SettingsStore, TR/EN i18n, AssetLoader, `__APEX__`.
  - `createSim()` ve taslak sistemler.
  - `TrackQuery` arayüzünü uygulayan **yer tutucu oval pist**.
  - Sandbox yönlendiricisi ve `?scene=skeleton` sahnesi.
  - Düz HTML yer tutucu arayüz.
  - `scripts/shot.mjs`: port, URL, çıktı ve `sceneReady` parametreleri; varsayılan başsız; GPU bayrakları ve `--headed` seçeneği.
  - npm script'leri.
- **Planlayıcı** (yalnızca `docs/`)
  - `GDD.md` ve `ARCHITECTURE.md`.
  - Tasarım dokümanları: `design/{rendering,ui-hud,audio,rules,pit-weather,testing-qc}.md`.
  - `team/<rol>.md` brifleri.
  - `sprints/sprint-1.md`.
- **Grafik Dizaynlayıcı** (kısa görev)
  - **reference-design-contract** ile `docs/design/DESIGN.md`, `design-contract.md`, `implementation-handoff.md` ve `example.html` hazırlar. `example.html`, HUD'un ve ana menünün sözleşme önizlemesidir.
  - Palet ve font eşleşmesi verisi için **ui-ux-pro-max** kullanır.
  - Fontlar OFL lisanslı olur ve yerelde (woff2) barındırılır.

**Kabul**
- typecheck, test ve build yeşil.
- `?scene=skeleton` ekran görüntüsünde kutu araç oval pistte sürülüyor.
- DESIGN.md, skill'in P0 kapılarını geçiyor ve `example.html` ekran görüntüsünü inceledim.
- Commit: `sprint-0`.

### Sprint 1 — Paralel üretim (4 ajan)

- **Çevre Dizaynlayıcı**
  1. **Önce** TrackData ve TrackQuery:
     - Veri hattı OSM Overpass ve EU-DEM'dir; ağ yoksa rapordaki gömülü yedek veri kullanılır.
     - Testler: döngü kapalı, viraj yön dizisi `L R L R L L R L L R R L R L`, koordinat dönüşümü (round-trip) hatası 2 cm'den az.
  2. Pist yüzeyi: asfalt, beyaz çizgiler, kerb'ler, çakıl ve asfalt kaçış alanları, astroturf.
  3. Çevre: arazi, bariyerler ve çitler, tribünler ve kalabalık, pit binası, start köprüsü, marşal postaları, reklam panoları, ağaçlar, gökyüzü ve bulutlar, gündüz ışık düzeni.
  4. Sandbox sahneleri: `?scene=track-data`, `?scene=track`.
- **Grafik Dizaynlayıcı (3B)**
  - DESIGN.md'deki 3B sanat yönüne uyar.
  - GraphicsSystem: renderer, post zinciri, 4 kalite önayarı.
  - Malzemeler.
  - Prosedürel 2025 tarzı araç: 10 livery, 3 LOD seviyesi, instancing ile çizilen tekerlekler, animasyonlar.
  - 5 kamera.
  - Temel VFX: lastik dumanı, kıvılcımlar, toz, fren izleri.
  - Yarış çizgisi görseli.
  - Sandbox sahneleri: `?scene=car`, `?scene=vfx`, `?scene=post`.
- **Sürüş Motoru Mühendisi**
  - Araç modeli (§5).
  - Lastik, aero, güç ünitesi, ERS/DRS, vites, frenler.
  - Yardımlar, klavye filtresi, çarpışmalar.
  - Benchmark testleri (§5.11).
  - Yapay zekâ: yarış çizgisi, hız profili, kontrolcü, zorluk ayarı.
  - Motor sesi sentezi.
  - Sandbox sahneleri: `?scene=physics`, `?scene=ai`, `?scene=audio`.
  - Bu sprintte yer tutucu pistte çalışır; İstanbul kalibrasyonu Sprint 2'de.
- **Testçi**
  - `tests/` altyapısı: `__APEX__` istemcisi, ekran görüntüsü galerisi, FPS örnekleyici.
  - Testler: mimari kuralı, i18n anahtar eşliği, bağımlılık çözümleme.
  - İskelet için E2E smoke testi.
  - `docs/qa/test-plan.md`.

**Kalite kapısı:** Kalite Kontrolcü mimari sapmalara karşı kısa bir inceleme yapar.

**Kabul:** Tüm sandbox ekran görüntüleri alınmış, benchmark'lar geçiyor, typecheck/test/build yeşil. Commit: `sprint-1`.

### Sprint 2 — Entegrasyon, yarış sistemleri, arayüz (6 ajan)

- **Yönetici**
  - Gerçek modülleri oyuna bağlar.
  - RaceDirector: 5 kırmızı ışık, erken kalkış, tur ve sektör zamanlaması, sıralama ve aralar, bayraklar, pist sınırları ve cezalar.
  - ConditionsSystem: hava zaman çizelgesi ve pist ıslaklığı.
  - PitProcedure, flashback, TT ghost.
  - **Replay kaydı** (`src/game/replay`): seed verilmiş, deterministik bir yarıştan 60 Hz poz ve telemetri kaydeder; fragman bu kaydı kullanır.
  - HudPresenter, sonuç ekranı, ayar kalıcılığı.
  - Yükleme hattı (`compileAsync`).
  - Sandbox sahnesi: `?scene=race-logic`.
- **Grafik-UI**
  1. **frontend-design** ve **emil-design-eng** ile HUD'u ve tüm menüleri kurar; kaynak DESIGN.md'dir.
  2. Ardından **emilkowalski-motion** ve **gsap-core / gsap-timeline / gsap-plugins** (Flip, CustomEase) ve **gsap-performance** ile hareket geçişi yapar.
  3. **frame-logo-outro** ile açılış logo animasyonunu yapar: en fazla 2,5 sn, bir tuşla atlanabilir, logo CSS/SVG ile çizilir.
  - Sandbox sahneleri: `?scene=hud`, `?scene=menu`.
- **Grafik-3B**
  - 3B showroom (ana menü arka planı).
  - Yağmur VFX: yağmur çizgileri, su spreyi, kokpitte lens damlaları.
  - Islak araç malzemeleri, fren diski kızarması, yağmur lambası.
  - Sadeleştirilmiş pit ekibi.
  - Önayar ayarları.
- **Çevre Dizaynlayıcı**
  - Gün batımı ve gece ışık düzenleri.
  - Projektörler: direkler, ışık haritası, parlama.
  - Islak pist shader'ı: su birikintileri, damla halkaları, önce kuruyan yarış çizgisi.
  - Pit yolu detayları.
  - LOD ve instancing ile bütçeye uyum.
- **Sürüş Motoru Mühendisi**
  - İstanbul kalibrasyonu: d=100 yapay zekâ turu 1:24–1:27, sektör payları yaklaşık %33/36/31.
  - Islak tutuş ve lastikler; sıcaklık ve aşınma kalibrasyonu.
  - Yapay zekâ: pit ve hava durumu kararları; atak, savunma, mavi bayrak, çarpışmadan kaçınma, start davranışı.
  - Slipstream ve kirli hava.
  - Sesler: yapay zekâ araçlarının pozisyonel motor sesi ve doppler; lastik, kerb, rüzgâr, yağmur, kalabalık.
  - **Ses grafiği `OfflineAudioContext` üzerinde de kurulabilmeli**, çünkü fragman sesi bu yolla üretilecek.
- **Testçi:** Sim, entegrasyon, E2E ve performans test takımlarını yazar.

**Kabul:** Menüden 20 araçlı yarışa ve sonuç ekranına kadar oyun uçtan uca oynanıyor; UI animasyonları FPS'i düşürmüyor. Commit: `sprint-2`.

### Sprint 3 — Test ve kalite denetimi (paralel)

- **Testçi:** Tüm test takımları, gün saati × hava × önayar matrisinde E2E, performans ve sızıntı testleri. Rapor: `docs/qa/test-report-1.md`.
- **Kalite Kontrolcü**
  - Kod, performans, görsel (F1 25 listesi) ve sürüş hissi denetimi.
  - **web-design-guidelines** ile `src/ui/**` denetimi; bulgular `file:line` biçiminde.
  - UI hareket kalitesinin incelenmesi.
  - Rapor: `docs/qa/qc-report-1.md`; bulgular P0/P1/P2 önceliğiyle ve sahipleriyle.
- **Ben:** `code-review` (high) çalıştırıp bulguları QC raporuna eklerim.

### Sprint 4 — Düzeltme ve cila döngüsü (en fazla 2 tur)

1. Planlayıcı düzeltme planını yazar.
2. Sahipler kendi bulgularını paralel düzeltir.
3. Grafik-UI arayüze **impeccable-design-polish** uygular: audit → critique → polish → animate → harden. Arayüz hâlâ jenerik görünürse **redesign-skill** devreye girer.
4. Testçi regresyon testlerini çalıştırır; QC P0 ve P1 bulgularının kapandığını doğrular. Gerekirse ben `simplify` çalıştırırım.

**Çıkış koşulu:** P0 = 0 ve P1 = 0 (ya da gerekçesiyle ertelenmiş), tüm eşikler yeşil.

### Sprint 5a — Teslim

- **Yönetici:**
  - `CREDITS.md`: OSM/ODbL, EU-DEM, CC0, OFL, müzik ve GSAP lisans bilgileri.
  - Türkçe `README.md` ve `start.bat`.
  - Production build.
- **Ben:**
  - Son tam test koşusu.
  - Ekran görüntülü son rapor.
  - Commit ve `v1.0` etiketi.
  - artifact-design skill'ini yükleyip build'i claude.ai'de **özel (private)** bir Artifact olarak yayınlarım. İstemezsen bu adım atlanır.

### Sprint 5b — Tanıtım fragmanı (motion-design)

**Ekip:** Grafik-3B ve Grafik-UI birlikte çalışır; Kalite Kontrolcü salt-okur "hareket + tasarım eleştirmeni" olur ve varsayılan kararı "ret"tir.

**Akış**
1. **Brif.** `media/trailer/` altında üç dosya hazırlanır:
   - `BRIEF.md`: 30 sn, 1920×1080, 60 fps.
   - `BEATMAP.md`: müzikteki "drop" ana ana denk gelir (start ışıklarının sönmesi ya da T8'de gece ve yağmura geçiş).
   - `facts.md`: ekrandaki her iddia gerçek bir özellik olmalıdır.
2. **Sahne.** `?scene=trailer` içinde `window.seek(t)` çalışır:
   - Kayıtlı replay'den deterministik pozlar.
   - Senaryolu kameralar: TV, onboard, T8 üstü drone, pit.
   - Başlık kartları, `totalTime(t)` ile seek edilen GSAP timeline ile.
   - frame-logo-outro tarzı kapanış kartı.
   - `Math.random` kullanılmaz.
3. **Render.** Önce 4 still alınır ve Read ile bakılır. Sonra draft (30 fps, 960×540), en son master (1080p60, 4–8 alt kare harmanlama, shutter 0,5). Playwright GPU bayraklarıyla çalışır.
4. **Ses.**
   - Oyunun ses sentezi, replay telemetrisinden `OfflineAudioContext` ile motor, lastik ve kalabalık sesini üretir.
   - Müzik Mixkit'ten (ücretsiz lisans) alınır ya da sentezlenir; efektler vuruşlara oturtulur.
   - İki geçişli loudnorm ile −14 LUFS'e getirilir.
5. **Encode.** `ffmpeg-static` ile H.264 (crf 16), BT.709 TV aralığı ve AAC 256k. Çıktı: `media/apex-gp-trailer.mp4`.
6. **Eleştiri döngüsü.** ffmpeg ile kontak sayfaları çıkarılır ve QC puanlar. Tüm puanlar 8 ve üstü olana kadar yalnızca değişen saniyeler yeniden render edilir.
7. **İsteğe bağlı poster.** **poster-hero** ile 1080×1920 bir tanıtım posteri: Ultra ayarda oyun içi render ve DESIGN.md tipografisi.

**Kabul:** still'ler onaylı; açıklanmamış pop yok; drop ana ana denk geliyor; ses −14 LUFS; renk BT.709; ekrandaki metinler doğru.

---

## Skill kullanımı

| Skill | Sprint | Kim | Amaç |
|---|---|---|---|
| reference-design-contract | 0 | Grafik | DESIGN.md, sözleşme ve devir notu |
| ui-ux-pro-max | 0, 2 | Grafik | Palet ve font eşleşmesi verisi |
| frontend-design | 2 | Grafik-UI | HUD ve menüleri üretim kalitesinde kodlamak |
| emil-design-eng | 2 | Grafik-UI | Bileşen cilası, etkileşim detayları |
| emilkowalski-motion | 2 | Grafik-UI | Mikro etkileşimler, durum geçişleri |
| gsap-core, gsap-timeline, gsap-plugins, gsap-performance | 2, 5b | Grafik | UI animasyonları (sıralama kulesi için Flip) ve fragman zaman çizelgesi |
| frame-logo-outro | 2, 5b | Grafik-UI | Açılış logo animasyonu ve fragmanın kapanış kartı |
| web-design-guidelines | 3 | Kalite Kontrolcü | `src/ui` denetimi |
| code-review (high) | 3 | ben | Kod hataları |
| impeccable-design-polish | 4 | Grafik-UI | Audit, polish, animate, harden |
| redesign-skill | 4 (gerekirse) | Grafik-UI | Arayüz jenerik kalırsa |
| simplify | 4 | ben | Sıcak modüller |
| motion-design | 5b | Grafik + QC | 30 sn tanıtım fragmanı |
| poster-hero | 5b (isteğe bağlı) | Grafik | Tanıtım posteri |
| run | her sprint | ben | Uygulamayı çalıştırıp doğrulamak |
| artifact-design + Artifact | 5a | ben | Özel yayın |

**Kullanılmayacak skill'ler**
- **taste-skill:** Landing page ve portföy için tasarlanmış; çok adımlı oyun arayüzüne uymuyor.
- **brutalist, minimalist ve soft:** Görsel yönü DESIGN.md tek başına belirliyor; bu stiller onunla çakışır.
- **deck-\*, ppt-keynote, mockup-device-3d, video-hyperframes, frame-data-chart-nyt, dataviz, frame-liquid-bg-hero, vfx-text-cursor:** Bu kapsamda gerek yok.
- **frame-glitch-title ve frame-light-leak-cinema:** Fragmanın başlık kartlarında gerekirse bakılabilir.

---

## Doğrulama

**Komutlar:** `npm run typecheck`, `npm test`, `npm run e2e`, `npm run build`, `npm run preview` (ya da `start.bat`).

**Oyun kapıları**
- Fizik ve yapay zekâ eşikleri: Ek E.
- FPS (RTX 4060L, 1080p): Ultra ≥ 60, High ≥ 100. En ağır senaryoda (gece + yoğun yağmur + 20 araç) Ultra ≥ 50.
- Konsolda hata yok.
- Sızıntı testi: 5 kez başlat/çık sonrasında geometri ve doku sayısındaki değişim ±%2 içinde.
- Determinism hash ve snapshot/restore testleri geçiyor.

**UI kapıları**
- web-design-guidelines denetiminde P0 bulgu yok.
- Menüler yalnızca klavyeyle gezilebiliyor; odak her zaman görünür.
- `prefers-reduced-motion` ve "Arayüz animasyonları" ayarı çalışıyor.
- Bildirimler sık tetiklendiğinde FPS düşüşü %3'ten az.

**Fragman kapıları:** motion-design teslim listesi (Sprint 5b kabulü).

**Görsel inceleme:** Her sprint sonunda ben ve QC `test-results/screens/` galerisini Read ile inceleriz.

**Senin testin:** `start.bat` → menü → yarış.

## Riskler

| Risk | Önlem |
|---|---|
| Paralel ajanların aynı dosyaya yazması | Dizin sahipliği, donmuş sözleşmeler, sprint sonunda entegrasyon |
| Ajan raporunun kesilmesi (bir kez yaşandı) | Tek mesaj, en fazla 8 KB; ayrıntılar `docs/` altında |
| Skill'in alt ajanda yüklenememesi | Skill'i ben yükleyip özünü `docs/design/skills/` altına yazarım |
| Klavyeyle sürüşün kötü hissettirmesi | Klavye filtresi (§5.7), yardım önayarları, physics sandbox'ı, QC sürüş hissi listesi |
| 20 araç + yağmur + gece performansı | Bütçeler, LOD, instancing, önayarlar, her sprintte performans ölçümü |
| UI animasyonlarının oyunu yavaşlatması | Yalnızca transform/opacity; HUD sayıları GSAP'sız; performans testi |
| OSM/EU-DEM servislerine erişilememesi | Rapordaki gömülü yedek veri (§7.4, §7.15) |
| three r186 / postprocessing API sapmaları | Sabit sürümler, typecheck, sandbox ekran görüntüleri |
| Flashback ve determinism hataları | Düz veri `SimState`, hash ve snapshot testleri |
| Başsız Chrome'da GPU olmaması | Fonksiyonel testler başsız; performans testleri ve fragman render'ı görünür pencerede (ekranında kısa süre Chrome açılır) |
| Fragman render süresi ve lisanslar | Önce draft, sonra parçalı master render; Mixkit lisansı ya da sentez müzik; CREDITS |
| Kapsam ve süre taşması | Sprint kapıları. Uzatma işleri en sona kalır (pit ekibi, ısı dalgası, lens damlaları, poster); fragman, oyun bittikten sonra yapılır |

---

## Ek A — Dizin yapısı ve kritik dosyalar

```
apex-gp/
├─ .claude/agents/                  ORK  planlayici, yonetici, cevre, grafik, surus, kalite, testci (.md)
├─ docs/                            PLN  GDD.md, ARCHITECTURE.md, design/*.md, team/*.md, sprints/*.md
│  ├─ design/DESIGN.md (+ design-contract.md, implementation-handoff.md, example.html)   GRA
│  ├─ design/skills/                ORK  (gerekirse skill özetleri)
│  └─ qa/                           QC + TEST raporları
├─ scripts/  shot.mjs (YÖN) · fetch-track.mjs (ÇEV) · perf.mjs (TEST) · render-trailer.mjs, trailer-audio.mjs (GRA)
├─ public/assets/{env,gra,sur}/     rol varlıkları + CREDITS.part.md
├─ src/
│  ├─ main.ts, contracts/, core/, game/ (replay/ dahil), race/, data/, sandbox/   YÖN
│  ├─ track/{data,authoring,build,query,mesh,scenery,terrain,sky}/                ÇEV
│  ├─ physics/{vehicle,tyre,aero,powertrain,assists,input,collision}/, ai/, audio/   SÜR
│  ├─ graphics/{renderer,post,materials,car,vfx,camera,racingLine}/, trailer/     GRA-3B
│  └─ ui/{screens,hud,styles,motion}/, ui/format.ts                               GRA-UI
│     (her modülde index.ts fabrikaları, __tests__/, sandbox/*.scene.ts, i18n/*.{tr,en}.ts)
├─ tests/{sim,integration,e2e,perf,helpers}/                                      TEST
└─ media/ (git dışı: trailer/ BRIEF, BEATMAP, facts, render çıktıları, MP4)       GRA
```

**Kritik dosyalar**
- `src/contracts/*.ts`: tüm ekibin dayandığı sözleşmeler.
- `src/core/loop.ts` ve `src/game/createSim.ts`: oyunun ve testlerin ortak fabrikası.
- `src/track/query/*`: hedef, sorgu başına ≤ 1 µs.
- `src/physics/input/keyboardFilter.ts`: klavye hissinin kalbi.
- `src/graphics/car/*`, `src/graphics/post/*`, `src/ui/hud/*`, `src/ui/motion/*`.
- `docs/design/DESIGN.md`.
- `scripts/shot.mjs`.

## Ek B — Render şartnamesi (özet; ayrıntısını Planlayıcı yazar)

**Renderer**
- `WebGLRenderer`: `antialias: false`, `powerPreference: 'high-performance'`, sRGB çıktı. Tone mapping post zincirinde yapılır (AgX); tamponlar half-float.
- Ortam ışığı (PMREM), Çevre'nin env sahnesinden üretilir ve gün saati ya da hava değiştiğinde yeniden oluşturulur.
- Gölge: oyuncu aracını izleyen DirectionalLight. Dar frustum texel'e hizalanır, PCF soft kullanılır. Uzak nesnelerde baked AO ve blob gölge.

**Post-process zinciri:** N8AO (High'da yarım, Ultra'da tam çözünürlük) → SMAA (Low'da FXAA) → Bloom → AgX → gün saati ve havaya göre LUT → Vignette → hıza bağlı hafif kromatik sapma → yağmurda lens damlaları.

**Araç**
- **Malzemeler:**
  - Clearcoat boya (parlak, mat, metalik); livery canvas atlas üzerinde.
  - Prosedürel karbon örgü.
  - Lastik yanağında ORBIS yazısı ve hamur şeridi: S kırmızı, M sarı, H beyaz, I yeşil, W mavi.
  - Emissive fren diskleri ve yağmur lambası.
- **Parçalar:** burun, 4 elemanlı ön kanat, süspansiyon, halo, kokpit, kask, ekranlı direksiyon, undercut'lı yan podlar, motor kapağı ve köpekbalığı yüzgeci, T-cam, hava girişi, taban ve difüzör, DRS'li arka kanat ve beam wing, aynalar, tekerlekler.
- **Bütçe:**
  - LOD0 en fazla 60k üçgen (30 m'ye kadar), LOD1 en fazla 15k (120 m'ye kadar), LOD2 en fazla 3k.
  - LOD0 en fazla 8 draw call.
  - Tekerlekler tek instancing grubunda çizilir.

**VFX:** lastik dumanı (soft particle), titanyum kıvılcımları, çakıl ve çim tozu, fren izleri, yağmur çizgileri, sprey ve difüzör arkasındaki su kuyruğu ("rooster tail"); yalnızca Ultra'da ısı dalgası.

**Kameralar**

| Kamera | FOV | Not |
|---|---|---|
| Kokpit | 75 | halo ve direksiyon görünür, g kuvvetine göre kafa hareketi |
| T-cam | 70 | |
| Burun | 72 | |
| Yakın takip | 65 | 6,5 m geride, 2 m yukarıda, yaylı takip |
| Uzak takip | 62 | 9,5 m geride, 3 m yukarıda |

- Hız arttıkça FOV büyür: 300 km/sa'te +6°.
- Kerb'lerde kamera sarsıntısı olur ve geriye bakış vardır.
- Ayrıca TV, orbit ve fragman kameraları bulunur.

**Gün saati**
- **Gündüz:** güneş yaklaşık 55° yükseklikte.
- **Gün batımı:** güneş yaklaşık 6°'de; sıcak tonlar, uzun gölgeler, güçlü bloom.
- **Gece:** ay ışığı ve projektörler.
- **Yağmur:** bulut örtüsü 1, güneş ×0,25, sis artar.

**Kalite önayarları**

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Render ölçeği | 0,75 | 0,9 | 1,0 | 1,0 |
| AA | FXAA | SMAA Med | SMAA High | SMAA Ultra |
| Gölge haritası | 1024 | 2048 | 2048 | 4096 |
| AO | yok | yok | yarım | tam |
| Bloom ve LUT | yok | var | var | var |
| Env haritası | 128 | 256 | 256 | 512 |
| Aynalar | statik | statik | 30 Hz | 60 Hz |
| Ağaç / kalabalık yoğunluğu | 0,35 / 0,3 | 0,6 / 0,6 | 1,0 / 1,0 | 1,3 / 1,0 |
| Yağmur çizgisi sayısı | 2k | 4k | 8k | 12k |

**Bütçe (High):** sahne en fazla 400 draw call ve 3M üçgen. Bunun içinde çevrenin payı en fazla 1,5M üçgen ve 200 draw call (§7.14).

## Ek C — HUD ve menüler (işlevsel yerleşim; görsel dil DESIGN.md'den gelir)

**HUD**

| Konum | İçerik |
|---|---|
| Sol üst | Sıralama kulesi: pozisyon, takım rengi, 3 harfli kod, aralık ya da lidere fark, lastik, pit ve ceza rozetleri |
| Sağ üst | TUR x/y ve P x/20; anlık tur süresi, delta, son ve en iyi tur; 3 sektör çubuğu |
| Üst orta | Start ışıkları, bildirim şeridi |
| Sağ alt | Büyük vites göstergesi, km/sa, 15 LED vites ışığı, ERS, DRS, pit limitörü, fren dengesi |
| Sol alt | Mini harita, 4 lastiğin aşınma ve sıcaklığı, hava ve pist ıslaklığı |
| Ortada açılan | MFD (Tab): sonraki lastik, pite giriş, hava tahmini, ERS, fren dengesi. Flashback zaman çizelgesi |

HUD üç modda kullanılabilir: tam, minimal ve kapalı.

**Ekranlar**
- Açılış logo animasyonu.
- Başlık ekranı ("bir tuşa bas"; bu tuş ses kilidini de açar).
- Ana menü; arkada 3B showroom.
- Zamana Karşı kurulumu.
- Yarış akışı: koşullar → takım → ayarlar → yardımlar → yükleme → yarış.
- Duraklatma menüsü.
- Sonuç ve TT sonuç ekranları.
- Ayarlar: grafik, ses, kontroller ve tuş atama, yardımlar, HUD, dil, arayüz animasyonları.
- Jenerik.

**Genel kurallar**
- Arayüz tamamen klavyeyle kullanılır: oklar ya da WASD ile gezinme, Enter ya da Space ile seçme, Esc ya da Backspace ile geri dönme. Odak her zaman görünür.
- Sayılarda `tabular-nums` kullanılır.
- Varsayılan dil Türkçe, ikincisi İngilizce. Türkçe büyük/küçük harf dönüşümü (İ/ı) doğru yapılır.

## Ek D — Oyun kuralları ve tuşlar

**Kurallar**
- **Yarış uzunluğu:** 3, 5, 10, 15 ya da 29 tur.
- **Zorluk:** 0–110, varsayılan 70. Yapay zekâ rakip sayısı 0–19.
- **Start:** 5 ışık birer saniye arayla yanar, ardından 0,2–3,0 sn rastgele bekleme olur. Işıklar sönmeden 0,5 m'den fazla hareket edilirse +5 sn ceza.
- **Pist sınırları:**
  - 3 uyarı verilir (1/3, 2/3, 3/3), üçüncüsünde siyah-beyaz bayrak gösterilir.
  - Sonraki her ihlal +5 sn ceza.
  - Zamana Karşı'da ihlal edilen tur geçersiz sayılır.
- **Pit:**
  - Hız limiti 80 km/sa; aşım +5 sn ceza.
  - Pitte kaybedilen süre 20–24 sn hedeflenir.
  - Kuru ve 10 tur ya da daha uzun yarışta iki hamur kullanmak zorunludur; ihlal +30 sn ceza.
- **Puanlar (2025):** 25-18-15-12-10-8-6-4-2-1. En hızlı tur puanı yoktur.
- **Flashback:** hak sayısı 0, 3, 5 ya da sınırsız. En fazla 15 sn geri sarar. Zamana Karşı'da kullanılan tur geçersiz sayılır.

**Varsayılan tuşlar** (birleşik düzen; hepsi yeniden atanabilir; `KeyboardEvent.code` kullanıldığı için TR-Q klavyede de çalışır)

| Eylem | Tuş | Eylem | Tuş |
|---|---|---|---|
| Gaz / Fren | W, ↑ / S, ↓ | Kamera | C |
| Direksiyon | A/D, ←/→ | Geriye bak (basılı) | V |
| Vites + / − | E / Q | Flashback | R |
| DRS | Space | Duraklat | Esc / P |
| ERS overtake (basılı) | F | MFD · seçenekler | Tab · 1–4 |
| Pit limitörü | L | Yarış çizgisi | Y |
| HUD modu | H | TT turu yeniden başlat | Backspace |
| Debug | F8 | | |

## Ek E — Test eşikleri ve QC listeleri

**Vitest (başsız sim)**
- **Fizik:**
  - Hızlanma: 0–100 km/sa 2,5–2,9 sn; 0–200 4,6–5,4 sn; 0–300 10,0–12,5 sn.
  - Son hız: 322–332 km/sa; DRS ile +9…+15 km/sa.
  - Frenleme: 200→0 km/sa 50–65 m; 300→100 km/sa 70–95 m.
  - Yanal ivme: 80 km/sa'te 1,9–2,4 g; 250 km/sa'te 4,3–5,2 g.
  - Duruşta titreşim < 1 mm/s.
  - 10 dakika rastgele girdiyle NaN oluşmaz.
  - Determinism ve snapshot testleri geçer.
- **Pist:**
  - Döngü kapalı; uzunluk 5,30–5,40 km.
  - Viraj yön dizisi doğru; net dönüş açısı +360°.
  - Koordinat dönüşümü (round-trip) hatası < 2 cm.
  - Duvarlar kesintisiz; grid sınırların içinde; pit yolu bağlı.
- **Yarış mantığı:**
  - Zamanlama hatası < 1 ms.
  - Sıralama, cezalar, puanlar ve flashback doğru çalışır.
- **Yapay zekâ:**
  - 20 araç 3 tur sürer; d=100'de tur süresi 1:24,0–1:27,0.
  - Araç başına turda en fazla 1 pist dışı.
  - Islak koşullarda tur süresi farkı:
    - Ara lastik, W=0,5: +%8–13.
    - Yağmur lastiği, W=1: +%15–22.
  - 15 turluk kuru yarışta herkes pite girer; pitte kilitlenme olmaz.
- **Ayrıca:** i18n anahtar eşliği, mimari kuralı ve bağımlılık çözümleme testleri.

**Playwright (sistemdeki Chrome)**
- Menüler yalnızca klavyeyle gezilebilir; ayarlar sayfa yenilemesinden sonra korunur.
- Uçtan uca yarış: `?mode=race&autostart=1&autodrive=1&laps=1` → ışıklar → bitiş → sonuç ekranı.
- Sabit noktalarda ekran görüntüsü: S/F, T1, T3, T8, T9, T12, pit. Gün saati × hava matrisinde alınır.
- Performans: görünür pencerede her önayar için 30 sn.
- Sızıntı: 5 kez başlat/çık.
- Pit, flashback ve klavyeyle sürüş testleri.
- `prefers-reduced-motion` testi.
- Kapı: konsolda hata yok.

**QC kontrol listeleri**
- **Kod:**
  - Sözleşmelere uyulmuş; tek yazar kuralı korunmuş.
  - Sim katmanında three.js ya da DOM yok.
  - Sıcak döngülerde bellek ayırma yok.
  - `dispose` eksiksiz; GSAP tween'leri temizleniyor.
- **Performans:** Bütçeler aşılmıyor; shader derlemesi takılma yaratmıyor.
- **Görsel:**
  - Araç silueti ve oranları doğru.
  - Boya yansımaları gerçekçi; lastik yanak renkleri doğru.
  - Pist dokusu, kerb'ler ve kauçuk izi inandırıcı.
  - Tribün, kalabalık ve ışık yerinde; yağmur iyi görünüyor.
  - Z-fighting, pop-in ve titreme yok.
- **UI:**
  - web-design-guidelines denetimi temiz.
  - DESIGN.md'ye uyuluyor.
  - Hareket kurallarına uyuluyor.
  - F1 25 düzenine benzerlik var ama birebir kopya yok.
- **Sürüş hissi:**
  - Klavye direksiyonu öngörülebilir.
  - Frenleme, çekiş ve kerb davranışı doğal.
  - Startta yapay zekâ kaos çıkarmıyor.
  - Pit akışı ve flashback sorunsuz.
- **Fragman:** QC, motion-design eleştiri ölçütleriyle puanlar (ilk 2 sn'deki kanca, okunabilirlik, hareket kalitesi, çeşitlilik, kompozisyon, doğruluk, ses senkronu); her ölçütte en az 8 puan gerekir.
