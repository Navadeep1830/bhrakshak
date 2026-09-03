// 8-language alert templates — verbatim port of
// apps/api/app/services/risk_engine.py DEFAULT_TEMPLATES.
export const LEVEL_NAMES: Record<number, string> = {
  0: "Normal",
  1: "Watch",
  2: "Alert",
  3: "Warning",
  4: "Emergency",
};

export const LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "as", label: "Assamese", native: "অসমীয়া" },
  { code: "ne", label: "Nepali", native: "नेपाली" },
  { code: "kha", label: "Khasi", native: "Ka Ktien Khasi" },
  { code: "lus", label: "Mizo", native: "Mizo ṭawng" },
  { code: "mni", label: "Manipuri (Meitei)", native: "Meiteilon" },
];

export const TEMPLATES: Record<string, string> = {
  "alert.l1|en": "Watch: landslide risk rising near {village} ({level}). Avoid steep slopes. - BhuRakshak",
  "alert.l2|en": "ALERT: landslide risk {level} near {village}. Move away from slope edges. - BhuRakshak",
  "alert.l3|en": "WARNING: high landslide risk ({level}) near {village}. Follow evacuation advice. - District Admin",
  "alert.l4|en": "EMERGENCY ({level}): {village}. Evacuate now via marked routes. - District Admin",
  "alert.allclear|en": "All clear: landslide risk reduced near {village}. - BhuRakshak",

  "alert.l1|hi": "सतर्कता: {village} के पास भूस्खलन का ख़तरा बढ़ रहा है ({level})। ढलानों से दूर रहें। - भूरक्षक",
  "alert.l2|hi": "चेतावनी: {village} के पास भूस्खलन जोखिम ({level})। ढलान किनारों से हटें। - भूरक्षक",
  "alert.l3|hi": "चेतावनी: {village} में भूस्खलन का उच्च ख़तरा ({level})। सलाह का पालन करें। - जिला प्रशासन",
  "alert.l4|hi": "आपातकाल ({level}): {village}। चिह्नित मार्गों से तुरंत निकलें। - जिला प्रशासन",
  "alert.allclear|hi": "सुरक्षित: {village} के पास भूस्खलन ख़तरा कम हुआ। - भूरक्षक",

  "alert.l1|bn": "নজরদারি: {village} এর কাছে ভূমিধসের ঝুঁকি বাড়ছে ({level})। খাড়া ঢাল এড়িয়ে চলুন। - ভুরক্ষক",
  "alert.l2|bn": "সতর্কতা: {village} এর কাছে ভূমিধসের ঝুঁকি ({level})। ঢাল থেকে দূরে থাকুন। - ভুরক্ষক",
  "alert.l3|bn": "বিপদবার্তা: {village} এ ভূমিধসের উচ্চ ঝুঁকি ({level})। উচ্ছেদ নির্দেশ মেনে চলুন। - জেলা প্রশাসন",
  "alert.l4|bn": "জরুরি অবস্থা ({level}): {village}। চিহ্নিত রুট দিয়ে এখনই সরে যান। - জেলা প্রশাসন",
  "alert.allclear|bn": "বিপদমুক্ত: {village} এর কাছে ভূমিধসের ঝুঁকি কমেছে। - ভুরক্ষক",

  "alert.l1|as": "নজৰদাৰী: {village}ৰ ওচৰত ভূমিস্খলনৰ সম্ভাৱনা বাঢ়িছে ({level})। থিয় ঢাল পৰিহাৰ কৰক। - ভূৰক্ষক",
  "alert.l2|as": "সতৰ্কতা: {village}ৰ ওচৰত ভূমিস্খলনৰ আশংকা ({level})। ঢালু স্থানৰ পৰা আঁতৰি থাকক। - ভূৰক্ষক",
  "alert.l3|as": "সতৰ্কবাণী: {village}ৰ ওচৰত ভূমিস্খলনৰ বৃহৎ বিপদ ({level})। প্ৰশাসনৰ পৰামৰ্শ মানি চলক। - জিলা প্ৰশাসন",
  "alert.l4|as": "জৰুৰীকালীন ({level}): {village}। নিৰ্দিষ্ট সুৰক্ষিত পথেৰে তৎকালীনভাৱে স্থান ত্যাগ কৰক। - জিলা প্ৰশাসন",
  "alert.allclear|as": "বিপদমুক্ত: {village}ৰ ওচৰত ভূমিস্খলনৰ শংকা হ্ৰাস পাইছে। - ভূৰক্ষক",

  "alert.l1|ne": "सतर्कता: {village} नजिक भूपतनको जोखिम बढ्दैछ ({level})। भिरालो ठाउँबाट टाढा रहनुहोस्। - भूरक्षक",
  "alert.l2|ne": "चेतावनी: {village} नजिक भूपतनको जोखिम ({level})। ढल्कानबाट टाढा बस्नुहोस्। - भूरक्षक",
  "alert.l3|ne": "गम्भीर चेतावनी: {village} मा उच्च भूपतन जोखिम ({level})। उद्धार सल्लाह पालना गर्नुहोस्। - जिल्ला प्रशासन",
  "alert.l4|ne": "आपतकालिन ({level}): {village}। तोकिएको मार्गबाट तुरुन्त सुरक्षित स्थानमा जानुहोस्। - जिल्ला प्रशासन",
  "alert.allclear|ne": "सुरक्षित: {village} नजिक भूपतनको जोखिम घटेको छ। - भूरक्षक",

  "alert.l1|kha": "Rynjat: mihba kyrsiew jong u longpri da la ka shiteng {village} ({level}). Ban iat ia ka stem tangkat. - BhuRakshak",
  "alert.l2|kha": "Kam sngewbha: kyrsiew jong u longpri ha {village} ({level}). Ban thiah khlem ka shiteng. - BhuRakshak",
  "alert.l3|kha": "Kam lap tang ka bor: kyrsiew iadei jong u longpri ({level}) da {village}. Ban follow ia ka kaei ka dolam. - DC",
  "alert.l4|kha": "Pyndem sunohban ({level}): {village}. Ban la buh tyngain da u bam kyrthei. - DC",
  "alert.allclear|kha": "Sngewbha lap: kyrsiew jong u longpri da kadei {village} shym don rai. - BhuRakshak",

  "alert.l1|lus": "Hnuhkyintuah: thingtuahte pawh a hlauhchhana pung a, {village} chauhah ({level}). Khawhhaw hmunah hnuaiah chuan inh. - BhuRakshak",
  "alert.l2|lus": "Hnuhkyintuah rawh: tuihrial thingtua {village} chauhah a awm ({level}). Lungphum hnarah hman chuan inhlung tur. - BhuRakshak",
  "alert.l3|lus": "Tuahpo: thingtua hlauhchhana sang ({level}) {village} atanga. Dilkhawh min hrilh. - DC",
  "alert.l4|lus": "Thilranglhak ({level}): {village}. Chhungah chuan thlahhmun telin inhaw rawh se. - DC",
  "alert.allclear|lus": "Chhehchhû: {village} chauhah thingtua hlauhchhana a tlem ta. - BhuRakshak",

  "alert.l1|mni": "Laklo: {village} gi machu eeyengl touna leitram phajre ({level}). Nungsi pangol loiba uchanbiyu. - BhuRakshak",
  "alert.l2|mni": "Pakhang: {village} gi machu eeyeng ({level}). Pangol makoktaba uchanbiyu. - BhuRakshak",
  "alert.l3|mni": "Chahi Machu: {village} gi eeyengna asuk ({level}). Urai kongdambagi pangonnbiyu. - DC",
  "alert.l4|mni": "Nongjil Machu ({level}): {village}. Mapanna maraktada houwattounabiyu. - DC",
  "alert.allclear|mni": "Nahak: {village} geida machu eeyengna touna kheirakle. - BhuRakshak",
};

export function renderMessage(
  level: number,
  zoneName: string,
  lang: string,
): string {
  const lvl = Math.max(0, Math.min(4, Math.round(level)));
  const key =
    lvl === 0 ? "alert.allclear" : `alert.l${Math.min(4, Math.max(1, lvl))}`;
  const tpl = TEMPLATES[`${key}|${lang}`] ?? TEMPLATES[`${key}|en`];
  return tpl
    .replace(/\{village\}/g, zoneName)
    .replace(/\{level\}/g, LEVEL_NAMES[lvl] ?? String(lvl));
}
