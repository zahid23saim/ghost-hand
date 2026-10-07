// Tiny stand-in content bank so the room core can be tested before the real one lands.
const W = (list, tone) => list.map((w) => ({ w, tone, an: /^[AEIOU]/.test(w), packs: ["*"], kids: w.length <= 4 }));
const cat = (s, a, sw) => [...W(s, "sensible"), ...W(a, "absurd"), ...W(sw, "sweet")];

export const content = {
  questions: {
    PACKS: [{ id: "cozy", name: "Cozy Kitchen", blurb: "" }, { id: "kids", name: "Kids Table", blurb: "" }],
    QUESTIONS: [
      { id: "cozy-1", pack: "cozy", ask: "What happened in my kitchen last night?", frame: "{a CREATURE} {ACTION} ON THE {FOOD} AND NOBODY SAID A WORD" },
      { id: "cozy-2", pack: "cozy", ask: "Who really runs my office?", frame: "{a MOOD} {CREATURE} WHO ONLY SAYS {SOUND}" },
    ],
    CLAUSES: [{ id: "cl-1", text: "EVERY {TIME}" }, { id: "cl-2", text: "WEARING {a WEAR}" }, { id: "cl-3", text: "WHILE {a CREATURE} CLAPPED" }],
    REACTIONS: ["A {CREATURE}? On MY {FOOD}?", "{SOUND}? How rude."],
  },
  words: {
    WORDS: {
      CREATURE: cat(["CAT", "DOG", "OTTER"], ["WALRUS", "YAK", "EMU"], ["PANDA", "BUNNY", "LAMB"]),
      ACTION: cat(["DANCED", "SANG", "NAPPED"], ["SNEEZED", "WIGGLED", "YODELED"], ["HUGGED", "SMILED", "WAVED"]),
      FOOD: cat(["TOAST", "SOUP", "RICE"], ["PUDDING", "JELLY", "PICKLE"], ["CAKE", "HONEY", "PIE"]),
      MOOD: cat(["CALM", "BUSY", "TIRED"], ["GIDDY", "FANCY", "ZANY"], ["SUNNY", "COSY", "KIND"]),
      SOUND: cat(["HONK", "BEEP", "TICK"], ["BOING", "ZOOP", "BLORP"], ["MEOW", "PURR", "HUM"]),
      TIME: cat(["MONDAY", "NOON", "DAWN"], ["BEDTIME", "TEATIME", "PAYDAY"], ["SUNDAY", "SPRING", "MORNING"]),
      WEAR: cat(["HAT", "SCARF", "SOCK"], ["TUTU", "CAPE", "CROWN"], ["MITTEN", "BOW", "BERET"]),
    },
    PROMPTS: {
      CREATURE: ["an animal you would trust"], ACTION: ["something you would do at a wedding"], FOOD: ["something for a picnic"],
      MOOD: ["how you feel on a Monday"], SOUND: ["a noise in the night"], TIME: ["when you would call a friend"], WEAR: ["something in your suitcase"],
    },
  },
  hush: {
    HUSH_LINES: { reveal: ["Now you may speak."] },
    TUTORIAL: { ask: "What would make my day?", options: ["PIE", "HUGS", "NAPS"], naniWord: "MORE", lines: {} },
  },
  names: {
    SEAT_COLOURS: ["Coral", "Marigold", "Mint", "Cornflower", "Lilac", "Rose"].map((name) => ({ name })),
    CREATURES: ["Otter", "Hare", "Finch", "Panda", "Koala", "Robin", "Puffin"],
    SITTERS: [{ name: "Nani", emblem: "leaf" }, { name: "Bram", emblem: "moon" }],
  },
};
