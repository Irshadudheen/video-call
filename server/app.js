// // server.js - Improved WebRTC signaling server
const express = require('express');
const http = require('http');
const socket = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socket(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const MAX_USERS_PER_ROOM = 3;
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Send the socket ID to the client
  socket.emit('me', socket.id);

  // Handle room joining
  socket.on('join_room', (roomId) => {
    console.log(`User ${socket.id} attempting to join room: ${roomId}`);
    
    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [] };
      console.log(`Room ${roomId} created`);
    }
    
    // Check if room is full
    if (rooms[roomId].users.length >= MAX_USERS_PER_ROOM) {
      console.log(`Room ${roomId} is full`);
      socket.emit('room_full');
      return;
    }
    
    // Check if user is already in the room
    if (rooms[roomId].users.includes(socket.id)) {
      console.log(`User ${socket.id} is already in room ${roomId}`);
      return;
    }
    
    // Join the room
    socket.join(roomId);
    rooms[roomId].users.push(socket.id);
    socket.roomId = roomId;
    
    console.log(`User ${socket.id} joined room ${roomId}`);
    console.log(`Room ${roomId} users: ${rooms[roomId].users}`);
    
    // Notify users in the room
    const usersInRoom = rooms[roomId].users.filter(id => id !== socket.id);
    
    // Send users list to all clients in the room
    io.to(roomId).emit('users_in_room', rooms[roomId].users);

     // Send system message about new user
     socket.to(roomId).emit('chat_message', {
      from: 'system',
      message: `User ${socket.id.substring(0, 5)} joined the room`
    });
    
    // Send recent messages to the new user
    if (rooms[roomId].messages && rooms[roomId].messages.length > 0) {
      socket.emit('chat_history', rooms[roomId].messages);
    }
    
    // Request offers from existing users
    usersInRoom.forEach(userId => {
      console.log(`Requesting offer from ${userId} to ${socket.id}`);
      io.to(userId).emit('offer_request', { from: socket.id });
    });
  });

  // Handle WebRTC signaling
  
  // Handle offer sending
  socket.on('offer', ({ to, offer }) => {
    console.log(`Forwarding offer from ${socket.id} to ${to}`);
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  // Handle answer sending
  socket.on('answer', ({ to, answer }) => {
    console.log(`Forwarding answer from ${socket.id} to ${to}`);
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  // Handle ICE candidate
  socket.on('ice_candidate', ({ to, candidate }) => {
    io.to(to).emit('ice_candidate', { from: socket.id, candidate });
  });
// Handle chat messages
socket.on('chat_message', ({ roomId, message }) => {
  if (!roomId || !rooms[roomId]) return;

  console.log(`Chat message from ${socket.id} in room ${roomId}: ${message}`);
  
  // Format message for storage
  const formattedMessage = {
    from: socket.id,
    message: message,
    time: new Date().toISOString()
  };
  
  // Store message (limit to last 50 messages)
  if (!rooms[roomId].messages) {
    rooms[roomId].messages = [];
  }
  
  rooms[roomId].messages.push(formattedMessage);
  if (rooms[roomId].messages.length > 50) {
    rooms[roomId].messages.shift();
  }
  
  // Broadcast message to all users in the room except sender
  socket.to(roomId).emit('chat_message', {
    from: socket.id,
    message: message
  });
});
  // Handle room leaving
  socket.on('leave_room', () => {
    console.log(`User ${socket.id} leaving room`);
    leaveRoom(socket);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    leaveRoom(socket);
  });
});

// Helper function to handle user leaving a room
function leaveRoom(socket) {
  const roomId = socket.roomId;
  
  if (roomId && rooms[roomId]) {
    console.log(`Removing user ${socket.id} from room ${roomId}`);
    
    // Remove user from room
    rooms[roomId].users = rooms[roomId].users.filter(id => id !== socket.id);
    io.to(roomId).emit('chat_message', {
      from: 'system',
      message: `User ${socket.id.substring(0, 5)} left the room`
    });
    // Notify other users
    io.to(roomId).emit('user_left', socket.id);
    
    // Update user list
    io.to(roomId).emit('users_in_room', rooms[roomId].users);
    
    console.log(`Room ${roomId} users after leave: ${rooms[roomId].users}`);
    
    // Remove room if empty
    if (rooms[roomId].users.length === 0) {
      console.log(`Removing empty room ${roomId}`);
      delete rooms[roomId];
    }
    
    // Leave socket room
    socket.leave(roomId);
    socket.roomId = null;
  }
}

// Handle server shutdown gracefully
process.on('SIGINT', () => {
  console.log('Server shutting down');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`WebRTC Signaling Server running on port ${PORT}`));

// Add a route to check server status
app.get('/', (req, res) => {
  res.send('WebRTC Signaling Server is running');
});

// Add a route to check room status (for debugging)
app.get('/rooms', (req, res) => {
  const roomInfo = {};
  Object.keys(rooms).forEach(roomId => {
    roomInfo[roomId] = {
      users: rooms[roomId].users,
      count: rooms[roomId].users.length
    };
  });
  res.json({
    rooms: roomInfo,
    totalRooms: Object.keys(rooms).length
  });
});
