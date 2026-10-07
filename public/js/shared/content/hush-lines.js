// Hush's spoken lines (spec §7.5): 86 gentle flavour lines, at most 12 words each, plus the
// guided first seance script (§5.6). Hush is a polite ghost who drops by for tea, never scary.

export const HUSH_LINES = {
  // A seance (or a session) begins.
  arrive: [
    "Ooh, visitors! I've been saving a question.",
    "Hello, hello! Mind the teacups, I just dusted.",
    "Oh, lovely, company! Shall we spell something together?",
    "Come in, come in. The board is nice and warm.",
    "Hello again, friends. I kept your seats cosy.",
    "Ah, a full table! My favourite kind.",
    "Pull up a chair. I've got a little puzzle.",
    "You're just in time. The kettle is still singing.",
  ],

  // Secret word picking.
  pick: [
    "Pick one in secret. No peeking!",
    "Choose quietly. Your word is our little secret.",
    "Three cards, one choice. Trust your whiskers.",
    "Don't overthink it. The silliest ones are often best.",
    "Keep it to yourself. I'll keep it too.",
    "Tap the one that makes you smile.",
    "Take your time. I'm only a tiny bit curious.",
  ],

  // Before spelling. The first line is used on the first seance of a session only.
  silence: [
    "Shh. No talking. Don't spoil the sentence.",
    "Hands on, voices off. Let the board listen.",
    "Not a peep now. The words are shy.",
    "Shh. Let your fingertips do the chatting.",
  ],

  // The planchette trembles but has not broken away yet.
  stir: [
    "I can feel you...",
    "Ooh, something is wiggling.",
    "Almost... lean together a little more.",
    "The planchette is waking up.",
    "So close! Find the same direction.",
    "I feel a tickle. Who is that?",
    "A little nudge... and another...",
    "Gently now. It wants to go somewhere.",
  ],

  // The hands line up and the planchette slides.
  breakaway: [
    "Wheee!",
    "There it goes!",
    "Together! Oh, that tickles.",
    "Look at it glide!",
    "Ooh, you're all in tune.",
    "Off we go, like a teacup on a tray!",
    "Smooth as butter!",
    "You found each other!",
  ],

  // Resting on the wrong letter. Nothing is lost.
  wobble: [
    "Hmm, not that one.",
    "Ooh, close, but not quite.",
    "That letter is lovely, but not today.",
    "Hm? A little to the side, maybe.",
    "Wrong door, right house.",
    "Oops! Let's try a neighbour.",
    "Not that one, dear. Keep feeling.",
    "Nearly! The right one is hiding nearby.",
  ],

  // Hint ladder, step 3 (Hush blows).
  help: [
    "Let me help a tiny bit.",
    "Here, I'll light the way.",
    "A little puff from me.",
    "Psst. Look over there.",
    "Allow me. Just a gentle breeze.",
    "Don't worry, I'll give it a nudge.",
    "Follow the glow, dears.",
  ],

  // Foresight: the table found a letter before any hint.
  foresight: [
    "The table knew...",
    "You all felt it at once!",
    "Before I even whispered! Clever hands.",
    "Ooh, you saw that coming.",
    "Like you read my mind. Lovely.",
    "Did you peek? No? Wonderful.",
  ],

  // The hidden sentence is revealed.
  reveal: [
    "Now you may speak.",
    "Here it is, all together now...",
    "Let me read what you wrote.",
    "Drumroll, please... I'm humming it.",
    "Ready? I can hardly wait to say it.",
    "One word at a time, ever so slowly...",
  ],

  // Closing the book.
  goodbye: [
    "Same time tomorrow? I'll put the kettle on.",
    "Thank you for visiting. Mind the step!",
    "That was lovely. Come back soon.",
    "Off you go. I'll wash the cups.",
    "Bye for now, little hands. Stay cosy.",
    "I'll save the biscuits for next time.",
  ],

  // Nobody is resting a hand for a while.
  idle: [
    "I'm still here, sipping my tea.",
    "Take your time. I like waiting.",
    "Hum de hum... any hands?",
    "Just me and the biscuits, then. That's fine.",
    "The board is getting sleepy.",
    "Rest a hand whenever you're ready.",
    // Pack flavour (Filmy Nights, School Days, Office Party), fine in any pack.
    "I once danced in the rain, just like in the films.",
    "Interval! Anyone for a samosa? No? More for me.",
    "I always finished my homework. Well, mostly.",
    "Ding, ding! Oh, sorry. Old school bell habit.",
    "I'm saving you a slice of birthday cake.",
    "Gift swap later? I wrapped a little teaspoon.",
  ],

  // Someone sits down at the table.
  join: [
    "A new friend! Pull up a chair.",
    "Oh, welcome! There's room for one more.",
    "Hello, you! Your seat is ready.",
    "More hands, more fun.",
    "Ooh, someone new. Come, sit, sit.",
    "Welcome! I saved you a biscuit.",
  ],
};

// Guided first seance "MORE ___" (spec §5.6). Nani knows MORE; the player picks the second word.
export const TUTORIAL = {
  ask: "What would make my day?",
  options: ["PIE", "HUGS", "NAPS"],
  naniWord: "MORE",
  lines: {
    rest: {
      laptop: "Click the planchette to rest your hand.",
      phone: "Hold the pad to rest your hand.",
    },
    follow1: "Lean where Nani leans.",
    lead: "Your turn. Only you see the glow.",
    pointLaptop: "Point right at your letter.",
    liftPhone: "Lift your thumb to stop.",
    filled: "Hush finished the word.",
    speak: "Now you may speak.",
  },
};
