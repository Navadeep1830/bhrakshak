/**
 * Vision pre-screener — server-side VLM (z-ai-web-dev-sdk) analysis of
 * citizen crack photos. Returns structured flags; falls back to null on
 * any failure so the text heuristic still scores the report.
 */
import ZAI from 'z-ai-web-dev-sdk';

export interface VisionScreen {
  flagged: boolean;
  confidence: number;
  severity: 'none' | 'minor' | 'moderate' | 'severe';
  findings: string;
}

const PROMPT = `You are a landslide-hazard pre-screener for a field safety app in Northeast India.
Analyse this citizen photo for signs of landslide risk: ground/road/slope cracks, tension cracks,
slope movement, subsidence, slumping, water seepage, debris, or retaining-wall damage.
Reply with ONLY compact JSON, no markdown:
{"flagged": true|false, "confidence": 0.0-1.0, "severity": "none|minor|moderate|severe", "findings": "one short sentence (max 18 words)"}`;

function parseScreen(reply: string | null | undefined): VisionScreen | null {
  if (!reply) return null;
  try {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const sev = ['none', 'minor', 'moderate', 'severe'].includes(j.severity) ? j.severity : 'none';
    return {
      flagged: !!j.flagged,
      confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)),
      severity: sev as VisionScreen['severity'],
      findings: String(j.findings ?? '').slice(0, 140),
    };
  } catch {
    return null;
  }
}

/**
 * Pre-screen a photo (data URL) with the vision model. 20 s timeout —
 * on any failure returns null (heuristic fallback covers it).
 */
export async function preScreenPhoto(dataUrl: string): Promise<VisionScreen | null> {
  try {
    const zai = await ZAI.create();
    const res = (await Promise.race([
      zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ] as any,
          },
        ],
        thinking: { type: 'disabled' },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('vision-timeout')), 20_000)),
    ])) as any;
    return parseScreen(res?.choices?.[0]?.message?.content);
  } catch (e) {
    console.error('[vision] pre-screen failed:', (e as Error).message);
    return null;
  }
}
