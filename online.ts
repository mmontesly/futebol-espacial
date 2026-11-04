// Online 2-10 jogadores via WebRTC (PeerJS broker público, sem conta/segredos). Só web.
// Estrela: host (jogador 0) é autoritativo — simula a física e envia o estado; convidados mandam só o controle.
import { Platform } from 'react-native';

export type Msg =
  | { t: 'hello'; you: number } | { t: 'full' } | { t: 'left'; i: number }
  | { t: 'lobby'; ids: number[]; nicks: Record<number, string>; map: string; cap: number }
  | { t: 'nick'; i: number; n: string }
  | { t: 'start'; map: string; ids: number[]; nicks: Record<number, string> }
  | { t: 'in'; i: number; x: number; y: number; k: boolean; b: boolean }
  | { t: 'st'; p: number[][]; b: number[]; sc: number[]; tm: number; ev?: string; out?: boolean }
  | { t: 'end'; sc: number[] } | { t: 'bo'; n: number } | { t: 'score'; w: number[]; champ: number; match: number };
export type Room = { code: string; me: number; isHost: boolean; send: (m: Msg) => void; close: () => void; ids: () => number[]; lock: () => void; setCap: (n: number) => void };
export type Handlers = { onMsg: (m: Msg) => void; onClose: () => void };

export const MAX = 10; // arquitetura aguenta até 10
const PREFIX = 'minano-futebolespacial-v1-';
export const onlineAvailable = () => Platform.OS === 'web' && typeof window !== 'undefined' && 'RTCPeerConnection' in window;
const makePeer = async (id?: string): Promise<any> => { const { default: Peer } = await import('peerjs'); return id ? new Peer(id) : new Peer(); };

export async function createRoom(h: Handlers, tries = 5): Promise<Room> {
  const code = String(1000 + Math.floor(Math.random() * 9000));
  const peer = await makePeer(PREFIX + code);
  const conns = new Map<number, any>();
  let locked = false, cap = MAX;
  const ids = () => [0, ...conns.keys()].sort((a, b) => a - b);
  const bcast = (m: Msg, except?: number) => conns.forEach((c, i) => { if (i !== except && c.open) try { c.send(m); } catch {} });
  return new Promise((resolve, reject) => {
    let opened = false;
    peer.on('open', () => { opened = true; resolve({ code, me: 0, isHost: true, ids, lock: () => { locked = true; }, setCap: n => { cap = Math.min(MAX, n); }, send: m => bcast(m), close: () => { try { peer.destroy(); } catch {} } }); });
    peer.on('error', (e: any) => {
      if (opened) return;
      if (e?.type === 'unavailable-id' && tries > 0) { peer.destroy(); createRoom(h, tries - 1).then(resolve, reject); } else reject(e?.type || 'erro');
    });
    peer.on('connection', (c: any) => {
      c.on('open', () => {
        let free = -1; for (let i = 1; i < cap; i++) if (!conns.has(i)) { free = i; break; }
        if (locked || free < 0) { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); return; }
        conns.set(free, c);
        c.send({ t: 'hello', you: free });
        h.onMsg({ t: 'left', i: -1 }); // força o host a reenviar o lobby
        c.on('data', (d: any) => { h.onMsg(d); if (d.t === 'nick') bcast(d, free); });
        const gone = () => { if (!conns.has(free)) return; conns.delete(free); const m: Msg = { t: 'left', i: free }; bcast(m); h.onMsg(m); };
        c.on('close', gone); c.on('error', gone);
      });
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  });
}

export async function joinRoom(code: string, h: Handlers): Promise<Room> {
  const peer = await makePeer();
  return new Promise((resolve, reject) => {
    const fail = (e: string) => { try { peer.destroy(); } catch {} reject(e); };
    const timer = setTimeout(() => fail('timeout'), 15000);
    peer.on('error', (e: any) => { clearTimeout(timer); fail(e?.type || 'erro'); });
    peer.on('open', () => {
      const c = peer.connect(PREFIX + code, { reliable: true });
      let cur: number[] = [];
      c.on('data', (d: any) => {
        if (d.t === 'full') { clearTimeout(timer); return fail('full'); }
        if (d.t === 'hello') { clearTimeout(timer); resolve({ code, me: d.you, isHost: false, ids: () => cur, lock: () => {}, setCap: () => {}, send: m => { try { if (c.open) c.send(m); } catch {} }, close: () => { try { c.close(); peer.destroy(); } catch {} } }); return; }
        if (d.t === 'lobby' || d.t === 'start') cur = d.ids;
        h.onMsg(d);
      });
      c.on('close', () => h.onClose());
    });
  });
}
