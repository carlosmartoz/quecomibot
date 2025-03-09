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

// Handle incoming messages
async function handleMessage(bot, msg) {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (processingMessages.has(userId)) {
      bot.sendMessage(
        chatId,
        "🤔 ¡Ups! Mi cerebro está procesando tu mensaje anterior. ¡Dame un momentito para ponerme al día! 🏃‍♂️💨"
      );

      return;
    }

    // Verificar si es un comando /start con parámetros
    if (msg.text && msg.text.startsWith("/start")) {
      const params = msg.text.split(" ");
      if (params.length > 1 && params[1].toLowerCase() === "premium") {
        // Si el parámetro es "premium", ejecutar el comando premium
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

    if (userStates.has(userId)) {
      const handled = await handlePatientRegistration(bot, msg);
      if (handled) return;
    }

    return processFood(bot, msg, userId, chatId);
  } catch (error) {
    console.error("Error in handleMessage:", error);

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
          "¿Cuál es tu edad? (solo el número)"
      );

      return true;

    case "WAITING_AGE":
      const age = parseInt(msg.text);

      if (isNaN(age) || age <= 0 || age > 120) {
        await bot.sendMessage(
          chatId,
          "Por favor, ingresa una edad válida (solo el número)."
        );

        return true;
      }

      userData.age = age;

      userTempData.set(userId, userData);

      userStates.set(userId, "WAITING_HEIGHT");

      await bot.sendMessage(
        chatId,
        "¿Cuál es tu altura? (en cm o en formato X'XX\")"
      );

      return true;

    case "WAITING_HEIGHT":
      userData.height = msg.text;

      userTempData.set(userId, userData);

      userStates.set(userId, "WAITING_WEIGHT");

      await bot.sendMessage(chatId, "¿Cuál es tu peso actual? (en kg o lb)");

      return true;

    case "WAITING_WEIGHT":
      userData.weight = msg.text;

      try {
        await supabaseService.savePatientInfo(userId, userData);

        await bot.sendMessage(
          chatId,
          "¡Perfecto! He guardado tu información. 📊\n\n" +
            "Ahora puedes comenzar a registrar tus comidas. ¿Qué has comido hoy?"
        );

        userStates.delete(userId);

        userTempData.delete(userId);
      } catch (error) {
        console.error("Error saving patient data:", error);

        await bot.sendMessage(
          chatId,
          "Lo siento, hubo un error al guardar tu información. Por favor, intenta nuevamente con /start."
        );
      }
      return true;

    default:
      return false;
  }
}

// Handle /resumen command
async function handleSummaryCommand(bot, chatId, userId) {
  bot.sendMessage(chatId, "Obteniendo el resumen de tus comidas de hoy...");

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
        "✨ Análisis nutricional detallado\n" +
        "📊 Estadísticas avanzadas\n" +
        "🎯 Seguimiento de objetivos\n" +
        "💪 Recomendaciones personalizadas\n\n" +
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
    console.error("Error creating payment link:", error);

    bot.sendMessage(
      chatId,
      "Lo siento, hubo un error al procesar tu solicitud. Por favor, intenta más tarde."
    );

    return;
  }
}

// Handle food-related content
async function processFood(bot, msg, userId, chatId) {
  const threadId = await openaiService.getOrCreateThread(userId);
  let response;
  let processingMessage;
  let processingSecondMessage;

  // Verificar si el usuario tiene solicitudes disponibles
  const { hasRequests, isPremium, remainingRequests } =
    await supabaseService.checkUserRequests(userId);

  if (!hasRequests) {
    // El usuario no tiene solicitudes disponibles
    await bot.sendMessage(
      chatId,
      "🔒 Has alcanzado el límite de solicitudes gratuitas.\n\n" +
        "Para seguir utilizando el bot, actualiza a la versión Premium y disfruta de:\n" +
        "✨ Solicitudes ilimitadas\n" +
        "📊 Análisis nutricional detallado\n" +
        "🎯 Seguimiento de objetivos\n" +
        "💪 Recomendaciones personalizadas\n\n" +
        "Usa el comando /premium para actualizar ahora."
    );
    return;
  }

  processingMessages.set(userId, true);

  try {
    if (msg.photo) {
      processingMessage = await bot.sendMessage(
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
      processingMessage = await bot.sendMessage(
        chatId,
        "🎙️ ¡Escuchando atentamente tus palabras! Transformando tu audio en texto... ✨"
      );

      const fileLink = await bot.getFileLink(msg.voice.file_id);

      const audioBuffer = await fileUtils.downloadFile(fileLink);

      const transcription = await openaiService.transcribeAudio(audioBuffer);

      processingSecondMessage = await bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      await bot.deleteMessage(chatId, processingMessage.message_id);

      response = await openaiService.processMessageWithAI(
        threadId,
        transcription
      );
    } else if (msg.text) {
      processingMessage = await bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await openaiService.processMessageWithAI(threadId, msg.text);
    }

    // Guardar la comida en la base de datos
    await supabaseService.saveMealForUser(userId, response);

    // Decrementar el contador de solicitudes (solo si no es premium)
    if (!isPremium) {
      await supabaseService.decrementUserRequests(userId);

      // Si quedan pocas solicitudes, mostrar un aviso
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

    // Enviar la respuesta al usuario
    if (processingMessage) {
      await bot.deleteMessage(chatId, processingMessage.message_id);
    }
    if (processingSecondMessage) {
      await bot.deleteMessage(chatId, processingSecondMessage.message_id);
    }
    await bot.sendMessage(chatId, response);
  } catch (error) {
    console.error("Error processing food:", error);

    if (processingMessage) {
      await bot.deleteMessage(chatId, processingMessage.message_id);
    }
    if (processingSecondMessage) {
      await bot.deleteMessage(chatId, processingSecondMessage.message_id);
    }

    await bot.sendMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  } finally {
    processingMessages.delete(userId);
  }
}

module.exports = {
  handleMessage,
};
