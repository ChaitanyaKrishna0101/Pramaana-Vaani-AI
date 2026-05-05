import { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "@/components/layout/Shell";
import { Mic, MicOff, Check, X, PhoneCall, Activity, PhoneOff } from "lucide-react";
import {
  useProcessVaaniCall,
  useSubmitVaaniFeedback,
  useResetVaaniSession,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

type Step =
  | "IDLE"
  | "LISTENING"
  | "PROCESSING"
  | "VERIFICATION"
  | "SECOND_ATTEMPT"
  | "SUMMARY"
  | "FEEDBACK";

interface CallResult {
  response: string;
  transcript: string;
  language: string;
  emotion: string;
  urgency: string;
  emergency_keywords: string[];
  issue: string;
  intent: string;
  confidence: number;
  level: number;
}

const LANG_VOICES: Record<string, string> = {
  English: "en-IN",
  Hindi: "hi-IN",
  Kannada: "kn-IN",
  Telugu: "te-IN",
};

const SILENCE_THRESHOLD = 12;
const SILENCE_DURATION_MS = 2000;

export default function Dashboard() {
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const [step, setStep] = useState<Step>("IDLE");
  const [callResult, setCallResult] = useState<CallResult | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [statusText, setStatusText] = useState("Ready to connect");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const interruptAnalyserRef = useRef<AnalyserNode | null>(null);
  const interruptRafRef = useRef<number | null>(null);
  const interruptContextRef = useRef<AudioContext | null>(null);
  const interruptStreamRef = useRef<MediaStream | null>(null);
  const stepRef = useRef<Step>("IDLE");

  const processCall = useProcessVaaniCall();
  const submitFeedback = useSubmitVaaniFeedback();
  const resetSession = useResetVaaniSession();

  stepRef.current = step;

  const stopAll = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    if (interruptRafRef.current) cancelAnimationFrame(interruptRafRef.current);
    if (interruptContextRef.current) {
      interruptContextRef.current.close().catch(() => {});
      interruptContextRef.current = null;
    }
    if (interruptStreamRef.current) {
      interruptStreamRef.current.getTracks().forEach((t) => t.stop());
      interruptStreamRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const speakResponse = useCallback(
    (text: string, language: string, onDone: () => void) => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = LANG_VOICES[language] ?? "en-IN";
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang.startsWith(utter.lang.split("-")[0]));
      if (match) utter.voice = match;
      utter.rate = 0.95;
      speechRef.current = utter;

      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => {
        setIsSpeaking(false);
        stopInterruptMonitor();
        onDone();
      };
      utter.onerror = () => {
        setIsSpeaking(false);
        stopInterruptMonitor();
        onDone();
      };

      window.speechSynthesis.speak(utter);
      startInterruptMonitor(onDone);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const stopInterruptMonitor = () => {
    if (interruptRafRef.current) cancelAnimationFrame(interruptRafRef.current);
    if (interruptContextRef.current) {
      interruptContextRef.current.close().catch(() => {});
      interruptContextRef.current = null;
    }
    if (interruptStreamRef.current) {
      interruptStreamRef.current.getTracks().forEach((t) => t.stop());
      interruptStreamRef.current = null;
    }
  };

  const startInterruptMonitor = (onInterrupt: () => void) => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      interruptStreamRef.current = stream;
      const ctx = new AudioContext();
      interruptContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      interruptAnalyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let triggered = false;

      const check = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += Math.abs(data[i] - 128);
        }
        const avg = sum / data.length;
        if (avg > 20 && !triggered) {
          triggered = true;
          window.speechSynthesis.cancel();
          setIsSpeaking(false);
          stopInterruptMonitor();
          setStatusText("Interrupted — listening...");
          onInterrupt();
          return;
        }
        interruptRafRef.current = requestAnimationFrame(check);
      };
      interruptRafRef.current = requestAnimationFrame(check);
    });
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const chunks: Blob[] = [];
      audioChunksRef.current = chunks;

      const supportedType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType: supportedType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: supportedType });
        if (blob.size < 1000) {
          setStep("LISTENING");
          setStatusText("No clear audio — try again");
          setTimeout(() => startRecording(), 500);
          return;
        }

        try {
          setStep("PROCESSING");
          setStatusText("Analyzing...");
          const audioBase64 = await blobToBase64(blob);
          const currentStep = stepRef.current;

          processCall.mutate(
            {
              data: {
                audioBase64,
                mimeType: supportedType,
                step: currentStep,
                sessionId,
              },
            },
            {
              onSuccess: (result: CallResult) => {
                setCallResult(result);

                let nextStep: Step;
                if (result.emotion === "DISTRESSED" || result.level === 3) {
                  nextStep = "SUMMARY";
                } else if (currentStep === "VERIFICATION" && result.intent === "YES") {
                  nextStep = "SUMMARY";
                } else if (currentStep === "VERIFICATION" && result.intent === "NO") {
                  nextStep = "SECOND_ATTEMPT";
                } else if (currentStep === "SUMMARY") {
                  nextStep = "FEEDBACK";
                } else {
                  nextStep = "VERIFICATION";
                }

                setStep(nextStep);
                setStatusText("Speaking response...");

                speakResponse(result.response, result.language, () => {
                  if (nextStep !== "SUMMARY" && nextStep !== "FEEDBACK") {
                    setStep(nextStep);
                    setStatusText("Listening...");
                    startRecording();
                  } else {
                    setStatusText(
                      nextStep === "SUMMARY" ? "Summarizing call..." : "Awaiting feedback"
                    );
                  }
                });
              },
              onError: () => {
                setStatusText("Error processing — try again");
                setStep("LISTENING");
                setTimeout(() => startRecording(), 1000);
              },
            }
          );
        } catch {
          setStatusText("Audio error — try again");
          setStep("LISTENING");
        }
      };

      recorder.start();
      setIsRecording(true);
      setStep("LISTENING");
      setStatusText("Listening...");

      const data = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart: number | null = null;

      const detectSilence = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
        const avg = sum / data.length;

        if (avg < SILENCE_THRESHOLD) {
          if (silenceStart === null) silenceStart = Date.now();
          else if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
            if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
            if (recorder.state !== "inactive") {
              recorder.stop();
              setIsRecording(false);
            }
            return;
          }
        } else {
          silenceStart = null;
        }
        silenceRafRef.current = requestAnimationFrame(detectSilence);
      };
      silenceRafRef.current = requestAnimationFrame(detectSilence);
    } catch {
      setStatusText("Microphone access denied");
    }
  }, [sessionId, processCall, speakResponse]);

  const startCall = useCallback(async () => {
    stopAll();
    resetSession.mutate(
      { data: { sessionId } },
      {
        onSuccess: () => {
          setCallResult(null);
          setStatusText("Connected — say hello");

          const greeting = "Namaste! You have reached VAANI emergency support. Please describe your issue.";
          setStep("LISTENING");
          speakResponse(greeting, "English", () => {
            startRecording();
          });
        },
      }
    );
  }, [sessionId, resetSession, stopAll, speakResponse, startRecording]);

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
    setStatusText("Ready to connect");
  };

  const endCall = () => {
    stopAll();
    setStep("IDLE");
    setCallResult(null);
    setStatusText("Ready to connect");
  };

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  const isDistressed = callResult?.emotion === "DISTRESSED";
  const levelColor =
    callResult?.level === 3
      ? "text-red-500"
      : callResult?.level === 2
      ? "text-yellow-500"
      : "text-green-500";
  const orbBorder = isDistressed
    ? "border-red-500 shadow-[0_0_60px_rgba(239,68,68,0.5)]"
    : "border-indigo-500 shadow-[0_0_60px_rgba(99,102,241,0.4)]";

  const steps: Step[] = ["IDLE", "LISTENING", "PROCESSING", "VERIFICATION", "SUMMARY"];

  return (
    <Shell>
      <div className="flex h-full w-full overflow-hidden">
        {/* Left sidebar — System Flow */}
        <div className="w-60 shrink-0 border-r border-white/5 bg-[#080810] p-4 flex flex-col">
          <p className="mb-5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            System Flow
          </p>
          <div className="space-y-1">
            {steps.map((s) => (
              <motion.div
                key={s}
                animate={{
                  opacity: step === s ? 1 : 0.4,
                  x: step === s ? 4 : 0,
                }}
                transition={{ duration: 0.2 }}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  step === s
                    ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                    : "text-slate-500"
                }`}
              >
                {s}
              </motion.div>
            ))}
          </div>

          <div className="mt-auto pt-4 border-t border-white/5">
            <p className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">Status</p>
            <p className="text-xs text-slate-400">{statusText}</p>
            {isSpeaking && (
              <p className="text-[10px] text-indigo-400 mt-1 animate-pulse">
                Speaking — interrupt to stop
              </p>
            )}
          </div>
        </div>

        {/* Center — Orb */}
        <div className="flex flex-1 flex-col items-center justify-center relative bg-[#050508]">
          <AnimatePresence mode="wait">
            {step === "IDLE" ? (
              <motion.div
                key="connect"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex flex-col items-center gap-6"
              >
                <Button
                  data-testid="button-connect"
                  size="lg"
                  onClick={startCall}
                  className="gap-3 text-base h-14 px-10 rounded-full bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/30 hover:border-indigo-400/60 transition-all"
                >
                  <PhoneCall className="h-5 w-5" /> Connect Call 1092
                </Button>
                <p className="text-xs text-slate-600">Supports English, Hindi, Kannada, Telugu</p>
              </motion.div>
            ) : (
              <motion.div
                key="orb"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-8"
              >
                {/* Orb */}
                <div className={`relative flex h-52 w-52 items-center justify-center rounded-full border-2 ${orbBorder} transition-all duration-500`}>
                  <motion.div
                    animate={{ scale: isRecording ? [1, 1.08, 1] : isSpeaking ? [1, 1.04, 1] : 1 }}
                    transition={{ repeat: Infinity, duration: isRecording ? 0.8 : 1.2 }}
                  >
                    <Activity
                      className={`h-16 w-16 ${isDistressed ? "text-red-500" : "text-indigo-400"}`}
                    />
                  </motion.div>

                  {/* Mic status ring */}
                  {isRecording && (
                    <motion.div
                      className="absolute inset-0 rounded-full border-2 border-indigo-400/30"
                      animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    />
                  )}
                </div>

                {/* Step label */}
                <div className="text-center">
                  <p className="text-lg font-medium text-slate-200 tracking-wide">
                    {step === "LISTENING"
                      ? "Listening..."
                      : step === "PROCESSING"
                      ? "Processing..."
                      : step === "VERIFICATION"
                      ? "Verifying..."
                      : step === "SECOND_ATTEMPT"
                      ? "Please clarify..."
                      : step === "SUMMARY"
                      ? "Summarizing..."
                      : step}
                  </p>
                  {callResult && (
                    <p className="text-xs text-slate-500 mt-1">
                      {callResult.language} &bull; {callResult.emotion}
                    </p>
                  )}
                </div>

                {/* Feedback buttons at SUMMARY */}
                <AnimatePresence>
                  {step === "SUMMARY" && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-4"
                    >
                      <Button
                        data-testid="button-feedback-correct"
                        variant="outline"
                        onClick={() => handleFeedback("Correct")}
                        className="gap-2 border-green-500/40 text-green-400 hover:bg-green-500/10"
                      >
                        <Check className="h-4 w-4" /> Correct
                      </Button>
                      <Button
                        data-testid="button-feedback-wrong"
                        variant="outline"
                        onClick={() => handleFeedback("Wrong")}
                        className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10"
                      >
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
            <div className="absolute bottom-6 flex items-center gap-4">
              <Button
                data-testid="button-mic-toggle"
                variant="outline"
                size="icon"
                onClick={() => {
                  if (isRecording) {
                    if (
                      mediaRecorderRef.current &&
                      mediaRecorderRef.current.state !== "inactive"
                    ) {
                      mediaRecorderRef.current.stop();
                      setIsRecording(false);
                    }
                  } else {
                    startRecording();
                  }
                }}
                className={`h-12 w-12 rounded-full border ${
                  isRecording
                    ? "border-indigo-500/50 bg-indigo-600/20 text-indigo-300"
                    : "border-white/10 text-slate-500"
                }`}
              >
                {isRecording ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </Button>
              <Button
                data-testid="button-end-call"
                variant="outline"
                size="icon"
                onClick={endCall}
                className="h-12 w-12 rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                <PhoneOff className="h-5 w-5" />
              </Button>
            </div>
          )}
        </div>

        {/* Right sidebar — Live Analysis */}
        <div className="w-72 shrink-0 border-l border-white/5 bg-[#080810] p-4 flex flex-col gap-4 overflow-y-auto">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
            Live Analysis
          </p>

          <AnimatePresence>
            {callResult ? (
              <motion.div
                key="analysis"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4"
              >
                {/* Level badge */}
                <div
                  className={`rounded-lg border p-3 text-center font-bold text-lg ${
                    callResult.level === 3
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : callResult.level === 2
                      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                      : "border-green-500/30 bg-green-500/10 text-green-400"
                  }`}
                  data-testid="text-level"
                >
                  Level {callResult.level} —{" "}
                  {callResult.level === 3
                    ? "Escalate"
                    : callResult.level === 2
                    ? "Review"
                    : "Automated"}
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      label: "Emotion",
                      value: callResult.emotion,
                      className: isDistressed ? "text-red-400" : "text-indigo-400",
                    },
                    {
                      label: "Urgency",
                      value: `${callResult.urgency}/10`,
                      className: "text-slate-200",
                    },
                    {
                      label: "Confidence",
                      value: `${callResult.confidence}%`,
                      className: levelColor,
                    },
                    {
                      label: "Language",
                      value: callResult.language,
                      className: "text-slate-200",
                    },
                  ].map(({ label, value, className }) => (
                    <div
                      key={label}
                      className="rounded-md bg-white/3 border border-white/5 p-2"
                      data-testid={`text-${label.toLowerCase()}`}
                    >
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</p>
                      <p className={`text-sm font-semibold mt-0.5 ${className}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Issue */}
                {callResult.issue && (
                  <div className="rounded-md bg-white/3 border border-white/5 p-3">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Issue</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{callResult.issue}</p>
                  </div>
                )}

                {/* Transcript */}
                <div className="rounded-md bg-white/3 border border-white/5 p-3">
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">
                    Transcript
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">{callResult.transcript}</p>
                </div>

                {/* AI Response */}
                <div className="rounded-md bg-indigo-600/10 border border-indigo-500/20 p-3">
                  <p className="text-[9px] text-indigo-400 uppercase tracking-wider mb-1">
                    VAANI Response
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">{callResult.response}</p>
                </div>

                {/* Keywords */}
                {callResult.emergency_keywords?.length > 0 && (
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-2">
                      Keywords
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {callResult.emergency_keywords.map((kw, i) => (
                        <span
                          key={i}
                          data-testid={`text-keyword-${i}`}
                          className="rounded bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 text-[10px] font-medium"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                className="flex flex-1 items-center justify-center text-xs text-slate-600 text-center py-20"
              >
                Waiting for data...
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Shell>
  );
}
