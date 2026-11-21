# APEX GP — Oyun Tasarım Dokümanı (GDD)

> Sahibi: Planlayıcı. Öncelik sırası: `docs/sprints/PLAN.md` > `docs/sprints/DECISIONS.md` > bu doküman. Teknik ayrıntılar: `docs/ARCHITECTURE.md` ve `docs/design/*.md`. Görsel dil: `docs/design/DESIGN.md`.
> Oyunda "F1", "Formula 1", gerçek takım, pilot, sponsor ya da logo adı geçmez. "F1 25" adı yalnızca bu dokümanda, his referansı olarak anılır.

## 1. Vizyon
**APEX GP**, tarayıcıda çalışan, yalnızca klavyeyle oynanan, yüksek grafikli bir açık tekerlekli yarış oyunudur. Referans hissi F1 25'tir: yayın kalitesinde görüntü, yoğun ama okunur zamanlama bilgisi, gerçekçi strateji. Ölçek bir tarayıcı oyunudur: tek pist, iki mod, 20 araç.

**Tek cümle:** "İstanbul Circuit'te, klavyeyle, gerçek bir yarış hafta sonunun en heyecanlı 30 dakikası."

### 1.1 Sütunlar
1. **Klavyeyle hızlı ve öngörülebilir sürüş.** Klavye filtresi ve yardımlar sayesinde tuşa basılı tutmak sınırda virajı verir, aniden spin attırmaz.
2. **Yayın kalitesinde görüntü.** Gün batımı, projektörlü gece, yağmur ve sprey; 4 kalite önayarı, RTX 4060 Laptop'ta Ultra'da 60 FPS.
3. **Gerçek strateji.** Lastik hamurları, aşınma, değişken hava, pit stop, iki hamur kuralı, cezalar.
4. **Adil ve yaşayan rakipler.** 19 yapay zekâ pilot: zorluk 0–110, atak, savunma, mavi bayrak, pit ve hava kararları.
5. **Yerel ruh.** İstanbul Park esinli pist, Türk takımı Anka Racing, Türkçe varsayılan arayüz.

### 1.2 Hedef oyuncu
- Yarış oyunlarını seven ama direksiyon seti olmayan, masaüstünde klavyeyle oynayan oyuncu (16+).
- Kısa oturumlar: 5 dakikalık Zamana Karşı ya da 3–10 turluk yarış; derin oturum: 29 tur, değişken hava.
- İki uç için önayar: Başlangıç (her şey açık) ve Uzman (her şey kapalı, manuel vites).

## 2. Modlar
### 2.1 Zamana Karşı (Time Trial)
- Tek araç, pistte yalnızsın. Tüm araçların performansı eşit (perf 0); takım seçimi yalnızca livery'dir.
- Ayarlar: takım, lastik (Yumuşak/Orta/Sert), gün saati, hava (Kuru/Hafif/Yoğun; sabit), ghost (Kişisel En İyi / Rakip / Kapalı).
- Uçan start: S/F çizgisinin 200 m gerisinden 200 km/sa ile. Backspace turu yeniden başlatır.
- Mor/yeşil/sarı sektörler, canlı delta, geçersiz tur kuralları (`rules.md` §10).
- Kişisel en iyi, ghost ve yerel ilk 10 yalnızca kuru oturumlarda kaydedilir.
- Rakip ghost: zorluk 100'deki kusursuz yapay zekâ turu.

### 2.2 Hızlı Yarış (Quick Race)
- Akış: Koşullar → Takım → Ayarlar → Yardımlar → Yükleme → Yarış → Sonuç.
- Seçenekler: tur sayısı (3, 5, 10, 15, 29), gün saati, hava (Kuru, Hafif yağmur, Yoğun yağmur, Değişken), takım ve pilot, rakip sayısı (0–19), zorluk (0–110, varsayılan 70), grid sırası (1–20 ya da rastgele), başlangıç lastiği (otomatik ya da seçim), flashback hakkı (0/3/5/sınırsız).
- 5 kırmızı ışıkla duran start, 2025 puan sistemi, sonuç tablosu.

