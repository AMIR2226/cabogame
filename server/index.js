const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "../public")));

// ─── Game State ───────────────────────────────────────────────────────────────

const rooms = {}; // roomId -> room object

function createDeck() {
  const deck = [];
  // Cabo uses a standard 52-card deck + 2 jokers (value 0)
  // Card values: Ace=1, 2-10=face value, Jack=11, Queen=12, King=13
  // Special: King of Hearts & King of Diamonds = 0 (or -1 in some variants)
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = [
    { rank: "A", value: 1 },
    { rank: "2", value: 2 },
    { rank: "3", value: 3 },
    { rank: "4", value: 4 },
    { rank: "5", value: 5 },
    { rank: "6", value: 6 },
    { rank: "7", value: 7 },
    { rank: "8", value: 8 },
    { rank: "9", value: 9 },
    { rank: "10", value: 10 },
    { rank: "J", value: 11 },
    { rank: "Q", value: 12 },
    { rank: "K", value: 13 },
  ];

  for (const suit of suits) {
    for (const r of ranks) {
      let value = r.value;
      // King of Hearts and King of Diamonds are worth 0
      if (r.rank === "K" && (suit === "hearts" || suit === "diamonds")) {
        value = 0;
      }
      deck.push({ rank: r.rank, suit, value });
    }
  }

  // Add 2 jokers (value -1)
  deck.push({ rank: "Joker", suit: "joker", value: -1 });
  deck.push({ rank: "Joker", suit: "joker", value: -1 });

  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function createRoom(roomId, hostId, hostName) {
  return {
    id: roomId,
    host: hostId,
    players: [],
    deck: [],
    discardPile: [],
    currentPlayerIndex: 0,
    phase: "lobby", // lobby | playing | ended
    caboCalledBy: null,
    roundsLeft: 0,
    drawnCard: null,
    drawnFrom: null, // 'deck' | 'discard'
    specialAction: null, // pending special card action
  };
}

function createPlayer(socketId, name) {
  return {
    id: socketId,
    name,
    hand: [],
    score: 0,
    connected: true,
  };
}

function dealCards(room) {
  room.deck = shuffle(createDeck());
  for (const player of room.players) {
    player.hand = [];
    for (let i = 0; i < 4; i++) {
      player.hand.push({ ...room.deck.pop(), faceUp: false });
    }
  }
  // Start discard pile
  room.discardPile = [room.deck.pop()];
}

function getHandValue(hand) {
  return hand.reduce((sum, card) => sum + card.value, 0);
}

function getRoomState(room, forPlayerId) {
  return {
    roomId: room.id,
    phase: room.phase,
    currentPlayerIndex: room.currentPlayerIndex,
    caboCalledBy: room.caboCalledBy,
    discardTop: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    deckCount: room.deck.length,
    drawnCard: room.drawnCard,
    drawnFrom: room.drawnFrom,
    specialAction: room.specialAction,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      handCount: p.hand.length,
      // Only reveal own cards (or all cards when game ends)
      hand:
        room.phase === "ended"
          ? p.hand.map((c) => ({ ...c, faceUp: true }))
          : p.id === forPlayerId
          ? p.hand
          : p.hand.map((c) => ({ ...c, faceUp: false, rank: "?", suit: "?" })),
    })),
  };
}

function broadcastRoomState(room) {
  for (const player of room.players) {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.emit("gameState", getRoomState(room, player.id));
    }
  }
}

function nextTurn(room) {
  room.drawnCard = null;
  room.drawnFrom = null;
  room.specialAction = null;

  if (room.caboCalledBy !== null) {
    room.roundsLeft--;
    if (room.roundsLeft <= 0) {
      endRound(room);
      return;
    }
  }

  // Advance to next connected player
  let attempts = 0;
  do {
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.currentPlayerIndex].connected && attempts < room.players.length);

  broadcastRoomState(room);
}

