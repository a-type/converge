import { EventEmitter } from 'events';
import io, { Socket } from 'socket.io-client';

export interface ConvergeClientEvents {
  connected(id: string): void;
  peerConnected(id: string): void;
  peerDisconnected(id: string): void;
  peerMessage(id: string, message: any): void;
  peerPresenceChanged(id: string, presence: any): void;
}

export declare interface ConvergeClient {
  on<Event extends keyof ConvergeClientEvents>(
    ev: Event,
    cb: ConvergeClientEvents[Event],
  ): this;
  off<Event extends keyof ConvergeClientEvents>(
    ev: Event,
    cb: ConvergeClientEvents[Event],
  ): this;
  emit<Event extends keyof ConvergeClientEvents>(
    ev: Event,
    ...args: Parameters<ConvergeClientEvents[Event]>
  ): boolean;
}

export class ConvergeClient extends EventEmitter {
  private signalling: Socket;
  private peers: Record<string, ConvergeRemotePeer> = {};
  private _presence: any;

  get presence(): any {
    return this._presence;
  }

  get id(): string | undefined {
    return this.signalling.id;
  }

  constructor(
    options: {
      server: string;
      topic: string;
    } = {
      server: 'ws://localhost:2000',
      topic: 'default',
    },
  ) {
    super();

    this.signalling = io(options.server);

    this.signalling.on('connect', this.handleSignallingConnect);
    this.signalling.on('disconnect', this.handleSignallingDisconnect);
    this.signalling.on('error', this.handleSignallingError);
    this.signalling.on('peers', this.handlePeers);
    this.signalling.on('offer', this.handleOffer);
    this.signalling.on('answer', this.handleAnswer);
    this.signalling.on('candidate', this.handleCandidate);
    this.signalling.on('peer-disconnected', this.handlePeerDisconnected);

    this.signalling.emit('join', options.topic);
  }

  private handleSignallingConnect = () => {
    console.log('Signalling connected');
    this.emit('connected', this.id);
  };

  private handleSignallingDisconnect = () => {
    console.log('Signalling disconnected');
  };

  private handleSignallingError = (err: Error) => {
    console.error('Signalling error', err);
  };

  private handlePeers = (peers: string[]) => {
    console.log('Peers', peers);
    for (const peerId of peers) {
      // connect to remote peers on first connect
      const peer = this.setupRemotePeer(peerId);
      peer.connect();
    }
  };

  private handlePeerDisconnected = (peerId: string) => {
    delete this.peers[peerId];
    this.emit('peerDisconnected', peerId);
  };

  private setupRemotePeer = (peerId: string) => {
    if (!this.peers[peerId]) {
      this.peers[peerId] = new ConvergeRemotePeer(peerId);
      this.peers[peerId].on('disconnect', this.handlePeerDisconnected);
      this.peers[peerId].on('connect', this.handlePeerConnect);
      this.peers[peerId].on('offer', this.handleLocalOffer);
      this.peers[peerId].on('answer', this.handleLocalAnswer);
      this.peers[peerId].on('candidate', this.handleLocalCandidate);
      this.peers[peerId].on('message', this.handleRemotePeerMessage);
      this.peers[peerId].on(
        'presenceChanged',
        this.handleRemotePeerPresenceChanged,
      );
    }
    return this.peers[peerId];
  };

  private handlePeerConnect = (peerId: string) => {
    console.log('Peer connected', peerId);
    this.emit('peerConnected', peerId);
    // initial presence
    this.peers[peerId]!.send(JSON.stringify(['p', this.presence]));
  };

  private handleOffer = (offerMessage: {
    sdp: string;
    peerId: string;
    sourcePeerId: string;
  }) => {
    console.debug('Got offer', offerMessage);
    const peer = this.setupRemotePeer(offerMessage.sourcePeerId);
    peer.handleOffer(offerMessage);
  };

