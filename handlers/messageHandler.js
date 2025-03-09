// handlers/messageHandler.js
const openaiService = require("../services/openaiService");
const supabaseService = require("../services/supabaseService");
const fileUtils = require("../utils/fileUtils");
const mercadoPagoService = require("../services/mercadoPagoService");

// Track processing messages
const processingMessages = new Map();

// Add these at the top of the file with other state tracking variables
const userStates = new Map(); // Track conversation state for each user
const userTempData = new Map(); // Store temporary user data during conversation

// Handle incoming messages
async function handleMessage(bot, msg) {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Check if already processing a message for this user
    if (processingMessages.has(userId)) {
      bot.sendMessage(
        chatId,
        "🤔 ¡Ups! Mi cerebro está procesando tu mensaje anterior. ¡Dame un momentito para ponerme al día! 🏃‍♂️💨"
      );
      return;
    }

    // Handle commands
    if (msg.text === "/start") {
      return handleStartCommand(bot, chatId, userId);
    }

    // Check if user is in registration flow
    if (userStates.has(userId)) {
      const handled = await handlePatientRegistration(bot, msg);
      if (handled) return;
    }

    if (msg.text === "/premium") {
      try {
        const paymentLink = await mercadoPagoService.createPaymentLink(userId);
        await bot.sendMessage(
          chatId,
          "🌟 ¡Actualiza a Premium! \n\n" +
            "Beneficios Premium:\n" +
            "✨ Análisis nutricional detallado\n" +
            "📊 Estadísticas avanzadas\n" +
            "🎯 Seguimiento de objetivos\n" +
            "💪 Recomendaciones personalizadas\n\n" +
            "Precio: $4,700 ARS",
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

    if (msg.text === "Terminar el día") {
      const summary = supabaseService.getDailySummary(userId);
      bot.sendMessage(chatId, summary);
      return;
    }

    if (msg.text && msg.text.toLowerCase() === "/resumen") {
      return handleSummaryCommand(bot, chatId, userId);
    }

    // Process food-related content
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
  // First, check if the patient already exists
  const existingPatient = await supabaseService.getPatientByUserId(userId);
  
  // Send welcome message
  await bot.sendMessage(
    chatId,
    "¡Hola! 👋 Soy tu asistente para llevar un registro de tus comidas 🍽️ \n\n" +
      "Podés enviarme:\n" +
      "- Fotos de comidas 📸\n" +
      "- Descripciones de lo que has comido ✍️\n" +
      "- Mensajes de voz describiendo tus comidas 🎤\n" +
      "- 'resumen' para ver tus comidas de hoy 📋\n" +
      "- 'Terminar el día' para ver tu resumen diario 📋\n\n"
  );
  
  if (!existingPatient) {
    // Start the patient registration process
    userStates.set(userId, 'WAITING_NAME');
    userTempData.set(userId, {});
    
    await bot.sendMessage(
      chatId,
      "Para brindarte un mejor servicio, necesito algunos datos básicos. 📝\n\n" +
      "¿Cuál es tu nombre completo?"
    );
  } else {
    // Patient already exists, just greet them
    await bot.sendMessage(
      chatId,
      `¡Bienvenido de nuevo, ${existingPatient.name || 'amigo'}! 🎉\n\n` +
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
    case 'WAITING_NAME':
      userData.name = msg.text;
      userTempData.set(userId, userData);
      userStates.set(userId, 'WAITING_AGE');
      
      await bot.sendMessage(
        chatId,
        `Gracias, ${userData.name}! 👍\n\n` +
        "¿Cuál es tu edad? (solo el número)"
      );
      return true;
      
    case 'WAITING_AGE':
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
      userStates.set(userId, 'WAITING_HEIGHT');
      
      await bot.sendMessage(
        chatId,
        "¿Cuál es tu altura? (en cm o en formato X'XX\")"
      );
      return true;
      
    case 'WAITING_HEIGHT':
      userData.height = msg.text;
      userTempData.set(userId, userData);
      userStates.set(userId, 'WAITING_WEIGHT');
      
      await bot.sendMessage(
        chatId,
        "¿Cuál es tu peso actual? (en kg o lb)"
      );
      return true;
      
    case 'WAITING_WEIGHT':
      userData.weight = msg.text;
      
      // Save all collected data
      try {
        await supabaseService.savePatientInfo(userId, userData);
        
        await bot.sendMessage(
          chatId,
          "¡Perfecto! He guardado tu información. 📊\n\n" +
          "Ahora puedes comenzar a registrar tus comidas. ¿Qué has comido hoy?"
        );
        
        // Clear user state and temp data
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
      return false; // Not in registration flow
  }
}

// Handle /resumen command
async function handleSummaryCommand(bot, chatId, userId) {
  bot.sendMessage(chatId, "Obteniendo el resumen de tus comidas de hoy...");
  const dbSummary = await supabaseService.getTodaysMealsFromDB(userId);
  bot.sendMessage(chatId, dbSummary);
}

// Process food-related content
async function processFood(bot, msg, userId, chatId) {
  const threadId = await openaiService.getOrCreateThread(userId);
  let response;
  let processingMessage;
  let processingSecondMessage;

  processingMessages.set(userId, true);

  try {
    if (msg.photo) {
      // Handle photo
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
      // Handle voice message
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
      // Handle text message
      processingMessage = await bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await openaiService.processMessageWithAI(threadId, msg.text);
    }

    // Handle the response
    if (response) {
      // Save the meal information to database
      await supabaseService.saveMealForUser(userId, response);

      // Send the response to the user
      bot.sendMessage(chatId, response);

      // Clean up processing messages
      if (processingSecondMessage) {
        await bot.deleteMessage(chatId, processingSecondMessage.message_id);
      } else if (processingMessage) {
        await bot.deleteMessage(chatId, processingMessage.message_id);
      }
    }
  } finally {
    processingMessages.delete(userId);
  }
}

module.exports = {
  handleMessage,
};
