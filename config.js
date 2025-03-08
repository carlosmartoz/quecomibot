require('dotenv').config();

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ASSISTANT_ID: process.env.ASSISTANT_ID,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
}; 