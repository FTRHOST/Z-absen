require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const puppeteer = require('puppeteer');
const axios = require('axios');
const FormData = require('form-data');

// 1. Menginisialisasi koneksi ke Supabase menggunakan environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.");
  process.exit(1);
}

// Polyfill WebSocket untuk Node.js < 22 karena supabase-js membutuhkannya
global.WebSocket = require('ws');

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. Fungsi untuk mengambil waktu hari ini dengan timezone Asia/Jakarta
function getTodayJakarta() {
  // Gunakan Intl.DateTimeFormat agar format sesuai dengan zona waktu Indonesia (id-ID)
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' };
  const formatter = new Intl.DateTimeFormat('id-ID', options);
  const parts = formatter.formatToParts(new Date());

  let weekdayName = '';
  let dateNumber = 0;

  parts.forEach(({ type, value }) => {
    if (type === 'weekday') weekdayName = value; // contoh: 'Jumat'
    if (type === 'day') dateNumber = parseInt(value, 10); // contoh: 16
  });

  // Sesuaikan jika id-ID mengembalikan 'Minggu' bukan 'Ahad', dll. Biasanya format baku.
  return { dayName: weekdayName, dateNum: dateNumber };
}

async function main() {
  // 3. Mengekstrak hari dan tanggal dari waktu saat ini
  const { dayName, dateNum } = getTodayJakarta();
  console.log(`🚀 Memulai pengecekan payroll...`);
  console.log(`📅 Hari/Tanggal Jakarta: ${dayName}, ${dateNum}`);

  // 4. Melakukan query ke Supabase
  // Mengambil jadwal_gajian beserta data relasi (karyawan/users)
  const { data: jadwal, error } = await supabase
    .from('jadwal_gajian')
    .select(`
      id,
      tipe_gajian,
      hari_tanggal_gajian,
      karyawan_id,
      users ( id, nama, no_hp, role, cabang )
    `);

  if (error) {
    console.error("❌ Gagal mengambil data jadwal dari Supabase:", error.message);
    process.exit(1);
  }

  console.log("DEBUG: Data jadwal dari DB:", JSON.stringify(jadwal, null, 2));

  // Logika pencocokan array/string untuk tipe gajian
  // Diasumsikan hari_tanggal_gajian berbentuk JSONB array seperti: ["Jumat"] atau [1, 16]
  const matchedPayroll = jadwal.filter(item => {
    // Pastikan field JSONB berbentuk array untuk mempermudah pengecekan
    let jadwalData = item.hari_tanggal_gajian;
    if (!Array.isArray(jadwalData)) {
      // Jika ternyata bentuknya bukan array (misal string/integer satuan), bungkus ke array
      jadwalData = [jadwalData];
    }

    if (item.tipe_gajian === 'mingguan') {
      // Pencocokan berdasarkan nama hari
      return jadwalData.includes(dayName);
    } else if (item.tipe_gajian === 'dwimingguan' || item.tipe_gajian === 'bulanan') {
      // Pencocokan berdasarkan angka tanggal
      return jadwalData.includes(dateNum);
    }

    return false;
  });

  // 5. Tampilkan data karyawan yang cocok
  if (matchedPayroll.length === 0) {
    console.log("ℹ️ Tidak ada karyawan yang jadwal gajiannya jatuh pada hari ini.");
    return;
  }

  console.log(`\n✅ Ditemukan ${matchedPayroll.length} karyawan yang gajian hari ini:\n`);

  // Kelompokkan karyawan berdasarkan tipe_gajian agar rentang tanggalnya akurat per grup
  const groupedPayroll = {};
  
  // Ambil filter cabang dari env jika ada (untuk filter data utama)
  const targetCabang = process.env.TARGET_CABANG;
  
  // Ambil list cabang yang ingin dipisah PDF-nya (pisahkan dengan koma)
  // Contoh: SEPARATED_BRANCHES="Zieda Pusat,Cabang Weleri"
  const separatedBranchesStr = process.env.SEPARATED_BRANCHES || "";
  const separatedBranches = separatedBranchesStr.split(',').map(s => s.trim()).filter(Boolean);

  matchedPayroll.forEach((payroll, index) => {
    const user = payroll.users || { nama: 'Unknown', id: payroll.karyawan_id };
    const cabangName = user.cabang || 'Pusat';
    
    // Jika TARGET_CABANG diset, lewati karyawan yang bukan dari cabang tersebut
    if (targetCabang && user.cabang !== targetCabang) {
      return;
    }

    console.log(`${index + 1}. Nama: ${user.nama} (ID: ${user.id})`);
    console.log(`   Tipe Gajian: ${payroll.tipe_gajian}`);
    console.log(`   Jadwal Terdaftar: ${JSON.stringify(payroll.hari_tanggal_gajian)}`);
    console.log(`   No. HP: ${user.no_hp} | Cabang: ${cabangName}`);
    console.log(`   -----------------------------------------`);
    
    // Tentukan nama grup cabangnya. Jika masuk list SEPARATED_BRANCHES, maka ia berdiri sendiri.
    // Jika tidak, ia digabung ke grup "Semua Cabang"
    let groupCabang = "Semua Cabang";
    if (separatedBranches.includes(cabangName)) {
      groupCabang = cabangName;
    }
    
    // Kelompokkan HANYA berdasarkan Grup Cabang terlebih dahulu
    if (!groupedPayroll[groupCabang]) {
      groupedPayroll[groupCabang] = {};
    }
    
    // Lalu pisahkan tipe_gajian di dalamnya
    if (!groupedPayroll[groupCabang][payroll.tipe_gajian]) {
      groupedPayroll[groupCabang][payroll.tipe_gajian] = [];
    }
    
    groupedPayroll[groupCabang][payroll.tipe_gajian].push(payroll);
  });

  if (Object.keys(groupedPayroll).length === 0) {
    console.log(`ℹ️ Tidak ada karyawan dari cabang "${targetCabang}" yang gajian hari ini.`);
    return;
  }

  console.log(`⏳ Sedang memproses PDF Laporan Gaji berdasarkan kelompok tipe gajian...`);

  // Proses setiap kelompok cabang
  for (const [groupCabang, tipeGroup] of Object.entries(groupedPayroll)) {
    try {
      console.log(`\nMemproses Grup Cabang: ${groupCabang}`);
      
      const mergedPdf = await PDFDocument.create();
      let allMulai = null;
      let allSelesai = null;
      let listSemuaNama = [];
      let listSemuaTipe = [];
      let listRealCabang = new Set();
      
      // Loop untuk setiap tipe gajian di dalam cabang tersebut (mingguan, bulanan)
      for (const [tipeGajian, payrolls] of Object.entries(tipeGroup)) {
        console.log(` - Membuat PDF Tipe: ${tipeGajian.toUpperCase()} (${payrolls.length} Karyawan)`);
        
        const { strMulai, strSelesai } = hitungRentangTanggal(tipeGajian);
        
        // Pass tipeGajian ke generatePDF untuk mengubah header HTML
        const pdfBuffer = await generatePDF(payrolls, strMulai, strSelesai, groupCabang, tipeGajian.toUpperCase());
        
        // Load PDF ke pdf-lib dan gabungkan halamannya
        const pdfToMerge = await PDFDocument.load(pdfBuffer);
        const copiedPages = await mergedPdf.copyPages(pdfToMerge, pdfToMerge.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        
        // Kumpulkan Metadata
        if (!allMulai || strMulai < allMulai) allMulai = strMulai;
        if (!allSelesai || strSelesai > allSelesai) allSelesai = strSelesai;
        listSemuaTipe.push(tipeGajian.toUpperCase());
        payrolls.forEach(p => {
          if (p.users && p.users.nama) listSemuaNama.push(p.users.nama);
          if (p.users && p.users.cabang) listRealCabang.add(p.users.cabang);
        });
      }
      
      const finalPdfBytes = await mergedPdf.save();
      const finalPdfBuffer = Buffer.from(finalPdfBytes);
      
      const sanitizedCabang = groupCabang.replace(/[^a-zA-Z0-9]/g, '_');
      const tipeString = listSemuaTipe.join('_');
      const pdfFilename = `LAPORAN_${sanitizedCabang}_${tipeString}_${allMulai}_sd_${allSelesai}.pdf`;
      
      const unikNama = [...new Set(listSemuaNama)].join(', ');
      const captionText = `[LAPORAN ABSENSI]\nCabang: ${groupCabang === 'Semua Cabang' ? [...listRealCabang].join(', ') : groupCabang}\nTipe: ${listSemuaTipe.join(', ')}\nTanggal: ${allMulai} s/d ${allSelesai}\nNama: ${unikNama}`;
      
      // Simpan ke lokal untuk dilihat
      fs.writeFileSync(path.join(__dirname, '..', pdfFilename), finalPdfBuffer);
      console.log(`💾 PDF Gabungan tersimpan di ${pdfFilename} (Ukuran: ${finalPdfBuffer.length} bytes)`);
      
      // Kirim PDF langsung ke Telegram
      await sendToTelegram(finalPdfBuffer, pdfFilename, captionText);
    } catch (err) {
      console.error(`❌ Gagal memproses grup cabang ${groupCabang}:`, err.message);
    }
  }
}

// Fungsi bantu untuk menghitung rentang tanggal dinamis
function hitungRentangTanggal(tipeGajian) {
  const todayObj = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  
  const selesaiObj = new Date(todayObj);
  selesaiObj.setDate(selesaiObj.getDate() - 1); // Kemarin
  
  const mulaiObj = new Date(todayObj);
  
  if (tipeGajian === 'mingguan') {
    mulaiObj.setDate(mulaiObj.getDate() - 7); // 7 hari yang lalu
  } else if (tipeGajian === 'dwimingguan') {
    mulaiObj.setDate(mulaiObj.getDate() - 15); // Sekitar 15 hari yang lalu
  } else if (tipeGajian === 'bulanan') {
    mulaiObj.setMonth(mulaiObj.getMonth() - 1); // 1 bulan yang lalu
  }
  
  return {
    strMulai: mulaiObj.toISOString().split('T')[0],
    strSelesai: selesaiObj.toISOString().split('T')[0]
  };
}

// Fungsi untuk mengirim PDF ke bot Telegram
async function sendToTelegram(pdfBuffer, filename, captionText) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Perhatikan: di .env nama variabelnya mungkin TELEGRAM_CHAT_ID atau TELEGRAM_CHANNEL_ID
  const chatId = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID;
  
  if (!token || !chatId) {
    console.error("⚠️  TELEGRAM_BOT_TOKEN atau TELEGRAM_CHANNEL_ID tidak dikonfigurasi. Lewati pengiriman Telegram.");
    return;
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  // Lampirkan buffer langsung tanpa disimpan ke disk (konversi Uint8Array ke Buffer jika diperlukan Puppeteer terbaru)
  form.append('document', Buffer.from(pdfBuffer), { 
    filename: filename, 
    contentType: 'application/pdf' 
  });
  form.append('caption', captionText);

  try {
    console.log(`📤 Mengirim PDF ke Telegram...`);
    await axios.post(`https://api.telegram.org/bot${token}/sendDocument`, form, {
      headers: form.getHeaders(),
    });
    console.log(`✅ Berhasil mengirim slip gaji ke Telegram.`);
  } catch (err) {
    console.error(`❌ Gagal mengirim slip gaji ke Telegram:`, err.response?.data || err.message);
  }
}

// Fungsi untuk merender PDF in-memory menggunakan Puppeteer
async function generatePDF(matchedPayrollArray, strMulai, strSelesai, cabangName, tipeGajianStr) {
  // a. Baca HTML template
  const templatePath = path.join(__dirname, '..', 'print-gaji.html');
  let htmlString = fs.readFileSync(templatePath, 'utf-8');

  // Ganti Header HTML agar menyertakan tipe gajian (MINGGUAN / BULANAN)
  htmlString = htmlString.replace(
    '<h4 class="fw-bold mb-1 tracking-wide text-uppercase" style="letter-spacing: 1px;">ZIEDA ABSEN - LAPORAN</h4>',
    `<h4 class="fw-bold mb-1 tracking-wide text-uppercase" style="letter-spacing: 1px;">ZIEDA ABSEN - LAPORAN (${tipeGajianStr})</h4>`
  );

  // Karena env.js diabaikan dari git (.gitignore), kita suntikkan environment secara dinamis
  // Sekaligus menggunakan SERVICE_ROLE_KEY agar bisa menembus proteksi RLS
  const injectedEnv = `
    <script>
      window.ENV = {
        SUPABASE_URL: '${process.env.SUPABASE_URL}',
        SUPABASE_ANON_KEY: '${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY}',
        GOTENBERG_URL: 'http://localhost:3000'
      };
    </script>
  `;
  htmlString = htmlString.replace('<script src="env.js"></script>', injectedEnv);

  // b. Manipulasi placeholder agar print-gaji.html hanya me-render karyawan yang terpilih
  const userIds = matchedPayrollArray.map(item => item.users?.id || item.karyawan_id).filter(id => id);

  // Override parameter deteksi URL di HTML agar menggunakan tanggal yang kita hitung
  htmlString = htmlString.replace("let paramMulai = urlParams.get('mulai');", `let paramMulai = '${strMulai}';`);
  htmlString = htmlString.replace("let paramSelesai = urlParams.get('selesai');", `let paramSelesai = '${strSelesai}';`);
  htmlString = htmlString.replace("let paramCabang = urlParams.get('cabang') || '';", `let paramCabang = '${cabangName === 'Semua Cabang' ? '' : cabangName}';`);
  
  // Karena script menggunakan 'cabangSelected' juga, injeksi juga secara global jika diperlukan,
  // tapi paramCabang adalah yang digunakan saat initial load HTML.
  // Untuk amannya, kita ganti juga definisi cabangSelected yang mengambil paramCabang.
  // Tapi cukup mengganti paramCabang di atas sudah cukup untuk flow HTML-nya.

  // Ubah query karyawan di HTML untuk hanya menyeleksi id yang gajian hari ini
  const targetQuery = "let qUsers = supabaseClient.from('users').select('id, nama, cabang, unit, role, foto_wajah').order('nama');";
  const replacedQuery = `let qUsers = supabaseClient.from('users').select('id, nama, cabang, unit, role, foto_wajah').in('id', [${userIds.join(',')}]).order('nama');`;
  
  htmlString = htmlString.replace(targetQuery, replacedQuery);

  // Simpan HTML yang sudah dimodifikasi ke file temporary
  const tempHtmlPath = path.join(__dirname, '..', 'temp-print-gaji.html');
  fs.writeFileSync(tempHtmlPath, htmlString);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--allow-file-access-from-files'
    ]
  });

  const page = await browser.newPage();
  
  // Debug: Tangkap pesan dari dalam HTML/Browser
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  
  // Navigasi ke file lokal alih-alih setContent (agar localStorage bekerja dan tidak kena SecurityError)
  await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'domcontentloaded' });
  
  // Tunggu sejenak memastikan skrip AJAX internal HTML selesai merender
  await new Promise(r => setTimeout(r, 4000));

  // Generate PDF menjadi tipe Buffer in-memory
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '15px', right: '15px', bottom: '15px', left: '15px' }
  });

  await browser.close();
  
  // Hapus file temporary
  if (fs.existsSync(tempHtmlPath)) {
    fs.unlinkSync(tempHtmlPath);
  }

  return pdfBuffer;
}

main().catch(err => {
  console.error("🔥 Terjadi kesalahan sistem:", err);
  process.exit(1);
});
