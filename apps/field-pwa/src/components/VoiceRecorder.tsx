import { useEffect, useRef, useState } from "react";

interface VoiceRecorderProps {
  onAudioRecorded: (audioB64: string, durationSec: number) => void;
  onAudioCleared: () => void;
  initialAudioB64?: string;
  initialDurationSec?: number;
}

export function VoiceRecorder({
  onAudioRecorded,
  onAudioCleared,
  initialAudioB64,
  initialDurationSec = 0,
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(initialDurationSec);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Initialize initial audio URL if provided
  useEffect(() => {
    if (initialAudioB64 && !audioUrl) {
      setAudioUrl(initialAudioB64);
      setRecordDuration(initialDurationSec);
    }
  }, [initialAudioB64, initialDurationSec, audioUrl]);

  // Clean up object URLs and recording timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setErrorMessage(null);
    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Audio recording is not supported in this browser environment.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(audioBlob);
        setAudioUrl(localUrl);

        // Convert Blob to Base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          onAudioRecorded(base64Audio, recordDuration);
        };

        // Stop all tracks to release mic
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(250); // Collect data chunks every 250ms
      setIsRecording(true);
      setRecordDuration(0);

      // Start duration counter
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        setRecordDuration(elapsedSec);

        // Auto-stop at 120 seconds max limit
        if (elapsedSec >= 120) {
          stopRecording();
        }
      }, 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Microphone permission denied.";
      setErrorMessage(msg);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  };

  const clearRecording = () => {
    if (audioUrl && audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setRecordDuration(0);
    setErrorMessage(null);
    onAudioCleared();
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-3 text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-200">🎙️ Offline Voice Note</span>
          {isRecording && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-rose-400">
              <span className="h-2 w-2 animate-ping rounded-full bg-rose-500" />
              REC ({formatDuration(recordDuration)})
            </span>
          )}
        </div>
        {audioUrl && !isRecording && (
          <button
            onClick={clearRecording}
            className="text-[10px] font-medium text-rose-400 hover:text-rose-300 underline"
          >
            Clear Audio
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="mt-2 rounded bg-rose-950/60 p-2 text-[11px] text-rose-300 border border-rose-800/40">
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Record / Stop Action Controls */}
      <div className="mt-2.5 flex items-center gap-2">
        {!isRecording ? (
          <button
            type="button"
            onClick={startRecording}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 py-2 text-xs font-semibold text-slate-200 ring-1 ring-slate-600 transition-colors"
          >
            <span>🎙️</span>
            <span>{audioUrl ? "Re-record Voice Note" : "Record Voice Note"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 py-2 text-xs font-bold text-white shadow-lg shadow-rose-950 animate-pulse transition-colors"
          >
            <span>⏹</span>
            <span>Stop Recording ({formatDuration(recordDuration)})</span>
          </button>
        )}
      </div>

      {/* Audio Playback Preview */}
      {audioUrl && !isRecording && (
        <div className="mt-2.5 rounded-lg bg-slate-950/80 p-2 border border-slate-800">
          <div className="mb-1 text-[10px] text-slate-400 font-mono flex justify-between">
            <span>Audio Preview ({formatDuration(recordDuration)})</span>
            <span className="text-emerald-400">✓ Ready to sync</span>
          </div>
          <audio src={audioUrl} controls className="h-8 w-full accent-orange-500" />
        </div>
      )}
    </div>
  );
}

export default VoiceRecorder;
