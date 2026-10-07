// Seat names (spec §7.6, §8.2): seat colour + creature, and the three ghost-friend sitters (§5.1).
// Colour is never the only identifier: every seat also carries its pattern and name.

export const SEAT_COLOURS = [
  { name: "Coral", hex: "#FF7A6B", pattern: "stripes" },
  { name: "Marigold", hex: "#F5B83D", pattern: "dots" },
  { name: "Mint", hex: "#3FBF9F", pattern: "stars" },
  { name: "Cornflower", hex: "#5AA9E6", pattern: "zigzag" },
  { name: "Lilac", hex: "#A98BE8", pattern: "hearts" },
  { name: "Rose", hex: "#F28DB2", pattern: "checks" },
];

// No Owl, no Moth, no bot names. Reroll changes the creature, never the colour.
export const CREATURES = [
  "Otter", "Hare", "Finch", "Panda", "Koala", "Robin",
  "Puffin", "Gecko", "Badger", "Lemur", "Wombat", "Heron",
  "Seal", "Fox", "Duckling", "Llama", "Quokka", "Pangolin",
];

// Ghost friends. Always labelled "ghost friend" in seat lists; never passed off as humans.
export const SITTERS = [
  { name: "Nani", emblem: "leaf" },
  { name: "Bram", emblem: "moon" },
  { name: "Juno", emblem: "feather" },
];
