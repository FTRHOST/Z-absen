-- ==========================================
-- SCRIPT SETUP DATABASE ZIE ABSEN (VERSI FINAL & LENGKAP)
-- ==========================================

-- Mengaktifkan ekstensi kriptografi untuk hashing password (wajib untuk Auth)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------
-- 1. PEMBUATAN BUCKET PENYIMPANAN
-- ------------------------------------------
-- Dibuat otomatis dan langsung disetel sebagai PUBLIC agar link foto bisa dibuka
INSERT INTO storage.buckets (id, name, public) 
VALUES ('absensi-bucket', 'absensi-bucket', true) 
ON CONFLICT (id) DO UPDATE SET public = true;

-- ------------------------------------------
-- 2. PEMBUATAN TABEL-TABEL UTAMA
-- ------------------------------------------

-- Tabel Pengaturan Aplikasi
CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    nama_aplikasi TEXT DEFAULT 'Zieda Absen',
    logo_url TEXT,
    login_subteks TEXT,
    form_judul TEXT DEFAULT 'Form Kehadiran Harian',
    pengumuman TEXT,
    pengumuman_warna TEXT DEFAULT 'alert-info',
    enable_lokasi BOOLEAN DEFAULT true,
    enable_kamera BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Tabel Kantor / Cabang
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

-- Tabel Pengguna / Karyawan
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

