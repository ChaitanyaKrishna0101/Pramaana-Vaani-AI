import { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "@/components/layout/Shell";
import { Mic, MicOff, PhoneCall, PhoneOff, Check, X, UserCheck, AlertTriangle, Zap, Users, ChevronRight } from "lucide-react";
import {
  useProcessVaaniCall,
  useSubmitVaaniFeedback,
  useResetVaaniSession,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

type Step = "IDLE" | "LISTENING" | "PROCESSING" | "VERIFICATION" | "SECOND_ATTEMPT" | "SUMMARY";

interface CallResult {
  response: string;
  transcript: string;
  translation: string;
  language: string;
  dialect: string;
  emotion: string;
  urgency: string;
  emergency_keywords: string[];
  issue: string;
  intent: string;
  confidence: number;
  level: number;
  mode: number;
  suggested_responses: string[];
  agent_briefing: string;
}

const LANG_VOICES: Record<string, string> = {
  English: "en-IN",
  Hindi: "hi-IN",
  Kannada: "kn-IN",
  Telugu: "te-IN",
};

const SILENCE_THRESHOLD = 12;
const SILENCE_MS = 2000;
const NO_RESPONSE_MS = 10000;

const GREETINGS: Record<string, string> = {
  English: "Hi, this is VAANI. How can I help you today? Please describe your emergency or issue.",
  Hindi: "Namaste, main VAANI hoon. Aap kaise madad kar sakta hoon? Apni samasya batayein.",
  Kannada: "Namaskara, naanu VAANI. Nimage hege sahaya maadali? Nimma samasye heli.",
  Telugu: "Namaskaram, nenu VAANI. Meeru ela unnaru? Meeru samasya cheppandi.",
};

const NO_RESPONSE_PROMPTS: Record<string, string> = {
  English: "Are you still there? If this is an emergency, please speak now.",
  Hindi: "Kya aap sunne rahe hain? Agar yeh aapaatstiti hai toh abhi bolein.",
  Kannada: "Neevu illi iddira? Tukraamdaaniye agidare, dayavittu eeaga maatanadi.",
  Telugu: "Meeru ikkade unnara? Idi emergency ayithe, dayachesi maatladandi.",
};

function Modebadge({ mode }: { mode: number }) {
  const cfg =
    mode === 3
      ? { label: "Mode 3 — Human Takeover", color: "border-red-500/40 bg-red-500/10 text-red-400", Icon: UserCheck }
      : mode === 2
      ? { label: "Mode 2 — AI + Agent", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400", Icon: Users }
      : { label: "Mode 1 — AI Full Auto", color: "border-green-500/40 bg-green-500/10 text-green-400", Icon: Zap };
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${cfg.color}`}>
      <cfg.Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </div>
  );
}

export default function Dashboard() {
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const [step, setStep] = useState<Step>("IDLE");
  const [callResult, setCallResult] = useState<CallResult | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [statusText, setStatusText] = useState("Ready to connect");
  const [detectedLang, setDetectedLang] = useState("English");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [humanTookOver, setHumanTookOver] = useState(false);
  const [agentEditing, setAgentEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const interruptCtxRef = useRef<AudioContext | null>(null);
  const interruptStreamRef = useRef<MediaStream | null>(null);
  const interruptRafRef = useRef<number | null>(null);
  const noResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<Step>("IDLE");
  const langRef = useRef("English");

  stepRef.current = step;
  langRef.current = detectedLang;

  const processCall = useProcessVaaniCall();
  const submitFeedback = useSubmitVaaniFeedback();
  const resetSession = useResetVaaniSession();

  const clearNoResponseTimer = () => {
    if (noResponseTimerRef.current) {
      clearTimeout(noResponseTimerRef.current);
      noResponseTimerRef.current = null;
    }
  };

  const stopInterruptMonitor = useCallback(() => {
    if (interruptRafRef.current) cancelAnimationFrame(interruptRafRef.current);
    if (interruptCtxRef.current) { interruptCtxRef.current.close().catch(() => {}); interruptCtxRef.current = null; }
    if (interruptStreamRef.current) { interruptStreamRef.current.getTracks().forEach((t) => t.stop()); interruptStreamRef.current = null; }
  }, []);

  const stopAll = useCallback(() => {
    clearNoResponseTimer();
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    stopInterruptMonitor();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setIsRecording(false);
  }, [stopInterruptMonitor]);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const startRecording = useCallback(async () => {
    // defined below — forward ref pattern via ref
  }, []);

  const startRecordingRef = useRef<() => Promise<void>>(async () => {});

  const speakText = useCallback(
    (text: string, lang: string, onDone: () => void) => {
      clearNoResponseTimer();
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = LANG_VOICES[lang] ?? "en-IN";
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang.startsWith(utter.lang.split("-")[0]));
      if (match) utter.voice = match;
      utter.rate = 0.92;

      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => { setIsSpeaking(false); stopInterruptMonitor(); onDone(); };
      utter.onerror = () => { setIsSpeaking(false); stopInterruptMonitor(); onDone(); };

      window.speechSynthesis.speak(utter);

      // interrupt monitor
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        interruptStreamRef.current = stream;
        const ctx = new AudioContext();
        interruptCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let fired = false;
        const check = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
          if (sum / data.length > 22 && !fired) {
            fired = true;
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            stopInterruptMonitor();
            setStatusText("Interrupted — listening...");
            onDone();
            return;
          }
          interruptRafRef.current = requestAnimationFrame(check);
        };
        interruptRafRef.current = requestAnimationFrame(check);
      }).catch(() => {});
    },
    [stopInterruptMonitor]
  );

  const doRecord = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      audioChunksRef.current = chunks;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (chunks.length === 0 || new Blob(chunks).size < 800) {
          setStatusText("No audio detected — try again");
          setTimeout(() => startRecordingRef.current(), 400);
          return;
        }

        setStep("PROCESSING");
        setStatusText("Analyzing...");
        const blob = new Blob(chunks, { type: mimeType });

        try {
          const audioBase64 = await blobToBase64(blob);
          const currentStep = stepRef.current;

          processCall.mutate(
            { data: { audioBase64, mimeType, step: currentStep, sessionId } },
            {
              onSuccess: (result: CallResult) => {
                setCallResult(result);
                setDetectedLang(result.language);
                setLiveTranscript(result.transcript);

                let nextStep: Step;
                if (result.emotion === "DISTRESSED" || result.emotion === "FEARFUL" || result.level === 3) {
                  nextStep = "SUMMARY";
                } else if (currentStep === "VERIFICATION" && result.intent === "YES") {
                  nextStep = "SUMMARY";
                } else if (currentStep === "VERIFICATION" && result.intent === "NO") {
                  nextStep = "SECOND_ATTEMPT";
                } else if (currentStep === "SUMMARY") {
                  nextStep = "SUMMARY";
                } else {
                  nextStep = "VERIFICATION";
                }

                setStep(nextStep);
                setStatusText("VAANI speaking...");

                speakText(result.response, result.language, () => {
                  if (nextStep !== "SUMMARY") {
                    setStatusText("Listening...");
                    startRecordingRef.current();
                  } else {
                    setStatusText(result.mode === 3 ? "Transferring to human agent..." : "Rate this call");
                    // 10s no-response after summary TTS
                    noResponseTimerRef.current = setTimeout(() => {
                      const prompt = NO_RESPONSE_PROMPTS[langRef.current] ?? NO_RESPONSE_PROMPTS.English;
                      speakText(prompt, langRef.current, () => {});
                    }, NO_RESPONSE_MS);
                  }
                });
              },
              onError: () => {
                setStatusText("Processing error — retrying...");
                setStep("LISTENING");
                setTimeout(() => startRecordingRef.current(), 1000);
              },
            }
          );
        } catch {
          setStatusText("Audio error — try again");
          setStep("LISTENING");
        }
      };

      recorder.start(100);
      setIsRecording(true);
      setStep("LISTENING");
      setStatusText("Listening...");

      // 10-second no-response timer — re-prompt if silence too long
      noResponseTimerRef.current = setTimeout(() => {
        if (stepRef.current === "LISTENING") {
          const prompt = NO_RESPONSE_PROMPTS[langRef.current] ?? NO_RESPONSE_PROMPTS.English;
          speakText(prompt, langRef.current, () => {
            startRecordingRef.current();
          });
        }
      }, NO_RESPONSE_MS);

      // Silence detection
      const data = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart: number | null = null;
      const detect = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
        const avg = sum / data.length;
        if (avg < SILENCE_THRESHOLD) {
          if (silenceStart === null) silenceStart = Date.now();
          else if (Date.now() - silenceStart >= SILENCE_MS) {
            if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
            if (recorder.state !== "inactive") { recorder.stop(); setIsRecording(false); }
            return;
          }
        } else {
          silenceStart = null;
          clearNoResponseTimer();
        }
        silenceRafRef.current = requestAnimationFrame(detect);
      };
      silenceRafRef.current = requestAnimationFrame(detect);
    } catch {
      setStatusText("Microphone access denied. Please allow mic.");
    }
  }, [sessionId, processCall, speakText]);

  // Assign to ref so recorder.onstop can call it
  useEffect(() => {
    startRecordingRef.current = doRecord;
  }, [doRecord]);

  const startCall = useCallback(() => {
    stopAll();
    setHumanTookOver(false);
    setCallResult(null);
    setLiveTranscript("");
    resetSession.mutate(
      { data: { sessionId } },
      {
        onSuccess: () => {
          setStep("LISTENING");
          setStatusText("VAANI greeting...");
          // Speak multilingual greeting, then start listening
          const greeting = Object.values(GREETINGS).join(" ... ");
          speakText(greeting, "English", () => {
            setStatusText("Listening...");
            startRecordingRef.current();
          });
        },
      }
    );
  }, [sessionId, resetSession, stopAll, speakText]);

  const handleFeedback = (fb: "Correct" | "Wrong") => {
    if (!callResult) return;
    submitFeedback.mutate({
      data: {
        transcript: callResult.transcript,
        issue: callResult.issue,
        emotion: callResult.emotion,
        language: callResult.language,
        urgency: callResult.urgency,
        confidence: callResult.confidence,
        level: callResult.level,
        feedback: fb,
      },
    });
    stopAll();
    setStep("IDLE");
    setCallResult(null);
    setLiveTranscript("");
    setStatusText("Ready to connect");
  };

  const endCall = () => {
    stopAll();
    setStep("IDLE");
    setCallResult(null);
    setLiveTranscript("");
    setHumanTookOver(false);
    setStatusText("Ready to connect");
  };

  const handleHumanTakeover = () => {
    stopAll();
    setHumanTookOver(true);
    setStatusText("Human agent in control");
    speakText(
      callResult?.language === "Kannada"
        ? "Neemane, neen officer jote maatanadi vaagidaare."
        : callResult?.language === "Telugu"
        ? "Manaku officer ki connect chestunnamu."
        : callResult?.language === "Hindi"
        ? "Aapko abhi ek officer se jod rahe hain."
        : "Please hold. Connecting you to a human officer right now.",
      callResult?.language ?? "English",
      () => {}
    );
  };

  const handleSuggestedResponse = (text: string) => {
    if (!callResult) return;
    speakText(text, callResult.language, () => {
      startRecordingRef.current();
    });
  };

  useEffect(() => { return () => stopAll(); }, [stopAll]);

  const isDistressed =
    callResult?.emotion === "DISTRESSED" ||
    callResult?.emotion === "FEARFUL" ||
    callResult?.emotion === "ANGRY";

  const orbBorder = humanTookOver
    ? "border-blue-400 shadow-[0_0_60px_rgba(96,165,250,0.5)]"
    : isDistressed
    ? "border-red-500 shadow-[0_0_70px_rgba(239,68,68,0.6)]"
    : "border-indigo-500 shadow-[0_0_60px_rgba(99,102,241,0.4)]";

  const flowSteps: Step[] = ["IDLE", "LISTENING", "PROCESSING", "VERIFICATION", "SUMMARY"];

  const emotionColor =
    isDistressed ? "text-red-400" : callResult?.emotion === "CALM" ? "text-green-400" : "text-yellow-400";

  return (
    <Shell>
      <div className="flex h-full w-full overflow-hidden">

        {/* ── Left sidebar: System Flow ── */}
        <div className="w-56 shrink-0 border-r border-white/5 bg-[#07070f] p-4 flex flex-col gap-6">
          <div>
            <p className="mb-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">System Flow</p>
            <div className="space-y-1">
              {flowSteps.map((s) => (
                <motion.div
                  key={s}
                  animate={{ opacity: step === s ? 1 : 0.35, x: step === s ? 4 : 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${
                    step === s ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30" : "text-slate-500"
                  }`}
                >
                  {step === s && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />}
                  {s}
                </motion.div>
              ))}
            </div>
          </div>

          {callResult && (
            <div>
              <p className="mb-3 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Detection</p>
              <div className="space-y-2">
                <div className="rounded bg-white/4 border border-white/5 p-2">
                  <p className="text-[9px] text-slate-500 uppercase">Language</p>
                  <p className="text-xs text-slate-200 font-medium mt-0.5">{callResult.language}</p>
                </div>
                <div className="rounded bg-white/4 border border-white/5 p-2">
                  <p className="text-[9px] text-slate-500 uppercase">Dialect</p>
                  <p className="text-xs text-slate-300 mt-0.5">{callResult.dialect}</p>
                </div>
                <div className="rounded bg-white/4 border border-white/5 p-2">
                  <p className="text-[9px] text-slate-500 uppercase">Emotion</p>
                  <p className={`text-xs font-bold mt-0.5 ${emotionColor}`}>{callResult.emotion}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-white/5">
            <p className="text-[9px] text-slate-600 uppercase tracking-widest mb-1">Status</p>
            <p className="text-xs text-slate-400 leading-relaxed">{statusText}</p>
            {isSpeaking && (
              <p className="text-[10px] text-indigo-400 mt-1 animate-pulse">Speaking — interrupt to stop</p>
            )}
          </div>
        </div>

        {/* ── Center: Voice orb + bilingual transcript ── */}
        <div className="flex flex-1 flex-col items-center justify-center relative bg-[#050508] overflow-hidden">
          {/* Mode badge */}
          {callResult && (
            <div className="absolute top-4">
              <Modebadge mode={callResult.mode} />
            </div>
          )}

          <AnimatePresence mode="wait">
            {step === "IDLE" ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-6"
              >
                <div className="text-center mb-2">
                  <h2 className="text-2xl font-bold text-slate-200 tracking-wide">VAANI</h2>
                  <p className="text-xs text-slate-500 mt-1">Multilingual AI Dispatch — 1092</p>
                </div>
                <Button
                  data-testid="button-connect"
                  size="lg"
                  onClick={startCall}
                  className="gap-3 text-base h-14 px-10 rounded-full bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/30"
                >
                  <PhoneCall className="h-5 w-5" /> Connect Call 1092
                </Button>
                <p className="text-xs text-slate-600">English · Hindi · Kannada · Telugu</p>
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-6 w-full px-6"
              >
                {/* Orb */}
                <div className={`relative flex h-44 w-44 items-center justify-center rounded-full border-2 ${orbBorder} transition-all duration-500`}>
                  {isRecording && (
                    <>
                      <motion.div className="absolute inset-0 rounded-full border-2 border-indigo-400/20"
                        animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ repeat: Infinity, duration: 1.5 }} />
                      <motion.div className="absolute inset-0 rounded-full border border-indigo-400/10"
                        animate={{ scale: [1, 1.45, 1], opacity: [0.3, 0, 0.3] }}
                        transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} />
                    </>
                  )}
                  <motion.div
                    animate={{ scale: isRecording ? [1, 1.07, 1] : isSpeaking ? [1, 1.04, 1] : 1 }}
                    transition={{ repeat: Infinity, duration: 0.9 }}
                  >
                    {isRecording ? (
                      <Mic className={`h-14 w-14 ${isDistressed ? "text-red-400" : "text-indigo-400"}`} />
                    ) : isSpeaking ? (
                      <motion.div
                        className={`h-14 w-14 flex items-end justify-center gap-1`}
                        aria-label="Speaking"
                      >
                        {[0, 1, 2, 3, 4].map((i) => (
                          <motion.div
                            key={i}
                            className="w-1.5 rounded-full bg-indigo-400"
                            animate={{ height: ["8px", `${16 + i * 6}px`, "8px"] }}
                            transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                          />
                        ))}
                      </motion.div>
                    ) : (
                      <Mic className="h-14 w-14 text-slate-600" />
                    )}
                  </motion.div>
                </div>

                {/* State label */}
                <p className="text-base font-medium text-slate-300 tracking-wide">
                  {humanTookOver ? "Human Agent Active" :
                    step === "LISTENING" ? "Listening..." :
                    step === "PROCESSING" ? "Analyzing..." :
                    step === "VERIFICATION" ? "Verifying understanding..." :
                    step === "SECOND_ATTEMPT" ? "Please clarify..." :
                    step === "SUMMARY" ? "Call summarized" : step}
                </p>

                {/* Bilingual transcript */}
                <AnimatePresence>
                  {(liveTranscript || callResult) && (
                    <motion.div
                      key="transcript"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="w-full max-w-xl"
                    >
                      <div className="rounded-xl border border-white/8 bg-white/3 p-4 space-y-3">
                        {/* Native language */}
                        <div>
                          <p className="text-[9px] text-indigo-400 uppercase tracking-widest mb-1">
                            {callResult?.language ?? "Caller"} — Transcript
                          </p>
                          <p className="text-sm text-slate-200 leading-relaxed">
                            {callResult?.transcript ?? liveTranscript}
                          </p>
                        </div>
                        {/* English translation — only show if not English */}
                        {callResult && callResult.language !== "English" && callResult.translation && callResult.translation !== callResult.transcript && (
                          <div className="border-t border-white/8 pt-3">
                            <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">English Translation</p>
                            <p className="text-sm text-slate-400 leading-relaxed">{callResult.translation}</p>
                          </div>
                        )}
                        {/* VAANI response */}
                        {callResult?.response && (
                          <div className="border-t border-indigo-500/20 pt-3">
                            <p className="text-[9px] text-indigo-400 uppercase tracking-widest mb-1">VAANI Response</p>
                            <p className="text-sm text-indigo-200 leading-relaxed">{callResult.response}</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Feedback at SUMMARY */}
                <AnimatePresence>
                  {step === "SUMMARY" && !humanTookOver && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-3"
                    >
                      <Button data-testid="button-correct" variant="outline"
                        onClick={() => handleFeedback("Correct")}
                        className="gap-2 border-green-500/40 text-green-400 hover:bg-green-500/10">
                        <Check className="h-4 w-4" /> Correct
                      </Button>
                      <Button data-testid="button-wrong" variant="outline"
                        onClick={() => handleFeedback("Wrong")}
                        className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10">
                        <X className="h-4 w-4" /> Wrong
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer controls */}
          {step !== "IDLE" && (
            <div className="absolute bottom-5 flex items-center gap-3">
              <Button data-testid="button-mic" variant="outline" size="icon"
                onClick={() => {
                  if (isRecording) {
                    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
                    setIsRecording(false);
                  } else { startRecordingRef.current(); }
                }}
                className={`h-11 w-11 rounded-full border ${isRecording ? "border-indigo-500/50 bg-indigo-600/20 text-indigo-300" : "border-white/10 text-slate-500"}`}>
                {isRecording ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </Button>
              <Button data-testid="button-end-call" variant="outline" size="icon"
                onClick={endCall}
                className="h-11 w-11 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10">
                <PhoneOff className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Right sidebar: Agent Dashboard ── */}
        <div className="w-80 shrink-0 border-l border-white/5 bg-[#07070f] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {step !== "IDLE" && !humanTookOver && (
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              )}
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
                {humanTookOver ? "Agent Control" : "Agent Dashboard"}
              </p>
            </div>
            {step !== "IDLE" && callResult && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                callResult.level === 3 ? "bg-red-500/20 text-red-400" :
                callResult.level === 2 ? "bg-yellow-500/20 text-yellow-400" :
                "bg-green-500/20 text-green-400"}`}>
                L{callResult.level}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {callResult ? (
              <>
                {/* Live call info */}
                <div className="rounded-lg border border-white/8 bg-white/2 p-3 space-y-2.5">
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Live Call Info</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Confidence", value: `${callResult.confidence}%`, cls: callResult.confidence >= 85 ? "text-green-400" : callResult.confidence >= 60 ? "text-yellow-400" : "text-red-400" },
                      { label: "Urgency", value: `${callResult.urgency}/10`, cls: parseInt(callResult.urgency) >= 8 ? "text-red-400" : parseInt(callResult.urgency) >= 6 ? "text-yellow-400" : "text-green-400" },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="rounded bg-white/3 border border-white/5 p-2">
                        <p className="text-[9px] text-slate-500 uppercase">{label}</p>
                        <p className={`text-sm font-bold mt-0.5 ${cls}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {callResult.issue && (
                    <div>
                      <p className="text-[9px] text-slate-500 uppercase mb-1">Issue Detected</p>
                      <p className="text-xs text-slate-300">{callResult.issue}</p>
                    </div>
                  )}

                  {callResult.emergency_keywords?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-slate-500 uppercase mb-1.5">Keywords</p>
                      <div className="flex flex-wrap gap-1">
                        {callResult.emergency_keywords.map((kw, i) => (
                          <span key={i} className="rounded bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 text-[10px] font-medium">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Agent briefing (Mode 2/3) */}
                {callResult.agent_briefing && callResult.mode >= 2 && (
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                    <p className="text-[9px] text-yellow-500 uppercase tracking-widest font-semibold mb-2">AI Briefing</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{callResult.agent_briefing}</p>
                  </div>
                )}

                {/* Suggested responses (Mode 2) */}
                {callResult.mode === 2 && callResult.suggested_responses?.length > 0 && !humanTookOver && (
                  <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                    <p className="text-[9px] text-indigo-400 uppercase tracking-widest font-semibold mb-2.5">Suggested Responses</p>
                    <div className="space-y-2">
                      {callResult.suggested_responses.map((resp, i) => (
                        <button
                          key={i}
                          data-testid={`button-suggest-${i}`}
                          onClick={() => handleSuggestedResponse(resp)}
                          className="w-full text-left rounded-md bg-indigo-600/10 border border-indigo-500/20 px-3 py-2 text-xs text-slate-300 hover:bg-indigo-600/20 hover:border-indigo-400/40 transition-colors flex items-center gap-2 group"
                        >
                          <ChevronRight className="h-3 w-3 text-indigo-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                          {resp}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mode 3 — agent briefing box */}
                {callResult.mode === 3 && !humanTookOver && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                      <p className="text-[9px] text-red-400 uppercase tracking-widest font-bold">Immediate Escalation</p>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed mb-3">
                      High distress or low confidence detected. Human agent required immediately.
                    </p>
                  </div>
                )}

                {/* Edit response area */}
                {!humanTookOver && callResult.mode >= 2 && (
                  <div>
                    {agentEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editedResponse}
                          onChange={(e) => setEditedResponse(e.target.value)}
                          className="w-full rounded-md bg-white/5 border border-white/10 text-xs text-slate-200 p-2.5 resize-none h-20 focus:outline-none focus:border-indigo-500/50"
                          placeholder="Type custom response..."
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => {
                            if (editedResponse.trim()) handleSuggestedResponse(editedResponse);
                            setAgentEditing(false);
                          }} className="flex-1 text-xs h-8 bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30">
                            Send
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setAgentEditing(false)}
                            className="text-xs h-8 border-white/10 text-slate-400">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditedResponse(""); setAgentEditing(true); }}
                        className="w-full rounded-md border border-white/8 bg-white/3 text-xs text-slate-500 py-2 hover:border-white/15 hover:text-slate-400 transition-colors"
                      >
                        Edit Custom Response
                      </button>
                    )}
                  </div>
                )}

                {/* Take Over button */}
                {!humanTookOver && step !== "IDLE" && (
                  <Button
                    data-testid="button-takeover"
                    onClick={handleHumanTakeover}
                    className="w-full gap-2 bg-red-600/15 border border-red-500/40 text-red-300 hover:bg-red-600/25 hover:border-red-400/60 text-sm"
                    variant="outline"
                  >
                    <UserCheck className="h-4 w-4" /> Take Over Call
                  </Button>
                )}

                {humanTookOver && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/8 p-3 text-center">
                    <p className="text-xs text-blue-300 font-semibold">Human Agent In Control</p>
                    <p className="text-[10px] text-slate-500 mt-1">AI transcribing silently</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center gap-3">
                <div className="h-10 w-10 rounded-full border border-white/8 flex items-center justify-center">
                  <Users className="h-4 w-4 text-slate-600" />
                </div>
                <p className="text-xs text-slate-600">Waiting for call...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
