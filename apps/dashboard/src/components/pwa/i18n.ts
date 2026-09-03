// Field PWA UI strings — 8 SIH-26001 languages.
// Alert bodies come from the server templates (server/i18n.ts); these are
// the interface labels for the offline-first citizen/field view.
export type PwaLang = "en" | "hi" | "bn" | "as" | "ne" | "kha" | "lus" | "mni";

export const PWA_LANGS: { code: PwaLang; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "as", label: "Assamese", native: "অসমীয়া" },
  { code: "ne", label: "Nepali", native: "नेपाली" },
  { code: "kha", label: "Khasi", native: "Ka Ktien Khasi" },
  { code: "lus", label: "Mizo", native: "Mizo ṭawng" },
  { code: "mni", label: "Manipuri", native: "Meiteilon" },
];

type Dict = Record<string, string>;

const en: Dict = {
  app: "BhuRakshak Field",
  home: "Home",
  report: "Report",
  alerts: "Alerts",
  online: "Online",
  offline: "Offline — reports queue on device",
  goOnline: "Reconnect & sync",
  newReport: "New report",
  reportType: "What did you see?",
  type_crack: "Slope crack",
  type_flow: "Debris flow",
  type_roadblock: "Road blocked",
  type_seepage: "Water seepage",
  note: "Description",
  notePh: "e.g. fresh crack above the culvert, 2 m long…",
  photo: "Add photo (Edge Vision)",
  analyzing: "Analyzing on device…",
  submit: "Send report",
  queued: "Queued offline",
  synced: "Synced",
  empty: "No reports yet. Your community's first report starts here.",
  langHint: "Alert language",
  alertSample: "Sample alert in your language",
  sos: "I need help",
  zone: "Zone",
};

