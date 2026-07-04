-- Jalankan script ini di SQL Editor Supabase
-- Script ini akan memperbarui tabel app_settings jika sudah ada, atau membuatnya dari awal.

CREATE TABLE IF NOT EXISTS app_settings (
    id integer PRIMARY KEY DEFAULT 1,
    pengumuman text,
    form_judul text DEFAULT 'Sistem Absensi',
    enable_lokasi boolean DEFAULT true,
    enable_kamera boolean DEFAULT true,
    nama_aplikasi text DEFAULT 'Zie Absen',
    pengumuman_judul text DEFAULT 'Pengumuman / Info Libur',
    pengumuman_warna text DEFAULT 'alert-info'
);

-- Tambahkan kolom baru jika tabel sudah pernah dibuat sebelumnya
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS nama_aplikasi text DEFAULT 'Zie Absen';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS pengumuman_judul text DEFAULT 'Pengumuman / Info Libur';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS pengumuman_warna text DEFAULT 'alert-info';

INSERT INTO app_settings (id, form_judul, enable_lokasi, enable_kamera, nama_aplikasi, pengumuman_judul, pengumuman_warna) 
VALUES (1, 'Sistem Absensi', true, true, 'Zie Absen', 'Pengumuman / Info Libur', 'alert-info') 
ON CONFLICT (id) DO NOTHING;
