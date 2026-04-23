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
app.get('/teacher-display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher-display.html')));
app.get('/student-game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student-game.html')));
app.get('/how-to-play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'how-to-play.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
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
    displaySockets: new Set(), // passive display observers
    // Game settings
    settings: {
      showAnswerOnCorrect: true,
      showAnswerOnIncorrect: false,
      deductPointsOnIncorrect: false,
      reaskIncorrectQuestions: true,
    },
    // Track which questions were answered incorrectly for re-asking
    incorrectlyAnswered: new Set(),
  };
  return rooms[code];
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // HOST creates room (also called when teacher-game page reconnects)
  socket.on('host-create', ({ room, teams, gameMode, questions, settings }) => {
    const r = getRoom(room);
    r.hostSocketId = socket.id;
    r.teams = teams;
    r.gameMode = gameMode;
    if (settings) r.settings = { ...r.settings, ...settings };
    // Only reset questions/scores if the game hasn't started yet
    if (!r.gameActive) {
      r.questions = questions;
      r.scores = {};
      if (gameMode === 'teams') teams.forEach(t => r.scores[t.id] = 0);
      r.incorrectlyAnswered = new Set(); // Reset incorrectly answered tracking
    }
    if (!r.players) r.players = {};
    if (!r.displaySockets) r.displaySockets = new Set();
    socket.join(room);
    socket.room = room;
    socket.role = 'host';
    console.log(`Host created/re-joined room ${room} (gameActive: ${r.gameActive})`);
    socket.emit('host-room-created', { room, settings: r.settings });

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

  // DISPLAY joins as passive observer (teacher-display.html)
  socket.on('display-join', ({ room }) => {
    const r = rooms[room];
    if (!r) {
      socket.emit('join-error', { message: 'Room not found.' });
      return;
    }
    if (!r.displaySockets) r.displaySockets = new Set();
    r.displaySockets.add(socket.id);
    socket.join(room);
    socket.room  = room;
    socket.role  = 'display';
    console.log(`[DISPLAY] joined room ${room}`);
    // Send current state so display can initialise
    socket.emit('display-joined', {
      teams:    r.teams,
      scores:   r.scores,
      gameMode: r.gameMode,
      gameActive: r.gameActive,
      currentQ: r.currentQ,
    });
    // If game already started, tell the display
    if (r.gameActive) {
      socket.emit('game-started', {
        gameMode:  r.gameMode,
        teams:     r.teams,
        scores:    r.scores,
        questions: [], // display doesn't need question text ahead of time
        currentQ:  r.currentQ,
      });
    }
  });

  // HOST updates teams (e.g., changes team names or count after room creation)
  socket.on('host-update-teams', ({ room, teams, gameMode, settings }) => {
    const r = rooms[room];
    if (!r || socket.id !== r.hostSocketId) return;
    r.teams = teams;
    r.gameMode = gameMode;
    if (settings) r.settings = { ...r.settings, ...settings };
    // Broadcast to all students in the room
    io.to(room).emit('room-info', { teams: r.teams, gameMode: r.gameMode, settings: r.settings });
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

    if (!r.gameActive && !r.hostSocketId) {
      socket.emit('join-error', { message: 'Host connection lost. Please wait.' });
      return;
    }

    // Remove stale entries for this player name
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

    socket.emit('room-info', { teams: r.teams, gameMode: r.gameMode, settings: r.settings });

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
    r.buzzed = false;
    // Send full text to students and display
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
    
    // Determine points based on settings
    let pts = 0;
    if (correct) {
      pts = q.points;
      // Mark this question as correctly answered (remove from incorrectly answered set)
      r.incorrectlyAnswered.delete(r.currentQ);
    } else {
      pts = r.settings.deductPointsOnIncorrect ? -1 : 0;
      // Mark this question as incorrectly answered
      r.incorrectlyAnswered.add(r.currentQ);
    }

    if (r.gameMode === 'teams' && buzzedTeamId) {
      r.scores[buzzedTeamId] = (r.scores[buzzedTeamId] || 0) + pts;
    } else if (buzzedName) {
      r.scores[buzzedName] = (r.scores[buzzedName] || 0) + pts;
    }

    // Re-queue question if answered incorrectly AND the setting is enabled
    if (!correct && r.settings.reaskIncorrectQuestions) {
      r.questions.push(q);
      io.to(room).emit('question-order-updated', { questions: r.questions, currentQ: r.currentQ });
    }

    // Determine which answer text to show based on settings
    let answerText = null;
    if (correct && r.settings.showAnswerOnCorrect) {
      answerText = q.answer;
    } else if (!correct && r.settings.showAnswerOnIncorrect) {
      answerText = q.answer;
    }

    io.to(room).emit('answer-result', { correct, points: pts, buzzedBy: buzzedName, answerText });
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
    delete r.players[playerId];
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
        if (socket.role === 'display') {
          // Just remove from display set — no impact on game
          if (r.displaySockets) r.displaySockets.delete(socket.id);
        } else if (socket.role === 'host' && socket.id === r.hostSocketId) {
          r.hostSocketId = null;
          console.log(`[HOST DISCONNECT] Host disconnected from room ${socket.room}`);
          setTimeout(() => {
            const stillExists = rooms[socket.room];
            if (stillExists && !stillExists.hostSocketId) {
              io.to(socket.room).emit('host-left');
              delete rooms[socket.room];
              console.log(`[ROOM DESTROYED] Room ${socket.room} destroyed after grace period`);
            }
          }, 5000);
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
server.listen(PORT, () => console.log(`UniMinds Arena running on port ${PORT}`));