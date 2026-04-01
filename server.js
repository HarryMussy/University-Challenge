const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('.'));

// Socket.io logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data) => {
    const { room, name } = data;
    socket.join(room);
    socket.room = room;
    socket.name = name;
    console.log(`${name} joined room ${room}`);

    // Notify others in the room
    socket.to(room).emit('player-joined', { name });
  });

  socket.on('leave-room', () => {
    if (socket.room) {
      socket.to(socket.room).emit('player-left', { name: socket.name });
      socket.leave(socket.room);
    }
  });

  socket.on('message', (data) => {
    const { room, msg } = data;
    socket.to(room).emit('message', msg);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.room) {
      socket.to(socket.room).emit('player-left', { name: socket.name });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});