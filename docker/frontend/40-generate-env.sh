#!/bin/sh
# Generator file env.js untuk Frontend Zieda Absen di Docker

cat <<EOF > /tmp/env.js
window.ENV = {
  SUPABASE_URL: "${SUPABASE_URL:-}",
  SUPABASE_ANON_KEY: "${SUPABASE_ANON_KEY:-}",
  TELEGRAM_CHAT_ID: "${TELEGRAM_CHAT_ID:-}"
};
EOF

echo "[Zieda Absen] env.js berhasil di-generate dari Docker Environment Variables."
