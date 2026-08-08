import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { message, chat_id, photo_url } = await req.json()
    
    // Ambil Token Bot dari Supabase Secrets
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN belum diset di Supabase Secrets')
    }
    
    if (!chat_id) {
      throw new Error('chat_id tidak disertakan dari frontend')
    }

    const apiEndpoint = photo_url ? 'sendPhoto' : 'sendMessage';
    const payloadObj = photo_url
      ? { chat_id: chat_id, photo: photo_url, caption: message, parse_mode: 'HTML' }
      : { chat_id: chat_id, text: message, parse_mode: 'HTML' };

    // Panggil API Telegram secara aman di backend
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/${apiEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloadObj),
    })

    const data = await telegramResponse.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
