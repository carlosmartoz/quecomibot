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
    // Manejar el callback de éxito directamente
    if (data.status === "approved" && data.external_reference) {
      const userId = parseInt(data.external_reference);
      console.log(`Payment approved from success callback for user ${userId}`);
      return userId;
    }

    // Manejar notificación IPN
    if (data.topic === "payment" && data.resource) {
      const paymentId = data.resource.split("/").pop();
      console.log(`Processing payment ID: ${paymentId}`);

      try {
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: paymentId });

        if (
          paymentInfo.status === "approved" &&
          paymentInfo.external_reference
        ) {
          const userId = parseInt(paymentInfo.external_reference);
          console.log(`Payment approved for user ${userId} from IPN`);
          return userId;
        }
      } catch (paymentError) {
        console.log("Error fetching payment info:", paymentError.message);
      }
    }

    // Manejar notificación directa de pago
    if (data.type === "payment" && data.data && data.data.id) {
      try {
        const payment = new Payment(client);
        const paymentInfo = await payment.get({ id: data.data.id });

        if (
          paymentInfo.status === "approved" &&
          paymentInfo.external_reference
        ) {
          const userId = parseInt(paymentInfo.external_reference);
          console.log(
            `Payment approved for user ${userId} from direct notification`
          );
          return userId;
        }
      } catch (paymentError) {
        console.log(
          "Error fetching payment from direct notification:",
          paymentError.message
        );
      }
    }

    // Si llegamos aquí, no se encontró confirmación de pago válida
    console.log("No valid payment confirmation found in webhook data");
    return null;
  } catch (error) {
    console.error("Error processing payment webhook:", error);
    return null;
  }
}

module.exports = {
  createPaymentLink,
  handlePaymentWebhook,
};
