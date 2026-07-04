# Dokumentasi Teknis - Zieda Absen (Untuk IT/Developer)

Dokumentasi ini ditujukan bagi tim IT atau Developer yang bertugas mengelola, memelihara, dan melakukan instalasi sistem Zieda Absen.

## 1. Arsitektur Sistem

Aplikasi ini menggunakan arsitektur **Serverless / BaaS (Backend as a Service)** dengan pembagian kerja sebagai berikut:
- **Frontend (Klien):** HTML5, CSS3 (Vanilla & Bootstrap 5), dan JavaScript (Vanilla). Berjalan secara statis tanpa butuh server Node.js/PHP.
- **Backend & Database:** **[Supabase](https://supabase.com/)** (PostgreSQL, Supabase Auth, dan Supabase Storage).
- **Waktu Server:** Frontend mengambil verifikasi waktu dari API independen (`https://timeapi.io`) untuk mencegah kecurangan *Time Spoofing* oleh perangkat karyawan.

## 2. Struktur Database (Schema)

Sistem menggunakan 6 tabel utama di PostgreSQL:
1. `users`: Profil karyawan (Nama, Role, No HP, Cabang, Sisa Cuti, dll).
2. `absensi`: Rekaman jam masuk, keluar, dan istirahat karyawan beserta lokasinya.
3. `cuti`: Rekaman pengajuan cuti beserta alasannya.
4. `cabang`: Master data cabang perusahaan.
5. `form_cuti_config`: Konfigurasi *form builder* dinamis untuk pengajuan cuti.
6. `app_settings`: Pengaturan nama aplikasi.

*Catatan: Autentikasi (Sistem Login) sepenuhnya ditangani oleh skema bawaan Supabase yaitu `auth.users`.*

## 3. Sistem Keamanan (Enterprise-Grade Security)

Aplikasi ini telah diaudit dan mengimplementasikan berbagai lapis keamanan:
- **Row Level Security (RLS):** Operasi DML (Insert, Update, Delete) pada tabel-tabel utama dikunci dan mewajibkan otentikasi JWT (JSON Web Token) yang valid (`auth.role() = 'authenticated'`).
- **API Key Leak Protection:** `SUPABASE_ANON_KEY` aman untuk dipublikasikan ke klien. Klien tidak bisa membaca data sensitif orang lain karena diblokir oleh kebijakan RLS.
- **Anti-Bypass UI:** Pengecekan role Super Admin / HR tidak lagi mempercayai `localStorage` secara mentah, melainkan melakukan validasi silang (cross-check) ke database menggunakan JWT Session bawaan Supabase.
- **Secure RPC Functions:** Aplikasi tidak diberikan izin akses langsung ke tabel `users` untuk membuat data. Semuanya di-handle menggunakan fungsi *PostgreSQL RPC* (`create_new_employee`) yang menggunakan level akses `SECURITY DEFINER`.

## 4. Panduan Instalasi Baru (Fresh Install)

Jika Anda harus menginstal atau memindahkan sistem ini ke Project Supabase yang benar-benar baru, ikuti urutan berikut:

1. **Buat Project Supabase Baru**
   Buat akun/proyek baru di dashboard Supabase.

2. **Eksekusi Script Starter SQL**
   Buka menu **SQL Editor**, *copy* dan *paste* seluruh isi dari file `db/01_starter_schema.sql`. Tekan **Run**.
   Script ini akan men-generate:
   - Semua Tabel Utama dan Relasinya.
   - Keamanan RLS (Row Level Security) yang sangat ketat.
   - Kebijakan Storage Bucket (`absensi-bucket`).
   - Fungsi `link_my_account` (RPC) untuk pendaftaran karyawan otomatis.

3. **Buat Akun Super Admin (Manual)**
   Karena larangan ketat keamanan Supabase versi terbaru, akun admin pertama **wajib** dibuat secara manual:
   - Buka menu **Authentication -> Users** di dashboard Supabase.
   - Klik **Add User -> Create new user**.
   - Masukkan Email: `admin@zieabsen.internal` dan Password (bebas, misal: `admin123`). Hapus centang "Auto Confirm Email". Klik Create.
   - Klik tombol kotak kecil untuk **Copy UUID (User ID)** akun tersebut.
   - Buka **SQL Editor** dan jalankan perintah ini (ganti UUID-nya):
     ```sql
     INSERT INTO public.users (nama, password, role, auth_id, cabang)
     VALUES ('admin', 'admin123', 'Super Admin', 'PASTE_UUID_DISINI', 'Pusat');
     ```

4. **Konfigurasi URL & API Key**
   Buka menu **Project Settings -> API** di Supabase.
   *Copy* `Project URL` dan `anon/public key`.
   Buka file `config.js` di dalam source code aplikasi, lalu *paste* nilainya pada variabel `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.

5. **Testing**
   Jalankan file HTML di browser (atau gunakan server lokal ringan seperti Live Server). Login dengan akun `admin` dan sandi `admin123`. Selesai!

## 5. Panduan Backup dan Pemulihan (Disaster Recovery)
Aplikasi memiliki menu bawaan untuk IT: **"Zona Bahaya"** di dalam panel Admin.
- **Backup Database:** Mengekspor seluruh data absensi, pengguna, dan cuti ke dalam format ber-enkripsi JSON (Otomatis ZIP). Fitur ini memiliki sistem *auto-batching* untuk mencegah *hang* pada RAM browser.
- **Factory Reset:** Berfungsi untuk membersihkan seluruh transaksi database ke titik nol (kecuali akun admin yang sedang login). Sangat berguna saat akan men-*deploy* aplikasi dari *Staging* ke *Production*.

---
*Dokumentasi ini di-generate pada Juli 2026. Harap perbarui file ini jika Anda melakukan perubahan besar pada struktur database.*
