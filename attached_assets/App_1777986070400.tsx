import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Square, RefreshCw, AlertCircle, Clock, MapPin, Activity, Zap, Cpu, CheckCircle, XCircle, ChevronRight, PhoneCall } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

enum CallStep {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  VERIFICATION = 'VERIFICATION',
  SECOND_ATTEMPT = 'SECOND_ATTEMPT',
  SUMMARY = 'SUMMARY',
  FEEDBACK = 'FEEDBACK'
}

export default function App() {
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const [step, setStep] = useState<CallStep>(CallStep.IDLE);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('System Offline');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(localStorage.getItem('preferred_voice'));

  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      if (!selectedVoiceURI && v.length > 0) {
        const defaultVoice = v.find(voice => voice.lang.includes('en-IN')) || v[0];
        setSelectedVoiceURI(defaultVoice.voiceURI);
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [selectedVoiceURI]);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const requestRef = useRef<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const [audioLevel, setAudioLevel] = useState(0);
 
   const speak = (text: string, lang: string = 'English') => {
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (selectedVoiceURI) {
      const voice = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (voice) utterance.voice = voice;
    }

    // Map detected language to BCP47 code
    const langMap: Record<string, string> = {
      'English': 'en-IN',
      'Hindi': 'hi-IN',
      'Kannada': 'kn-IN',
      'Telugu': 'te-IN'
    };
    utterance.lang = langMap[lang] || 'en-IN';
    
    utterance.onstart = () => setStatus('AI Speaking...');
    utterance.onend = () => {
      // Auto-start recording after AI finishes if we're in the middle of a session
      // This ensures a continuous conversation flow as requested.
      setStep(prev => {
        if (prev !== CallStep.SUMMARY && prev !== CallStep.IDLE) {
          setStatus('Ready for Citizen Input');
          setTimeout(() => {
            startRecording();
          }, 800);
        }
        return prev;
      });
    };
    
    window.speechSynthesis.speak(utterance);
  };

  const initializeCall = async () => {
    setStep(CallStep.LISTENING);
    setStatus('Ready');
    try {
      await fetch('/api/reset-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
    } catch (err) {
      console.error('Failed to reset session', err);
    }
    const greeting = "Citizen Calls 1092. Emergency Dispatcher AI is active. How can I help you today?";
    speak(greeting);
  };

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Silence Detection Setup
      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.current.createMediaStreamSource(stream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 256;
      source.connect(analyser.current);

      const bufferLength = analyser.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let lastSpeakTime = Date.now();

      const checkSilence = () => {
        if (!analyser.current) return;
        analyser.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((p, c) => p + c, 0) / bufferLength;
        setAudioLevel(average);

        // Dynamic thresholding: if it's consistently quiet, update baseline?
        // For now, let's just make it slightly more natural.
        const threshold = 12; // Slightly higher to ignore soft noise

        if (average > threshold) { 
          lastSpeakTime = Date.now();
          setStatus('Voice active...');
        } else {
          const silenceDuration = Date.now() - lastSpeakTime;
          if (silenceDuration > 500) {
            setStatus(`Listening... (${Math.max(0, Math.floor((2000 - silenceDuration) / 1000 * 10)) / 10}s)`);
          }
        }

        // 2 seconds of silence for auto-submit
        if (Date.now() - lastSpeakTime > 2000) { 
          console.log('Silence detected, auto-submitting...');
          stopRecording();
          return;
        }

        requestRef.current = requestAnimationFrame(checkSilence);
      };
      
      requestRef.current = requestAnimationFrame(checkSilence);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      mediaRecorder.current = new MediaRecorder(stream, { mimeType });
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = async () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        const audioBlob = new Blob(audioChunks.current, { type: mimeType });
        processCall(audioBlob);
      };

      mediaRecorder.current.start(1000);
      setIsRecording(true);
      setStatus('AI Listening...');
    } catch (err) {
      setError('Microphone access denied or not supported.');
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
      if (audioContext.current) audioContext.current.close();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      setIsRecording(false);
      setStatus('Analyzing...');
    }
  };

  const processCall = async (blob: Blob) => {
    setIsProcessing(true);
    setStatus('Analyzing audio...');
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    formData.append('step', step);
    formData.append('sessionId', sessionId);

    try {
      console.log('Sending audio to server with session:', sessionId);
      const response = await fetch('/api/emergency-process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Server responded with ${response.status}`);
      }

      const data = await response.json();
      console.log('Received AI data:', data);
      setResult(data);
      handleStepLogic(data);

    } catch (err: any) {
      console.error('Call process error:', err);
      setError(err.message || 'Processing failed.');
      setStatus('System Error');
      setStep(CallStep.IDLE);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStepLogic = (data: any) => {
    // Speak the AI's generated response in the detected language
    speak(data.response, data.language);

    if (data.emotion === 'DISTRESSED') {
      setStatus('EMERGENCY DETECTED');
      setStep(CallStep.SUMMARY);
    } else if (step === CallStep.VERIFICATION && data.intent === 'YES') {
      setStep(CallStep.SUMMARY);
    } else if (step === CallStep.VERIFICATION && data.intent === 'NO') {
      setStep(CallStep.SECOND_ATTEMPT);
    } else if (step === CallStep.IDLE || step === CallStep.LISTENING || step === CallStep.SECOND_ATTEMPT) {
      setStep(CallStep.VERIFICATION);
    }
  };

  const submitFeedback = async (feedback: 'Correct' | 'Wrong') => {
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: result.transcript,
          issue: result.issue,
          emotion: result.emotion,
          language: result.language,
          feedback
        })
      });
      setStatus('Feedback Saved. System Learning.');
      setTimeout(() => {
        setStep(CallStep.IDLE);
        setResult(null);
        setStatus('System Standby');
      }, 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (showLogs) fetchLogs();
  }, [showLogs]);

  return (
    <div className="w-full h-screen bg-[#050508] text-[#f8fafc] font-sans overflow-hidden relative">
      {/* Ambient Glow */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none z-0 transition-colors duration-1000 ${
        result?.emotion === 'DISTRESSED' ? 'bg-[radial-gradient(circle,_rgba(239,68,68,0.15)_0%,_transparent_70%)]' : 
        'bg-[radial-gradient(circle,_rgba(99,102,241,0.15)_0%,_transparent_70%)]'
      }`} />

      <div className="relative z-10 w-full h-full p-6 grid grid-cols-[280px_1fr_280px] grid-rows-[80px_1fr_160px] gap-5">
        
        {/* Header */}
        <header className="col-span-3 flex justify-between items-center border-b border-white/10 px-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#6366f1] rounded-lg shadow-[0_0_15px_rgba(99,102,241,0.5)] flex items-center justify-center">
              <PhoneCall className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl font-medium tracking-tight">
              CITIZEN CALLS <span className="text-[#6366f1] font-bold">1092</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
             <button 
               onClick={() => setShowHelp(!showHelp)}
               className="text-[10px] bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 px-3 py-1 rounded border border-amber-500/20 uppercase tracking-widest transition-colors flex items-center gap-1.5"
             >
               <AlertCircle className="w-3 h-3" /> Troubleshooting
             </button>
             <div className="flex items-center gap-2 bg-white/5 px-2 py-1 rounded border border-white/10">
               <span className="text-[9px] uppercase font-bold text-white/40">Voice</span>
               <select 
                 value={selectedVoiceURI || ''} 
                 onChange={(e) => {
                   setSelectedVoiceURI(e.target.value);
                   localStorage.setItem('preferred_voice', e.target.value);
                 }}
                 className="bg-transparent text-[10px] outline-none max-w-[120px] truncate"
               >
                 {voices.map(v => (
                   <option key={v.voiceURI} value={v.voiceURI} className="bg-[#0f172a]">{v.name} ({v.lang})</option>
                 ))}
               </select>
             </div>
             <button 
               onClick={() => setShowLogs(!showLogs)}
               className="text-[10px] bg-white/5 hover:bg-white/10 px-3 py-1 rounded border border-white/10 uppercase tracking-widest transition-colors"
             >
               {showLogs ? 'Live Interface' : 'System Logs'}
             </button>
             <div className="bg-[#10b981]/10 text-[#10b981] px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase border border-[#10b981]/20">
               STT ACTIVE (EN/HI/KN/TE)
             </div>
          </div>
        </header>

        {showLogs ? (
          <aside className="col-span-3 bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold uppercase tracking-widest text-[#6366f1]">Deployment History (SQLite)</h2>
              <button onClick={fetchLogs} className="p-2 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              {logs.map((log) => (
                <div key={log.id} className="p-4 bg-white/5 rounded-xl border border-white/5 grid grid-cols-5 gap-4 items-center">
                  <div className="text-[10px] text-white/30 uppercase font-bold">{new Date(log.timestamp).toLocaleString()}</div>
                  <div className="col-span-2">
                    <p className="text-xs font-mono italic">"{log.transcript}"</p>
                  </div>
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded text-center ${log.emotion === 'DISTRESSED' ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
                    {log.emotion}
                  </div>
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded text-center ${log.feedback === 'Correct' ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-red-500/20 text-red-500'}`}>
                    {log.feedback}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : showHelp ? (
          <aside className="col-span-3 bg-[#0a0a10]/80 backdrop-blur-xl border border-amber-500/20 rounded-2xl p-10 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-8">
              <div className="flex items-center justify-between border-b border-white/10 pb-6">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-amber-500 flex items-center gap-3">
                    <AlertCircle className="w-8 h-8" /> Troubleshooting Guide
                  </h2>
                  <p className="text-white/50 mt-1">Connectivity & Audio Resolution Protocols</p>
                </div>
                <button onClick={() => setShowHelp(false)} className="text-xs uppercase tracking-widest bg-white/5 px-4 py-2 rounded-full hover:bg-white/10 transition-all">Close</button>
              </div>

              <section className="space-y-4">
                <h3 className="text-lg font-bold text-white tracking-wide">1. Introduction and understanding of the issue</h3>
                <p className="text-[#94a3b8] leading-relaxed">
                  Connectivity issues where "the user is not responding to my voice or my audio" typically stem from a critical break in the audio-input pipeline. This involves a complex coordination between physical hardware, browser-level permissions, and the application's processing state. For an AI-driven communication system, real-time audio analysis is paramount; any latency or blockage interrupts the semantic decision-making loop, leading to perceived unresponsiveness. Understanding that this is often a local settings or hardware issue rather than a system failure is the first step toward a resolution.
                </p>
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-bold text-white tracking-wide">2. Common causes and diagnostic questions</h3>
                <p className="text-[#94a3b8] leading-relaxed">
                  To identify the root cause, consider the following diagnostic questions:
                </p>
                <ul className="list-disc list-inside text-[#94a3b8] space-y-3">
                  <li><span className="text-white">Is the hardware physically engaged?</span> Check if your headset or microphone has a dedicated mute button or slider that may have been accidentally toggled.</li>
                  <li><span className="text-white">Are browser permissions active?</span> Does the browser tab show the red "recording" icon? Even if previously allowed, permissions can sometimes be revoked during browser updates.</li>
                  <li><span className="text-white">Is there environmental noise interference?</span> Is the ambient noise level too high for the AI to distinguish your voice from background static?</li>
                  <li><span className="text-white">Is the network stable?</span> Unstable connections can lead to packet loss in the audio stream, causing the "Analyzing..." phase to fail or hang.</li>
                </ul>
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-bold text-white tracking-wide">3. Step-by-step troubleshooting procedures</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-5 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-amber-500 font-bold mb-2">I. Hardware & OS Audit</p>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">
                      First, verify that your microphone is recognized by your Operating System. Open your system's Sound Settings and ensure the input levels fluctuate when you speak. If using a mobile device, ensure no other application (like Zoom or a mobile call) is currently "hogging" the microphone hardware.
                    </p>
                  </div>
                  <div className="p-5 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-amber-500 font-bold mb-2">II. Browser Permission Reset</p>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">
                      Click the "lock" icon in your browser's address bar. Ensure the "Microphone" toggle is set to "Allow". If it already is, try toggling it off and on again, then refreshing the page to re-initialize the AudioContext.
                    </p>
                  </div>
                  <div className="p-5 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-amber-500 font-bold mb-2">III. Network & Connectivity Check</p>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">
                      High latency can prevent the AI from processing voice chunks in real-time. If you are on a VPN, try disconnecting it. Ensure you have a stable upload speed to handle the audio telemetry sent to the Gemini engine.
                    </p>
                  </div>
                  <div className="p-5 bg-white/5 rounded-xl border border-white/10">
                    <p className="text-amber-500 font-bold mb-2">IV. Manual Re-initialization</p>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">
                      If the "Analyzing..." status persists without a response, the audio buffer may have stalled. Use the "Reset Session" or refresh the page to clear the local cache and establish a fresh connection to the AI dispatcher.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-10 border-t border-white/10">
                <h3 className="text-lg font-bold text-white tracking-wide">4. Recommendations for further assistance</h3>
                <p className="text-[#94a3b8] leading-relaxed">
                  If these steps do not resolve the issue, it is highly likely that there is a deep conflict with the browser's MediaRecorder API implementation on your specific device. We recommend testing the application in an incognito window to rule out extension interference. For enterprise platforms like Microsoft Teams or Zoom, ensure that "Exclusive Mode" for audio devices is disabled in Windows settings. For persistent failures, please contact system administration with a screenshot of your browser console (F12) to help us diagnose potential API handshake errors.
                </p>
              </section>
            </div>
          </aside>
        ) : (
          <>
            {/* Left Sidebar - Meta */}
            <aside className="bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-2xl p-5 flex flex-col gap-6">
              <div>
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-[#94a3b8] font-bold mb-3">System Flow</h2>
                <div className="space-y-4">
                  <div className={`p-3 rounded-xl border transition-all ${step === CallStep.LISTENING ? 'bg-[#6366f1]/20 border-[#6366f1]' : 'bg-white/5 border-white/5'}`}>
                    <p className="text-[10px] text-white/50 uppercase font-bold">Step 1 — Listen</p>
                    <p className="text-xs mt-1">Multi-dialect AI ingestion</p>
                  </div>
                  <div className={`p-3 rounded-xl border transition-all ${step === CallStep.PROCESSING ? 'bg-[#6366f1]/20 border-[#6366f1]' : 'bg-white/5 border-white/5'}`}>
                    <p className="text-[10px] text-white/50 uppercase font-bold">Step 2 — Emotion</p>
                    <p className="text-xs mt-1">Tone + Pace classification</p>
                  </div>
                  <div className={`p-3 rounded-xl border transition-all ${[CallStep.VERIFICATION, CallStep.SECOND_ATTEMPT].includes(step) ? 'bg-[#6366f1]/20 border-[#6366f1]' : 'bg-white/5 border-white/5'}`}>
                    <p className="text-[10px] text-white/50 uppercase font-bold">Step 3 — Verify</p>
                    <p className="text-xs mt-1">Semantic confirmation loop</p>
                  </div>
                  <div className={`p-3 rounded-xl border transition-all ${step === CallStep.SUMMARY ? 'bg-[#6366f1]/20 border-[#6366f1]' : 'bg-white/5 border-white/5'}`}>
                    <p className="text-[10px] text-white/50 uppercase font-bold">Step 4 — Summary</p>
                    <p className="text-xs mt-1">Responder handoff</p>
                  </div>
                </div>
              </div>

              <div className="mt-auto">
                <h2 className="text-[11px] uppercase tracking-[0.15em] text-[#94a3b8] font-bold mb-3 flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Dialect Accuracy
                </h2>
                <div className="h-10 flex items-end gap-[2px]">
                  {[0.9, 0.85, 0.7, 0.95].map((h, i) => (
                    <div key={i} className="bg-[#6366f1] w-full" style={{ height: `${h * 100}%`, opacity: h }} />
                  ))}
                </div>
                <div className="flex justify-between text-[8px] text-white/30 uppercase font-bold mt-1">
                  <span>EN</span><span>HI</span><span>KN</span><span>TE</span>
                </div>
              </div>
            </aside>

            {/* Main Hub */}
            <main className="flex flex-col items-center justify-center relative">
              <motion.div 
                animate={{ 
                  scale: isRecording ? [1, 1.05, 1] : 1,
                  boxShadow: isRecording 
                    ? '0 0 100px rgba(99, 102, 241, 0.4), inset 0 0 20px rgba(255,255,255,0.2)' 
                    : result?.emotion === 'DISTRESSED' ? '0 0 80px rgba(239,68,68,0.3)' : '0 0 60px rgba(99, 102, 241, 0.1)'
                }}
                transition={{ repeat: Infinity, duration: 2 }}
                className={`w-[220px] h-[220px] rounded-full flex items-center justify-center mb-10 border border-white/10 transition-colors duration-500
                  ${isRecording ? 'bg-[radial-gradient(circle_at_30%_30%,_#ef4444,_#450a0a)]' : 
                    result?.emotion === 'DISTRESSED' ? 'bg-[radial-gradient(circle_at_30%_30%,_#ef4444,_#450a0a)]' :
                    'bg-[radial-gradient(circle_at_30%_30%,_#6366f1,_#1e1b4b)]'}`}
              >
                <div className="flex items-center gap-1.5 h-10">
                  {[12, 24, 38, 18, 28, 12].map((h, i) => (
                    <motion.div 
                      key={i}
                      animate={{ height: (isRecording || isProcessing) ? [h, h*1.5, h*0.5, h] : h }}
                      transition={{ repeat: Infinity, duration: 1, delay: i * 0.1 }}
                      className="w-1 bg-white rounded-full" 
                      style={{ height: h }} 
                    />
                  ))}
                </div>
              </motion.div>

              <div className="text-center">
                <motion.p 
                  key={status}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`text-xl font-medium ${result?.emotion === 'DISTRESSED' ? 'text-red-500' : 'text-[#6366f1]'}`}
                >
                  {status}
                </motion.p>
                {isRecording && (
                  <div className="mt-2 flex items-center justify-center gap-1.5">
                    <div className="flex gap-[2px]">
                       {[...Array(6)].map((_, i) => (
                         <div 
                           key={i} 
                           className={`w-1.5 h-3 rounded-full transition-colors ${audioLevel > (i * 10) ? 'bg-[#6366f1]' : 'bg-white/10'}`} 
                         />
                       ))}
                    </div>
                    <span className="text-[10px] text-white/30 uppercase font-bold tracking-widest">Input Level</span>
                  </div>
                )}
                <p className="text-sm text-[#94a3b8] mt-2 font-light max-w-sm mx-auto">
                  {step === CallStep.IDLE && 'System offline. Connect to initiate AI greeting.'}
                  {step === CallStep.LISTENING && 'Citizen speaking... Describe the emergency.'}
                  {step === CallStep.VERIFICATION && 'Citizen confirmation required...'}
                  {step === CallStep.SUMMARY && 'Verified report ready for responder'}
                </p>
              </div>

              <AnimatePresence>
                {step === CallStep.IDLE && (
                  <motion.button
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={initializeCall}
                    className="mt-6 px-8 py-3 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-full font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(99,102,241,0.4)] flex items-center gap-2 group transition-all"
                  >
                    <PhoneCall className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                    Connect Call 1092
                  </motion.button>
                )}
                {error && (
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 20, opacity: 0 }}
                    className="absolute bottom-4 flex items-center gap-2 text-red-400 text-xs bg-red-400/10 px-4 py-2 rounded-full border border-red-400/20"
                  >
                    <AlertCircle className="w-3 h-3" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </main>

            {/* Right Sidebar - Call Metadata */}
            <aside className="bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-2xl p-5 overflow-hidden flex flex-col">
              <h2 className="text-[11px] uppercase tracking-[0.15em] text-[#94a3b8] font-bold mb-4">Caller Insight</h2>
              <div className="flex-1 overflow-y-auto pr-2 space-y-4 text-sm">
                {result ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                        <span className="text-[10px] text-white/30 uppercase font-bold">Emotion</span>
                        <p className={`text-sm font-bold mt-1 ${result.emotion === 'DISTRESSED' ? 'text-red-400' : 'text-green-400'}`}>
                          {result.emotion}
                        </p>
                      </div>
                      <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                        <span className="text-[10px] text-white/30 uppercase font-bold">Urgency (1-10)</span>
                        <p className={`text-sm font-bold mt-1 ${parseInt(result.urgency) > 7 ? 'text-red-500 underline decoration-red-500/50' : 'text-amber-500'}`}>
                          {result.urgency}
                        </p>
                      </div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[10px] text-white/30 uppercase font-bold">Emergency Keywords</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {result.emergency_keywords?.map((kw: string, i: number) => (
                          <span key={i} className="text-[9px] bg-[#6366f1]/10 text-[#6366f1] px-1.5 py-0.5 rounded border border-[#6366f1]/20 font-bold uppercase">
                            {kw}
                          </span>
                        )) || <span className="text-[9px] text-white/20 italic">None detected</span>}
                      </div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[10px] text-white/30 uppercase font-bold">Detected Language</span>
                      <p className="text-sm font-bold mt-1 text-[#6366f1]">{result.language}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[10px] text-white/30 uppercase font-bold">Transcript</span>
                      <p className="text-xs mt-1 text-[#b4bdca] font-mono leading-relaxed italic">"{result.transcript}"</p>
                    </div>
                    <div className="p-3 bg-white/10 rounded-xl border border-[#6366f1]/30">
                      <span className="text-[10px] text-[#6366f1] uppercase font-bold">Interpreted Issue</span>
                      <p className="text-sm font-medium mt-1">{result.issue}</p>
                    </div>
                  </motion.div>
                ) : (
                  <p className="text-[#94a3b8]/30 italic h-full flex items-center justify-center text-center">No active monitoring...</p>
                )}
              </div>
            </aside>

            {/* Footer - Control Panel */}
            <footer className="col-span-3 bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-around px-10">
              <div className="flex flex-col text-center w-32">
                {result?.language ? (
                  <>
                    <span className="text-lg font-bold text-[#6366f1]">{result.language}</span>
                    <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest mt-1">Detected</span>
                  </>
                ) : (
                  <>
                    <span className="text-lg font-light">STANDBY</span>
                    <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest mt-1">Ingestion</span>
                  </>
                )}
              </div>
              
              {step === CallStep.SUMMARY ? (
                <div className="flex gap-4">
                    <button onClick={() => submitFeedback('Correct')} className="flex flex-col items-center group">
                      <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center group-hover:bg-green-500/20 transition-all">
                        <CheckCircle className="text-green-500" />
                      </div>
                      <span className="text-[10px] text-green-500 uppercase font-bold mt-1">Correct</span>
                    </button>
                    <button onClick={() => submitFeedback('Wrong')} className="flex flex-col items-center group">
                      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center group-hover:bg-red-500/20 transition-all">
                        <XCircle className="text-red-500" />
                      </div>
                      <span className="text-[10px] text-red-500 uppercase font-bold mt-1">Wrong</span>
                    </button>
                </div>
              ) : (
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing || step === CallStep.IDLE}
                  className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all duration-300 transform active:scale-95
                    ${step === CallStep.IDLE ? 'opacity-20 cursor-not-allowed' : ''}
                    ${isRecording 
                      ? 'bg-[#ef4444] border-red-500/20 animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.5)]' 
                      : 'bg-white/10 border-white/5 hover:bg-white/20'}`}
                >
                  {isProcessing ? (
                    <RefreshCw className="w-6 h-6 animate-spin text-[#6366f1]" />
                  ) : isRecording ? (
                    <div className="relative group">
                      <Square className="w-5 h-5 text-white" />
                      <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-[#ef4444] text-[8px] px-2 py-1 rounded font-bold uppercase whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                        Stop & Process
                      </div>
                    </div>
                  ) : (
                    <Mic className="w-6 h-6" />
                  )}
                </button>
              )}

              {isRecording && (
                <button 
                  onClick={stopRecording}
                  className="flex flex-col items-center group animate-in fade-in slide-in-from-bottom-2"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-all">
                    <CheckCircle className="w-4 h-4 text-amber-500" />
                  </div>
                  <span className="text-[9px] text-amber-500 uppercase font-bold mt-1">Submit Now</span>
                </button>
              )}

              <div className="flex flex-col text-center w-32">
                <span className="text-lg font-bold flex items-center justify-center gap-1">
                  <Zap className="w-4 h-4 text-amber-400" /> GEMINI 1.5
                </span>
                <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest mt-1">Model Engine</span>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

