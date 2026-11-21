# HAIRPIN GP — Gizlilik / Privacy

## Türkçe

### Gizlilik özeti

HAIRPIN GP ücretsiz bir hobi oyunudur. Hesap açılmaz; takma ad kullanılır. Gerçek adını veya başka kişisel bilgileri paylaşma. Statik sayfada ve doğrudan (eşler arası) odalarda oyun verisini saklayan bir sunucu yoktur; veriler tarayıcıda kalır ve yalnızca odadaki oyuncularla paylaşılır. İsteğe bağlı topluluk sunucusunu onu işleten kişi yönetir; proje sahibinin test sunucusunda günlükler ve denetim kayıtları 14 günlük politikayla, yasak kayıtları süreleri boyunca tutulur. Reklam veya analiz aracı yoktur. Çocuklardan bilerek kişisel veri toplanmaz. Oyun içinde iletişim formu yoktur; hata bildirimi ve başvurular proje deposunun Issues sayfasından yapılır. Ayrıntılar KVKK ve yerel depolama sekmelerinde de bulunur.

### Veri sorumlusu ve kapsam

6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) md. 10 kapsamında veri sorumlusu: Mert Aktaş. Başvuru / iletişim kanalı: proje deposunun (GitHub) Issues sayfası.

### İşlenen veriler ve toplama yöntemi

Veriler tarayıcı üzerinden elektronik olarak işlenir. Ayarlar, rekorlar, hayalet turlar, özel takımlar ve rastgele cihaz kimliği yalnızca tarayıcının localStorage alanında (apexgp:v1:* anahtarları) durur. Sayfa statik olarak (ör. GitHub Pages) sunulduğunda oyunun kendi sunucusu yoktur ve hiçbir veri bir oyun sunucusunda saklanmaz. Çevrim içi oynamanın iki yolu vardır. (1) Doğrudan (eşler arası) odalar: oda sahibinin tarayıcısı sunucu gibi çalışır; takma ad, oda ve yarış verileri, bağlantı belirteçleri ve cihaz kimliği yalnızca odadaki oyuncuların tarayıcıları arasında (WebRTC) akar. (2) İsteğe bağlı topluluk sunucusu: adresini oyuncunun kendisinin yazdığı, onu işleten kişinin yönettiği bir sunucudur; takma ad, oda ve yarış verileri, bağlantı / yeniden bağlanma belirteçleri ve cihaz kimliği bu sunucuya gider. Takma ad ve yarış bilgileri odadaki oyunculara; herkese açık oda listesinde oda sahibinin takma adı ve oda bilgileri diğer oyunculara görünür. Özel odalar listelenmez; kodu bilenler katılabilir. Hesap veya kalıcı oyuncu profili tutulmaz.

### Teknik ve yönetici verileri

Doğrudan odalarda IP adresiniz odadaki oyunculara (özellikle oda sahibine) görünebilir; davet ve cevap kodları da ağ adresleri içerir, bu yüzden kodları yalnızca birlikte oynayacağınız kişilerle paylaşın. Bağlantı yolunu bulmak için ücretsiz, herkese açık STUN sunucularına (stun.l.google.com, stun.cloudflare.com) adres sorgusu gönderilir; bu sunucular IP adresinizi görür, oyun verisi onlardan geçmez. Derleme VITE_P2P_SIGNAL_URL ile yapılmışsa isteğe bağlı bir eşleştirme posta kutusu kullanılır: 6 karakterli oda kodu, davet / cevap kodları ve rastgele sayfa anahtarının tek yönlü özeti en çok 5 dakika saklanır; posta kutusu IP adresini kaydetmez. Bir topluluk sunucusuna bağlanırsanız o sunucu IP adresinizi görür ve yalnızca bağlantı ve kötüye kullanımı önleme sınırları için bellekte tutar. Proje sahibinin kendi test sunucusunda günlüklerde tam IP veya okunabilir ağ öneki bulunmaz: IPv4 /24 veya IPv6 /64 ağından, her sunucu başlangıcında değişen tuzla SHA-256 kullanılarak 12 haneli ağ etiketi üretilir. Aynı sunucuda engel kayıtları (ayrı tuzla özetlenen cihaz / bağlantı belirteci / ağ kimliği, takma ad, gerekçe, süre) ile yönetici panelinde kimlik doğrulama ve oturum bilgileri; giriş, başarısız giriş ve yönetim işlemlerinin zaman / olay / tuzlanmış ağ özeti gibi denetim kayıtları işlenir. Başka bir topluluk sunucusu farklı veri işleyebilir; onun sorumlusu onu işleten kişidir.

