export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(`window.ENV = {
  SUPABASE_URL: "${process.env.SUPABASE_URL || ''}",
  SUPABASE_ANON_KEY: "${process.env.SUPABASE_ANON_KEY || ''}",
  TELEGRAM_CHAT_ID: "${process.env.TELEGRAM_CHAT_ID || ''}",
  TELEGRAM_BOT_TOKEN: "${process.env.TELEGRAM_BOT_TOKEN || ''}"
};`);
}
