const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Inicializar el bot sin polling
const bot = new TelegramBot(TELEGRAM_TOKEN, { webHook: true });

async function processMessageWithAI(content, isImage = false) {
  try {
    // Crear un nuevo thread para cada mensaje
    const thread = await openai.beta.threads.create();
    
    if (isImage) {
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analiza esta imagen de comida y proporciona las calorías aproximadas y macronutrientes. Si ves varios alimentos, lista cada uno por separado."
          },
          {
            type: "image_url",
            image_url: {
              url: content
            }
          }
        ]
      });
    } else {
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: `Analiza el siguiente mensaje y extrae los alimentos mencionados, ignorando verbos como "desayuné", "almorcé", "comí", "cené", etc. Proporciona las calorías aproximadas y macronutrientes para: ${content}`
      });
    }

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    let runStatus;
    do {
      const runStatusResponse = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );
      runStatus = runStatusResponse.status;
      if (runStatus === "failed" || runStatus === "expired") {
        throw new Error(`Run ended with status: ${runStatus}`);
      }
      if (runStatus !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } while (runStatus !== "completed");

    const messages = await openai.beta.threads.messages.list(thread.id);
    return messages.data[0].content[0].text.value;
  } catch (error) {
    console.error("Error processing message with AI:", error);
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.";
  }
}

export default async function handler(request, response) {
  try {
    if (request.method === 'POST') {
      const { body } = request;
      const msg = body.message;
      
      if (!msg) {
        return response.status(200).json({ ok: true });
      }

      const chatId = msg.chat.id;

      if (msg.text === "/start") {
        await bot.sendMessage(
          chatId,
          "¡Hola! 👋 Soy tu asistente nutricional. Puedes enviarme:\n\n" +
          "- Fotos de comidas 📸\n" +
          "- Descripciones de lo que has comido ✍️\n" +
          "- Mensajes de voz describiendo tus comidas 🎤\n\n" +
          "¡Empecemos! ¿Qué has comido hoy?"
        );
      } else if (msg.photo) {
        await bot.sendMessage(chatId, "Analizando imagen ⌛️");
        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);
        const response = await processMessageWithAI(fileLink, true);
        await bot.sendMessage(chatId, response);
      } else if (msg.text) {
        await bot.sendMessage(chatId, "Analizando ⌛️");
        const response = await processMessageWithAI(msg.text);
        await bot.sendMessage(chatId, response);
      }
    }
    
    response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in webhook:', error);
    response.status(500).json({ error: 'Failed to process update' });
  }
} 