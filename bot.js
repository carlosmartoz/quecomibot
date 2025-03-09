// Require dependencies
const express = require("express");
const config = require("./config/config");
const TelegramBot = require("node-telegram-bot-api");
const messageHandler = require("./handlers/messageHandler");
const supabaseService = require("./services/supabaseService");
const mercadoPagoService = require("./services/mercadoPagoService");
const schedulerService = require('./services/schedulerService');

// Initialize Express app
const app = express();

// Initialize Telegram bot with webhook
const bot = new TelegramBot(config.telegram.token, { webHook: true });

// Configure the webhook
bot.setWebHook(`${config.telegram.webhookUrl}/bot${config.telegram.token}`);

// Middleware to parse JSON bodies
app.use(express.json());

// Webhook endpoint
app.post(`/bot${config.telegram.token}`, (req, res) => {
  try {
    bot.processUpdate(req.body);

    console.log("Received update:", JSON.stringify(req.body, null, 2));

    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing webhook update:", error);

    res.sendStatus(500);
  }
});

// Register message handler
bot.on("message", (msg) => messageHandler.handleMessage(bot, msg));

// Add after the other app.post endpoints
app.post("/payment/webhook", async (req, res) => {
  try {
    const userId = await mercadoPagoService.handlePaymentWebhook(req.body);

    if (userId) {
      await supabaseService.updateUserSubscription(userId, true);

      bot.sendMessage(
        userId,
        "🎉 ¡Felicitaciones! Tu suscripción Premium ha sido activada.\n\n" +
          "Ahora puedes disfrutar de todas las funciones premium. ¡Buen provecho! 🍽️✨"
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing payment webhook:", error);

    res.sendStatus(500);
  }
});

// Listen on the port
app.listen(config.server.port, () => {
  console.log(
    `✅ Webhook active on ${config.telegram.webhookUrl}/bot${config.telegram.token}`
  );
  
  // Iniciar las tareas programadas pasando la instancia del bot
  schedulerService.initScheduledTasks(bot);
});

// Log bot startup
console.log("🤖 QueComí Bot Started...");
