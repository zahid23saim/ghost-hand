# Ghost Hand

A silent co-op party game for phones and laptops. Everyone rests a hand on one shared planchette, and it only moves when enough hands push the same way, so the table has to spell words together without talking. Each player secretly picks a word, and at the end Hush, a small polite ghost, reveals the sentence nobody wrote.

**Play:** https://ghost-hand.due-at-1159.workers.dev (no login, any browser)

Made for the Handshake x OpenAI "Create a Multiplayer Game" challenge. Built with Claude.

## How to play

1. Open the link and press **Try it solo** for a guided one-minute seance with two ghost friends, or **Start a table** and share the 4-letter code or QR code with friends.
2. Hush asks a question. Each player secretly picks one word from three cards.
3. Rest your hand on the planchette. One hand alone can't move it. When the hands line up, it trembles, slides and inks a letter.
4. The player who picked the word leads; everyone else feels for the direction.
5. When every word is spelled, Hush reveals the hidden sentence. Then, and only then: "Now you may speak."

Extras: a daily question everyone gets, 9 question packs, twists (whisper, gust), TV mode (`?tv=1`) for a shared screen, English / Hindi / Hinglish menus, a replay GIF and share card, and installable as an app (PWA).

## How it works

- **Server-authoritative.** One Cloudflare Durable Object per room runs the game state machine and the planchette physics. Clients send only their hand position; the server decides what moves.
- **Same moment on every screen.** Snapshots go out at 15 Hz. Each client syncs its clock to the server and renders the world a little in the past with Hermite interpolation, and fires events (an ink, the reveal) at their server timestamp, so every device sees the letter land together.
- **Fair on slow networks.** A network simulator plays full games with up to 6 players at 300 ms+ latency and jitter to check that every word still gets spelled.
- **No framework.** The client is vanilla ES modules and canvas; the backend is a Cloudflare Worker with hibernatable WebSockets.

```
src/            Worker entry, Room and Stats Durable Objects, game core (room-core.js)
public/         The client: index.html, css/, js/ (render, input, net, audio, Hush), shared/ (physics, protocol, content)
test/           Physics, room-core, server and network-simulation tests
scripts/        Build stamp, OG image and demo-video recorder
```

## Run it locally

Requires Node 20+.

```bash
npm install
npm run dev      # http://127.0.0.1:8787
npm test         # physics, room-core, server and net-sim tests
```

Deploy with `npm run deploy` (needs a Cloudflare account with Durable Objects).
