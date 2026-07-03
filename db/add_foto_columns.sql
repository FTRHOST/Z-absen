ALTER TABLE absensi
ADD COLUMN IF NOT EXISTS foto_istirahat_keluar TEXT,
ADD COLUMN IF NOT EXISTS foto_istirahat_masuk TEXT,
ADD COLUMN IF NOT EXISTS foto_keluar TEXT;
