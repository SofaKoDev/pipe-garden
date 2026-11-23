export const DIRS = [
  { dr: -1, dc: 0 }, // 0: North
  { dr: 0, dc: 1 },  // 1: East
  { dr: 1, dc: 0 },  // 2: South
  { dr: 0, dc: -1 }, // 3: West
];

export const BASE_PORTS = {
  faucet: [1],
  pond: [3],
  straight: [0, 2],
  curve: [0, 1],
  tee: [0, 1, 2],
  cross: [0, 1, 2, 3],
};

export const DIFFICULTIES = [
  { id: 'sprout', label: 'Sprout', size: 4, minPath: 6, timerSeconds: 25, emoji: '🌱' },
  { id: 'bloom', label: 'Bloom', size: 5, minPath: 9, timerSeconds: 35, emoji: '🌷' },
  { id: 'meadow', label: 'Meadow', size: 6, minPath: 13, timerSeconds: 48, emoji: '🌻' },
  { id: 'orchard', label: 'Orchard', size: 7, minPath: 17, timerSeconds: 65, emoji: '🌳' },
];

export function getDifficulty(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[0];
}

export function oppositeDir(dir) {
  return (dir + 2) % 4;
}

export function getPorts(type, rotation = 0) {
  const base = BASE_PORTS[type];
  if (!base) return [];
  const rot = ((rotation % 4) + 4) % 4;
  return base.map((d) => (d + rot) % 4).sort((a, b) => a - b);
}

export function tileKey(r, c) {
  return `${r},${c}`;
}

export function dirBetween(from, to) {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  if (dr === -1 && dc === 0) return 0;
  if (dr === 0 && dc === 1) return 1;
  if (dr === 1 && dc === 0) return 2;
  if (dr === 0 && dc === -1) return 3;
  return -1;
}

function matchPipeForDirs(dirs) {
  const sorted = [...new Set(dirs)].sort((a, b) => a - b);
  if (sorted.length === 2) {
    for (const type of ['straight', 'curve']) {
      for (let rot = 0; rot < 4; rot += 1) {
        const ports = getPorts(type, rot);
        if (ports[0] === sorted[0] && ports[1] === sorted[1]) {
          return { type, rotation: rot };
        }
      }
    }
  }
  return { type: 'cross', rotation: 0 };
}

function shuffle(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function findWindingPath(size, startRow, goalRow, minPath, rng) {
  const start = { r: startRow, c: 0 };
  const firstStep = { r: startRow, c: 1 };
  const preGoal = { r: goalRow, c: size - 2 };
  const goal = { r: goalRow, c: size - 1 };

  let bestPath = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const visited = new Set([tileKey(start.r, start.c), tileKey(goal.r, goal.c)]);
    const path = [start];
    let steps = 0;
    const maxSteps = size * size * 18;

    function dfs(curr) {
      if (steps > maxSteps) return false;
      steps += 1;
      const key = tileKey(curr.r, curr.c);
      visited.add(key);
      path.push(curr);

      if (curr.r === preGoal.r && curr.c === preGoal.c) {
        if (path.length + 1 >= minPath || attempt >= 16) {
          path.push(goal);
          return true;
        }
      }

      const neighbors = shuffle(
        DIRS.map((d) => ({ r: curr.r + d.dr, c: curr.c + d.dc })).filter(
          (n) =>
            n.r >= 0 &&
            n.r < size &&
            n.c >= 0 &&
            n.c < size &&
            !visited.has(tileKey(n.r, n.c)),
        ),
        rng,
      );

      for (const next of neighbors) {
        if (dfs(next)) return true;
      }

      path.pop();
      visited.delete(key);
      return false;
    }

    if (dfs(firstStep)) {
      if (!bestPath || path.length > bestPath.length) {
        bestPath = [...path];
      }
      if (bestPath.length >= minPath) return bestPath;
    }
  }

  // Fallback deterministic zig-zag path if random DFS didn't hit minPath
  const fallback = [start, firstStep];
  let r = firstStep.r;
  let c = firstStep.c;
  while (c < preGoal.c) {
    c += 1;
    fallback.push({ r, c });
  }
  while (r !== preGoal.r) {
    r += r < preGoal.r ? 1 : -1;
    fallback.push({ r, c });
  }
  fallback.push(goal);
  return bestPath && bestPath.length >= fallback.length ? bestPath : fallback;
}

