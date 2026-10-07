// Ghost Hand - UI language: English, Hindi (Devanagari) and Hinglish (Latin script, casual).
//
//   LANGS                     [{ id, name }]
//   t(key, vars)              the string for the current language ({name}-style placeholders)
//   setLang(id) / getLang()   choose (saved in localStorage "gh.lang") / read the language
//   onLang(fn)                fn(id) after each change; returns an unsubscribe function
//   translateDom(root)        fills [data-i18n="key"] text and [data-i18n-attr="attr:key;attr:key"]
//   STRINGS                   { key: { en, hi, hinglish } }
//   KEYS                      [{ key, en }] every key with its English text (for wiring)
//
// Game words, Hush's questions, word prompts, board letters (A-Z, YES, NO, GOODBYE) and
// Hush's spoken flavour lines stay in English: they are content, not UI.

export const LANGS = [
  { id: "en", name: "English" },
  { id: "hi", name: "हिन्दी" },
  { id: "hinglish", name: "Hinglish" },
];

const HTML_LANG = { en: "en", hi: "hi", hinglish: "hi-Latn" };
const STORE = "gh.lang";

// key: [English, Hindi, Hinglish]
const T = {
  // ---- top bar and board (index.html)
  "top.home": ["Ghost Hand home", "घोस्ट हैंड होम", "Ghost Hand home"],
  "top.roomCode": ["Room code", "टेबल कोड", "Table code"],
  "top.addDevice": ["Add a device", "एक और डिवाइस जोड़ो", "Ek aur device jodo"],
  "top.comfort": ["Comfort settings", "आराम की सेटिंग्स", "Comfort settings"],
  "top.comfortShort": ["Comfort", "आराम", "Comfort"],
  "top.sound": ["Sound on or off", "आवाज़ चालू या बंद", "Sound on ya off"],
  "top.soundShort": ["Sound", "आवाज़", "Sound"],
  "board.label": ["The talking board", "बोलने वाला बोर्ड", "Bolne wala board"],
  "lang.label": ["Language", "भाषा", "Bhasha"],

  // ---- landing
  "landing.tagPush": ["Push together.", "मिलकर धकेलो।", "Saath mein push karo."],
  "landing.tagQuiet": ["Don't talk.", "बोलना मना है।", "Bolna mana hai."],
  "landing.subline": [
    "Rest your hands on one shared planchette and spell a sentence nobody wrote.",
    "सब एक ही प्लैंचेट पर हाथ रखो और ऐसा वाक्य लिखो जो किसी ने नहीं लिखा।",
    "Sab ek hi planchette pe haath rakho aur aisa sentence banao jo kisi ne likha hi nahi.",
  ],
  "landing.trySolo": ["Try it solo", "अकेले खेलकर देखो", "Solo try karo"],
  "landing.oneMin": ["· 1 min", "· 1 मिनट", "· 1 min"],
  "landing.playSolo": ["Play solo", "अकेले खेलो", "Solo khelo"],
  "landing.startTable": ["Start a table", "टेबल शुरू करो", "Table shuru karo"],
  "landing.haveCode": ["Have a code?", "कोड है?", "Code hai?"],
  "landing.codeLetter": ["Code letter {n}", "कोड का अक्षर {n}", "Code ka letter {n}"],
  "landing.scrapbook": ["Scrapbook", "स्क्रैपबुक", "Scrapbook"],
  "landing.scrapbookCount": ["Scrapbook · {n}", "स्क्रैपबुक · {n}", "Scrapbook · {n}"],
  "landing.wardrobe": ["Hush's wardrobe", "हश की अलमारी", "Hush ki almaari"],
  "landing.howTo": ["How to play", "कैसे खेलें", "Kaise khelein"],
  "landing.step1": ["Hush whispers you a word", "हश चुपके से तुम्हें एक शब्द बताता है", "Hush chupke se ek word batata hai"],
  "landing.step2": ["Rest your hand, don't talk", "हाथ रखो, बोलो मत", "Haath rakho, bolo mat"],
  "landing.step3": ["Push together", "मिलकर धकेलो", "Saath mein push karo"],
  "landing.clickPlanchette": ["Click the planchette to begin.", "शुरू करने के लिए प्लैंचेट पर क्लिक करो।", "Shuru karne ke liye planchette pe click karo."],
  "landing.seanceEnded": ["That seance has ended. Start your own?", "वह बैठक ख़त्म हो चुकी है। अपनी शुरू करें?", "Woh seance khatam ho gaya. Apna shuru karein?"],
  "landing.noTable": ["No table called {code}. Check it, or start one.", "{code} नाम की कोई टेबल नहीं है। कोड जाँचो या नई टेबल शुरू करो।", "{code} naam ki koi table nahi hai. Code check karo, ya nayi shuru karo."],
  "landing.noServer": ["Hush couldn't find a table. Try again?", "हश को कोई टेबल नहीं मिली। फिर से कोशिश करें?", "Hush ko table nahi mili. Phir se try karein?"],
  "app.couldNotStart": ["Could not start: {msg}", "शुरू नहीं हो सका: {msg}", "Start nahi ho paya: {msg}"],

  // ---- lobby
  "lobby.tableCode": ["Table code", "टेबल कोड", "Table code"],
  "lobby.copyLink": ["Copy link", "लिंक कॉपी करो", "Link copy karo"],
  "lobby.share": ["Share", "शेयर करो", "Share karo"],
  "lobby.qrCaption": ["Open on your phone too", "अपने फ़ोन पर भी खोलो", "Apne phone pe bhi kholo"],
  "lobby.pack": ["Pack", "पैक", "Pack"],
  "lobby.lock": ["Lock table", "टेबल लॉक करो", "Table lock karo"],
  "lobby.unlock": ["Unlock table", "टेबल अनलॉक करो", "Table unlock karo"],
  "lobby.begin": ["Begin", "शुरू करो", "Shuru karo"],
  "lobby.ghostFriends": ["Play with ghost friends", "भूत दोस्तों के साथ खेलो", "Ghost friends ke saath khelo"],
  "lobby.muteMics": ["On a call? Mute your mics.", "कॉल पर हो? माइक म्यूट कर लो।", "Call pe ho? Mic mute kar lo."],
  "lobby.you": ["(you)", "(तुम)", "(tum)"],
  "lobby.host": ["host", "होस्ट", "host"],
  "lobby.newName": ["New name", "नया नाम", "Naya naam"],
  "lobby.ghostFriend": ["ghost friend", "भूत दोस्त", "ghost friend"],
  "lobby.emptySeat": ["Empty seat", "ख़ाली सीट", "Khaali seat"],
  "lobby.handsAtTable": ["{n} hands at the table", "टेबल पर {n} हाथ", "Table pe {n} haath"],
  "lobby.oneHand": ["One hand can't move it. Invite a friend.", "एक हाथ से यह नहीं हिलेगा। किसी दोस्त को बुलाओ।", "Ek haath se yeh nahi hilega. Kisi dost ko bulao."],
  "lobby.restAll": ["Rest all hands to begin.", "शुरू करने के लिए सब अपना हाथ रखो।", "Shuru karne ke liye sab haath rakho."],
  "lobby.shareText": ["Rest your hand on my board. No talking!", "मेरे बोर्ड पर हाथ रखो। बोलना मना है!", "Mere board pe haath rakho. Bolna mana hai!"],
  "lobby.linkCopied": ["Link copied", "लिंक कॉपी हो गया", "Link copy ho gaya"],
  "lobby.tableFull": ["Table full. Watching live.", "टेबल भर गई है। तुम लाइव देख रहे हो।", "Table full hai. Live dekh rahe ho."],
  "lobby.satDown": ["{name} sat down", "{name} बैठ गए", "{name} baith gaye"],

  // ---- packs (names only; the questions inside stay English)
  "pack.cozy": ["Cozy Kitchen", "आरामदेह रसोई", "Cozy Kitchen"],
  "pack.office": ["Office Haunts", "दफ़्तर के भूत", "Office ke bhoot"],
  "pack.travel": ["Travel Tales", "सफ़र की कहानियाँ", "Safar ki kahaniyan"],
  "pack.mystery": ["Tiny Mysteries", "छोटे-छोटे रहस्य", "Chhote-chhote mysteries"],
  "pack.chai": ["Chai Time", "चाय का वक़्त", "Chai Time"],
  "pack.kids": ["Kids Table", "बच्चों की टेबल", "Bacchon ki table"],
  "pack.filmy": ["Filmy Nights", "फ़िल्मी रातें", "Filmy Nights"],
  "pack.school": ["School Days", "स्कूल के दिन", "School ke din"],
  "pack.party": ["Office Party", "ऑफ़िस पार्टी", "Office Party"],

  // ---- today's question, twists and the TV view
  "daily.chip": ["Today's question: {ask}", "आज का सवाल: {ask}", "Aaj ka sawaal: {ask}"],
  "daily.tables": ["{n} tables", "{n} टेबल", "{n} tables"],
  "daily.oneTable": ["1 table", "1 टेबल", "1 table"],
  "daily.badge": ["Today's question", "आज का सवाल", "Aaj ka sawaal"],
  "daily.play": ["Play today's question solo", "आज का सवाल अकेले खेलो", "Aaj ka sawaal solo khelo"],
  "twist.whisper": ["Whisper", "फुसफुसाहट", "Whisper"],
  "twist.gust": ["Gust", "हवा का झोंका", "Gust"],
  "twist.secret": ["Hush keeps this one secret", "हश यह राज़ अभी नहीं बताएगा", "Hush yeh raaz abhi nahi batayega"],
  "cap.twist": ["twist: {line}", "ट्विस्ट: {line}", "twist: {line}"],
  "cap.gustWind": ["gust of wind", "हवा का झोंका", "hawa ka jhonka"],
  "cap.clue": ["the clue appears: {prompt}", "सुराग़ दिखा: {prompt}", "clue dikha: {prompt}"],
  "cap.gasp": ["Hush gasps", "हश चौंक जाता है", "Hush chaunk jaata hai"],
  "cap.daily": ["today's question", "आज का सवाल", "aaj ka sawaal"],
  "a11y.inked": ["{ch} inked", "{ch} लिखा गया", "{ch} likh gaya"],
  "a11y.sentence": ["The table spelled: {sentence}", "टेबल ने लिखा: {sentence}", "Table ne likha: {sentence}"],
  "lobby.tv": ["Show on a TV", "टीवी पर दिखाओ", "TV pe dikhao"],
  "lobby.tvLabel": ["Open a big-screen view of this table in a new tab", "इस टेबल का बड़ा व्यू नए टैब में खोलो", "Is table ka bada view naye tab mein kholo"],
  "tv.leads": ["{name} leads", "{name} आगे हैं", "{name} lead kar rahe hain"],
  "tv.join": ["Join at {url}", "{url} पर जुड़ो", "{url} pe judo"],
  "tv.picking": ["Choosing words in secret...", "चुपके से शब्द चुने जा रहे हैं...", "Chupke se words chune ja rahe hain..."],

  // ---- the seance
  "play.sayHi": ["Say hi together.", "मिलकर HI लिखो।", "Milke HI likho."],
  "play.sayHiLong": ["Say hi together. Everyone can see it.", "मिलकर HI लिखो। सबको दिखेगा।", "Milke HI likho. Sabko dikhega."],
  "play.yourWord": ["Your word:", "तुम्हारा शब्द:", "Tumhara word:"],
  "play.keepingPlace": ["Hush is keeping your place.", "हश तुम्हारी जगह संभाल रहा है।", "Hush tumhari jagah sambhaal raha hai."],
  "play.follow": ["Follow {name}", "{name} के साथ चलो", "{name} ko follow karo"],
  "play.theirWord": ["Their word is {prompt}", "उनका शब्द: {prompt}", "Unka word: {prompt}"],
  "play.hushHelping": ["Hush is helping with {name}'s word", "हश {name} के शब्द में मदद कर रहा है", "Hush {name} ke word mein help kar raha hai"],
  "play.knockFrom": ["Knock knock from {name}", "{name} ने खटखटाया", "{name} ne knock kiya"],
  "play.knock": ["Knock", "खटखटाओ", "Knock"],
  "play.padHint": ["Hold here to rest your hand", "हाथ रखने के लिए यहाँ दबाए रखो", "Haath rakhne ke liye yahan dabaye rakho"],
  "play.tapPad": ["Tap the pad to aim your hand.", "हाथ की दिशा देने के लिए पैड पर टैप करो।", "Haath aim karne ke liye pad pe tap karo."],
  "play.tapStop": ["Tap the middle to stop.", "रुकने के लिए बीच में टैप करो।", "Rukne ke liye beech mein tap karo."],
  "play.reconnecting": ["Hush dropped the teacup. Reconnecting...", "हश से चाय का कप गिर गया। फिर से जुड़ रहे हैं...", "Hush se teacup gir gaya. Reconnect ho raha hai..."],
  "play.veilThin": ["The veil is thin...", "परदा पतला है...", "Parda patla hai..."],
  "play.someone": ["Someone", "कोई", "Koi"],

  // ---- the guided first seance (TUTORIAL.lines in shared/content/hush-lines.js)
  "tut.restLaptop": ["Click the planchette to rest your hand.", "हाथ रखने के लिए प्लैंचेट पर क्लिक करो।", "Haath rakhne ke liye planchette pe click karo."],
  "tut.restPhone": ["Hold the pad to rest your hand.", "हाथ रखने के लिए पैड दबाए रखो।", "Haath rakhne ke liye pad dabaye rakho."],
  "tut.follow1": ["Lean where Nani leans.", "जिधर नानी झुकें, उधर झुको।", "Jidhar Nani jhukein, udhar jhuko."],
  "tut.lead": ["Your turn. Only you see the glow.", "तुम्हारी बारी। चमक सिर्फ़ तुम्हें दिखती है।", "Tumhari baari. Glow sirf tumhe dikhta hai."],
  "tut.pointLaptop": ["Point right at your letter.", "ठीक अपने अक्षर पर पॉइंट करो।", "Seedha apne letter pe point karo."],
  "tut.liftPhone": ["Lift your thumb to stop.", "रुकने के लिए अँगूठा उठाओ।", "Rukne ke liye thumb utha lo."],
  "tut.filled": ["Hush finished the word.", "हश ने शब्द पूरा कर दिया।", "Hush ne word poora kar diya."],
  "tut.replayAsk": ["Leave this table and replay the tutorial?", "यह टेबल छोड़कर ट्यूटोरियल फिर से खेलें?", "Yeh table chhod ke tutorial phir se khelein?"],
  "tut.replay": ["Replay", "फिर से खेलो", "Replay karo"],

  // ---- pick
  "pick.inSecret": ["Pick one in secret:", "चुपके से एक चुनो:", "Chupke se ek chuno:"],
  "pick.yourWordIs": ["Your word is", "तुम्हारा शब्द है", "Tumhara word hai"],
  "pick.waiting": ["Chosen in secret. Waiting for the others...", "चुपके से चुन लिया। बाक़ी लोगों का इंतज़ार है...", "Chupke se chun liya. Baaki logon ka wait hai..."],

  // ---- reveal
  "reveal.speak": ["Now you may speak.", "अब तुम बोल सकते हो।", "Ab tum bol sakte ho."],
  "reveal.laugh": ["Laugh", "हँसी", "Hasi"],
  "reveal.gasp": ["Gasp", "हैरानी", "Shock"],
  "reveal.heart": ["Heart", "दिल", "Dil"],
  "reveal.tea": ["Tea", "चाय", "Chai"],
  "reveal.again": ["Another cup", "एक कप और", "Ek cup aur"],
  "reveal.shareCard": ["Share card", "शेयर कार्ड", "Share card"],
  "reveal.scrapbook": ["Scrapbook", "स्क्रैपबुक", "Scrapbook"],
  "reveal.wardrobe": ["Wardrobe", "अलमारी", "Almaari"],
  "reveal.closeBook": ["Close the book", "किताब बंद करो", "Kitaab band karo"],
  "reveal.twoScreens": ["Feel it on two screens.", "दो स्क्रीन पर महसूस करो।", "Do screens pe feel karo."],
  "reveal.scanOr": ["Scan with your phone, or", "फ़ोन से स्कैन करो, या", "Phone se scan karo, ya"],
  "reveal.secondWindow": ["Open a second window", "दूसरी विंडो खोलो", "Doosri window kholo"],
  "reveal.swift": ["Swift", "फुर्तीले", "Fast"],
  "reveal.steady": ["Steady", "स्थिर", "Steady"],
  "reveal.sure": ["Sure", "पक्के", "Pakke"],
  "reveal.knewOnce": ["The table knew once", "टेबल को एक बार पहले से पता था", "Table ko ek baar pehle se pata tha"],
  "reveal.knewTimes": ["The table knew {n} times", "टेबल को {n} बार पहले से पता था", "Table ko {n} baar pehle se pata tha"],
  "reveal.you": ["you", "तुम", "tum"],
  "reveal.You": ["You", "तुम", "Tum"],
  "reveal.wantAgain": ["{n} want another cup", "{n} को एक कप और चाहिए", "{n} ko ek cup aur chahiye"],
  "reveal.pouring": ["Pouring another cup...", "एक और कप डाल रहे हैं...", "Ek aur cup daal rahe hain..."],
  "reveal.scrapbookStarted": ["Hush started a scrapbook", "हश ने एक स्क्रैपबुक शुरू की", "Hush ne scrapbook shuru ki"],

  // ---- dialogs
  "dialog.notNow": ["Not now", "अभी नहीं", "Abhi nahi"],
  "dialog.leaveTable": ["Leave the table?", "टेबल छोड़ दें?", "Table chhod dein?"],
  "dialog.leave": ["Leave", "छोड़ो", "Chhodo"],
  "dialog.dupe": ["This hand is open in another tab. Sit here?", "यह हाथ दूसरे टैब में खुला है। यहाँ बैठें?", "Yeh haath doosre tab mein khula hai. Yahan baithein?"],
  "dialog.sitHere": ["Sit here", "यहाँ बैठो", "Yahan baitho"],
  "dialog.moved": ["This hand moved to another tab.", "यह हाथ दूसरे टैब में चला गया।", "Yeh haath doosre tab mein chala gaya."],
  "dialog.backHome": ["Back home", "वापस होम पर", "Wapas home"],
  "dialog.fresher": ["A fresher Hush is here. Reload?", "नया हश आ गया है। रीलोड करें?", "Naya Hush aa gaya hai. Reload karein?"],
  "dialog.reload": ["Reload", "रीलोड करो", "Reload karo"],
  "dialog.wrong": ["Something went wrong.", "कुछ गड़बड़ हो गई।", "Kuch gadbad ho gayi."],
  "dialog.startOwn": ["Start your own table", "अपनी टेबल शुरू करो", "Apni table shuru karo"],
  "dialog.addDevice": ["Open {url} on another device to add a second hand.", "दूसरा हाथ जोड़ने के लिए किसी और डिवाइस पर {url} खोलो।", "Doosra haath jodne ke liye kisi aur device pe {url} kholo."],

  // ---- captions (sound described in words)
  "cap.hum": ["Hush hums", "हश गुनगुनाता है", "Hush gungunata hai"],
  "cap.humQuestion": ["Hush hums a question", "हश एक सवाल गुनगुनाता है", "Hush ek sawaal gungunata hai"],
  "cap.join": ["pop: {name} sat down", "पॉप: {name} बैठ गए", "pop: {name} baith gaye"],
  "cap.breakaway": ["two plucks: the planchette slides", "दो टनक: प्लैंचेट फिसलता है", "do pluck: planchette slide karta hai"],
  "cap.wobble": ["wood wobbles: not that one", "लकड़ी डगमगाती है: वो नहीं", "lakdi hilti hai: woh nahi"],
  "cap.gust": ["Hush blows a soft gust", "हश हल्की-सी फूँक मारता है", "Hush halki si phoonk maarta hai"],
  "cap.ink": ["pluck: {ch} inked", "टनक: {ch} लिखा गया", "pluck: {ch} likh gaya"],
  "cap.letter": ["letter", "अक्षर", "letter"],
  "cap.fill": ["Hush hums the rest of the word", "हश बाक़ी शब्द गुनगुनाता है", "Hush baaki word gungunata hai"],
  "cap.knock": ["knock knock from {name}", "{name} की खट-खट", "{name} ki khat-khat"],
  "cap.sentence": ["Hush hums the sentence", "हश वाक्य गुनगुनाता है", "Hush sentence gungunata hai"],
  "cap.tune": ["a little goodbye tune", "विदाई की छोटी-सी धुन", "ek chhoti si goodbye tune"],
  "cap.creakRising": ["wood creaks, rising", "लकड़ी चरमराती है, तेज़ होती हुई", "lakdi charmarati hai, tez hoti hui"],
  "cap.creakSoft": ["wood creaks softly", "लकड़ी धीरे से चरमराती है", "lakdi dheere se charmarati hai"],
  "cap.dwell": ["a rising hum: settling on a letter", "बढ़ती गुनगुनाहट: एक अक्षर पर टिक रहा है", "badhti hum: ek letter pe tik raha hai"],

  // ---- share sheet (sharecard.js)
  "share.title": ["Your share card", "तुम्हारा शेयर कार्ड", "Tumhara share card"],
  "share.close": ["Close", "बंद करो", "Band karo"],
  "share.drawing": ["Hush is drawing your card", "हश तुम्हारा कार्ड बना रहा है", "Hush tumhara card bana raha hai"],
  "share.share": ["Share", "शेयर करो", "Share karo"],
  "share.saveImage": ["Save image", "इमेज सेव करो", "Image save karo"],
  "share.whatsapp": ["WhatsApp", "WhatsApp", "WhatsApp"],
  "share.copyText": ["Copy text", "टेक्स्ट कॉपी करो", "Text copy karo"],
  "share.instaHint": ["For Instagram, save the image and add it to your story.", "इंस्टाग्राम के लिए इमेज सेव करो और अपनी स्टोरी में लगाओ।", "Instagram ke liye image save karo aur story mein laga do."],
  "share.saved": ["Saved", "सेव हो गया", "Save ho gaya"],
  "share.imageSaved": ["Image saved.", "इमेज सेव हो गई।", "Image save ho gayi."],
  "share.shareFailed": ["Sharing did not work here. Try Save image.", "यहाँ शेयर नहीं हो पाया। इमेज सेव करके देखो।", "Yahan share nahi hua. Image save karke dekho."],
  "share.copied": ["Copied", "कॉपी हो गया", "Copy ho gaya"],
  "share.copiedLive": ["Copied.", "कॉपी हो गया।", "Copy ho gaya."],
  "share.copyFailed": ["Could not copy", "कॉपी नहीं हो पाया", "Copy nahi hua"],
  "share.copyFailedLive": ["Could not copy.", "कॉपी नहीं हो पाया।", "Copy nahi hua."],
  "share.smudged": ["Hush smudged the ink.", "हश से स्याही फैल गई।", "Hush se ink phail gayi."],
  "share.retry": ["Try again", "फिर से कोशिश करो", "Phir se try karo"],
  "share.cardAlt": ["Share card: {sentence}", "शेयर कार्ड: {sentence}", "Share card: {sentence}"],
  "share.message": ["{sentence} - we spelled this together on Ghost Hand {link}", "{sentence} - यह हमने Ghost Hand पर मिलकर लिखा {link}", "{sentence} - yeh humne Ghost Hand pe milke likha {link}"],
  "share.gifSave": ["Save replay GIF", "रीप्ले GIF सेव करो", "Replay GIF save karo"],
  "share.gifShare": ["Share replay GIF", "रीप्ले GIF शेयर करो", "Replay GIF share karo"],
  "share.gifMaking": ["Making the GIF", "GIF बन रहा है", "GIF ban raha hai"],
  "share.gifSaved": ["GIF saved.", "GIF सेव हो गया।", "GIF save ho gaya."],
  "share.gifSavedShort": ["Saved", "सेव हो गया", "Save ho gaya"],
  "share.gifFailed": ["Could not make the GIF. Try again?", "GIF नहीं बन पाया। फिर से कोशिश करें?", "GIF nahi ban paya. Phir se try karein?"],
};

