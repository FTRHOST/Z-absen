// ==========================================
// KONFIGURASI SUPABASE (Pengganti .env)
// ==========================================
// Ganti URL dan KEY di bawah ini dengan kredensial Supabase Anda
const SUPABASE_URL = "https://ddapevcpuvoduaawhkxz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkYXBldmNwdXZvZHVhYXdoa3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyOTE4ODQsImV4cCI6MjA5ODg2Nzg4NH0.bbBQSy-b5QP3gvFNt35FdXQaE5RXrU2lj9NznXmt6z0";

// Inisialisasi Klien Supabase secara global
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// KONFIGURASI TELEGRAM BOT (Aman di Frontend)
// ==========================================
// Token bot disimpan secara rahasia di Supabase Secrets
// Production Chat ID: "-5348785847" | Testing Chat ID: "-5585540383"
const TELEGRAM_CHAT_ID_PROD = "-5348785847";
const TELEGRAM_CHAT_ID_TEST = "-5585540383";

// Deteksi otomatis environment:
// Jika diakses via localhost / 127.0.0.1 / port 8080 / url param ?env=test, gunakan ID Testing.
// Saat di-merge ke main & berjalan di domain production, otomatis beralih ke ID Production (-5348785847).
const isLocalTesting =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.port === "8080" ||
    window.location.search.includes("env=test"));

const TELEGRAM_CHAT_ID = isLocalTesting
  ? TELEGRAM_CHAT_ID_TEST
  : TELEGRAM_CHAT_ID_PROD;