const t: Record<PwaLang, Dict> = {
  en,
  hi: {
    app: "भूरक्षक फ़ील्ड", home: "होम", report: "रिपोर्ट", alerts: "चेतावनी",
    online: "ऑनलाइन", offline: "ऑफ़लाइन — रिपोर्ट डिवाइस पर सुरक्षित", goOnline: "फिर से जुड़ें",
    newReport: "नई रिपोर्ट", reportType: "आपने क्या देखा?",
    type_crack: "ढलान पर दरार", type_flow: "मलबा प्रवाह", type_roadblock: "सड़क अवरुद्ध", type_seepage: "पानी रिसाव",
    note: "विवरण", notePh: "जैसे: पुल के ऊपर नई दरार, 2 मीटर लंबी…",
    photo: "फ़ोटो जोड़ें (एज विज़न)", analyzing: "डिवाइस पर विश्लेषण…", submit: "रिपोर्ट भेजें",
    queued: "ऑफ़लाइन क़तार में", synced: "सिंक हो गया",
    empty: "अभी कोई रिपोर्ट नहीं। आपके समुदाय की पहली रिपोर्ट यहीं से शुरू होती है।",
    langHint: "चेतावनी भाषा", alertSample: "आपकी भाषा में नमूना चेतावनी", sos: "मुझे मदद चाहिए", zone: "ज़ोन",
  },
  bn: {
    app: "ভুরক্ষক ফিল্ড", home: "হোম", report: "রিপোর্ট", alerts: "সতর্কতা",
    online: "অনলাইন", offline: "অফলাইন — রিপোর্ট ডিভাইসে সংরক্ষিত", goOnline: "পুনরায় সংযোগ করুন",
    newReport: "নতুন রিপোর্ট", reportType: "আপনি কী দেখেছেন?",
    type_crack: "ঢালে ফাটল", type_flow: "ধ্বংসস্তূপ প্রবাহ", type_roadblock: "রাস্তা বন্ধ", type_seepage: "পানি চুইয়ে পড়া",
    note: "বিবরণ", notePh: "যেমন: কালভার্টের উপরে নতুন ফাটল, ২ মিটার…",
    photo: "ছবি যোগ করুন (এজ ভিশন)", analyzing: "ডিভাইসে বিশ্লেষণ…", submit: "রিপোর্ট পাঠান",
    queued: "অফলাইন সারিতে", synced: "সিঙ্ক হয়েছে",
    empty: "এখনও কোনও রিপোর্ট নেই। আপনার এলাকার প্রথম রিপোর্ট এখান থেকেই শুরু।",
    langHint: "সতর্কতার ভাষা", alertSample: "আপনার ভাষায় নমুনা সতর্কতা", sos: "আমার সাহায্য দরকার", zone: "জোন",
  },
  as: {
    app: "ভূৰক্ষক ফিল্ড", home: "হ'ম", report: "ৰিপৰ্ট", alerts: "সতৰ্কতা",
    online: "অনলাইন", offline: "অফলাইন — ৰিপৰ্ট ডিভাইচত সংৰক্ষিত", goOnline: "পুনৰ সংযোগ কৰক",
    newReport: "নতুন ৰিপৰ্ট", reportType: "আপুনি কি দেখিছে?",
    type_crack: "ঢালত ফাঁট", type_flow: "ধ্বংসাৱশেষ প্ৰবাহ", type_roadblock: "পথ বন্ধ", type_seepage: "পানী চুই পৰা",
    note: "বিৱৰণ", notePh: "যেনে: কালভাৰ্টৰ ওপৰত নতুন ফাঁট, ২ মিটাৰ…",
    photo: "ফটো যোগ কৰক (এজ ভিশন)", analyzing: "ডিভাইচত বিশ্লেষণ…", submit: "ৰিপৰ্ট পঠিয়াওক",
    queued: "অফলাইন শাৰীত", synced: "ছিংক হ'ল",
    empty: "এতিয়াও কোনো ৰিপৰ্ট নাই। আপোনাৰ অঞ্চলৰ প্ৰথম ৰিপৰ্ট ইয়াৰ পৰাই আৰম্ভ।",
    langHint: "সতৰ্কতাৰ ভাষা", alertSample: "আপোনাৰ ভাষাত নমুনা সতৰ্কতা", sos: "মোক সহায় লাগে", zone: "জ'ন",
  },
  ne: {
    app: "भूरक्षक फिल्ड", home: "होम", report: "रिपोर्ट", alerts: "चेतावनी",
    online: "अनलाइन", offline: "अफलाइन — रिपोर्ट डिभाइसमा सुरक्षित", goOnline: "फेरि जोड्नुहोस्",
    newReport: "नयाँ रिपोर्ट", reportType: "तपाईंले के देख्नुभयो?",
    type_crack: "ढल्कामा चिरा", type_flow: "पहिरो बग्ने", type_roadblock: "बाटो बन्द", type_seepage: "पानी चुहिने",
    note: "विवरण", notePh: "जस्तै: कल्भर्टमाथि नयाँ चिरा, २ मिटर…",
    photo: "फोटो थप्नुहोस् (एज भिजन)", analyzing: "डिभाइसमा विश्लेषण…", submit: "रिपोर्ट पठाउनुहोस्",
    queued: "अफलाइन लाममा", synced: "सिङ्क भयो",
    empty: "अझै रिपोर्ट छैन। तपाईंको समुदायको पहिलो रिपोर्ट यहीँबाट सुरु हुन्छ।",
    langHint: "चेतावनी भाषा", alertSample: "तपाईंको भाषामा नमूना चेतावनी", sos: "मलाई मद्दत चाहियो", zone: "जोन",
  },
  kha: {
    app: "BhuRakshak Field", home: "Home", report: "Report", alerts: "Alerts",
    online: "Online", offline: "Offline — report kmen sha kat kthuh", goOnline: "Reconnect",
    newReport: "Report weiting", reportType: "La sah ha i weit?",
    type_crack: "Shiteng byrdep", type_flow: "Mihba longshuwa", type_roadblock: "Bam thlur", type_seepage: "Dkhar um",
    note: "Description", notePh: "e.g. byrdep weiting ha u culvert…",
    photo: "Add photo (Edge Vision)", analyzing: "Analyzing on device…", submit: "Send report",
    queued: "Queued offline", synced: "Synced",
    empty: "Ham report kham. I community report bainiang ban start.",
    langHint: "Alert language", alertSample: "Sample alert ha ka lang", sos: "Ngoh sum help", zone: "Zone",
  },
  lus: {
    app: "BhuRakshak Field", home: "Home", report: "Report", alerts: "Alerts",
    online: "Online", offline: "Offline — report device-ah save a ni", goOnline: "Reconnect",
    newReport: "Report thar", reportType: "I hmu engtin?",
    type_crack: "Sakhat thla", type_flow: "Thingmui tui", type_roadblock: "Kan leh thlak", type_seepage: "Tui kal chhuak",
    note: "Description", notePh: "e.g. culvert chungah sakhat thar…",
    photo: "Photo add (Edge Vision)", analyzing: "Device-a analyze…", submit: "Report thawn",
    queued: "Offline-a queue", synced: "Synced",
    empty: "Report awm lo. I hnam report hmasa hetah hian start a ni.",
    langHint: "Alert language", alertSample: "Sample alert in language", sos: "Ka pui duh", zone: "Zone",
  },
  mni: {
    app: "BhuRakshak Field", home: "Home", report: "Report", alerts: "Alerts",
    online: "Online", offline: "Offline — report device-da pirak", goOnline: "Reconnect",
    newReport: "Report amasung", reportType: "Nahak kari puari?",
    type_crack: "Phamchao phaba", type_flow: "Chingi turel", type_roadblock: "Lamlok taret", type_seepage: "Isik turraba",
    note: "Description", notePh: "e.g. culvert kiangda phaba amasung…",
    photo: "Photo add (Edge Vision)", analyzing: "Device-da analyze…", submit: "Report thaba",
    queued: "Offline queue", synced: "Synced",
    empty: "Report loure. Nahagi leibakgi report amasung tauthokpi.",
    langHint: "Alert language", alertSample: "Sample alert", sos: "E kari", zone: "Zone",
  },
};

export function pwaT(lang: PwaLang, key: string): string {
  return t[lang]?.[key] ?? t.en[key] ?? key;
}
