-- ==========================================
-- SCRIPT SETUP DATABASE ZIE ABSEN (VERSI FINAL & LENGKAP)
-- ==========================================

-- Pembuatan role & schema dasar Supabase
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin WITH SUPERUSER LOGIN PASSWORD 'postgres';
  ELSE
    ALTER ROLE supabase_admin WITH SUPERUSER LOGIN PASSWORD 'postgres';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )::text;
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

-- Mengaktifkan ekstensi kriptografi untuk hashing password (wajib untuk Auth)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------
-- 1. PEMBUATAN BUCKET PENYIMPANAN
-- ------------------------------------------
-- Catatan: Tabel storage.buckets & storage.objects dibuat dan dimigrasi secara otomatis oleh Supabase Storage API engine.
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
        INSERT INTO storage.buckets (id, name, public) 
        VALUES ('absensi-bucket', 'absensi-bucket', true) 
        ON CONFLICT (id) DO UPDATE SET public = true;
    END IF;
END $$;

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
    tipe_absen_ids JSONB DEFAULT '[]'::jsonb,
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
    unit TEXT,
    auth_id UUID UNIQUE,
    hari_libur TEXT DEFAULT 'Minggu',
    sisa_cuti INTEGER DEFAULT 12,
    face_descriptor TEXT,
    foto_wajah TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Tabel Master Tipe Absen
