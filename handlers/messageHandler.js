// Require dependencies
const fileUtils = require("../utils/fileUtils");
const openaiService = require("../services/openaiService");
const supabaseService = require("../services/supabaseService");
const mercadoPagoService = require("../services/mercadoPagoService");

// Track processing messages
const processingMessages = new Map();

// Add these at the top of the file with other state tracking variables
const userStates = new Map();
const userTempData = new Map();
const awaitingProfessionalId = new Map();

// Handle incoming messages
async function handleMessage(bot, msg) {
  try {
    const chatId = msg.chat.id;

    const userId = msg.from.id;

    if (msg.sticker || msg.video || msg.video_note) {
      return;
    }

    if (processingMessages.has(userId)) {
      bot.sendMessage(
        chatId,
        "🤔 ¡Ups! Mi cerebro está procesando tu mensaje anterior. ¡Dame un momentito para ponerme al día! 🏃‍♂️"
      );

      return;
    }

    if (msg.text && msg.text.startsWith("/start")) {
      const params = msg.text.split(" ");

      if (params.length > 1 && params[1].toLowerCase() === "premium") {
        return handlePremiumCommand(bot, chatId, userId);
      }

      return handleStartCommand(bot, chatId, userId);
    }

    if (msg.text && msg.text.toLowerCase() === "/premium") {
      return handlePremiumCommand(bot, chatId, userId);
    }

    if (msg.text && msg.text.toLowerCase() === "/resumen") {
      return handleSummaryCommand(bot, chatId, userId);
    }

    if (msg.text && msg.text.toLowerCase() === "/profesional") {
      return handleProfesionalCommand(bot, chatId, userId);
    }

    if (userStates.has(userId)) {
      const handled = await handlePatientRegistration(bot, msg);
      if (handled) return;
    }

    // Check if we're waiting for professional ID
    if (awaitingProfessionalId.get(userId)) {
      if (!msg.text) {
        await bot.sendMessage(
          chatId,
          "❌ Por favor, ingresa un ID válido (solo números)."
        );
        return;
      }

      const professionalId = msg.text.trim();

      // Validate that the input is a number
      if (!/^\d+$/.test(professionalId)) {
        await bot.sendMessage(
          chatId,
          "❌ Por favor, ingresa un ID válido (solo números)."
        );
        return;
      }

      try {
        await supabaseService.updateProfessionalId(userId, professionalId);
        await bot.sendMessage(
          chatId,
          "✅ ¡Perfecto! El ID del profesional ha sido guardado correctamente."
        );
        awaitingProfessionalId.delete(userId);
        return;
      } catch (error) {
        console.error("Error saving professional ID:", error);
        await bot.sendMessage(
          chatId,
          "❌ Ocurrió un error al guardar el ID del profesional. Por favor, intenta nuevamente."
        );
        return;
      }
    }

    return processFood(bot, msg, userId, chatId);
  } catch (error) {
    console.error("handleMessage: Error in handleMessage:", error);

    processingMessages.delete(msg.from.id);

    bot.sendMessage(
      msg.chat.id,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  }
}

// Handle /start command
async function handleStartCommand(bot, chatId, userId) {
  const existingPatient = await supabaseService.getPatientByUserId(userId);

  await bot.sendMessage(
    chatId,
    "¡Hola! 👋 Soy tu asistente para llevar un registro de tus comidas 🍽️ \n\n" +
      "Podés enviarme:\n" +
      "- Fotos de comidas 📸\n" +
      "- Descripciones de lo que has comido ✍️\n" +
      "- Mensajes de voz describiendo tus comidas 🎤\n" +
      "- '/resumen' para ver tus comidas de hoy 📋\n"
  );

  if (!existingPatient) {
    userStates.set(userId, "WAITING_NAME");

    userTempData.set(userId, {});

    await bot.sendMessage(
      chatId,
      "Para brindarte un mejor servicio, necesito algunos datos básicos. 📝\n\n" +
        "¿Cuál es tu nombre completo?"
    );
  } else {
    await bot.sendMessage(
      chatId,
      `¡Bienvenido de nuevo, ${existingPatient.name || "amigo"}! 🎉\n\n` +
        "¿Qué has comido hoy?"
    );
  }
}

// Add this function to handle the patient registration flow
async function handlePatientRegistration(bot, msg) {
  const chatId = msg.chat.id;

  const userId = msg.from.id;

  const currentState = userStates.get(userId);

  const userData = userTempData.get(userId) || {};

  switch (currentState) {
    case "WAITING_NAME":
      userData.name = msg.text;

      userTempData.set(userId, userData);

      userStates.set(userId, "WAITING_AGE");

      await bot.sendMessage(
        chatId,
        `Gracias, ${userData.name}! 👍\n\n` +
          "¿Cuántas velitas soplaste en tu último cumple? 🎂 (solo el numerito)"
      );

      return true;

    case "WAITING_AGE":
      const age = parseInt(msg.text);

      if (isNaN(age) || age <= 0 || age > 120) {
        await bot.sendMessage(
          chatId,
          "¡Ups! 🤔 Ese número no me convence... ¿Me das tu edad real? (¡Solo el numerito!)"
        );

        return true;
      }

      userData.age = age;

      userTempData.set(userId, userData);

      userStates.set(userId, "WAITING_HEIGHT");

      await bot.sendMessage(
        chatId,
        "¡Ahora dime! ¿Cuánto mides? 📏\n(Puedes decírmelo en cm o en formato X'XX\")"
      );

      return true;

    case "WAITING_HEIGHT":
      userData.height = msg.text;

      userTempData.set(userId, userData);

      userStates.set(userId, "WAITING_WEIGHT");

      await bot.sendMessage(
        chatId,
        "¡Última pregunta! ¿Cuánto pesas? ⚖️\n(Puedes decírmelo en kg o lb)"
      );

      return true;

    case "WAITING_WEIGHT":
      userData.weight = msg.text;

      try {
        await supabaseService.savePatientInfo(userId, userData);

        await bot.sendMessage(
          chatId,
          "¡Genial! Ya tengo todos tus datos guardaditos 🎯\n\n" +
            "¡Ahora viene lo divertido! Cuéntame, ¿qué delicias te has comido hoy? 😋"
        );

        userStates.delete(userId);

        userTempData.delete(userId);
      } catch (error) {
        console.error(
          "handlePatientRegistration: Error saving patient data:",
          error
        );

        await bot.sendMessage(
          chatId,
          "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
        );
      }

      return true;

    default:
      return false;
  }
}

// Handle /resumen command
async function handleSummaryCommand(bot, chatId, userId) {
  bot.sendMessage(
    chatId,
    "¡Vamos a ver qué delicias te comiste hoy! 🍽️ Dame un segundito... 🔍"
  );

  const dbSummary = await supabaseService.getTodaysMealsFromDB(userId);

  bot.sendMessage(chatId, dbSummary);
}

// Handle /premium command
async function handlePremiumCommand(bot, chatId, userId) {
  try {
    const paymentLink = await mercadoPagoService.createPaymentLink(userId);

    await bot.sendMessage(
      chatId,
      "🌟 ¡Actualiza a Premium! 🌟\n\n" +
        "Beneficios Premium:\n" +
        `✨ Solicitudes ilimitadas\n\n` +
        "Precio de prueba: $50 ARS",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "💳 Pagar con MercadoPago",
                url: paymentLink,
              },
            ],
          ],
        },
      }
    );

    return;
  } catch (error) {
    console.error("handlePremiumCommand: Error creating payment link:", error);

    bot.sendMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );

    return;
  }
}