### Başvuru ve hata bildirimi

Oyunun içinde iletişim formu yoktur ve oyun hiçbir sunucuya iletişim mesajı göndermez. Hata bildirimleri, öneriler, hak ihlali / kaldırma talepleri ve KVKK başvuruları proje deposunun (GitHub) Issues sayfasından yapılır. Issues herkese açıktır ve GitHub tarafından kendi koşulları ve gizlilik politikası kapsamında işlenir; bu nedenle kişisel bilgi, e-posta adresi veya kimlik bilgisi yazmayın. Başvurular yayıncı tarafından okunur; yanıt verilmesi garanti edilmez.

### Amaçlar ve hukuki sebepler

Odaya katılma, yarış ve bağlantı hizmetinin sunulması için md. 5/2-c (sözleşmenin ifası); güvenlik, kötüye kullanım / spam önleme, hata ve önerilerin incelenmesi, moderasyon ve yönetim denetimi için temel haklara zarar vermemek kaydıyla md. 5/2-f (meşru menfaat); gerektiğinde kanuni taleplerin yerine getirilmesi için md. 5/2-ç (hukuki yükümlülük) esas alınır. Reklam, analiz veya takip amacıyla işleme yapılmaz.

### Aktarım

Sayfayı sunan GitHub Pages (GitHub), ziyaret sırasında standart istek verilerini (ör. IP adresi, tarayıcı bilgisi, zaman) kendi politikasına göre işleyebilir ve günlüğe alabilir; bunlara yayıncı olarak erişimimiz yoktur. Doğrudan odalarda oyun verisi yalnızca odadaki oyunculara iletilir; bağlantı kurmak için kullanılan herkese açık STUN sunucuları (Google, Cloudflare) IP adresinizi görür ve yurt dışında olabilir. Bir topluluk sunucusuna bağlanırsanız verileriniz o sunucuyu işleten kişiye ve onun barındırma / bağlantı sağlayıcılarına gider; proje sahibinin test sunucusunda bu, Oracle Cloud veya Cloudflare gibi yurt dışındaki barındırma / tünel sağlayıcıları olabilir. Yurt dışı aktarım koşulları KVKK md. 9 kapsamında yayıncı tarafından değerlendirilip uygulanmalıdır; bu metin tek başına aktarım izni veya rıza oluşturmaz.

### Saklama süreleri

Statik sayfada ve doğrudan odalarda oyun verisini saklayan bir sunucu yoktur: oda durumu yalnızca oda açıkken oda sahibinin tarayıcısının belleğindedir. Tarayıcıdaki veriler siz silene kadar kalır; sessionStorage’daki yeniden bağlanma belirteci odadan çıkınca silinir. İsteğe bağlı eşleştirme posta kutusu kayıtları en çok 5 dakika saklanır. Proje deposundaki Issues kayıtları, yazarı veya yayıncı silene kadar GitHub üzerinde kalır. Proje sahibinin test sunucusunda: oda / yarış ve bağlantı durumu oturum için bellekte tutulur; sunucu günlükleri sistem günlüğünde 14 günlük politikayla (silme günlük döndürme sırasında dosya düzeyindedir), denetim kayıtları 14 gün saklanır; yasak kayıtları süreleri boyunca veya yönetici kaldırana kadar, kalıcı yasaklar kaldırılana kadar tutulur; yönetici oturumu 30 dakika hareketsizlikte veya en geç 8 saatte sona erer. Başka topluluk sunucularının saklama süreleri o sunucuyu işleten kişiye aittir.

### KVKK md. 11 hakları ve başvuru yolu

Kişisel verilerinizin işlenip işlenmediğini öğrenme; işlenmişse bilgi isteme; amaç ve amaca uygun kullanımı, yurt içi / dışı alıcıları öğrenme; eksik veya yanlış verilerin düzeltilmesini, şartları oluştuğunda silme / yok etmeyi ve bu işlemlerin alıcılara bildirilmesini isteme; yalnızca otomatik analizle aleyhinize sonuç oluşmasına itiraz etme ve hukuka aykırı işleme nedeniyle zararın giderilmesini talep etme haklarınız vardır. Veri talebinizi proje deposunun Issues sayfasından iletebilirsiniz. Issues herkese açıktır; kişisel bilgi, kimlik veya iletişim bilgisi yazmayın.

### Çerezler

