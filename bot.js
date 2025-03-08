const TelegramBot = require("node-telegram-bot-api");

const token = "7659324885:AAHunWt30Q_l_grhZVLYyYzUAAgU21kCNY8";

const bot = new TelegramBot(token, { polling: true });

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start") {
    bot.sendMessage(chatId, "CHAO! Soy tu bot de Telegram 🤖");
  } else {
    bot.sendMessage(chatId, `Tu Me has dicho: ${text}`);
  }
});

console.log("🤖 Bot iniciado...");
