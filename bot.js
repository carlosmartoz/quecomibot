// Require dependencies
const express = require("express");
const config = require("./config/config");
const TelegramBot = require("node-telegram-bot-api");
const messageHandler = require("./handlers/messageHandler");
const supabaseService = require("./services/supabaseService");
const mercadoPagoService = require("./services/mercadoPagoService");

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

// Webhook endpoint for payments
app.post("/payment/webhook", async (req, res) => {
  console.log("Payment webhook received:", JSON.stringify(req.body, null, 2));
  await processPayment(req.body);
  res.sendStatus(200);
});

// Success callback endpoint
app.get("/payment/success", async (req, res) => {
  console.log("Payment success callback received:", req.query);

  // Procesar el pago
  await processPayment(req.query);

  // Mostrar página de éxito
  res.send(`
        <html>
            <body style="display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5;">
                <div style="text-align: center; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h1>¡Pago Exitoso! 🎉</h1>
                    <p>Tu suscripción Premium ha sido activada.</p>
                    <p>Puedes volver a Telegram para continuar usando QueComí.</p>
                </div>
            </body>
        </html>
    `);
});

// Failure endpoint
app.get("/payment/failure", (req, res) => {
  console.log("Payment failure callback received:", req.query);
  res.send(`
        <html>
            <body style="display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5;">
                <div style="text-align: center; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <h1>El pago no pudo completarse 😕</h1>
                    <p>Por favor, intenta nuevamente desde Telegram.</p>
                </div>
            </body>
        </html>
    `);
});

// Función común para procesar el pago
async function processPayment(data) {
  try {
    const userId = await mercadoPagoService.handlePaymentWebhook(data);

    if (userId) {
      console.log(`Processing successful payment for user ${userId}`);

      try {
        // Actualizar suscripción
        await supabaseService.updateUserSubscription(userId, true);
        console.log(`Subscription updated successfully for user ${userId}`);

        // Enviar mensaje de confirmación
        try {
          await bot.sendMessage(
            userId,
            "🎉 ¡Felicitaciones! Tu suscripción Premium ha sido activada.\n\n" +
              "Beneficios activados:\n" +
              "✨ Análisis nutricional detallado\n" +
              "📊 Estadísticas avanzadas\n" +
              "🎯 Seguimiento de objetivos\n" +
              "💪 Recomendaciones personalizadas\n\n" +
              "¡Gracias por confiar en QueComí! 🙌"
          );
          console.log(`Confirmation message sent to user ${userId}`);
        } catch (messageError) {
          console.error("Error sending confirmation message:", messageError);
        }
      } catch (updateError) {
        console.error("Error updating subscription:", updateError);
      }
    } else {
      console.log("No valid user ID found in payment data");
    }
  } catch (error) {
    console.error("Error processing payment:", error);
  }
}

// Listen on the port
app.listen(config.server.port, () => {
  console.log(
    `✅ Webhook active on ${config.telegram.webhookUrl}/bot${config.telegram.token}`
  );
});

// Log bot startup
console.log("🤖 QueComí Bot Started...");
