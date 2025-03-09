// Require dependencies
const config = require("../config/config");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

// Initialize MercadoPago client
const client = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
});

// Create payment link
async function createPaymentLink(userId) {
  console.log(`Creating payment link for user ${userId}`);
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
      "Creating preference with data:",
      JSON.stringify(preferenceData, null, 2)
    );
    const response = await preference.create({ body: preferenceData });
    console.log("Payment link created successfully:", response.init_point);

    return response.init_point;
  } catch (error) {
    console.error("Error creating payment link:", error);

    throw error;
  }
}

// Handle payment webhook
async function handlePaymentWebhook(data) {
  console.log("Received webhook data:", JSON.stringify(data, null, 2));

  try {
    if (data.type === "payment") {
      const payment = new Payment(client);
      const paymentInfo = await payment.get({ id: data.data.id });
      console.log("Payment info:", JSON.stringify(paymentInfo, null, 2));

      if (paymentInfo.status === "approved") {
        const userId = parseInt(paymentInfo.external_reference);
        console.log(`Payment approved for user ${userId}`);
        return userId;
      } else {
        console.log(`Payment not approved. Status: ${paymentInfo.status}`);
      }
    } else {
      console.log(`Webhook type not handled: ${data.type}`);
    }
    return null;
  } catch (error) {
    console.error("Error processing payment webhook:", error);
    throw error;
  }
}

module.exports = {
  createPaymentLink,
  handlePaymentWebhook,
};
