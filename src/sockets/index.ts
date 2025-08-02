import { Server, Socket } from 'socket.io';

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join-room', (roomId: string) => {
      socket.join(roomId);
      socket.to(roomId).emit('user-joined', socket.id);
    });

    socket.on('signal', (data) => {
      // Forward signaling data to other users in the room
      socket.to(data.roomId).emit('signal', {
        from: socket.id,
        signal: data.signal
      });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}