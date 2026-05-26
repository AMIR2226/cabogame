/* ── Cabo Multiplayer – Client ─────────────────────────────────────────────── */

const socket = io();

// ── State ──────────────────────────────────────────────────────────────────
let myId = null;
let myRoomId = null;
let isHost = false;
let gameState = null;
let pendingSpecialAction = null; // 'peekOwn' | 'peekOther' | 'blindSwap'
let blindSwapMyIndex = null;

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`screen-${name}`).classList.add("active");
}

function showError(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

const SUIT_SYMBOLS = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠", joker: "🃏" };
const RED_SUITS = new Set(["hearts", "diamonds"]);

function cardHTML(card, opts = {}) {
  if (!card || card.rank === "?" || !card.faceUp) {
    return `<div class="card card-back ${opts.selectable ? "selectable" : ""} ${opts.selected ? "selected" : ""}" data-index="${opts.index ?? ""}">
      <div class="card-back-pattern"></div>
    </div>`;
  }
  const color = RED_SUITS.has(card.suit) ? "red" : "black";
  const suit = SUIT_SYMBOLS[card.suit] || card.suit;
  return `<div class="card ${color} ${opts.selectable ? "selectable" : ""} ${opts.selected ? "selected" : ""}" data-index="${opts.index ?? ""}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${suit}</span>
  </div>`;
}

// ── Lobby ──────────────────────────────────────────────────────────────────
$("btn-create").addEventListener("click", () => {
  const name = $("player-name").value.trim();
  if (!name) { showError("lobby-error", "Please enter your name."); return; }
  socket.emit("createRoom", { playerName: name });
});

$("btn-join").addEventListener("click", () => {
  const name = $("player-name").value.trim();
  const code = $("room-code").value.trim().toUpperCase();
  if (!name) { showError("lobby-error", "Please enter your name."); return; }
  if (!code) { showError("lobby-error", "Please enter a room code."); return; }
  socket.emit("joinRoom", { roomId: code, playerName: name });
});

$("room-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-join").click();
});

// ── Waiting Room ───────────────────────────────────────────────────────────
$("btn-start").addEventListener("click", () => {
  socket.emit("startGame");
});

$("btn-play-again").addEventListener("click", () => {
  socket.emit("playAgain");
});

// ── Game Actions ───────────────────────────────────────────────────────────
$("deck-pile").addEventListener("click", () => {
  if (!gameState) return;
  const me = gameState.players.find((p) => p.id === myId);
  if (!me) return;
  if (gameState.players[gameState.currentPlayerIndex].id !== myId) return;
  if (gameState.drawnCard) return;
  socket.emit("drawFromDeck");
});

$("discard-pile").addEventListener("click", () => {
  if (!gameState) return;
  if (gameState.players[gameState.currentPlayerIndex].id !== myId) return;
  if (gameState.drawnCard) return;
  socket.emit("drawFromDiscard");
});

$("btn-discard-drawn").addEventListener("click", () => {
  socket.emit("discardDrawn");
});

$("btn-cabo").addEventListener("click", () => {
  if (!gameState) return;
  if (gameState.players[gameState.currentPlayerIndex].id !== myId) return;
  if (gameState.drawnCard) return;
  if (gameState.caboCalledBy) return;
  socket.emit("callCabo");
});

$("btn-skip-special").addEventListener("click", () => {
  // Skipping a special action just ends the turn
  pendingSpecialAction = null;
  blindSwapMyIndex = null;
  socket.emit("discardDrawn"); // server will handle gracefully via nextTurn
  // Actually we need a dedicated skip — but since special action is server-side,
  // we just emit the action with a no-op. For peekOwn/peekOther we can just
  // call nextTurn by emitting a skip event. We'll handle this via the server
  // accepting the action with index -1 as a skip signal.
  renderSpecialArea();
});

$("btn-close-peek").addEventListener("click", () => {
  $("peek-result-overlay").classList.add("hidden");
});

