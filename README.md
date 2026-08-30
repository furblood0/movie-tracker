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
│       ├── app.js          # Önyükleyici: oturum kontrolü, görünüm geçişleri
│       ├── api.js          # Fetch sarmalayıcı + ApiError
│       ├── dom.js          # el() / clear() / debounce() — innerHTML kullanılmaz
│       ├── card.js         # Poster kartları, iskelet yükleyici, boş durumlar
│       ├── stars.js        # Yarım yıldız puanlama (görüntü + giriş)
│       ├── modal.js        # Modal + odak tuzağı + onay diyaloğu
│       ├── toast.js        # Bildirimler
│       ├── auth-view.js    # Giriş / kayıt ekranı
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
│   │   └── reset.js        # Geliştirme: veritabanını sil
│   ├── lib/
│   │   ├── http.js         # JSON yanıt, gövde okuma, çerez, HttpError
│   │   ├── router.js       # Kalıp → RegExp yönlendirici (`/api/entries/:id`)
│   │   ├── static.js       # MIME eşleme + path traversal koruması
│   │   └── logger.js
│   └── routes/
│       └── index.js        # Rota kayıt noktası
└── data/                   # SQLite dosyası (git'e girmez)
```

## Veritabanı şeması (v1)

| Tablo          | Amaç                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `users`        | Kullanıcılar; `scrypt` + rastgele salt ile hash'lenmiş şifreler       |
| `sessions`     | Sunucu taraflı oturumlar; çerezde yalnızca rastgele `session_id`      |
| `entries`      | İzleme günlüğü kayıtları (durum, puan, yorum, izleme tarihi)          |
| `entry_genres` | Kayıt ↔ TMDb türü ilişkisi (tür filtresi ve filtre menüsü için)       |
| `tmdb_cache`   | TMDb yanıtlarının kısa süreli önbelleği (kota tasarrufu)              |

Detaylı açıklamalar ve kısıtlar için `src/db/schema.sql` dosyasına bakın.

## Güvenlik önlemleri

- **SQL Injection:** istisnasız tüm sorgular `db.prepare(...)` + bağlı parametre
- **Şifreler:** `crypto.scryptSync` + kullanıcıya özel 16 baytlık salt; karşılaştırma `timingSafeEqual`
- **Oturum çerezi:** `HttpOnly; SameSite=Strict; Path=/` (+ production'da `Secure`)
- **Path Traversal:** yüzde-çözümü → NUL baytı reddi → `path.normalize`/`resolve` → `public/` içinde olma doğrulaması
- **İstek gövdesi:** 1 MB üst sınır, bozuk JSON `try-catch` ile 400'e çevrilir
- **Başlıklar:** `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- **API anahtarı:** yalnızca sunucu belleğinde; istemci `/api/tmdb/*` proxy'sini kullanır

## API

| Yöntem | Adres                | Gövde / Açıklama                                              |
| ------ | -------------------- | ------------------------------------------------------------- |
| GET    | `/api/health`        | Sunucu/veritabanı/TMDb yapılandırma durumu                    |
| POST   | `/api/auth/register` | `{ username, password, email?, displayName? }` → 201 + oturum |
| POST   | `/api/auth/login`    | `{ username, password }` → 200 + oturum çerezi                |
| POST   | `/api/auth/logout`   | 204, oturumu veritabanından siler ve çerezi temizler          |
| GET    | `/api/auth/me`       | Oturum yoksa `{ user: null }` (401 değil)                     |
| POST   | `/api/auth/password` | `{ currentPassword, newPassword }`, diğer oturumları düşürür  |

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
| POST   | `/api/entries`         | Yeni kayıt; içerik zaten varsa `409` + `details.existingEntryId` |
| GET    | `/api/entries/:id`     | Tek kayıt                                                      |
| PATCH  | `/api/entries/:id`     | Kısmi güncelleme; `null` göndermek alanı temizler              |
| DELETE | `/api/entries/:id`     | `204`                                                          |

`GET /api/entries` sorgu parametreleri:

| Parametre               | Değerler                                                    |
| ----------------------- | ----------------------------------------------------------- |
| `status`                | `watched` \| `watchlist` \| `dropped`                       |
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
- Kayıt: IP başına saatte 20 deneme / 5 oluşturulan hesap

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

- **Giriş / Kayıt:** tek kartta sekmeli form; sunucudan gelen alan bazlı hatalar ilgili alanın altına yazılır
- **Günlüğüm:** durum çipleri, tür/kategori/puan/sıralama menüleri, metin arama, sayfalama
- **Keşfet:** TMDb arama (400 ms debounce), haftanın öne çıkanları, detay modalı (süre, sezon, oyuncular)
- **Kayıt formu:** durum seçici, yarım yıldız puanlama (fare + klavye), izleme tarihi, not, favori
- **Erişilebilirlik:** modalda odak tuzağı ve Esc, `aria-live` bildirimler, klavyeyle puanlama (ok tuşları), `prefers-reduced-motion` desteği
- **XSS:** tüm metinler `textContent` ile yazılır; `innerHTML` hiç kullanılmaz (denetim betiği bunu zorunlu kılar)
