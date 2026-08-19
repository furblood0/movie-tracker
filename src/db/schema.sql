-- =====================================================================
--  Movie Tracker - Baslangic veritabani semasi (migration v1)
--  Motor: node:sqlite (SQLite 3)
--  Not: Tum tarih alanlari ISO-8601 UTC metni olarak tutulur
--       (ornek: 2026-08-19T06:05:00.123Z). Boylece hem siralama
--       hem de JS tarafinda `new Date(...)` ile ayristirma kolaydir.
-- =====================================================================

-- ---------------------------------------------------------------------
-- users: uygulama kullanicilari
--  * password_hash / password_salt: node:crypto scryptSync ile uretilir,
--    duz sifre HICBIR zaman saklanmaz.
--  * password_algo: ileride algoritma degisirse kademeli gecis (rehash)
--    yapabilmek icin kullanilan algoritmanin adi saklanir.
--  * COLLATE NOCASE: "Furkan" ve "furkan" ayni kullanici adi sayilir.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email          TEXT             UNIQUE COLLATE NOCASE,
  display_name   TEXT,
  password_hash  TEXT    NOT NULL,
  password_salt  TEXT    NOT NULL,
  password_algo  TEXT    NOT NULL DEFAULT 'scrypt',
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------
-- sessions: sunucu tarafli oturumlar
--  * id: node:crypto ile uretilen 32 baytlik rastgele hex deger.
--    Cereze (session_id) bu deger yazilir; JWT/imza yok, dogrulama
--    her istekte veritabanindan yapilir (aninda iptal edilebilirlik).
--  * ON DELETE CASCADE: kullanici silinirse oturumlari da silinir.
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
  id             TEXT    PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at     TEXT    NOT NULL,
  user_agent     TEXT,
  ip_address     TEXT
);

CREATE INDEX idx_sessions_user       ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ---------------------------------------------------------------------
-- entries: izleme gunlugu kayitlari (bir kullanicinin bir icerigi)
--  * media_type ve status alanlari CHECK ile kisitlanir; boylece
--    uygulama katmani hata yapsa bile veritabani tutarli kalir.
--  * rating: 1-10 arasi ondalik puan (ornek 8.5). NULL = puanlanmamis.
--  * UNIQUE(user_id, media_type, tmdb_id): ayni kullanici ayni filmi
--    iki kez ekleyemez -> "upsert" mantigi bunun uzerine kurulur.
-- ---------------------------------------------------------------------
CREATE TABLE entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id        INTEGER NOT NULL,
  media_type     TEXT    NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title          TEXT    NOT NULL,
  original_title TEXT,
  overview       TEXT,
  poster_path    TEXT,
  release_year   INTEGER,
  status         TEXT    NOT NULL DEFAULT 'watchlist'
                         CHECK (status IN ('watched', 'watchlist', 'dropped')),
  rating         REAL             CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10)),
  review         TEXT,
  watched_at     TEXT,
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, media_type, tmdb_id)
);

CREATE INDEX idx_entries_user_status  ON entries(user_id, status);
CREATE INDEX idx_entries_user_rating  ON entries(user_id, rating);
CREATE INDEX idx_entries_user_updated ON entries(user_id, updated_at DESC);

-- entries.updated_at alanini her UPDATE'te otomatik tazele.
-- (Uygulama kodunda unutulsa bile veri dogru kalir.)
CREATE TRIGGER trg_entries_updated_at
AFTER UPDATE ON entries
FOR EACH ROW
BEGIN
  UPDATE entries
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = OLD.id;
END;

-- ---------------------------------------------------------------------
-- entry_genres: kayit <-> tur (genre) iliskisi (cok-a-cok)
--  * TMDb tur kimligi ve adi birlikte tutulur; boylece tur filtresi ve
--    filtre menusu icin TMDb'ye ek istek atmak gerekmez.
-- ---------------------------------------------------------------------
CREATE TABLE entry_genres (
  entry_id       INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  genre_id       INTEGER NOT NULL,
  genre_name     TEXT    NOT NULL,
  PRIMARY KEY (entry_id, genre_id)
);

CREATE INDEX idx_entry_genres_genre ON entry_genres(genre_id);

-- ---------------------------------------------------------------------
-- tmdb_cache: TMDb proxy yanitlarinin kisa sureli onbellegi
--  * cache_key: "search:movie:matrix:1" gibi normalize edilmis anahtar.
--  * payload: JSON metni. created_at: unix saniye (TTL hesabi icin).
--  * Amac: ayni aramada TMDb kotasini bosa harcamamak.
-- ---------------------------------------------------------------------
CREATE TABLE tmdb_cache (
  cache_key      TEXT    PRIMARY KEY,
  payload        TEXT    NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_tmdb_cache_created_at ON tmdb_cache(created_at);