// ── Render ─────────────────────────────────────────────────────────────────
function renderGame(state) {
  gameState = state;

  // Turn indicator
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isMyTurn = currentPlayer && currentPlayer.id === myId;
  $("turn-indicator").textContent = isMyTurn
    ? "⭐ Your Turn"
    : `${currentPlayer?.name || "?"}'s Turn`;

  // Room code
  $("game-room-code").textContent = state.roomId;

  // Deck
  $("deck-count").textContent = state.deckCount;

  // Discard pile
  const discardEl = $("discard-pile");
  if (state.discardTop) {
    discardEl.innerHTML = cardHTML(state.discardTop).replace('<div class="card', '<div class="card no-hover');
    const color = RED_SUITS.has(state.discardTop.suit) ? "red" : "black";
    discardEl.className = `card ${color}`;
    discardEl.innerHTML = `<span class="card-rank">${state.discardTop.rank}</span><span class="card-suit">${SUIT_SYMBOLS[state.discardTop.suit] || ""}</span>`;
  } else {
    discardEl.className = "card card-back";
    discardEl.innerHTML = "";
  }

  // Opponents
  renderOpponents(state);

  // My hand
  renderMyHand(state);

  // Drawn card
  renderDrawnArea(state);

  // Special action
  renderSpecialArea(state);

  // Cabo button visibility
  const caboBtn = $("btn-cabo");
  if (isMyTurn && !state.drawnCard && !state.caboCalledBy && !state.specialAction) {
    caboBtn.classList.remove("hidden");
  } else {
    caboBtn.classList.add("hidden");
  }

  // Cabo banner
  if (state.caboCalledBy) {
    const caller = state.players.find((p) => p.id === state.caboCalledBy);
    const banner = $("cabo-banner");
    banner.textContent = `${caller?.name || "Someone"} called CABO!`;
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 3000);
  }
}

function renderOpponents(state) {
  const area = $("opponents-area");
  area.innerHTML = "";
  for (const player of state.players) {
    if (player.id === myId) continue;
    const isActive = state.players[state.currentPlayerIndex]?.id === player.id;
    const panel = document.createElement("div");
    panel.className = "opponent-panel";

    const nameEl = document.createElement("div");
    nameEl.className = `opponent-name${isActive ? " active-player" : ""}`;
    nameEl.textContent = `${player.name}${!player.connected ? " (disconnected)" : ""}`;
    panel.appendChild(nameEl);

    const cardsEl = document.createElement("div");
    cardsEl.className = "opponent-cards";

    for (let i = 0; i < player.handCount; i++) {
      const card = player.hand?.[i];
      const selectable =
        pendingSpecialAction === "peekOther" ||
        (pendingSpecialAction === "blindSwap" && blindSwapMyIndex !== null);

      const wrapper = document.createElement("div");
      wrapper.innerHTML = cardHTML(card || { faceUp: false }, {
        selectable,
        index: i,
      });
      const cardEl = wrapper.firstChild;

      if (selectable) {
        cardEl.addEventListener("click", () => {
          if (pendingSpecialAction === "peekOther") {
            socket.emit("peekOtherCard", { targetPlayerId: player.id, handIndex: i });
            pendingSpecialAction = null;
            renderSpecialArea();
          } else if (pendingSpecialAction === "blindSwap" && blindSwapMyIndex !== null) {
            socket.emit("blindSwap", {
              myHandIndex: blindSwapMyIndex,
              targetPlayerId: player.id,
              theirHandIndex: i,
            });
            pendingSpecialAction = null;
            blindSwapMyIndex = null;
            renderSpecialArea();
          }
        });
      }

      cardsEl.appendChild(cardEl);
    }

    panel.appendChild(cardsEl);
    area.appendChild(panel);
  }
}

