/**
 * WebRTC and WebSocket for PeerPigeon in Node (werift and ws), installed as
 * the browser globals PeerPigeon and the FreeRTC client expect.
 */
const WEBRTC_GLOBALS = [
  'RTCCertificate', 'RTCDataChannel', 'RTCDataChannelEvent', 'RTCDtlsTransport', 'RTCError', 'RTCIceCandidate',
  'RTCIceTransport', 'RTCPeerConnection', 'RTCPeerConnectionIceEvent', 'RTCSctpTransport', 'RTCSessionDescription',
];

export async function installWebRtc(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.WebSocket !== 'function') g.WebSocket = (await import('ws')).WebSocket;
  if (typeof g.RTCPeerConnection === 'function') return;
  const werift = (await import('werift')) as unknown as Record<string, unknown>;
  for (const name of WEBRTC_GLOBALS) if (g[name] === undefined && werift[name] !== undefined) g[name] = werift[name];
  const Base = werift.RTCPeerConnection as new (config?: Record<string, unknown>) => object;
  g.RTCPeerConnection = class PigeonFsPeerConnection extends Base {
    constructor(config: Record<string, unknown> = {}) { super({ ...config, iceCandidatePoolSize: 0 }); }
  };
}
