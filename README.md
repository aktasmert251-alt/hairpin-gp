# HAIRPIN GP

**Türkçe** · [English](README.en.md)

**Oyna:** https://aktasmert251-alt.github.io/hairpin-gp/

HAIRPIN GP, tarayıcıda çalışan, ücretsiz bir yarış oyunudur (three.js). Kurulum gerekmez; Chrome veya Edge ile açılır. Oyundaki takımlar, sürücüler, sponsorlar ve logolar tamamen **kurgusaldır**; gerçek bir marka, takım veya kişiyle ilgisi yoktur.

## Özellikler

- **Zamana karşı** (hayalet tur ile) ve **hızlı yarış** (yapay zekâ rakipler, zorluk ayarı)
- Hava durumu (kuru, yağmur), gün / gün batımı / gece; güvenlik aracı, cezalar, pit stop, geri sarma
- **Çevrim içi:** herkesin kendi tarayıcısında oda kurabildiği, davet koduyla katılınan doğrudan (eşler arası) odalar; özel takımlar yalnızca çevrim içi modda
- Klavye (varsayılan), Xbox tipi kumanda ve telefonda dokunmatik kontroller
- Türkçe ve İngilizce arayüz, ayarlanabilir grafik kalitesi

## Pistler

İstanbul Circuit · Lombardiya Park Circuit · Boğaz Sahil Circuit · Ardenler Orman Circuit · Alp Dağ Geçidi · Eifel Orman Ring (20 km) · Kapadokya Vadisi Circuit · Çöl Uçurumu Circuit · Ege Adalar Circuit · Ecelle Dans – Volkan Ağzı

Bazıları gerçek coğrafyadan esinlenmiştir (OpenStreetMap verisi, ODbL), bazıları özgün tasarımdır. Ayrıntı: oyun içi **Oyun Hakkında** ekranı.

## Kontroller (klavye)

| Eylem | Tuş |
|---|---|
| Gaz / Fren | W, S veya Yukarı, Aşağı ok |
| Direksiyon | A, D veya Sol, Sağ ok |
| Vites yukarı / aşağı | E / Q |
| DRS | Boşluk |
| ERS hamlesi | F |
| Pit hız sınırlayıcı | L |
| Kamera / Arkaya bak | C / V |
| Geri sarma | R |
| Duraklat | Esc veya P |

Tuşlar ve kumanda **Ayarlar > Kontroller** bölümünden değiştirilir. Telefonda yatay tutun; dokunmatik kontroller otomatik açılır.

## Çevrim içi odalar

1. Oda kuran: **Çevrim içi → Oda kur → Arkadaş davet et → Yeni davet kodu** ile bir davet hazırlar ve **WhatsApp ile gönder** düğmesine basar (davet, tıklanabilir bir bağlantı olarak gider).
2. Katılan: bağlantıya dokunur; oyun açılır ve davet kendiliğinden dolar. Takma adını yazınca cevap otomatik hazırlanır; **WhatsApp ile gönder** ile oda sahibine bağlantı olarak yollar.
3. Oda kuran, cevap bağlantısına **odanın açık olduğu tarayıcıda** dokunur; cevap oda sekmesine kendiliğinden iletilir ve bağlantı kurulur. Hiçbir şey yapıştırılmaz.

Bağlantı yerine kod kullanmak istersen davet ve cevap kodlarını kopyalayıp yapıştırabilirsin.

Oda, kuran kişinin tarayıcısında çalışır; oyunun bir sunucusu yoktur. Doğrudan bağlantıda IP adresiniz odadaki oyunculara görünebilir. Bazı ağlarda (katı güvenlik duvarı, mobil veri) bağlantı kurulamayabilir. Ayrıntı: [docs/design/multiplayer-p2p.md](docs/design/multiplayer-p2p.md).

## Geliştirme

Node.js >= 24 gerekir.

```
npm install
npm run dev          # geliştirme sunucusu
npm run typecheck    # TypeScript denetimi
npm test             # birim ve mimari testleri
npm run build        # üretim derlemesi (dist/)
```

Belgeler: [mimari](docs/ARCHITECTURE.md), [kararlar](docs/sprints/DECISIONS.md), [tasarım notları](docs/design).

## Lisans ve gizlilik

Tüm hakları saklıdır (bkz. [LICENSE](LICENSE)). Kaynak kod incelenebilir; izinsiz kopyalanamaz, değiştirilip yeniden dağıtılamaz. Üçüncü taraf bileşenler kendi lisanslarına tabidir: [CREDITS.md](CREDITS.md), [THIRD-PARTY-LICENSES](public/THIRD-PARTY-LICENSES.txt). Gizlilik ve KVKK metinleri oyun içinde (**Oyun Hakkında**) ve [docs/legal](docs/legal) klasöründedir. Hata bildirimi ve veri başvurusu için bu deponun **Issues** sayfasını kullanın.

---

## English

Full English README: [README.en.md](README.en.md).

HAIRPIN GP is a free racing game that runs in the browser (three.js). **Play:** https://aktasmert251-alt.github.io/hairpin-gp/ — no install; use Chrome or Edge. All teams, drivers, sponsors and logos are fictional.

Ten circuits, solo quick race and time trial with ghosts, weather and time of day, safety car, penalties, pit stops, flashback. Online play uses direct peer-to-peer rooms created from a player's own browser by exchanging invite codes (your IP address is visible to the players in the room). Keyboard is the default; gamepad and touch controls are available. Use the repository's **Issues** page to report bugs or privacy requests. All rights reserved (see LICENSE); third-party components keep their own licences (CREDITS.md).
