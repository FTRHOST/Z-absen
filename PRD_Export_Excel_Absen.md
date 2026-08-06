# Product Requirements Document (PRD)

**Nama Fitur:** Export Rekap Absensi ke Format Excel (Pivot/Matrix)  
**Proyek:** Zieda Absen (Sistem Informasi Kehadiran & Cuti Karyawan)  
**Dokumen Versi:** 1.0  
**Tanggal:** 03 Agustus 2026  

---

## 1. Ringkasan Eksekutif (Executive Summary)
Fitur export absensi saat ini menggunakan format *Flat CSV* (setiap baris mewakili satu transaksi per hari). Format ini seringkali menyulitkan tim HRD untuk membaca data secara horizontal selama satu bulan penuh. Fitur baru ini bertujuan untuk mengubah struktur dan format *export* menjadi file **Excel sejati (.xlsx)** dengan format matriks (Pivot), di mana tanggal menjadi kolom (kiri ke kanan) dan tipe absen menjadi baris di bawah nama masing-masing karyawan, sesuai dengan standar *template* manual HRD (`Contoh Data Absen (1).xlsx`).

## 2. Tujuan & Sasaran (Objectives)
*   **Efisiensi HRD:** Memudahkan tim HRD dan *Payroll* untuk membaca data absensi sebulan penuh dalam satu lembar kerja (Sheet) yang rapi.
*   **Format Standar:** Menyamakan output aplikasi dengan format rekap manual (Excel) yang sudah familiar digunakan oleh perusahaan.
*   **Modernisasi Output:** Beralih dari format `.csv` (yang sering bermasalah dengan delimiter `,` atau `;` di Microsoft Excel) menjadi format asli `.xlsx`.

## 3. Ruang Lingkup (Scope)
**Termasuk (In-Scope):**
*   Penambahan pustaka *SheetJS* (`xlsx.full.min.js`) ke sisi *frontend* aplikasi (`admin.html`).
*   Modifikasi algoritma pembuatan data di `admin.js` (Fungsi `prosesExport`) untuk mengubah array satu dimensi menjadi *Array of Arrays* (AoA) berbasis matriks.
*   Pembuatan file `rekap_absen.xlsx` secara langsung di browser (*client-side*).
*   Penyertaan file Excel tersebut ke dalam kompresi `.zip` jika admin mencentang opsi lampiran *Media/Foto*.

**Tidak Termasuk (Out-of-Scope):**
*   Pengubahan struktur rekap Cuti/Izin (tetap menggunakan CSV untuk kemudahan pembacaan list).
*   Pembuatan file Excel di sisi server/backend (karena arsitektur Zieda Absen adalah *BaaS/Serverless* sepenuhnya menggunakan *frontend-driven export*).

## 4. Kebutuhan Pengguna (User Stories)
*   **Sebagai Admin/HRD**, saya ingin mendownload data absen bulanan ke dalam format Excel (.xlsx), sehingga saya tidak perlu repot mengatur *Text-to-Columns* seperti saat menggunakan CSV.
*   **Sebagai Admin/HRD**, saya ingin melihat tanggal (1, 2, 3... dst) berjajar ke samping sebagai kolom, dan status absen (Masuk, Izin, Pulang, dll) berjajar ke bawah di bawah nama karyawan, sehingga rekap 1 bulan mudah di-review secara visual.

## 5. Kebutuhan Fungsional (Functional Requirements)
1.  **Library Integrations:** 
    Sistem harus memuat library `<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>` pada `admin.html`.
2.  **Header Generator:** 
    Sistem harus mengkalkulasi rentang tanggal dari input *Tanggal Mulai* hingga *Tanggal Selesai*, dan menghasilkan baris header pertama berupa urutan tanggal (contoh: 1, 2, 3... 31).
3.  **Data Grouping:**
    Sistem harus mengelompokkan raw data JSON dari Supabase berdasarkan: `Nama Karyawan` -> `Tanggal` -> `Tipe Absen`.
4.  **Matrix Generation:**
    *   **Baris Nama:** Berisi "Nama Karyawan" di sel pertama, dan sisa sel dikosongkan.
    *   **Baris Tipe Absen:** Berisi nama "Tipe Absen" (misal: "Masuk") di sel pertama, dan nilai "waktu absen" disebar pada indeks array (kolom) yang sesuai dengan tanggal kejadian.
5.  **Output File:**
    Sistem harus mengonversi matriks tersebut menjadi `Blob` berformat `.xlsx` dan memaketkannya (bersama foto, jika ada) ke dalam file `Export_DD-MM-YYYY_sd_DD-MM-YYYY.zip`.

## 6. Kebutuhan Non-Fungsional (Non-Functional Requirements)
*   **Performa:** Proses penyusunan data dari JSON ke Matriks array 2 dimensi harus berjalan mulus di *browser* klien (tanpa membuat browser *hang*) bahkan jika memproses absensi 100 karyawan selama 31 hari.
*   **Fallback Mechanism:** Jika library *SheetJS* gagal dimuat (misal karena jaringan terputus ke CDN), sistem harus otomatis memiliki *fallback* mengekspor format matriks tersebut dalam format `.csv`.

## 7. Kriteria Penerimaan (Acceptance Criteria)
*   [ ] Jika pengguna menekan tombol "Export", sistem berhasil mengunduh file `.zip`.
*   [ ] Di dalam file `.zip` terdapat file bernama `rekap_absen.xlsx`.
*   [ ] Saat `rekap_absen.xlsx` dibuka:
    *   Baris pertama hanya berisi tanggal (angka hari).
    *   Terdapat baris khusus yang hanya berisi nama karyawan di kolom pertama.
    *   Di bawah baris nama karyawan, terdapat rentetan baris tipe absensi (Masuk, Istirahat, Pulang) yang datanya mengisi sel sesuai dengan kolom tanggal kejadian.
*   [ ] Modifikasi kode tidak merusak proses ekstraksi *Media/Foto* jika opsi "sertakan foto" dicentang.
