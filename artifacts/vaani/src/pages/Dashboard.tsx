import React, { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "@/components/layout/Shell";
import { Mic, MicOff, Check, X, PhoneCall, AlertTriangle, Activity } from "lucide-react";
import { useProcessVaaniCall, useSubmitVaaniFeedback, useResetVaaniSession } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const [session, setSession] = useState("");
  const [step, setStep] = useState("IDLE");
  const [callResult, setCallResult] = useState<any>(null);
  
  const processCall = useProcessVaaniCall();
  const submitFeedback = useSubmitVaaniFeedback();
  const resetSession = useResetVaaniSession();

  useEffect(() => {
    setSession(Math.random().toString(36).substring(7));
  }, []);

  const startCall = async () => {
    await resetSession.mutateAsync({ data: { sessionId: session } });
    setStep("LISTENING");
  };

  return (
    <Shell>
      <div className="flex h-full w-full">
        <div className="w-64 border-r border-border bg-card/50 p-4">
          <h3 className="mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">System Flow</h3>
          <div className="space-y-2">
            {["IDLE", "LISTENING", "PROCESSING", "VERIFICATION", "SUMMARY"].map((s) => (
              <div key={s} className={`rounded p-2 text-sm ${step === s ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground"}`}>
                {s}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col relative items-center justify-center bg-background/80">
           {step === "IDLE" ? (
             <Button size="lg" onClick={startCall} className="gap-2 text-lg h-16 px-8 rounded-full bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30">
               <PhoneCall className="h-6 w-6" /> Connect Call 1092
             </Button>
           ) : (
             <div className="flex flex-col items-center">
               <div className={`relative flex h-64 w-64 items-center justify-center rounded-full border-4 ${
                 callResult?.emotion === "DISTRESSED" ? "border-destructive shadow-[0_0_50px_rgba(239,68,68,0.4)]" : "border-primary shadow-[0_0_50px_rgba(99,102,241,0.4)]"
               }`}>
                 <Activity className={`h-20 w-20 ${callResult?.emotion === "DISTRESSED" ? "text-destructive animate-pulse" : "text-primary animate-pulse"}`} />
               </div>
               <div className="mt-8 text-xl font-medium tracking-wide">
                 {step === "LISTENING" ? "Listening..." : step === "PROCESSING" ? "Processing..." : step}
               </div>
             </div>
           )}

           {step === "SUMMARY" && (
             <div className="absolute bottom-10 flex gap-4">
               <Button onClick={() => { setStep("IDLE"); setCallResult(null); }} variant="outline" className="gap-2 border-green-500/50 text-green-500 hover:bg-green-500/10">
                 <Check className="h-4 w-4" /> Correct
               </Button>
               <Button onClick={() => { setStep("IDLE"); setCallResult(null); }} variant="outline" className="gap-2 border-red-500/50 text-red-500 hover:bg-red-500/10">
                 <X className="h-4 w-4" /> Wrong
               </Button>
             </div>
           )}
        </div>

        <div className="w-80 border-l border-border bg-card/50 p-4 overflow-y-auto">
          <h3 className="mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest">Live Analysis</h3>
          {callResult ? (
            <div className="space-y-4">
              <div>
                <span className="text-xs text-muted-foreground uppercase">Transcript</span>
                <p className="text-sm font-medium mt-1">{callResult.transcript}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-background p-2 border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase block">Emotion</span>
                  <span className={`text-sm font-bold ${callResult.emotion === "DISTRESSED" ? "text-destructive" : "text-primary"}`}>{callResult.emotion}</span>
                </div>
                <div className="rounded bg-background p-2 border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase block">Urgency</span>
                  <span className="text-sm font-bold text-foreground">{callResult.urgency}/10</span>
                </div>
                <div className="rounded bg-background p-2 border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase block">Confidence</span>
                  <span className="text-sm font-bold text-foreground">{callResult.confidence}%</span>
                </div>
                <div className="rounded bg-background p-2 border border-border">
                  <span className="text-[10px] text-muted-foreground uppercase block">Level</span>
                  <span className={`text-sm font-bold ${callResult.level === 3 ? "text-destructive" : callResult.level === 2 ? "text-yellow-500" : "text-green-500"}`}>L{callResult.level}</span>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase block mb-1">Keywords</span>
                <div className="flex flex-wrap gap-1">
                  {callResult.emergency_keywords?.map((kw: string, i: number) => (
                    <span key={i} className="rounded bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 text-xs font-medium">{kw}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Waiting for data...
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
