// ── Config ────────────────────────────────────────────────────
const WSS_URL = 'wss://l67yfgkb1j.execute-api.us-east-1.amazonaws.com/prod';
const SLUG    = 'reflex-duel';

// ── State ─────────────────────────────────────────────────────
let ws           = null;
let playerRole   = null;   // 'host' | 'guest'
let playerName   = '';
let opponentName = '';
let currentRoomCode = null;

// Game state
let hostWins       = 0;
let guestWins      = 0;
let currentRound   = 1;
let bestReactionMs = Infinity;
let circleVisible  = false;
let circleShowAt   = null;
let circleX        = 0;
let circleY        = 0;
let roundActive    = false;  // true = circle is on screen, awaiting tap
let myTapped       = false;
let roundOver      = false;
let roundScheduleTimer = null;

// ── Utils ─────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function show(screenId) {
  ['screen-landing', 'screen-waiting', 'screen-game', 'screen-result']
    .forEach(id => {
      document.getElementById(id).style.display = (id === screenId) ? '' : 'none';
    });
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = '';
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── WebSocket ─────────────────────────────────────────────────
function openWS(onOpen) {
  ws = new WebSocket(WSS_URL);
  ws.onopen    = onOpen;
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose   = () => {
    if (document.getElementById('screen-game').style.display   !== 'none' ||
        document.getElementById('screen-waiting').style.display !== 'none') {
      show('screen-result');
      document.getElementById('result-headline').textContent = 'CONNECTION LOST';
      document.getElementById('result-detail').textContent = 'your opponent vanished into the void.\nthat means you win by default, probably.';
    }
  };
}

// ── Actions ───────────────────────────────────────────────────
function createRoom() {
  playerName = document.getElementById('player-name').value.trim();
  if (!playerName) { showError("can't fight without a name, champ"); return; }

  const roomCode  = generateRoomCode();
  currentRoomCode = roomCode;
  playerRole      = 'host';

  openWS(() => {
    send({ action: 'create_room', slug: SLUG, playerName, roomCode });
  });
}

