-- Silakan jalankan script SQL ini di menu "SQL Editor" pada Supabase Anda

CREATE TABLE IF NOT EXISTS master_jenis_cuti (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nama_cuti text NOT NULL,
    is_unlimited boolean DEFAULT false,
    batas_hari integer DEFAULT 0, -- Diabaikan jika is_unlimited = true
    siklus text DEFAULT 'Tahunan', -- 'Bulanan', 'Tahunan', 'Sekali'
    created_at timestamp with time zone DEFAULT now()
);

-- Masukkan beberapa data default (Contoh)
INSERT INTO master_jenis_cuti (nama_cuti, is_unlimited, batas_hari, siklus)
VALUES 
('Cuti Bulanan', false, 1, 'Bulanan'),
('Sakit', true, 0, 'Tahunan'),
('Lainnya', true, 0, 'Tahunan');
