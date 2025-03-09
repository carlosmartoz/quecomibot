// Require dependencies
const bot = require("../bot");
const cron = require("node-cron");
const supabaseService = require("../services/supabaseService");

// Run every day at 00:00 UTC
cron.schedule("0 0 * * *", async () => {
  console.log("subscriptionChecker: Running subscription check...");

  try {
    const { usersToNotify, expiredUsers } =
      await supabaseService.checkSubscriptions();

    for (const user of usersToNotify) {
      const startDate = new Date(user.start_date);

      const daysLeft =
        30 - Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));

      try {
        await bot.sendMessage(
          user.user_id,
          `⚠️ ¡Aviso importante!\n\n` +
            `Tu suscripción Premium vencerá en ${daysLeft} días.\n\n` +
            `Para mantener todos tus beneficios Premium:\n` +
            `✨ Solicitudes ilimitadas\n\n` +
            `Usa el comando /premium para renovar tu suscripción.`
        );

        console.log(
          `subscriptionChecker:Expiration notice sent to user ${
            user.user_id
          } (Start date: ${startDate.toISOString()})`
        );
      } catch (error) {
        console.error(
          `subscriptionChecker: Error sending expiration notice to user ${user.user_id}:`,
          error
        );
      }
    }

    for (const user of expiredUsers) {
      try {
        await supabaseService.revertToFreeSubscription(user.user_id);

        await bot.sendMessage(
          user.user_id,
          `📢 Tu suscripción Premium ha vencido.\n\n` +
            `Has vuelto al plan gratuito con 20 solicitudes disponibles.\n\n` +
            `Para volver a disfrutar de todos los beneficios Premium:\n` +
            `✨ Solicitudes ilimitadas\n\n` +
            `Usa el comando /premium para renovar tu suscripción.`
        );

        console.log(
          `subscriptionChecker: Subscription reverted for user ${user.user_id} (Start date: ${user.start_date})`
        );
      } catch (error) {
        console.error(
          `subscriptionChecker: Error processing expiration for user ${user.user_id}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "subscriptionChecker: Error in subscription checker cron job:",
      error
    );
  }
});

// Log initialization
console.log("subscriptionChecker: Subscription checker cron job initialized");