## 3. Pist: İstanbul Circuit
- İstanbul Park esinli; saat yönünün tersine; ≈ 5,35 km; 14 viraj; gerçek yükseklik profili (OSM + EU-DEM).
- Viraj yön dizisi: **L R L R L L R L L R R L R L**.
- Öne çıkanlar:
  - **T1:** kör, ~300 km/sa'ten sert fren, çıkışta yokuş aşağı.
  - **T3:** turun en yüksek noktasındaki hızlı kör sol.
  - **T8:** ~640 m, 4 apeksli, 260–290 km/sa, 5 g; ortasında tümsek (kıvılcım).
  - **T9:** −%9 eğimle fren, turun en alçak noktası.
  - **T12:** en büyük fren noktası, ana sollama yeri.
- Sektörler: S2 1.650 m'de (T6 sonrası), S3 3.480 m'de (T10 sonrası). Hız tuzağı 4.500 m.
- DRS bölgeleri: ana düzlük ve arka düzlük.
- Pit yolu sol tarafta (iç), 910 m, 80 km/sa limit, 10 garaj.
- Ayrıntı: planner-report §7.

## 4. Takımlar ve pilotlar
Tamamı kurgusaldır. Renkler ve livery dili: DESIGN.md §1.4.2. T-kamera rengi: 1. pilot siyah, 2. pilot sarı.

| Takım | Renkler | Kaplama | perf | Pilotlar (kod, numara) |
|---|---|---|---|---|
| **Anka Racing** (TR) | kırmızı / beyaz / altın | parlak | +0,010 | Kerem Aydın (AYD, 7) · Deniz Arslan (ARS, 34) |
| Aurora GP | buz beyazı / elektrik mavisi | parlak | +0,012 | Elias Norberg (NRB, 6) · Juho Virtanen (VIR, 19) |
| Vortex Motorsport | mat siyah / neon yeşil | mat | +0,015 | Tom Ashby (ASH, 9) · Rafael Mendes (MEN, 28) |
| Solaris Racing | turuncu / koyu mor | metalik | +0,005 | Luca Moretti (MOR, 15) · Hugo Lambert (LAM, 41) |
| Kestrel Racing | lacivert / altın | parlak | 0 | Oliver Grant (GRA, 3) · Kenji Morita (MRT, 25) |
| Meridian Racing | camgöbeği / gümüş | metalik | 0 | Mateo Ortega (ORT, 11) · Noah Fischer (FIS, 52) |
| Titan Dynamics | füme / kırmızı | mat | −0,005 | Viktor Hale (HAL, 8) · Anton Petrov (PET, 70) |
| Zephyr Racing | gök mavisi / pembe | parlak | −0,008 | Leo Duval (DUV, 21) · Santiago Ruiz (RUI, 37) |
| Ironclad Racing | sarı / siyah | parlak | −0,012 | Jack Whitmore (WHI, 12) · Ethan Cole (CLE, 46) |
| Nova Corsa | beyaz, mavi/kırmızı şeritler | parlak | −0,015 | Julien Moreau (MRE, 17) · Aiden Park (PAR, 88) |

- `perf`, yapay zekânın tutuşunu, motor gücünü ve ClA'yı en fazla ±%1,5 ölçekler. Zamana Karşı'da herkes 0'dır.
- Sponsorlar (kurgusal): Kuzey Air, Vela Fuel, Halcyon Energy, Pulsar Tech, Lale Çay, Kervan Bank, Mavi Rota Lojistik, Nexa Watches, Simit Express. Lastik markası: ORBIS.
- Takım adları her dilde İngilizce yazımıyla gösterilir (D-008).

## 5. Araç sınıfı ve sürüş felsefesi
### 5.1 Araç (tek sınıf, 2025 tarzı)
- 798 kg (pilot dahil); 1,6 L V6 turbo hibrit karakteri: ≈ 560 kW içten yanmalı + 120 kW MGU-K.
- ERS: 4 MJ batarya, turda 4 MJ kullanım; modlar Kapalı / Orta / Hızlı tur / Sollama (F basılı).
- 8 ileri vites; otomatik ya da manuel (E/Q). DRS: +9…+15 km/sa.
- Son hız 322–332 km/sa; 0–100 km/sa 2,5–2,9 s.
- Lastikler (ORBIS): Yumuşak (kırmızı), Orta (sarı), Sert (beyaz), Ara (yeşil), Yağmur (mavi). Isı penceresi, aşınma ve aşınma uçurumu var.
- Hasar modeli yok. Duvar ve araç temasları itme ve kıvılcım üretir. Takılan araç 4 s sonra piste geri alınır.

