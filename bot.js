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

const { MercadoPagoConfig, Preference } = require("mercadopago");

const client = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
});

const preference = new Preference(client);

const createPaymentLink = async (userId) => {
  const preferenceData = {
    items: [
      {
        title: "Suscripción Premium",
        quantity: 1,
        currency_id: "ARS",
        unit_price: 1000, // Precio en tu moneda
      },
    ],
    back_urls: {
      success: "https://quecomibotpreview.onrender.com/success",
      failure: "https://quecomibotpreview.onrender.com/failure",
      pending: "https://quecomibotpreview.onrender.com/pending",
    },
    notification_url: `https://quecomibotpreview.onrender.com/webhook/mercadopago?userId=${userId}`, // ✅ Aquí Mercado Pago notificará el estado
    auto_return: "approved",
  };

  const response = await preference.create({ body: preferenceData });

  return response.init_point;
};

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
bot.on("message", (msg) =>
  messageHandler.handleMessage(bot, msg, createPaymentLink)
);

app.post("/webhook/mercadopago", (req, res) => {
  const payment = req.body;

  if (payment.type === "payment") {
    const paymentId = payment.data.id;
    const userId = req.query.userId;

    // Llamar a la API de Mercado Pago para obtener el estado del pago
    checkPaymentStatus(paymentId, userId);
  }

  res.sendStatus(200);
});

const checkPaymentStatus = async (paymentId, userId) => {
  const payment = new Payment(client);
  const paymentData = await payment.get({ id: paymentId });

  if (paymentData.status === "approved") {
    console.log(`✅ Pago aprobado para el usuario: ${userId}`);
    // ✅ Guardar estado premium en el bot
    makeUserPremium(userId);
  }
};

const makeUserPremium = (userId) => {
  // Guardar en tu base de datos o actualizar el estado directamente en el bot
  userPremiums.set(userId, true); // Ejemplo de Map para guardar estado
  console.log(`🎉 Usuario ${userId} ahora es premium`);

  // Notificar al usuario en Telegram
  bot.sendMessage(userId, "🎯 ¡Felicidades! Ahora eres usuario premium. 🏆");
};

// Listen on the port
app.listen(config.server.port, () => {
  console.log(
    `✅ Webhook active on ${config.telegram.webhookUrl}/bot${config.telegram.token}`
  );
});

// Log bot startup
console.log("🤖 QueComí Bot Started...");