CREATE TABLE IF NOT EXISTS master_tipe_absen (
    id SERIAL PRIMARY KEY,
    nama_tipe TEXT NOT NULL,
    jam_mulai TIME,
    batas_terlambat TIME,
    jam_tutup TIME,
    is_checkout BOOLEAN DEFAULT false,
    is_aktif BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Tabel Absensi (Transaksi Log)
CREATE TABLE IF NOT EXISTS absensi (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tanggal DATE NOT NULL,
    waktu TIME NOT NULL,
    tipe_absen TEXT NOT NULL,
    lokasi TEXT,
    foto TEXT,
    status TEXT DEFAULT 'Hadir',
    status_wajah TEXT,
    menit_terlambat INTEGER DEFAULT 0,
    menit_lembur INTEGER DEFAULT 0,
    keterangan_waktu TEXT,
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

-- Hak Akses Schema & Roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supabase_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, supabase_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, supabase_admin;

GRANT ALL ON SCHEMA storage TO postgres, supabase_admin, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres, supabase_admin, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO postgres, supabase_admin, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO postgres, supabase_admin, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON TABLES TO postgres, supabase_admin, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres, supabase_admin, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT ALL ON ROUTINES TO postgres, supabase_admin, anon, authenticated, service_role;

ALTER ROLE service_role SET search_path = storage, public;
ALTER ROLE authenticated SET search_path = storage, public;
ALTER ROLE anon SET search_path = storage, public;
ALTER ROLE supabase_admin SET search_path = storage, public;

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
ALTER TABLE master_tipe_absen ENABLE ROW LEVEL SECURITY;

-- Kebijakan Keamanan (Public Read untuk setting)
DROP POLICY IF EXISTS "Allow public read app_settings" ON app_settings;
DROP POLICY IF EXISTS "Allow auth update app_settings" ON app_settings;
DROP POLICY IF EXISTS "Allow auth insert app_settings" ON app_settings;
CREATE POLICY "Allow public read app_settings" ON app_settings FOR SELECT USING (true);
CREATE POLICY "Allow auth update app_settings" ON app_settings FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth insert app_settings" ON app_settings FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Akses Penuh untuk tabel operasional jika sudah login
DROP POLICY IF EXISTS "Allow auth all on absensi" ON absensi;
DROP POLICY IF EXISTS "Allow auth all on cuti" ON cuti;
DROP POLICY IF EXISTS "Allow auth all on kantor" ON kantor;
DROP POLICY IF EXISTS "Allow auth all on master_jenis_cuti" ON master_jenis_cuti;
DROP POLICY IF EXISTS "Allow auth all on form_cuti_config" ON form_cuti_config;
DROP POLICY IF EXISTS "Allow auth all on master_tipe_absen" ON master_tipe_absen;
CREATE POLICY "Allow auth all on absensi" ON absensi FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on cuti" ON cuti FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on kantor" ON kantor FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on master_jenis_cuti" ON master_jenis_cuti FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on form_cuti_config" ON form_cuti_config FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow auth all on master_tipe_absen" ON master_tipe_absen FOR ALL USING (auth.role() = 'authenticated');

-- Kebijakan Khusus Tabel Users
DROP POLICY IF EXISTS "Allow public select users" ON users;
DROP POLICY IF EXISTS "Allow auth update users" ON users;
DROP POLICY IF EXISTS "Allow auth insert users" ON users;
DROP POLICY IF EXISTS "Allow auth delete users" ON users;
CREATE POLICY "Allow public select users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow auth update users" ON users FOR UPDATE USING (
    auth_id = auth.uid() OR 
    auth_id IS NULL OR 
    (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('Super Admin', 'HR')
);
CREATE POLICY "Allow auth insert users" ON users FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow auth delete users" ON users FOR DELETE USING (auth.role() = 'authenticated');

-- Kebijakan Storage Bucket (Upload Foto)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Auth Upload Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Access" ON storage.objects;
DROP POLICY IF EXISTS "Auth Update Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Access" ON storage.objects;
DROP POLICY IF EXISTS "Auth Delete Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete Access" ON storage.objects;

CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING ( bucket_id = 'absensi-bucket' );
CREATE POLICY "Public Upload Access" ON storage.objects FOR INSERT WITH CHECK ( bucket_id = 'absensi-bucket' );
CREATE POLICY "Public Update Access" ON storage.objects FOR UPDATE USING ( bucket_id = 'absensi-bucket' );
CREATE POLICY "Public Delete Access" ON storage.objects FOR DELETE USING ( bucket_id = 'absensi-bucket' );

-- ------------------------------------------
-- 5. FUNGSI PENDAFTARAN OTOMATIS (LINK ACCOUNT)
-- ------------------------------------------
DROP FUNCTION IF EXISTS public.link_my_account(text, text);
DROP FUNCTION IF EXISTS public.link_my_account(text, text, uuid);

CREATE OR REPLACE FUNCTION public.link_my_account(p_nama text, p_password text, p_auth_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user record;
  v_target_auth_id uuid;
BEGIN
  SELECT * INTO v_user FROM users WHERE nama ILIKE p_nama AND password = p_password;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nama Pengguna atau Password salah!';
  END IF;

  v_target_auth_id := COALESCE(p_auth_id, auth.uid());

  IF v_target_auth_id IS NOT NULL THEN
      UPDATE users SET auth_id = v_target_auth_id WHERE id = v_user.id;
      v_user.auth_id := v_target_auth_id;
  END IF;
  
  RETURN row_to_json(v_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_my_account(p_nama text, p_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.link_my_account(p_nama, p_password, NULL::uuid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_my_account(text, text) TO anon, authenticated, service_role, supabase_admin;
GRANT EXECUTE ON FUNCTION public.link_my_account(text, text, uuid) TO anon, authenticated, service_role, supabase_admin;

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
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;

ALTER PUBLICATION supabase_realtime ADD TABLE absensi;
ALTER PUBLICATION supabase_realtime ADD TABLE cuti;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE kantor;
ALTER PUBLICATION supabase_realtime ADD TABLE master_tipe_absen;

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

-- ------------------------------------------
-- 9. INISIALISASI SCHEMA SUPABASE REALTIME TENANTS
-- ------------------------------------------
CREATE SCHEMA IF NOT EXISTS _realtime;
CREATE TABLE IF NOT EXISTS _realtime.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    external_id TEXT UNIQUE NOT NULL,
    jwt_secret TEXT,
    postgres_cdc_default TEXT,
    max_concurrent_users INTEGER DEFAULT 1000,
    max_events_per_second INTEGER DEFAULT 1000,
    max_bytes_per_second INTEGER DEFAULT 1000000,
    max_channels_per_client INTEGER DEFAULT 100,
    max_joins_per_second INTEGER DEFAULT 500,
    suspend BOOLEAN DEFAULT false,
    inserted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
INSERT INTO _realtime.tenants (external_id, jwt_secret)
VALUES 
    ('realtime-dev', 'c3VwZXItc2VjcmV0LWp3dC10b2tlbi13aXRoLWF0LWxlYXN0LTMyLWNoYXJhY3RlcnMtbG9uZw=='),
    ('erik-enervative-vilifyingly', 'c3VwZXItc2VjcmV0LWp3dC10b2tlbi13aXRoLWF0LWxlYXN0LTMyLWNoYXJhY3RlcnMtbG9uZw=='),
    ('localhost', 'c3VwZXItc2VjcmV0LWp3dC10b2tlbi13aXRoLWF0LWxlYXN0LTMyLWNoYXJhY3RlcnMtbG9uZw==')
ON CONFLICT (external_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS _realtime.extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    settings JSONB,
    tenant_external_id TEXT REFERENCES _realtime.tenants(external_id) ON DELETE CASCADE,
    inserted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------
-- 10. SEED DATA STARTER (KANTOR, USERS, MASTER SHIFT, ABSENSI DEMO)
-- ------------------------------------------

-- Seed App Settings
INSERT INTO app_settings (id, nama_aplikasi, login_subteks, form_judul, pengumuman, enable_lokasi, enable_kamera)
VALUES (1, 'Zieda Absen', 'Sistem Presensi Harian Online & Face Recognition', 'Form Kehadiran Harian', 'Selamat datang di Sistem Absensi Zieda!', true, true)
ON CONFLICT (id) DO NOTHING;

-- Seed Kantor / Cabang
INSERT INTO kantor (nama, lat, lng, radius)
VALUES 
('Zieda Pusat', '-6.917464', '107.619122', 100),
('Zieda Cabang Barat', '-6.914000', '107.600000', 100),
('Zieda Cabang Timur', '-6.920000', '107.630000', 100)
ON CONFLICT DO NOTHING;

-- Seed Users (Super Admin & Connected Test Karyawan)
INSERT INTO users (nama, password, role, no_hp, cabang, unit, sisa_cuti)
VALUES 
('Super Admin', '123456', 'Super Admin', '081234567890', 'Zieda Pusat', 'Management', 12),
('Budi Pagi', '123456', 'Karyawan', '081234567891', 'Zieda Pusat', 'Operasional', 12),
('Siti Siang', '123456', 'Karyawan', '081234567892', 'Zieda Pusat', 'Kasir', 12),
('Rudi Istirahat', '123456', 'Karyawan', '081234567893', 'Zieda Pusat', 'Gudang', 12),
('Dewi Lembur', '123456', 'Karyawan', '081234567894', 'Zieda Pusat', 'HRD', 12)
ON CONFLICT DO NOTHING;

-- Seed Master Tipe Absen (Clean Multi-Shift & Break/Izin)
INSERT INTO master_tipe_absen (nama_tipe, jam_mulai, batas_terlambat, jam_tutup, is_checkout, is_aktif)
VALUES 
('Absen Masuk Pagi', '07:00:00', '08:00:00', '16:00:00', false, true),
('Absen Pulang Pagi', '15:00:00', '16:00:00', '23:59:59', true, true),
('Absen Masuk Siang', '12:00:00', '13:00:00', '21:00:00', false, true),
('Absen Pulang Siang', '20:00:00', '21:00:00', '23:59:59', true, true),
('Istirahat Keluar', '00:00:00', NULL, NULL, false, true),
('Istirahat Masuk', '00:00:00', NULL, NULL, false, true),
('Izin Keluar', '00:00:00', NULL, NULL, false, true),
('Izin Masuk', '00:00:00', NULL, NULL, false, true)
ON CONFLICT DO NOTHING;

-- Seed Sample Attendance Demo Records for Today
WITH u AS (
  SELECT id, nama FROM users WHERE nama IN ('Budi Pagi', 'Siti Siang', 'Rudi Istirahat', 'Dewi Lembur')
)
INSERT INTO absensi (user_id, tanggal, waktu, tipe_absen, lokasi, status, status_wajah, menit_terlambat, menit_lembur, keterangan_waktu)
VALUES
-- Budi Pagi (Terlambat Shift Pagi 25 menit)
((SELECT id FROM u WHERE nama='Budi Pagi' LIMIT 1), CURRENT_DATE, '08:25:00', 'Absen Masuk Pagi', 'Jarak: 5m dari Zieda Pusat', 'Terlambat', 'Sesuai', 25, 0, 'Terlambat 25m'),
((SELECT id FROM u WHERE nama='Budi Pagi' LIMIT 1), CURRENT_DATE, '16:02:00', 'Absen Pulang Pagi', 'Jarak: 4m dari Zieda Pusat', 'Hadir', 'Sesuai', 0, 0, 'Pulang Normal'),

-- Siti Siang (Terlambat Shift Siang 20 menit)
((SELECT id FROM u WHERE nama='Siti Siang' LIMIT 1), CURRENT_DATE, '13:20:00', 'Absen Masuk Siang', 'Jarak: 8m dari Zieda Pusat', 'Terlambat', 'Sesuai', 20, 0, 'Terlambat 20m'),
((SELECT id FROM u WHERE nama='Siti Siang' LIMIT 1), CURRENT_DATE, '21:05:00', 'Absen Pulang Siang', 'Jarak: 6m dari Zieda Pusat', 'Hadir', 'Sesuai', 0, 0, 'Pulang Normal'),

-- Rudi Istirahat (Normal + Istirahat Siang)
((SELECT id FROM u WHERE nama='Rudi Istirahat' LIMIT 1), CURRENT_DATE, '07:45:00', 'Absen Masuk Pagi', 'Jarak: 3m dari Zieda Pusat', 'Hadir', 'Sesuai', 0, 0, 'Tepat Waktu'),
((SELECT id FROM u WHERE nama='Rudi Istirahat' LIMIT 1), CURRENT_DATE, '12:00:00', 'Istirahat Keluar', 'Jarak: 2m dari Zieda Pusat', 'Istirahat', 'Sesuai', 0, 0, 'Meninggalkan Kantor'),
((SELECT id FROM u WHERE nama='Rudi Istirahat' LIMIT 1), CURRENT_DATE, '12:50:00', 'Istirahat Masuk', 'Jarak: 3m dari Zieda Pusat', 'Istirahat', 'Sesuai', 0, 0, 'Kembali ke Kantor'),
((SELECT id FROM u WHERE nama='Rudi Istirahat' LIMIT 1), CURRENT_DATE, '16:05:00', 'Absen Pulang Pagi', 'Jarak: 5m dari Zieda Pusat', 'Hadir', 'Sesuai', 0, 0, 'Pulang Normal'),

-- Dewi Lembur (Normal + Istirahat Siang + Istirahat Lembur + Lembur Pulang)
((SELECT id FROM u WHERE nama='Dewi Lembur' LIMIT 1), CURRENT_DATE, '07:50:00', 'Absen Masuk Pagi', 'Jarak: 2m dari Zieda Pusat', 'Hadir', 'Sesuai', 0, 0, 'Tepat Waktu'),
((SELECT id FROM u WHERE nama='Dewi Lembur' LIMIT 1), CURRENT_DATE, '12:00:00', 'Istirahat Keluar', 'Jarak: 3m dari Zieda Pusat', 'Istirahat', 'Sesuai', 0, 0, 'Meninggalkan Kantor'),
((SELECT id FROM u WHERE nama='Dewi Lembur' LIMIT 1), CURRENT_DATE, '12:45:00', 'Istirahat Masuk', 'Jarak: 4m dari Zieda Pusat', 'Istirahat', 'Sesuai', 0, 0, 'Kembali ke Kantor'),
((SELECT id FROM u WHERE nama='Dewi Lembur' LIMIT 1), CURRENT_DATE, '18:00:00', 'Istirahat Keluar', 'Jarak: 3m dari Zieda Pusat', 'Istirahat', 'Sesuai', 0, 0, 'Meninggalkan Kantor (Lembur)'),
((SELECT id FROM u WHERE nama='Dewi Lembur' LIMIT 1), CURRENT_DATE, '18:30:00', 'Istirahat Masuk', 'Jarak: 2m dari Zieda Pusat', 'Istirahat', 'Sesuai', 0, 0, 'Kembali ke Kantor (Lembur)'),
((SELECT id FROM u WHERE nama='Dewi Lembur' LIMIT 1), CURRENT_DATE, '21:30:00', 'Absen Pulang Pagi', 'Jarak: 5m dari Zieda Pusat', 'Lembur', 'Sesuai', 0, 330, 'Lembur 5j 30m')
ON CONFLICT DO NOTHING;

GRANT ALL ON SCHEMA _realtime TO postgres, supabase_admin;
GRANT ALL ON ALL TABLES IN SCHEMA _realtime TO postgres, supabase_admin;
