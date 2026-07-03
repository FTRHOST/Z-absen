// ==========================================
// KONFIGURASI SUPABASE (Pengganti .env)
// ==========================================
// Ganti URL dan KEY di bawah ini dengan kredensial Supabase Anda
const SUPABASE_URL = "https://mawpodhjvqwdpajkpuen.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hd3BvZGhqdnF3ZHBhamtwdWVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NzQ3MjIsImV4cCI6MjA5ODU1MDcyMn0.mWjwKaB0ScJsOMefmVKj3Zpbv4k4EdDW5KqjMWAeoxs";

// Inisialisasi Klien Supabase secara global
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
