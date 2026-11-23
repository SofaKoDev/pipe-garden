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

function makeCustomLevel(rows) {
  const size = rows.length;
  let start = null;
  let goal = null;
  const grid = rows.map((row, r) =>
    row.map(([type, rotation = 0], c) => {
      if (type === 'faucet') start = { r, c };
      if (type === 'pond') goal = { r, c };
      return {
        r,
        c,
        type,
        rotation,
        visualRotation: rotation,
        solutionRotation: rotation,
        locked: type === 'faucet' || type === 'pond',
        onSolution: false,
      };
    }),
  );
  return { size, grid, start, goal };
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

  it('generates guaranteed-solvable, non-pre-solved levels across 250 seeds per difficulty', () => {
    for (const diff of DIFFICULTIES) {
      for (let seed = 1; seed <= 250; seed += 1) {
        const rng = createSeededRng(diff.size * 10000 + seed);
        const level = generateLevel(diff.id, rng);

        expect(level.size).toBe(diff.size);
        expect(level.grid).toHaveLength(diff.size);
        expect(level.grid[0]).toHaveLength(diff.size);
        expect(level.solutionPath.length).toBeGreaterThanOrEqual(diff.minPath);

        // Must never start pre-solved (including via decoy shortcuts)
        expect(traceFlow(level).reachedGoal).toBe(false);

        // Restoring solution rotations must solve the puzzle with zero leaks
        for (const pos of level.solutionPath) {
          const tile = level.grid[pos.r][pos.c];
          tile.rotation = tile.solutionRotation;
        }
        const solved = traceFlow(level);
        expect(solved.reachedGoal).toBe(true);
        expect(solved.leaks).toHaveLength(0);
      }
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
    const nextToFaucet = level.grid[level.start.r][1];
    nextToFaucet.type = 'straight';
    nextToFaucet.rotation = 0; // North-South, does not accept East from faucet
    const flow = traceFlow(level);
    expect(flow.reachedGoal).toBe(false);
    expect(flow.leaks.length).toBeGreaterThan(0);
  });

  it('handles closed pipe loops without infinite recursion or false leaks', () => {
    // Faucet -> (0,1) tee [E,S,W] -> (0,2) curve [S,W] -> (1,2) curve [N,W] -> (1,1) curve [N,E] -> back to (0,1)
    const level = makeCustomLevel([
      [['faucet', 0], ['tee', 1], ['curve', 2], ['pond', 0]],
      [['straight', 0], ['curve', 0], ['curve', 3], ['straight', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
    ]);

    const flow = traceFlow(level);
    expect(flow.reachedGoal).toBe(false);
    expect(flow.leaks).toHaveLength(0);
    expect(flow.connectedKeys.size).toBe(5);
  });

  it('detects board-edge leaks when a connected pipe opens off the grid', () => {
    // Faucet at (0,0) -> curve [N,W] at (0,1) opens North off top board edge (dir 0)
    const level = makeCustomLevel([
      [['faucet', 0], ['curve', 3], ['straight', 1], ['pond', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
    ]);

    const flow = traceFlow(level);
    expect(flow.reachedGoal).toBe(false);
    expect(flow.leaks).toContainEqual({ r: 0, c: 1, dir: 0 });
  });

  it('reports branching tee leaks even when water also reaches the pond', () => {
    // Row 0: faucet -> tee [E,S,W] -> straight [E,W] -> pond
    // South branch of tee at (0,1) points into (1,1) horizontal straight [E,W] -> leak at (0,1) dir 2
    const level = makeCustomLevel([
      [['faucet', 0], ['tee', 1], ['straight', 1], ['pond', 0]],
      [['straight', 0], ['straight', 1], ['straight', 0], ['straight', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
      [['straight', 0], ['straight', 0], ['straight', 0], ['straight', 0]],
    ]);

    const flow = traceFlow(level);
    expect(flow.reachedGoal).toBe(true);
    expect(flow.leaks).toContainEqual({ r: 0, c: 1, dir: 2 });
  });
});
