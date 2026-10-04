export type Bounds = { left: number; right: number };
export function visibleRange(items: Bounds[], width: number): number[] {
  return items.flatMap((r, i) => r.left >= -.75 && r.right <= width + .75 ? [i] : []);
}
export function residentSet(visible: number[], count: number, pinned: number | null): Set<number> {
  const set = new Set(visible);
  if (visible.length) {
    const first = Math.min(...visible), last = Math.max(...visible);
    if (first > 0) set.add(first - 1);
    if (last + 1 < count) set.add(last + 1);
  }
  if (pinned !== null && pinned >= 0 && pinned < count) set.add(pinned);
  return set;
}
export function stepPosition(current: number, starts: number[], max: number, direction: number): number {
  const positions = [...new Set([...starts.map(x => Math.min(x, max)), max])].sort((a, b) => a-b);
  return direction > 0 ? positions.find(x => x > current + 1) ?? max : positions.findLast(x => x < current - 1) ?? 0;
}
export function gameCount(n: number): string {
  const tail = n % 100;
  return `${n} ${tail >= 11 && tail <= 14 ? 'игр' : n%10 === 1 ? 'игра' : n%10 >= 2 && n%10 <= 4 ? 'игры' : 'игр'}`;
}