function joinRoom() {
  playerName = document.getElementById('player-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!playerName) { showError("can't fight without a name, champ"); return; }
  if (code.length !== 6) { showError("that code looks wrong — 6 characters, all caps"); return; }

  currentRoomCode = code;
  playerRole      = 'guest';

  openWS(() => {
    send({ action: 'join_room', roomCode: code, playerName });
  });
}

// ── Message handler ───────────────────────────────────────────
function handleMessage(msg) {
  if (msg.type === 'room_created') {
    document.getElementById('room-code-display').textContent = msg.roomCode;
    show('screen-waiting');

  } else if (msg.type === 'player_joined') {
    opponentName = msg.guestName;
    show('screen-game');
    initGameUI();
    if (playerRole === 'host') {
      scheduleNextRound();
    }

  } else if (msg.type === 'joined_room') {
    opponentName = msg.hostName;
    currentRoomCode = msg.roomCode;
    show('screen-game');
    initGameUI();

  } else if (msg.type === 'game_update') {
    applyUpdate(msg.state);

  } else if (msg.type === 'opponent_disconnected') {
    show('screen-result');
    document.getElementById('result-headline').textContent = 'OPPONENT LEFT';
    document.getElementById('result-detail').textContent = 'they rage-quit. respect the cowardice.\nyou win by forfeit.';

  } else if (msg.type === 'error') {
    const errorCopy = {
      room_not_found: "arena not found — double-check that code",
      room_full:      'that arena is full — ask them to start a fresh one'
    };
    showError(errorCopy[msg.message] || 'something went wrong in the arena');
  }
}

// ── Game initialization ───────────────────────────────────────
function initGameUI() {
  // Set names
  document.getElementById('host-name-display').textContent =
    playerRole === 'host' ? playerName.toUpperCase() : opponentName.toUpperCase();
  document.getElementById('guest-name-display').textContent =
    playerRole === 'guest' ? playerName.toUpperCase() : opponentName.toUpperCase();

  updateScoreboard();
  setArenaMessage('get ready...');
  hideCircle();
  hideRoundResult();

  // Arena tap detection (for when circle is active)
  document.getElementById('arena').addEventListener('click', onArenaTap);
  document.getElementById('arena').addEventListener('touchstart', onArenaTap, { passive: true });
}

function updateScoreboard() {
  document.getElementById('host-wins').textContent  = hostWins;
  document.getElementById('guest-wins').textContent = guestWins;
}

function setArenaMessage(text, active) {
  const el = document.getElementById('arena-message');
  el.textContent = text;
  el.className = 'arena-message' + (active ? ' active' : '');
  el.style.display = '';
}

function hideArenaMessage() {
  document.getElementById('arena-message').style.display = 'none';
}

function showCircle(x, y) {
  const arena  = document.getElementById('arena');
  const circle = document.getElementById('target-circle');
  const rect   = arena.getBoundingClientRect();

  const px = x * rect.width;
  const py = y * rect.height;

  // Keep circle within bounds (50px margin from edge)
  const margin = 60;
  const clampedX = Math.min(Math.max(px, margin), rect.width  - margin);
  const clampedY = Math.min(Math.max(py, margin), rect.height - margin);

  circle.style.left    = clampedX + 'px';
  circle.style.top     = clampedY + 'px';
  circle.style.display = '';
  circle.className     = 'target-circle';
  circleVisible        = true;
}

function hideCircle() {
  document.getElementById('target-circle').style.display = 'none';
  circleVisible = false;
}

function hideRoundResult() {
  document.getElementById('round-result').style.display = 'none';
}

function showRoundResult(headline, reactionText) {
  document.getElementById('round-result-text').textContent   = headline;
  document.getElementById('reaction-time-display').textContent = reactionText;
  document.getElementById('next-round-btn').disabled         = false;
  document.getElementById('next-round-btn').textContent      = 'Next Round';
  document.getElementById('round-result').style.display      = '';
}

// ── Host: schedule the next round ────────────────────────────
function scheduleNextRound() {
  if (roundScheduleTimer) clearTimeout(roundScheduleTimer);

  roundOver = false;
  myTapped  = false;
  setArenaMessage('FOCUS...', true);
  hideCircle();

  const delay = 1500 + Math.random() * 2500; // 1.5–4s
  const cx    = 0.15 + Math.random() * 0.70;  // 15%–85%
  const cy    = 0.15 + Math.random() * 0.70;

  const showAt = Date.now() + delay;
  circleX    = cx;
  circleY    = cy;
  circleShowAt = showAt;

  // Send round_start to both players
  send({
    action: 'game_update',
    roomCode: currentRoomCode,
    state: {
      type: 'round_start',
      circleX: cx,
      circleY: cy,
      showAt
    }
  });

  // Also apply locally (host doesn't receive its own relay)
  applyRoundStart(cx, cy, showAt);
}

// ── Apply incoming state updates ──────────────────────────────
function applyUpdate(state) {
  if (!state || !state.type) return;

  if (state.type === 'round_start') {
    applyRoundStart(state.circleX, state.circleY, state.showAt);

  } else if (state.type === 'round_tap') {
    applyRoundTap(state.tappedBy, state.reactionMs);

  } else if (state.type === 'round_next') {
    // Host signals next round starting
    if (playerRole === 'host') {
      scheduleNextRound();
    }

  } else if (state.type === 'game_over') {
    applyGameOver(state);
  }
}

function applyRoundStart(cx, cy, showAt) {
  circleX      = cx;
  circleY      = cy;
  circleShowAt = showAt;
  roundActive  = false;
  roundOver    = false;
  myTapped     = false;

  hideCircle();
  hideRoundResult();
  setArenaMessage('FOCUS...', true);

  const now = Date.now();
  const wait = Math.max(0, showAt - now);

  if (roundScheduleTimer) clearTimeout(roundScheduleTimer);
  roundScheduleTimer = setTimeout(() => {
    roundActive = true;
    showCircle(circleX, circleY);
    hideArenaMessage();
  }, wait);
}

// ── Player taps the arena ─────────────────────────────────────
function onArenaTap(e) {
  // Only register taps on the target circle
  if (!roundActive || roundOver || myTapped) return;

  const circle = document.getElementById('target-circle');
  const target = e.target || e.srcElement;

  if (target !== circle) return;

  // Prevent double-fire from both click and touchstart
  if (e.type === 'touchstart') e.stopPropagation();

  myTapped = true;
  const now = Date.now();
  const reactionMs = Math.max(0, now - circleShowAt);

  send({
    action: 'game_update',
    roomCode: currentRoomCode,
    state: {
      type: 'round_tap',
      tappedBy: playerRole,
      reactionMs
    }
  });

  // Apply locally immediately — I'm the winner of this tap
  applyRoundTap(playerRole, reactionMs);
}

function applyRoundTap(winnerRole, reactionMs) {
  if (roundOver) return;  // Guard: only process first tap
  roundOver   = true;
  roundActive = false;

  if (roundScheduleTimer) clearTimeout(roundScheduleTimer);

  const iWon = (winnerRole === playerRole);

  // Update circle
  const circle = document.getElementById('target-circle');
  circle.className = 'target-circle ' + (iWon ? 'hit' : 'missed');

  if (iWon) {
    if (winnerRole === 'host') hostWins++;
    else guestWins++;
  } else {
    if (winnerRole === 'host') hostWins++;
    else guestWins++;
  }

  // Track best reaction
  if (iWon && reactionMs < bestReactionMs) {
    bestReactionMs = reactionMs;
  }

  updateScoreboard();

  const winnerLabel = (winnerRole === playerRole)
    ? playerName.toUpperCase()
    : opponentName.toUpperCase();

  const headline = iWon ? `YOU WIN THE ROUND` : `${winnerLabel} WINS`;
  const reactionText = iWon
    ? `your reaction: ${reactionMs}ms${reactionMs < 200 ? ' ⚡' : ''}`
    : `their reaction: ${reactionMs}ms`;

  // Check game over
  const maxWins = 4;
  if (hostWins >= maxWins || guestWins >= maxWins) {
    setTimeout(() => endGame(), 800);
    showRoundResult(headline, reactionText);
    document.getElementById('next-round-btn').style.display = 'none';
  } else {
    showRoundResult(headline, reactionText);
    currentRound++;

    // Auto-advance after 1.5s
    setTimeout(() => {
      if (!roundOver || currentRound > 7) return;
      if (playerRole === 'host') {
        scheduleNextRound();
        // Notify guest
        send({
          action: 'game_update',
          roomCode: currentRoomCode,
          state: { type: 'round_next' }
        });
      }
    }, 1500);
  }
}

function readyNextRound() {
  if (playerRole === 'host') {
    scheduleNextRound();
    send({
      action: 'game_update',
      roomCode: currentRoomCode,
      state: { type: 'round_next' }
    });
  }
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('next-round-btn').textContent = 'waiting...';
}

// ── Game over ─────────────────────────────────────────────────
function endGame() {
  const iWon = (playerRole === 'host' && hostWins > guestWins) ||
               (playerRole === 'guest' && guestWins > hostWins);

  const myWins  = playerRole === 'host' ? hostWins : guestWins;
  const oppWins = playerRole === 'host' ? guestWins : hostWins;

  show('screen-result');

  if (iWon) {
    document.getElementById('result-headline').textContent = 'YOU WIN';
    document.getElementById('result-detail').textContent =
      `${myWins} – ${oppWins} against ${opponentName}\nbest reaction: ${bestReactionMs === Infinity ? '—' : bestReactionMs + 'ms'}`;
  } else {
    document.getElementById('result-headline').textContent = `${opponentName.toUpperCase()} WINS`;
    document.getElementById('result-detail').textContent =
      `${oppWins} – ${myWins} — you got outreflexed.\nbest reaction: ${bestReactionMs === Infinity ? '—' : bestReactionMs + 'ms'}`;
  }

  // Superhuman badge
  if (bestReactionMs < 200) {
    document.getElementById('result-badge').style.display = '';
  }
}

// ── Share ─────────────────────────────────────────────────────
function shareChallenge() {
  const myWins  = playerRole === 'host' ? hostWins : guestWins;
  const oppWins = playerRole === 'host' ? guestWins : hostWins;
  const bestStr = bestReactionMs < Infinity ? `${bestReactionMs}ms` : '—';
  const badge   = bestReactionMs < 200 ? ' ⚡ Superhuman Reflex' : '';

  const text = `I beat ${opponentName} ${myWins}–${oppWins} in Reflex Duel with a best reaction of ${bestStr}${badge} — can you dethrone me? ${location.href}`;

  if (navigator.share) {
    navigator.share({ title: 'Reflex Duel', text, url: location.href });
  } else {
    navigator.clipboard.writeText(text).then(() => alert('Challenge copied! Send it to a friend.'));
  }
}

function share() {
  shareChallenge();
}
