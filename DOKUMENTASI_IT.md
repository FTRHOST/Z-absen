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
4. `kantor`: Master data cabang/kantor perusahaan (koordinat dan jam kerja).
5. `form_cuti_config`: Konfigurasi *form builder* dinamis untuk pengajuan cuti.
6. `app_settings`: Pengaturan nama aplikasi.

*Catatan: Autentikasi (Sistem Login) sepenuhnya ditangani oleh skema bawaan Supabase yaitu `auth.users`.*

## 3. Sistem Keamanan (Enterprise-Grade Security)

Aplikasi ini telah diaudit dan mengimplementasikan berbagai lapis keamanan:
- **Row Level Security (RLS):** Operasi DML (Insert, Update, Delete) pada tabel-tabel utama dikunci dan mewajibkan otentikasi JWT (JSON Web Token) yang valid (`auth.role() = 'authenticated'`).
- **API Key Leak Protection:** `SUPABASE_ANON_KEY` aman untuk dipublikasikan ke klien. Klien tidak bisa membaca data sensitif orang lain karena diblokir oleh kebijakan RLS.
- **Anti-Bypass UI:** Pengecekan role Super Admin / HR tidak lagi mempercayai `localStorage` secara mentah, melainkan melakukan validasi silang (cross-check) ke database menggunakan JWT Session bawaan Supabase.
- **Secure RPC Functions:** Aplikasi memusatkan operasi krusial pada level *PostgreSQL RPC* dengan `SECURITY DEFINER` (misalnya `link_my_account` untuk pendaftaran otomatis dan `admin_change_password` untuk enkripsi sinkronisasi *password* lintas tabel).

## 4. Panduan Instalasi Baru (Fresh Install)

Jika Anda harus menginstal atau memindahkan sistem ini ke Project Supabase yang benar-benar baru, ikuti urutan berikut:

1. **Buat Project Supabase Baru**
   Buat akun/proyek baru di dashboard Supabase.

2. **Eksekusi Script Starter SQL**
   Buka menu **SQL Editor**, *copy* dan *paste* seluruh isi dari file `db/01_starter_schema.sql`. Tekan **Run**.
   Script ini akan men-generate:
   - Semua Tabel Utama dan Relasinya.
   - Ekstensi kriptografi (`pgcrypto`).
   - Keamanan RLS (Row Level Security) yang sangat ketat.
   - Kebijakan Storage Bucket (`absensi-bucket`).
   - Fungsi `link_my_account` (RPC) untuk pendaftaran karyawan otomatis.
   - Fungsi `admin_change_password` (RPC) untuk penggantian sandi oleh Admin.

3. **Login Sebagai Super Admin Pertama**
   Tidak ada lagi proses manual pembuatan akun (berkat fungsi `link_my_account`). Script otomatis menanamkan satu akun profil master.
   - Buka halaman `login.html` di browser Anda.
   - Masukkan Nama Pengguna: `Super Admin`
   - Masukkan Password: `admin123`
   - Saat Anda menekan Login, sistem akan otomatis membuatkan Kredensial *Supabase Auth* dan menautkannya ke profil `Super Admin`. Sangat praktis!

4. **Konfigurasi URL & API Key**
   Buka menu **Project Settings -> API** di Supabase.
   *Copy* `Project URL` dan `anon/public key`.
   Buka file `config.js` di dalam source code aplikasi, lalu *paste* nilainya pada variabel `SUPABASE_URL` dan `SUPABASE_ANON_KEY`.

5. **Testing**
   Jalankan file HTML di browser (atau gunakan server lokal ringan seperti Live Server). Login dengan akun `Super Admin` dan sandi `admin123`. Selesai!

## 5. Integrasi Notifikasi Telegram (Aman via Edge Functions)

Sistem telah dilengkapi fitur otomatis untuk mengirim notifikasi ke Telegram pada kejadian berikut:
1. Absen Lokasi
2. Absen Foto Wajah / Selfie
3. Pengajuan Cuti / Izin / Sakit

Mengingat bahayanya membocorkan Token Bot di file *Frontend* (`config.js`), arsitektur yang digunakan untuk fitur ini adalah **Supabase Edge Functions**. Server Supabase-lah yang akan memegang Token Bot Anda secara rahasia dan mengirim pesan ke Telegram.

**Panduan Lengkap Setup Telegram Bot:**

**Langkah 1: Persiapan Bot & Chat ID**
1. Buka Telegram, cari **@BotFather**, ketik `/newbot`, ikuti instruksi, dan simpan **Token Bot** yang diberikan.
2. Buat Grup Telegram baru (opsional) atau gunakan obrolan pribadi Anda dengan bot. 
3. *Wajib:* Masukkan bot yang baru Anda buat ke dalam grup tersebut (jika menggunakan grup), ATAU kirimkan pesan `/start` ke bot Anda (jika menggunakan chat pribadi).
4. Dapatkan Chat ID Anda. (Grup ID selalu diawali tanda minus `-`, misalnya `-1005348785847`. Chat ID pribadi adalah angka positif).
5. Masukkan Chat ID tersebut ke dalam file `config.js` pada baris `TELEGRAM_CHAT_ID`.

**Langkah 2: Instalasi Supabase CLI (Jika Belum)**
Buka Terminal/Command Prompt di PC Anda, lalu install Supabase CLI:
- **Windows (via Scoop):** `scoop install supabase`
- **Mac (via Homebrew):** `brew install supabase/tap/supabase`
- **NPM/Node.js:** `npm install -g supabase`

**Langkah 3: Tautkan Proyek & Set Secret**
Di dalam folder proyek ini (lokasi yang sama dengan file `supabase/functions`), jalankan:
1. Login ke akun Supabase Anda:
   ```bash
   supabase login
   ```
2. Hubungkan folder ini ke project Supabase Anda (Ganti `<Project-Ref>` dengan 20 huruf ID project Anda yang ada di URL dasbor Supabase):
   ```bash
   supabase link --project-ref <Project-Ref>
   ```
3. Simpan Token Bot Anda secara aman di server Supabase (Secret):
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN="TOKEN_DARI_BOTFATHER_ANDA"
   ```

**Langkah 4: Deploy Edge Function**
Unggah kode perantara pengirim Telegram ke server Anda dengan menjalankan perintah:
```bash
supabase functions deploy telegram-notif --no-verify-jwt
```
*(Catatan: `--no-verify-jwt` disertakan agar klien dapat memanggil API ini secara publik tanpa perlu melampirkan JWT di header HTTP secara manual).*

Setelah tulisan `Deployed Functions` muncul di terminal, fitur bot Telegram Anda telah resmi berjalan secara aman!

## 6. Panduan Backup dan Pemulihan (Disaster Recovery)
Aplikasi memiliki menu bawaan untuk IT: **"Zona Bahaya"** di dalam panel Admin.
- **Backup Database:** Mengekspor seluruh data absensi, pengguna, dan cuti ke dalam format ber-enkripsi JSON (Otomatis ZIP). Fitur ini memiliki sistem *auto-batching* untuk mencegah *hang* pada RAM browser.
- **Factory Reset:** Berfungsi untuk membersihkan seluruh transaksi database ke titik nol (kecuali akun admin yang sedang login). Sangat berguna saat akan men-*deploy* aplikasi dari *Staging* ke *Production*.

---
*Dokumentasi ini di-generate pada Juli 2026. Harap perbarui file ini jika Anda melakukan perubahan besar pada struktur database.*
