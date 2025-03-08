// Environment variables
require("dotenv").config();

// Required dependencies
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs");
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

// Get environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Initialize Telegram bot with polling
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Store user conversations and meals
const userThreads = new Map();
const userMeals = new Map();

// Get existing thread for user or create new one
async function getOrCreateThread(userId) {
  if (!userThreads.has(userId)) {
    const thread = await openai.beta.threads.create();

    userThreads.set(userId, thread.id);

    userMeals.set(userId, []);
  }

  return userThreads.get(userId);
}

// Download image from URL and return as buffer
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

// Download file from Telegram and return as buffer
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

// Transcribe audio file using OpenAI Whisper API
async function transcribeAudio(audioBuffer) {
  try {
    const tempFilePath = `temp_${Date.now()}.ogg`;
    fs.writeFileSync(tempFilePath, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
    });

    fs.unlinkSync(tempFilePath);

    return transcription.text;
  } catch (error) {
    console.error("Error transcribing audio:", error);

    throw error;
  }
}

// Process message with OpenAI Assistant
async function processMessageWithAI(threadId, content, isImage = false) {
  try {
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
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: `Analiza el siguiente mensaje y extrae los alimentos mencionados, ignorando verbos como "desayuné", "almorcé", "comí", "cené", etc. Proporciona las calorías aproximadas y macronutrientes para: ${content}`,
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

    return "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟";
  }
}

// Modify saveMealForUser function to use Supabase
async function saveMealForUser(userId, mealInfo) {
  try {
    const { data, error } = await supabase.from("meals").insert([
      {
        user_id: userId,
        info: mealInfo,
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error saving meal to Supabase:", error);
    throw error;
  }
}

// Modify getDailySummary function to use Supabase
async function getDailySummary(userId) {
  try {
    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      return "No has registrado comidas hoy.";
    }

    let summary = "📋 Resumen del día:\n\n";

    data.forEach((meal, index) => {
      const mealTime = new Date(meal.created_at).toLocaleTimeString();
      summary += `🕐 Comida ${index + 1} (${mealTime}):\n${meal.info}\n\n`;
    });

    // Opcional: Borrar las comidas después de mostrar el resumen
    // await supabase
    //   .from('meals')
    //   .delete()
    //   .eq('user_id', userId)
    //   .gte('created_at', today.toISOString());

    return summary;
  } catch (error) {
    console.error("Error getting daily summary from Supabase:", error);
    return "Error al obtener el resumen diario.";
  }
}

// Handle incoming messages
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
      const summary = await getDailySummary(userId);
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
      shouldAnalyze = true;

      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await processMessageWithAI(threadId, msg.text);
    }

    if (response && shouldAnalyze) {
      await saveMealForUser(userId, response);

      bot.sendMessage(chatId, response);
    }
  } catch (error) {
    console.error("Error:", error);

    bot.sendMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  }
});

// Log bot startup
console.log("🤖 QueComí Started...");
