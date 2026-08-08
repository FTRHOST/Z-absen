if (typeof window !== "undefined") {
  window.ENV = window.ENV || {};
}

// Helper membaca variabel dari window.ENV / process.env
function getEnv(key) {
  if (typeof window !== "undefined" && window.ENV && window.ENV[key]) return window.ENV[key];
  if (typeof process !== "undefined" && process.env && process.env[key]) return process.env[key];
  return "";
}

// ==========================================
// KONFIGURASI KONEKSI SUPABASE
// ==========================================
// Membaca SUPABASE_URL & ANON_KEY dari .env / Docker / window.ENV
const rawSupabaseUrl =
  getEnv("SUPABASE_URL") ||
  (typeof window !== "undefined" && window.location.origin
    ? window.location.origin
    : "http://127.0.0.1:54321");

// Hapus trailing slash '/' di akhir URL agar konsisten dan mencegah isu double slash (//) serta logout berulang
const SUPABASE_URL = rawSupabaseUrl.replace(/\/+$/, "");

const SUPABASE_ANON_KEY =
  getEnv("SUPABASE_ANON_KEY") ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const TELEGRAM_CHAT_ID = getEnv("TELEGRAM_CHAT_ID") || "-1004380194522";
const TELEGRAM_BOT_TOKEN = getEnv("TELEGRAM_BOT_TOKEN") || "";

// ==========================================
// AUTO DETEKSI PERUBAHAN URL & LOGOUT OTOMATIS
// ==========================================
(function checkUrlChangeAndAutoLogout() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const previousUrl = (localStorage.getItem('LAST_SUPABASE_URL') || '').replace(/\/+$/, "");
    
    if (previousUrl && previousUrl !== SUPABASE_URL) {
      console.info(`🔄 [Zieda Absen] Perubahan URL database terdeteksi (${previousUrl} -> ${SUPABASE_URL}). Membersihkan sesi lama...`);
      
      localStorage.removeItem('userLogin');
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') || key.includes('supabase')) {
          localStorage.removeItem(key);
        }
      });
      
      localStorage.setItem('LAST_SUPABASE_URL', SUPABASE_URL);
      
      if (!window.location.href.includes('login.html')) {
        window.location.href = 'login.html?env_changed=true';
      }
    } else {
      localStorage.setItem('LAST_SUPABASE_URL', SUPABASE_URL);
    }
  } catch(e) {
    console.warn("Auto logout error check:", e);
  }
})();

// Inisialisasi Klien Supabase secara global
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Mematikan Realtime WebSocket secara permanen untuk mencegah error 'WebSocket connection to wss://... failed' di browser
if (typeof window !== "undefined" && supabaseClient && supabaseClient.realtime) {
  try {
    supabaseClient.realtime.disconnect();
  } catch (e) {
    console.warn("Realtime disconnect:", e);
  }
}

// ==========================================
// DYNAMIC IMAGE URL NORMALIZER
// ==========================================
// Memperbaiki URL gambar dari server lama/mati secara otomatis ke SUPABASE_URL aktif
function fixStorageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('data:')) return url; // Base64 image
    
    // Normalisasi double slash opsional
    const cleanUrl = url.replace(/([^:]\/)\/+/g, "$1");
    
    // Cari penanda bucket di URL (misal: /absensi-bucket/)
    const bucketMarker = '/absensi-bucket/';
    const idx = cleanUrl.indexOf(bucketMarker);
    if (idx !== -1) {
        const pathAfterBucket = cleanUrl.substring(idx + bucketMarker.length).replace(/^\/+/, '');
        return `${SUPABASE_URL}/storage/v1/object/public/absensi-bucket/${pathAfterBucket}`;
    }
    
    return cleanUrl;
}
