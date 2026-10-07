// Local synthesized cues. A user gesture owns activation; simulation never does.
export function createAudio() {
  type Voice = { oscillator: OscillatorNode; gain: GainNode };
  let context: AudioContext | null = null;
  let enabled = true, volume = 0.35, disposed = false, unlocked = false;
  let started = 0, limited = 0;
  const voices = new Set<Voice>(), starts: number[] = [];
  const lastFamily = new Map<string, number>(), families = new Map<string, number>();
  const clearVoices = () => {
    for (const voice of voices) { voice.oscillator.onended = null; try { voice.oscillator.stop(); } catch { /* Already ended. */ } voice.oscillator.disconnect(); voice.gain.disconnect(); }
    voices.clear();
  };
  const familyOf = (effect: string) => effect.includes('aegis') ? 'aegis' : effect.includes('expedition_return') ? 'return' : effect.includes('expedition') ? 'depart' : effect.includes('reward') || effect.includes('item_equipped') ? 'reward' : effect.includes('detection') ? 'reveal' : effect.includes('teleport') ? 'teleport' : effect.includes('hook') ? 'hook' : effect.includes('steal') || effect.includes('captured') ? 'steal' : effect.includes('shield') ? 'shield' : effect.includes('heal') ? 'heal' : effect.includes('sniper') ? 'sniper' : effect.includes('tombstone') || effect.includes('zombie') ? 'grave' : effect.includes('snake') ? 'snake' : effect.includes('build') || effect === 'construction' ? 'build' : effect.includes('enhancement') ? 'enhance' : 'hit';
  return {
    async unlock() {
      if (disposed || !enabled || volume === 0) return false;
      // Never create/resume from a tick, visibility callback or asynchronous timer.
      if (navigator.userActivation && !navigator.userActivation.isActive) return context?.state === 'running';
      try { context ??= new AudioContext(); if (context.state === 'suspended') await context.resume(); unlocked = context.state === 'running'; return unlocked; }
      catch { return false; }
    },
    settings(soundEnabled: boolean, value: number) { enabled = soundEnabled; volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; if (!enabled || volume === 0) clearVoices(); },
    cue(effect: string) {
      if (disposed || !enabled || volume === 0 || !context || context.state !== 'running') return;
      const now = context.currentTime, family = familyOf(effect);
      while (starts.length && starts[0]! < now - 1) starts.shift();
      if (voices.size >= 8 || starts.length >= 24 || now - (lastFamily.get(family) ?? -1) < 0.055) { limited++; return; }
      lastFamily.set(family, now); families.set(family, (families.get(family) ?? 0) + 1);
      const frequency: Record<string, number> = { aegis: 220, return: 620, depart: 660, reward: 880, reveal: 990, teleport: 650, hook: 120, steal: 810, shield: 520, heal: 710, sniper: 90, grave: 145, snake: 410, build: 280, enhance: 330, hit: 180 };
      const notes = family === 'return' || family === 'reward' ? [1, 1.25, 1.5] : family === 'aegis' ? [1, 2] : [1];
      notes.forEach((ratio, index) => {
        if (voices.size >= 8 || starts.length >= 24) { limited++; return; }
        const ctx = context!, oscillator = ctx.createOscillator(), gain = ctx.createGain(), at = now + index * 0.07;
        const duration = family === 'aegis' ? 0.48 : family === 'depart' ? 0.30 : 0.19;
        oscillator.type = family === 'hook' ? 'sawtooth' : family === 'sniper' ? 'triangle' : 'sine';
        const base = frequency[family]! * ratio;
        oscillator.frequency.setValueAtTime(base, at);
        oscillator.frequency.exponentialRampToValueAtTime(base * (family === 'depart' ? 0.45 : family === 'sniper' ? 0.45 : family === 'aegis' ? 3 : 1.35), at + duration * 0.8);
        gain.gain.setValueAtTime(0.001, at); gain.gain.linearRampToValueAtTime(volume * 0.055, at + 0.012); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
        oscillator.connect(gain); gain.connect(ctx.destination);
        const voice = { oscillator, gain }; voices.add(voice); starts.push(now); started++;
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices.delete(voice); };
        oscillator.start(at); oscillator.stop(at + duration + 0.02);
      });
    },
    async suspend() { clearVoices(); if (context?.state === 'running') await context.suspend().catch(() => {}); },
    getDiagnostics() { return { contextState: context?.state ?? 'uninitialized', enabled, volume, activeVoices: voices.size, voiceLimit: 8, startsPerSecondLimit: 24, started, limited, families: Object.fromEntries(families), unlocked, disposed }; },
    dispose() { if (disposed) return; disposed = true; clearVoices(); if (context) { void context.close().catch(() => {}); context = null; } starts.length = 0; lastFamily.clear(); },
  };
}
