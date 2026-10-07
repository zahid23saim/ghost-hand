// Questions bank (spec §7.1-§7.3): 9 packs, 72 public questions with hidden 3-slot frames,
// 24 one-slot add-on clauses and 36 Hush reaction templates for the reveal.
// Grammar: {CAT} inserts the word; {a CAT} inserts "A"/"AN" (from the word's article tag) plus
// the word. Frames and clauses are ALL CAPS; clauses are appended to a frame as " " + text.

export const PACKS = [
  { id: "cozy", name: "Cozy Kitchen", blurb: "Kettles, crumbs and kitchen capers." },
  { id: "office", name: "Office Haunts", blurb: "Meetings, mugs and mysterious staplers." },
  { id: "travel", name: "Travel Tales", blurb: "Suitcases, souvenirs and very odd flights." },
  { id: "mystery", name: "Tiny Mysteries", blurb: "Small puzzles with silly answers." },
  { id: "chai", name: "Chai Time", blurb: "Samosas, aunties and monsoon chatter." },
  { id: "kids", name: "Kids Table", blurb: "Short words for little spellers." },
  { id: "filmy", name: "Filmy Nights", blurb: "Rain songs, grand entries, interval samosas." },
  { id: "school", name: "School Days", blurb: "Tiffins, assembly and sports day." },
  { id: "party", name: "Office Party", blurb: "Team lunches, cake and gift swaps." },
];

