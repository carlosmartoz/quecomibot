// Require dependencies
const express = require("express");
require("./jobs/subscriptionChecker");
const config = require("./config/config");
const TelegramBot = require("node-telegram-bot-api");
const messageHandler = require("./handlers/messageHandler");
const supabaseService = require("./services/supabaseService");
const schedulerService = require("./services/schedulerService");
const mercadoPagoService = require("./services/mercadoPagoService");
const commandHandler = require("./handlers/commandHandler");

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

    console.log("Bot: Received update:", JSON.stringify(req.body, null, 2));

    res.sendStatus(200);
  } catch (error) {
    console.error("Bot: Error processing webhook update:", error);

    res.sendStatus(500);
  }
});

// Register message handler
bot.on("message", (msg) => messageHandler.handleMessage(bot, msg));

// Register commands
bot.command("profesional", commandHandler.handleProfesionalCommand);

// Webhook endpoint for payments
app.post("/payment/webhook", async (req, res) => {
  console.log(
    "Payment/webhook: Payment webhook received:",
    JSON.stringify(req.body, null, 2)
  );

  await processPayment(req.body);

  res.sendStatus(200);
});

// Success callback endpoint
app.get("/payment/success", async (req, res) => {
  console.log("Payment/success: Payment success callback received:", req.query);

  await processPayment(req.query);

  res.redirect("https://t.me/quecomibot");
});

// Failure endpoint
app.get("/payment/failure", (req, res) => {
  console.log("Payment/failure: Payment failure callback received:", req.query);

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

// Function to process the payment
async function processPayment(data) {
  try {
    const userId = await mercadoPagoService.handlePaymentWebhook(data);

    if (userId) {
      console.log(
        `Payment function: Processing successful payment for user ${userId}`
      );

      try {
        await supabaseService.updateUserSubscription(userId, true);

        console.log(
          `Payment function: Subscription and requests updated successfully for user ${userId}`
        );

        try {
          await bot.sendMessage(
            userId,
            "🎉 ¡Felicitaciones! Tu suscripción Premium ha sido activada.\n\n" +
              "Beneficios activados:\n" +
              `✨ Solicitudes ilimitadas\n\n` +
              "¡Gracias por confiar en QueComí! 🙌"
          );

          console.log(
            `Payment function: Confirmation message sent to user ${userId}`
          );
        } catch (messageError) {
          console.error(
            "Payment function: Error sending confirmation message:",
            messageError
          );
        }
      } catch (updateError) {
        console.error(
          "Payment function: Error updating subscription:",
          updateError
        );
      }
    } else {
      console.log("Payment function: No valid user ID found in payment data");
    }
  } catch (error) {
    console.error("Payment function: Error processing payment:", error);
  }
}

// Listen on the port
app.listen(config.server.port, () => {
  console.log(
    `Listen: Webhook active on ${config.telegram.webhookUrl}/bot${config.telegram.token}`
  );

  schedulerService.initScheduledTasks(bot);
});

// Log bot startup
console.log("Start: QueComí Bot Started...");
