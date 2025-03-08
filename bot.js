require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs");
const https = require("https");

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
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
  });
}

async function downloadFile(fileLink) {
  return new Promise((resolve, reject) => {
    https.get(fileLink, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
  });
}

async function transcribeAudio(audioBuffer) {
  try {
    const tempFilePath = `temp_${Date.now()}.ogg`;
    fs.writeFileSync(tempFilePath, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
    });

    // Limpiar el archivo temporal
    fs.unlinkSync(tempFilePath);
    return transcription.text;
  } catch (error) {
    console.error("Error transcribiendo audio:", error);
    throw error;
  }
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
            text: "Analiza esta imagen de comida y proporciona las calorías aproximadas y macronutrientes. Si ves varios alimentos, lista cada uno por separado.",
          },
          {
            type: "image_url",
            image_url: {
              url: content,
            },
          },
        ],
      });
    } else {
      // Modificar el prompt para manejar mejor las descripciones de comidas
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: `Analiza el siguiente mensaje y extrae los alimentos mencionados, ignorando verbos como "desayuné", "almorcé", "comí", "cené", etc. Proporciona las calorías aproximadas y macronutrientes para: ${content}`,
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
    return "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟";
  }
}

function saveMealForUser(userId, mealInfo) {
  if (!userMeals.has(userId)) {
    userMeals.set(userId, []);
  }
  const meals = userMeals.get(userId);
  meals.push({
    timestamp: new Date(),
    info: mealInfo,
  });
}

function getDailySummary(userId) {
  if (!userMeals.has(userId) || userMeals.get(userId).length === 0) {
    return "¡Vaya! 🤔 Parece que tu diario gastronómico está tan vacío como mi estómago antes del desayuno 🍳. ¡No has registrado ninguna comida hoy! ¿Qué tal si empezamos a llenar este registro con algo delicioso? 🌟";
  }

  const meals = userMeals.get(userId);
  let summary = "📋 Resumen del día:\n\n";
  meals.forEach((meal, index) => {
    summary += `🕐 Comida ${
      index + 1
    } (${meal.timestamp.toLocaleTimeString()}):\n${meal.info}\n\n`;
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
      bot.sendMessage(chatId, summary);
      return;
    }

    let response;
    let shouldAnalyze = false;

    if (msg.photo) {
      shouldAnalyze = true;
      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      response = await processMessageWithAI(threadId, fileLink, true);
    } else if (msg.voice) {
      shouldAnalyze = true;
      bot.sendMessage(
        chatId,
        "🎙️ ¡Escuchando atentamente tus palabras! Transformando tu audio en texto... ✨"
      );
      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const audioBuffer = await downloadFile(fileLink);
      const transcription = await transcribeAudio(audioBuffer);
      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );
      response = await processMessageWithAI(threadId, transcription);
    } else if (msg.text) {
      // Verificar si el texto está relacionado con comida usando el asistente
      shouldAnalyze = true;
      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );
      response = await processMessageWithAI(threadId, msg.text);
    }

    if (response && shouldAnalyze) {
      saveMealForUser(userId, response);
      bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error("Error:", error);
    bot.sendMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  }
});

console.log("🤖 QueComí Started...");
