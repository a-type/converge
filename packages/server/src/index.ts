import { Server, ServerOptions, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';

export function attach(server: HTTPServer, options?: Partial<ServerOptions>) {
  const io = new Server(server, options);

  const rooms: Record<string, Socket[]> = {};
  const reverseRoomLookup: Record<string, string> = {};

  io.on('connection', (socket) => {
    socket.on('disconnect', (reason) => {
      console.log('Disconnected', reason);
      const roomId = reverseRoomLookup[socket.id];
      const room = rooms[roomId];
      if (room) {
        room.splice(room.indexOf(socket), 1);
        if (room.length === 0) {
          delete rooms[socket.id];
        } else {
          room.forEach((peer) => {
            peer.emit('peer-disconnected', socket.id);
          });
        }
      }
    });
    socket.on('join', async function ({ room }: { room: string }) {
      console.log('join', room, socket.id);
      // TODO: authorize join
      const peers = rooms[room] || (rooms[room] = []);
      socket.emit(
        'peers',
        peers.map((peer) => peer.id),
      );
      peers.push(socket);
      reverseRoomLookup[socket.id] = room;
    });
    socket.on(
      'offer',
      async function (offerMessage: {
        sdp: string;
        peerId: string;
        sourcePeerId: string;
      }) {
        console.debug('offer', offerMessage);
        // relay the offer to the target peer socket
        io.to(offerMessage.peerId).emit('offer', offerMessage);
      },
    );
    socket.on(
      'answer',
      async function (answerMessage: {
        sdp: string;
        peerId: string;
        sourcePeerId: string;
      }) {
        console.debug('answer', answerMessage);
        // relay the answer to the target peer socket
        io.to(answerMessage.peerId).emit('answer', answerMessage);
      },
    );
    socket.on(
      'candidate',
      async function (candidateMessage: {
        candidate: string;
        peerId: string;
        sourcePeerId: string;
      }) {
        console.debug('candidate', candidateMessage);
        // relay the candidate to the target peer socket
        io.to(candidateMessage.peerId).emit('candidate', candidateMessage);
      },
    );
  });
}
