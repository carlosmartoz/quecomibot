const mercadopago = require("mercadopago");
const config = require("../config/config");

mercadopago.configure({
  access_token: config.mercadoPago.accessToken,
});

async function createPaymentLink(userId) {
  try {
    const preference = {
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

    const response = await mercadopago.preferences.create(preference);
    return response.body.init_point;
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