### 5.2 Sim-cade, klavye öncelikli
- Fizik sim tarafında: 2,5B araç dinamiği, birleşik kayma lastik modeli, aero, yük transferi, ERS ve DRS (planner-report §5).
- Klavye tarafında affedici: direksiyon hıza göre yumuşayan bir rampayla gelir; tam basış, o hızdaki tepe viraj tutuşunu verir. Gaz ve fren rampalıdır. "Klavye fren sınırlayıcı" kilitlenmeyi önler.
- Hedef his: tuşa dokunmak ince ayar, basılı tutmak sınırda viraj; tuşu bırakınca araç sakinleşir.
- Oyuncu her şeyi `?scene=physics` gibi sandbox'larda değil, oyunda hisseder; QC sürüş hissi listesi (testing-qc.md §5.5) kabul ölçütüdür.

## 6. Yardımlar ve önayarlar
| Yardım | Seçenekler | Etki |
|---|---|---|
| Direksiyon yardımı | açık/kapalı | Direksiyonu tutuş sınırında tutar; arka kayarsa karşı direksiyon verir |
| Fren yardımı | Kapalı / Düşük / Orta / Yüksek | Yarış çizgisinin hız profiline göre otomatik fren |
| ABS | açık/kapalı | Kilitlenmeyi önler |
| Çekiş kontrolü | Kapalı / Orta / Tam | Patinajı sınırlar |
| Vites | Otomatik / Manuel | |
| Yarış çizgisi | Kapalı / Virajlar / Tam | Renkli ideal çizgi (Y ile değişir) |
| Pit yardımı | açık/kapalı | Pit yolunu yapay zekâ sürer |
| ERS yardımı | açık/kapalı | Orta mod otomatik |
| DRS yardımı | açık/kapalı | İzinliyken DRS'i otomatik açar |
| Klavye fren sınırlayıcı | açık/kapalı | Tam fren tuşu kilitlenme eşiğinin hemen üstüne ayarlanır |

| Önayar | İçerik |
|---|---|
| **Başlangıç** | hepsi açık, çekiş kontrolü Tam, fren yardımı Yüksek, yarış çizgisi Tam |
| **Orta** (varsayılan) | direksiyon yardımı açık, ABS açık, çekiş kontrolü Orta, fren yardımı kapalı, yarış çizgisi Virajlar, otomatik vites, pit yardımı açık, ERS otomatik, DRS manuel |
| **Uzman** | hepsi kapalı, manuel vites |

## 7. Kurallar (PLAN Ek D'nin genişletilmiş özeti; bağlayıcı metin `docs/design/rules.md`)
- **Start:** 5 ışık birer saniye arayla yanar; 0,2–3,0 s rastgele beklemeden sonra söner. Işıklar sönmeden 0,5 m'den fazla hareket: +5 s. İpucu: fren ve gaza birlikte bas, ışıklar sönünce freni bırak.
- **Pist sınırları:** dört tekerlek birden beyaz çizginin dışındaysa ihlaldir. 1/3, 2/3, 3/3 uyarıları verilir; üçüncüde siyah-beyaz bayrak gösterilir; sonraki her ihlal +5 s. Viraj kesip zaman kazanmak (T1, T9–T10, T12–T14): +5 s. Zamana Karşı'da ihlal edilen tur geçersizdir.
- **Cezalar** bir sonraki pit stopta, lastik değişiminden önce beklenerek çekilir; çekilmeyen ceza bitişte süreye eklenir.
- **Pit:** 80 km/sa limit; aşım +5 s. Pite giren araç mutlaka garajında durur. Güvenli çıkışı ekip garanti eder. Pit kaybı 20–24 s.
- **İki hamur kuralı:** kuru ya da değişken havada ve 10 tur ve üzeri yarışta en az iki farklı kuru hamur kullanılmalıdır; ara ya da yağmur lastiği kullanan (ya da ıslanan yarıştaki) araç muaftır. İhlal: +30 s.
- **Bayraklar:** sarı (sektörde DRS yok, yapay zekâ sollamaz), mavi (tur bindirilen araç yol verir), siyah-beyaz, damalı. Güvenlik aracı ve kırmızı bayrak yoktur.
- **DRS:** 3. turdan itibaren, algılama noktasında öndeki araca 1 s'den yakınsan açılır; ıslakta kapalıdır.
- **Puanlar (2025):** 25-18-15-12-10-8-6-4-2-1. En hızlı tur puanı yoktur.
- **Flashback:** 0/3/5/sınırsız hak, en fazla 15 s geri sarma; Zamana Karşı'da turu geçersiz kılar.
- **Yarıştan çekilme:** sonuç tablosu mevcut sıralamaya göre tahmini olarak hesaplanır.