function endRound(room) {
  room.phase = "ended";

  // Calculate scores
  const scores = room.players.map((p) => ({
    player: p,
    handValue: getHandValue(p.hand),
  }));

  const caboPlayer = room.players.find((p) => p.id === room.caboCalledBy);
  const caboHandValue = caboPlayer ? getHandValue(caboPlayer.hand) : Infinity;
  const minValue = Math.min(...scores.map((s) => s.handValue));

  for (const { player, handValue } of scores) {
    let roundScore = handValue;
    // Cabo caller penalty: if someone else has equal or lower hand, cabo caller gets double
    if (player.id === room.caboCalledBy && handValue > minValue) {
      roundScore = handValue * 2;
    }
    player.score += roundScore;
  }

  broadcastRoomState(room);

  // Emit round results
  io.to(room.id).emit("roundEnd", {
    scores: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      handValue: getHandValue(p.hand),
      roundScore: p.score,
    })),
    caboCalledBy: room.caboCalledBy,
  });
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Create Room ──
  socket.on("createRoom", ({ playerName }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const room = createRoom(roomId, socket.id, playerName);
    const player = createPlayer(socket.id, playerName || "Player 1");
    room.players.push(player);
    rooms[roomId] = room;

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = socket.id;

    socket.emit("roomCreated", { roomId });
    broadcastRoomState(room);
    console.log(`[room] ${roomId} created by ${playerName}`);
  });

  // ── Join Room ──
  socket.on("joinRoom", ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", { message: "Room not found." });
      return;
    }
    if (room.phase !== "lobby") {
      socket.emit("error", { message: "Game already in progress." });
      return;
    }
    if (room.players.length >= 6) {
      socket.emit("error", { message: "Room is full (max 6 players)." });
      return;
    }

    const player = createPlayer(socket.id, playerName || `Player ${room.players.length + 1}`);
    room.players.push(player);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = socket.id;

    socket.emit("roomJoined", { roomId });
    broadcastRoomState(room);
    io.to(roomId).emit("playerJoined", { playerName: player.name });
    console.log(`[room] ${playerName} joined ${roomId}`);
  });

  // ── Start Game ──
  socket.on("startGame", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id) {
      socket.emit("error", { message: "Only the host can start the game." });
      return;
    }
    if (room.players.length < 2) {
      socket.emit("error", { message: "Need at least 2 players to start." });
      return;
    }

    room.phase = "playing";
    room.currentPlayerIndex = 0;
    room.caboCalledBy = null;
    dealCards(room);

    io.to(roomId).emit("gameStarted");

    // Let each player peek at their bottom 2 cards for 5 seconds
    for (const player of room.players) {
      const s = io.sockets.sockets.get(player.id);
      if (s) {
        const peekHand = player.hand.map((card, i) => ({
          ...card,
          faceUp: i >= 2, // reveal cards at index 2 and 3 (bottom two)
        }));
        s.emit("peekCards", { hand: peekHand });
      }
    }

    setTimeout(() => {
      broadcastRoomState(room);
    }, 5000);

    console.log(`[game] started in room ${roomId}`);
  });

  // ── Draw from Deck ──
  socket.on("drawFromDeck", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;
    if (room.drawnCard) return; // already drew

    if (room.deck.length === 0) {
      // Reshuffle discard pile (keep top card)
      const top = room.discardPile.pop();
      room.deck = shuffle(room.discardPile);
      room.discardPile = [top];
    }

    const card = room.deck.pop();
    room.drawnCard = { ...card, faceUp: true };
    room.drawnFrom = "deck";

    broadcastRoomState(room);
  });

  // ── Draw from Discard ──
  socket.on("drawFromDiscard", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;
    if (room.drawnCard) return;
    if (room.discardPile.length === 0) return;

    const card = room.discardPile.pop();
    room.drawnCard = { ...card, faceUp: true };
    room.drawnFrom = "discard";

    broadcastRoomState(room);
  });

  // ── Swap Drawn Card with Hand Card ──
  socket.on("swapCard", ({ handIndex }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;
    if (!room.drawnCard) return;

    const player = room.players[room.currentPlayerIndex];
    if (handIndex < 0 || handIndex >= player.hand.length) return;

    const oldCard = player.hand[handIndex];
    player.hand[handIndex] = { ...room.drawnCard, faceUp: false };
    room.discardPile.push(oldCard);

    // Check for special card abilities (drawn from deck only)
    if (room.drawnFrom === "deck") {
      const drawnValue = room.drawnCard.value;
      if (drawnValue === 7 || drawnValue === 8) {
        room.specialAction = { type: "peekOwn", playerId: socket.id };
      } else if (drawnValue === 9 || drawnValue === 10) {
        room.specialAction = { type: "peekOther", playerId: socket.id };
      } else if (drawnValue === 11 || drawnValue === 12) {
        room.specialAction = { type: "blindSwap", playerId: socket.id };
      }
    }

    room.drawnCard = null;
    room.drawnFrom = null;

    if (room.specialAction) {
      broadcastRoomState(room);
    } else {
      nextTurn(room);
    }
  });

  // ── Discard Drawn Card ──
  socket.on("discardDrawn", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;
    if (!room.drawnCard) return;

    room.discardPile.push(room.drawnCard);
    room.drawnCard = null;
    room.drawnFrom = null;

    nextTurn(room);
  });

  // ── Special Action: Peek Own Card ──
  socket.on("peekOwnCard", ({ handIndex }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.specialAction) return;
    if (room.specialAction.type !== "peekOwn") return;
    if (room.specialAction.playerId !== socket.id) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || handIndex < 0 || handIndex >= player.hand.length) return;

    socket.emit("peekResult", { card: player.hand[handIndex], handIndex, owner: socket.id });
    room.specialAction = null;
    nextTurn(room);
  });

  // ── Special Action: Peek Other Player's Card ──
  socket.on("peekOtherCard", ({ targetPlayerId, handIndex }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.specialAction) return;
    if (room.specialAction.type !== "peekOther") return;
    if (room.specialAction.playerId !== socket.id) return;

    const target = room.players.find((p) => p.id === targetPlayerId);
    if (!target || handIndex < 0 || handIndex >= target.hand.length) return;

    socket.emit("peekResult", { card: target.hand[handIndex], handIndex, owner: targetPlayerId });
    room.specialAction = null;
    nextTurn(room);
  });

  // ── Special Action: Blind Swap ──
  socket.on("blindSwap", ({ myHandIndex, targetPlayerId, theirHandIndex }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.specialAction) return;
    if (room.specialAction.type !== "blindSwap") return;
    if (room.specialAction.playerId !== socket.id) return;

    const myPlayer = room.players.find((p) => p.id === socket.id);
    const target = room.players.find((p) => p.id === targetPlayerId);
    if (!myPlayer || !target) return;
    if (myHandIndex < 0 || myHandIndex >= myPlayer.hand.length) return;
    if (theirHandIndex < 0 || theirHandIndex >= target.hand.length) return;

    const temp = myPlayer.hand[myHandIndex];
    myPlayer.hand[myHandIndex] = target.hand[theirHandIndex];
    target.hand[theirHandIndex] = temp;

    room.specialAction = null;
    nextTurn(room);
  });

  // ── Call Cabo ──
  socket.on("callCabo", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;
    if (room.players[room.currentPlayerIndex].id !== socket.id) return;
    if (room.caboCalledBy) return; // already called

    room.caboCalledBy = socket.id;
    // Each other player gets one more turn
    room.roundsLeft = room.players.filter((p) => p.connected).length - 1;

    const callerName = room.players.find((p) => p.id === socket.id)?.name;
    io.to(roomId).emit("caboCalled", { playerName: callerName });

    if (room.roundsLeft <= 0) {
      endRound(room);
    } else {
      nextTurn(room);
    }
  });

  // ── Play Again ──
  socket.on("playAgain", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id) return;

    room.phase = "playing";
    room.caboCalledBy = null;
    room.roundsLeft = 0;
    room.drawnCard = null;
    room.drawnFrom = null;
    room.specialAction = null;
    room.currentPlayerIndex = 0;
    dealCards(room);

    io.to(roomId).emit("gameStarted");

    for (const player of room.players) {
      const s = io.sockets.sockets.get(player.id);
      if (s) {
        const peekHand = player.hand.map((card, i) => ({
          ...card,
          faceUp: i >= 2,
        }));
        s.emit("peekCards", { hand: peekHand });
      }
    }

    setTimeout(() => {
      broadcastRoomState(room);
    }, 5000);
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.connected = false;
      io.to(roomId).emit("playerLeft", { playerName: player.name });
    }

    // Clean up empty rooms
    if (room.players.every((p) => !p.connected)) {
      delete rooms[roomId];
      console.log(`[room] ${roomId} deleted (all players disconnected)`);
    } else {
      broadcastRoomState(room);
    }

    console.log(`[disconnect] ${socket.id}`);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Cabo server running on port ${PORT}`);
});
