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

const bot = new TelegramBot(TELEGRAM_TOKEN);

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

async function downloadFile(fileLink) {
  return new Promise((resolve, reject) => {
    https.get(fileLink, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
  });
}

async function transcribeAudio(audioBuffer) {
  try {
    const tempFilePath = `/tmp/temp_${Date.now()}.ogg`; // Usar /tmp para Vercel
    fs.writeFileSync(tempFilePath, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
    });

    fs.unlinkSync(tempFilePath);
    return transcription.text;
  } catch (error) {
    console.error("Error transcribiendo audio:", error);
    throw error;
  }
}

async function processMessageWithAI(threadId, content, isImage = false) {
  try {
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
        content: `Analiza el siguiente mensaje y extrae los alimentos mencionados, ignorando verbos como "desayuné", "almorcé", "comí", "cené", etc. Proporciona las calorías aproximadas y macronutrientes para: ${content}`
      });
    }

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });

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
  
  userMeals.set(userId, []);
  return summary;
}

export default async function handler(request, response) {
  try {
    const { body } = request;
    
    if (request.method === 'POST') {
      await handleUpdate(body);
      response.status(200).json({ ok: true });
    } else {
      response.status(200).json({ ok: true });
    }
  } catch (error) {
    console.error('Error in webhook:', error);
    response.status(500).json({ error: 'Failed to process update' });
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const threadId = await getOrCreateThread(userId);

  try {
    if (msg.text === "/start") {
      await bot.sendMessage(
        chatId,
        "¡Hola! 👋 Soy tu asistente para llevar un registro de tus comidas 🍽️ \n\n" +
        "Podés enviarme:\n" +
        "- Fotos de comidas 📸\n" +
        "- Descripciones de lo que has comido ✍️\n" +
        "- Mensajes de voz describiendo tus comidas 🎤\n" +
        "- 'Terminar el día' para ver tu resumen diario 📋\n\n" +
        "¡Empecemos! ¿Qué has comido hoy?"
      );
      return;
    }

    if (msg.text === "Terminar el día") {
      const summary = getDailySummary(userId);
      await bot.sendMessage(chatId, summary);
      return;
    }

    let response;
    let shouldAnalyze = false;

    if (msg.photo) {
      shouldAnalyze = true;
      await bot.sendMessage(chatId, "Analizando imagen ⌛️");
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      response = await processMessageWithAI(threadId, fileLink, true);
    } else if (msg.voice) {
      shouldAnalyze = true;
      await bot.sendMessage(chatId, "Transcribiendo audio ⌛️");
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const audioBuffer = await downloadFile(fileLink);
      const transcription = await transcribeAudio(audioBuffer);
      await bot.sendMessage(chatId, "Analizando tu mensaje ⌛️");
      response = await processMessageWithAI(threadId, transcription);
    } else if (msg.text) {
      shouldAnalyze = true;
      await bot.sendMessage(chatId, "Analizando ⌛️");
      response = await processMessageWithAI(threadId, msg.text);
    }

    if (response && shouldAnalyze) {
      saveMealForUser(userId, response);
      await bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error("Error:", error);
    await bot.sendMessage(
      chatId,
      "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde."
    );
  }
} 