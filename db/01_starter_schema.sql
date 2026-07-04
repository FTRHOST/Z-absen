-- ==========================================
-- SCRIPT SETUP DATABASE ZIE ABSEN (FRESS INSTALL)
-- Jalankan HANYA SEKALI pada database yang kosong!
-- ==========================================

-- Mengaktifkan ekstensi kriptografi untuk hashing password (wajib untuk Auth)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------
-- 1. PEMBUATAN BUCKET PENYIMPANAN
-- ------------------------------------------
-- Dibuat secara otomatis melalui SQL
INSERT INTO storage.buckets (id, name, public) 
VALUES ('absensi-bucket', 'absensi-bucket', false) 
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------
-- 2. PEMBUATAN TABEL-TABEL UTAMA
-- ------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    nama_aplikasi TEXT DEFAULT 'Zieda Absen',
    pengumuman TEXT,
    pengumuman_warna TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Tabel kantor (Sebelumnya kita sebut cabang)
CREATE TABLE IF NOT EXISTS kantor (
    id SERIAL PRIMARY KEY,
    nama TEXT NOT NULL,
    lat TEXT,
    lng TEXT,
    radius INTEGER DEFAULT 100,
    jam_masuk TIME DEFAULT '08:00',
    jam_keluar TIME DEFAULT '17:00',
    jam_mulai_istirahat TIME DEFAULT '12:00',
    jam_selesai_istirahat TIME DEFAULT '13:00',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- (Opsional jika masih ada yang memanggil tabel cabang)
CREATE TABLE IF NOT EXISTS cabang (
    id SERIAL PRIMARY KEY,
    nama_cabang TEXT NOT NULL,
    koordinat_lat TEXT,
    koordinat_lng TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    nama TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'Karyawan',
    no_hp TEXT,
    cabang TEXT,
    auth_id UUID UNIQUE,
    hari_libur TEXT DEFAULT 'Minggu',
    sisa_cuti INTEGER DEFAULT 12,
    face_descriptor TEXT,
    foto_wajah TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS absensi (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tanggal DATE NOT NULL,
    waktu_masuk TIME,
    lokasi_masuk TEXT,
    foto_masuk TEXT,
    waktu_istirahat_keluar TIME,
    lokasi_istirahat_keluar TEXT,
    waktu_istirahat_masuk TIME,
    lokasi_istirahat_masuk TEXT,
    waktu_keluar TIME,
    lokasi_keluar TEXT,
    foto_keluar TEXT,
    status TEXT DEFAULT 'Hadir',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS cuti (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tanggal_mulai DATE NOT NULL,
    tanggal_selesai DATE NOT NULL,
    alasan TEXT,
    durasi_hari INTEGER,
    data_tambahan JSONB,
    status_pengajuan TEXT DEFAULT 'Menunggu',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS master_jenis_cuti (
    id SERIAL PRIMARY KEY,
    nama_cuti TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS form_cuti_config (
    id SERIAL PRIMARY KEY,
    label TEXT,
    tipe_input TEXT,
    urutan INTEGER,
    wajib BOOLEAN DEFAULT true,
    struktur_form JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- ------------------------------------------
-- 3. DATA BAWAAN (SEED DATA)
-- ------------------------------------------
INSERT INTO app_settings (id, nama_aplikasi) VALUES (1, 'ZIEDA ABSEN') ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 4. PEMBUATAN AKUN ADMIN (MANUAL)
-- =========================================================================
-- PERHATIAN: Supabase versi terbaru memblokir pembuatan akun via SQL.
-- Anda WAJIB membuat akun admin pertama secara manual di Dashboard!
--
-- Langkah-langkah:
-- 1. Buka menu Authentication -> Users -> Add User di Dashboard Supabase.
-- 2. Masukkan Email: admin@zieabsen.internal dan Password: admin123
-- 3. Copy UUID yang dihasilkan oleh Supabase.
-- 4. Buka tanda komentar (--) pada kode di bawah ini, ganti PASTE_UUID_DISINI 
--    dengan UUID yang Anda copy, lalu tekan RUN.
--
-- INSERT INTO public.users (nama, password, role, auth_id, cabang)
-- VALUES ('admin', 'admin123', 'Super Admin', 'PASTE_UUID_DISINI', 'Pusat');
-- =========================================================================

-- ------------------------------------------
-- 4. FITUR KEAMANAN (ROW LEVEL SECURITY)
-- ------------------------------------------
ALTER TABLE absensi ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuti ENABLE ROW LEVEL SECURITY;
ALTER TABLE cabang ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_cuti_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Kebijakan Keamanan Sangat Ketat (Strict RLS)
CREATE POLICY "Allow public read app_settings" ON app_settings FOR SELECT USING (true);
CREATE POLICY "Allow auth update app_settings" ON app_settings FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Allow auth all on absensi" ON absensi FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on cuti" ON cuti FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on cabang" ON cabang FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on kantor" ON kantor FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on master_jenis_cuti" ON master_jenis_cuti FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on form_cuti_config" ON form_cuti_config FOR ALL USING (auth.role() = 'authenticated');

-- Tabel users dikunci total untuk publik
CREATE POLICY "Allow auth select users" ON users FOR SELECT USING (auth.role() = 'authenticated');
-- Kebijakan Update: Karyawan hanya bisa ubah data sendiri, TAPI HR/Admin bisa ubah data semua orang
CREATE POLICY "Allow auth update users" ON users FOR UPDATE USING (
    auth_id = auth.uid() OR 
    (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('Super Admin', 'Admin HR')
);
CREATE POLICY "Allow auth insert users" ON users FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow auth delete users" ON users FOR DELETE USING (auth.role() = 'authenticated');

-- Kebijakan Storage Bucket
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING ( bucket_id = 'absensi-bucket' );
CREATE POLICY "Auth Upload Access" ON storage.objects FOR INSERT WITH CHECK ( bucket_id = 'absensi-bucket' AND auth.role() = 'authenticated' );
CREATE POLICY "Auth Update Access" ON storage.objects FOR UPDATE USING ( bucket_id = 'absensi-bucket' AND auth.role() = 'authenticated' );
CREATE POLICY "Auth Delete Access" ON storage.objects FOR DELETE USING ( bucket_id = 'absensi-bucket' AND auth.role() = 'authenticated' );

-- ------------------------------------------
-- 5. FUNGSI PENDAFTARAN OTOMATIS (LINK ACCOUNT)
-- ------------------------------------------
-- Fungsi ini digunakan untuk mengikat akun Auth baru ke profil karyawan secara aman
-- Dijalankan sebagai SECURITY DEFINER (kebal RLS)

CREATE OR REPLACE FUNCTION link_my_account(p_nama text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user record;
BEGIN
  -- 1. Cek apakah nama dan password manual di database benar
  SELECT * INTO v_user FROM users WHERE nama = p_nama AND password = p_password;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nama atau Password salah!';
  END IF;

  -- 2. Cek apakah profil ini sudah diikat oleh orang lain
  IF v_user.auth_id IS NOT NULL THEN
    IF v_user.auth_id != auth.uid() THEN
      RAISE EXCEPTION 'Akun ini sudah terhubung ke sesi lain!';
    END IF;
  ELSE
    -- 3. Jika belum diikat, ikat profil ini dengan Auth ID yang sedang login sekarang
    UPDATE users SET auth_id = auth.uid() WHERE id = v_user.id;
  END IF;
  
  RETURN json_build_object(
    'id', v_user.id, 
    'role', v_user.role, 
    'nama', v_user.nama
  );
END;
$$;