function renderMyHand(state) {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;

  const handEl = $("my-hand");
  handEl.innerHTML = "";

  const isMyTurn = state.players[state.currentPlayerIndex]?.id === myId;
  const canSwap = isMyTurn && !!state.drawnCard;
  const canPeekOwn = pendingSpecialAction === "peekOwn";
  const canBlindSwapSelf = pendingSpecialAction === "blindSwap" && blindSwapMyIndex === null;

  for (let i = 0; i < me.hand.length; i++) {
    const card = me.hand[i];
    const selectable = canSwap || canPeekOwn || canBlindSwapSelf;
    const selected = pendingSpecialAction === "blindSwap" && blindSwapMyIndex === i;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = cardHTML(card, { selectable, selected, index: i });
    const cardEl = wrapper.firstChild;

    if (canSwap) {
      cardEl.addEventListener("click", () => {
        socket.emit("swapCard", { handIndex: i });
      });
    } else if (canPeekOwn) {
      cardEl.addEventListener("click", () => {
        socket.emit("peekOwnCard", { handIndex: i });
        pendingSpecialAction = null;
        renderSpecialArea();
      });
    } else if (canBlindSwapSelf) {
      cardEl.addEventListener("click", () => {
        blindSwapMyIndex = i;
        renderMyHand(state);
        renderOpponents(state);
        renderSpecialArea(state);
      });
    } else if (pendingSpecialAction === "blindSwap" && blindSwapMyIndex !== null) {
      // Clicking own card again deselects
      if (i === blindSwapMyIndex) {
        cardEl.addEventListener("click", () => {
          blindSwapMyIndex = null;
          renderMyHand(state);
          renderOpponents(state);
        });
      }
    }

    handEl.appendChild(cardEl);
  }
}

function renderDrawnArea(state) {
  const area = $("drawn-area");
  if (state.drawnCard && state.players[state.currentPlayerIndex]?.id === myId) {
    area.classList.remove("hidden");
    const display = $("drawn-card-display");
    const color = RED_SUITS.has(state.drawnCard.suit) ? "red" : "black";
    display.className = `card ${color}`;
    display.innerHTML = `<span class="card-rank">${state.drawnCard.rank}</span><span class="card-suit">${SUIT_SYMBOLS[state.drawnCard.suit] || ""}</span>`;
  } else {
    area.classList.add("hidden");
  }
}

function renderSpecialArea(state) {
  const area = $("special-action-area");
  const msg = $("special-action-msg");

  if (!pendingSpecialAction) {
    area.classList.add("hidden");
    return;
  }

  area.classList.remove("hidden");

  if (pendingSpecialAction === "peekOwn") {
    msg.textContent = "Click one of your own cards to peek at it.";
  } else if (pendingSpecialAction === "peekOther") {
    msg.textContent = "Click an opponent's card to peek at it.";
  } else if (pendingSpecialAction === "blindSwap") {
    if (blindSwapMyIndex === null) {
      msg.textContent = "Click one of your cards to swap…";
    } else {
      msg.textContent = "Now click an opponent's card to swap with.";
    }
  }
}

// ── Socket Events ──────────────────────────────────────────────────────────
socket.on("connect", () => {
  myId = socket.id;
});

socket.on("roomCreated", ({ roomId }) => {
  myRoomId = roomId;
  isHost = true;
  $("display-room-code").textContent = roomId;
  $("btn-start").classList.remove("hidden");
  $("waiting-msg").classList.add("hidden");
  showScreen("waiting");
});

socket.on("roomJoined", ({ roomId }) => {
  myRoomId = roomId;
  isHost = false;
  $("display-room-code").textContent = roomId;
  $("btn-start").classList.add("hidden");
  $("waiting-msg").classList.remove("hidden");
  showScreen("waiting");
});

socket.on("gameState", (state) => {
  if (state.phase === "playing") {
    showScreen("game");
    renderGame(state);
  } else if (state.phase === "ended") {
    // handled by roundEnd
  }
});

