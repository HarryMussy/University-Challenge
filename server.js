const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Fisher-Yates shuffle
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Route all pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public', 'join.html')));
app.get('/student-lobby', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student-lobby.html')));
app.get('/teacher-lobby', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher-lobby.html')));
app.get('/teacher-game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher-game.html')));
app.get('/student-game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student-game.html')));
app.get('/how-to-play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'how-to-play.html')));
app.get('/results', (req, res) => res.sendFile(path.join(__dirname, 'public', 'results.html')));

// ── Room state store ──────────────────────────────────────────────────────────
const rooms = {};

function getRoom(code) {
  if (!rooms[code]) rooms[code] = {
    hostSocketId: null,
    teams: [],
    gameMode: 'teams',
    scores: {},
    players: {},
    questions: [],
    currentQ: 0,
    gameActive: false,
    buzzed: false,
  };
  return rooms[code];
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // HOST creates room (also called when teacher-game page reconnects)
  socket.on('host-create', ({ room, teams, gameMode, questions }) => {
    const r = getRoom(room);
    r.hostSocketId = socket.id;
    r.teams = teams;
    r.gameMode = gameMode;
    // Only reset questions/scores if the game hasn't started yet
    if (!r.gameActive) {
      r.questions = questions;
      r.scores = {};
      if (gameMode === 'teams') teams.forEach(t => r.scores[t.id] = 0);
    }
    if (!r.players) r.players = {};
    socket.join(room);
    socket.room = room;
    socket.role = 'host';
    console.log(`Host created/re-joined room ${room} (gameActive: ${r.gameActive})`);
    socket.emit('host-room-created', { room });

    // If game is already active (host navigated lobby→game), re-send the
    // current question list so teacher-game.html can initialise properly.
    if (r.gameActive) {
      socket.emit('game-started', {
        gameMode: r.gameMode,
        teams: r.teams,
        scores: r.scores,
        questions: r.questions,
        currentQ: r.currentQ,
      });
    }

    // Re-send current player list to host when they reconnect mid-game
    Object.entries(r.players).forEach(([id, data]) => {
      socket.emit('player-joined', {
        id,
        name: data.name,
        teamId: data.teamId,
        playerCount: Object.keys(r.players).length
      });
    });
  });

  // HOST changes game mode
  socket.on('host-change-mode', ({ room, gameMode }) => {
    const r = rooms[room];
    if (!r || socket.id !== r.hostSocketId) return;
    r.gameMode = gameMode;
    if (gameMode === 'solo') {
      Object.values(r.players).forEach(p => p.teamId = null);
    }
    r.scores = {};
    if (gameMode === 'teams') {
      r.teams.forEach(t => r.scores[t.id] = 0);
    } else {
      Object.values(r.players).forEach(p => r.scores[p.name] = (r.scores[p.name] || 0));
    }
    io.to(room).emit('mode-changed', { gameMode, teams: r.teams, scores: r.scores });
  });

  // STUDENT joins room
  socket.on('student-join', ({ room, name, teamId }) => {
    const r = rooms[room];
    if (!r) {
      socket.emit('join-error', { message: 'Room not found. Check your code.' });
      return;
    }

    // FIX: Only block joining if lobby (pre-game) and host is gone.
    // During an active game, allow rejoins even if hostSocketId is temporarily null
    // (host may be mid-page-navigation).
    if (!r.gameActive && !r.hostSocketId) {
      socket.emit('join-error', { message: 'Host connection lost. Please wait.' });
      return;
    }

    // Remove stale entries for this player name (handles page refreshes / mobile reconnects).
    // Emit player-left for the old socket ID FIRST so the host removes the ghost
    // before seeing the new player-joined, preventing duplicates in the lobby list.
    for (let sid in r.players) {
      if (r.players[sid].name === name) {
        delete r.players[sid];
        if (r.hostSocketId && sid !== socket.id) {
          io.to(r.hostSocketId).emit('player-left', {
            id: sid,
            name,
            playerCount: Object.keys(r.players).length
          });
        }
        break;
      }
    }

    r.players[socket.id] = { name, teamId: teamId || null };
    if (r.gameMode === 'solo') r.scores[name] = r.scores[name] || 0;
    socket.join(room);
    socket.room = room;
    socket.role = 'student';
    socket.playerName = name;
    console.log(`${name} joined room ${room} (gameActive: ${r.gameActive})`);

    socket.emit('room-info', { teams: r.teams, gameMode: r.gameMode });

    if (r.hostSocketId) {
      io.to(r.hostSocketId).emit('player-joined', {
        id: socket.id,
        name,
        teamId: teamId || null,
        playerCount: Object.keys(r.players).length
      });
    }
  });

  // STUDENT selects team
  socket.on('team-select', ({ room, name, teamId }) => {
    const r = rooms[room];
    if (!r) return;
    if (r.players[socket.id]) r.players[socket.id].teamId = teamId;
    if (r.hostSocketId) {
      io.to(r.hostSocketId).emit('player-team-changed', { id: socket.id, name, teamId });
    }
  });

  // HOST starts game
  socket.on('host-start-game', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    r.gameActive = true;
    r.currentQ = 0;
    r.buzzed = false;
    r.questions = shuffle(r.questions);
    io.to(room).emit('game-started', {
      gameMode: r.gameMode,
      teams: r.teams,
      scores: r.scores,
      questions: r.questions,
    });
  });

  // HOST reveals question
  socket.on('host-reveal-question', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    const q = r.questions[r.currentQ];
    if (!q) return;
    // FIX: Reset buzz state when a new question is revealed
    r.buzzed = false;
    socket.to(room).emit('question-revealed', { text: q.text, index: r.currentQ });
  });

  // STUDENT buzzes
  socket.on('buzz', ({ room, name, teamId }) => {
    const r = rooms[room];
    if (!r || !r.gameActive) {
      console.log('[BUZZ FAIL] Room not found or game not active');
      return;
    }
    if (r.buzzed) {
      console.log('[BUZZ FAIL] Someone already buzzed');
      return;
    }
    r.buzzed = true;
    console.log(`[BUZZ SUCCESS] ${name} buzzed in room ${room}`);
    io.to(room).emit('buzzed', { name, teamId, socketId: socket.id });
    io.to(room).emit('question-paused');
  });

  // HOST marks answer
  socket.on('host-mark', ({ room, correct, buzzedName, buzzedTeamId }) => {
    const r = rooms[room];
    if (!r) return;
    const q = r.questions[r.currentQ];
    const pts = correct ? q.points : -1;

    if (r.gameMode === 'teams' && buzzedTeamId) {
      r.scores[buzzedTeamId] = (r.scores[buzzedTeamId] || 0) + pts;
    } else if (buzzedName) {
      r.scores[buzzedName] = (r.scores[buzzedName] || 0) + pts;
    }

    if (!correct) {
      // Re-add question for later; keep buzz locked — teacher must click Next
      r.questions.push(q);
      // Notify everyone of the updated question order
      io.to(room).emit('question-order-updated', { questions: r.questions, currentQ: r.currentQ });
    }

    io.to(room).emit('answer-result', { correct, points: pts, buzzedBy: buzzedName });
    io.to(room).emit('score-update', { scores: r.scores });
  });

  // HOST next question
  socket.on('host-next-question', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    r.currentQ++;
    r.buzzed = false;
    if (r.currentQ >= r.questions.length) {
      r.gameActive = false;
      io.to(room).emit('game-ended', { scores: r.scores });
    } else {
      io.to(room).emit('next-question', { currentQ: r.currentQ });
      io.to(room).emit('buzz-reset');
    }
  });

  // HOST selects specific question
  socket.on('host-select-question', ({ room, index }) => {
    const r = rooms[room];
    if (!r || socket.id !== r.hostSocketId) return;
    r.currentQ = index;
    r.buzzed = false;
    io.to(room).emit('question-selected', { index });
  });

  // HOST resets game for play-again
  socket.on('host-reset-game', ({ room, questions }) => {
    const r = rooms[room];
    if (!r || socket.id !== r.hostSocketId) return;
    r.gameActive = true;
    r.currentQ = 0;
    r.buzzed = false;
    if (questions && questions.length > 0) {
      r.questions = shuffle(questions);
    } else {
      r.questions = shuffle(r.questions);
    }
    r.scores = {};
    if (r.gameMode === 'teams' && r.teams) {
      r.teams.forEach(t => r.scores[t.id] = 0);
    } else {
      Object.keys(r.players || {}).forEach(pid => {
        const p = r.players[pid];
        if (p && p.name) r.scores[p.name] = 0;
      });
    }
    console.log(`[GAME RESET] Room ${room}`);
    io.to(room).emit('game-reset', {
      gameMode: r.gameMode,
      teams: r.teams,
      scores: r.scores,
      questions: r.questions,
    });
  });

  // HOST ends session permanently (Home button on end screen)
  socket.on('host-end-session', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    io.to(room).emit('host-left');
    delete rooms[room];
    console.log(`[SESSION ENDED] Room ${room} closed by host`);
  });

  // HOST kick player
  socket.on('host-kick-player', ({ room, playerId }) => {
    const r = rooms[room];
    if (!r) return;
    const playerData = r.players[playerId];
    const playerName = playerData?.name || 'Unknown';
    // Remove from players
    delete r.players[playerId];
    // Remove from scores so kicked player doesn't appear on leaderboard
    if (r.gameMode === 'solo') {
      delete r.scores[playerName];
    }
    io.to(r.hostSocketId).emit('player-left', {
      id: playerId,
      name: playerName,
      playerCount: Object.keys(r.players).length
    });
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
      playerSocket.emit('kicked');
      playerSocket.disconnect();
    }
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    if (socket.room) {
      const r = rooms[socket.room];
      if (r) {
        if (socket.role === 'host' && socket.id === r.hostSocketId) {
          r.hostSocketId = null;
          console.log(`[HOST DISCONNECT] Host disconnected from room ${socket.room}`);
          // FIX: Don't destroy the room immediately — give the host time to reconnect
          // (they're navigating from teacher-lobby to teacher-game).
          // Only destroy if game is not active after a grace period.
          setTimeout(() => {
            const stillExists = rooms[socket.room];
            if (stillExists && !stillExists.hostSocketId) {
              // Host never reconnected — notify students and clean up
              io.to(socket.room).emit('host-left');
              delete rooms[socket.room];
              console.log(`[ROOM DESTROYED] Room ${socket.room} destroyed after grace period`);
            }
          }, 5000); // 5 second grace period for page navigation
        } else if (socket.role === 'student') {
          delete r.players[socket.id];
          if (r.hostSocketId) {
            io.to(r.hostSocketId).emit('player-left', {
              id: socket.id,
              name: socket.playerName,
              playerCount: Object.keys(r.players).length
            });
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`University Challenge running on port ${PORT}`));