-- Tabel Absensi (Lengkap dengan foto istirahat & status wajah)
CREATE TABLE IF NOT EXISTS absensi (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tanggal DATE NOT NULL,
    waktu_masuk TIME,
    lokasi_masuk TEXT,
    foto_masuk TEXT,
    waktu_istirahat_keluar TIME,
    lokasi_istirahat_keluar TEXT,
    foto_istirahat_keluar TEXT,
    waktu_istirahat_masuk TIME,
    lokasi_istirahat_masuk TEXT,
    foto_istirahat_masuk TEXT,
    waktu_keluar TIME,
    lokasi_keluar TEXT,
    foto_keluar TEXT,
    status TEXT DEFAULT 'Hadir',
    status_wajah TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Tabel Transaksi Cuti
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

-- Tabel Master Jenis Cuti (Lengkap dengan aturan batas & siklus)
CREATE TABLE IF NOT EXISTS master_jenis_cuti (
    id SERIAL PRIMARY KEY,
    nama_cuti TEXT NOT NULL,
    is_unlimited BOOLEAN DEFAULT false,
    batas_hari INTEGER DEFAULT 0,
    siklus TEXT DEFAULT 'Tahunan',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Tabel Form Builder Cuti
CREATE TABLE IF NOT EXISTS form_cuti_config (
    id SERIAL PRIMARY KEY,
    label TEXT,
    tipe TEXT,
    opsi TEXT,
    urutan INTEGER,
    wajib BOOLEAN DEFAULT true,
    struktur_form JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- ------------------------------------------
-- 3. DATA BAWAAN (SEED DATA)
-- ------------------------------------------
INSERT INTO app_settings (id, nama_aplikasi) VALUES (1, 'ZIEDA ABSEN') ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------
-- 4. FITUR KEAMANAN (ROW LEVEL SECURITY - RLS)
-- ------------------------------------------
ALTER TABLE absensi ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuti ENABLE ROW LEVEL SECURITY;
ALTER TABLE kantor ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_cuti_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_jenis_cuti ENABLE ROW LEVEL SECURITY;

-- Kebijakan Keamanan (Public Read untuk setting)
CREATE POLICY "Allow public read app_settings" ON app_settings FOR SELECT USING (true);
CREATE POLICY "Allow auth update app_settings" ON app_settings FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth insert app_settings" ON app_settings FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Akses Penuh untuk tabel operasional jika sudah login
CREATE POLICY "Allow auth all on absensi" ON absensi FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on cuti" ON cuti FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on kantor" ON kantor FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on master_jenis_cuti" ON master_jenis_cuti FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on form_cuti_config" ON form_cuti_config FOR ALL USING (auth.role() = 'authenticated');

-- Kebijakan Khusus Tabel Users
CREATE POLICY "Allow auth select users" ON users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth update users" ON users FOR UPDATE USING (
    auth_id = auth.uid() OR 
    (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('Super Admin', 'HR')
);
CREATE POLICY "Allow auth insert users" ON users FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow auth delete users" ON users FOR DELETE USING (auth.role() = 'authenticated');

-- Kebijakan Storage Bucket (Upload Foto)
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING ( bucket_id = 'absensi-bucket' );
CREATE POLICY "Auth Upload Access" ON storage.objects FOR INSERT WITH CHECK ( bucket_id = 'absensi-bucket' AND auth.role() = 'authenticated' );
CREATE POLICY "Auth Update Access" ON storage.objects FOR UPDATE USING ( bucket_id = 'absensi-bucket' AND auth.role() = 'authenticated' );
CREATE POLICY "Auth Delete Access" ON storage.objects FOR DELETE USING ( bucket_id = 'absensi-bucket' AND auth.role() = 'authenticated' );

-- ------------------------------------------
-- 5. FUNGSI PENDAFTARAN OTOMATIS (LINK ACCOUNT)
-- ------------------------------------------
CREATE OR REPLACE FUNCTION link_my_account(p_nama text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user record;
  v_auth_exists boolean;
BEGIN
  -- Cek apakah nama dan password manual di database cocok (case insensitive)
  SELECT * INTO v_user FROM users WHERE nama ILIKE p_nama AND password = p_password;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nama Pengguna atau Password salah!';
  END IF;

  -- Kaitkan profil tabel dengan UID Supabase Auth
  IF v_user.auth_id IS NOT NULL THEN
    -- Cek apakah auth_id lama sebenarnya masih ada di auth.users (mungkin sudah dihapus manual)
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user.auth_id) INTO v_auth_exists;
    
    IF v_auth_exists AND auth.uid() IS NOT NULL AND v_user.auth_id != auth.uid() THEN
      RAISE EXCEPTION 'Akun ini sudah terhubung ke sesi lain!';
    END IF;
  END IF;
  
  -- Update hanya jika auth.uid() tersedia
  IF auth.uid() IS NOT NULL THEN
      UPDATE users SET auth_id = auth.uid() WHERE id = v_user.id;
  END IF;
  
  RETURN row_to_json(v_user);
END;
$$;

-- ------------------------------------------
-- 6. BUAT AKUN SUPER ADMIN DEFAULT
-- ------------------------------------------
INSERT INTO public.users (nama, password, role, cabang)
SELECT 'Super Admin', 'admin123', 'Super Admin', 'Pusat'
WHERE NOT EXISTS (
    SELECT 1 FROM public.users WHERE role = 'Super Admin'
);

-- ------------------------------------------
-- 7. AKTIFKAN SUPABASE REALTIME
-- ------------------------------------------
-- Wajib agar dashboard Admin bisa otomatis me-reload data jika ada perubahan
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;

ALTER PUBLICATION supabase_realtime ADD TABLE absensi;
ALTER PUBLICATION supabase_realtime ADD TABLE cuti;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE kantor;
-- ------------------------------------------
-- 8. FUNGSI ADMIN UPDATE PASSWORD
-- ------------------------------------------
CREATE OR REPLACE FUNCTION admin_change_password(p_user_id INT, p_new_password TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_auth_id uuid;
BEGIN
  -- Get the auth_id of the user
  SELECT auth_id INTO v_auth_id FROM public.users WHERE id = p_user_id;
  
  -- Update public.users password
  UPDATE public.users SET password = p_new_password WHERE id = p_user_id;

  -- Update auth.users if auth_id exists
  IF v_auth_id IS NOT NULL THEN
    UPDATE auth.users 
    SET encrypted_password = crypt(p_new_password, gen_salt('bf'))
    WHERE id = v_auth_id;
  END IF;
END;
$$;
