const OpenAI = require('openai');
const fs = require('fs');
const config = require('../config');

class OpenAIService {
  constructor() {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }

  async transcribeAudio(audioBuffer) {
    const tempFilePath = `temp_${Date.now()}.ogg`;
    try {
      fs.writeFileSync(tempFilePath, audioBuffer);
      const transcription = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: "whisper-1",
      });
      return transcription.text;
    } catch (error) {
      throw new Error(`Error transcribing audio: ${error.message}`);
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  async createMessage(threadId, content, isImage) {
    if (isImage) {
      return await this.client.beta.threads.messages.create(threadId, {
        role: "user",
        content: [
          { type: "text", text: "Analiza esta imagen de comida" },
          { type: "image_url", image_url: { url: content } }
        ]
      });
    }

    const messageContent = String(content).trim();
    if (!messageContent) throw new Error("Empty message content");

    return await this.client.beta.threads.messages.create(threadId, {
      role: "user",
      content: messageContent
    });
  }

  async createAndWaitForRun(threadId) {
    const run = await this.client.beta.threads.runs.create(threadId, {
      assistant_id: config.ASSISTANT_ID
    });

    let runStatus;
    do {
      const runStatusResponse = await this.client.beta.threads.runs.retrieve(threadId, run.id);
      runStatus = runStatusResponse.status;

      if (runStatus === "failed" || runStatus === "expired") {
        throw new Error(`Run ended with status: ${runStatus}`);
      }

      if (runStatus !== "completed") {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } while (runStatus !== "completed");

    return run;
  }

  async getLastMessage(threadId) {
    const messages = await this.client.beta.threads.messages.list(threadId);
    return messages.data[0].content[0].text.value;
  }

  async processMessage(threadId, content, isImage = false) {
    try {
      await this.createMessage(threadId, content, isImage);
      await this.createAndWaitForRun(threadId);
      return await this.getLastMessage(threadId);
    } catch (error) {
      throw new Error(`AI Processing error: ${error.message}`);
    }
  }
}

module.exports = OpenAIService; 