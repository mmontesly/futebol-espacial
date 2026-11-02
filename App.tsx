import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createRoom, joinRoom, onlineAvailable, type Room, type Msg } from './online';

// ---------- Constantes do jogo (unidades do campo) ----------
const FW = 100, FH = 150, GL = 33, GR = 67, PR = 5, BR = 3.5;
const GOALS_TO_WIN = 3, MATCH_TIME = 120;
const TEAM = [{ name: 'Azul', col: '#4CC9F0', dark: '#1D6FA3' }, { name: 'Laranja', col: '#FF9F1C', dark: '#C2410C' }];
type MapId = 'saturno' | 'estrelas';
const MAPS: Record<MapId, { emoji: string; name: string; bg: string; field: string }> = {
  saturno: { emoji: '🪐', name: 'Saturno', bg: '#2B1B4A', field: 'rgba(233,196,106,0.16)' },
  estrelas: { emoji: '✨', name: 'Estrelas', bg: '#0B1026', field: 'rgba(120,200,255,0.13)' },
};
// Apelidos só de uma lista pronta (sem texto livre = sem nomes reais/dados pessoais).
const NICKS = ['Cometa', 'Estrela', 'Foguete', 'Lua', 'Turbo', 'Faísca', 'Pipoca', 'Raio', 'Bolinha', 'Planeta', 'Astro', 'Biscoito'];

type P = { id: number; x: number; y: number; vx: number; vy: number; a: number; team: number; nick: string; turbo: number; tcd: number; kcd: number; kick: boolean; ai?: boolean };
type In = { x: number; y: number; k: boolean; b: boolean };
type Sim = { ps: P[]; bx: number; by: number; bvx: number; bvy: number; bOut: number; sc: number[]; tm: number; pause: number; ev: string; evT: number; over: boolean; inputs: Record<number, In>; last: number };

const STARS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 61.3) % 100, s: 1 + (i % 3), p: i % 7 }));
const vib = (ms = 15) => { try { if (Platform.OS === 'web') (navigator as any).vibrate?.(ms); else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} };
let actx: any = null;
const beep = (f: number, d = 0.1, type = 'sine') => {
  try { if (Platform.OS !== 'web') return; actx = actx || new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = f; g.gain.value = 0.06; o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d); o.stop(actx.currentTime + d); } catch {}
};

const spawn = (s: Sim) => {
  const byTeam = [0, 0];
  const counts = [s.ps.filter(p => p.team === 0).length, s.ps.filter(p => p.team === 1).length];
  s.ps.forEach(p => { const k = byTeam[p.team]++, n = counts[p.team];
    p.x = FW * (k + 1) / (n + 1); p.y = p.team === 0 ? FH * 0.78 : FH * 0.22; p.vx = p.vy = 0; p.a = p.team === 0 ? -90 : 90; });
  s.bx = FW / 2; s.by = FH / 2; s.bvx = s.bvy = 0; s.bOut = 0;
};
const newSim = (players: { id: number; nick: string; ai?: boolean }[]): Sim => {
  const s: Sim = { ps: players.map((q, i) => ({ id: q.id, nick: q.nick, ai: q.ai, team: i % 2, x: 0, y: 0, vx: 0, vy: 0, a: 0, turbo: 0, tcd: 0, kcd: 0, kick: false })), bx: 0, by: 0, bvx: 0, bvy: 0, bOut: 0, sc: [0, 0], tm: MATCH_TIME, pause: 1.2, ev: 'Vai! 🚀', evT: 1.5, over: false, inputs: {}, last: 0 };
  spawn(s); return s;
};

