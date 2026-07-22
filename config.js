// ==========================================
// KONFIGURASI SUPABASE (Branch: testing - Self-Hosted / Local Sandbox)
// ==========================================
// Kredensial Supabase Lokal (Self-Hosted via Docker)
const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// Inisialisasi Klien Supabase secara global
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// KONFIGURASI TELEGRAM BOT (Branch: testing)
// ==========================================
// ID Grup Telegram Testing: -5585540383
const TELEGRAM_CHAT_ID = "-5585540383";
