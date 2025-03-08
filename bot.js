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

// Inicializar el cliente de Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let bot;

// Check if there is a previous instance running
if (bot) {
  console.log("🛑 Stopping previous instance...");

  bot.stopPolling();
}

// Initialize Telegram bot with polling
bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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
    console.log("Processing message:", { threadId, content, isImage });

    if (isImage) {
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: [
          {
            type: "text",
            text: "Analiza esta imagen de comida",
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
      const messageContent = String(content).trim();
      if (!messageContent) {
        throw new Error("Empty message content");
      }

      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: messageContent,
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
    console.error("Error detallado en processMessageWithAI:", error);
    throw error;
  }
}

// Modify parseNutritionInfo to separate description from nutritional values
function parseNutritionInfo(response) {
  try {
    if (response.includes("¡Oops!")) {
      throw new Error("Invalid input response");
    }

    const nutritionInfo = {
      description: "",
      kcal: null,
      protein: null,
      fat: null,
      carbohydrates: null,
    };

    // Extraer el nombre del plato
    const foodMatch = response.match(/🍽️\s*Plato:\s*([^\n]+)/i) || 
                     response.match(/🥣\s*Plato:\s*([^\n]+)/i) ||
                     response.match(/🍔\s*Plato:\s*([^\n]+)/i);
    if (!foodMatch) throw new Error("Missing food name");
    nutritionInfo.description = foodMatch[1].trim();

    // Buscar calorías
    const kcalMatch = response.match(/Calorías:\s*(\d+)\s*kcal/i);
    if (!kcalMatch) throw new Error("Missing calories information");
    nutritionInfo.kcal = parseInt(kcalMatch[1]);

    // Buscar proteínas
    const proteinMatch = response.match(/Proteínas:\s*(\d+(?:\.\d+)?)\s*g/i);
    if (!proteinMatch) throw new Error("Missing protein information");
    nutritionInfo.protein = parseFloat(proteinMatch[1]);

    // Buscar grasas
    const fatMatch = response.match(/Grasas:\s*(\d+(?:\.\d+)?)\s*g/i);
    if (!fatMatch) throw new Error("Missing fat information");
    nutritionInfo.fat = parseFloat(fatMatch[1]);

    // Buscar carbohidratos
    const carbsMatch = response.match(/Carbohidratos:\s*(\d+(?:\.\d+)?)\s*g/i);
    if (!carbsMatch) throw new Error("Missing carbohydrates information");
    nutritionInfo.carbohydrates = parseFloat(carbsMatch[1]);

    // Validar valores numéricos
    if (isNaN(nutritionInfo.kcal) || 
        isNaN(nutritionInfo.protein) || 
        isNaN(nutritionInfo.fat) || 
        isNaN(nutritionInfo.carbohydrates)) {
      throw new Error("Invalid numerical values");
    }

    console.log("Parsed nutrition info:", nutritionInfo);
    return nutritionInfo;
  } catch (error) {
    console.error("Error parsing nutrition info:", error);
    return null;
  }
}

// Modify saveMealForUser to only save valid responses
async function saveMealForUser(userId, mealInfo) {
  try {
    console.log("Iniciando guardado de comida:", { userId });
    console.log("Información recibida:", mealInfo);

    if (!userId || !mealInfo) {
      throw new Error("Missing required data for saving meal");
    }

    const parsedInfo = parseNutritionInfo(mealInfo);
    console.log("Información parseada:", parsedInfo);
    
    if (!parsedInfo) {
      throw new Error("Invalid meal information format");
    }

    // Crear timestamp en zona horaria de Argentina
    const now = new Date();

    const { data, error } = await supabase.from("meals").insert([
      {
        user_id: userId,
        description: parsedInfo.description,
        kcal: parsedInfo.kcal,
        protein: parsedInfo.protein,
        fat: parsedInfo.fat,
        carbohydrates: parsedInfo.carbohydrates,
        created_at: now.toISOString(),
      },
    ]);

    if (error) {
      console.error("Supabase error:", error);
      throw error;
    }
    return data;
  } catch (error) {
    console.error("Error completo al guardar:", error);
    throw error;
  }
}

// Modify getDailySummary to use Argentina timezone
async function getDailySummary(userId) {
  try {
    if (!userId) {
      throw new Error("User ID is required for getting daily summary");
    }

    // Get today's date at start of day in Argentina timezone
    const today = new Date();
    // Convertir a timezone de Argentina (GMT-3)
    const argentinaOffset = -3;
    const utcOffset = today.getTimezoneOffset() / 60;
    const offsetDiff = argentinaOffset - utcOffset;
    today.setHours(0 - offsetDiff, 0, 0, 0);

    console.log(`Getting daily summary for user ${userId} from ${today.toISOString()}`);

    const { data, error } = await supabase
      .from("meals")
      .select("description, kcal, protein, fat, carbohydrates, created_at")
      .eq("user_id", userId)
      .gte("created_at", today.toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching meals:", error);
      throw error;
    }

    if (!data || data.length === 0) {
      return "No has registrado comidas hoy. ¡Empecemos! 🍽️";
    }

    let summary = "📋 Resumen de tus comidas del día:\n\n";
    let totalKcal = 0;
    let totalProtein = 0;
    let totalFat = 0;
    let totalCarbs = 0;

    data.forEach((meal, index) => {
      const mealDate = new Date(meal.created_at);
      const argentinaTime = new Date(mealDate.getTime() + (argentinaOffset * 60 * 60 * 1000));
      
      const mealTime = argentinaTime.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Argentina/Buenos_Aires'
      });
      
      summary += `🕐 Comida ${index + 1} (${mealTime}hs):\n`;
      summary += `🍽️ ${meal.description}\n`;
      summary += `🔥 Calorías: ${meal.kcal} kcal\n`;
      summary += `💪 Proteínas: ${meal.protein}g\n`;
      summary += `🥑 Grasas: ${meal.fat}g\n`;
      summary += `🌾 Carbohidratos: ${meal.carbohydrates}g\n\n`;

      // Sumar los valores nutricionales con validación
      totalKcal += Number(meal.kcal) || 0;
      totalProtein += Number(meal.protein) || 0;
      totalFat += Number(meal.fat) || 0;
      totalCarbs += Number(meal.carbohydrates) || 0;
    });

    // Agregar totales al resumen con emojis relevantes
    summary += "📊 Totales del día:\n";
    summary += `🔥 Calorías totales: ${totalKcal} kcal\n`;
    summary += `💪 Proteínas totales: ${totalProtein.toFixed(1)}g\n`;
    summary += `🥑 Grasas totales: ${totalFat.toFixed(1)}g\n`;
    summary += `🌾 Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;

    return summary;
  } catch (error) {
    console.error(`Error getting daily summary for user ${userId}:`, error);
    return "Error al obtener tu resumen diario. Por favor, intenta nuevamente.";
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

// Handle incoming messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const threadId = await getOrCreateThread(userId);

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
      bot.sendMessage(chatId, "📊 Generando tu resumen del día...");
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
      try {
        console.log("Respuesta de la IA:", response); // Agregar log
        const parsedInfo = parseNutritionInfo(response);
        console.log("Información parseada:", parsedInfo); // Agregar log

        if (parsedInfo) {
          await saveMealForUser(userId, response);
          await bot.sendMessage(chatId, `✅ Comida registrada:\n\n🍽️ ${parsedInfo.description}\n🔥 Calorías: ${parsedInfo.kcal} kcal\n💪 Proteínas: ${parsedInfo.protein}g\n🥑 Grasas: ${parsedInfo.fat}g\n🌾 Carbohidratos: ${parsedInfo.carbohydrates}g`);
        } else {
          throw new Error("No se pudo parsear la información nutricional");
        }
      } catch (error) {
        console.error("Error completo:", error);
        await bot.sendMessage(
          chatId,
          "Lo siento, no pude procesar correctamente la información nutricional. Por favor, asegúrate de describir la comida claramente."
        );
      }
    }
  } catch (error) {
    console.error("Error completo en el manejador de mensajes:", error);
    
    let errorMessage = "¡Ups! 🙈 Ha ocurrido un error. ";
    if (error.message.includes("Missing required data") || error.message.includes("Invalid meal")) {
      errorMessage += "No se pudo procesar la información de la comida correctamente.";
    } else if (error.code === "PGRST301") {
      errorMessage += "Error al guardar en la base de datos.";
    } else {
      errorMessage += "Por favor, intenta nuevamente con una descripción más clara.";
    }

    await bot.sendMessage(chatId, errorMessage);
  }
});

// Log bot startup
console.log("🤖 QueComí Started...");

// branch test
console.log("🤖 QueComí 'add-supabase' Started...");
