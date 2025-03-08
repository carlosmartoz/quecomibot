const { OpenAI } = require('openai');

// Environment variables configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Temporary storage (note: should use a database in production)
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
      assistant_id: ASSISTANT_ID || "",
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
    const messageContent = lastMessage.content[0];
    if ('text' in messageContent) {
        return messageContent.text.value;
    }
    return "No se pudo procesar el contenido del mensaje";
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

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    }),
  });
}

async function handleTelegramUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const threadId = await getOrCreateThread(userId);

  try {
    if (msg.text === "/start") {
      await sendTelegramMessage(
        chatId,
        "¡Hola! 👋 Soy tu asistente para llevar un registro de tus comidas 🍽️ \n\n" +
        "Podés enviarme:\n" +
        "- Fotos de comidas 📸\n" +
        "- Descripciones de lo que has comido ✍️\n" +
        "- 'Terminar el día' para ver tu resumen diario 📋\n\n" +
        "¡Empecemos! ¿Qué has comido hoy?"
      );
      return;
    }

    if (msg.text === "Terminar el día") {
      const summary = getDailySummary(userId);
      await sendTelegramMessage(chatId, summary);
      return;
    }

    let response;
    let shouldAnalyze = false;

    if (msg.photo) {
      shouldAnalyze = true;
      await sendTelegramMessage(chatId, "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨");
      const photo = msg.photo[msg.photo.length - 1];
      const fileLink = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${photo.file_id}`;
      response = await processMessageWithAI(threadId, fileLink, true);
    } else if (msg.text) {
      shouldAnalyze = true;
      await sendTelegramMessage(chatId, "🔍 ¡Detective gastronómico en acción! Analizando tu deliciosa comida... 🧐✨");
      response = await processMessageWithAI(threadId, msg.text);
    }

    if (response && shouldAnalyze) {
      saveMealForUser(userId, response);
      await sendTelegramMessage(chatId, response);
    }
  } catch (error) {
    console.error("Error:", error);
    await sendTelegramMessage(
      chatId,
      "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟"
    );
  }
}

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    return response.status(200).json({ message: '🤖 QueComí Webhook is running!' });
  }

  try {
    const update = request.body;
    await handleTelegramUpdate(update);
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in webhook handler:', error);
    return response.status(500).json({ ok: false });
  }
}; 