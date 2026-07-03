-- Jalankan perintah ini di SQL Editor Supabase Anda

-- Menambahkan kolom waktu_istirahat_keluar dan waktu_istirahat_masuk ke tabel absensi
ALTER TABLE absensi 
ADD COLUMN IF NOT EXISTS waktu_istirahat_keluar TIME,
ADD COLUMN IF NOT EXISTS waktu_istirahat_masuk TIME;
