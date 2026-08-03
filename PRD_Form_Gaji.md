# Product Requirements Document (PRD)

**Nama Fitur:** Export/Cetak Form Gaji Mingguan (Timesheet PDF/Print)  
**Proyek:** Zieda Absen (Sistem Informasi Kehadiran)  
**Dokumen Versi:** 1.0  
**Referensi Layout:** `FORM GAJI MINGGU 26 Juli 2025.pdf`

---

## 1. Ringkasan Eksekutif (Executive Summary)
Sistem saat ini telah memiliki fitur rekap absensi bulanan. Namun, untuk kebutuhan *Payroll* (penggajian) mingguan pabrik/operasional, HRD membutuhkan format cetak khusus ("Scan Log - Gaji Minggu"). Fitur ini akan membuat *generate* laporan berbentuk blok/kartu per karyawan yang menampilkan 4 log waktu (Masuk, Istirahat, Kembali, Pulang) selama 7 hari, lengkap dengan kalkulasi total jam kerja, lembur, keterlambatan, dan jumlah hari masuk untuk mempermudah perhitungan gaji manual.

## 2. Tujuan & Sasaran (Objectives)
*   Mengotomatisasi pembuatan Form Gaji Mingguan yang selama ini direkap secara manual.
*   Menyediakan format yang ramah cetak (Printer-Friendly / Export to PDF) sesuai dengan standar fisik yang biasa ditandatangani oleh karyawan.
*   Menghitung otomatis variabel penggajian: Hari Kerja, Total Jam, Total Lembur, dan Total Telat.

## 3. Ruang Lingkup (Scope)
**Termasuk (In-Scope):**
*   Penambahan menu/tombol "Cetak Form Gaji Mingguan" di halaman Admin.
*   Filter pemilih tanggal (Date Range Picker) khusus untuk 1 minggu (7 hari).
*   Logika Javascript untuk mengkalkulasi waktu spesifik:
    *   Waktu 1: `Absen Masuk`
    *   Waktu 2: `Istirahat Keluar`
    *   Waktu 3: `Istirahat Masuk`
    *   Waktu 4: `Absen Pulang`
    *   Waktu 5: Total Jam Harian
*   Halaman HTML statis baru (misal: `print-gaji.html`) dengan CSS khusus Media Print (A4/F4) untuk layout blok per karyawan.

**Tidak Termasuk (Out-of-Scope):**
*   Perhitungan nominal uang/Rupiah (Fitur ini murni mencetak Timesheet / Log waktu, bukan sistem accounting penuh).

## 4. Kebutuhan Pengguna (User Stories)
*   **Sebagai HRD**, saya ingin memilih rentang tanggal 1 minggu (misal: 19 Juli - 25 Juli), dan menekan tombol cetak, sehingga saya langsung mendapatkan halaman siap print berisi blok absen semua karyawan.
*   **Sebagai HRD**, saya ingin melihat 4 baris waktu absensi dalam satu hari yang bertumpuk ke bawah, sehingga saya bisa memantau jam masuk, keluar istirahat, masuk istirahat, dan pulang dengan mudah.
*   **Sebagai Finance/Payroll**, saya ingin melihat rekap (Total Hari, Total Jam, Total Lembur, Total Telat) di samping kanan setiap blok karyawan, sehingga saya bisa langsung menghitung gajinya.

## 5. Kebutuhan Fungsional (Functional Requirements)

### 5.1. Filter Input
*   Input `Tanggal Mulai` dan `Tanggal Selesai`. (Validasi maksimal selisih 7 hari).
*   Filter Dropdown `Cabang/Departemen` (jika admin ingin mencetak per departemen).

### 5.2. Data Processing & Mapping
Sistem akan membaca `tipe_absen` dari tabel `absensi` dan memetakannya ke 4 baris:
*   **Baris 1:** Tipe yang mengandung kata "Masuk" (bukan istirahat/izin).
*   **Baris 2:** Tipe yang mengandung kata "Istirahat Keluar" atau "Izin Keluar".
*   **Baris 3:** Tipe yang mengandung kata "Istirahat Masuk" atau "Izin Masuk".
*   **Baris 4:** Tipe yang mengandung kata "Pulang" atau "Checkout".

### 5.3. Algoritma Kalkulasi
*   **Jam Harian:** `(Baris 4 - Baris 1) - (Baris 3 - Baris 2)`. Format output: `H:MM`.
*   **Jumlah Hari:** Count dari hari di mana `Baris 1` tidak kosong. Jika karyawan masuk setengah hari, dihitung `0.5`.
*   **Jumlah Jam/Mnt (Mingguan):** Sum dari Jam Harian selama 7 hari. Format: `XX Jam YY Mnt`.
*   **Jumlah Telat & Lembur:** Sum dari kolom `menit_terlambat` dan `menit_lembur`. Konversi ke Jam & Menit.
*   **Catatan:** Ambil dari tabel `cuti` jika karyawan memiliki status cuti/izin/sakit di minggu tersebut, atau ambil dari `keterangan_waktu`.

### 5.4. User Interface (Print Layout)
*   Gunakan CSS `@media print`.
*   Sembunyikan elemen Navbar, Tombol, dan Footer saat dicetak.
*   Buat struktur tabel berulang (1 tabel untuk 1 karyawan).
*   Tabel terdiri dari:
    *   Header: Tanggal dan Hari (Minggu - Sabtu).
    *   Body: 5 Baris Data Waktu.
    *   Footer Tabel/Side Panel: Nama, Dept, Jumlah Hari, Jumlah Jam, Lembur, Telat, dan Kotak Tanda Tangan.

## 6. Kriteria Penerimaan (Acceptance Criteria)
*   [ ] Terdapat tombol "Cetak Form Gaji Mingguan" di tab Rekap Absensi Admin.
*   [ ] Ketika diklik, terbuka halaman baru yang menampilkan layout persis seperti referensi PDF.
*   [ ] Total Jam, Hari, Lembur, dan Telat terhitung secara akurat sesuai data di Supabase.
*   [ ] Apabila halaman tersebut di-print (`CTRL+P`), layout tidak pecah dan terbagi rapi ke dalam ukuran kertas A4.