// Handle /profesional command
async function handleProfesionalCommand(bot, chatId, userId) {
  try {
    awaitingProfessionalId.set(userId, true);
    await bot.sendMessage(
      chatId,
      "🏥 Por favor, ingresa el ID de tu médico profesional (solo números):"
    );
  } catch (error) {
    console.error("Error in handleProfesionalCommand:", error);
    await bot.sendMessage(
      chatId,
      "❌ Ocurrió un error. Por favor, intenta nuevamente."
    );
  }
}

// Handle food-related content
async function processFood(bot, msg, userId, chatId) {
  const threadId = await openaiService.getOrCreateThread(userId);

  let response;

  const { hasRequests, isPremium, remainingRequests } =
    await supabaseService.checkUserRequests(userId);

  if (!hasRequests) {
    await bot.sendMessage(
      chatId,
      "🔒 Has alcanzado el límite de solicitudes gratuitas.\n\n" +
        "Para seguir utilizando el bot, actualiza a la versión Premium y disfruta de:\n" +
        `✨ Solicitudes ilimitadas\n\n` +
        "Usa el comando /premium para actualizar ahora."
    );

    return;
  }

  processingMessages.set(userId, true);

  try {
    if (msg.photo) {
      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      const photo = msg.photo[msg.photo.length - 1];

      const fileLink = await bot.getFileLink(photo.file_id);

      response = await openaiService.processMessageWithAI(
        threadId,
        fileLink,
        true
      );
    } else if (msg.voice) {
      bot.sendMessage(
        chatId,
        "🎙️ ¡Escuchando atentamente tus palabras! Transformando tu audio en texto... ✨"
      );

      const fileLink = await bot.getFileLink(msg.voice.file_id);

      const audioBuffer = await fileUtils.downloadFile(fileLink);

      const transcription = await openaiService.transcribeAudio(audioBuffer);

      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await openaiService.processMessageWithAI(
        threadId,
        transcription
      );
    } else if (msg.text) {
      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await openaiService.processMessageWithAI(threadId, msg.text);
    }

    await supabaseService.saveMealForUser(userId, response);

    if (!isPremium) {
      await supabaseService.decrementUserRequests(userId);

      if (remainingRequests <= 5 && remainingRequests > 1) {
        await bot.sendMessage(
          chatId,
          `⚠️ Te quedan ${remainingRequests - 1} solicitudes gratuitas.\n` +
            "Considera actualizar a Premium para disfrutar de solicitudes ilimitadas.\n" +
            "Usa /premium para más información."
        );
      } else if (remainingRequests === 1) {
        await bot.sendMessage(
          chatId,
          "⚠️ Esta es tu última solicitud gratuita.\n" +
            "Para seguir utilizando el bot, actualiza a Premium.\n" +
            "Usa /premium para más información."
        );
      }
    }

    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error("processFood: Error processing food:", error);

    await bot.sendMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  } finally {
    processingMessages.delete(userId);
  }
}

// Export the functions
module.exports = {
  handleMessage,
};
