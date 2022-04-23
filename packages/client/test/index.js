import { ConvergeClient } from '../dist';

const client = new ConvergeClient({
  server: 'ws://localhost:2000',
  topic: 'test'
});
client.on('connected', (id) => {
  client.updatePresence({ name: `User ${id}` });
  document.getElementById('identity').innerText = `I am ${client.presence.name}`
});

const peers = document.getElementById('peers');
client.on('peerConnected', (peerId) => {
  const peerEl = document.createElement('div');
  peerEl.id = peerId;
  peerEl.class = 'peer';
  peers.appendChild(peerEl);
})
client.on('peerPresenceChanged', (peerId, presence) => {
  const peerEl = document.getElementById(peerId);
  peerEl.innerText = presence.name;
});
client.on('peerDisconnected', (peerId) => {
  const peerEl = document.getElementById(peerId);
  peerEl.remove();
});

const messages = document.getElementById('messages');

client.on('peerMessage', (id, message) => {
  messages.innerHTML += `<div>${id}: ${message}</div>`;
});

const testMessage = document.getElementById('testMessage');
testMessage.addEventListener('click', () => {
  client.broadcast('Hello World ' + Math.random());
});

window.client = client;
