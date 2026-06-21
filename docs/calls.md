# Voice & Video Calls — `@somni/chat-call`

Calling is a **separate, optional module**. It reuses the same architecture as
the chat engine: a thin, framework-agnostic orchestrator (`CallEngine`) plus
**pluggable providers**. We don't reimplement WebRTC infra — we wrap proven
libraries.

## What does the heavy lifting

| Concern | Who handles it |
|---------|----------------|
| Call state machine, signaling routing, participants | `CallEngine` (this package) |
| P2P media (1:1, small groups) | **native WebRTC** `RTCPeerConnection` via `WebRTCCallProvider` |
| SFU media at scale, TURN, simulcast, recording | **LiveKit** (`livekit-client`) or **Daily** (`@daily-co/daily-js`) via wrappers |
| Transporting signaling messages | your existing realtime (Supabase/Appwrite/WS) via `TransportSignaling`, or `InMemorySignalingBus` for local |

> Rule of thumb: **WebRTC mesh** for 1:1 and tiny groups; **LiveKit/Daily**
> (SFU) for group calls, mobile networks, and scale.

---

## 1:1 call with native WebRTC (no extra services)

```ts
import { CallEngine, WebRTCCallProvider, TransportSignaling } from '@somni/chat-call';

// Carry signaling over your existing realtime backend.
const signaling = new TransportSignaling(myRealtimeTransport, conversationId);

const call = new CallEngine({
  selfId: userId,
  signaling,
  provider: new WebRTCCallProvider(), // uses browser RTCPeerConnection + getUserMedia
});

// Place a video call
await call.start(conversationId, 'video', { peers: [otherUserId] });

// Incoming side
call.on('call:incoming', () => call.accept());

// Controls
await call.setMicEnabled(false);
await call.setCameraEnabled(false);
await call.hangup();
```

### Wiring the signaling transport

`TransportSignaling` needs a `{ publish, subscribe }` transport. Example over a
Supabase broadcast channel:

```ts
const transport = {
  publish: (topic, payload) => supabase.channel(topic).send({ type: 'broadcast', event: 'sig', payload }),
  subscribe: (topic, cb) => {
    const ch = supabase.channel(topic).on('broadcast', { event: 'sig' }, (m) => cb(m.payload)).subscribe();
    return () => supabase.removeChannel(ch);
  },
};
```

---

## Group calls at scale with LiveKit (SFU)

```ts
import { CallEngine } from '@somni/chat-call';
import { LiveKitCallProvider } from '@somni/chat-call/providers/livekit';

const call = new CallEngine({
  selfId: userId,
  signaling,                              // still used for invite/accept/hangup
  provider: new LiveKitCallProvider({
    url: 'wss://your.livekit.cloud',
    getToken: (room, identity) => fetch(`/api/livekit-token?room=${room}&id=${identity}`).then(r => r.text()),
  }),
});

await call.start(conversationId, 'video', { peers: groupMemberIds });
```

Daily works the same way via `@somni/chat-call/providers/daily` and
`DailyCallProvider({ getRoomUrl })`.

---

## React

```tsx
import { useCall } from '@somni/chat-react';

function CallUI({ engine }) {
  const { state, localStream, remoteTracks, start, accept, hangup, toggleMic, toggleCamera, isMicEnabled } = useCall(engine);

  if (state === 'incoming') return <button onClick={() => accept()}>Answer</button>;
  return (
    <>
      <Video stream={localStream} muted />
      {remoteTracks.map((t) => <Video key={t.user_id + t.kind} stream={t.stream} />)}
      <button onClick={() => toggleMic()}>{isMicEnabled ? 'Mute' : 'Unmute'}</button>
      <button onClick={() => toggleCamera()}>Camera</button>
      <button onClick={() => hangup()}>End</button>
    </>
  );
}
```

---

## Call lifecycle & events

```
idle → ringing (caller) / incoming (callee) → connecting → connected → ended
```

Events: `call:outgoing`, `call:incoming`, `call:state`, `call:connected`,
`call:ended`, `participant:joined`, `participant:left`, `participant:media`,
`local-stream`, `remote-track`, `remote-track:removed`, `error`.

End reasons: `hangup`, `remote-hangup`, `rejected`, `cancelled`, `no-answer`,
`timeout`, `error`.

---

## Writing your own provider

Implement `CallProvider` (mirrors `ChatAdapter`). Set `handlesSignaling = true`
if your SDK does its own signaling (SFU); `false` if the engine should drive
offer/answer/ICE (mesh). See `WebRTCCallProvider` for the reference mesh
implementation.
