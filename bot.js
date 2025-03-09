// app.js
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config/config");
const messageHandler = require("./handlers/messageHandler");

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
    // Process the update
    bot.processUpdate(req.body);
    
    // Log the incoming update for debugging
    console.log("Received update:", JSON.stringify(req.body, null, 2));
    
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing webhook update:", error);
    res.sendStatus(500);
  }
});

// Register message handler
bot.on("message", (msg) => messageHandler.handleMessage(bot, msg));

// Listen on the port
app.listen(config.server.port, () => {
  console.log(`✅ Webhook active on ${config.telegram.webhookUrl}/bot${config.telegram.token}`);
});

// Log bot startup
console.log("🤖 QueComí Bot Started...");