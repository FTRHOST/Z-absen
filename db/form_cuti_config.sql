-- Silakan jalankan script SQL ini di menu "SQL Editor" pada Supabase Anda

-- 1. (OPSIONAL) Jika Anda menghapus tabel cuti lama, jalankan ini untuk membuat tabel cuti yang baru dan sempurna.
-- Jika tabel cuti masih ada, Anda bisa mengabaikan blok CREATE TABLE cuti ini.
CREATE TABLE IF NOT EXISTS cuti (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    tanggal_mulai date NOT NULL,
    tanggal_selesai date NOT NULL,
    alasan text,
    durasi_hari integer NOT NULL,
    status_pengajuan text DEFAULT 'Menunggu',
    data_tambahan jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- (Bila tabel cuti sudah ada, jalankan ini untuk memastikan kolom tambahan tersedia)
ALTER TABLE cuti ADD COLUMN IF NOT EXISTS data_tambahan jsonb DEFAULT '{}'::jsonb;
ALTER TABLE cuti ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();


-- 2. Membuat tabel untuk menyimpan konfigurasi (struktur) form cuti dinamis
CREATE TABLE IF NOT EXISTS form_cuti_config (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    label text NOT NULL,
    tipe text NOT NULL, -- Contoh: 'date', 'dropdown', 'file', 'keterangan'
    opsi text, -- Untuk menyimpan pilihan dropdown, atau kondisi tampil (cth: Jenis Cuti=Sakit|Lainnya)
    wajib boolean DEFAULT true,
    urutan integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

-- 3. Menambahkan beberapa form bawaan (default) sebagai contoh awal
INSERT INTO form_cuti_config (label, tipe, opsi, wajib, urutan)
VALUES 
('Tanggal Mulai', 'date', '', true, 1),
('Tanggal Selesai', 'date', '', true, 2),
('Jenis Cuti', 'dropdown', 'Cuti Bulanan,Sakit,Lainnya', true, 3),
('Surat Bukti Sakit', 'file', 'Jenis Cuti=Sakit', true, 4),
('Keterangan / Alasan', 'keterangan', 'Jenis Cuti!=Sakit|Cuti Bulanan', true, 5);