// Física autoritativa (roda no aparelho do host ou no modo contra o computador)
const step = (s: Sim, dt: number, onSfx: (k: string) => void) => {
  if (s.over) return;
  s.evT = Math.max(0, s.evT - dt);
  if (s.pause > 0) { s.pause -= dt; if (s.pause <= 0 && s.ev.startsWith('GOL')) { spawn(s); s.ev = 'Vai! 🚀'; s.evT = 1; } return; }
  s.tm -= dt;
  if (s.tm <= 0) { s.tm = 0; s.over = true; return; }
  for (const p of s.ps) {
    let ix = 0, iy = 0, k = false, b = false;
    if (p.ai) { // computador fácil
      const tx = s.bx + (s.bx - FW / 2) * 0.1, ty = s.by - 7; const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
      const slow = d < 4 ? d / 4 : 1; ix = dx / d * 0.45 * slow; iy = dy / d * 0.45 * slow;
      const db = Math.hypot(s.bx - p.x, s.by - p.y); if (db < 12 && s.by > p.y && s.tm < MATCH_TIME - 2 && Math.random() < dt * 0.7) k = true;
    } else { const q = s.inputs[p.id]; if (q) { ix = q.x; iy = q.y; k = q.k; b = q.b; q.k = false; q.b = false; } }
    p.turbo = Math.max(0, p.turbo - dt); p.tcd = Math.max(0, p.tcd - dt); p.kcd = Math.max(0, p.kcd - dt);
    if (b && p.tcd <= 0) { p.turbo = 1.2; p.tcd = 4; onSfx('turbo'); }
    const acc = p.turbo > 0 ? 260 : 150, max = p.ai ? 28 : p.turbo > 0 ? 85 : 45;
    p.vx += ix * acc * dt; p.vy += iy * acc * dt;
    const sp = Math.hypot(p.vx, p.vy); if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
    const dr = Math.exp(-1.8 * dt); p.vx *= dr; p.vy *= dr;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < PR) { p.x = PR; p.vx = Math.abs(p.vx) * 0.5; } if (p.x > FW - PR) { p.x = FW - PR; p.vx = -Math.abs(p.vx) * 0.5; }
    if (p.y < PR) { p.y = PR; p.vy = Math.abs(p.vy) * 0.5; } if (p.y > FH - PR) { p.y = FH - PR; p.vy = -Math.abs(p.vy) * 0.5; }
    if (Math.hypot(p.vx, p.vy) > 3) p.a = Math.atan2(p.vy, p.vx) * 180 / Math.PI;
    p.kick = false;
    if (k && p.kcd <= 0 && s.bOut <= 0) {
      p.kcd = 0.35; p.kick = true;
      const dx = s.bx - p.x, dy = s.by - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < PR + BR + 7) { const pw = p.ai ? 55 : 95; s.bvx = dx / d * pw + p.vx * 0.3; s.bvy = dy / d * pw + p.vy * 0.3; onSfx('kick'); }
    }
  }
  // foguetinhos não se atravessam
  for (let i = 0; i < s.ps.length; i++) for (let j = i + 1; j < s.ps.length; j++) {
    const a = s.ps[i], c = s.ps[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < PR * 2) { const o = (PR * 2 - d) / 2, nx = dx / d, ny = dy / d; a.x -= nx * o; a.y -= ny * o; c.x += nx * o; c.y += ny * o; }
  }
  if (s.bOut > 0) { s.bOut -= dt; if (s.bOut <= 0) { s.bx = FW / 2; s.by = FH / 2; s.bvx = s.bvy = 0; s.ev = 'Bola de volta! ⚽'; s.evT = 1; } return; }
  for (const p of s.ps) {
    const dx = s.bx - p.x, dy = s.by - p.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < PR + BR) { const nx = dx / d, ny = dy / d; s.bx = p.x + nx * (PR + BR); s.by = p.y + ny * (PR + BR);
      const vr = (s.bvx - p.vx) * nx + (s.bvy - p.vy) * ny; if (vr < 0) { s.bvx -= 1.4 * vr * nx; s.bvy -= 1.4 * vr * ny; onSfx('bump'); } }
  }
  const bd = Math.exp(-0.45 * dt); s.bvx *= bd; s.bvy *= bd; // gravidade baixa: a bola flutua
  s.bx += s.bvx * dt; s.by += s.bvy * dt;
  const inMouth = s.bx > GL + BR * 0.5 && s.bx < GR - BR * 0.5;
  if (s.by < BR && !inMouth) { s.by = BR; s.bvy = Math.abs(s.bvy) * 0.8; }
  if (s.by > FH - BR && !inMouth) { s.by = FH - BR; s.bvy = -Math.abs(s.bvy) * 0.8; }
  const goal = s.by < -4 ? 0 : s.by > FH + 4 ? 1 : -1; // time 0 (azul) ataca para cima
  if (goal >= 0) {
    s.sc[goal]++; s.ev = `GOL do ${TEAM[goal].name}! 🥅`; s.evT = 1.8; s.pause = 1.8; s.bvx = s.bvy = 0; onSfx('goal');
    if (s.sc[goal] >= GOALS_TO_WIN) s.over = true;
    return;
  }
  if (s.bx < -6 || s.bx > FW + 6) { s.bOut = 1.3; s.ev = 'Foi pro espaço! 🌌'; s.evT = 1.3; onSfx('out'); }
};

type Mode = 'menu' | 'nick' | 'lobby' | 'play' | 'end';
type View2 = { ps: { id: number; x: number; y: number; a: number; team: number; nick: string; turbo: boolean }[]; bx: number; by: number; bOut: boolean; sc: number[]; tm: number; ev: string; evT: number };

