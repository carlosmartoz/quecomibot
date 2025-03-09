// Require dependencies
require("dotenv").config();

// Export configuration
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
  },
  mercadoPago: {
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
    publicKey: process.env.MERCADO_PAGO_PUBLIC_KEY,
  },
};
