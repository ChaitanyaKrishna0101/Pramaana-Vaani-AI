import { Router, type IRouter } from "express";
import { db, callsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  ProcessVaaniCallBody,
  SubmitVaaniFeedbackBody,
  ResetVaaniSessionBody,
} from "@workspace/api-zod";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

interface SessionMemory {
  history: Array<{ role: "user" | "model"; parts: [{ text: string }] }>;
}

const sessions = new Map<string, SessionMemory>();

router.post("/vaani/process", async (req, res): Promise<void> => {
  const parsed = ProcessVaaniCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { audioBase64, mimeType, step, sessionId } = parsed.data;

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [] });
  }
  const session = sessions.get(sessionId)!;

  try {
    const sttPrompt = `You are a professional emergency audio analyzer for VAANI — an AI voice assistant for Indian languages.
Analyze this audio for content, tone, pace, and keywords. Return results as JSON with ONLY these fields:
{
  "transcript": "Full accurate text of the audio in its original language",
  "language": "Detect which: English, Hindi, Kannada, Telugu",
  "emotion": "DISTRESSED or CALM",
  "urgency_level": "Scale of 1-10 as string",
  "emergency_keywords": ["list", "of", "detected", "critical", "words"],
  "issue": "Brief summary of the emergency or problem",
  "confidence": 85
}
confidence is 0-100 integer.`;

    const sttResult = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeType as string, data: audioBase64 } },
            { text: sttPrompt },
          ],
        },
      ],
      config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
    });

    const sttText = sttResult.text ?? "{}";
    let sttData: {
      transcript?: string;
      language?: string;
      emotion?: string;
      urgency_level?: string;
      emergency_keywords?: string[];
      issue?: string;
      confidence?: number;
    } = {};

    try {
      const match = sttText.match(/\{[\s\S]*\}/);
      sttData = match ? JSON.parse(match[0]) : {};
    } catch {
      req.log.warn("Failed to parse STT JSON");
    }

    if (!sttData.transcript || sttData.transcript.trim().length < 2) {
      res.json({
        response: "I'm sorry, I couldn't hear you clearly. Could you please repeat that?",
        transcript: "[No clear audio detected]",
        language: "English",
        emotion: "CALM",
        urgency: "1",
        emergency_keywords: [],
        issue: "No audio detected",
        intent: "UNDETERMINED",
        confidence: 0,
        level: 1,
      });
      return;
    }

    const confidence = sttData.confidence ?? 75;
    const urgencyNum = parseInt(sttData.urgency_level ?? "5", 10);
    const isDistressed = sttData.emotion === "DISTRESSED";

    let level = 1;
    if (confidence < 60 || isDistressed || urgencyNum >= 8) {
      level = 3;
    } else if (confidence < 85 || urgencyNum >= 6) {
      level = 2;
    }

    const systemPrompt = `You are VAANI, an AI emergency dispatcher for Indian citizens.
Current call context:
- Issue: ${sttData.issue}
- Language: ${sttData.language}
- Emotion: ${sttData.emotion}
- Urgency: ${sttData.urgency_level}/10
- Keywords: ${(sttData.emergency_keywords ?? []).join(", ")}
- Step: ${step ?? "INITIAL"}
- Confidence Level: ${confidence}%
- Escalation Level: ${level}

CRITICAL RULES:
1. Respond ONLY in ${sttData.language ?? "English"}.
2. Return ONLY valid JSON with this exact schema:
{
  "response": "What you say to the citizen",
  "intent": "YES or NO or UNDETERMINED"
}
3. Be calm, professional, empathetic.
4. If VERIFICATION step, confirm understanding of the issue.
5. If Level 3, indicate escalating to human agent.
6. Use conversation history for context. Do NOT repeat questions already asked.`;

    const historyMessages = session.history.slice(-10);

    const chatResult = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        ...historyMessages,
        {
          role: "user",
          parts: [{ text: `Audio Analysis: ${JSON.stringify(sttData)}` }],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
      },
    });

    const chatText = chatResult.text ?? "{}";
    let chatData: { response?: string; intent?: string } = {};
    try {
      const match = chatText.match(/\{[\s\S]*\}/);
      chatData = match ? JSON.parse(match[0]) : {};
    } catch {
      req.log.warn("Failed to parse chat JSON");
    }

    session.history.push({
      role: "user",
      parts: [{ text: sttData.transcript ?? "" }],
    });
    session.history.push({
      role: "model",
      parts: [{ text: chatData.response ?? "" }],
    });

    res.json({
      response: chatData.response ?? "Please repeat your concern.",
      transcript: sttData.transcript ?? "",
      language: sttData.language ?? "English",
      emotion: sttData.emotion ?? "CALM",
      urgency: sttData.urgency_level ?? "5",
      emergency_keywords: sttData.emergency_keywords ?? [],
      issue: sttData.issue ?? "",
      intent: chatData.intent ?? "UNDETERMINED",
      confidence,
      level,
    });
  } catch (error) {
    req.log.error({ error }, "Vaani process error");
    res.status(500).json({ error: error instanceof Error ? error.message : "Processing failed" });
  }
});

router.post("/vaani/feedback", async (req, res): Promise<void> => {
  const parsed = SubmitVaaniFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { transcript, issue, emotion, language, urgency, confidence, level, feedback } = parsed.data;

  try {
    await db.insert(callsTable).values({
      transcript,
      issue,
      emotion,
      language,
      urgency: urgency ?? null,
      confidence: confidence ?? null,
      level: level ?? null,
      feedback,
    });
    res.json({ success: true });
  } catch (error) {
    req.log.error({ error }, "Failed to save feedback");
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

router.get("/vaani/history", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(callsTable)
      .orderBy(desc(callsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (error) {
    logger.error({ error }, "Failed to fetch history");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.get("/vaani/analytics", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(callsTable);

    const totalCalls = rows.length;
    const correctCount = rows.filter((r) => r.feedback === "Correct").length;
    const wrongCount = rows.filter((r) => r.feedback === "Wrong").length;
    const accuracyPercent = totalCalls > 0 ? Math.round((correctCount / totalCalls) * 100) : 0;
    const distressedCount = rows.filter((r) => r.emotion === "DISTRESSED").length;
    const calmCount = rows.filter((r) => r.emotion === "CALM").length;
    const level1Count = rows.filter((r) => r.level === 1).length;
    const level2Count = rows.filter((r) => r.level === 2).length;
    const level3Count = rows.filter((r) => r.level === 3).length;

    const languageBreakdown: Record<string, number> = {};
    for (const row of rows) {
      languageBreakdown[row.language] = (languageBreakdown[row.language] ?? 0) + 1;
    }

    const issueMap: Record<string, number> = {};
    for (const row of rows) {
      if (row.issue) {
        const words = row.issue.split(" ").slice(0, 3).join(" ");
        issueMap[words] = (issueMap[words] ?? 0) + 1;
      }
    }
    const commonIssues = Object.entries(issueMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue]) => issue);

    res.json({
      totalCalls,
      correctCount,
      wrongCount,
      accuracyPercent,
      distressedCount,
      calmCount,
      languageBreakdown,
      commonIssues,
      level1Count,
      level2Count,
      level3Count,
    });
  } catch (error) {
    logger.error({ error }, "Failed to fetch analytics");
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

router.post("/vaani/reset-session", async (req, res): Promise<void> => {
  const parsed = ResetVaaniSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  sessions.delete(parsed.data.sessionId);
  res.json({ success: true });
});

export default router;