export default function App() {
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('menu');
  const [map, setMap] = useState<MapId>('saturno');
  const [nick, setNick] = useState(NICKS[0]);
  const [online, setOnline] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [lobby, setLobby] = useState<{ ids: number[]; nicks: Record<number, string> }>({ ids: [], nicks: {} });
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [ov, setOv] = useState<'choose' | 'join' | 'wait'>('choose');
  const [bo, setBo] = useState(3); const boRef = useRef(3); boRef.current = bo;
  type Ser = { w: number[]; champ: number; match: number };
  const [ser, setSer] = useState<Ser>({ w: [0, 0], champ: -1, match: 0 }); const serRef = useRef<Ser>(ser);
  const applyScore = (x: Ser) => { serRef.current = x; setSer(x); };
  const resetSeries = () => applyScore({ w: [0, 0], champ: -1, match: 0 });
  const [, setTick] = useState(0);
  const [result, setResult] = useState<number[]>([0, 0]);
  const [myTeam, setMyTeam] = useState(0);
  const sim = useRef<Sim | null>(null);
  const roomRef = useRef<Room | null>(null); roomRef.current = room;
  const nicksRef = useRef<Record<number, string>>({});
  const mapRef = useRef(map); mapRef.current = map;
  const inp = useRef<In>({ x: 0, y: 0, k: false, b: false });
  const joy = useRef<{ id: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const snap = useRef<{ prev: View2 | null; next: View2 | null; at: number }>({ prev: null, next: null, at: 0 });
  const meRef = useRef(0);
  const ctrlRef = useRef<any>(null);
  const kickBtn = useRef<any>(null), turboBtn = useRef<any>(null);
  const [pressed, setPressed] = useState({ k: false, b: false });
  if (Platform.OS === 'web' && typeof window !== 'undefined') (window as any).__fe = { sim, snap, inp, room: roomRef, mode, lobby };

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = 'Futebol Espacial'; document.documentElement.lang = 'pt-BR';
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  const sfx = (k: string) => { if (k === 'kick') { beep(520, 0.08, 'square'); } else if (k === 'goal') { beep(660, 0.15); setTimeout(() => beep(880, 0.25), 150); vib(80); } else if (k === 'out') beep(220, 0.3, 'triangle'); else if (k === 'turbo') beep(300, 0.2, 'sawtooth'); };

  const toView = (s: Sim): View2 => ({ ps: s.ps.map(p => ({ id: p.id, x: p.x, y: p.y, a: p.a, team: p.team, nick: p.nick, turbo: p.turbo > 0 })), bx: s.bx, by: s.by, bOut: s.bOut > 0, sc: [...s.sc], tm: s.tm, ev: s.ev, evT: s.evT });

  const finish = (sc: number[]) => {
    setResult(sc); setMode('end'); vib(120);
    const r = roomRef.current;
    if (r?.isHost) { // o host conta as vitórias da série e manda para todos
      const w = sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : -1; const nw = [...serRef.current.w]; if (w >= 0) nw[w]++;
      const nx = { w: nw, champ: w >= 0 && nw[w] >= boRef.current ? w : -1, match: serRef.current.match }; applyScore(nx); r.send({ t: 'score', ...nx });
      if (nx.champ >= 0) setTimeout(() => { r.close(); setRoom(null); }, 2500); // série acabou: desconecta
    }
  };

  // ---------- Loop ----------
  useEffect(() => {
    if (mode !== 'play') return;
    let raf = 0, last = 0, sendAcc = 0;
    const loop = (ts: number) => {
      const dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
      const r = roomRef.current, s = sim.current;
      if (s && (!r || r.isHost)) {
        s.inputs[meRef.current] = { ...inp.current }; inp.current.k = false; inp.current.b = false;
        step(s, dt, sfx);
        if (r) { sendAcc += dt; if (sendAcc > 0.05 || s.over) { sendAcc = 0; r.send({ t: 'st', p: s.ps.map(p => [p.id, +p.x.toFixed(1), +p.y.toFixed(1), Math.round(p.a), p.turbo > 0 ? 1 : 0, p.team]), b: [+s.bx.toFixed(1), +s.by.toFixed(1), s.bOut > 0 ? 1 : 0], sc: s.sc, tm: +s.tm.toFixed(1), ev: s.evT > 0 ? s.ev : '' }); } }
        if (s.over) { r?.send({ t: 'end', sc: s.sc }); finish(s.sc); return; }
      } else if (r) {
        sendAcc += dt; if (sendAcc > 0.05) { sendAcc = 0; r.send({ t: 'in', i: r.me, x: inp.current.x, y: inp.current.y, k: false, b: false }); }
      }
      setTick(t => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  // ---------- Controles (multitoque com pointer events na web) ----------
  const press = (k: 'k' | 'b') => {
    vib(20); const r = roomRef.current;
    if (r && !r.isHost) r.send({ t: 'in', i: r.me, x: inp.current.x, y: inp.current.y, k: k === 'k', b: k === 'b' });
    else inp.current[k] = true;
    setPressed(p => ({ ...p, [k]: true })); setTimeout(() => setPressed(p => ({ ...p, [k]: false })), 150);
  };
  useEffect(() => {
    if (mode !== 'play' || Platform.OS !== 'web') return;
    const el: HTMLElement | null = ctrlRef.current; if (!el) return;
    el.style.touchAction = 'none';
    const hit = (ref: any, e: PointerEvent) => { const n: HTMLElement | null = ref.current; if (!n) return false; const b = n.getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom; };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (hit(kickBtn, e)) return press('k');
      if (hit(turboBtn, e)) return press('b');
      if (!joy.current) { joy.current = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: 0, y: 0 }; vib(8); }
    };
    const move = (e: PointerEvent) => {
      const j = joy.current; if (!j || j.id !== e.pointerId) return; e.preventDefault();
      let dx = e.clientX - j.cx, dy = e.clientY - j.cy; const d = Math.hypot(dx, dy), R = 55;
      if (d > R) { dx *= R / d; dy *= R / d; }
      j.x = dx; j.y = dy; inp.current.x = d > 6 ? dx / R : 0; inp.current.y = d > 6 ? dy / R : 0;
    };
    const up = (e: PointerEvent) => { const j = joy.current; if (j && j.id === e.pointerId) { joy.current = null; inp.current.x = 0; inp.current.y = 0; } };
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    const key = (e: KeyboardEvent, on: boolean) => { // teclado (para testes no computador)
      const m: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (m[e.key]) { const v = m[e.key]; if (v[0]) inp.current.x = on ? v[0] : 0; if (v[1]) inp.current.y = on ? v[1] : 0; }
      if (on && e.key === ' ') press('k'); if (on && e.key === 't') press('b');
    };
    const kd = (e: KeyboardEvent) => key(e, true), ku = (e: KeyboardEvent) => key(e, false);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [mode]);

  // ---------- Modos ----------
  const startSolo = () => { vib(); leave(); resetSeries(); meRef.current = 0; setMyTeam(0); sim.current = newSim([{ id: 0, nick: 'Você' }, { id: 1, nick: 'Robô', ai: true }]); setOnline(false); setMode('play'); };
  useEffect(() => { if (room) setOnline(true); }, [room]);
  const leave = () => { roomRef.current?.close(); setRoom(null); snap.current = { prev: null, next: null, at: 0 }; };
  const backMenu = () => { vib(); leave(); sim.current = null; setMode('menu'); setMsg(''); setCode(''); };

  const hostLobby = (r: Room) => { const ids = r.ids(); const ln = { ids, nicks: { ...nicksRef.current } }; setLobby(ln); r.send({ t: 'lobby', ids, nicks: ln.nicks, map: mapRef.current, cap: 4 }); r.send({ t: 'bo', n: boRef.current }); };
  const handlers = (getR: () => Room | null) => ({
    onMsg: (m: Msg) => {
      const r = getR();
      if (m.t === 'nick') { nicksRef.current[m.i] = m.n; if (r?.isHost) hostLobby(r); else setLobby(l => ({ ...l, nicks: { ...l.nicks, [m.i]: m.n } })); }
      else if (m.t === 'left') { if (m.i >= 0) delete nicksRef.current[m.i]; if (r?.isHost) { hostLobby(r); if (m.i >= 0 && sim.current) sim.current.ps = sim.current.ps.filter(p => p.id !== m.i); } else setLobby(l => ({ ...l, ids: l.ids.filter(i => i !== m.i) })); }
      else if (m.t === 'lobby') { nicksRef.current = { ...m.nicks }; setLobby({ ids: m.ids, nicks: m.nicks }); setMap(m.map as MapId); }
      else if (m.t === 'start') { nicksRef.current = { ...m.nicks }; setMap(m.map as MapId); const idx = m.ids.indexOf(meRef.current); setMyTeam(idx % 2); snap.current = { prev: null, next: null, at: 0 }; setMode('play'); }
      else if (m.t === 'in') { const s = sim.current; if (!s) return; const q = s.inputs[m.i] || { x: 0, y: 0, k: false, b: false }; q.x = m.x; q.y = m.y; if (m.k) q.k = true; if (m.b) q.b = true; s.inputs[m.i] = q; }
      else if (m.t === 'st') {
        const v: View2 = { ps: m.p.map(a => ({ id: a[0], x: a[1], y: a[2], a: a[3], turbo: !!a[4], team: a[5], nick: nicksRef.current[a[0]] || '' })), bx: m.b[0], by: m.b[1], bOut: !!m.b[2], sc: m.sc, tm: m.tm, ev: m.ev || '', evT: m.ev ? 1 : 0 };
        const sn = snap.current; if (sn.next && sn.next.ev !== v.ev && v.ev.startsWith('GOL')) sfx('goal'); sn.prev = sn.next || v; sn.next = v; sn.at = performance.now();
      }
      else if (m.t === 'end') { finish(m.sc); }
      else if (m.t === 'bo') { if ([2, 3, 5].includes(m.n)) { setBo(m.n); boRef.current = m.n; } }
      else if (m.t === 'score') { if (!getR()?.isHost) { applyScore({ w: m.w, champ: m.champ, match: m.match }); if (m.champ >= 0) setTimeout(() => { getR()?.close(); setRoom(null); }, 2500); } }
    },
    onClose: () => { if (joining.current) return; if (serRef.current.champ >= 0) { setRoom(null); return; } setMsg('A sala fechou 😢'); leave(); setMode('menu'); },
  });
  const errText = (e: any) => e === 'full' ? 'Sala cheia ou já começou 🙈' : e === 'timeout' ? 'Demorou demais ⏳ Tente de novo.' : 'Não achei essa sala 🔍 Confira o número!';
  const create = async () => {
    vib(); resetSeries(); setOv('wait');
    try { let rr: Room | null = null; const r = await createRoom(handlers(() => rr)); rr = r; meRef.current = 0; nicksRef.current = { 0: nick }; setRoom(r); hostLobby(r); setMsg(''); setMode('lobby'); }
    catch (e) { setOv('choose'); setMsg('Não deu para criar a sala 😢 Tente de novo.'); }
  };
  const joining = useRef(false);
  const join = async () => {
    if (code.length !== 4) return; vib(); resetSeries(); setOv('wait'); setMsg('');
    let err: any = null; joining.current = true;
    for (let t = 0; t < 3; t++) { // a sala pode demorar um pouquinho para aparecer: tenta 3 vezes
      try { let rr: Room | null = null; const r = await joinRoom(code, handlers(() => rr)); rr = r; meRef.current = r.me; setRoom(r); r.send({ t: 'nick', i: r.me, n: nick }); joining.current = false; setMode('lobby'); return; }
      catch (e) { err = e; if (e === 'full') break; await new Promise(z => setTimeout(z, 1500)); }
    }
    joining.current = false; setOv('join'); setCode(''); setMsg(errText(err));
  };
  const hostStart = () => {
    const r = roomRef.current; if (!r || r.ids().length < 2 || serRef.current.champ >= 0) return; vib(); r.lock();
    const ids = r.ids(); sim.current = newSim(ids.map(i => ({ id: i, nick: nicksRef.current[i] || '?' }))); setMyTeam(0);
    const nx = { ...serRef.current, match: serRef.current.match + 1 }; applyScore(nx); r.send({ t: 'score', ...nx });
    r.send({ t: 'start', map, ids, nicks: nicksRef.current }); setMode('play');
  };
  const playAgain = () => { vib(); leave(); resetSeries(); sim.current = null; setCode(''); setMsg(''); setOv('choose'); setMode('nick'); };

  // ---------- Desenho ----------
  const M = MAPS[map];
  const onl = !!room || (mode === 'end' && online);
  const top = room ? 96 : 74, ctrlH = 190;
  const sc = Math.min((width - 24) / FW, (height - top - ctrlH - 16) / FH);
  const fw = FW * sc, fh = FH * sc, ox = (width - fw) / 2;

  const Bg = () => (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {STARS.map((s, i) => <View key={i} style={{ position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, borderRadius: 2, backgroundColor: '#fff', opacity: map === 'estrelas' ? 0.5 + (s.p % 3) * 0.25 : 0.4 }} />)}
      {map === 'saturno' ? <View style={{ position: 'absolute', right: -60, top: 60, width: 220, height: 220, alignItems: 'center', justifyContent: 'center', opacity: 0.85 }}>
        <View style={{ width: 150, height: 150, borderRadius: 75, backgroundColor: '#E9C46A', borderWidth: 10, borderColor: '#F4A261' }} />
        <View style={{ position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 14, borderColor: 'rgba(255,214,165,0.8)', transform: [{ rotate: '-20deg' }, { scaleY: 0.28 }] }} />
      </View> : <>
        <Text style={{ position: 'absolute', left: 20, top: 90, fontSize: 40, opacity: 0.8 }}>🌟</Text>
        <Text style={{ position: 'absolute', right: 24, bottom: 260, fontSize: 30, opacity: 0.8 }}>⭐</Text>
        <Text style={{ position: 'absolute', right: 40, top: 150, fontSize: 26, opacity: 0.6 }}>✨</Text>
      </>}
    </View>
  );
  const MapPick = ({ can, card }: { can: boolean; card?: boolean }) => <View style={st.row}>{(Object.keys(MAPS) as MapId[]).map(k => <Pressable key={k} testID={'map-' + k} onPress={() => { if (!can) return; vib(); setMap(k); mapRef.current = k; if (roomRef.current?.isHost) hostLobby(roomRef.current); }} style={[st.mapBtn, card && { backgroundColor: '#E9ECEF' }, map === k && st.mapOn, !can && map !== k && { opacity: 0.4 }]}><Text style={{ fontSize: 36 }}>{MAPS[k].emoji}</Text><Text style={[st.btnTxt, card && { color: '#023047' }]}>{MAPS[k].name}</Text></Pressable>)}</View>;
  const SeriesBar = () => <View style={st.serBar}><Text style={st.serTxt}>🏆 Série até {bo}</Text><Text style={[st.serTxt, { color: TEAM[0].col }]}>Azul {'⭐'.repeat(ser.w[0]) || '–'}</Text><Text style={[st.serTxt, { color: TEAM[1].col }]}>Laranja {'⭐'.repeat(ser.w[1]) || '–'}</Text></View>;

  if (mode === 'menu') return (
    <View style={[st.root, { backgroundColor: M.bg }]}>
      <Bg />
      <ScrollView contentContainerStyle={st.menu}>
        <Text style={st.big}>🚀⚽🚀</Text>
        <Text style={st.title}>Futebol Espacial</Text>
        <Text style={st.sub}>Os foguetinhos jogam bola no espaço!</Text>
        <Text style={st.label}>Escolha o mapa</Text>
        <MapPick can />
        <Pressable onPress={startSolo} style={[st.btn, { backgroundColor: '#06D6A0' }]}><Text style={st.btnTxt}>🤖 Contra o computador</Text></Pressable>
        <Pressable onPress={() => { vib(); setOv('choose'); setMsg(''); setMode('nick'); }} style={[st.btn, { backgroundColor: '#8338EC' }]}><Text style={st.btnTxt}>👥 Online</Text></Pressable>
        <Text style={st.help}>Arraste o dedo à esquerda para voar. ⚽ chuta, 🔥 dá turbo. Faça {GOALS_TO_WIN} gols para ganhar!</Text>
        {!!msg && <Text style={st.msg}>{msg}</Text>}
      </ScrollView>
    </View>
  );

  if (mode === 'nick') return (
    <View style={[st.root, { backgroundColor: M.bg }]}><Bg />
      <ScrollView contentContainerStyle={st.menu}>
        <View style={st.card}>
          <Text style={st.cardTitle}>Jogo online 👥</Text>
          {!onlineAvailable() ? <Text style={st.cardSub}>O online funciona no navegador 🌐</Text>
          : ov === 'wait' ? <Text style={st.cardSub}>Conectando... ⏳</Text>
          : ov === 'choose' ? <>
            <Text style={st.cardSub}>Escolha seu apelido:</Text>
            <View style={[st.row, { flexWrap: 'wrap' }]}>{NICKS.map(n => <Pressable key={n} onPress={() => { vib(8); setNick(n); }} style={[st.chip, nick === n && st.chipOn]}><Text style={[st.chipTxt, nick === n && { color: '#fff' }]}>{n}</Text></Pressable>)}</View>
            <Pressable onPress={create} style={[st.btn, { backgroundColor: '#FB8500' }]}><Text style={st.btnTxt}>➕ Criar sala</Text></Pressable>
            <Pressable onPress={() => { vib(); setCode(''); setMsg(''); setOv('join'); }} style={[st.btn, { backgroundColor: '#219EBC' }]}><Text style={st.btnTxt}>🔢 Entrar</Text></Pressable>
          </> : <>
            <Text style={st.cardSub}>Digite o número da sala:</Text>
            <Text style={st.codeDark}>{(code + '____').slice(0, 4).split('').join(' ')}</Text>
            <View style={st.pad}>{['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✔'].map(d => <Pressable key={d} onPress={() => { vib(8); if (d === '⌫') setCode(c => c.slice(0, -1)); else if (d === '✔') join(); else setCode(c => (c + d).slice(0, 4)); }} style={[st.key, d === '✔' && { backgroundColor: code.length === 4 ? '#06D6A0' : '#ADB5BD' }]}><Text style={st.keyTxt}>{d}</Text></Pressable>)}</View>
          </>}
          {!!msg && <Text style={st.msgDark}>{msg}</Text>}
          <Pressable onPress={() => { vib(); if (ov === 'join') { setOv('choose'); setMsg(''); } else backMenu(); }} style={[st.btn, { backgroundColor: '#ADB5BD' }]}><Text style={st.btnTxt}>← Voltar</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  );

  if (mode === 'lobby') { const host = !!room?.isHost; return (
    <View style={[st.root, { backgroundColor: M.bg }]}><Bg />
      <ScrollView contentContainerStyle={st.menu}>
        <View style={st.card}>
          <Text style={st.cardTitle}>Futebol online 👥</Text>
          <Text style={st.cardSub}>Número da sala:</Text>
          <Text style={st.bigCode}>{room?.code.split('').join(' ')}</Text>
          <View style={st.row}>{[0, 1, 2, 3].map(k => { const i = lobby.ids[k]; const has = i !== undefined; return (
            <View key={k} style={{ alignItems: 'center', width: 76 }}>
              <View style={[st.slot, has && { backgroundColor: TEAM[k % 2].col, borderColor: TEAM[k % 2].dark }]}><Text style={{ fontSize: 22 }}>{has ? '🚀' : ''}</Text></View>
              <Text style={st.slotTxt} numberOfLines={2}>{has ? `${lobby.nicks[i] || '...'}${i === room?.me ? '\n(você)' : ''}` : '–'}</Text>
            </View>); })}</View>
          <Text style={st.cardSub}>{lobby.ids.length}/4 na sala</Text>
          <Text style={st.cardLabel}>🏆 Série: quem ganhar primeiro</Text>
          <View style={st.row}>{[2, 3, 5].map(n => <Pressable key={n} testID={'bo-' + n} onPress={() => { if (!host) return; vib(8); setBo(n); boRef.current = n; roomRef.current?.send({ t: 'bo', n }); }} style={[st.chip, { paddingHorizontal: 16 }, bo === n && st.chipOn, !host && bo !== n && { opacity: 0.4 }]}><Text style={[st.chipTxt, { fontSize: 17 }, bo === n && { color: '#fff' }]}>{n} vitórias</Text></Pressable>)}</View>
          <Text style={st.cardLabel}>Mapa</Text>
          <MapPick can={host} card />
          {host ? <Pressable onPress={hostStart} style={[st.btn, { backgroundColor: lobby.ids.length >= 2 ? '#06D6A0' : '#A8E6CF' }]}><Text style={st.btnTxt}>{lobby.ids.length >= 2 ? '▶ Começar!' : 'Esperando...'}</Text></Pressable>
            : <Text style={st.cardSub}>Esperando o dono da sala começar... ⏳</Text>}
          <Pressable onPress={backMenu} style={[st.btn, { backgroundColor: '#ADB5BD' }]}><Text style={st.btnTxt}>← Voltar</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  ); }

  if (mode === 'end') {
    const win = result[myTeam] > result[1 - myTeam], tie = result[0] === result[1];
    const champ = ser.champ;
    const rank = online ? lobby.ids.map((i, k) => ({ i, team: k % 2, nick: lobby.nicks[i] || '?' })).sort((a, b) => ser.w[b.team] - ser.w[a.team]) : [];
    return (
      <View style={[st.root, { backgroundColor: M.bg }]}><Bg />
        {(online ? champ === myTeam : win) && <Confetti />}
        <ScrollView contentContainerStyle={st.menu}>
          <Text style={st.big}>{online && champ >= 0 ? '👑' : tie ? '🤝' : win ? '🏆' : '⭐'}</Text>
          <Text style={st.title}>{online && champ >= 0 ? `Time ${TEAM[champ].name} é campeão!` : tie ? 'Empate!' : win ? 'Você ganhou!' : `Time ${TEAM[result[0] > result[1] ? 0 : 1].name} ganhou!`}</Text>
          <View style={st.row}><View style={[st.scoreBox, { backgroundColor: TEAM[0].dark }]}><Text style={st.score}>{result[0]}</Text><Text style={st.chipTxt2}>Azul</Text></View>
            <Text style={st.score}>x</Text><View style={[st.scoreBox, { backgroundColor: TEAM[1].dark }]}><Text style={st.score}>{result[1]}</Text><Text style={st.chipTxt2}>Laranja</Text></View></View>
          {online && <>
            <SeriesBar />
            <View style={st.card}>
              <Text style={st.cardLabel}>🏅 Ranking (partida {ser.match})</Text>
              {rank.map((p, k) => <View key={p.i} style={st.rankRow}><Text style={st.rankTxt}>{champ === p.team ? '👑' : `${k + 1}º`} 🚀 {p.nick}{p.i === meRef.current ? ' (você)' : ''}</Text><Text style={[st.rankTxt, { color: TEAM[p.team].dark }]}>{'⭐'.repeat(ser.w[p.team]) || '–'}</Text></View>)}
            </View>
            {champ < 0 ? (room?.isHost ? <Pressable testID="next-match" onPress={hostStart} style={[st.btn, { backgroundColor: '#06D6A0' }]}><Text style={st.btnTxt}>▶ Próxima partida</Text></Pressable>
              : room ? <Text style={st.sub}>Esperando a próxima partida... ⏳</Text> : null)
              : <><Text style={st.sub}>A série acabou! Para jogar de novo, entre na sala outra vez.</Text>
                <Pressable onPress={playAgain} style={[st.btn, { backgroundColor: '#8338EC' }]}><Text style={st.btnTxt}>🔁 Jogar de novo</Text></Pressable></>}
          </>}
          {!win && !tie && !online && <Text style={st.sub}>Foi muito legal! Vamos de novo? 💪</Text>}
          <Pressable onPress={backMenu} style={[st.btn, { backgroundColor: online ? '#555' : '#06D6A0' }]}><Text style={st.btnTxt}>🏠 Voltar ao início</Text></Pressable>
        </ScrollView>
      </View>
    );
  }
  // play
  let v: View2 | null = null;
  if (room && !room.isHost) { const sn = snap.current; if (sn.next && sn.prev) { const t = Math.min(1, (performance.now() - sn.at) / 55), L = (a: number, b: number) => a + (b - a) * t;
    v = { ...sn.next, bx: L(sn.prev.bx, sn.next.bx), by: L(sn.prev.by, sn.next.by), ps: sn.next.ps.map(p => { const q = sn.prev!.ps.find(z => z.id === p.id) || p; return { ...p, x: L(q.x, p.x), y: L(q.y, p.y) }; }) }; } }
  else if (sim.current) v = toView(sim.current);
  const X = (x: number) => ox + x * sc, Y = (y: number) => top + y * sc;
  const j = joy.current;
  return (
    <View style={[st.root, { backgroundColor: M.bg }]}>
      <Bg />
      <View style={st.hud}>
        <Pressable onPress={backMenu} style={st.exit}><Text style={st.chipTxt2}>✖</Text></Pressable>
        <View style={[st.hudScore, { backgroundColor: TEAM[0].dark }]}><Text style={st.hudTxt}>🔵 {v?.sc[0] ?? 0}</Text></View>
        <Text style={st.hudTxt}>⏱ {Math.floor((v?.tm ?? 0) / 60)}:{String(Math.floor((v?.tm ?? 0) % 60)).padStart(2, '0')}</Text>
        <View style={[st.hudScore, { backgroundColor: TEAM[1].dark }]}><Text style={st.hudTxt}>🟠 {v?.sc[1] ?? 0}</Text></View>
      </View>
      {/* campo */}
      <View style={{ position: 'absolute', left: ox, top, width: fw, height: fh, backgroundColor: M.field, borderTopWidth: 3, borderBottomWidth: 3, borderColor: 'rgba(255,255,255,0.7)', borderLeftWidth: 2, borderRightWidth: 2, borderStyle: 'dashed' }} pointerEvents="none">
        <View style={{ position: 'absolute', top: fh / 2 - 1, left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.5)' }} />
        <View style={{ position: 'absolute', top: fh / 2 - 15 * sc, left: fw / 2 - 15 * sc, width: 30 * sc, height: 30 * sc, borderRadius: 15 * sc, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' }} />
      </View>
      {/* gols: em cima é do Laranja (Azul ataca pra cima), embaixo do Azul */}
      <View style={{ position: 'absolute', left: X(GL), top: Y(-5), width: (GR - GL) * sc, height: 5 * sc + 3, backgroundColor: TEAM[1].col, opacity: 0.85, borderRadius: 4 }} />
      <View style={{ position: 'absolute', left: X(GL), top: Y(FH) - 3, width: (GR - GL) * sc, height: 5 * sc + 3, backgroundColor: TEAM[0].col, opacity: 0.85, borderRadius: 4 }} />
      <Text style={{ position: 'absolute', left: X(FW / 2) - 12, top: Y(-5) - 4, fontSize: 18 }}>🥅</Text>
      <Text style={{ position: 'absolute', left: X(FW / 2) - 12, top: Y(FH) - 2, fontSize: 18 }}>🥅</Text>
      <View style={[st.goalTag, { top: Y(0) + 4, left: X(GL), width: (GR - GL) * sc }]} pointerEvents="none"><Text style={st.goalTxt}>{myTeam === 0 ? '⬆ Chute aqui! ⚽' : '🛡️ Seu gol ⬆'}</Text></View>
      <View style={[st.goalTag, { top: Y(FH) - 26, left: X(GL), width: (GR - GL) * sc }]} pointerEvents="none"><Text style={st.goalTxt}>{myTeam === 0 ? '🛡️ Seu gol ⬇' : '⬇ Chute aqui! ⚽'}</Text></View>
      {room && <View style={{ position: 'absolute', top: 50, left: 0, right: 0, alignItems: 'center' }}><SeriesBar /></View>}
      {v?.ps.map(p => { const me = p.id === meRef.current; return (
        <View key={p.id} style={{ position: 'absolute', left: X(p.x) - PR * sc, top: Y(p.y) - PR * sc, width: PR * 2 * sc, height: PR * 2 * sc, borderRadius: PR * sc, backgroundColor: TEAM[p.team].col + '55', borderWidth: me ? 3 : 2, borderColor: me ? '#fff' : TEAM[p.team].col, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <Text style={{ fontSize: PR * 1.5 * sc, transform: [{ rotate: `${p.a + 45}deg` }] }}>🚀</Text>
          {p.turbo && <Text style={{ position: 'absolute', fontSize: 14, top: -8, right: -6 }}>🔥</Text>}
          <Text numberOfLines={1} style={st.tag}>{me ? 'Você' : p.nick}</Text>
        </View>); })}
      {v && !v.bOut && <Text style={{ position: 'absolute', left: X(v.bx) - BR * sc * 1.15, top: Y(v.by) - BR * sc * 1.35, fontSize: BR * 2 * sc }} pointerEvents="none">⚽</Text>}
      {v && v.evT > 0 && !!v.ev && <View style={st.ev} pointerEvents="none"><Text style={st.evTxt}>{v.ev}</Text></View>}
      {/* controles */}
      <View ref={ctrlRef} style={[st.ctrl, { height: ctrlH }]}>
        <View style={st.joyZone}>
          <Text style={st.joyHint}>{j ? '' : '👆 Arraste\npara voar'}</Text>
          {j && <View style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -60, marginTop: -60, width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)' }}>
            <View style={{ position: 'absolute', left: 60 - 26 + j.x * 0.6, top: 60 - 26 + j.y * 0.6, width: 52, height: 52, borderRadius: 26, backgroundColor: TEAM[myTeam].col }} /></View>}
        </View>
        <View style={{ gap: 10, justifyContent: 'center' }}>
          <View ref={kickBtn} style={[st.act, { backgroundColor: pressed.k ? '#fff' : '#FF006E' }]}><Text style={st.actTxt}>⚽</Text><Text style={st.chipTxt2}>Chutar</Text></View>
          <View ref={turboBtn} style={[st.act, { width: 90, height: 64, backgroundColor: pressed.b ? '#fff' : '#FB8500' }]}><Text style={{ fontSize: 26 }}>🔥</Text></View>
        </View>
      </View>
    </View>
  );
}

function Confetti() {
  const [t, setT] = useState(0);
  useEffect(() => { let r = 0; const f = () => { setT(x => x + 1); r = requestAnimationFrame(f); }; r = requestAnimationFrame(f); return () => cancelAnimationFrame(r); }, []);
  const cols = ['#FF006E', '#FFBE0B', '#3A86FF', '#06D6A0', '#FB5607', '#fff'];
  return <View style={StyleSheet.absoluteFill} pointerEvents="none">{Array.from({ length: 50 }, (_, i) => <View key={i} style={{ position: 'absolute', left: `${(i * 23.7) % 100}%`, top: ((t * (2 + (i % 4)) + i * 47) % 1100) - 50, width: 10, height: 14, backgroundColor: cols[i % 6], transform: [{ rotate: `${t * 5 + i * 30}deg` }] }} />)}</View>;
}

const st = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', userSelect: 'none' as any },
  menu: { alignItems: 'center', padding: 20, gap: 12, paddingTop: 40, flexGrow: 1 },
  big: { fontSize: 56 }, title: { fontSize: 34, fontWeight: '900', color: '#fff', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 26, padding: 18, width: '100%', maxWidth: 440, alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 28, fontWeight: '900', color: '#FB5607', textAlign: 'center' }, cardSub: { fontSize: 19, color: '#023047', textAlign: 'center' },
  cardLabel: { fontSize: 18, fontWeight: '900', color: '#023047', textAlign: 'center' },
  bigCode: { fontSize: 58, fontWeight: '900', color: '#023047', letterSpacing: 6 }, codeDark: { fontSize: 42, fontWeight: '900', color: '#023047', letterSpacing: 4 },
  slot: { width: 50, height: 50, borderRadius: 12, borderWidth: 3, borderColor: '#023047', backgroundColor: '#E9ECEF', alignItems: 'center', justifyContent: 'center' },
  slotTxt: { fontSize: 13, fontWeight: '800', color: '#023047', textAlign: 'center', marginTop: 4 },
  keyTxt: { fontSize: 24, fontWeight: '900', color: '#023047' }, msgDark: { color: '#D00000', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  serBar: { flexDirection: 'row', gap: 12, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14, alignItems: 'center' }, serTxt: { color: '#fff', fontSize: 15, fontWeight: '900' },
  rankRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 4 }, rankTxt: { fontSize: 19, fontWeight: '800', color: '#023047' },
  chipTxt2: { color: '#fff', fontSize: 15, fontWeight: '800' },
  goalTag: { position: 'absolute', alignItems: 'center' }, goalTxt: { color: '#fff', fontSize: 14, fontWeight: '900', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  sub: { fontSize: 18, color: '#FFE8A3', textAlign: 'center', fontWeight: '700' },
  label: { fontSize: 18, color: '#fff', fontWeight: '800', marginTop: 6 },
  row: { flexDirection: 'row', gap: 12, justifyContent: 'center', alignItems: 'center' },
  mapBtn: { width: 140, height: 110, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'transparent' },
  mapOn: { borderColor: '#FFBE0B', backgroundColor: 'rgba(255,190,11,0.25)' },
  btn: { width: 300, maxWidth: '100%', height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { color: '#fff', fontSize: 22, fontWeight: '900' },
  help: { color: '#ddd', fontSize: 16, textAlign: 'center', maxWidth: 340 },
  msg: { color: '#FFBE0B', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: '#E9ECEF', margin: 3 },
  chipOn: { backgroundColor: '#FB8500' }, chipTxt: { color: '#023047', fontSize: 15, fontWeight: '800' },
  code: { fontSize: 40, color: '#fff', fontWeight: '900', letterSpacing: 4 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 260, gap: 8, justifyContent: 'center' },
  key: { width: 76, height: 56, borderRadius: 14, backgroundColor: '#E9ECEF', alignItems: 'center', justifyContent: 'center' },
  player: { width: 300, borderRadius: 16, padding: 12, alignItems: 'center' },
  scoreBox: { width: 100, height: 100, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, score: { color: '#fff', fontSize: 44, fontWeight: '900' },
  hud: { position: 'absolute', top: 6, left: 0, right: 0, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  hudScore: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 14 }, hudTxt: { color: '#fff', fontSize: 22, fontWeight: '900' },
  exit: { position: 'absolute', left: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', bottom: -18, color: '#fff', fontSize: 11, fontWeight: '800', width: 80, textAlign: 'center' },
  ev: { position: 'absolute', top: '35%', left: 0, right: 0, alignItems: 'center' },
  evTxt: { fontSize: 34, fontWeight: '900', color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, overflow: 'hidden' },
  ctrl: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', padding: 10, gap: 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  joyZone: { flex: 1, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  joyHint: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', opacity: 0.8 },
  act: { width: 120, height: 96, borderRadius: 26, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, actTxt: { fontSize: 40 },
});
