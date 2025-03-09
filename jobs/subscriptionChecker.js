const cron = require("node-cron");
const supabaseService = require("../services/supabaseService");
const bot = require("../bot"); // Asegúrate de exportar la instancia del bot

// Ejecutar cada día a las 00:00 UTC
cron.schedule("0 0 * * *", async () => {
  console.log("Running subscription check...");
  try {
    const { usersToNotify, expiredUsers } =
      await supabaseService.checkSubscriptions();

    // Notificar a usuarios que están por vencer
    for (const user of usersToNotify) {
      // Convertir el timestamptz a Date
      const startDate = new Date(user.start_date);
      // Calcular días restantes considerando UTC
      const daysLeft =
        30 - Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));

      try {
        await bot.sendMessage(
          user.user_id,
          `⚠️ ¡Aviso importante!\n\n` +
            `Tu suscripción Premium vencerá en ${daysLeft} días.\n\n` +
            `Para mantener todos tus beneficios Premium:\n` +
            `✨ Análisis nutricional detallado\n` +
            `📊 Estadísticas avanzadas\n` +
            `🎯 Seguimiento de objetivos\n` +
            `💪 Recomendaciones personalizadas\n` +
            `♾️ Solicitudes ilimitadas\n\n` +
            `Usa el comando /premium para renovar tu suscripción.`
        );
        console.log(
          `Expiration notice sent to user ${
            user.user_id
          } (Start date: ${startDate.toISOString()})`
        );
      } catch (error) {
        console.error(
          `Error sending expiration notice to user ${user.user_id}:`,
          error
        );
      }
    }

    // Procesar usuarios vencidos
    for (const user of expiredUsers) {
      try {
        await supabaseService.revertToFreeSubscription(user.user_id);

        await bot.sendMessage(
          user.user_id,
          `📢 Tu suscripción Premium ha vencido.\n\n` +
            `Has vuelto al plan gratuito con 20 solicitudes disponibles.\n\n` +
            `Para volver a disfrutar de todos los beneficios Premium:\n` +
            `✨ Análisis nutricional detallado\n` +
            `📊 Estadísticas avanzadas\n` +
            `🎯 Seguimiento de objetivos\n` +
            `💪 Recomendaciones personalizadas\n` +
            `♾️ Solicitudes ilimitadas\n\n` +
            `Usa el comando /premium para renovar tu suscripción.`
        );
        console.log(
          `Subscription reverted for user ${user.user_id} (Start date: ${user.start_date})`
        );
      } catch (error) {
        console.error(
          `Error processing expiration for user ${user.user_id}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("Error in subscription checker cron job:", error);
  }
});

console.log("Subscription checker cron job initialized");