Oyun reklam, analiz veya takip çerezi kullanmaz. Tek çerez, yalnızca yönetici paneline giriş yapan yönetici için kesinlikle gerekli __Host-hpadmin oturum çerezidir: HttpOnly, Secure ve SameSite=Strict. 30 dakika hareketsizlikte veya en geç 8 saatte oturum sona erer. Normal oyunculara bu çerez verilmez.

### Tarayıcıda tutulan veriler

Ayarlar (klavye, kumanda ve dokunmatik kontrol ayarları dahil), kişisel rekorlar, hayalet turlar, son yarış kurulumu, özel takımlar, son ses seviyesi ve rastgele cihaz kimliği localStorage içinde tutulur. Bunlar çerez değildir. sessionStorage içindeki apex.net.resume çevrim içi yeniden bağlanma belirtecidir; odadan çıkınca silinir. Aşağıdaki apexgp:v1:* anahtarlarında [pist] ve [yapı] değişken bölümlerdir.

### Tarayıcıda tutulan veriler

apexgp:v1:settings · apexgp:v1:settingsMeta · apexgp:v1:lastRaceSetup · apexgp:v1:tt:[pist] · apexgp:v1:ghost:[pist]:pb · apexgp:v1:rivalGhost:[pist]:[yapı] · apexgp:v1:customTeams · apexgp:v1:lastMaster · apexgp:v1:deviceId

### Yerel verileri silme

Tarayıcının site verileri ayarlarından silebilirsiniz. Oyun Hakkında ekranının Çerezler ve Yerel Depolama sekmesindeki düğme onaydan sonra bu sekmede erişilebilen localStorage ve sessionStorage alanlarındaki tüm apexgp:v1:* anahtarlarını siler. Diğer anahtarlar, yönetici çerezi ve sunucudaki mesajlar / yasaklar silinmez. Başka açık sekmelerin oturum verilerini ayrıca silmelisiniz.

## English

### Privacy summary

HAIRPIN GP is a free hobby game. There are no accounts; use a nickname. Do not share your real name or other personal information. On the static page and in direct (peer-to-peer) rooms there is no server that stores game data; data stays in your browser and is shared only with the players in the room. An optional community server is managed by whoever operates it; on the project owner’s test server, logs and audit records follow a 14-day policy and ban records remain for their duration. There are no advertising or analytics tools. Children’s personal data is not knowingly collected. There is no in-game contact form; reports and applications go through the Issues page of the project repository. See the KVKK and local storage tabs for details.

### Controller and scope

Under Article 10 of Turkish Personal Data Protection Law No. 6698 (KVKK), the controller is: Mert Aktaş. Application / contact channel: the Issues page of the project repository (GitHub).

### Data processed and collection methods

Data is processed electronically through the browser. Settings, records, ghost laps, custom teams and a random device identifier stay only in the browser’s localStorage (apexgp:v1:* keys). When the page is served statically (for example on GitHub Pages) the game has no server of its own and no data is stored on a game server. There are two ways to play online. (1) Direct (peer-to-peer) rooms: the host’s browser acts as the server; nicknames, room and race data, connection tokens and the device identifier flow only between the browsers of the players in the room (WebRTC). (2) An optional community server: a server whose address the player types in and which is run by whoever operates it; nicknames, room and race data, connection / reconnection tokens and the device identifier are sent to that server. Nicknames and race information are shared with players in the room; public room listings show the owner nickname and room details to other players. Private rooms are unlisted and accessible to anyone with the code. There are no accounts or persistent player profiles.

### Technical and administrator data

In direct rooms your IP address may be visible to the players in the room (especially the host); invite and answer codes also contain network addresses, so share them only with the people you play with. To find a connection path, address queries are sent to free public STUN servers (stun.l.google.com, stun.cloudflare.com); they see your IP address, but no game data passes through them. If the build was made with VITE_P2P_SIGNAL_URL, an optional pairing mailbox is used: the 6-character room code, the invite / answer codes and a one-way hash of a random page key are stored for at most 5 minutes; the mailbox does not record IP addresses. If you connect to a community server, that server sees your IP address and holds it only in memory for connection and abuse limits. On the project owner’s own test server, logs contain neither full IP addresses nor readable prefixes: a 12-character tag is derived with SHA-256 from the IPv4 /24 or IPv6 /64 network and a salt renewed on server restart. On the same server, ban records (separately salted device / connection token / network hashes, nickname, reason, duration) and, in the administrator panel, authentication and session data plus audit records of logins, failed logins and administrative actions (timestamps, events, salted network hashes) are processed. Another community server may process different data; its operator is responsible for it.

