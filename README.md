# Movie Tracker

Film/dizi izleme günlüğü. **Sıfır bağımlılık**: harici hiçbir npm paketi yok.

- **Frontend:** saf HTML5, CSS3 (Grid/Flexbox, CSS değişkenleri), Vanilla JS (ES Modules, Fetch API)
- **Backend:** yalnızca yerleşik Node.js modülleri — `node:http`, `node:fs`, `node:path`, `node:crypto`, `node:sqlite`, `node:url`
- **Veritabanı:** `node:sqlite` (`DatabaseSync`), tüm sorgular prepared statement
- **Dış servis:** TMDb API v3 — anahtar yalnızca sunucuda tutulur, istemciye sızmaz

## Gereksinimler

Node.js **v22.5+** (önerilen: v24+). `node:sqlite` modülü bu sürümlerde yerleşik gelir,
ek bir flag gerekmez.

```bash
node --version
```

## Kurulum

```bash
# 1) Ortam dosyasını hazırla
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env

# 2) .env içindeki TMDB_API_KEY alanını doldur
#    (https://www.themoviedb.org/settings/api)

# 3) Sunucuyu başlat  (npm install gerekmez, bağımlılık yok)
npm start                 # veya: node src/server.js
npm run dev               # dosya değişiminde otomatik yeniden başlatma
```

Ardından: <http://127.0.0.1:3000>

İlk açılışta `data/movie-tracker.sqlite` dosyası otomatik oluşturulur ve şema
migrasyonları uygulanır. Sıfırdan başlamak için: `npm run db:reset`.

## Proje yapısı

```
.
├── public/                 # İstemci tarafı (statik olarak sunulur)
│   ├── index.html          # Uygulama kabuğu (içerik JS ile üretilir)
│   ├── assets/
│   │   ├── favicon.svg
│   │   └── fonts/          # Kendi sunucumuzdan servis edilen woff2'ler (OFL 1.1)
│   ├── styles/main.css     # Tek stil dosyası (CSS değişkenleri + Grid/Flex)
│   └── scripts/            # ES module'ler
│       ├── app.js          # Önyükleyici: oturum, adres çubuğu, görünüm geçişleri
│       ├── api.js          # Fetch sarmalayıcı + ApiError
│       ├── dom.js          # el() / clear() / debounce() — innerHTML kullanılmaz
│       ├── card.js         # Poster kartları, iskelet yükleyici, boş durumlar
│       ├── stars.js        # Yarım yıldız puanlama (görüntü + giriş)
│       ├── modal.js        # Modal + odak tuzağı + onay diyaloğu
│       ├── toast.js        # Bildirimler
│       ├── auth-view.js    # Giriş / kayıt ekranı
│       ├── landing-view.js # Karşılama (oturum yokken)
│       ├── legal-view.js   # Gizlilik bildirimi ve kullanım koşulları
│       ├── stats-view.js   # Özet: sayılar, türler, yıllar
│       ├── entry-form.js   # Ekleme & düzenleme formu (409 akışı dahil)
│       ├── library-view.js # Günlüğüm: filtreler, grid, sayfalama
│       └── discover-view.js# Keşfet: TMDb arama, detay modalı
├── src/
│   ├── server.js           # HTTP çekirdeği: yönlendirme, statik sunum, hata yönetimi
│   ├── config.js           # .env ayrıştırıcı + yapılandırma
│   ├── db/
│   │   ├── index.js        # Bağlantı, PRAGMA'lar, migrasyon çalıştırıcı, transaction
│   │   ├── migrations.js   # Sürüm listesi (PRAGMA user_version ile takip)
│   │   ├── schema.sql      # v1 şeması
│   │   ├── v2-remove-dropped-status.sql  # v2: "Bırakıldı" durumunun kaldırılması
│   │   └── reset.js        # Geliştirme: veritabanını sil
│   ├── lib/
│   │   ├── http.js         # JSON yanıt, gövde okuma, çerez, HttpError
│   │   ├── router.js       # Kalıp → RegExp yönlendirici (`/api/entries/:id`)
│   │   ├── static.js       # MIME eşleme + path traversal koruması
│   │   └── logger.js
│   └── routes/
│       └── index.js        # Rota kayıt noktası
├── scripts/
│   ├── reset-password.mjs  # Yönetici aracı: şifre sıfırla + oturumları düşür
│   └── test-*.mjs          # Uçtan uca test paketleri
└── data/                   # SQLite dosyası (git'e girmez)
```

