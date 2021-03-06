import { EventEmitter } from 'events';
import io, { Socket } from 'socket.io-client';

enum ProtocolHeading {
  Presence = 'p',
  Broadcast = 'b',
  DirectMessage = 'd',
}

export interface ConvergeClientEvents {
  connected(id: string): void;
  peerConnected(id: string): void;
  peerDisconnected(id: string): void;
  broadcast(id: string, message: any): void;
  directMessage(id: string, message: any): void;
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

type Logger = (
  level: 'debug' | 'info' | 'warn' | 'error',
  ...args: any[]
) => void;

export class ConvergeClient extends EventEmitter {
  private signalling: Socket;
  private _peers: Record<string, ConvergeRemotePeer> = {};
  private _presence: any;
  private log: Logger;

  get presence(): any {
    return this._presence;
  }

  get id(): string | undefined {
    return this.signalling.id;
  }

  get peers() {
    return Object.keys(this._peers);
  }

  constructor(
    options: {
      server: string;
      topic: string;
      logger?: Logger;
    } = {
      server: 'ws://localhost:2000',
      topic: 'default',
      logger: () => {},
    },
  ) {
    super();

    this.signalling = io(options.server);

    this.log = options.logger;

    this.signalling.on('connect', this.handleSignallingConnect);
    this.signalling.on('disconnect', this.handleSignallingDisconnect);
    this.signalling.on('error', this.handleSignallingError);
    this.signalling.on('peers', this.handlePeers);
    this.signalling.on('offer', this.handleOffer);
    this.signalling.on('answer', this.handleAnswer);
    this.signalling.on('candidate', this.handleCandidate);
    this.signalling.on('peer-disconnected', this.handlePeerDisconnected);

    this.signalling.emit('join', { room: options.topic });
  }

  private handleSignallingConnect = () => {
    this.log('info', 'Signalling connected');
    this.emit('connected', this.id);
  };

  private handleSignallingDisconnect = () => {
    this.log('warn', 'Signalling disconnected');
  };

  private handleSignallingError = (err: Error) => {
    this.log('error', 'Signalling error', err);
  };

  private handlePeers = (peers: string[]) => {
    this.log('debug', 'Peers', peers);
    for (const peerId of peers) {
      // connect to remote peers on first connect
      const peer = this.setupRemotePeer(peerId);
      peer._connect();
    }
  };

  private handlePeerDisconnected = (peerId: string) => {
    delete this._peers[peerId];
    this.emit('peerDisconnected', peerId);
  };

  private setupRemotePeer = (peerId: string) => {
    if (!this._peers[peerId]) {
      this._peers[peerId] = new ConvergeRemotePeer(peerId);
      this._peers[peerId].on('disconnect', this.handlePeerDisconnected);
      this._peers[peerId].on('connect', this.handlePeerConnect);
      this._peers[peerId].on('offer', this.handleLocalOffer);
      this._peers[peerId].on('answer', this.handleLocalAnswer);
      this._peers[peerId].on('candidate', this.handleLocalCandidate);
      this._peers[peerId].on('message', this.handleRemotePeerMessage);
      this._peers[peerId].on(
        'directMessage',
        this.handleRemotePeerDirectMessage,
      );
      this._peers[peerId].on(
        'presenceChanged',
        this.handleRemotePeerPresenceChanged,
      );
    }
    return this._peers[peerId];
  };

  private handlePeerConnect = (peerId: string) => {
    this.log('info', 'Peer connected', peerId);
    this.emit('peerConnected', peerId);
    // initial presence
    this._peers[peerId]!._sendRaw(JSON.stringify(['p', this.presence]));
  };

  private handleOffer = (offerMessage: {
    sdp: string;
    peerId: string;
    sourcePeerId: string;
  }) => {
    this.log('debug', 'Got offer', offerMessage);
    const peer = this.setupRemotePeer(offerMessage.sourcePeerId);
    peer._handleOffer(offerMessage);
  };

  private handleAnswer = (answerMessage: {
    sdp: string;
    peerId: string;
    sourcePeerId: string;
  }) => {
    this.log('debug', 'Got answer', answerMessage);
    const peer = this._peers[answerMessage.sourcePeerId];
    if (peer) {
      peer._handleAnswer(answerMessage);
    }
  };

  private handleCandidate = (candidateMessage: {
    candidate: string;
    peerId: string;
    sourcePeerId: string;
  }) => {
    this.log('debug', 'Got candidate', candidateMessage);
    const peer = this._peers[candidateMessage.sourcePeerId];
    if (peer) {
      peer._handleCandidate(candidateMessage);
    }
  };

  private handleLocalOffer = (remotePeerId: string, offer: string) => {
    this.log('info', 'Sending offer to', remotePeerId);
    this.signalling.emit('offer', {
      sdp: offer,
      peerId: remotePeerId,
      sourcePeerId: this.signalling.id,
    });
  };

  private handleLocalAnswer = (remotePeerId: string, answer: string) => {
    this.log('info', 'Sending answer to', remotePeerId);
    this.signalling.emit('answer', {
      sdp: answer,
      peerId: remotePeerId,
      sourcePeerId: this.signalling.id,
    });
  };

  private handleLocalCandidate = (remotePeerId: string, candidate: string) => {
    this.log('info', 'Sending candidate to', remotePeerId);
    this.signalling.emit('candidate', {
      candidate: candidate,
      peerId: remotePeerId,
      sourcePeerId: this.signalling.id,
    });
  };

