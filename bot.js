require('dotenv').config();
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require('fs');
const https = require('https');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Almacena las conversaciones y comidas de los usuarios
const userThreads = new Map();
const userMeals = new Map();

async function getOrCreateThread(userId) {
  if (!userThreads.has(userId)) {
    const thread = await openai.beta.threads.create();
    userThreads.set(userId, thread.id);
    userMeals.set(userId, []);
  }
  return userThreads.get(userId);
}

async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
  });
}

async function processMessageWithAI(threadId, content, isImage = false) {
  try {
    // Crear el mensaje en el thread
    if (isImage) {
      await openai.beta.threads.messages.create(threadId, {
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
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: content
      });
    }

    // Ejecutar el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });

    // Esperar a que el asistente termine de procesar
    let runStatus;
    do {
      const runStatusResponse = await openai.beta.threads.runs.retrieve(
        threadId,
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

    // Obtener los mensajes más recientes
    const messages = await openai.beta.threads.messages.list(threadId);
    const lastMessage = messages.data[0];
    return lastMessage.content[0].text.value;
  } catch (error) {
    console.error("Error processing message with AI:", error);
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.";
  }
}

function saveMealForUser(userId, mealInfo) {
  if (!userMeals.has(userId)) {
    userMeals.set(userId, []);
  }
  const meals = userMeals.get(userId);
  meals.push({
    timestamp: new Date(),
    info: mealInfo
  });
}

function getDailySummary(userId) {
  if (!userMeals.has(userId) || userMeals.get(userId).length === 0) {
    return "No has registrado comidas hoy.";
  }

  const meals = userMeals.get(userId);
  let summary = "📋 Resumen del día:\n\n";
  meals.forEach((meal, index) => {
    summary += `🕐 Comida ${index + 1} (${meal.timestamp.toLocaleTimeString()}):\n${meal.info}\n\n`;
  });
  
  // Limpiar el registro después de mostrar el resumen
  userMeals.set(userId, []);
  
  return summary;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const threadId = await getOrCreateThread(userId);

  try {
    if (msg.text === "/start") {
      bot.sendMessage(
        chatId,
        "¡Hola! 👋 Soy tu asistente nutricional 🥗\n\n" +
        "Puedes enviarme:\n" +
        "- Fotos de comidas 📸\n" +
        "- Descripciones de lo que comes ✍️\n" +
        "- 'Terminar el día' para ver tu resumen diario 📋\n\n" +
        "¡Empecemos! ¿Qué has comido?"
      );
      return;
    }

    if (msg.text === "Terminar el día") {
      const summary = getDailySummary(userId);
      bot.sendMessage(chatId, summary);
      return;
    }

    bot.sendMessage(chatId, "Analizando tu comida...");

    let response;
    if (msg.photo) {
      // Obtener la foto en la mejor calidad disponible
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      response = await processMessageWithAI(threadId, fileLink, true);
    } else if (msg.text) {
      response = await processMessageWithAI(threadId, msg.text);
    }

    if (response) {
      saveMealForUser(userId, response);
      bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error("Error:", error);
    bot.sendMessage(
      chatId,
      "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde."
    );
  }
});

console.log("🤖 Bot nutricional iniciado...");
