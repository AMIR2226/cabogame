# Cabo – Multiplayer Card Game

A real-time multiplayer implementation of the card game **Cabo**, built with Node.js, Express, and Socket.IO.

## How to Play

Cabo is a card game where each player starts with 4 face-down cards. The goal is to have the **lowest total hand value** when someone calls "CABO".

### Rules

1. **Setup** – Each player receives 4 cards face-down. At the start, you get 5 seconds to peek at your bottom 2 cards.
2. **On your turn**, you must either:
   - Draw from the **deck** or **discard pile**, then either swap it with a card in your hand or discard it.
   - Call **CABO** (ends the round after every other player takes one more turn).
3. **Special cards** (drawn from deck only):
   - **7 or 8** – Peek at one of your own cards.
   - **9 or 10** – Peek at an opponent's card.
   - **Jack or Queen** – Blind swap any card in your hand with any opponent's card.
4. **Scoring** – At round end, each player's score increases by their hand total. If the CABO caller doesn't have the lowest hand, their score is **doubled** for that round.
5. **Card values** – Ace = 1, 2–10 = face value, Jack = 11, Queen = 12, King = 13. King of Hearts and King of Diamonds = 0. Jokers = −1.

## Getting Started

### Prerequisites

- Node.js 16+
- npm

### Installation

```bash
npm install
```

### Running Locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

For development with auto-reload:

```bash
npm run dev
```

## Project Structure

```
cabo-multiplayer/
├── server/
│   └── index.js        # Express + Socket.IO server, game logic
├── public/
│   ├── index.html      # Game UI
│   ├── css/
│   │   └── style.css   # Styles
│   └── js/
│       └── game.js     # Client-side game logic
├── package.json
└── README.md
```

## Deployment

This project is ready to deploy on [Railway](https://railway.app). The server listens on `process.env.PORT` (defaulting to 3000).

## License

Apache 2.0
