export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, chat_id, photo_url } = req.body || {};
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chat_id || process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN belum diisi pada Vercel Environment Variables.' });
  }

  if (!targetChatId) {
    return res.status(400).json({ error: 'TELEGRAM_CHAT_ID tidak ditemukan.' });
  }

  try {
    const apiEndpoint = photo_url ? 'sendPhoto' : 'sendMessage';
    const payloadObj = photo_url 
      ? { chat_id: targetChatId, photo: photo_url, caption: message, parse_mode: 'HTML' }
      : { chat_id: targetChatId, text: message, parse_mode: 'HTML' };

    const telegramResp = await fetch(`https://api.telegram.org/bot${botToken}/${apiEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadObj)
    });

    const data = await telegramResp.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Gagal mengirim pesan Telegram' });
  }
}
