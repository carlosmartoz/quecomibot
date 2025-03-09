// handlers/messageHandler.js
const openaiService = require("../services/openaiService");
const supabaseService = require("../services/supabaseService");
const fileUtils = require("../utils/fileUtils");

// Track processing messages
const processingMessages = new Map();

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
      return handleStartCommand(bot, chatId);
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
      response = await openaiService.processMessageWithAI(threadId, fileLink, true);
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

      response = await openaiService.processMessageWithAI(threadId, transcription);
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
  handleMessage
};