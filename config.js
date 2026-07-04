// ==========================================
// KONFIGURASI SUPABASE (Pengganti .env)
// ==========================================
// Ganti URL dan KEY di bawah ini dengan kredensial Supabase Anda
const SUPABASE_URL = "https://kusxlgjcmfhxzflwcqyi.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1c3hsZ2pjbWZoeHpmbHdjcXlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODU0MDIsImV4cCI6MjA5ODc2MTQwMn0.AfIhn7dvGxwoiwrprGcCdysu1Ew3FLo2NZtl591T2Wc";

// Inisialisasi Klien Supabase secara global
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
