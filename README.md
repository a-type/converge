# converge

Create P2P connections in the browser with other clients interested in the same topic.

The goal of this project is to create a simple, minimal, self-hosted baseline for creating P2P connections in the browser with multiple peers at once. Ideally you would find it useful as a core networking component to build your own abstractions around.

## Features

- [x] Connect directly to other peers who are interested in the same topic
- [x] Broadcast messages to all connected peers
- [x] Set presence metadata for yourself and get presence of peers
- [x] Direct message a single peer

## Possible roadmap

- [ ] Send media streams to peers
- [ ] Require a password or other authorization to connect to discovery server
- [ ] Gossip messages between a smaller subset of peers rather than connecting to all of them
- [ ] Shutdown socket connection after bootstrap and discover new peers via gossip of signalling messages
- [ ] Alternative signalling / bootstrapping
- [ ] Bundle STUN/TURN into server portion
- [ ] Multiple data channels to separate different streams and allow for reliable/unreliable delivery, etc
- [ ] Security features like verifying the origin of a message, etc.

## Usage

### Client

```typescript
import { ConvergeClient } from '@a-type/converge-client';

/** Presence is any metadata you want to attach to your client. */
type YourPresenceInfo = {
  name: string;
};

const client = new ConvergeClient({
  server: 'wss://your-server.com',
  topic: 'some-topic-string',
});

client.on('connected', (myId) => {
  console.log(`Connected with id ${myId}`);
});

client.on('peerConnected', (peerId) => {
  console.log(`Peer connected with id ${peerId}`);
});

client.on('peerPresenceChanged', (peerId, presence) => {
  console.log(`Peer ${peerId} presence changed to ${presence}`);
});

client.on('peerDisconnected', (peerId) => {
  console.log(`Peer disconnected with id ${peerId}`);
});

client.on('peerMessage', (peerId, message) => {
  console.log(`Peer message from ${peerId}: ${message}`);
});

/**
 * Send a message to everyone
 */
function sendMessage(message: string) {
  client.broadcast(message);
}

/**
 * Update your presence metadata
 */
function updateMyPresence(presence: YourPresenceInfo) {
  client.updatePresence(presence);
}

/**
 * Get your own presence
 */
client.presence;

/**
 * Get your own ID (may be undefined before 'connected' event)
 */
client.id;

/**
 * Get a list of all connected peer ids
 */
client.peers;

/**
 * Inspecting a single peer's presence
 */
client.getPresence(peerId);

/**
 * Send a direct message to one peer
 */
client.directMessage(peerId, 'message');
```

### Server

```typescript
import { createServer } from 'http';
import { attach } from '@a-type/converge-server';

const server = createServer();
attach(server, {
  cors: {
    origin: '*',
  },
});

server.listen(8080);
```
