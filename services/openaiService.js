// Require dependencies
const fs = require("fs");
const OpenAI = require("openai");
const config = require("../config/config");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// Store user threads
const userThreads = new Map();

// Get existing thread for user or create new one
async function getOrCreateThread(userId) {
  if (!userThreads.has(userId)) {
    const thread = await openai.beta.threads.create();

    userThreads.set(userId, thread.id);
  }
  return userThreads.get(userId);
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
    console.error("transcribeAudio: Error transcribing audio:", error);

    throw error;
  }
}

// Process message with OpenAI Assistant
async function processMessageWithAI(threadId, content, isImage = false) {
  try {
    if (isImage) {
      await createImageMessage(threadId, content);
    } else {
      await createTextMessage(threadId, content);
    }

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: config.openai.assistantId,
    });

    const runStatus = await waitForRunCompletion(threadId, run.id);

    if (runStatus !== "completed") {
      throw new Error(
        `processMessageWithAI: Run ended with status: ${runStatus}`
      );
    }

    const messages = await openai.beta.threads.messages.list(threadId);

    const lastMessage = messages.data[0];

    return lastMessage.content[0].text.value;
  } catch (error) {
    console.error(
      "processMessageWithAI: Error processing message with AI:",
      error
    );

    return "¡Ups! 🙈 Parece que mi cerebro nutricional está haciendo una pequeña siesta digestiva 😴. \n\n ¿Podrías intentarlo de nuevo en un momento? ¡Prometo estar más despierto! 🌟";
  }
}

// Create image message for OpenAI
async function createImageMessage(threadId, imageUrl) {
  return openai.beta.threads.messages.create(threadId, {
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
          url: imageUrl,
        },
      },
    ],
  });
}

// Create text message for OpenAI
async function createTextMessage(threadId, text) {
  return openai.beta.threads.messages.create(threadId, {
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

Alimentos a analizar: ${text}`,
  });
}

// Wait for run completion
async function waitForRunCompletion(threadId, runId) {
  let runStatus;

  do {
    const runStatusResponse = await openai.beta.threads.runs.retrieve(
      threadId,
      runId
    );

    runStatus = runStatusResponse.status;

    if (runStatus === "failed" || runStatus === "expired") {
      return runStatus;
    }

    if (runStatus !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } while (runStatus !== "completed");

  return runStatus;
}

// Export the functions
module.exports = {
  getOrCreateThread,
  transcribeAudio,
  processMessageWithAI,
};