## Veritabanı şeması (v2)

| Tablo          | Amaç                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `users`        | Kullanıcılar; `scrypt` + rastgele salt ile hash'lenmiş şifreler       |
| `sessions`     | Sunucu taraflı oturumlar; çerezde yalnızca rastgele `session_id`      |
| `entries`      | İzleme günlüğü kayıtları (durum, puan, yorum, izleme tarihi)          |
| `entry_genres` | Kayıt ↔ TMDb türü ilişkisi (tür filtresi ve filtre menüsü için)       |
| `tmdb_cache`   | TMDb yanıtlarının kısa süreli önbelleği (kota tasarrufu)              |

Detaylı açıklamalar ve kısıtlar için `src/db/schema.sql` dosyasına bakın.

Şema sürümü `PRAGMA user_version` ile takip edilir; uygulanmış migrasyonlar hiç
değiştirilmez, değişiklikler yeni bir sürüm dosyasıyla gelir:

| Sürüm | Dosya                          | İçerik                                                                    |
| ----- | ------------------------------ | ------------------------------------------------------------------------- |
| v1    | `schema.sql`                   | Başlangıç şeması                                                          |
| v2    | `v2-remove-dropped-status.sql` | `status` yalnızca `watched`/`watchlist`; eski `dropped` kayıtları silinir |

## Güvenlik önlemleri

