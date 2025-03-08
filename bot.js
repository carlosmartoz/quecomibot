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

// Función auxiliar para extraer los macronutrientes del texto de respuesta
function extractNutrients(response) {
  try {
    // Inicializar valores por defecto
    let nutrients = {
      kcal: '0',
      protein: '0',
      fat: '0',
      carbohydrates: '0'
    };

    // Buscar calorías
    const kcalMatch = response.match(/(\d+)\s*(?:kcal|calorías|cal)/i);
    if (kcalMatch) nutrients.kcal = kcalMatch[1];

    // Buscar proteínas
    const proteinMatch = response.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gramos)?\s*(?:de)?\s*proteínas?/i);
    if (proteinMatch) nutrients.protein = proteinMatch[1];

    // Buscar grasas
    const fatMatch = response.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gramos)?\s*(?:de)?\s*grasas?/i);
    if (fatMatch) nutrients.fat = fatMatch[1];

    // Buscar carbohidratos
    const carbsMatch = response.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gramos)?\s*(?:de)?\s*(?:carbohidratos?|carbs?)/i);
    if (carbsMatch) nutrients.carbohydrates = carbsMatch[1];

    return nutrients;
  } catch (error) {
    console.error('Error extracting nutrients:', error);
    return {
      kcal: '0',
      protein: '0',
      fat: '0',
      carbohydrates: '0'
    };
  }
}

// Modificar saveMealForUser para guardar los macronutrientes
async function saveMealForUser(userId, mealInfo) {
  try {
    const nutrients = extractNutrients(mealInfo);
    
    const { data, error } = await supabase
      .from('meals')
      .insert([
        {
          user_id: userId,
          description: mealInfo,
          created_at: new Date().toISOString(),
          kcal: nutrients.kcal,
          protein: nutrients.protein,
          fat: nutrients.fat,
          carbohydrates: nutrients.carbohydrates
        }
      ]);

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error saving meal to Supabase:", error);
    throw error;
  }
}

// Actualizar getDailySummary para mostrar los macronutrientes
async function getDailySummary(userId) {
  try {
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
    let totalKcal = 0;
    let totalProtein = 0;
    let totalFat = 0;
    let totalCarbs = 0;

    data.forEach((meal, index) => {
      const mealTime = new Date(meal.created_at).toLocaleTimeString();
      summary += `🕐 Comida ${index + 1} (${mealTime}):\n${meal.description}\n`;
      summary += `📊 Nutrientes:\n`;
      summary += `   • Calorías: ${meal.kcal}kcal\n`;
      summary += `   • Proteínas: ${meal.protein}g\n`;
      summary += `   • Grasas: ${meal.fat}g\n`;
      summary += `   • Carbohidratos: ${meal.carbohydrates}g\n\n`;

      totalKcal += parseFloat(meal.kcal) || 0;
      totalProtein += parseFloat(meal.protein) || 0;
      totalFat += parseFloat(meal.fat) || 0;
      totalCarbs += parseFloat(meal.carbohydrates) || 0;
    });

    summary += "📈 Totales del día:\n";
    summary += `   • Calorías totales: ${totalKcal.toFixed(1)}kcal\n`;
    summary += `   • Proteínas totales: ${totalProtein.toFixed(1)}g\n`;
    summary += `   • Grasas totales: ${totalFat.toFixed(1)}g\n`;
    summary += `   • Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;

    return summary;
  } catch (error) {
    console.error("Error getting daily summary from Supabase:", error);
    return "Error al obtener el resumen diario.";
  }
}

// Función para obtener el historial de comidas
async function getMealHistory(userId, days = 7) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { descending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      return "No hay registros de comidas en este período.";
    }

    let history = "📖 Historial de comidas:\n\n";
    let currentDate = '';

    data.forEach((meal) => {
      const mealDate = new Date(meal.created_at);
      const dateStr = mealDate.toLocaleDateString();
      
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        history += `📅 ${dateStr}\n`;
      }

      history += `🕐 ${mealDate.toLocaleTimeString()}\n`;
      history += `🍽️ ${meal.description}\n`;
      history += `📊 Nutrientes:\n`;
      history += `   • Calorías: ${meal.kcal}kcal\n`;
      history += `   • Proteínas: ${meal.protein}g\n`;
      history += `   • Grasas: ${meal.fat}g\n`;
      history += `   • Carbohidratos: ${meal.carbohydrates}g\n\n`;
    });

    return history;
  } catch (error) {
    console.error('Error getting meal history:', error);
    return "Error al obtener el historial de comidas.";
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
          "- Mensajes de voz describiendo tus comidas 🎤\n\n" +
          "Comandos disponibles:\n" +
          "- 'Terminar el día' para ver tu resumen diario 📋\n" +
          "- '/historial' para ver tus últimas comidas 📖\n" +
          "- '/historial X' para ver las comidas de los últimos X días\n\n" +
          "¡Empecemos! ¿Qué has comido hoy?"
      );
      return;
    }

    if (msg.text === "Terminar el día") {
      const summary = await getDailySummary(userId);
      bot.sendMessage(chatId, summary);
      return;
    }

    if (msg.text && msg.text.startsWith('/historial')) {
      const parts = msg.text.split(' ');
      const days = parts.length > 1 ? parseInt(parts[1]) : 7;
      
      if (isNaN(days) || days < 1 || days > 30) {
        bot.sendMessage(
          chatId,
          "Por favor, especifica un número de días válido entre 1 y 30."
        );
        return;
      }

      const history = await getMealHistory(userId, days);
      bot.sendMessage(chatId, history);
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
