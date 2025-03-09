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

// IMPORTANT: Use ONLY ONE of these methods (polling OR webhook), not both!
// For development, polling is easier to use
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// If you want to use webhook instead, comment out the polling above and uncomment this:
// const bot = new TelegramBot(TELEGRAM_TOKEN);
// bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);

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
    // For querying Supabase, we need to convert from local Argentina time to UTC
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    // Add 3 hours to convert from Argentina time to UTC for Supabase query
    const todayStartUTC = new Date(todayStart.getTime() + 3 * 60 * 60 * 1000);

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    // Add 3 hours to convert from Argentina time to UTC for Supabase query
    const todayEndUTC = new Date(todayEnd.getTime() + 3 * 60 * 60 * 1000);

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

// Get simplified summary from Supabase for a user for a specific period
async function getSummaryFromDB(userId, days = 7) {
  try {
    // Calculate the date range
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    
    // Convert to UTC for Supabase query
    const startDateUTC = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);
    
    // Query Supabase for meals within the date range
    const { data, error } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDateUTC.toISOString())
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error("Error fetching meal summary from database:", error);
      return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
    }
    
    if (!data || data.length === 0) {
      return `No has registrado comidas en los últimos ${days} días.`;
    }
    
    // Group meals by date
    const mealsByDate = {};
    
    // Track total nutritional values
    let totalKcal = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    
    data.forEach(meal => {
      // Convert UTC time from Supabase back to Argentina time for display
      const mealTimeUTC = new Date(meal.created_at);
      const mealTimeArgentina = new Date(mealTimeUTC.getTime() - 3 * 60 * 60 * 1000);
      
      // Format date as YYYY-MM-DD
      const dateKey = mealTimeArgentina.toISOString().split('T')[0];
      
      if (!mealsByDate[dateKey]) {
        mealsByDate[dateKey] = {
          meals: [],
          dailyKcal: 0,
          dailyProtein: 0,
          dailyCarbs: 0,
          dailyFat: 0
        };
      }
      
      mealsByDate[dateKey].meals.push({
        time: mealTimeArgentina,
        description: meal.description
      });
      
      // Add to daily totals (convert to numbers and handle empty values)
      const kcal = parseFloat(meal.kcal || 0);
      const protein = parseFloat(meal.protein || 0);
      const carbs = parseFloat(meal.carbohydrates || 0);
      const fat = parseFloat(meal.fat || 0);
      
      mealsByDate[dateKey].dailyKcal += kcal;
      mealsByDate[dateKey].dailyProtein += protein;
      mealsByDate[dateKey].dailyCarbs += carbs;
      mealsByDate[dateKey].dailyFat += fat;
      
      // Add to overall totals
      totalKcal += kcal;
      totalProtein += protein;
      totalCarbs += carbs;
      totalFat += fat;
    });
    
    // Format the summary message
    let summary = `📊 Resumen de los últimos ${days} días:\n\n`;
    
    // Sort dates in descending order (most recent first)
    const sortedDates = Object.keys(mealsByDate).sort().reverse();
    
    // Calculate daily average
    const avgKcal = totalKcal / sortedDates.length;
    const avgProtein = totalProtein / sortedDates.length;
    const avgCarbs = totalCarbs / sortedDates.length;
    const avgFat = totalFat / sortedDates.length;
    
    // Add daily calories summary
    sortedDates.forEach(date => {
      const dayData = mealsByDate[date];
      const formattedDate = new Date(date).toLocaleDateString('es-AR', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      
      summary += `📅 ${formattedDate}: ${dayData.dailyKcal.toFixed(1)} kcal\n`;
    });
    
    // Add overall summary
    summary += `\n📈 RESUMEN TOTAL (${days} días):\n`;
    summary += `  • Calorías totales: ${totalKcal.toFixed(1)} kcal\n`;
    summary += `  • Proteínas totales: ${totalProtein.toFixed(1)}g\n`;
    summary += `  • Carbohidratos totales: ${totalCarbs.toFixed(1)}g\n`;
    summary += `  • Grasas totales: ${totalFat.toFixed(1)}g\n\n`;
    
    // Add daily average
    summary += `📊 PROMEDIO DIARIO:\n`;
    summary += `  • Calorías: ${avgKcal.toFixed(1)} kcal\n`;
    summary += `  • Proteínas: ${avgProtein.toFixed(1)}g\n`;
    summary += `  • Carbohidratos: ${avgCarbs.toFixed(1)}g\n`;
    summary += `  • Grasas: ${avgFat.toFixed(1)}g\n`;
    
    return summary;
  } catch (error) {
    console.error("Error in getSummaryFromDB:", error);
    return "Error al obtener el resumen de comidas. Por favor, intenta nuevamente.";
  }
}

