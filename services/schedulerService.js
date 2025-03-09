// Require dependencies
const cron = require("node-cron");
const supabaseService = require("./supabaseService");

// Function to reset user requests to 20 every month and notify them
async function resetFreeUserRequests(bot) {
  try {
    console.log(
      "resetFreeUserRequests: Starting monthly reset of requests for FREE users..."
    );

    const { data, error } = await supabaseService.supabase
      .from("patients")
      .select("user_id, subscription, requests")
      .eq("subscription", "FREE");

    if (error) {
      console.error("resetFreeUserRequests: Error fetching FREE users:", error);

      return;
    }

    console.log(
      `resetFreeUserRequests: Found ${data.length} FREE users to reset requests`
    );

    let successCount = 0;
    let errorCount = 0;
    let notificationCount = 0;

    for (const user of data) {
      try {
        const { error: updateError } = await supabaseService.supabase
          .from("patients")
          .update({ requests: "20" })
          .eq("user_id", user.user_id);

        if (updateError) {
          console.error(
            `resetFreeUserRequests: Error resetting requests for user ${user.user_id}:`,
            updateError
          );

          errorCount++;

          continue;
        }

        successCount++;

        try {
          await bot.sendMessage(
            user.user_id,
            "🎉 ¡Buenas noticias! 🎉\n\n" +
              "Tus solicitudes mensuales han sido renovadas. Ahora tienes 20 nuevas solicitudes disponibles para este mes.\n\n" +
              "Recuerda que puedes actualizar a Premium para disfrutar de solicitudes ilimitadas y más funciones.\n" +
              "Usa /premium para más información.\n\n" +
              "¡Buen provecho! 🍽️✨"
          );

          notificationCount++;
        } catch (notificationError) {
          console.error(
            `resetFreeUserRequests: Error sending notification to user ${user.user_id}:`,
            notificationError
          );
        }
      } catch (userError) {
        console.error(
          `resetFreeUserRequests: Error processing user ${user.user_id}:`,
          userError
        );

        errorCount++;
      }
    }

    console.log(
      `resetFreeUserRequests: Monthly reset completed: ${successCount} users updated, ${notificationCount} notifications sent, ${errorCount} errors`
    );
  } catch (error) {
    console.error("resetFreeUserRequests: Error in monthly reset:", error);
  }
}

// Initialize scheduled tasks
function initScheduledTasks(bot) {
  if (!bot) {
    console.error(
      "initScheduledTasks: Error: A bot instance is required to start scheduled tasks"
    );
    return;
  }

  cron.schedule("1 0 0 1 * *", () => resetFreeUserRequests(bot), {
    timezone: "America/Argentina/Buenos_Aires",
  });

  console.log("initScheduledTasks: Monthly request reset scheduled");
}

// Export the functions
module.exports = {
  initScheduledTasks,
  resetFreeUserRequests,
};