export const QUESTIONS = [
  // Cozy Kitchen
  {
    id: "cozy-1", pack: "cozy",
    ask: "What happened in my kitchen last night?",
    frame: "{a CREATURE} {ACTION} IN THE {FOOD} AND NOBODY SAID A WORD",
  },
  {
    id: "cozy-2", pack: "cozy",
    ask: "What did I bake for you?",
    frame: "{a FOOD} CAKE SHAPED LIKE {a CREATURE} THAT {ACTION} WHEN WE SANG",
  },
  {
    id: "cozy-3", pack: "cozy",
    ask: "Who keeps borrowing my teapot?",
    frame: "THE {MOOD} SNOWMAN NEXT DOOR WEARS IT AS {a WEAR} EVERY {TIME}",
  },
  {
    id: "cozy-4", pack: "cozy",
    ask: "What's that noise in my fridge?",
    frame: "{a JOB} IS IN THERE TEACHING {a CREATURE} TO SAY {SOUND}",
  },
  {
    id: "cozy-5", pack: "cozy",
    ask: "What's in my secret recipe?",
    frame: "{NUMBER} CUPS OF {FOOD} AND A PINCH OF {TIME}",
  },
  {
    id: "cozy-6", pack: "cozy",
    ask: "Why is my kettle so tired?",
    frame: "IT BOILED EVERY {TIME} TO PLEASE {a MOOD} {JOB}",
  },
  {
    id: "cozy-7", pack: "cozy",
    ask: "What did I find in the biscuit tin?",
    frame: "{a TOY} WRAPPED IN {a WEAR} AND A VERY {MOOD} RAISIN",
  },
  {
    id: "cozy-8", pack: "cozy",
    ask: "Who did the dishes last night?",
    frame: "{a JOB} FROM THE {PLACE} WHO SAID {SOUND} AFTER EVERY CUP",
  },

  // Office Haunts
  {
    id: "office-1", pack: "office",
    ask: "Who secretly runs my office?",
    frame: "{a MOOD} {CREATURE} WHO ONLY SAYS {SOUND}",
  },
  {
    id: "office-2", pack: "office",
    ask: "What happened at my big meeting?",
    frame: "EVERYONE WORE {a WEAR} WHILE {a CREATURE} GAVE A TALK ABOUT {FOOD} SAFETY",
  },
  {
    id: "office-3", pack: "office",
    ask: "What's in the office fridge?",
    frame: "{a THING}, {NUMBER} JARS OF {FOOD} JAM AND A NOTE SAYING SORRY",
  },
  {
    id: "office-4", pack: "office",
    ask: "Why was my boss late today?",
    frame: "THEIR {WEAR} GOT STUCK IN {a THING} DURING THE {TIME} RUSH",
  },
  {
    id: "office-5", pack: "office",
    ask: "What did the printer print today?",
    frame: "{NUMBER} PAGES OF {SOUND} AND A MAP OF THE {PLACE}",
  },
  {
    id: "office-6", pack: "office",
    ask: "Why is my stapler always missing?",
    frame: "{a JOB} USES IT TO FIX {a TOY} EVERY {TIME}",
  },
  {
    id: "office-7", pack: "office",
    ask: "How was the office party?",
    frame: "WE ALL {ACTION} WHILE {a JOB} PLAYED THE {THING}",
  },
  {
    id: "office-8", pack: "office",
    ask: "Who won employee of the month?",
    frame: "THE {THING} BY THE WINDOW, FOR SAYING {SOUND} EVERY {TIME}",
  },

  // Travel Tales
  {
    id: "travel-1", pack: "travel",
    ask: "Where did I go on holiday?",
    frame: "I RODE ON {a CREATURE} TO THE {PLACE} AND BROUGHT BACK {a THING}",
  },
  {
    id: "travel-2", pack: "travel",
    ask: "Why was my flight late?",
    frame: "THE PILOT FELT {MOOD}, SO {a CREATURE} CHEERED THEM UP WITH {a THING}",
  },
  {
    id: "travel-3", pack: "travel",
    ask: "What did I pack in my suitcase?",
    frame: "{NUMBER} TINY UMBRELLAS, {a WEAR} AND {a TOY}",
  },
  {
    id: "travel-4", pack: "travel",
    ask: "Who sat next to me on the plane?",
    frame: "{a JOB} WHO SNORED {SOUND} ALL THE WAY TO THE {PLACE}",
  },
  {
    id: "travel-5", pack: "travel",
    ask: "What was the best snack on my trip?",
    frame: "{FOOD} ICE CREAM, SERVED BY {a MOOD} WAITER IN {a WEAR}",
  },
  {
    id: "travel-6", pack: "travel",
    ask: "What did I see from my window?",
    frame: "{NUMBER} CLOUDS SHAPED LIKE {a THING} AND ONE THAT LOOKED {MOOD}",
  },
  {
    id: "travel-7", pack: "travel",
    ask: "What did my tour guide do?",
    frame: "EVERY {TIME} THEY {ACTION}, POINTED AT A ROCK AND SAID {SOUND}",
  },
  {
    id: "travel-8", pack: "travel",
    ask: "What did I bring back from holiday?",
    frame: "{a TOY} FROM THE {PLACE} PLUS {a JOB} WHO HID IN MY SUITCASE",
  },

  // Tiny Mysteries
  {
    id: "mystery-1", pack: "mystery",
    ask: "Who ate the last biscuit?",
    frame: "{a JOB} IN {a WEAR} WITH {a CREATURE} ON THEIR HEAD",
  },
  {
    id: "mystery-2", pack: "mystery",
    ask: "Where did my missing sock go?",
    frame: "IT RAN OFF TO THE {PLACE} WITH {a CREATURE} AND BECAME {a JOB}",
  },
  {
    id: "mystery-3", pack: "mystery",
    ask: "Who left footprints on my ceiling?",
    frame: "{a CREATURE} WEARING {NUMBER} LITTLE BOOTS, WHO {ACTION} UPSIDE DOWN",
  },
  {
    id: "mystery-4", pack: "mystery",
    ask: "Who keeps ringing my doorbell?",
    frame: "{a JOB} SELLING {FOOD} MUFFINS FROM {a THING}",
  },
  {
    id: "mystery-5", pack: "mystery",
    ask: "Why is my cat so sleepy today?",
    frame: "IT {ACTION} TILL DAWN, FEELING {MOOD} ABOUT {a THING}",
  },
  {
    id: "mystery-6", pack: "mystery",
    ask: "What did I dig up in the garden?",
    frame: "{a THING}, A MAP TO THE {PLACE} AND {NUMBER} SHINY PEBBLES",
  },
  {
    id: "mystery-7", pack: "mystery",
    ask: "Who's been napping in my teapot?",
    frame: "{a JOB} WHO SAYS {SOUND} IN THEIR SLEEP AND WAKES UP EVERY {TIME}",
  },
  {
    id: "mystery-8", pack: "mystery",
    ask: "Why is there glitter everywhere?",
    frame: "THE {TOY} AND THE {WEAR} HAD A PARTY AND {ACTION} TILL MORNING",
  },

  // Chai Time
  {
    id: "chai-1", pack: "chai",
    ask: "What's for chai time today?",
    frame: "{a MOOD} AUNTY, A PLATE OF {FOOD} AND {a TOY}",
  },
  {
    id: "chai-2", pack: "chai",
    ask: "Who came over for chai yesterday?",
    frame: "{a CREATURE} FROM THE {PLACE} WHO DIPPED ITS {WEAR} IN THE CHAI",
  },
  {
    id: "chai-3", pack: "chai",
    ask: "What happened in the monsoon rain?",
    frame: "MY {THING} SAILED TO THE {PLACE} AND CAME BACK SAYING {SOUND}",
  },
  {
    id: "chai-4", pack: "chai",
    ask: "Who won the rangoli contest?",
    frame: "{a JOB} WHO DREW {a CREATURE} USING ONLY {FOOD}",
  },
  {
    id: "chai-5", pack: "chai",
    ask: "Why does the chai taste funny?",
    frame: "{a MOOD} {JOB} STIRRED IT WITH {a THING}",
  },
  {
    id: "chai-6", pack: "chai",
    ask: "What did Chacha bring from the market?",
    frame: "{NUMBER} MANGOES, {a TOY} AND ONE {MOOD} GOAT IN A BASKET",
  },
  {
    id: "chai-7", pack: "chai",
    ask: "When does Dadi make pakoras?",
    frame: "EVERY {TIME}, IN HER BEST {WEAR}, SINGING {SOUND} TO EACH PAKORA",
  },
  {
    id: "chai-8", pack: "chai",
    ask: "What's the big news at the chai stall?",
    frame: "{a JOB} {ACTION} IN FRONT OF THE {PLACE} AND EVERYONE CLAPPED",
  },

  // Kids Table (slots limited to categories with plenty of 3-4 letter words)
  {
    id: "kids-1", pack: "kids",
    ask: "What's hiding under my bed?",
    frame: "{a CREATURE} WITH {a TOY} AND {NUMBER} SOCKS",
  },
  {
    id: "kids-2", pack: "kids",
    ask: "What did I see at the zoo?",
    frame: "{a CREATURE} IN {a WEAR} EATING {FOOD}",
  },
  {
    id: "kids-3", pack: "kids",
    ask: "What is in my lunch box?",
    frame: "{a TOY}, A BOWL OF {FOOD} AND A NOTE THAT SAYS {SOUND}",
  },
  {
    id: "kids-4", pack: "kids",
    ask: "What did my teddy do last night?",
    frame: "IT {ACTION} {NUMBER} TIMES, THEN HOPPED TO THE {PLACE}",
  },
  {
    id: "kids-5", pack: "kids",
    ask: "Why is my puppy so happy?",
    frame: "IT GOT {a TOY} THAT GOES {SOUND} AND {NUMBER} HUGS",
  },
  {
    id: "kids-6", pack: "kids",
    ask: "What is in my backpack?",
    frame: "{a THING} WEARING {a WEAR} AND A VERY SLEEPY {CREATURE}",
  },
  {
    id: "kids-7", pack: "kids",
    ask: "When does my goldfish dance?",
    frame: "EVERY {TIME}, ON TOP OF THE {PLACE}, WEARING {a WEAR}",
  },
  {
    id: "kids-8", pack: "kids",
    ask: "What did I find in the sand?",
    frame: "{a THING} THAT {ACTION} WHEN I SAID {SOUND}",
  },

  // Filmy Nights
  {
    id: "filmy-1", pack: "filmy",
    ask: "What happened in the big rain song?",
    frame: "{a JOB} {ACTION} IN THE RAIN WHILE {a CREATURE} HELD THE UMBRELLA",
  },
  {
    id: "filmy-2", pack: "filmy",
    ask: "How did the hero make a grand entry?",
    frame: "ON {a CREATURE}, IN SLOW MOTION, WEARING {a WEAR} AND SHOUTING {SOUND}",
  },
  {
    id: "filmy-3", pack: "filmy",
    ask: "What did we eat at the interval?",
    frame: "{NUMBER} SAMOSAS, {a FOOD} SANDWICH AND {a MOOD} CUP OF TEA",
  },
  {
    id: "filmy-4", pack: "filmy",
    ask: "Who stole the show in the dance number?",
    frame: "{a CREATURE} WHO {ACTION} ON {a THING} IN THE BACK ROW",
  },
  {
    id: "filmy-5", pack: "filmy",
    ask: "What was the big twist after the interval?",
    frame: "THE {MOOD} {JOB} AND THE {CREATURE} WERE LONG LOST TWINS",
  },
  {
    id: "filmy-6", pack: "filmy",
    ask: "Where did they film the dream song?",
    frame: "IN THE {PLACE}, WITH {NUMBER} DANCERS AND {a TOY} THAT SPARKLED",
  },
  {
    id: "filmy-7", pack: "filmy",
    ask: "Why did the whole cinema cry happy tears?",
    frame: "THE {CREATURE} FOUND ITS LOST {TOY} AND {ACTION} WITH JOY",
  },
  {
    id: "filmy-8", pack: "filmy",
    ask: "What did the funny sidekick do?",
    frame: "{a JOB} WHO SAID {SOUND} AFTER EVERY LINE OF THE {TIME} SHOW",
  },

  // School Days
  {
    id: "school-1", pack: "school",
    ask: "What was in my tiffin today?",
    frame: "{NUMBER} ROTIS, {a FOOD} PICKLE AND A NOTE FROM {a CREATURE}",
  },
  {
    id: "school-2", pack: "school",
    ask: "What happened at morning assembly?",
    frame: "{a JOB} {ACTION} ON STAGE WHILE THE {CREATURE} RANG THE BELL",
  },
  {
    id: "school-3", pack: "school",
    ask: "Why didn't I finish my homework?",
    frame: "{a CREATURE} NIBBLED IT, THEN {ACTION} OFF TO THE {PLACE}",
  },
  {
    id: "school-4", pack: "school",
    ask: "Who won the race on sports day?",
    frame: "{a MOOD} {CREATURE} WEARING {a WEAR} ON ITS HEAD",
  },
  {
    id: "school-5", pack: "school",
    ask: "What did the teacher find in my desk?",
    frame: "{a TOY}, {NUMBER} CRAYONS AND {a MOOD} LITTLE SNAIL",
  },
  {
    id: "school-6", pack: "school",
    ask: "What did we learn in class today?",
    frame: "HOW TO COUNT TO {NUMBER}, SAY {SOUND} AND FOLD {a THING}",
  },
  {
    id: "school-7", pack: "school",
    ask: "Where did we go on the school trip?",
    frame: "TO THE {PLACE} WITH {a JOB} WHO SAID {SOUND} THE WHOLE WAY",
  },
  {
    id: "school-8", pack: "school",
    ask: "Why was the school bell late today?",
    frame: "THE {JOB} WAS HAVING {FOOD} WITH {a CREATURE} AND LOST TRACK OF TIME",
  },

  // Office Party
  {
    id: "party-1", pack: "party",
    ask: "What happened at the team lunch?",
    frame: "{a JOB} ORDERED {NUMBER} PLATES OF {FOOD} AND SHARED THEM ALL",
  },
  {
    id: "party-2", pack: "party",
    ask: "What did I get in the gift swap?",
    frame: "{a THING} WRAPPED IN {a WEAR} WITH {a CREATURE} STICKER ON TOP",
  },
  {
    id: "party-3", pack: "party",
    ask: "What was on the birthday cake?",
    frame: "{NUMBER} CANDLES, {a CREATURE} MADE OF ICING AND THE WORD {SOUND}",
  },
  {
    id: "party-4", pack: "party",
    ask: "Who gave the best speech?",
    frame: "{a MOOD} {JOB} WHO {ACTION} THROUGH THE WHOLE THING",
  },
  {
    id: "party-5", pack: "party",
    ask: "Why was everyone late back from lunch?",
    frame: "{a CREATURE} {ACTION} IN THE LIFT ALL THE WAY TO THE {PLACE}",
  },
  {
    id: "party-6", pack: "party",
    ask: "What did we play at the office party?",
    frame: "PASS THE {TOY} WHILE {a JOB} SANG ABOUT {FOOD}",
  },
  {
    id: "party-7", pack: "party",
    ask: "Who organised the party games?",
    frame: "{a JOB} IN {a WEAR} WHO SHOUTED {SOUND} EVERY FIVE MINUTES",
  },
  {
    id: "party-8", pack: "party",
    ask: "What's the secret of the party playlist?",
    frame: "{NUMBER} SONGS ABOUT {a THING} AND ONE ABOUT {a MOOD} DUCK",
  },
];

