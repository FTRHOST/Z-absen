-- Aktifkan ekstensi pg_cron jika belum aktif (biasanya sudah default di Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Buat fungsi untuk mengecek dan mencatat Alpha
CREATE OR REPLACE FUNCTION catat_alpha_harian()
RETURNS void AS $$
BEGIN
    INSERT INTO absensi (user_id, tanggal, status)
    SELECT id, CURRENT_DATE, 'Alpha'
    FROM users
    WHERE 
      -- 1. Abaikan jika hari ini adalah hari libur rutin karyawan (format string misal: '0,6')
      -- Jika hari_libur kosong, dianggap bukan hari libur
      (hari_libur IS NULL OR hari_libur = '' OR NOT (EXTRACT(DOW FROM CURRENT_DATE)::text = ANY(string_to_array(hari_libur, ','))))
      
      -- 2. Abaikan jika karyawan sedang cuti dan disetujui hari ini
      AND NOT EXISTS (
        SELECT 1 FROM cuti 
        WHERE cuti.user_id = users.id 
          AND status_pengajuan = 'Disetujui' 
          AND CURRENT_DATE >= tanggal_mulai 
          AND CURRENT_DATE <= tanggal_selesai
      )
      
      -- 3. Abaikan jika karyawan sudah absen (masuk/hadir/terlambat dll) hari ini
      AND NOT EXISTS (
        SELECT 1 FROM absensi 
        WHERE absensi.user_id = users.id 
          AND absensi.tanggal = CURRENT_DATE
      );
END;
$$ LANGUAGE plpgsql;

-- Jadwalkan fungsi di atas untuk berjalan otomatis setiap hari pada jam 23:55
-- Sintaks Cron: '55 23 * * *' (Menit 55, Jam 23, Setiap hari)
SELECT cron.schedule(
  'job_alpha_harian', -- Nama Job
  '55 23 * * *',      -- Waktu jalan (Jam 23:55 tiap hari)
  'SELECT catat_alpha_harian()' -- Perintah yang dieksekusi
);

-- (Opsional) Jika sewaktu-waktu ingin menghapus/membatalkan job ini:
-- SELECT cron.unschedule('job_alpha_harian');
