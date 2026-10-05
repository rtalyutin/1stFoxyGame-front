// Small synthesized cues: no remote assets or autoplay dependency.
export function createAudio() {
  let context: AudioContext | null = null;
  let enabled = true, volume = 0.35;
  return {
    async unlock() { if (!context) context = new AudioContext(); if (context.state === 'suspended') await context.resume(); },
    settings(soundEnabled: boolean, value: number) { enabled = soundEnabled; volume = Math.max(0, Math.min(1, value)); },
    cue(effect: string) {
      if (!enabled || !context || context.state !== 'running') return;
      const oscillator = context.createOscillator(), gain = context.createGain();
      const frequency = effect.includes('teleport') ? 650 : effect.includes('hook') ? 120 : effect.includes('steal') ? 810 : effect.includes('shield') ? 520 : effect.includes('heal') ? 710 : effect.includes('sniper') ? 90 : effect.includes('tombstone') ? 145 : effect.includes('snake') ? 410 : effect.includes('build') ? 280 : 180;
      oscillator.type = effect.includes('hook') ? 'sawtooth' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.8, context.currentTime + 0.13);
      gain.gain.setValueAtTime(volume * 0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.19);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    },
    dispose() { if (context) { void context.close(); context = null; } },
  };
}