  private handleRemotePeerMessage = (remotePeerId: string, message: any) => {
    this.log('debug', 'Remote peer message', remotePeerId, message);
    this.emit('broadcast', remotePeerId, message);
  };

  private handleRemotePeerDirectMessage = (
    remotePeerId: string,
    message: any,
  ) => {
    this.log('debug', 'Remote peer direct message', remotePeerId, message);
    this.emit('directMessage', remotePeerId, message);
  };

  private handleRemotePeerPresenceChanged = (
    remotePeerId: string,
    presence: any,
  ) => {
    this.log('debug', 'Presence changed', remotePeerId, presence);
    this.emit('peerPresenceChanged', remotePeerId, presence);
  };

  broadcast = (message: string) => {
    this.broadcastRaw(ProtocolHeading.Broadcast, message);
  };

  private broadcastRaw = (type: string, message: string) => {
    for (const peer of Object.values(this._peers)) {
      peer._sendRaw(JSON.stringify([type, message]));
    }
  };

  updatePresence = (presence: any) => {
    this._presence = presence;
    this.broadcastRaw(ProtocolHeading.Presence, presence);
  };

  getPresence = (peerId: string) => {
    return this._peers[peerId]?.presence ?? null;
  };

  directMessage = (peerId: string, message: string) => {
    if (!this._peers[peerId]) {
      throw new Error(`Peer ${peerId} not connected`);
    }
    this._peers[peerId]._sendRaw(
      JSON.stringify([ProtocolHeading.DirectMessage, message]),
    );
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
  directMessage(peerId: string, message: any): void;
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
  private log: Logger;

  constructor(public id: string, options?: { logger?: Logger }) {
    super();
    this.log = options?.logger || (() => {});

    this.rtc.onicecandidate = this.handleIceCandidate;
    this.rtc.onnegotiationneeded = this.handleNegotiationNeeded;
    this.rtc.oniceconnectionstatechange = this.handleIceConnectionStateChange;
    this.rtc.onicegatheringstatechange = this.handleIceGatheringStateChange;
    this.rtc.onsignalingstatechange = this.handleSignalingStateChange;
    this.rtc.ondatachannel = this._handleDataChannel;
  }

  _connect = async () => {
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
    this.log('debug', this.id, 'Negotiation needed');
  };

  private handleIceConnectionStateChange = () => {
    this.log(
      'debug',
      this.id,
      'Ice connection state changed',
      this.rtc.iceConnectionState,
    );
    if (
      this.rtc.iceConnectionState === 'closed' ||
      this.rtc.iceConnectionState === 'failed' ||
      this.rtc.iceConnectionState === 'disconnected'
    ) {
      this.emit('disconnect', this.id);
    }
  };

  private handleIceGatheringStateChange = () => {
    this.log(
      'debug',
      this.id,
      'Ice gathering state changed',
      this.rtc.iceGatheringState,
    );
  };

  private handleSignalingStateChange = () => {
    this.log(
      'debug',
      this.id,
      'Signaling state changed',
      this.rtc.signalingState,
    );
    if (this.rtc.signalingState === 'closed') {
      this.emit('disconnect', this.id);
    }
  };

  _handleOffer = (offerMessage: { sdp: string }) => {
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

  _handleAnswer = (answerMessage: { sdp: string }) => {
    this.rtc.setRemoteDescription(
      new RTCSessionDescription({
        type: 'answer',
        sdp: answerMessage.sdp,
      }),
    );
  };

  _handleCandidate = (candidateMessage: {
    candidate: string;
    peerId: string;
  }) => {
    this.rtc.addIceCandidate(
      new RTCIceCandidate(JSON.parse(candidateMessage.candidate)),
    );
  };

  _handleDataChannel = (event: RTCDataChannelEvent) => {
    this.log('debug', this.id, 'received data channel', event.channel.label);
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
    this.log('debug', this.id, 'Data channel open');
    this.emit('connect', this.id);
  };

  private handleDataChannelClose = () => {
    this.log('debug', this.id, 'Data channel close');
  };

  private handleDataChannelError = (ev: Event) => {
    this.log('error', this.id, 'Data channel error', ev);
  };

  private handleDataChannelMessage = (event: MessageEvent) => {
    this.log('debug', this.id, 'Data channel message', event.data);
    const [type, payload] = JSON.parse(event.data) as [ProtocolHeading, any];
    if (type === ProtocolHeading.Presence) {
      this.presence = payload;
      this.emit('presenceChanged', this.id, payload);
    } else if (type === ProtocolHeading.Broadcast) {
      this.emit('message', this.id, payload);
    } else if (type === ProtocolHeading.DirectMessage) {
      this.emit('directMessage', this.id, payload);
    }
  };

  _sendRaw = (message: any) => {
    const channel = this.dataChannels[DATA_CHANNEL_LABEL];
    if (channel) {
      channel.send(message);
    } else {
      throw new Error('no data channel');
    }
    // TODO: enqueue
  };

  /**
   * Sends a message only to this peer.
   */
  sendMessage = (message: any) => {
    this._sendRaw(JSON.stringify(['m', message]));
  };

  /**
   * Sends your presence to this peer.
   */
  sendPresence = (presence: any) => {
    this._sendRaw(JSON.stringify(['p', presence]));
  };
}