## 8. Hava, gün saati ve pit stratejisi
- **Gün saati** oturum boyunca sabittir:
  - **Gündüz:** güneş ≈ 55°, yaz sonu öğleden sonrası.
  - **Gün batımı:** güneş ≈ 6°, uzun gölgeler, sıcak tonlar, projektörler %35.
  - **Gece:** projektörlerle aydınlanan pist, siyah gökyüzü.
  - Renk hedefleri: DESIGN.md §1.4.1.
- **Hava önayarları:** Kuru, Hafif yağmur, Yoğun yağmur, Değişken.
  - Değişken hava tohumdan (seed) üretilen bir zaman çizelgesidir; her yarışta en az bir yağmur atağı ve bir kuru dönem vardır.
  - Pist yağmurla ıslanır, yağmur durunca kurur. Yarış çizgisi trafikle daha hızlı kurur ve görsel olarak da önce kurur.
  - Ayrıntı: `pit-weather.md`.
- **Hava tahmini:** MFD'de +5/+10/+15/+30 dk için yağış ve olasılık. Uzak tahmin daha belirsizdir. Oyuncu ve yapay zekâ aynı tahmini görür.
- **Lastik geçişleri** (yarış çizgisi ıslaklığına göre): kuru lastik → ara ≈ 0,11; ara → yağmur ≈ 0,62.
- **Strateji araçları:** MFD'de pite giriş talebi, sonraki lastik, tahmini pit kaybı ve piste dönüş sırası; uyarılar ("PİTE GİR · ARA LASTİK"). Yapay zekâ şablon stratejiler, undercut ve hava eşikleriyle karar verir.

## 9. Kameralar
- Sürüş kameraları (C ile değişir):
  - kokpit (FOV 75; halo ve direksiyon görünür, g kuvvetiyle kafa hareketi),
  - T-kamera (70),
  - burun (72),
  - yakın takip (65; 6,5 m geride, 2 m yukarıda),
  - uzak takip (62; 9,5 m geride, 3 m yukarıda).
  - Varsayılan: yakın takip.