// Appended in order after a frame (" " + text) to add one slot each. Two per category.
export const CLAUSES = [
  { id: "cl-1", text: "ALL {TIME} LONG" },
  { id: "cl-2", text: "BEFORE THE {TIME} PARADE" },
  { id: "cl-3", text: "WHILE {a CREATURE} CLAPPED" },
  { id: "cl-4", text: "AS {a CREATURE} TOOK NOTES" },
  { id: "cl-5", text: "AND EVERYTHING SMELLED LIKE {FOOD}" },
  { id: "cl-6", text: "AND THEN WE HAD {FOOD} FOR TEA" },
  { id: "cl-7", text: "KNITTING {a WEAR}" },
  { id: "cl-8", text: "WITH {a WEAR} TWO SIZES TOO BIG" },
  { id: "cl-9", text: "HUMMING ABOUT {a THING}" },
  { id: "cl-10", text: "AND EVERYONE GOT {a THING} AS A PRIZE" },
  { id: "cl-11", text: "AND THEN WE ALL WENT TO THE {PLACE}" },
  { id: "cl-12", text: "JUST OUTSIDE THE {PLACE}" },
  { id: "cl-13", text: "FOLLOWED BY {a MOOD} LITTLE NAP" },
  { id: "cl-14", text: "AND EVERYONE FELT RATHER {MOOD}" },
  { id: "cl-15", text: "AND THEN EVERYONE {ACTION} TOGETHER" },
  { id: "cl-16", text: "WHILE THE KETTLE {ACTION} SOFTLY" },
  { id: "cl-17", text: "AND {NUMBER} DUCKS WATCHED" },
  { id: "cl-18", text: "FOR {NUMBER} WHOLE MINUTES" },
  { id: "cl-19", text: "WHILE {a JOB} TOOK PHOTOS" },
  { id: "cl-20", text: "BUT {a JOB} SAID IT WAS FINE" },
  { id: "cl-21", text: "WHILE RIDING {a TOY}" },
  { id: "cl-22", text: "BALANCING {a TOY} ON THEIR NOSE" },
  { id: "cl-23", text: "AND THE WHOLE STREET WENT {SOUND}" },
  { id: "cl-24", text: "AND SOMEONE WHISPERED {SOUND}" },
];