### Reporting and applications

There is no in-game contact form and the game sends no contact messages to any server. Bug reports, suggestions, takedown requests and KVKK applications go through the Issues page of the project repository (GitHub). Issues are public and are processed by GitHub under its own terms and privacy policy, so do not post personal information, an email address or identity details. Submissions are read by the publisher; a reply is not guaranteed.

### Purposes and legal grounds

Article 5/2-c (performance of a contract) supports joining rooms, racing and connectivity; Article 5/2-f (legitimate interests, subject to fundamental rights) supports security, abuse / spam prevention, reviewing bugs and suggestions, moderation and administrative auditing; Article 5/2-ç (legal obligations) applies where required to fulfil statutory requests. No advertising, analytics or tracking processing is performed.

### Transfers

GitHub Pages (GitHub), which serves the page, may process and log standard request data (for example IP address, browser information and time) under its own policy; the publisher has no access to it. In direct rooms game data goes only to the players in the room; the free public STUN servers used to connect (Google, Cloudflare) see your IP address and may be abroad. If you connect to a community server, your data goes to whoever operates it and to its hosting / connectivity providers; on the project owner’s test server these may be overseas hosting or tunnel providers such as Oracle Cloud or Cloudflare. The publisher must assess and implement overseas transfer requirements under KVKK Article 9; this notice alone does not constitute transfer permission or consent.

### Retention periods

On the static page and in direct rooms there is no server that stores game data: room state exists only in the host’s browser memory while the room is open. Data in your browser stays until you delete it; the reconnection token in sessionStorage is removed when you leave the room. Records in the optional pairing mailbox are kept for at most 5 minutes. Issues on the project repository remain on GitHub until their author or the publisher deletes them. On the project owner’s test server: room / race and connection state is held in memory for the session; server logs follow a 14-day policy in the system journal (removal occurs at file level during rotation) and audit records are kept for 14 days; ban records remain for their duration or until administrator removal, and permanent bans remain until removed; administrator sessions expire after 30 minutes idle or at most 8 hours. Other community servers set their own retention periods through whoever operates them.

### KVKK Article 11 rights and applications

You may learn whether your data is processed; request information; learn the purpose, appropriate use and domestic / overseas recipients; request correction of incomplete or inaccurate data, deletion / destruction when applicable and notification of those actions to recipients; object to adverse outcomes based solely on automated analysis; and claim compensation for unlawful processing. Submit a data request through the Issues page of the project repository. Issues are public; do not post personal information, identity or contact details.

### Cookies

The game uses no advertising, analytics or tracking cookies. The only cookie is __Host-hpadmin, strictly necessary for administrators who sign in to the administrator panel: HttpOnly, Secure and SameSite=Strict. Sessions expire after 30 minutes idle or at most 8 hours. Ordinary players do not receive this cookie.

### Data stored in your browser

Settings (including keyboard, gamepad and touch control settings), personal records, ghost laps, the last race setup, custom teams, the last sound level and a random device identifier are stored in localStorage. These are not cookies. The apex.net.resume key in sessionStorage is an online reconnection token, removed when leaving the room. In the apexgp:v1:* keys below, [track] and [build] are variable parts.

### Data stored in your browser

apexgp:v1:settings · apexgp:v1:settingsMeta · apexgp:v1:lastRaceSetup · apexgp:v1:tt:[track] · apexgp:v1:ghost:[track]:pb · apexgp:v1:rivalGhost:[track]:[build] · apexgp:v1:customTeams · apexgp:v1:lastMaster · apexgp:v1:deviceId

### Deleting local data

Use your browser site-data settings, or the button on the Cookies and Local Storage tab in About. After confirmation it removes all apexgp:v1:* keys from localStorage and sessionStorage accessible in this tab. Other keys, the administrator cookie and server messages / bans are not deleted. Clear session data in other open tabs separately.

Bu metin bilgilendirme amaçlıdır; yayından önce bir hukukçuya kontrol ettirilmesi önerilir.

Uygulama kaynakları: `server/src/privacy.ts`, `server/src/contact/**`, `server/src/admin/**`, `server/deploy/oracle/PRIVACY.md`. Oyun içi metin: `src/ui/i18n/credits.{tr,en}.ts`. Veri sorumlusu ve iletişim yer tutucularını yayıncı doldurmalıdır.