export function generateLevel(difficultyId = 'sprout', rng = Math.random) {
  const diff = getDifficulty(difficultyId);
  const { size, minPath } = diff;
  const startRow = Math.floor(rng() * size);
  const goalRow = Math.floor(rng() * size);

  const path = findWindingPath(size, startRow, goalRow, minPath, rng);
  const pathSet = new Set(path.map((p) => tileKey(p.r, p.c)));

  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => ({
      r,
      c,
      type: 'curve',
      rotation: 0,
      visualRotation: 0,
      solutionRotation: 0,
      locked: false,
      onSolution: false,
    })),
  );

  // Assign solution path tiles
  for (let i = 0; i < path.length; i += 1) {
    const curr = path[i];
    const tile = grid[curr.r][curr.c];
    tile.onSolution = true;

    if (i === 0) {
      tile.type = 'faucet';
      tile.rotation = 0;
      tile.visualRotation = 0;
      tile.solutionRotation = 0;
      tile.locked = true;
    } else if (i === path.length - 1) {
      tile.type = 'pond';
      tile.rotation = 0;
      tile.visualRotation = 0;
      tile.solutionRotation = 0;
      tile.locked = true;
    } else {
      const prev = path[i - 1];
      const next = path[i + 1];
      const d1 = dirBetween(curr, prev);
      const d2 = dirBetween(curr, next);
      const matched = matchPipeForDirs([d1, d2]);
      tile.type = matched.type;
      tile.solutionRotation = matched.rotation;
      tile.rotation = matched.rotation;
      tile.visualRotation = matched.rotation;
    }
  }

  // Fill decoy tiles
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (pathSet.has(tileKey(r, c))) continue;
      const roll = rng();
      const type = roll < 0.56 ? 'curve' : roll < 0.86 ? 'straight' : 'tee';
      const rot = Math.floor(rng() * 4);
      grid[r][c].type = type;
      grid[r][c].rotation = rot;
      grid[r][c].visualRotation = rot;
      grid[r][c].solutionRotation = rot;
    }
  }

  // Scramble rotatable solution tiles
  let scrambledCount = 0;
  for (let i = 1; i < path.length - 1; i += 1) {
    const { r, c } = path[i];
    const tile = grid[r][c];
    const turns = tile.type === 'straight' ? (rng() < 0.65 ? 1 : 0) : Math.floor(rng() * 3) + 1;
    if (turns > 0) scrambledCount += 1;
    tile.rotation = (tile.solutionRotation + turns) % 4;
    tile.visualRotation = tile.rotation;
  }

  // Guarantee the level never starts already solved (including via decoy shortcuts)
  if (
    scrambledCount === 0 ||
    traceFlow({ size, grid, start: path[0], goal: path[path.length - 1] }).reachedGoal
  ) {
    const first = path[1];
    const tile = grid[first.r][first.c];
    for (let step = 0; step < 4; step += 1) {
      if (!getPorts(tile.type, tile.rotation).includes(3)) break;
      tile.rotation = (tile.rotation + 1) % 4;
    }
    tile.visualRotation = tile.rotation;
  }

  return {
    difficulty: diff,
    size,
    grid,
    start: path[0],
    goal: path[path.length - 1],
    solutionPath: path,
  };
}

export function rotateTile(level, r, c) {
  const tile = level.grid[r]?.[c];
  if (!tile || tile.locked) return false;
  tile.rotation = (tile.rotation + 1) % 4;
  tile.visualRotation += 1;
  return true;
}

export function traceFlow(level) {
  const { size, grid, start, goal } = level;
  const startKey = tileKey(start.r, start.c);
  const visited = new Set([startKey]);
  const waves = [[{ r: start.r, c: start.c, fromDir: 3 }]];
  const leaks = [];
  let reachedGoal = false;

  let frontier = [{ r: start.r, c: start.c }];

  while (frontier.length > 0) {
    const nextWave = [];
    for (const curr of frontier) {
      const tile = grid[curr.r][curr.c];
      const ports = getPorts(tile.type, tile.rotation);

      for (const dir of ports) {
        const nr = curr.r + DIRS[dir].dr;
        const nc = curr.c + DIRS[dir].dc;

        if (nr < 0 || nr >= size || nc < 0 || nc >= size) {
          if (tile.type !== 'faucet' && tile.type !== 'pond') {
            leaks.push({ r: curr.r, c: curr.c, dir });
          }
          continue;
        }

        const neighbor = grid[nr][nc];
        const neighborPorts = getPorts(neighbor.type, neighbor.rotation);
        const needed = oppositeDir(dir);

        if (neighborPorts.includes(needed)) {
          const nKey = tileKey(nr, nc);
          if (!visited.has(nKey)) {
            visited.add(nKey);
            nextWave.push({ r: nr, c: nc, fromDir: needed });
            if (nr === goal.r && nc === goal.c) {
              reachedGoal = true;
            }
          }
        } else if (tile.type !== 'pond') {
          leaks.push({ r: curr.r, c: curr.c, dir });
        }
      }
    }

    if (nextWave.length > 0) {
      waves.push(nextWave);
    }
    frontier = nextWave;
  }

  return {
    connectedKeys: visited,
    waves,
    leaks,
    reachedGoal,
  };
}
