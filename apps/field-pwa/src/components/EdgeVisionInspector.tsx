import { useEffect, useRef, useState } from "react";

export interface FissureAnalysisResult {
  fissureDensityPct: number;
  maxCrackWidthPx: number;
  structuralRisk: "SAFE" | "MODERATE_SURFACE_SPALLING" | "CRITICAL_TENSION_CRACK";
  edgePixelCount: number;
  totalPixels: number;
  sobelGradientAvg: number;
  processedAt: string;
}

interface EdgeVisionInspectorProps {
  imageSrc?: string | null;
  onAnalysisComplete?: (result: FissureAnalysisResult) => void;
}

export function EdgeVisionInspector({ imageSrc, onAnalysisComplete }: EdgeVisionInspectorProps) {
  const [viewMode, setViewMode] = useState<"original" | "sobel" | "fissure_overlay">("fissure_overlay");
  const [analysis, setAnalysis] = useState<FissureAnalysisResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [threshold, setThreshold] = useState<number>(45);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!imageSrc) {
      setAnalysis(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageSrc;
    img.onload = () => {
      originalImgRef.current = img;
      processEdgeVision(img, threshold);
    };
  }, [imageSrc, threshold]);

  // Re-render canvas when viewMode changes
  useEffect(() => {
    if (originalImgRef.current) {
      processEdgeVision(originalImgRef.current, threshold);
    }
  }, [viewMode]);

  const processEdgeVision = (img: HTMLImageElement, edgeThreshold: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsProcessing(true);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    // Downscale for real-time mobile edge computing (max width 480px maintaining aspect ratio)
    const maxDimension = 480;
    let w = img.width;
    let h = img.height;
    if (w > maxDimension || h > maxDimension) {
      if (w > h) {
        h = Math.round((h * maxDimension) / w);
        w = maxDimension;
      } else {
        w = Math.round((w * maxDimension) / h);
        h = maxDimension;
      }
    }

    canvas.width = w;
    canvas.height = h;

    // 1. Draw Original Image
    ctx.drawImage(img, 0, 0, w, h);
    if (viewMode === "original") {
      setIsProcessing(false);
      return;
    }

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const totalPixels = w * h;

    // 2. Grayscale with Luminance Conversion (0.299R + 0.587G + 0.114B)
    const gray = new Float32Array(totalPixels);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // 3. Gaussian Blur 3x3 Smoothing (Kernel: [1 2 1; 2 4 2; 1 2 1] / 16)
    const blurred = new Float32Array(totalPixels);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const val =
          1 * gray[idx - w - 1] + 2 * gray[idx - w] + 1 * gray[idx - w + 1] +
          2 * gray[idx - 1]     + 4 * gray[idx]     + 2 * gray[idx + 1] +
          1 * gray[idx + w - 1] + 2 * gray[idx + w] + 1 * gray[idx + w + 1];
        blurred[idx] = val / 16.0;
      }
    }

    // 4. Sobel Edge Detection 3x3 Gradient Convolutions
    // Gx: [-1 0 1; -2 0 2; -1 0 1], Gy: [-1 -2 -1; 0 0 0; 1 2 1]
    const edges = new Uint8ClampedArray(totalPixels);
    let edgeCount = 0;
    let gradientSum = 0;
    let maxCrackSpan = 0;

    for (let y = 1; y < h - 1; y++) {
      let consecutiveEdgeSpan = 0;
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const gx =
          -1 * blurred[idx - w - 1] + 1 * blurred[idx - w + 1] +
          -2 * blurred[idx - 1]     + 2 * blurred[idx + 1] +
          -1 * blurred[idx + w - 1] + 1 * blurred[idx + w + 1];

        const gy =
          -1 * blurred[idx - w - 1] - 2 * blurred[idx - w] - 1 * blurred[idx - w + 1] +
           1 * blurred[idx + w - 1] + 2 * blurred[idx + w] + 1 * blurred[idx + w + 1];

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        gradientSum += magnitude;

        if (magnitude > edgeThreshold) {
          edges[idx] = 255;
          edgeCount++;
          consecutiveEdgeSpan++;
          if (consecutiveEdgeSpan > maxCrackSpan) {
            maxCrackSpan = consecutiveEdgeSpan;
          }
        } else {
          edges[idx] = 0;
          consecutiveEdgeSpan = 0;
        }
      }
    }

    // 5. Render Selected Mode on Canvas
    if (viewMode === "sobel") {
      for (let i = 0; i < totalPixels; i++) {
        const p = i * 4;
        const e = edges[i];
        data[p] = e;     // R
        data[p + 1] = e; // G
        data[p + 2] = e; // B
        data[p + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (viewMode === "fissure_overlay") {
      // Draw semi-transparent cyan/crimson overlay on top of original image
      for (let i = 0; i < totalPixels; i++) {
        const p = i * 4;
        if (edges[i] === 255) {
          // Highlight high-gradient fissure cracks in high-visibility neon crimson
          data[p] = 255;     // R
          data[p + 1] = 40;  // G
          data[p + 2] = 80;  // B
          data[p + 3] = 240; // Alpha
        } else {
          // Dim background slightly for contrast
          data[p] = Math.round(data[p] * 0.75);
          data[p + 1] = Math.round(data[p + 1] * 0.75);
          data[p + 2] = Math.round(data[p + 2] * 0.75);
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // 6. Compute Structural Risk Metrics
    const densityPct = Math.round((edgeCount / Math.max(1, totalPixels)) * 1000) / 10;
    const avgGrad = Math.round((gradientSum / Math.max(1, totalPixels)) * 10) / 10;

    let risk: "SAFE" | "MODERATE_SURFACE_SPALLING" | "CRITICAL_TENSION_CRACK" = "SAFE";
    if (densityPct > 7.0 || maxCrackSpan > 25) {
      risk = "CRITICAL_TENSION_CRACK";
    } else if (densityPct > 2.2 || maxCrackSpan > 10) {
      risk = "MODERATE_SURFACE_SPALLING";
    }

    const result: FissureAnalysisResult = {
      fissureDensityPct: densityPct,
      maxCrackWidthPx: maxCrackSpan,
      structuralRisk: risk,
      edgePixelCount: edgeCount,
      totalPixels,
      sobelGradientAvg: avgGrad,
      processedAt: new Date().toISOString(),
    };

    setAnalysis(result);
    setIsProcessing(false);
    onAnalysisComplete?.(result);
  };

  if (!imageSrc) return null;

  return (
    <div className="rounded-xl border border-sky-500/40 bg-slate-900/90 p-3 text-white shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
          <span>🔬 LOCAL EDGE CV INSPECTOR</span>
          <span className="rounded bg-sky-950/80 px-1 py-0.2 text-[9px] text-sky-300 ring-1 ring-sky-700/50">
            Zero-Cloud · Pure Canvas
          </span>
        </div>
        {analysis && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              analysis.structuralRisk === "CRITICAL_TENSION_CRACK"
                ? "bg-rose-950 text-rose-300 ring-1 ring-rose-600 animate-pulse"
                : analysis.structuralRisk === "MODERATE_SURFACE_SPALLING"
                ? "bg-amber-950 text-amber-300 ring-1 ring-amber-600"
                : "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-600"
            }`}
          >
            {analysis.structuralRisk.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Render Canvas */}
      <div className="relative mt-2.5 overflow-hidden rounded-lg border border-slate-700 bg-black flex items-center justify-center">
        <canvas ref={canvasRef} className="max-h-56 w-auto object-contain" />
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs text-xs font-semibold text-sky-300">
            Running Sobel gradient convolution...
          </div>
        )}
      </div>

      {/* View Mode Switcher */}
      <div className="mt-2.5 flex items-center justify-between gap-1 rounded-lg bg-slate-950/80 p-1 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => setViewMode("fissure_overlay")}
          className={`flex-1 rounded py-1 transition-colors ${
            viewMode === "fissure_overlay" ? "bg-rose-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          🚨 Fissure Overlay
        </button>
        <button
          type="button"
          onClick={() => setViewMode("sobel")}
          className={`flex-1 rounded py-1 transition-colors ${
            viewMode === "sobel" ? "bg-sky-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          ⚡ Sobel Gradients
        </button>
        <button
          type="button"
          onClick={() => setViewMode("original")}
          className={`flex-1 rounded py-1 transition-colors ${
            viewMode === "original" ? "bg-slate-700 text-white font-bold" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          📷 Original
        </button>
      </div>

      {/* Sensitivity Slider */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
        <span>Sobel Sensitivity ({threshold})</span>
        <input
          type="range"
          min={20}
          max={90}
          step={5}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-32 accent-sky-500"
        />
      </div>

      {/* Metrics Card */}
      {analysis && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 rounded-lg bg-slate-950/90 p-2 text-center border border-slate-800">
          <div>
            <div className="text-[9px] text-slate-400">Fissure Density</div>
            <div className="text-xs font-mono font-bold text-rose-400">{analysis.fissureDensityPct}%</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400">Max Crack Width</div>
            <div className="text-xs font-mono font-bold text-amber-400">{analysis.maxCrackWidthPx} px</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400">Avg Gradient</div>
            <div className="text-xs font-mono font-bold text-sky-400">{analysis.sobelGradientAvg} ∇</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EdgeVisionInspector;