// Hush's line after the reveal. Pick one whose categories all appear in the sentence and fill
// each {CAT} / {a CAT} with that category's word from the sentence (shown in capitals).
export const REACTIONS = [
  { id: "re-1", text: "{a CREATURE}? On MY {FOOD}?" },
  { id: "re-2", text: "I'll need a bigger {THING}." },
  { id: "re-3", text: "{NUMBER}?! That's a lot of socks." },
  { id: "re-4", text: "Every {TIME}? How tiring." },
  { id: "re-5", text: "I always knew {a JOB} would." },
  { id: "re-6", text: "{SOUND}! I'll be humming that all week." },
  { id: "re-7", text: "The {PLACE}? I've always wanted to visit." },
  { id: "re-8", text: "Next time, take me to the {PLACE} too." },
  { id: "re-9", text: "I'd like {a WEAR} for my birthday, please." },
  { id: "re-10", text: "{FOOD} again? I'll put the kettle on." },
  { id: "re-11", text: "Did anyone else hear {SOUND}? No? Just me?" },
  { id: "re-12", text: "{a TOY}! Can I have a turn?" },
  { id: "re-13", text: "That {CREATURE} still owes me a biscuit." },
  { id: "re-14", text: "Oh dear. {NUMBER} is ever so many." },
  { id: "re-15", text: "I knew the {THING} was up to something." },
  { id: "re-16", text: "{a MOOD} {JOB}? That sounds like my cousin." },
  { id: "re-17", text: "I {ACTION} too, a little. Nobody saw." },
  { id: "re-18", text: "{a CREATURE} who {ACTION}? Now I've seen everything." },
  { id: "re-19", text: "Please ask the {CREATURE} to wipe its feet." },
  { id: "re-20", text: "The {PLACE}! I left my scarf there once." },
  { id: "re-21", text: "Of course it {ACTION}. They always do." },
  { id: "re-22", text: "{SOUND}? My kettle says that every morning." },
  { id: "re-23", text: "{a THING} and {a TOY}? What a busy night." },
  { id: "re-24", text: "The {FOOD} will never be the same." },
  { id: "re-25", text: "So {MOOD}! I could feel it from here." },
  { id: "re-26", text: "{NUMBER}? I counted at least one more." },
  { id: "re-27", text: "Feeling {MOOD} is allowed. Even for ghosts." },
  { id: "re-28", text: "I'll knit the {CREATURE} {a WEAR} to match." },
  { id: "re-29", text: "Every {TIME}? I'll pop it in my diary." },
  { id: "re-30", text: "Not the {TOY}! I was keeping that for later." },
  { id: "re-31", text: "{a CREATURE} in a dance number? Encore!" },
  { id: "re-32", text: "Pass the popcorn. The {JOB} is my favourite." },
  { id: "re-33", text: "{FOOD} in a tiffin? I'd swap you a biscuit." },
  { id: "re-34", text: "Gold star for the {CREATURE}!" },
  { id: "re-35", text: "Save me a slice, and {a THING} too." },
  { id: "re-36", text: "{SOUND}! Best office party ever." },
];
