// Environment variables
require("dotenv").config();

// Required dependencies
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs");
const https = require("https");
const { createClient } = require('@supabase/supabase-js');

// Get environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); // Used in saveMealForUser function

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// For development, polling is easier to use
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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

// Save meal information for a user
async function saveMealForUser(userId, mealInfo) {
  if (!userMeals.has(userId)) {
    userMeals.set(userId, []);
  }

  const meals = userMeals.get(userId);

  meals.push({
    timestamp: new Date(),
    info: mealInfo,
  });
  
  // Extract meal data from the formatted string
  try {
    // Extract description (the dish name)
    let description = "";
    
    // Try to match with the "🍽️ Plato:" prefix first
    const descriptionMatch = mealInfo.match(/🍽️ Plato: (.*?)(\n|$)/);
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    } else {
      // If no match, try to get the first line of the response as the dish name
      const firstLineMatch = mealInfo.split('\n')[0];
      if (firstLineMatch) {
        // Remove any emoji or prefix if present
        description = firstLineMatch.replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]*/, '').trim();
      }
    }
    
    // Extract nutritional values
    const kcalMatch = mealInfo.match(/Calorías: ([\d.]+) kcal/);
    const proteinMatch = mealInfo.match(/Proteínas: ([\d.]+)g/);
    const carbsMatch = mealInfo.match(/Carbohidratos: ([\d.]+)g/);
    const fatMatch = mealInfo.match(/Grasas: ([\d.]+)g/);
    
    const kcal = kcalMatch ? kcalMatch[1] : "";
    const protein = proteinMatch ? proteinMatch[1] : "";
    const carbohydrates = carbsMatch ? carbsMatch[1] : "";
    const fat = fatMatch ? fatMatch[1] : "";
    
    // Save to Supabase
    const { data, error } = await supabase
      .from('meals')
      .insert([
        { 
          user_id: userId,
          description: description,
          created_at: new Date(),
          kcal: kcal,
          protein: protein,
          fat: fat,
          carbohydrates: carbohydrates
        }
      ]);
      
    if (error) {
      console.error("Error saving meal to database:", error);
    } else {
      console.log("Meal saved successfully:", data);
    }
  } catch (error) {
    console.error("Error parsing or saving meal data:", error);
  }
}

// Get daily summary of meals for a user
function getDailySummary(userId) {
  if (!userMeals.has(userId) || userMeals.get(userId).length === 0) {
    return "No has registrado comidas hoy.";
  }

  const meals = userMeals.get(userId);

  let summary = "📋 Resumen del día:\n\n";

  meals.forEach((meal, index) => {
    summary += `🕐 Comida ${
      index + 1
    } (${meal.timestamp.toLocaleTimeString()}):\n${meal.info}\n\n`;
  });

  userMeals.set(userId, []);

  return summary;
}

// Get today's meals from Supabase for a user (Argentina timezone)
async function getTodaysMealsFromDB(userId) {
  try {
    // Get current date in Argentina timezone (UTC-3)
    const now = new Date();
    // Adjust to Argentina timezone (UTC-3)
    const argentinaTime = new Date(now.getTime() - (3 * 60 * 60 * 1000));
    const todayStart = new Date(argentinaTime);
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(argentinaTime);
    todayEnd.setHours(23, 59, 59, 999);
    
    // Query Supabase for today's meals
    const { data, error } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString())
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error("Error fetching meals from database:", error);
      return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
    }
    
    if (!data || data.length === 0) {
      return "No has registrado comidas hoy.";
    }
    
    let summary = "📋 Resumen de hoy (Hora Argentina):\n\n";
    
    data.forEach((meal, index) => {
      const mealTime = new Date(meal.created_at);
      summary += `🕐 Comida ${index + 1} (${mealTime.toLocaleTimeString('es-AR')}):\n`;
      summary += `🍽️ Plato: ${meal.description || 'Sin descripción'}\n`;
      summary += `📊 Nutrientes:\n`;
      summary += `  • Calorías: ${meal.kcal || '0'} kcal\n`;
      summary += `  • Proteínas: ${meal.protein || '0'}g\n`;
      summary += `  • Carbohidratos: ${meal.carbohydrates || '0'}g\n`;
      summary += `  • Grasas: ${meal.fat || '0'}g\n\n`;
    });
    
    return summary;
  } catch (error) {
    console.error("Error in getTodaysMealsFromDB:", error);
    return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
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
      const summary = getDailySummary(userId);
      bot.sendMessage(chatId, summary);
      return;
    }

    if (msg.text && msg.text.toLowerCase() === "resumen") {
      bot.sendMessage(chatId, "Obteniendo el resumen de tus comidas de hoy...");
      const dbSummary = await getTodaysMealsFromDB(userId);
      bot.sendMessage(chatId, dbSummary);
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
    } else if (msg.text && msg.text !== "/start" && msg.text !== "Terminar el día" && msg.text.toLowerCase() !== "resumen") {
      shouldAnalyze = true;

      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await processMessageWithAI(threadId, msg.text);
    }

    if (response && shouldAnalyze) {
      // Only save the AI-processed response
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
console.log("🤖 QueComí 'add-supabase' Started...");
