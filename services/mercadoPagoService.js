// Require dependencies
const config = require("../config/config");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

// Initialize MercadoPago client
const client = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
});

// Create payment link
async function createSubscriptionLink(userId) {
  console.log(`Creating subscription for user ${userId}`);
  try {
    const subscription = {
      preapproval_plan_id: "premium", // Necesitarás crear un plan primero
      reason: "Suscripción Premium QueComí",
      external_reference: userId.toString(),
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 50,
        currency_id: "ARS",
      },
      back_url: `${config.telegram.webhookUrl}/payment/success`,
      notification_url: `${config.telegram.webhookUrl}/payment/webhook`,
    };

    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mercadoPago.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription),
    });

    const data = await response.json();
    console.log("Subscription created successfully:", data);

    return data.init_point;
  } catch (error) {
    console.error("Error creating subscription:", error);
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
  createSubscriptionLink,
  handlePaymentWebhook,
};
