import { describe, it, expect } from 'vitest';
import {
  DIFFICULTIES,
  generateLevel,
  getPorts,
  rotateTile,
  traceFlow,
} from '../src/engine.js';

function createSeededRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Pipe Garden engine', () => {
  it('computes rotated ports accurately for all pipe types', () => {
    expect(getPorts('straight', 0)).toEqual([0, 2]);
    expect(getPorts('straight', 1)).toEqual([1, 3]);
    expect(getPorts('curve', 0)).toEqual([0, 1]);
    expect(getPorts('curve', 1)).toEqual([1, 2]);
    expect(getPorts('curve', 2)).toEqual([2, 3]);
    expect(getPorts('curve', 3)).toEqual([0, 3]);
    expect(getPorts('tee', 1)).toEqual([1, 2, 3]);
    expect(getPorts('cross', 2)).toEqual([0, 1, 2, 3]);
    expect(getPorts('faucet', 0)).toEqual([1]);
    expect(getPorts('pond', 0)).toEqual([3]);
  });

  it('generates guaranteed-solvable levels for every difficulty size', () => {
    for (const diff of DIFFICULTIES) {
      const rng = createSeededRng(diff.size * 137);
      const level = generateLevel(diff.id, rng);
      expect(level.size).toBe(diff.size);
      expect(level.grid).toHaveLength(diff.size);
      expect(level.grid[0]).toHaveLength(diff.size);

      // Should never start pre-solved
      expect(traceFlow(level).reachedGoal).toBe(false);

      // Rotating solution tiles back to solutionRotation must solve the puzzle
      for (const pos of level.solutionPath) {
        const tile = level.grid[pos.r][pos.c];
        tile.rotation = tile.solutionRotation;
      }
      const solved = traceFlow(level);
      expect(solved.reachedGoal).toBe(true);
      expect(solved.waves.length).toBeGreaterThan(2);
    }
  });

  it('prevents rotating locked faucet and pond tiles', () => {
    const level = generateLevel('sprout', createSeededRng(7));
    expect(rotateTile(level, level.start.r, level.start.c)).toBe(false);
    expect(rotateTile(level, level.goal.r, level.goal.c)).toBe(false);

    const mid = level.solutionPath[1];
    const before = level.grid[mid.r][mid.c].rotation;
    expect(rotateTile(level, mid.r, mid.c)).toBe(true);
    expect(level.grid[mid.r][mid.c].rotation).toBe((before + 1) % 4);
  });

  it('detects leaks when water hits an unconnected end', () => {
    const level = generateLevel('sprout', createSeededRng(99));
    // Force the tile right next to the faucet to disconnect
    const nextToFaucet = level.grid[level.start.r][1];
    nextToFaucet.type = 'straight';
    nextToFaucet.rotation = 0; // North-South, does not accept East from faucet
    const flow = traceFlow(level);
    expect(flow.reachedGoal).toBe(false);
    expect(flow.leaks.length).toBeGreaterThan(0);
  });
});