- **SQL Injection:** istisnasız tüm sorgular `db.prepare(...)` + bağlı parametre
- **Şifreler:** `crypto.scryptSync` + kullanıcıya özel 16 baytlık salt; karşılaştırma `timingSafeEqual`
- **Oturum çerezi:** `HttpOnly; SameSite=Strict; Path=/` (+ production'da `Secure`)
- **Path Traversal:** yüzde-çözümü → NUL baytı reddi → `path.normalize`/`resolve` → `public/` içinde olma doğrulaması
- **İstek gövdesi:** 1 MB üst sınır, bozuk JSON `try-catch` ile 400'e çevrilir
- **Başlıklar:** `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- **API anahtarı:** yalnızca sunucu belleğinde; istemci `/api/tmdb/*` proxy'sini kullanır
- **İstemci IP'si:** `X-Forwarded-For` yalnızca `TRUST_PROXY=true` iken okunur — aksi halde
  istemci bu başlığı uydurup her istekte temiz bir hız sınırı kovası açabilirdi
- **Davet kodu:** `timingSafeCompare` ile SHA-256 özetleri üzerinden sabit sürede karşılaştırılır

## API

| Yöntem | Adres                | Gövde / Açıklama                                              |
| ------ | -------------------- | ------------------------------------------------------------- |
| GET    | `/api/health`        | Sunucu/veritabanı/TMDb yapılandırma durumu                    |
| POST   | `/api/auth/register` | `{ username, password, email?, displayName?, inviteCode? }` → 201 + oturum |
| POST   | `/api/auth/login`    | `{ username, password }` → 200 + oturum çerezi                |
| POST   | `/api/auth/logout`   | 204, oturumu veritabanından siler ve çerezi temizler          |
| GET    | `/api/auth/me`       | Oturum yoksa `{ user: null }` (401 değil) + `registration.mode` |
| POST   | `/api/auth/password` | `{ currentPassword, newPassword }`, diğer oturumları düşürür  |
| DELETE | `/api/auth/account`  | `{ username, password }` → hesabı ve günlüğü siler, `204`     |

`inviteCode` yalnızca `REGISTRATION_MODE=invite` iken zorunludur. `/api/auth/me`
yanıtındaki `registration.mode` giriş ekranının "Kayıt ol" sekmesini ve davet kodu
alanını çizmek için kullanılır; kodun kendisi istemciye asla gönderilmez.

TMDb proxy uçları (**tümü oturum gerektirir** — API anahtarının serbest kullanımını engellemek için):

| Yöntem | Adres                          | Açıklama                                                     |
| ------ | ------------------------------ | ------------------------------------------------------------ |
| GET    | `/api/tmdb/search`             | `?query=matrix&type=multi\|movie\|tv&page=1`                 |
| GET    | `/api/tmdb/trending`           | `?window=week\|day` — arama kutusu boşken keşif listesi      |
| GET    | `/api/tmdb/:mediaType/:tmdbId` | Detay: tür, süre, sezon/bölüm sayısı, ilk 10 oyuncu          |

İzleme günlüğü uçları (tümü oturum gerektirir, her kullanıcı yalnızca kendi kayıtlarına erişir):

| Yöntem | Adres                  | Açıklama                                                       |
| ------ | ---------------------- | -------------------------------------------------------------- |
| GET    | `/api/entries`         | Filtreleme + sıralama + sayfalama (aşağıdaki parametreler)     |
| GET    | `/api/entries/genres`  | Kullanıcının günlüğündeki türler + kayıt sayıları (filtre menüsü) |
| GET    | `/api/entries/stats`   | Özet: sayılar, izlenen türler, yıllar, en yüksek puanlar       |
| GET    | `/api/entries/export`  | Tüm günlük. `?format=json` (varsayılan) veya `csv`             |
| POST   | `/api/entries`         | Yeni kayıt; içerik zaten varsa `409` + `details.existingEntryId` |
| GET    | `/api/entries/:id`     | Tek kayıt                                                      |
| PATCH  | `/api/entries/:id`     | Kısmi güncelleme; `null` göndermek alanı temizler              |
| DELETE | `/api/entries/:id`     | `204`                                                          |

`GET /api/entries` sorgu parametreleri:

| Parametre               | Değerler                                                    |
| ----------------------- | ----------------------------------------------------------- |
| `status`                | `watched` \| `watchlist`                                    |
| `mediaType`             | `movie` \| `tv`                                             |
| `genreId`               | TMDb tür kimliği (örn. `18`)                                |
| `minRating`/`maxRating` | 1-10                                                        |
| `unrated`               | `true` — yalnızca puanlanmamışlar                           |
| `favorite`              | `true`                                                      |
| `search`                | Başlıkta/özgün başlıkta metin araması                       |
| `sort`                  | `updated` \| `created` \| `rating` \| `title` \| `watched` \| `year` |
| `order`                 | `asc` \| `desc`                                             |
| `page` / `limit`        | `limit` en fazla 100 (varsayılan 24)                        |

Kayıt alanları: `tmdbId`, `mediaType`, `title`, `originalTitle`, `overview`, `posterPath`,
`releaseYear`, `status`, `rating` (1-10, yarım yıldız adımlarıyla), `review`, `watchedAt`
(`YYYY-MM-DD`, gelecek tarih kabul edilmez), `favorite`, `genres` (`[{ id, name }]`).

### Kurallar ve limitler

- Kullanıcı adı: 3-32 karakter, `a-z A-Z 0-9 . _ -`
- Şifre: en az 8 karakter, kullanıcı adıyla aynı olamaz
- Giriş: aynı IP + kullanıcı adı için 15 dakikada 10 başarısız deneme (aşılırsa 429 + `Retry-After`)
- Giriş: kullanıcı adından bağımsız olarak IP başına 15 dakikada 60 deneme — kullanıcı
  adını değiştirerek sınırı aşmayı ve `scrypt` ile CPU tüketmeyi engeller, başarılı
  girişte sıfırlanmaz
- Kayıt: IP başına saatte 20 deneme / 5 oluşturulan hesap

## Canlıya alma

Uygulama uzun ömürlü bir Node süreci ve yazılabilir bir disk ister; sunucusuz
platformlarda (Vercel, Netlify) çalışmaz. Kendi sunucunuzda şu ayarlar gerekir:

| Değişken            | Canlı değer            | Neden                                                            |
| ------------------- | ---------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`          | `production`           | Erişim logları, üretim önbellek başlıkları, `Secure` çerez        |
| `TRUST_PROXY`       | `true`                 | Ters proxy arkasındaysanız; **yoksa açmayın**                     |
| `REGISTRATION_MODE` | `invite` veya `closed` | Herkese açık bırakmak yabancıların TMDb kotanızı harcaması demek  |
| `INVITE_CODE`       | uzun rastgele değer    | `invite` modunda zorunlu                                          |
| `HOST`              | `127.0.0.1`            | Proxy aynı makinedeyse; konteynerde `0.0.0.0`                     |

Oturum çerezi üretimde `Secure` işaretlendiği için **HTTPS zorunludur**: düz HTTP
üzerinde tarayıcı çerezi hiç göndermez ve giriş sessizce başarısız olur. En kısa yol
Caddy:

```caddyfile
gunluk.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy sertifikayı kendi alır, yeniler ve `X-Forwarded-For` başlığını kendisi yazar.
HTTPS'in bulunmadığı bir iç ağda yayın yapıyorsanız `COOKIE_SECURE=false` ile bilinçli
olarak kapatabilirsiniz.

Hatalı yapılandırma canlıda değil **açılışta** yakalanır: geçersiz `REGISTRATION_MODE`,
kodsuz `invite` modu veya `TRUST_PROXY=ture` gibi bir yazım hatası sunucuyu başlatmaz.

### Şifre sıfırlama

"Şifremi unuttum" akışı yok (e-posta göndermek harici bir servis gerektirirdi). Şifreyi
sunucuya erişebilen kişi sıfırlar; işlem kullanıcının tüm oturumlarını düşürür:

```bash
npm run reset-password -- kullaniciadi              # rastgele şifre üretir ve yazdırır
npm run reset-password -- kullaniciadi YeniSifre123 # belirli bir şifre atar
```

## Testler

Harici test kütüphanesi yok; `node:assert` + `fetch` ile yazılmış duman testleri:

```bash
npm start                                   # 1. terminal
npm run test:auth -- http://127.0.0.1:3000  # 2. terminal
npm run test:tmdb -- http://127.0.0.1:3000  # gerçek TMDb API'sine çıkar
npm run test:entries -- http://127.0.0.1:3000
```

Her koşuda benzersiz kullanıcı adı üretildiği için testler veritabanını temizlemeyi gerektirmez.

İstemci kodu tarayıcıda çalıştığı için Node'da test edilemez; onun yerine statik denetim var
(söz dizimi, modüller arası `import`/`export` tutarlılığı ve `innerHTML` kullanımı):

```bash
npm run check:frontend
```

## Arayüz

### Tema: "Sinema Salonu"

Afişler zaten doygun renklidir, bu yüzden arayüz nötr kömür tonlarında kalır ve
tek vurgu rengi olarak sıcak altın (`#e8b84b`) kullanılır — ekrandaki tek renk
kaynağı içeriğin kendisi olur.

- **Tipografi:** başlıklarda Instrument Serif, arayüz metninde Inter, künye
  etiketlerinde (durum, tür, tarih) sistem monospace. Fontlar `public/assets/fonts`
  altından kendi sunucumuzca servis edilir; harici istek ve npm paketi yoktur.
- **Doku:** tek bir SVG `feTurbulence` data-URI'siyle üretilen film greni ve
  ekran kenarlarını koyulaştıran vinyet.
- **Kartlar:** bilet koçanı formunda — alt şeritte izleme tarihi, koparma
  çizgisinde kartın `overflow` sınırıyla kırpılan yarım daire delik izleri.
- **Renk değişkenleri:** tema tamamen `:root` altındaki değişkenlerden beslenir,
  başka bir palete geçmek için tek blok yeterlidir.

### Ekranlar

- **Karşılama:** oturum yokken ürünün ne olduğu. Adresler: `/`, `/giris`, `/kayit`
- **Gizlilik ve koşullar:** `/gizlilik`, `/kosullar`. İletişim adresi `CONTACT_EMAIL` ile gelir
- **Giriş / Kayıt:** tek kartta sekmeli form; sunucudan gelen alan bazlı hatalar ilgili alanın altına yazılır
- **Günlüğüm** (`/gunluk`): Tümü / İzlendi / İzlenecek / Favoriler sekmeleri, tür ve sıralama menüleri, metin arama, sayfalama
- **Keşfet** (`/kesfet`): TMDb arama (400 ms debounce), haftanın öne çıkanları, detay modalı (süre, sezon, oyuncular)
- **Özet** (`/ozet`): izlenen, izlenecek, favori, ortalama puan, tür dağılımı, yıllar. Günlük JSON veya CSV indirilir
- **Hesap silme:** şifre ve kullanıcı adı onayıyla hesap ve günlük kalkar
- **Kayıt formu:** durum seçici, yarım yıldız puanlama (fare + klavye), izleme tarihi, not, favori
- **Erişilebilirlik:** modalda odak tuzağı ve Esc, `aria-live` bildirimler, klavyeyle puanlama (ok tuşları), `prefers-reduced-motion` desteği
- **XSS:** tüm metinler `textContent` ile yazılır; `innerHTML` hiç kullanılmaz (denetim betiği bunu zorunlu kılar)
