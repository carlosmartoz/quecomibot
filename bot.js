// Environment variables
require("dotenv").config();

// Required dependencies
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const fs = require("fs");
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

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

// Initialize Express app
const app = express();

// Initialize Telegram bot with webhook
const bot = new TelegramBot(TELEGRAM_TOKEN, { webHook: true });

// Configure the webhook
bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);

// Middleware to parse JSON bodies
app.use(express.json());

// Webhook endpoint
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  try {
    // Process the update
    bot.processUpdate(req.body);
    
    // Log the incoming update for debugging
    console.log("Received update:", JSON.stringify(req.body, null, 2));
    
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing webhook update:", error);
    res.sendStatus(500);
  }
});

// Get the port from the environment variables or use 3000 as default
const PORT = process.env.PORT || 3000;

// Listen on the port
app.listen(PORT, () => {
  console.log(`✅ Webhook active on ${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);
});

// Store user conversations and meals
const userThreads = new Map();
const userMeals = new Map();
const processingMessages = new Map();

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
            text: `Analiza esta imagen de comida y proporciona las calorías aproximadas y macronutrientes.

IMPORTANTE: Trata cada plato completo como una sola unidad. Por ejemplo, si ves "milanesa con papas" es UN SOLO plato, no lo separes en "milanesa" y "papas". Solo separa los alimentos cuando claramente son elementos distintos y separados en la imagen.

Si hay múltiples alimentos DISTINTOS en la imagen, enuméralos por separado con números (1., 2., etc.) y proporciona las calorías y macronutrientes para CADA UNO individualmente.

Para cada alimento, usa este formato exacto:
🍽️ Plato: [nombre del alimento]

📊 Estimación nutricional:
• Calorías: [valor] kcal
• Proteínas: [valor]g
• Carbohidratos: [valor]g
• Grasas: [valor]g`,
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
        content: `Analiza el siguiente mensaje y extrae los alimentos mencionados, ignorando verbos como "desayuné", "almorcé", "comí", "cené", etc. 
        
Si hay múltiples alimentos, enuméralos por separado con números (1., 2., etc.) y proporciona las calorías y macronutrientes para CADA UNO individualmente.
IMPORTANTE: Trata cada plato completo como una sola unidad. Por ejemplo, "milanesa con papas" es UN SOLO plato, no lo separes en "milanesa" y "papas". Solo separa los alimentos cuando claramente son elementos distintos separados por comas o "y".

Ejemplos:
- "milanesa con puré" → UN solo plato
- "café con leche y tostadas" → DOS platos (café con leche + tostadas)
- "1 mcflurry, 1 alfajor, 1 galletita" → TRES platos separados

Si hay múltiples alimentos SEPARADOS, enuméralos por separado con números (1., 2., etc.) y proporciona las calorías y macronutrientes para CADA UNO individualmente.

Para cada alimento, usa este formato exacto:
🍽️ Plato: [nombre del alimento]

📊 Estimación nutricional:
• Calorías: [valor] kcal
• Proteínas: [valor]g
• Carbohidratos: [valor]g
• Grasas: [valor]g

Alimentos a analizar: ${content}`,
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
  // Check if this is an error message - don't save errors as meals
  if (mealInfo.includes("¡Ups!") || mealInfo.includes("Oops!") || mealInfo.includes("Error") || mealInfo.includes("siesta digestiva")) {
    console.log("Skipping saving error message as meal");
    return;
  }

  if (!userMeals.has(userId)) {
    userMeals.set(userId, []);
  }

  const meals = userMeals.get(userId);

  meals.push({
    timestamp: new Date(),
    info: mealInfo,
  });
  
  try {
    // Check if the response contains multiple food items
    // Split the response by food item sections
    const foodSections = [];
    
    // First, try to split by multiple "🍽️ Plato:" sections
    if (mealInfo.includes("🍽️ Plato:") && mealInfo.split("🍽️ Plato:").length > 2) {
      // Multiple "Plato" sections found
      const sections = mealInfo.split("🍽️ Plato:");
      // Skip the first empty element
      for (let i = 1; i < sections.length; i++) {
        if (sections[i].trim()) {
          foodSections.push("🍽️ Plato:" + sections[i]);
        }
      }
    } 
    // If no multiple sections found, check if there are numbered items
    else if (mealInfo.match(/\d+\.\s+/)) {
      // Split by numbered items (1., 2., etc.)
      const lines = mealInfo.split('\n');
      let currentSection = "";
      let inSection = false;
      
      for (const line of lines) {
        // If line starts with a number followed by a dot, it's a new section
        if (line.match(/^\d+\.\s+/)) {
          if (inSection && currentSection.trim()) {
            foodSections.push(currentSection.trim());
          }
          currentSection = line + '\n';
          inSection = true;
        } else if (inSection) {
          currentSection += line + '\n';
        }
      }
      
      // Add the last section
      if (inSection && currentSection.trim()) {
        foodSections.push(currentSection.trim());
      }
    } 
    // If no structured format is found, treat the whole response as one item
    else {
      foodSections.push(mealInfo);
    }
    
    // Process each food section
    for (const section of foodSections) {
      // Extract description (the dish name)
      let description = "";
      
      // Try to match with the "🍽️ Plato:" prefix first
      const descriptionMatch = section.match(/🍽️ Plato: (.*?)(\n|$)/);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      } else {
        // If no match, try to get the first line of the section as the dish name
        const firstLineMatch = section.split('\n')[0];
        if (firstLineMatch) {
          // Remove any emoji, numbers, or prefix if present
          description = firstLineMatch.replace(/^[^a-zA-ZáéíóúÁÉÍÓÚñÑ]*/, '').trim();
          // Remove any trailing punctuation
          description = description.replace(/[.:,;]$/, '').trim();
        }
      }
      
      // Don't save if we couldn't extract a proper description
      if (!description) {
        console.log("Skipping saving meal with empty description");
        continue;
      }

      // Extract nutritional values for this section
      const kcalMatch = section.match(/Calorías: ([\d.]+) kcal/);
      const proteinMatch = section.match(/Proteínas: ([\d.]+)g/);
      const carbsMatch = section.match(/Carbohidratos: ([\d.]+)g/);
      const fatMatch = section.match(/Grasas: ([\d.]+)g/);

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
            created_at: new Date().toISOString(), // Supabase will store this in UTC
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
    
    // Create today's date range in Argentina time (UTC-3)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    
    // Convert to UTC for Supabase query (add 3 hours)
    const todayStartUTC = new Date(todayStart.getTime() - 3 * 60 * 60 * 1000);
    const todayEndUTC = new Date(todayEnd.getTime() - 3 * 60 * 60 * 1000);
    
    // Query Supabase for today's meals
    const { data, error } = await supabase
      .from("meals")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", todayStartUTC.toISOString())
      .lte("created_at", todayEndUTC.toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching meals from database:", error);
      return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
    }
    
    if (!data || data.length === 0) {
      return "No has registrado comidas hoy.";
    }
    
    let summary = "📋 Resumen de hoy:\n\n";
    
    // Track total nutritional values
    let totalKcal = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    
    data.forEach((meal, index) => {
      // Convert UTC time from Supabase back to Argentina time for display
      const mealTimeUTC = new Date(meal.created_at);
      const mealTimeArgentina = new Date(mealTimeUTC.getTime() - 3 * 60 * 60 * 1000);
      
      // Use 24-hour format for time display
      const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
      summary += `🕐 Comida ${index + 1} (${mealTimeArgentina.toLocaleTimeString('es-AR', timeOptions)}):\n`;
      summary += `🍽️ Plato: ${meal.description || 'Sin descripción'}\n`;
      summary += `📊 Nutrientes:\n`;
      summary += `  • Calorías: ${meal.kcal || '0'} kcal\n`;
      summary += `  • Proteínas: ${meal.protein || '0'}g\n`;
      summary += `  • Carbohidratos: ${meal.carbohydrates || '0'}g\n`;
      summary += `  • Grasas: ${meal.fat || '0'}g\n\n`;
      
      // Add to totals (convert to numbers and handle empty values)
      totalKcal += parseFloat(meal.kcal || 0);
      totalProtein += parseFloat(meal.protein || 0);
      totalCarbs += parseFloat(meal.carbohydrates || 0);
      totalFat += parseFloat(meal.fat || 0);
    });
    
    // Add total summary section
    summary += `📊 Total del día:\n`;
    summary += `  • Calorías totales: ${totalKcal.toFixed(1)} kcal\n`;
    summary += `  • Proteínas totales: ${totalProtein.toFixed(1)}g\n`;
    summary += `  • Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;
    summary += `  • Grasas totales: ${totalFat.toFixed(1)}g\n`;

    return summary;
  } catch (error) {
    console.error("Error in getTodaysMealsFromDB:", error);
    return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
  }
}

// Handle incoming messages
bot.on("message", async (msg) => {
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

    if (msg.text === "/start") {
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
      return;
    }

    if (msg.text === "Terminar el día") {
      const summary = getDailySummary(userId);
      bot.sendMessage(chatId, summary);
      return;
    }

    if (msg.text && msg.text.toLowerCase() === "/resumen") {
      bot.sendMessage(chatId, "Obteniendo el resumen de tus comidas de hoy...");
      const dbSummary = await getTodaysMealsFromDB(userId);
      bot.sendMessage(chatId, dbSummary);
      return;
    }
    
    // Process food-related content
    const threadId = await getOrCreateThread(userId);
    let response;

    let shouldAnalyze = false;

    let processingMessage;

    if (msg.photo) {
      shouldAnalyze = true;

      processingMessages.set(userId, true);

      processingMessage = await bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      response = await processMessageWithAI(threadId, fileLink, true);
    } else if (msg.voice) {
      shouldAnalyze = true;

      processingMessages.set(userId, true);

      processingMessage = await bot.sendMessage(
        chatId,
        "🎙️ ¡Escuchando atentamente tus palabras! Transformando tu audio en texto... ✨"
      );

      const fileLink = await bot.getFileLink(msg.voice.file_id);
      const audioBuffer = await downloadFile(fileLink);
      const transcription = await transcribeAudio(audioBuffer);

      processingMessage = await bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      await bot.deleteMessage(chatId, processingMessage.message_id);

      response = await processMessageWithAI(threadId, transcription);
    } else if (msg.text) {
      shouldAnalyze = true;

      processingMessages.set(userId, true);

      processingMessage = await bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      response = await processMessageWithAI(threadId, msg.text);
    }

    // Handle the response
    if (response) {
      // Save the meal information to database
      await saveMealForUser(userId, response);
      // Send the response to the user
      bot.sendMessage(chatId, response);

      await bot.deleteMessage(chatId, processingMessage.message_id);

      processingMessages.delete(userId);
    }
  } catch (error) {
    console.error("Error:", error);

    processingMessages.delete(userId);

    bot.sendMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  }
});

// Log bot startup
console.log("🤖 QueComí 'add-supabase' Started...");