  private handleAnswer = (answerMessage: {
    sdp: string;
    peerId: string;
    sourcePeerId: string;
  }) => {
    console.debug('Got answer', answerMessage);
    const peer = this.peers[answerMessage.sourcePeerId];
    if (peer) {
      peer.handleAnswer(answerMessage);
    }
  };

  private handleCandidate = (candidateMessage: {
    candidate: string;
    peerId: string;
    sourcePeerId: string;
  }) => {
    console.debug('Got candidate', candidateMessage);
    const peer = this.peers[candidateMessage.sourcePeerId];
    if (peer) {
      peer.handleCandidate(candidateMessage);
    }
  };

  private handleLocalOffer = (remotePeerId: string, offer: string) => {
    console.log('Sending offer to', remotePeerId);
    this.signalling.emit('offer', {
      sdp: offer,
      peerId: remotePeerId,
      sourcePeerId: this.signalling.id,
    });
  };

  private handleLocalAnswer = (remotePeerId: string, answer: string) => {
    console.log('Sending answer to', remotePeerId);
    this.signalling.emit('answer', {
      sdp: answer,
      peerId: remotePeerId,
      sourcePeerId: this.signalling.id,
    });
  };

  private handleLocalCandidate = (remotePeerId: string, candidate: string) => {
    console.log('Sending candidate to', remotePeerId);
    this.signalling.emit('candidate', {
      candidate: candidate,
      peerId: remotePeerId,
      sourcePeerId: this.signalling.id,
    });
  };

  private handleRemotePeerMessage = (remotePeerId: string, message: any) => {
    console.debug('Remote peer message', remotePeerId, message);
    this.emit('peerMessage', remotePeerId, message);
  };

  private handleRemotePeerPresenceChanged = (
    remotePeerId: string,
    presence: any,
  ) => {
    console.debug('Presence changed', remotePeerId, presence);
    this.emit('peerPresenceChanged', remotePeerId, presence);
  };

  broadcast = (message: string) => {
    console.log('Broadcasting', message);
    this.broadcastRaw('m', message);
  };

  private broadcastRaw = (type: string, message: string) => {
    for (const peer of Object.values(this.peers)) {
      peer.send(JSON.stringify([type, message]));
    }
  };

  updatePresence = (presence: any) => {
    console.debug('Updating presence', presence);
    this._presence = presence;
    this.broadcastRaw('p', presence);
  };
}

const DATA_CHANNEL_LABEL = 'data';

export interface ConvergeRemotePeerEvents {
  disconnect(peerId: string): void;
  connect(peerId: string): void;
  candidate(peerId: string, candidate: string): void;
  offer(peerId: string, offer: string): void;
  answer(peerId: string, answer: string): void;
  message(peerId: string, message: any): void;
  presenceChanged(peerId: string, presence: any): void;
}

export declare interface ConvergeRemotePeer {
  on<Event extends keyof ConvergeRemotePeerEvents>(
    ev: Event,
    cb: ConvergeRemotePeerEvents[Event],
  ): this;
  off<Event extends keyof ConvergeRemotePeerEvents>(
    ev: Event,
    cb: ConvergeRemotePeerEvents[Event],
  ): this;
  emit<Event extends keyof ConvergeRemotePeerEvents>(
    ev: Event,
    ...args: Parameters<ConvergeRemotePeerEvents[Event]>
  ): boolean;
}

export class ConvergeRemotePeer extends EventEmitter {
  private rtc = new RTCPeerConnection({
    iceServers: [
      {
        urls: 'stun:stun.l.google.com:19302',
      },
    ],
  });
  private dataChannels: Record<string, RTCDataChannel> = {};
  presence: any;

  constructor(public id: string) {
    super();

    this.rtc.onicecandidate = this.handleIceCandidate;
    this.rtc.onnegotiationneeded = this.handleNegotiationNeeded;
    this.rtc.oniceconnectionstatechange = this.handleIceConnectionStateChange;
    this.rtc.onicegatheringstatechange = this.handleIceGatheringStateChange;
    this.rtc.onsignalingstatechange = this.handleSignalingStateChange;
    this.rtc.ondatachannel = this.handleDataChannel;
  }

