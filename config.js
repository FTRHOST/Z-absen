// ==========================================
// KONFIGURASI SUPABASE (Branch: testing - Self-Hosted / Local Sandbox)
// ==========================================
// Kredensial Supabase Lokal (Self-Hosted via Docker)
// Menggunakan same-origin proxy untuk mencegah isu CORS / 302 Redirect di Cloud Shell
const SUPABASE_URL =
  typeof window !== "undefined" && window.location.origin
    ? window.location.origin
    : "http://127.0.0.1:54321";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// Inisialisasi Klien Supabase secara global
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// KONFIGURASI TELEGRAM BOT (Branch: testing)
// ==========================================
// ID Grup Telegram Testing: -5585540383
const TELEGRAM_CHAT_ID = "-5585540383";
