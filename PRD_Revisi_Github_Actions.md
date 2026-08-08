# Product Requirements Document (PRD) - Sistem Penggajian Otomatis (Revisi GitHub Actions)

**Disusun Oleh**: Muhammad Fathir Al Faruq
**Proyek**: Sistem Penggajian Terintegrasi Z-Absen
**Tanggal**: Agustus 2026

## 1. Latar Belakang & Tujuan
Saat ini sistem telah menangani manajemen absensi (seperti yang terdapat pada modul `Z-absen-testing`). Untuk melengkapi kapabilitas operasional, diperlukan penambahan modul sistem penggajian (payroll) otomatis. Sistem ini dirancang untuk menangani jadwal gajian karyawan yang sangat dinamis dan memisahkan distribusi slip gaji ke channel Telegram khusus agar tidak tercampur dengan grup log absensi. Mengingat keterbatasan infrastruktur (tidak adanya VPS), sistem otomasi ini akan memanfaatkan GitHub Actions untuk mengeksekusi *cron job* dan proses *rendering* PDF secara *serverless*, menjaga *codebase* tetap tersentralisasi.

## 2. Kebutuhan Fitur Utama (Requirements)

### 2.1. Manajemen Jadwal Gajian Dinamis (Custom Paydays)
Sistem harus memiliki scheduler yang cerdas untuk mengakomodasi jadwal pencairan gaji yang berbeda-beda untuk setiap karyawan. Tipe jadwal yang harus didukung:
*   **Mingguan (Weekly)**:
    *   Setiap hari Jumat.
    *   Setiap hari Minggu.
*   **Dwi-Mingguan (Bi-weekly / Semi-monthly)**:
    *   Setiap tanggal 1 dan 16.
    *   Setiap tanggal 13 dan 29.
*   **Bulanan (Monthly)**:
    *   Setiap tanggal 20.
    *   Setiap tanggal 28.
    *   Setiap tanggal 29.

*Sistem harus secara otomatis mengidentifikasi hari dan tanggal saat ini (mengacu pada timezone Asia/Jakarta), kemudian menyeleksi daftar karyawan yang berhak menerima gaji pada waktu tersebut.*

### 2.2. Notifikasi via Channel Telegram Khusus
*   **Pemisahan Channel**: Notifikasi slip gaji **tidak boleh** dikirim ke grup Telegram absensi yang sudah ada (untuk menghindari spam log absen).
*   Sistem harus nge-push pesan otomatis ke **Channel Telegram Penggajian** yang terdedikasi setiap kali waktu gajian tiba.

### 2.3. Auto-Generate Cetak PDF (Slip Gaji) menggunakan Puppeteer
*   Pada saat waktu gajian ter-trigger, sistem harus otomatis membuat file PDF report gaji menggunakan engine *Puppeteer*.
*   Format dan layout PDF **wajib** identik dengan template UI `print-gaji.html` yang sudah ada [cite: 1]. Sistem akan membaca file lokal ini.
*   File PDF yang di-generate akan dikirim sebagai attachment (dokumen) bersamaan dengan notifikasi ke Channel Telegram tanpa perlu menyimpannya secara permanen di server/storage.

## 3. Spesifikasi Teknis & Arsitektur (Serverless dengan GitHub Actions)

### 3.1. Penyesuaian Database (Supabase/PostgreSQL)
Perlu penambahan struktur pada skema database di tabel `karyawan` (atau membuat tabel relasi `jadwal_gajian`):
*   `tipe_gajian` (Enum: `mingguan`, `dwimingguan`, `bulanan`)
*   `hari_tanggal_gajian` (String/Array: misal `["Jumat"]`, `[1, 16]`, `[28]`)

### 3.2. Script Utama Node.js (Orkestrasi)
Sebuah script Node.js (misal: `scripts/generate-payroll.js`) akan dibuat di dalam repository. Script ini bertugas:
1.  **Koneksi Database:** Menggunakan `@supabase/supabase-js` untuk mengambil data karyawan yang jadwalnya sesuai hari ini.
2.  **Render PDF:** Membaca file lokal `print-gaji.html` [cite: 1], menginjeksikan data gaji karyawan ke dalam HTML, dan menggunakan library `puppeteer` untuk merendernya menjadi *Buffer* PDF in-memory.
3.  **Kirim Telegram:** Menggunakan `axios` atau `node-fetch` dipadukan dengan `form-data` untuk memanggil endpoint `sendDocument` API Telegram, mengirimkan *Buffer* PDF ke Channel Telegram yang dituju.

### 3.3. Scheduler / Cron Job (GitHub Actions)
*   Sistem menggunakan fitur *cron schedule* dari GitHub Actions (file konfigurasi `.github/workflows/payroll.yml`).
*   Workflow ini akan mengatur *runner* Ubuntu, menginstal Node.js dan *dependencies*, lalu mengeksekusi script `generate-payroll.js` secara otomatis setiap hari (misal pukul 08:00 WIB / 01:00 UTC).
*   *Secrets* seperti `SUPABASE_URL`, `SUPABASE_KEY`, `TELEGRAM_BOT_TOKEN`, dan `TELEGRAM_CHANNEL_ID` akan disimpan secara aman di GitHub Secrets dan disuntikkan sebagai *Environment Variables* saat *runner* berjalan.

## 4. Alur Kerja Otomasi (Workflow)
1. **Trigger GitHub Actions**: Workflow berjalan sesuai *cron schedule* harian.
2. **Eksekusi Script Node.js**: Workflow menjalankan `generate-payroll.js`.
3. **Filter Data (Supabase)**: Script memeriksa hari/tanggal (WIB) dan menarik data karyawan yang cocok.
4. **Iterasi & Render (Puppeteer)**: Untuk setiap karyawan yang lolos filter, script merender template lokal `print-gaji.html` [cite: 1] menjadi buffer PDF.
5. **Push Notification (Telegram)**: Script mengirim PDF tersebut ke Channel Telegram Penggajian.
6. **Selesai**: GitHub Actions mencatat log eksekusi berhasil/gagal.

## Referensi
* [1] File codebase eksisting: `Z-absen-testing/print-gaji.html`
