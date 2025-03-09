// Require dependencies
const fileUtils = require("../utils/fileUtils");
const openaiService = require("../services/openaiService");
const supabaseService = require("../services/supabaseService");
const mercadoPagoService = require("../services/mercadoPagoService");

// Track processing messages
const processingMessages = new Map();

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

    if (msg.text && msg.text.toLowerCase() === "/start") {
      return handleStartCommand(bot, chatId);
    }

    if (msg.text && msg.text.toLowerCase() === "/premium") {
      return handlePremiumCommand(bot, chatId, userId);
    }

    if (msg.text && msg.text.toLowerCase() === "/resumen") {
      return handleSummaryCommand(bot, chatId, userId);
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
function handleStartCommand(bot, chatId) {
  bot.sendMessage(
    chatId,
    "¡Hola! 👋 Soy tu asistente para llevar un registro de tus comidas 🍽️ \n\n" +
      "Podés enviarme:\n" +
      "- Fotos de comidas 📸\n" +
      "- Descripciones de lo que has comido ✍️\n" +
      "- Mensajes de voz describiendo tus comidas 🎤\n" +
      "- 'resumen' para ver tus comidas de hoy 📋\n" +
      "- 'Terminar el día' para ver tu resumen diario 📋\n\n" +
      "¡Empecemos! ¿Qué has comido hoy?"
  );
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
      "🌟 ¡Actualiza a Premium! ��\n\n" +
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

// Handle food-related content
async function processFood(bot, msg, userId, chatId) {
  const threadId = await openaiService.getOrCreateThread(userId);

  let response;

  let processingMessage;

  let processingSecondMessage;

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
    if (response) {
      await supabaseService.saveMealForUser(userId, response);

      bot.sendMessage(chatId, response);

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
