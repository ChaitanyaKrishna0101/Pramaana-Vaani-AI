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
    const sttPrompt = `You are an expert multilingual speech analyst for Indian emergency helpline 1092.
Analyze this audio clip carefully. Detect regional dialects, code-switching, and emotional cues.
Return ONLY valid JSON with exactly these fields:
{
  "transcript": "Exact text in the speaker's language",
  "language": "English | Hindi | Kannada | Telugu",
  "dialect": "Specific regional variant e.g. Dharwad Kannada, Mysuru Kannada, Coastal Kannada, North Karnataka Kannada, Hyderabadi Hindi, Standard Telugu, Chennai Tamil-Telugu, Standard English",
  "translation": "English translation of transcript (same as transcript if already English)",
  "emotion": "DISTRESSED | ANGRY | FEARFUL | URGENT | CALM",
  "urgency_level": "1-10 as string",
  "emergency_keywords": ["list", "of", "critical", "terms"],
  "issue": "One-line summary of the problem in English",
  "confidence": 85
}
Be precise about dialects. confidence is 0-100 integer.`;

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
      dialect?: string;
      translation?: string;
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
        response:
          "I'm sorry, I couldn't hear you clearly. Could you please repeat that?",
        transcript: "[No clear audio detected]",
        translation: "[No clear audio detected]",
        language: "English",
        dialect: "Standard English",
        emotion: "CALM",
        urgency: "1",
        emergency_keywords: [],
        issue: "No audio detected",
        intent: "UNDETERMINED",
        confidence: 0,
        level: 1,
        mode: 1,
        suggested_responses: [],
        agent_briefing: "",
      });
      return;
    }

    const confidence = sttData.confidence ?? 75;
    const urgencyNum = parseInt(sttData.urgency_level ?? "5", 10);
    const isDistressed =
      sttData.emotion === "DISTRESSED" ||
      sttData.emotion === "FEARFUL" ||
      sttData.emotion === "ANGRY";

    let level = 1;
    let mode = 1;

    if (confidence < 60 || isDistressed || urgencyNum >= 8) {
      level = 3;
      mode = 3;
    } else if (confidence < 85 || urgencyNum >= 6) {
      level = 2;
      mode = 2;
    }

    const modeDesc =
      mode === 3
        ? "MODE 3 — FULL HUMAN TAKEOVER: AI briefs agent immediately and stays silent but transcribes."
        : mode === 2
        ? "MODE 2 — AI + AGENT TOGETHER: Provide 3 suggested responses for the agent to click."
        : "MODE 1 — AI FULL AUTO: Handle end-to-end, agent not disturbed.";

    const systemPrompt = `You are VAANI, an experienced multilingual AI emergency dispatcher for India's 1092 helpline.

${modeDesc}

Current call context:
- Issue: ${sttData.issue}
- Language: ${sttData.language} (${sttData.dialect ?? "standard"})
- Emotion: ${sttData.emotion}
- Urgency: ${sttData.urgency_level}/10
- Keywords: ${(sttData.emergency_keywords ?? []).join(", ")}
- Step: ${step ?? "INITIAL"}
- Confidence: ${confidence}%
- Level: ${level} | Mode: ${mode}

Core behaviors:
- Respond IMMEDIATELY when user stops speaking.
- If user interrupts mid-response, stop and listen.
- Respond in ${sttData.language ?? "English"} matching the caller's dialect.
- Be calm, professional, empathetic. Provide numbered steps for technical issues.
- If Level 3: tell citizen you are connecting them to a human agent right now.
- At VERIFICATION step: restate understanding verbally and ask if correct.

Return ONLY valid JSON:
{
  "response": "What VAANI says to citizen in ${sttData.language ?? "English"} — concise, under 60 words",
  "intent": "YES | NO | UNDETERMINED",
  "suggested_responses": ["Suggested reply 1 in English", "Suggested reply 2 in English", "Suggested reply 3 in English"],
  "agent_briefing": "LIVE CALL: Issue — [X]. Emotion — [Y]. Dialect — [Z]. Confidence — [N]%. Suggested action: [brief]."
}`;

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
    let chatData: {
      response?: string;
      intent?: string;
      suggested_responses?: string[];
      agent_briefing?: string;
    } = {};
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
      translation: sttData.translation ?? sttData.transcript ?? "",
      language: sttData.language ?? "English",
      dialect: sttData.dialect ?? "Standard",
      emotion: sttData.emotion ?? "CALM",
      urgency: sttData.urgency_level ?? "5",
      emergency_keywords: sttData.emergency_keywords ?? [],
      issue: sttData.issue ?? "",
      intent: chatData.intent ?? "UNDETERMINED",
      confidence,
      level,
      mode,
      suggested_responses: chatData.suggested_responses ?? [],
      agent_briefing: chatData.agent_briefing ?? "",
    });
  } catch (error) {
    req.log.error({ error }, "Vaani process error");
    res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Processing failed" });
  }
});

router.post("/vaani/feedback", async (req, res): Promise<void> => {
  const parsed = SubmitVaaniFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    transcript,
    issue,
    emotion,
    language,
    urgency,
    confidence,
    level,
    feedback,
  } = parsed.data;

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
    const accuracyPercent =
      totalCalls > 0 ? Math.round((correctCount / totalCalls) * 100) : 0;
    const distressedCount = rows.filter(
      (r) => r.emotion === "DISTRESSED" || r.emotion === "FEARFUL" || r.emotion === "ANGRY"
    ).length;
    const calmCount = rows.filter((r) => r.emotion === "CALM").length;
    const level1Count = rows.filter((r) => r.level === 1).length;
    const level2Count = rows.filter((r) => r.level === 2).length;
    const level3Count = rows.filter((r) => r.level === 3).length;

    const languageBreakdown: Record<string, number> = {};
    for (const row of rows) {
      languageBreakdown[row.language] =
        (languageBreakdown[row.language] ?? 0) + 1;
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
