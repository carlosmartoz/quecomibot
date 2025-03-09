// config/config.js
require("dotenv").config();

module.exports = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN,
    webhookUrl: process.env.WEBHOOK_URL,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    assistantId: process.env.ASSISTANT_ID,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
  server: {
    port: process.env.PORT || 3000,
  }
};