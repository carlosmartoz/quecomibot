const { MercadoPagoConfig, Preference } = require("mercadopago");
const config = require("../config/config");

// Initialize MercadoPago client
const client = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
});

async function createPaymentLink(userId) {
  try {
    const preference = new Preference(client);
    const preferenceData = {
      items: [
        {
          title: "Suscripción Premium QueComí",
          unit_price: 4700,
          quantity: 1,
        },
      ],
      back_urls: {
        success: `${config.telegram.webhookUrl}/payment/success`,
        failure: `${config.telegram.webhookUrl}/payment/failure`,
      },
      external_reference: userId.toString(),
      notification_url: `${config.telegram.webhookUrl}/payment/webhook`,
    };

    const response = await preference.create({ body: preferenceData });
    return response.init_point;
  } catch (error) {
    console.error("Error creating payment link:", error);
    throw error;
  }
}

async function handlePaymentWebhook(data) {
  if (data.type === "payment" && data.data.status === "approved") {
    const userId = parseInt(data.external_reference);
    return userId;
  }
  return null;
}

module.exports = {
  createPaymentLink,
  handlePaymentWebhook,
};
