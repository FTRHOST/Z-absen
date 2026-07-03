-- Silakan jalankan script SQL ini di menu "SQL Editor" pada Supabase Anda

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS hari_libur text DEFAULT '';

-- Format data yang akan disimpan: '0,6' (0 = Minggu, 1 = Senin, ..., 6 = Sabtu)
-- Default kosong berarti tidak ada hari libur rutin mingguan.
