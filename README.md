# Zieda Absen - Sistem Informasi Kehadiran & Cuti Karyawan

Zieda Absen adalah sebuah aplikasi web ringan berbasis Serverless (BaaS) yang dirancang khusus untuk mempermudah HRD (Human Resources Department) dalam melacak absensi, memonitor jam kerja, dan menyetujui pengajuan cuti karyawan secara efisien dan akurat.

## ✨ Fitur Utama

- **📸 Absensi Wajah & GPS (Geotagging):** Karyawan dapat melakukan Absen Masuk dan Keluar (serta istirahat) menggunakan kamera (*selfie*) dan lokasi langsung (*real-time*).
- **⏱️ Anti Time-Spoofing:** Sistem menggunakan validasi API Waktu Global yang terbebas dari kecurangan manipulasi jam di *smartphone* karyawan.
- **📝 Form Cuti Dinamis (Drag & Drop):** HRD dapat menyesuaikan formulir isian pengajuan cuti sesuai kebutuhan perusahaan tanpa harus menyentuh kode.
- **📊 Dashboard HR/Admin Terpusat:** Monitoring yang disajikan dalam bentuk grafik dan statistik kehadiran harian secara langsung (*real-time*).
- **💼 Hak Akses (Role-Based):** Sistem membedakan secara cerdas fitur yang muncul untuk akun Karyawan, akun HRD, dan akun Super Admin.

## 🛠️ Teknologi yang Digunakan

Aplikasi ini sangat efisien karena tidak membutuhkan *server hosting* terpisah untuk Node.js atau PHP (100% *Frontend-Driven* dengan BaaS Backend).

- **Frontend:** HTML5, CSS3, JavaScript Vanilla (Murni).
- **UI/UX Framework:** Bootstrap 5, FontAwesome, SweetAlert2.
- **Backend & Database:** **Supabase** (PostgreSQL, Supabase Auth, Storage).
- **Fitur Tambahan:** FaceAPI.js (Face Recognition), Leaflet.js (Peta Lokasi), JSZip (Ekstraksi Backup).

## 🚀 Panduan Menjalankan Aplikasi (Quick Start)

Untuk mencoba atau menggunakan aplikasi ini untuk perusahaan Anda, silakan ikuti langkah-langkah berikut:

1. **Unduh Proyek**
   Silakan unduh atau *clone* direktori ini ke komputer Anda.

2. **Persiapan Database Supabase**
   - Buat proyek baru di [Supabase](https://supabase.com/).
   - Buka menu **SQL Editor**, lalu *copy* dan *paste* isi file `db/01_starter_schema.sql` untuk membuat tabel, pengaturan keamanan, dan akun *Super Admin* secara otomatis. (Tekan Run).

3. **Konfigurasi API Key**
   Buka menu **Project Settings -> API** di Supabase, salin *Project URL* dan *anon public key*. 
   Buka file `config.js` di proyek Anda dan ganti isinya dengan kunci tersebut.

4. **Jalankan Aplikasi**
   Karena aplikasi ini sepenuhnya menggunakan HTML/JS, Anda bisa langsung membuka `login.html` menggunakan *Live Server* di VS Code, atau meng-host file ini di Github Pages, Vercel, maupun cPanel standar.

5. **Login Pertama Kali**
   Gunakan kredensial yang dibuat otomatis oleh script tadi:
   - **Username:** `admin` (atau `admin@zieabsen.internal`)
   - **Password:** `admin123`

## 📚 Dokumentasi Khusus Tim IT

Bagi para *Developer* atau Administrator IT yang ingin mengelola proyek ini (seperti melakukan *Factory Reset*, audit keamanan data, atau pembaruan keamanan RLS), silakan membaca panduan mendalam di file: 
👉 **[DOKUMENTASI_IT.md](./DOKUMENTASI_IT.md)**

---
*Dibuat untuk sistem tata kelola SDM modern. Segala modifikasi di luar panduan resmi harap diuji coba ulang (testing) pada lingkungan simulasi (staging).*