export const STRINGS = Object.fromEntries(Object.entries(T).map(([k, [en, hi, hinglish]]) => [k, { en, hi, hinglish }]));
export const KEYS = Object.entries(T).map(([key, [en]]) => ({ key, en }));

// ------------------------------------------------------------ state

const valid = (id) => LANGS.some((l) => l.id === id);
function initial() {
  // ?lang=hi (or en, hinglish) for this page load only: handy for testing and shared links.
  try { const q = new URLSearchParams(location.search).get("lang"); if (valid(q)) return q; } catch {}
  try { const v = localStorage.getItem(STORE); if (valid(v)) return v; } catch {}
  try {
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
    if (list.some((l) => /^hi\b/i.test(String(l)))) return "hi";
  } catch {}
  return "en";
}

let lang = initial();
const subs = new Set();

function syncHtml() {
  try { document.documentElement.lang = HTML_LANG[lang] || "en"; } catch {}
}
syncHtml();

/** The current language id ("en" | "hi" | "hinglish"). */
export function getLang() { return lang; }

/** Choose a language; saved for next time. Unknown ids are ignored. */
export function setLang(id) {
  if (!valid(id)) return lang;
  try { localStorage.setItem(STORE, id); } catch {}
  if (id === lang) return lang;
  lang = id;
  syncHtml();
  for (const fn of [...subs]) { try { fn(lang); } catch (e) { console.error(e); } }
  return lang;
}

/** Call fn(id) whenever the language changes. Returns an unsubscribe function. */
export function onLang(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/**
 * The string for `key` in the current language, with {placeholders} filled from vars.
 * Falls back to English, then to the key itself.
 */
export function t(key, vars) {
  const row = STRINGS[key];
  let s = row ? (row[lang] ?? row.en) : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

/**
 * Fill translated text into the DOM:
 *   <button data-i18n="lobby.begin">          -> textContent
 *   <button data-i18n-attr="aria-label:top.sound;title:top.soundShort">  -> attributes
 */
export function translateDom(root = document) {
  try {
    for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.dataset.i18nAttr.split(";")) {
        const [attr, key] = pair.split(":").map((x) => x && x.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
  } catch {}
}
