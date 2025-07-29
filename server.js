const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const cors = require('cors');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(express.static(path.join(__dirname, 'public')));
const PORT = 5000;

const rooms = {}; // { roomId: { hostId, password, viewers: Set<socketId> } }

io.on('connection', (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on('create-room', ({ roomId, password }) => {
        if (rooms[roomId]) {
            socket.emit('error-message', 'Room already exists.');
            return;
        }

        rooms[roomId] = {
            hostId: socket.id,
            password,
            viewers: new Set()
        };

        socket.join(roomId);
        socket.data.roomId = roomId; // Save room for cleanup
        socket.data.isHost = true;

        socket.emit('room-created');
        console.log(`🟢 Room created: ${roomId} by host ${socket.id}`);
    });

    socket.on('join-room', ({ roomId, password }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error-message', 'Room not found.');
            return;
        }

        if (room.password !== password) {
            socket.emit('error-message', 'Incorrect password.');
            return;
        }

        room.viewers.add(socket.id);
        socket.join(roomId);
        socket.data.roomId = roomId;

        socket.emit('room-joined');
        io.to(room.hostId).emit('viewer-joined', socket.id);
        io.to(room.hostId).emit('update-viewers', Array.from(room.viewers));
    });

    socket.on('offer', ({ targetId, sdp }) => {
        io.to(targetId).emit('offer', { sdp, from: socket.id });
    });

    socket.on('answer', ({ targetId, sdp }) => {
        io.to(targetId).emit('answer', { sdp, from: socket.id });
    });

    socket.on('ice-candidate', ({ targetId, candidate }) => {
        io.to(targetId).emit('ice-candidate', { candidate, from: socket.id });
    });

    socket.on('host-stopped', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            io.to(roomId).emit('host-stopped');
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];

        if (room.hostId === socket.id) {
            // Host left
            io.to(roomId).emit('host-disconnected');
            delete rooms[roomId];
            console.log(`🔴 Host disconnected from room: ${roomId}`);
        } else {
            // Viewer left
            room.viewers.delete(socket.id);
            io.to(room.hostId).emit('update-viewers', Array.from(room.viewers));
            console.log(`👋 Viewer left room: ${roomId}`);
        }
    });
});

// Utility: Get local IP for LAN
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIp();
    console.log(`🚀 Server running at:`);
    console.log(`→ http://localhost:${PORT}`);
    console.log(`→ http://${ip}:${PORT} (LAN)`);
});