socket.on("gameStarted", () => {
  pendingSpecialAction = null;
  blindSwapMyIndex = null;
  showScreen("game");
});

socket.on("peekCards", ({ hand }) => {
  // Show peek overlay
  const overlay = $("peek-overlay");
  const handEl = $("peek-hand");
  handEl.innerHTML = "";

  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    const wrapper = document.createElement("div");
    wrapper.innerHTML = cardHTML({ ...card, faceUp: true }, { index: i });
    handEl.appendChild(wrapper.firstChild);
  }

  overlay.classList.remove("hidden");

  let secs = 5;
  $("peek-countdown").textContent = secs;
  const interval = setInterval(() => {
    secs--;
    $("peek-countdown").textContent = secs;
    if (secs <= 0) {
      clearInterval(interval);
      overlay.classList.add("hidden");
    }
  }, 1000);
});

socket.on("peekResult", ({ card, handIndex, owner }) => {
  const overlay = $("peek-result-overlay");
  const title = $("peek-result-title");
  const cardEl = $("peek-result-card");

  const isOwn = owner === myId;
  title.textContent = isOwn
    ? `Your card at position ${handIndex + 1}`
    : `Opponent's card at position ${handIndex + 1}`;

  const color = RED_SUITS.has(card.suit) ? "red" : "black";
  cardEl.className = `card ${color}`;
  cardEl.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit] || ""}</span>`;

  overlay.classList.remove("hidden");
});

socket.on("caboCalled", ({ playerName }) => {
  const banner = $("cabo-banner");
  banner.textContent = `${playerName} called CABO!`;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 3000);
});

socket.on("roundEnd", ({ scores, caboCalledBy }) => {
  showScreen("end");

  const table = $("round-scores");
  table.innerHTML = "";

  const minScore = Math.min(...scores.map((s) => s.handValue));

  for (const s of scores) {
    const row = document.createElement("div");
    const isWinner = s.handValue === minScore;
    row.className = `score-row${isWinner ? " winner" : ""}`;

    const callerPenalty = s.id === caboCalledBy && s.handValue > minScore;

    row.innerHTML = `
      <span class="score-name">${s.name}${s.id === caboCalledBy ? " 🏳️" : ""}${isWinner ? " 🏆" : ""}</span>
      <span class="score-value">Hand: ${s.handValue}${callerPenalty ? " (×2 penalty)" : ""}</span>
      <span class="score-total">Total: ${s.roundScore}</span>
    `;
    table.appendChild(row);
  }

  if (isHost) {
    $("btn-play-again").classList.remove("hidden");
    $("end-waiting-msg").classList.add("hidden");
  } else {
    $("btn-play-again").classList.add("hidden");
    $("end-waiting-msg").classList.remove("hidden");
  }
});

socket.on("playerJoined", ({ playerName }) => {
  // Waiting room update handled by gameState
});

socket.on("playerLeft", ({ playerName }) => {
  console.log(`${playerName} left the game.`);
});

socket.on("error", ({ message }) => {
  showError("lobby-error", message);
});

// Update waiting room player list from gameState
socket.on("gameState", (state) => {
  // Update waiting room if we're there
  const waitingScreen = $("screen-waiting");
  if (waitingScreen.classList.contains("active")) {
    const list = $("player-list");
    list.innerHTML = "";
    for (const p of state.players) {
      const item = document.createElement("div");
      item.className = "player-list-item";
      item.innerHTML = `<span>${p.name}</span>${p.id === state.players[0]?.id ? '<span class="host-badge">HOST</span>' : ""}`;
      list.appendChild(item);
    }
  }

  if (state.phase === "playing") {
    // Check for pending special action from server
    if (state.specialAction && state.specialAction.playerId === myId) {
      pendingSpecialAction = state.specialAction.type;
    } else if (!state.specialAction) {
      pendingSpecialAction = null;
      blindSwapMyIndex = null;
    }
    showScreen("game");
    renderGame(state);
  }
});
