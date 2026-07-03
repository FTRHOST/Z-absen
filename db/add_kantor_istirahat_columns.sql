-- Jalankan di SQL Editor Supabase

ALTER TABLE kantor
ADD COLUMN IF NOT EXISTS jam_mulai_istirahat TIME,
ADD COLUMN IF NOT EXISTS jam_selesai_istirahat TIME;
