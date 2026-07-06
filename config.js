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
// KONFIGURASI TELEGRAM BOT
// ==========================================
const TELEGRAM_BOT_TOKEN = "8928448687:AAHZx5XMiGe2wDrEPyS77FvEy2wCgqtx0iM";
const TELEGRAM_CHAT_ID = "-5348785847";