- Hız arttıkça FOV büyür (300 km/sa'te +6°). Kerb ve temasta sarsıntı olur; ayarlardan kısılabilir. V basılıyken geriye bakılır.
- Ek kameralar:
  - TV kamerası: bitişten sonra ve sonuç ekranında.
  - Showroom/orbit: ana menü.
  - Fragman kameraları.
- Ayrıntı: rendering.md §9.

## 10. HUD ve menü akışı (işlevsel; görünüm DESIGN.md'de)
- **HUD:**
  - sol üstte sıralama kulesi,
  - sağ üstte zamanlama paneli (tur sayacı yalnızca burada, D-006),
  - üst ortada start ışıkları ve bildirimler,
  - sağ altta vites, hız, 15 LED, ERS, DRS, pit ve fren dengesi,
  - sol altta mini harita, lastikler ve hava,
  - ortada MFD (Tab) ve flashback zaman çizelgesi.
- HUD üç modludur: tam, sade, kapalı (H). Ölçek 0,8–1,25; 900 px'ten kısa ekranda varsayılan 1,1 (D-004).
- **Ekranlar:**
  - açılış logosu (≤ 2,5 s, atlanabilir),
  - başlık ("bir tuşa bas"; sesi açar),
  - ana menü (Zamana Karşı, Hızlı Yarış, Ayarlar, Jenerik),
  - Zamana Karşı kurulumu,
  - yarış kurulum adımları,
  - yükleme,
  - duraklatma,
  - ayarlar (Grafik, Ses, Kontroller, Yardımlar, HUD, Dil, Arayüz),
  - sonuç ve ZK sonuç ekranları,
  - jenerik.
- Her şey yalnızca klavyeyle kullanılır; odak her zaman görünür; tuşlar yeniden atanabilir (Ctrl/Alt/Meta hariç). Ayrıntı: `ui-hud.md`.
- **Varsayılan tuşlar:**
  - W/↑ gaz, S/↓ fren, A/D ←/→ direksiyon,
  - E/Q vites, Space DRS, F ERS sollama, L pit limitörü,
  - C kamera, V geriye bak, R flashback, Esc/P duraklat,
  - Tab MFD, 1–4 MFD seçenekleri, Y yarış çizgisi, H HUD, Backspace ZK turunu yeniden başlat.

## 11. Ses
- Tamamen sentez; oyun içinde müzik yoktur.
- Motor:
  - V6 hibrit karakteri (ateşleme frekansı devir/60·3),
  - turbo, MGU-H ve MGU-K ıslığı,
  - vites kesmesi, ara gaz ve limitör.
  - Kokpitte içeriden, diğer kameralarda dışarıdan duyulur.
- Lastik sesleri: kayma ciyaklaması, kerb gürlemesi, çakıl ve çim.
- Ortam: rüzgâr, yağmur, tribün sesi (start ve sollamalarda coşku).
- 8 yakın rakip araç uzamsal (HRTF) ve doppler etkili duyulur.
- Arayüz sesleri ve pit limitörü bip'leri vardır.
- Ses grafiği OfflineAudioContext'te de kurulabilir; fragman sesi bu yolla replay'den üretilir.
- Ayrıntı: `audio.md`.

## 12. Kalıcılık
- Yerel tarayıcı deposunda (`localStorage`) tutulanlar:
  - ayarlar,
  - son yarış kurulumu,
  - Zamana Karşı kişisel en iyisi (tur ve sektörler),
  - ghost (≈ 75 KB),
  - yerel ilk 10,
  - önbelleğe alınmış rakip ghost.
- Bozuk ya da eski veri sessizce varsayılana döner. Hesap ya da sunucu yoktur.

## 13. Kapsam dışı
- Kariyer, şampiyona, sezon, takım yönetimi.
- Çevrimiçi ya da yerel çok oyunculu, liderlik tablosu sunucusu.
- Hasar modeli, mekanik arıza, yakıt ikmali.
- Güvenlik aracı, VSC, kırmızı bayrak, sıralama turları, formasyon turu.
- Gamepad ve direksiyon seti hedeflenmez (klavye birinci sınıftır).
- Araç kurulumu (setup) ekranı, ikinci pist, mobil dokunmatik kontrol.
- Gerçek marka, takım, pilot ve logo içeriği.

## 14. Başarı ölçütleri
- **Oynanış:** menüden 20 araçlı yarışa ve sonuca, yalnızca klavyeyle, hatasız ulaşılır. QC sürüş hissi maddeleri ≥ 4/5.
- **Fizik ve yapay zekâ:** testing-qc.md eşikleri yeşil. Örnek: d=100 yapay zekâ turu 1:24–1:27, ıslak tur farkları ve pit kaybı 20–24 s.
- **Performans** (RTX 4060 Laptop, 1080p): Ultra ≥ 60 FPS, High ≥ 100 FPS, gece + yoğun yağmur + 20 araç Ultra ≥ 50 FPS. Konsolda hata yok. 5 başlat/çık sonrası sızıntı ±%2 içinde.
- **Arayüz:** web-design-guidelines denetiminde P0 yok. Azaltılmış hareket çalışıyor. Bildirim yükü FPS'i %3'ten az düşürüyor.
- **Görsel:** F1 25 kontrol listesindeki (testing-qc.md §5.3) maddelerde P0/P1 yok.
- **Teslim:** `start.bat` ile menü → yarış çalışıyor. 30 s fragman QC puanlarının hepsi ≥ 8.
