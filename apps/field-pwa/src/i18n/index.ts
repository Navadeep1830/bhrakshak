// 8 pilot-region languages. Fallback = en. Machine-drafted strings marked TODO
// for native-speaker review before finale (docs/runbook.md).
const dict = {
  en: {
    report: "Report a hazard",
    crack: "Crack", slope_movement: "Slope movement", blocked_road: "Blocked road",
    past_slide: "Past slide", water_seepage: "Water seepage", other: "Other",
    note_ph: "What do you see? (optional)",
    save: "Save report", pending: "Pending sync", synced: "Synced",
    risk_now: "Landslide risk near you", safe_checkin: "I'm safe",
    offline_banner: "Offline — your reports are saved and will sync automatically",
    photo: "Take photo", send_queue: "Sync now",
    emergency_alert: "EMERGENCY: Heavy rainfall landslide risk elevated. Evacuate along marked community trails to relief camp.",
  },
  hi: {
    report: "ख़तरा रिपोर्ट करें",
    crack: "दरार", slope_movement: "ढलान खिसकना", blocked_road: "सड़क बंद",
    past_slide: "पुराना भूस्खलन", water_seepage: "पानी रिसाव", other: "अन्य",
    note_ph: "आप क्या देख रहे हैं? (वैकल्पिक)",
    save: "रिपोर्ट सेव करें", pending: "सिंक लंबित", synced: "सिंक हो गया",
    risk_now: "आपके पास भूस्खलन जोखिम", safe_checkin: "मैं सुरक्षित हूँ",
    offline_banner: "ऑफ़लाइन — रिपोर्ट सेव हैं, नेट आते ही भेज दी जाएँगी",
    photo: "फ़ोटो लें", send_queue: "अभी सिंक करें",
    emergency_alert: "आपातकालीन: भारी वर्षा से भूस्खलन का खतरा। चिन्हित सुरक्षित मार्ग से तुरंत राहत शिविर की ओर जाएं।",
  },
  bn: {
    report: "বিপদ রিপোর্ট করুন", crack: "ফাটল", slope_movement: "ঢাল সরে যাওয়া",
    blocked_road: "রাস্তা বন্ধ", past_slide: "পুরনো ভূমিধস", water_seepage: "জল চুইয়ে",
    other: "অন্যান্য", note_ph: "আপনি কী দেখছেন? (ঐচ্ছিক)", save: "সংরক্ষণ করুন",
    pending: "সিঙ্ক বাকি", synced: "সিঙ্ক হয়েছে", risk_now: "কাছে ভূমিধসের ঝুঁকি",
    safe_checkin: "আমি নিরাপদ", offline_banner: "অফলাইন — ইন্টারনেট এলে পাঠানো হবে",
    photo: "ছবি তুলুন", send_queue: "এখন সিঙ্ক করুন",
    emergency_alert: "জরুরী সতর্কতা: অতিবৃষ্টির কারণে ভূমিধসের সম্ভাবনা। চিহ্নিত নিরাপদ পথে আশ্রয়কেন্দ্রে যান।",
  },
  as: {
    report: "বিপদৰ তথ্য দিয়ক", crack: "ফাট", slope_movement: "ঢাল সৰুওৱা",
    blocked_road: "পথ বন্ধ", past_slide: "পুৰণি ভূমিস্খলন", water_seepage: "পানী গতি",
    other: "অন্যান্য", note_ph: "আপুনি কি দেখি? (ঐচ্ছিক)", save: "সাঁচি থওক",
    pending: "চিংক বাকী", synced: "চিংক হ'ল", risk_now: "ওচৰত ভূমিস্খলনৰ বিপদ",
    safe_checkin: "মই সুৰক্ষিত", offline_banner: "অফলাইন — নেট আহিলে পঠিয়াব",
    photo: "ফটো লওক", send_queue: "এতিয়া চিংক কৰক",
    emergency_alert: "জৰুৰী সতৰ্কতা: প্ৰৱল বৰষুণৰ বাবে ভূমিস্খলনৰ সম্ভাৱনা। নিৰাপদ আশ্ৰয় শিবিৰলৈ স্থানান্তৰ হওক।",
  },
  ne: {
    report: "खतरा रिपोर्ट", crack: "च्याक", slope_movement: "ढल्कान चल्नु",
    blocked_road: "बाटो बन्द", past_slide: "पुरानो भूपतन", water_seepage: "पानी चुहावट",
    other: "अन्य", note_ph: "के देख्नुभयो? (ऐच्छिक)", save: "सेभ गर्नुहोस्",
    pending: "सिंक बाँकी", synced: "सिंक भयो", risk_now: "नजिकै भूपतनको जोखिम",
    safe_checkin: "म सुरक्षित छु", offline_banner: "अफलाइन — नेट आएपछि पठाइनेछ",
    photo: "फोटो लिनुहोस्", send_queue: "अहिले सिंक",
    emergency_alert: "आपतकालीन चेतावनी: भारी वर्षाले पहिरोको जोखिम। सुरक्षित बाटो हुँदै तुरुन्त राहत शिविरमा जानुहोस्।",
  },
  kha: {
    report: "Report jingbit", crack: "Kbañ", slope_movement: "Ka jingren ïaid",
    blocked_road: "Ka sotngai kaba bam", past_slide: "Ka thma kaba la mih",
    water_seepage: "Ka um kaba thied", other: "Kiwein",
    note_ph: "Kaei kaba ïohi? (sngewbha)", save: "Save",
    pending: "Synch da bad", synced: "La synch", risk_now: "Jinga ïeid hapoh",
    safe_checkin: "Nga biang", offline_banner: "Offline — dei ban synch mynta",
    photo: "Thiah ka jingphot", send_queue: "Synch mynta",
    emergency_alert: "JINGMAHAM: Ka slap kaba jur ka lah ban wanrah jingtwad khyndew. Leit noh sha ki jaka shong basa ba la buh.",
  },
  lus: {
    report: "Report tar lang", crack: "Chaw chiah", slope_movement: "Tlang rial",
    blocked_road: "Ral an tluang", past_slide: "Thleng tlak hluih", water_seepage: "Tuibur",
    other: "Danglam", note_ph: "Eng nge i hmu? (chhungkawphah)", save: "Khawn",
    pending: "Synch dawn", synced: "Synch zohtu", risk_now: "I chuan thleng thei",
    safe_checkin: "Ka vang", offline_banner: "Offline — internet ah synch ang",
    photo: "Fiam thar", send_queue: "Synch chuan",
    emergency_alert: "RALRINA: Ruah sur nasa avangin lei min hlauhawm. Hmun him lam pan nghal rawh u.",
  },
  "mni-Mtei": {
    report: "ꯋꯥꯔꯤ ꯊꯥꯒꯠꯄ", crack: "ꯐꯥꯠꯀꯥꯏ", slope_movement: "ꯁ꯭ꯂꯣꯞ ꯆꯥꯡꯗꯝꯅꯕ",
    blocked_road: "ꯂꯝꯃꯔꯛ ꯑꯣꯐ", past_slide: "ꯑꯍꯥꯟꯕ ꯂꯦꯟꯗꯁ꯭ꯂꯥꯏꯗ", water_seepage: "ꯏꯁꯤꯡ ꯆꯦꯟꯕ",
    other: "ꯑꯇꯩ", note_ph: "ꯀꯔꯤ ꯎꯔꯤꯕꯅꯤ?", save: "ꯌꯥꯝꯁꯤꯟꯕ",
    pending: "ꯁꯤꯡꯛ ꯂꯥꯏꯔꯤ", synced: "ꯁꯤꯡꯛ ꯇꯧꯔꯦ", risk_now: "ꯃꯅꯥꯛꯇ ꯋꯥꯈꯜꯂꯤ",
    safe_checkin: "ꯉꯥ ꯁꯨꯔꯛꯁꯤꯠ", offline_banner: "ꯑꯐꯂꯥꯏꯟ — ꯅꯦꯠ ꯂꯥꯏꯔꯒ ꯊꯥꯒꯅꯤ",
    photo: "ꯐꯣꯇꯣ ꯆꯤꯟꯕ", send_queue: "ꯁꯤꯡꯛ ꯇꯧꯕ",
    emergency_alert: "ꯑꯀꯅꯕ ꯆꯦꯀꯁꯤꯟꯋꯥ: ꯅꯣꯡ ꯀꯟꯅ ꯆꯨꯕꯅ ꯃꯔꯝ ꯑꯣꯏꯗꯨꯅ ꯆꯤꯡ ꯂꯦꯟꯕꯒꯤ ꯈꯨꯗꯣꯡꯊꯤꯕ ꯂꯩꯔꯦ। ꯁꯦꯐ ꯀꯦꯝꯄꯇ ꯆꯠꯂꯨ।",
  },
} as const;

export type LangCode = keyof typeof dict;
export const LANGS: { code: LangCode; label: string }[] = [
  { code: "en", label: "English" }, { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" }, { code: "as", label: "অসমীয়া" },
  { code: "ne", label: "नेपाली" }, { code: "kha", label: "Khasi" },
  { code: "lus", label: "Mizo" }, { code: "mni-Mtei", label: "ꯃꯤꯇꯩ" },
];

export function makeT(lang: LangCode) {
  const table = dict[lang] ?? dict.en;
  return (key: keyof typeof dict.en): string =>
    (table as Record<string, string>)[key] ?? dict.en[key];
}
