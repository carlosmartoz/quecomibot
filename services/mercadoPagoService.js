// Require dependencies
const config = require("../config/config");
const supabaseService = require("../services/supabaseService");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

// Initialize MercadoPago client
const client = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
});

// Create payment link
async function createPaymentLink(userId) {
  console.log(`createPaymentLink: Creating payment link for user ${userId}`);

  try {
    const preference = new Preference(client);
    const preferenceData = {
      items: [
        {
          title: "Suscripción Premium - QueComí (Prueba)",
          unit_price: 50,
          quantity: 1,
        },
      ],
      back_urls: {
        success: `${config.telegram.webhookUrl}/payment/success`,
        failure: `${config.telegram.webhookUrl}/payment/failure`,
      },
      external_reference: userId.toString(),
      notification_url: `${config.telegram.webhookUrl}/payment/webhook`,
      auto_return: "approved",
    };

    console.log(
      "createPaymentLink: Creating preference with data:",
      JSON.stringify(preferenceData, null, 2)
    );

    const response = await preference.create({ body: preferenceData });

    console.log(
      "createPaymentLink: Payment link created successfully:",
      response.init_point
    );

    return response.init_point;
  } catch (error) {
    console.error("createPaymentLink: Error creating payment link:", error);

    throw error;
  }
}

// Handle payment webhook
async function handlePaymentWebhook(data) {
  console.log(
    "handlePaymentWebhook: Received webhook data:",
    JSON.stringify(data, null, 2)
  );

  try {
    let userId = null;

    // Verificar si el pago ya fue procesado
    if (data.status === "approved" && data.external_reference) {
      userId = parseInt(data.external_reference);

      console.log(
        `handlePaymentWebhook: Payment approved from success callback for user ${userId}`
      );
    } else if (data.topic === "payment" && data.resource) {
      const paymentId = data.resource.split("/").pop();

      console.log(`handlePaymentWebhook: Processing payment ID: ${paymentId}`);

      try {
        const payment = new Payment(client);

        const paymentInfo = await payment.get({ id: paymentId });

        if (
          paymentInfo.status === "approved" &&
          paymentInfo.external_reference
        ) {
          userId = parseInt(paymentInfo.external_reference);

          console.log(
            `handlePaymentWebhook: Payment approved for user ${userId} from IPN`
          );
        }
      } catch (paymentError) {
        console.error(
          "handlePaymentWebhook: Error fetching payment info:",
          paymentError.message
        );
      }
    } else if (data.type === "payment" && data.data && data.data.id) {
      try {
        const payment = new Payment(client);

        const paymentInfo = await payment.get({ id: data.data.id });

        if (
          paymentInfo.status === "approved" &&
          paymentInfo.external_reference
        ) {
          userId = parseInt(paymentInfo.external_reference);

          console.log(
            `handlePaymentWebhook: Payment approved for user ${userId} from direct notification`
          );
        }
      } catch (paymentError) {
        console.error(
          "handlePaymentWebhook: Error fetching payment from direct notification:",
          paymentError.message
        );
      }
    }

    if (userId) {
      const { isPremium } = await supabaseService.checkUserRequests(userId);

      if (!isPremium) {
        await supabaseService.updateUserSubscription(userId);
        return userId;
      }
    }

    console.log(
      "handlePaymentWebhook: No valid payment confirmation found in webhook data"
    );

    return null;
  } catch (error) {
    console.error(
      "handlePaymentWebhook: Error processing payment webhook:",
      error
    );
    return null;
  }
}

// Process payment
async function processPayment(bot, paymentId) {
  try {
    const payment = new Payment(client);
    const paymentInfo = await payment.get({ id: paymentId });

    if (paymentInfo.status === "approved") {
      const userId = paymentInfo.external_reference;

      const { isPremium } = await supabaseService.checkUserRequests(userId);

      if (!isPremium) {
        await supabaseService.updateUserSubscription(userId);

        await bot.sendMessage(
          userId,
          "🎉 ¡Felicitaciones! Ya eres usuario Premium\n\n" +
            "Ahora puedes disfrutar de:\n" +
            "✨ Solicitudes ilimitadas\n\n" +
            "¡Gracias por confiar en mí! 🙏"
        );
      }
    }
  } catch (error) {
    console.error("processPayment: Error processing payment:", error);
  }
}

// Export the functions
module.exports = {
  processPayment,
  createPaymentLink,
  handlePaymentWebhook,
};
