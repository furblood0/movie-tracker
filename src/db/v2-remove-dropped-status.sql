-- =====================================================================
--  Movie Tracker - "Birakildi" durumunun kaldirilmasi (migration v2)
--
--  Artik yalnizca iki durum var: 'watched' ve 'watchlist'. Eski
--  'dropped' kayitlari siliniyor ve entries.status uzerindeki CHECK
--  kisiti daraltiliyor.
--
--  SQLite bir CHECK kisitini yerinde degistiremez; tablo bastan
--  olusturulup veri tasinir. Islem sirasi YABANCI ANAHTARLARA gore
--  kurgulandi (migrasyon calistiricisi transaction icinde oldugu icin
--  `PRAGMA foreign_keys = OFF` burada ise yaramaz - o pragma islem
--  icinde sessizce yok sayilir):
--
--    1. entry_genres.entry_id -> entries(id) ON DELETE CASCADE oldugu
--       icin `DROP TABLE entries` ortuk bir DELETE calistirip TUM tur
--       iliskilerini de silerdi. Bu yuzden once iki tablonun verisi
--       kisitsiz gecici tablolara kopyalanir.
--    2. Once entry_genres, sonra entries dusurulur (entries'in cocugu
--       kalmadigi icin cascade tetiklenmez).
--    3. Tablolar yeni sema ile kurulur, veri geri yazilir, gecici
--       tablolar silinir.
--
--  Not: `DROP TABLE entries` indeksleri ve trg_entries_updated_at
--  tetigini de dusurdugu icin ikisi de yeniden olusturulur.
-- =====================================================================

-- 1) Artik desteklenmeyen kayitlar (tur iliskileri cascade ile gider)
DELETE FROM entries WHERE status = 'dropped';

-- 2) Veriyi kisitsiz gecici tablolara al
CREATE TABLE _v2_entries      AS SELECT * FROM entries;
CREATE TABLE _v2_entry_genres AS SELECT * FROM entry_genres;

-- 3) Once cocuk tablo, sonra ebeveyn dusurulur
DROP TABLE entry_genres;
DROP TABLE entries;

-- 4) entries yeniden: status CHECK'i artik yalnizca iki degeri kabul eder
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
                         CHECK (status IN ('watched', 'watchlist')),
  rating         REAL             CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10)),
  review         TEXT,
  watched_at     TEXT,
  favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, media_type, tmdb_id)
);

INSERT INTO entries (
  id, user_id, tmdb_id, media_type, title, original_title, overview,
  poster_path, release_year, status, rating, review, watched_at, favorite,
  created_at, updated_at
)
SELECT
  id, user_id, tmdb_id, media_type, title, original_title, overview,
  poster_path, release_year, status, rating, review, watched_at, favorite,
  created_at, updated_at
FROM _v2_entries;

-- 5) entry_genres v1 ile birebir ayni; yalnizca ebeveyni yeniden bagliyoruz
CREATE TABLE entry_genres (
  entry_id       INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  genre_id       INTEGER NOT NULL,
  genre_name     TEXT    NOT NULL,
  PRIMARY KEY (entry_id, genre_id)
);

INSERT INTO entry_genres (entry_id, genre_id, genre_name)
SELECT entry_id, genre_id, genre_name FROM _v2_entry_genres;

DROP TABLE _v2_entries;
DROP TABLE _v2_entry_genres;

-- 6) Tabloyla birlikte dusen indeksler ve tetik geri gelir
CREATE INDEX idx_entries_user_status  ON entries(user_id, status);
CREATE INDEX idx_entries_user_rating  ON entries(user_id, rating);
CREATE INDEX idx_entries_user_updated ON entries(user_id, updated_at DESC);
CREATE INDEX idx_entry_genres_genre   ON entry_genres(genre_id);

CREATE TRIGGER trg_entries_updated_at
AFTER UPDATE ON entries
FOR EACH ROW
BEGIN
  UPDATE entries
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = OLD.id;
END;