  connect = async () => {
    this.setupDefaultDataChannel();
    await this.rtc.createOffer().then(this.onLocalOffer);
  };

  private onLocalOffer = (offer: RTCSessionDescriptionInit) => {
    this.rtc.setLocalDescription(offer);
    this.emit('offer', this.id, offer.sdp);
  };

  private onLocalAnswer = (answer: RTCSessionDescriptionInit) => {
    this.rtc.setLocalDescription(answer);
    this.emit('answer', this.id, answer.sdp);
  };

  private handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate) {
      this.emit('candidate', this.id, JSON.stringify(event.candidate));
    }
  };

  private handleNegotiationNeeded = () => {
    console.log('Negotiation needed');
  };

  private handleIceConnectionStateChange = () => {
    console.log('Ice connection state changed', this.rtc.iceConnectionState);
    if (
      this.rtc.iceConnectionState === 'closed' ||
      this.rtc.iceConnectionState === 'failed' ||
      this.rtc.iceConnectionState === 'disconnected'
    ) {
      this.emit('disconnect', this.id);
    }
  };

  private handleIceGatheringStateChange = () => {
    console.log('Ice gathering state changed', this.rtc.iceGatheringState);
  };

  private handleSignalingStateChange = () => {
    console.log('Signaling state changed', this.rtc.signalingState);
    if (this.rtc.signalingState === 'closed') {
      this.emit('disconnect', this.id);
    }
  };

  handleOffer = (offerMessage: { sdp: string }) => {
    this.rtc.setRemoteDescription(
      new RTCSessionDescription({
        type: 'offer',
        sdp: offerMessage.sdp,
      }),
    );
    this.rtc.createAnswer().then(this.onLocalAnswer);
  };

  private setupDefaultDataChannel = () => {
    const dataChannel = this.rtc.createDataChannel(DATA_CHANNEL_LABEL);
    this.setupDataChannel(dataChannel);
  };

  handleAnswer = (answerMessage: { sdp: string }) => {
    this.rtc.setRemoteDescription(
      new RTCSessionDescription({
        type: 'answer',
        sdp: answerMessage.sdp,
      }),
    );
  };

  handleCandidate = (candidateMessage: {
    candidate: string;
    peerId: string;
  }) => {
    this.rtc.addIceCandidate(
      new RTCIceCandidate(JSON.parse(candidateMessage.candidate)),
    );
  };

  handleDataChannel = (event: RTCDataChannelEvent) => {
    console.log('received data channel', event.channel.label);
    const channel = event.channel;
    this.setupDataChannel(channel);
  };

  private setupDataChannel = (channel: RTCDataChannel) => {
    channel.onopen = this.handleDataChannelOpen;
    channel.onclose = this.handleDataChannelClose;
    channel.onerror = this.handleDataChannelError;
    channel.onmessage = this.handleDataChannelMessage;
    this.dataChannels[channel.label] = channel;
  };

  private handleDataChannelOpen = () => {
    console.log('Data channel open');
    this.emit('connect', this.id);
  };

  private handleDataChannelClose = () => {
    console.log('Data channel close');
  };

  private handleDataChannelError = (ev: Event) => {
    console.error('Data channel error', ev);
  };

  private handleDataChannelMessage = (event: MessageEvent) => {
    console.log('Data channel message', event.data);
    const [type, payload] = JSON.parse(event.data);
    if (type === 'p') {
      this.presence = payload;
      this.emit('presenceChanged', this.id, payload);
    } else if (type === 'm') {
      this.emit('message', this.id, payload);
    }
  };

  send = (message: any) => {
    const channel = this.dataChannels[DATA_CHANNEL_LABEL];
    if (channel) {
      channel.send(message);
    } else {
      throw new Error('no data channel');
    }
    // TODO: enqueue
  };
}