// Handle incoming messages
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Handle commands first
    if (msg.text === "/start") {
      bot.sendMessage(
        chatId,
        "¡Hola! 👋 Soy QueComíBot, tu asistente experto en nutrición 🍽️ \n\n" +
          "Podés enviarme:\n" +
          "- Fotos de comidas 📸\n" +
          "- Descripciones de lo que has comido ✍️\n" +
          "- Mensajes de voz describiendo tus comidas 🎤\n\n" +
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
    
    // Handle /historial command
    if (msg.text && msg.text.startsWith("/historial")) {
      const parts = msg.text.split(" ");
      let days = 7; // Default to 7 days
      
      if (parts.length > 1) {
        const requestedDays = parseInt(parts[1]);
        if (!isNaN(requestedDays) && requestedDays > 0) {
          days = Math.min(requestedDays, 30); // Cap at 30 days
        }
      }
      
      bot.sendMessage(chatId, `Obteniendo tu historial de los últimos ${days} días...`);
      const history = await getHistoryFromDB(userId, days);
      bot.sendMessage(chatId, history);
      return;
    }
    
    // Handle /resumen commands
    if (msg.text && msg.text.startsWith("/resumen")) {
      // Check if it's a specific period command
      const match = msg.text.match(/^\/resumen-(\d+)$/);
      
      if (match) {
        // It's a period-specific command like /resumen-7
        const days = parseInt(match[1]);
        if (days === 7 || days === 14 || days === 21 || days === 30) {
          bot.sendMessage(chatId, `Obteniendo el resumen de los últimos ${days} días...`);
          const summary = await getSummaryFromDB(userId, days);
          bot.sendMessage(chatId, summary);
          return;
        }
      } else if (msg.text === "/resumen") {
        // It's the regular /resumen command for today
        bot.sendMessage(chatId, "Obteniendo el resumen de tus comidas de hoy...");
        const dbSummary = await getTodaysMealsFromDB(userId);
        bot.sendMessage(chatId, dbSummary);
        return;
      }
    }
    
    // Process food-related content
    const threadId = await getOrCreateThread(userId);
    let response;

    // Handle different types of food-related content
    if (msg.photo) {
      // Photo processing
      bot.sendMessage(
        chatId,
        "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨"
      );

      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = await bot.getFileLink(photo.file_id);
      response = await processMessageWithAI(threadId, fileLink, true);
    } else if (msg.voice) {
      // Voice message processing
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
      // Text message processing - skip commands
      if (msg.text === "/start" || 
          msg.text === "Terminar el día" || 
          msg.text.toLowerCase() === "resumen" || 
          msg.text.startsWith("/historial") ||
          msg.text === "/resumen" ||
          msg.text.match(/^\/resumen-\d+$/)) {
        // Skip processing commands as food
        return;
      }
      
      bot.sendMessage(
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

// Handle callback queries from inline keyboard buttons
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  try {
    // Acknowledge the callback query
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'daily_summary') {
      // Show daily summary
      bot.sendMessage(chatId, "Obteniendo el resumen de tus comidas de hoy...");
      const dbSummary = await getTodaysMealsFromDB(userId);
      bot.sendMessage(chatId, dbSummary);
    } else if (data === 'history') {
      // Show history options
      bot.sendMessage(chatId, "Selecciona el período de resumen:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Hoy", callback_data: "summary_today" },
              { text: "7 días", callback_data: "summary_7" },
              { text: "14 días", callback_data: "summary_14" }
            ],
            [
              { text: "21 días", callback_data: "summary_21" },
              { text: "30 días", callback_data: "summary_30" }
            ]
          ]
        }
      });
    } else if (data === 'summary_today') {
      // Show today's detailed summary
      const dbSummary = await getTodaysMealsFromDB(userId);
      bot.sendMessage(chatId, dbSummary);
    } else if (data.startsWith('summary_')) {
      // Extract the number of days
      const days = parseInt(data.split('_')[1]);
      if (days === 7 || days === 14 || days === 21 || days === 30) {
        const summary = await getSummaryFromDB(userId, days);
        bot.sendMessage(chatId, summary);
      }
    }
  } catch (error) {
    console.error("Error handling callback query:", error);
    bot.sendMessage(chatId, "Ocurrió un error al procesar tu solicitud. Por favor, intenta nuevamente.");
  }
});
