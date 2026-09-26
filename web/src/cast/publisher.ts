// Phone side of casting: waits for a viewer's offer (via the dev server's /api/cast relay) and
// answers it with the composited HUD stream. A new offer (viewer reloaded) replaces the old
// connection, so the laptop can reconnect at any time.

import { ICE_SERVERS, postJson, waitForIceGathering } from './rtc';

const POLL_MS = 1500;
const MAX_BITRATE = 2_500_000;

export type CastPublisher = { stop: () => void };

export function startCastPublisher(stream: MediaStream, onStatus: (status: string) => void): CastPublisher {
  let pc: RTCPeerConnection | null = null;
  let lastOfferId = 0;
  let stopped = false;
  let timer = 0;

  onStatus('waiting for viewer');

  async function answer(id: number, sdp: string) {
    pc?.close();
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc = conn;
    conn.onconnectionstatechange = () => {
      if (pc === conn) onStatus(conn.connectionState === 'connected' ? 'live' : conn.connectionState);
    };
    for (const track of stream.getTracks()) conn.addTrack(track, stream);
    await conn.setRemoteDescription({ type: 'offer', sdp });
    await conn.setLocalDescription(await conn.createAnswer());
    await waitForIceGathering(conn);
    await postJson('/api/cast/answer', { id, sdp: conn.localDescription!.sdp });
    // Default WebRTC bitrate is conservative; the HUD text needs more to stay readable.
    for (const sender of conn.getSenders()) {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = MAX_BITRATE;
      // When bandwidth is tight, drop frame rate rather than resolution (keeps HUD text readable).
      params.degradationPreference = 'maintain-resolution';
      sender.setParameters(params).catch(() => {});
    }
  }

  async function poll() {
    try {
      const res = await fetch(`/api/cast/offer?after=${lastOfferId}`);
      if (res.status === 200) {
        const { id, sdp } = await res.json();
        lastOfferId = id;
        onStatus('connecting');
        await answer(id, sdp);
      }
    } catch (e) {
      onStatus(`error: ${(e as Error).message}`);
    }
    if (!stopped) timer = window.setTimeout(poll, POLL_MS);
  }

  poll();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      pc?.close();
      pc = null;
    },
  };
}
