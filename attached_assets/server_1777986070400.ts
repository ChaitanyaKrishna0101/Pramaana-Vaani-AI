import express from "express";
import cors from "cors";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import Database from "better-sqlite3";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

const PORT = 3000;
const UPLOADS_DIR = "uploads/";

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const upload = multer({ dest: UPLOADS_DIR });

// Initialize SQLite for permanent call logs
const db_sqlite = new Database("emergency_calls.db");
db_sqlite.exec(`
  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcript TEXT,
    issue TEXT,
    emotion TEXT,
    language TEXT,
    feedback TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Simple memory replacement
class SimpleMemory {
  messages: BaseMessage[] = [];
  async loadMemoryVariables() {
    return { chat_history: this.messages };
  }
  async saveContext(input: any, output: any) {
    this.messages.push(new HumanMessage(input.input || input));
    this.messages.push(new AIMessage(output.output || output));
  }
}

const memories = new Map<string, SimpleMemory>();

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post("/api/emergency-process", upload.single("audio"), async (req, res) => {
    try {
      const file = req.file;
      const currentStep = req.body.step || "INITIAL";
      const sessionId = req.body.sessionId || "default-session";
      
      if (!file) {
        return res.status(400).json({ error: "No audio file uploaded" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not defined");

      // Initialize or retrieve memory for this session
      if (!memories.has(sessionId)) {
        memories.set(sessionId, new SimpleMemory());
      }
      const memory = memories.get(sessionId)!;

      // Extract existing history from memory
      const chatHistory = await memory.loadMemoryVariables();
      
      // Multimodal processing using direct SDK (LangChain's Gemini multimodal is still evolving, 
      // but we can use it to reason about the STT result)
      // Actually, for pure Audio analysis, the Gemini direct SDK is still the most robust.
      // We will use Gemini to get the transcript/language, then use LangChain for the full context response.

      const ai = new GoogleGenAI({ apiKey });
      const audioData = fs.readFileSync(file.path);
      const base64Audio = audioData.toString("base64");

      const sttPrompt = `You are a professional emergency audio analyzer. 
Analyze this audio for content, tone, pace, and keywords. Return results as JSON:
{
  "transcript": "Full accurate text of the audio in its original language",
  "language": "Detect which: English, Hindi, Kannada, Telugu",
  "emotion": "DISTRESSED or CALM",
  "urgency_level": "Scale of 1-10",
  "emergency_keywords": ["list", "of", "detected", "critical", "words"],
  "issue": "Brief summary of the emergency or problem"
}`;

      const sttResult = await ai.models.generateContent({
        model: "gemini-1.5-flash", 
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: file.mimetype, data: base64Audio } },
              { text: sttPrompt }
            ]
          }
        ],
        config: { responseMimeType: "application/json" }
      });

      console.log('STT raw result:', JSON.stringify(sttResult));

      // Adjust parsing for unified SDK
      const sttText = sttResult.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const sttData = JSON.parse(sttText.match(/\{[\s\S]*\}/)?.[0] || "{}");
      console.log('Interpreted STT Data:', sttData);

      if (!sttData.transcript || sttData.transcript.trim() === "" || sttData.transcript.length < 2) {
        return res.json({
          response: "I'm sorry, I couldn't hear you clearly. Could you please repeat that?",
          transcript: "[No clear audio detected]",
          language: "English",
          emotion: "CALM",
          urgency: "1",
          emergency_keywords: [],
          issue: "No audio detected",
          intent: "UNDETERMINED"
        });
      }

      // Now use LangChain to generate the response and maintain context
      const chatModel = new ChatGoogleGenerativeAI({
        model: "gemini-1.5-flash",
        apiKey,
        maxOutputTokens: 2048,
      });

      const systemInstruction = `You are an emergency dispatcher for 'Citizen Calls 1092'.
Context: The citizen is calling about: ${sttData.issue}.
Detected Language: ${sttData.language}.
Emotion: ${sttData.emotion}.
Urgency Level: ${sttData.urgency_level}/10.
Keywords: ${sttData.emergency_keywords?.join(', ')}.

CRITICAL REQUIREMENTS:
1. Respond ONLY in the citizen's detected language (${sttData.language}).
2. Use the following JSON schema for your response:
{
  "response": "What you would say back to the citizen",
  "transcript": "${sttData.transcript}",
  "language": "${sttData.language}",
  "emotion": "${sttData.emotion}",
  "urgency": "${sttData.urgency_level}",
  "emergency_keywords": ${JSON.stringify(sttData.emergency_keywords || [])},
  "issue": "${sttData.issue}",
  "intent": "YES/NO/UNDETERMINED"
}
3. Maintain the personality of a calm, professional responder.
4. Refer to the conversation history to avoid repeating questions.
5. If the status is VERIFICATION, ask if the interpreted issue is correct.`;

      const history = chatHistory.chat_history || [];
      const response = await chatModel.invoke([
        new SystemMessage(systemInstruction),
        ...history,
        new HumanMessage(`Audio Insight: ${JSON.stringify(sttData)}. User just spoke. Status: ${currentStep}.`)
      ]);

      const responseText = response.content.toString();
      console.log('AI Raw Response:', responseText);

      // Save to memory
      await memory.saveContext(
        { input: sttData.transcript },
        { output: responseText }
      );

      const finalJson = JSON.parse(responseText.match(/\{[\s\S]*\}/)?.[0] || "{}");
      console.log('Final JSON sent to client:', finalJson);
      
      // Clean up
      fs.unlinkSync(file.path);

      res.json(finalJson);
    } catch (error: any) {
      console.error("Emergency Process Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/feedback", (req, res) => {
    const { transcript, issue, emotion, language, feedback } = req.body;
    try {
      const stmt = db_sqlite.prepare("INSERT INTO calls (transcript, issue, emotion, language, feedback) VALUES (?, ?, ?, ?, ?)");
      stmt.run(transcript, issue, emotion, language, feedback);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/history", (req, res) => {
    try {
      const rows = db_sqlite.prepare("SELECT * FROM calls ORDER BY timestamp DESC LIMIT 50").all();
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reset-session", (req, res) => {
    const { sessionId } = req.body;
    memories.delete(sessionId || "default-session");
    res.json({ success: true });
  });

  // Vite development middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
