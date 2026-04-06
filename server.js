const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

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
app.get('/results', (req, res) => res.sendFile(path.join(__dirname, 'public', 'results.html')));

// ── Room state store ──────────────────────────────────────────────────────────
const rooms = {}; // { [code]: { hostSocket, teams, gameMode, scores, players, questions, currentQ, gameActive } }

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
  };
  return rooms[code];
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // HOST creates room
  socket.on('host-create', ({ room, teams, gameMode, questions }) => {
    const r = getRoom(room);
    r.hostSocketId = socket.id;
    r.teams = teams;
    r.gameMode = gameMode;
    r.questions = questions;
    r.scores = {};
    r.players = {};
    if (gameMode === 'teams') teams.forEach(t => r.scores[t.id] = 0);
    socket.join(room);
    socket.room = room;
    socket.role = 'host';
    console.log(`Host created room ${room}`);
    socket.emit('host-room-created', { room });
  });

  // STUDENT joins room
  socket.on('student-join', ({ room, name, teamId }) => {
    const r = rooms[room];
    if (!r || !r.hostSocketId) {
      socket.emit('join-error', { message: 'Room not found. Check your code.' });
      return;
    }
    // Remove any existing player with the same name
    for (let sid in r.players) {
      if (r.players[sid].name === name) {
        delete r.players[sid];
        break;
      }
    }
    r.players[socket.id] = { name, teamId: teamId || null };
    if (r.gameMode === 'solo') r.scores[name] = r.scores[name] || 0;
    socket.join(room);
    socket.room = room;
    socket.role = 'student';
    socket.playerName = name;
    console.log(`${name} joined room ${room}`);

    // Tell the student the room config
    socket.emit('room-info', { teams: r.teams, gameMode: r.gameMode });

    // Tell host a new player joined
    io.to(r.hostSocketId).emit('player-joined', {
      id: socket.id,
      name,
      teamId: teamId || null,
      playerCount: Object.keys(r.players).length
    });
  });

  // STUDENT selects team
  socket.on('team-select', ({ room, name, teamId }) => {
    const r = rooms[room];
    if (!r) return;
    if (r.players[socket.id]) r.players[socket.id].teamId = teamId;
    io.to(r.hostSocketId).emit('player-team-changed', { id: socket.id, name, teamId });
  });

  // HOST starts game
  socket.on('host-start-game', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    r.gameActive = true;
    r.currentQ = 0;
    io.to(room).emit('game-started', {
      gameMode: r.gameMode,
      teams: r.teams,
      scores: r.scores,
    });
  });

  // HOST reveals question
  socket.on('host-reveal-question', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    const q = r.questions[r.currentQ];
    socket.to(room).emit('question-revealed', { text: q.text, index: r.currentQ });
  });

  // STUDENT buzzes
  socket.on('buzz', ({ room, name, teamId }) => {
    const r = rooms[room];
    if (!r || !r.gameActive) return;
    // Only first buzz counts; host tracks this but we broadcast to all
    io.to(room).emit('buzzed', { name, teamId, socketId: socket.id });
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
    io.to(room).emit('answer-result', { correct, points: pts, buzzedBy: buzzedName });
    io.to(room).emit('score-update', { scores: r.scores });
  });

  // HOST next question
  socket.on('host-next-question', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    r.currentQ++;
    if (r.currentQ >= r.questions.length) {
      r.gameActive = false;
      io.to(room).emit('game-ended', { scores: r.scores });
    } else {
      io.to(room).emit('buzz-reset');
    }
  });

  // HOST reveals answer (just to room for display)
  socket.on('host-reveal-answer', ({ room }) => {
    const r = rooms[room];
    if (!r) return;
    const q = r.questions[r.currentQ];
    // Only host needs answer locally; no broadcast needed unless you want students to see it
  });

  // HOST kick player
  socket.on('host-kick-player', ({ room, playerId }) => {
    const r = rooms[room];
    if (!r) return;
    const playerName = r.players[playerId]?.name || 'Unknown';
    delete r.players[playerId];
    // Emit to host
    io.to(r.hostSocketId).emit('player-left', {
      id: playerId,
      name: playerName,
      playerCount: Object.keys(r.players).length
    });
    // Emit to the kicked player
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
        if (socket.role === 'host') {
          io.to(socket.room).emit('host-disconnected');
          delete rooms[socket.room];
        } else {
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
