const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const config = require('./config');
const OpenAIService = require('./services/OpenAIService');
const SupabaseService = require('./services/SupabaseService');
const NutritionParser = require('./utils/NutritionParser');

class NutritionBot {
  constructor() {
    this.bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
    this.openAI = new OpenAIService();
    this.supabase = new SupabaseService();
    this.userThreads = new Map();
    
    this.initializeHandlers();
  }

  async getOrCreateThread(userId) {
    if (!this.userThreads.has(userId)) {
      const thread = await this.openAI.client.beta.threads.create();
      this.userThreads.set(userId, thread.id);
    }
    return this.userThreads.get(userId);
  }

  async downloadFile(fileLink) {
    return new Promise((resolve, reject) => {
      https.get(fileLink, (response) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
    });
  }

  formatDailySummary(meals) {
    if (!meals || meals.length === 0) {
      return "No has registrado comidas hoy. ¡Empecemos! 🍽️";
    }

    let summary = "📋 Resumen de tus comidas del día:\n\n";
    let totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

    meals.forEach((meal, index) => {
      const mealDate = new Date(meal.created_at);
      const mealTime = mealDate.toLocaleTimeString('es-AR', {
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

      totals.kcal += Number(meal.kcal) || 0;
      totals.protein += Number(meal.protein) || 0;
      totals.fat += Number(meal.fat) || 0;
      totals.carbs += Number(meal.carbohydrates) || 0;
    });

    summary += "📊 Totales del día:\n";
    summary += `🔥 Calorías totales: ${totals.kcal} kcal\n`;
    summary += `💪 Proteínas totales: ${totals.protein.toFixed(1)}g\n`;
    summary += `🥑 Grasas totales: ${totals.fat.toFixed(1)}g\n`;
    summary += `🌾 Carbohidratos totales: ${totals.carbs.toFixed(1)}g\n`;

    return summary;
  }

  async handleStart(msg) {
    const welcomeMessage = 
      "¡Hola! 👋 Soy tu asistente para llevar un registro de tus comidas 🍽️ \n\n" +
      "Podés enviarme:\n" +
      "- Fotos de comidas 📸\n" +
      "- Descripciones de lo que has comido ✍️\n" +
      "- Mensajes de voz describiendo tus comidas 🎤\n" +
      "- 'Terminar el día' para ver tu resumen diario 📋\n\n" +
      "¡Empecemos! ¿Qué has comido hoy?";
    
    await this.bot.sendMessage(msg.chat.id, welcomeMessage);
  }

  async handleDailySummary(msg) {
    await this.bot.sendMessage(msg.chat.id, "📊 Generando tu resumen del día...");
    const meals = await this.supabase.getDailyMeals(msg.from.id);
    const summary = this.formatDailySummary(meals);
    await this.bot.sendMessage(msg.chat.id, summary);
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const threadId = await this.getOrCreateThread(userId);

      if (msg.text === "/start") {
        await this.handleStart(msg);
        return;
      }

      if (msg.text === "Terminar el día") {
        await this.handleDailySummary(msg);
        return;
      }

      let response;
      let shouldAnalyze = false;

      if (msg.photo) {
        shouldAnalyze = true;
        await this.bot.sendMessage(chatId, "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨");
        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await this.bot.getFileLink(photo.file_id);
        response = await this.openAI.processMessage(threadId, fileLink, true);
      } else if (msg.voice) {
        shouldAnalyze = true;
        await this.bot.sendMessage(chatId, "🎙️ ¡Escuchando atentamente tus palabras! Transformando tu audio en texto... ✨");
        const fileLink = await this.bot.getFileLink(msg.voice.file_id);
        const audioBuffer = await this.downloadFile(fileLink);
        const transcription = await this.openAI.transcribeAudio(audioBuffer);
        await this.bot.sendMessage(chatId, "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨");
        response = await this.openAI.processMessage(threadId, transcription);
      } else if (msg.text) {
        shouldAnalyze = true;
        await this.bot.sendMessage(chatId, "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨");
        response = await this.openAI.processMessage(threadId, msg.text);
      }

      if (response && shouldAnalyze) {
        const parsedInfo = NutritionParser.parse(response);
        if (parsedInfo) {
          await this.supabase.saveMeal(userId, parsedInfo);
          await this.bot.sendMessage(
            chatId, 
            `✅ Comida registrada:\n\n🍽️ ${parsedInfo.description}\n🔥 Calorías: ${parsedInfo.kcal} kcal\n💪 Proteínas: ${parsedInfo.protein}g\n🥑 Grasas: ${parsedInfo.fat}g\n🌾 Carbohidratos: ${parsedInfo.carbohydrates}g`
          );
        }
      }
    } catch (error) {
      console.error("Error handling message:", error);
      let errorMessage = "¡Ups! 🙈 Ha ocurrido un error. ";
      
      if (error.message.includes("Missing required data") || error.message.includes("Invalid meal")) {
        errorMessage += "No se pudo procesar la información de la comida correctamente.";
      } else if (error.code === "PGRST301") {
        errorMessage += "Error al guardar en la base de datos.";
      } else {
        errorMessage += "Por favor, intenta nuevamente con una descripción más clara.";
      }

      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  initializeHandlers() {
    this.bot.on('message', this.handleMessage.bind(this));
    console.log('🤖 QueComí Started...');
  }
}

const nutritionBot = new NutritionBot();
