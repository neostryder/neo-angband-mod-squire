// neo-angband-mod-squire - generated from plugin.ts by neo-angband-mod-build
// (@rpgm-tools/neo-angband-mod-sdk). Edit the TypeScript source, not this file.

// src/mission.ts
function stopText(stop2) {
  switch (stop2.reason) {
    case "done":
      return "The errand is complete.";
    case "nothing-to-do":
      return "There was nothing to do.";
    case "unsafe":
      return stop2.detail;
    case "target-gone":
      return stop2.detail;
    case "creature-appeared":
      return `Stopped: ${stop2.detail}`;
    case "hurt":
      return stop2.detail;
    case "afflicted":
      return stop2.detail;
    case "level-changed":
      return "The character changed depth.";
    case "blocked":
      return "The way is blocked.";
    case "budget":
      return "The errand reached its decision limit.";
    case "dead":
      return "The character died.";
  }
}
function isStop(decision2) {
  return "stop" in decision2;
}
function stop(reason, detail) {
  return { stop: { reason, detail } };
}
function issue(command) {
  return { command };
}

// src/grid.ts
var DIRECTIONS = [
  { key: 2, dx: 0, dy: 1 },
  { key: 8, dx: 0, dy: -1 },
  { key: 6, dx: 1, dy: 0 },
  { key: 4, dx: -1, dy: 0 },
  { key: 3, dx: 1, dy: 1 },
  { key: 1, dx: -1, dy: 1 },
  { key: 9, dx: 1, dy: -1 },
  { key: 7, dx: -1, dy: -1 }
];
function steps(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
function adjacent(a, b) {
  const d = steps(a, b);
  return d === 1;
}
function directionToward(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return null;
  const found = DIRECTIONS.find((d) => d.dx === dx && d.dy === dy);
  return found ? found.key : null;
}
function neighbours(at) {
  return DIRECTIONS.map((d) => ({ x: at.x + d.dx, y: at.y + d.dy }));
}
function key(at) {
  return `${String(at.x)},${String(at.y)}`;
}

// src/progress.ts
function newProgress(depth2) {
  return { steps: 0, idle: 0, at: null, depth: depth2, collected: /* @__PURE__ */ new Set(), visited: /* @__PURE__ */ new Set() };
}
function advance(progress, at) {
  progress.steps += 1;
  if (progress.at !== null && key(progress.at) === key(at)) progress.idle += 1;
  else progress.idle = 0;
  progress.at = at;
  progress.visited.add(key(at));
}
var PACING_STEPS = 30;
var PACING_GRIDS = 4;
function pacing(progress) {
  return progress.steps >= PACING_STEPS && progress.visited.size <= PACING_GRIDS;
}
function alreadyCollected(progress, at) {
  return progress.collected.has(key(at));
}
function markCollected(progress, at) {
  progress.collected.add(key(at));
}

// src/threat.ts
var SQUIRE_WEIGHTS = {
  perStep: 100,
  wounded: 40,
  perLevel: 1,
  levelCap: 30,
  fleeing: 25
};
function priority(monster, from, weights = SQUIRE_WEIGHTS) {
  const distance = steps(from, monster.grid);
  const health = monster.maxHp > 0 ? Math.max(0, Math.min(1, monster.hp / monster.maxHp)) : 1;
  let score = 1e3;
  score -= distance * weights.perStep;
  score += (1 - health) * weights.wounded;
  score -= Math.min(monster.level, weights.levelCap) * weights.perLevel;
  if (monster.afraid) score -= weights.fleeing;
  return score;
}
function engageable(monster, options) {
  if (!monster.visible) return false;
  if (monster.asleep && !options.wakeSleepers) return false;
  return true;
}
function pickTarget(monsters, from, options) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const monster of monsters) {
    if (!engageable(monster, options)) continue;
    if (steps(from, monster.grid) > options.reach) continue;
    const score = priority(monster, from, options.weights);
    if (best === null || score > bestScore || score === bestScore && monster.id < best.id) {
      best = monster;
      bestScore = score;
    }
  }
  return best;
}
function inSight(monsters) {
  return monsters.filter((monster) => monster.visible);
}
function awakeInSight(monsters) {
  return monsters.filter((monster) => monster.visible && !monster.asleep);
}

// src/disturb.ts
var AFFLICTIONS = [
  "blind",
  "confused",
  "afraid",
  "poisoned",
  "cut",
  "stun",
  "paralyzed"
];
function afflictionsOf(status) {
  return AFFLICTIONS.filter((name) => (status[name] ?? 0) > 0);
}
function visibleIds(view) {
  const ids = /* @__PURE__ */ new Set();
  for (const monster of view.monsters()) if (monster.visible) ids.add(monster.id);
  return ids;
}
function createWatcher(view, options) {
  const known = visibleIds(view);
  const player = view.player();
  let lastHp = player.hp;
  const startHp = player.hp;
  const startingDepth = player.depth;
  let afflictions = new Set(afflictionsOf(player.status));
  return {
    known,
    acknowledge(id) {
      known.add(id);
    },
    check(now) {
      const p = now.player();
      if (p.dead) {
        return { reason: "dead", detail: "The character died." };
      }
      if (p.depth !== startingDepth) {
        return {
          reason: "level-changed",
          detail: `The depth changed from ${String(startingDepth)} to ${String(p.depth)}.`
        };
      }
      const current2 = afflictionsOf(p.status);
      const landed = current2.filter((name) => !afflictions.has(name));
      afflictions = new Set(current2);
      if (landed.length > 0) {
        return {
          reason: "afflicted",
          detail: `The character is ${landed.join(" and ")}.`
        };
      }
      const hp = p.hp;
      const lost = lastHp - hp;
      lastHp = hp;
      if (options.stopOnLowHealth && p.maxHp > 0 && hp <= p.maxHp * options.retreatFraction) {
        return {
          reason: "hurt",
          detail: `Hit points are down to ${String(hp)} of ${String(p.maxHp)}.`
        };
      }
      const share3 = options.stopOnDamageShare;
      if (share3 !== void 0 && p.maxHp > 0 && lost > 0 && (lost >= p.maxHp * share3 || startHp - hp >= p.maxHp * share3 * 2)) {
        return {
          reason: "hurt",
          detail: `The character took ${String(lost)} damage.`
        };
      }
      if (options.stopOnAnyDamage && lost > 0) {
        return {
          reason: "hurt",
          detail: `The character took ${String(lost)} damage.`
        };
      }
      if (options.stopOnNewCreature) {
        for (const monster of now.monsters()) {
          if (!monster.visible) continue;
          if (known.has(monster.id)) continue;
          if (options.routine?.(monster, now) === true) continue;
          known.add(monster.id);
          return {
            reason: "creature-appeared",
            detail: `${monster.race} came into view.`
          };
        }
      } else {
        for (const id of visibleIds(now)) known.add(id);
      }
      return null;
    }
  };
}

// src/flow.ts
var DEFAULT_LIMIT = 2e4;
function flowFrom(options) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const distance = /* @__PURE__ */ new Map();
  const queue = [];
  for (const goal of options.goals) {
    const at = key(goal);
    if (distance.has(at)) continue;
    if (!options.canEnter(goal)) continue;
    distance.set(at, 0);
    queue.push(goal);
  }
  for (let head = 0; head < queue.length && distance.size < limit; head++) {
    const here = queue[head];
    if (here === void 0) break;
    const next = (distance.get(key(here)) ?? 0) + 1;
    for (const direction of DIRECTIONS) {
      const there = { x: here.x + direction.dx, y: here.y + direction.dy };
      const at = key(there);
      if (distance.has(at)) continue;
      if (!options.canEnter(there)) continue;
      distance.set(at, next);
      queue.push(there);
    }
  }
  return {
    distance: (at) => distance.get(key(at)) ?? Number.POSITIVE_INFINITY,
    reached: distance.size
  };
}
function stepDown(field, from, canStep) {
  const here = field.distance(from);
  let best = null;
  let bestDistance = here;
  for (const direction of DIRECTIONS) {
    const there = { x: from.x + direction.dx, y: from.y + direction.dy };
    const d = field.distance(there);
    if (!Number.isFinite(d) || d >= bestDistance) continue;
    if (!canStep(there)) continue;
    best = direction;
    bestDistance = d;
  }
  return best;
}
function stepAway(field, from, canStep) {
  const here = field.distance(from);
  if (!Number.isFinite(here)) return null;
  let best = null;
  let bestDistance = here;
  for (const direction of DIRECTIONS) {
    const there = { x: from.x + direction.dx, y: from.y + direction.dy };
    const d = field.distance(there);
    if (!Number.isFinite(d) || d <= bestDistance) continue;
    if (!canStep(there)) continue;
    best = direction;
    bestDistance = d;
  }
  return best;
}

// src/map.ts
function cellAt(view, at) {
  return view.cell(at.x, at.y);
}
function isKnownGround(view, terrain, at) {
  const cell2 = cellAt(view, at);
  if (cell2 === null) return false;
  if (!cell2.known || !cell2.passable) return false;
  return !terrain.isHarmful(cell2.feat);
}
function isClosedDoor(view, terrain, at) {
  const cell2 = cellAt(view, at);
  if (cell2 === null || !cell2.known) return false;
  return terrain.isClosedDoor(cell2.feat);
}
function isRoutable(view, terrain, at) {
  return isKnownGround(view, terrain, at) || isClosedDoor(view, terrain, at);
}
function isWalkable(view, terrain, at) {
  if (!isRoutable(view, terrain, at)) return false;
  const cell2 = cellAt(view, at);
  if (cell2 === null) return false;
  if (cell2.monster <= 0) return true;
  return !view.monsters().some((m) => m.id === cell2.monster && m.visible);
}
function standingOnHarm(view, terrain, at) {
  const cell2 = cellAt(view, at);
  return cell2 !== null && terrain.isHarmful(cell2.feat);
}
function frontiers(view, terrain) {
  const bounds = view.mapBounds();
  const me = view.player().grid;
  const found = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const at = { x, y };
      if (!isKnownGround(view, terrain, at) && !isClosedDoor(view, terrain, at) && !(x === me.x && y === me.y)) continue;
      for (const there of neighbours(at)) {
        const cell2 = cellAt(view, there);
        if (cell2 !== null && !cell2.known) {
          found.push(at);
          break;
        }
      }
    }
  }
  return found;
}
function knownStairs(view, terrain) {
  const bounds = view.mapBounds();
  const found = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell2 = view.cell(x, y);
      if (cell2 === null || !cell2.known) continue;
      if (terrain.isDownStair(cell2.feat) || terrain.isUpStair(cell2.feat)) found.push({ x, y });
    }
  }
  return found;
}
function knownDownStairs(view, terrain) {
  const bounds = view.mapBounds();
  const found = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell2 = view.cell(x, y);
      if (cell2 === null || !cell2.known) continue;
      if (terrain.isDownStair(cell2.feat)) found.push({ x, y });
    }
  }
  return found;
}
function knownCount(cell2) {
  const known = cell2.knownObjectCount;
  return typeof known === "number" ? known : cell2.objectCount;
}
function hasFloorObject(view, at) {
  const cell2 = cellAt(view, at);
  return cell2 !== null && knownCount(cell2) > 0;
}

// src/travel.ts
function enter(ctx, from, to) {
  const dir = directionToward(from, to);
  if (dir === null) return null;
  if (isClosedDoor(ctx.view, ctx.terrain, to)) return ctx.act.open(dir);
  return ctx.act.move(dir);
}
function travelTo(ctx, goals, avoid) {
  if (goals.length === 0) return { kind: "unreachable" };
  const at = ctx.view.player().grid;
  const here = key(at);
  if (goals.some((goal) => key(goal) === here)) return { kind: "arrived" };
  const routable = (grid) => isRoutable(ctx.view, ctx.terrain, grid);
  const careful = avoid === void 0 ? null : flowFrom({ goals, canEnter: (grid) => routable(grid) && (key(grid) === here || !avoid(grid)) });
  const field = careful !== null && Number.isFinite(careful.distance(at)) ? careful : flowFrom({ goals, canEnter: routable });
  if (!Number.isFinite(field.distance(at))) return { kind: "unreachable" };
  const direction = stepDown(field, at, (grid) => isWalkable(ctx.view, ctx.terrain, grid));
  if (direction === null) return { kind: "blocked" };
  const to = { x: at.x + direction.dx, y: at.y + direction.dy };
  const command = enter(ctx, at, to);
  return command === null ? { kind: "blocked" } : { kind: "step", command };
}
function retreatFrom(ctx, threats) {
  if (threats.length === 0) return { kind: "unreachable" };
  const at = ctx.view.player().grid;
  const field = flowFrom({
    goals: threats,
    /* The creatures' own grids have to be enterable for the flood to start at
     * all, and a creature standing on ground the character remembers is on
     * ordinary ground - it is only the CHARACTER's step into it that is barred,
     * and that is `isWalkable` below rather than this. */
    canEnter: (grid) => isRoutable(ctx.view, ctx.terrain, grid) || threats.some((t) => key(t) === key(grid))
  });
  const direction = stepAway(field, at, (grid) => isWalkable(ctx.view, ctx.terrain, grid));
  if (direction === null) return { kind: "blocked" };
  const to = { x: at.x + direction.dx, y: at.y + direction.dy };
  const command = enter(ctx, at, to);
  return command === null ? { kind: "blocked" } : { kind: "step", command };
}
function strike(ctx, target) {
  const at = ctx.view.player().grid;
  const dir = directionToward(at, target);
  if (dir === null) return null;
  if (Math.max(Math.abs(target.x - at.x), Math.abs(target.y - at.y)) !== 1) return null;
  return ctx.act.melee(dir);
}
function stepIntoDark(ctx, from) {
  for (const direction of DIRECTIONS) {
    const there = { x: from.x + direction.dx, y: from.y + direction.dy };
    const cell2 = cellAt(ctx.view, there);
    if (cell2 === null || cell2.known) continue;
    return ctx.act.move(direction.key);
  }
  return null;
}

// src/missions/autofight.ts
var AUTOFIGHT_REACH = 20;
var REACH = AUTOFIGHT_REACH;
function liveTarget(ctx, id) {
  return ctx.view.monsters().find((monster) => monster.id === id);
}
function autofight() {
  let watcher = null;
  let targetId = null;
  let struck = false;
  return {
    id: "autofight",
    label: "clear what is in front of me",
    begin(ctx) {
      const cfg = ctx.cfg;
      watcher = createWatcher(ctx.view, {
        /* A fight is damage. Only the retreat line ends this errand on hit
         * points, never the first blow that lands. */
        stopOnAnyDamage: false,
        stopOnNewCreature: cfg.stopOnNewCreature,
        stopOnLowHealth: cfg.stopOnLowHealth,
        retreatFraction: cfg.retreatFraction
      });
      const at = ctx.view.player().grid;
      const options = { wakeSleepers: cfg.wakeSleepers, reach: REACH };
      const named3 = ctx.view.target();
      if (named3 !== null && named3.midx > 0) {
        const monster = liveTarget(ctx, named3.midx);
        if (monster !== void 0 && monster.visible) {
          targetId = monster.id;
          return null;
        }
      }
      const chosen = pickTarget(ctx.view.monsters(), at, options);
      if (chosen === null) {
        return {
          reason: "nothing-to-do",
          detail: "There is nothing in sight to fight."
        };
      }
      targetId = chosen.id;
      return null;
    },
    step(ctx) {
      const at = ctx.view.player().grid;
      advance(ctx.progress, at);
      if (watcher === null || targetId === null) {
        return stop("nothing-to-do", "The errand was never given a target.");
      }
      if (ctx.progress.steps > ctx.cfg.errandSteps) {
        return stop("budget", "The fight ran longer than a short errand should.");
      }
      const disturbed = watcher.check(ctx.view);
      if (disturbed !== null) return { stop: disturbed };
      const target = liveTarget(ctx, targetId);
      if (target === void 0) {
        return struck ? stop("done", "The target is down.") : stop("target-gone", "The target is no longer there.");
      }
      if (!engageable(target, { wakeSleepers: true, reach: REACH })) {
        return stop("target-gone", `The ${target.race} is out of sight.`);
      }
      if (ctx.view.player().status.afraid > 0) {
        return stop("blocked", "The character is too afraid to fight in melee.");
      }
      if (adjacent(at, target.grid)) {
        const blow = strike(ctx, target.grid);
        if (blow === null) return stop("blocked", "The target cannot be struck from here.");
        struck = true;
        return issue(blow);
      }
      struck = false;
      if (ctx.progress.idle >= ctx.cfg.idleSteps) {
        return stop("blocked", "The way to the target is blocked.");
      }
      const travel = travelTo(ctx, [target.grid]);
      if (travel.kind === "step") return issue(travel.command);
      return stop("blocked", `The ${target.race} cannot be reached from here.`);
    }
  };
}

// src/travel-engine.ts
function engineTravelAvailable(view) {
  return typeof view.travelPath === "function";
}
function engineTravel(ctx, goals, options = {}) {
  if (goals.length === 0) return null;
  if (!engineTravelAvailable(ctx.view)) return null;
  if (awakeInSight(ctx.view.monsters()).length > 0) return null;
  const at = ctx.view.player().grid;
  if (goals.some((goal) => goal.x === at.x && goal.y === at.y)) return null;
  if (options.stairs !== void 0) {
    return ctx.act.raw(options.stairs === "down" ? "navigate-down" : "navigate-up");
  }
  const near = nearestGoal(ctx, goals);
  if (near === null) return null;
  const route = ctx.view.travelPath?.({ x: near.x, y: near.y }) ?? null;
  if (route === null || route.grids.length === 0) return null;
  const first = route.grids[0];
  if (first === void 0) return null;
  if (options.run === true && inCorridor(ctx)) {
    const dir = directionToward(at, first);
    if (dir !== null) return { ...ctx.act.raw("run"), dir };
  }
  return ctx.act.raw("pathfind", { dest: { x: near.x, y: near.y } });
}
function nearestGoal(ctx, goals) {
  const at = ctx.view.player().grid;
  const routable = (grid) => isRoutable(ctx.view, ctx.terrain, grid);
  const fromPlayer = flowFrom({ goals: [at], canEnter: routable });
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const goal of goals) {
    const distance = fromPlayer.distance(goal);
    if (Number.isFinite(distance) && distance < bestDistance) {
      bestDistance = distance;
      best = goal;
    }
  }
  return best;
}
function inCorridor(ctx) {
  const at = ctx.view.player().grid;
  let open = 0;
  for (const direction of DIRECTIONS) {
    if (isWalkable(ctx.view, ctx.terrain, { x: at.x + direction.dx, y: at.y + direction.dy })) open += 1;
  }
  return open <= 3;
}

// src/missions/autoexplore.ts
function downStairsReachable(ctx) {
  const stairs = knownDownStairs(ctx.view, ctx.terrain);
  const at = ctx.view.player().grid;
  if (stairs.some((grid) => key(grid) === key(at))) return true;
  if (stairs.length === 0) return false;
  const field = flowFrom({ goals: stairs, canEnter: (grid) => isRoutable(ctx.view, ctx.terrain, grid) });
  return Number.isFinite(field.distance(at));
}
function autoexplore(options = {}) {
  let watcher = null;
  let engineTurn = null;
  let engineBlocked = false;
  const lastSeen = /* @__PURE__ */ new Map();
  return {
    id: "autoexplore",
    label: "explore this floor",
    begin(ctx) {
      const cfg = ctx.cfg;
      const awake = options.allowAwake === true ? [] : awakeInSight(ctx.view.monsters());
      const first = awake[0];
      if (first !== void 0) {
        return {
          reason: "unsafe",
          detail: `A ${first.race} is awake and in sight.`
        };
      }
      watcher = createWatcher(ctx.view, {
        stopOnAnyDamage: true,
        stopOnNewCreature: cfg.stopOnNewCreature,
        stopOnLowHealth: cfg.stopOnLowHealth,
        retreatFraction: cfg.retreatFraction
      });
      return null;
    },
    step(ctx) {
      const at = ctx.view.player().grid;
      advance(ctx.progress, at);
      if (engineTurn !== null && ctx.view.turn() === engineTurn) engineBlocked = true;
      engineTurn = null;
      if (watcher === null) return stop("nothing-to-do", "The errand never started.");
      if (ctx.progress.steps > ctx.cfg.errandSteps) {
        return stop("budget", `The walk ran longer than a short errand should (${String(ctx.progress.steps)} steps over ${String(ctx.progress.visited.size)} grids).`);
      }
      if (pacing(ctx.progress)) {
        return stop("blocked", "The character keeps walking between the same few grids.");
      }
      const disturbed = watcher.check(ctx.view);
      if (disturbed !== null) return { stop: disturbed };
      if (standingOnHarm(ctx.view, ctx.terrain, at)) {
        const away = retreatFrom(ctx, [at]);
        if (away.kind === "step") return issue(away.command);
        return stop("blocked", "The character is standing on harmful ground and cannot step off.");
      }
      if (ctx.progress.idle >= ctx.cfg.idleSteps) {
        return stop("blocked", "The character has stopped making progress.");
      }
      if (options.findTownStairs === true && downStairsReachable(ctx)) {
        return stop("done", "This floor is walked out.");
      }
      let goals = frontiers(ctx.view, ctx.terrain);
      if (goals.length === 0 && options.findTownStairs === true) {
        const bounds = ctx.view.mapBounds();
        goals = [];
        for (let y = 0; y < bounds.height; y += 1) {
          for (let x = 0; x < bounds.width; x += 1) {
            const grid = { x, y };
            if (isRoutable(ctx.view, ctx.terrain, grid) && !ctx.progress.visited.has(key(grid))) goals.push(grid);
          }
        }
      }
      if (goals.length === 0) {
        return stop("done", "This floor is walked out.");
      }
      for (const m of ctx.view.monsters()) if (m.visible) lastSeen.set(m.id, m.grid);
      const seen = [...lastSeen.values()];
      const nearCreature = (grid) => seen.some((m) => Math.max(Math.abs(m.x - grid.x), Math.abs(m.y - grid.y)) <= 1);
      if (!engineBlocked) {
        const engine = engineTravel(ctx, goals, { run: true });
        if (engine !== null) {
          engineTurn = ctx.view.turn();
          return issue(engine);
        }
      }
      const travel = travelTo(ctx, goals, seen.length === 0 ? void 0 : nearCreature);
      switch (travel.kind) {
        case "step":
          return issue(travel.command);
        case "arrived": {
          const into = stepIntoDark(ctx, at);
          if (into !== null) return issue(into);
          return stop("blocked", "There is nowhere left to step from here.");
        }
        case "unreachable":
          return stop("done", "Nothing unexplored can be reached from here.");
        case "blocked":
          return stop("blocked", "The way on is blocked.");
      }
    }
  };
}

// src/missions/campaign.ts
var FIGHT_REACH = 20;
function campaign() {
  let lastDepth = null;
  return {
    id: "campaign",
    label: "play on until I take the keyboard back",
    begin() {
      return null;
    },
    step(ctx) {
      const player = ctx.view.player();
      const at = player.grid;
      advance(ctx.progress, at);
      if (player.dead) return stop("dead", "The character died.");
      if (player.winner) return stop("done", "The character has won.");
      if (lastDepth !== null && player.depth !== lastDepth) {
        ctx.progress.collected.clear();
        ctx.progress.idle = 0;
      }
      lastDepth = player.depth;
      const hurt = player.maxHp > 0 && player.hp <= player.maxHp * ctx.cfg.retreatFraction;
      const awake = awakeInSight(ctx.view.monsters());
      if (standingOnHarm(ctx.view, ctx.terrain, at)) {
        const away = retreatFrom(ctx, [at]);
        if (away.kind === "step") return issue(away.command);
      }
      if (hurt) {
        if (awake.length > 0) {
          const away = retreatFrom(ctx, awake.map((monster) => monster.grid));
          if (away.kind === "step") return issue(away.command);
        } else {
          return issue(ctx.act.rest());
        }
      }
      const target = pickTarget(ctx.view.monsters(), at, {
        wakeSleepers: ctx.cfg.wakeSleepers,
        reach: FIGHT_REACH
      });
      if (target !== null) {
        if (adjacent(at, target.grid)) {
          const blow = strike(ctx, target.grid);
          if (blow !== null) return issue(blow);
        } else {
          const travel = travelTo(ctx, [target.grid]);
          if (travel.kind === "step") return issue(travel.command);
        }
      }
      if (ctx.cfg.collect && !alreadyCollected(ctx.progress, at) && hasFloorObject(ctx.view, at)) {
        markCollected(ctx.progress, at);
        return issue(ctx.act.pickup());
      }
      const goals = frontiers(ctx.view, ctx.terrain);
      if (goals.length > 0 && ctx.progress.idle < ctx.cfg.idleSteps) {
        const travel = travelTo(ctx, goals);
        if (travel.kind === "step") return issue(travel.command);
        if (travel.kind === "arrived") {
          const into = stepIntoDark(ctx, at);
          if (into !== null) return issue(into);
        }
      }
      if (ctx.cfg.descend) {
        const stairs2 = knownDownStairs(ctx.view, ctx.terrain);
        if (stairs2.some((grid) => grid.x === at.x && grid.y === at.y)) {
          return issue(ctx.act.descend());
        }
        if (stairs2.length > 0 && ctx.progress.idle < ctx.cfg.idleSteps) {
          const travel = travelTo(ctx, stairs2);
          if (travel.kind === "step") return issue(travel.command);
        }
      }
      ctx.progress.idle = 0;
      const stairs = knownStairs(ctx.view, ctx.terrain).filter((grid) => ctx.terrain.isUpStair(ctx.view.cell(grid.x, grid.y)?.feat ?? -1));
      if (stairs.some((grid) => grid.x === at.x && grid.y === at.y)) return issue(ctx.act.ascend());
      const home = travelTo(ctx, stairs);
      if (home.kind === "step") return issue(home.command);
      const safe = neighbours(at).filter((grid) => isWalkable(ctx.view, ctx.terrain, grid) && !standingOnHarm(ctx.view, ctx.terrain, grid) && !awake.some((m) => adjacent(grid, m.grid)));
      const next = safe[Math.floor(Math.random() * safe.length)];
      const dir = next === void 0 ? null : directionToward(at, next);
      return issue(dir === null ? ctx.act.hold() : ctx.act.move(dir));
    }
  };
}

// src/squire.ts
function chooseMission(cfg, at, monsters) {
  if (cfg.useModel || cfg.errandCampaign) return campaign();
  const target = pickTarget(monsters, at, {
    wakeSleepers: cfg.wakeSleepers,
    reach: AUTOFIGHT_REACH
  });
  if (target !== null && cfg.errandAutofight) return autofight();
  if (cfg.errandAutoexplore) return autoexplore();
  return null;
}
function createSquire(options) {
  const { cfg, terrain, log, status } = options;
  let mission = null;
  let progress = null;
  let finished = null;
  function finish(stop2) {
    finished = stop2;
    log(`errand ended (${stop2.reason}): ${stop2.detail}`);
    status?.(stopText(stop2));
    if (mission?.id !== "campaign") {
      log("the keyboard is yours again; press any key to take it back from Squire");
    }
    return null;
  }
  const controller = (view, act) => {
    if (finished !== null) return null;
    if (mission === null) {
      const chosen = chooseMission(cfg, view.player().grid, view.monsters());
      if (chosen === null) {
        return finish({
          reason: "nothing-to-do",
          detail: "Every errand is switched off in Squire's settings."
        });
      }
      mission = chosen;
      progress = newProgress(view.player().depth);
      const ctx2 = { view, act, terrain, cfg, progress, log };
      const declined = mission.begin(ctx2);
      if (declined !== null) return finish(declined);
      log(`errand: ${mission.label}`);
    }
    if (progress === null) {
      return finish({
        reason: "nothing-to-do",
        detail: "The errand had no progress to record against."
      });
    }
    const ctx = { view, act, terrain, cfg, progress, log };
    const decision2 = mission.step(ctx);
    if (isStop(decision2)) return finish(decision2.stop);
    return decision2.command;
  };
  return {
    controller,
    mission: () => mission?.id ?? null,
    outcome: () => finished
  };
}

// src/brain/systemone.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function parseOne(name, question, raw) {
  if (!isRecord(raw)) return `the server sent no answer to "${name}"`;
  if (raw["type"] !== question.type) {
    return `the server answered "${name}" as a ${String(raw["type"])}, not a ${question.type}`;
  }
  switch (question.type) {
    case "noul": {
      const p = num(raw["noul"]);
      if (p === null) return `the answer to "${name}" had no probability`;
      return { type: "noul", p };
    }
    case "choice": {
      const choice2 = raw["choice"];
      const probs = raw["probabilities"];
      if (typeof choice2 !== "string" || !(choice2 in question.criteria)) {
        return `the answer to "${name}" picked an option that was not offered`;
      }
      if (!isRecord(probs)) return `the answer to "${name}" had no probabilities`;
      const probabilities = {};
      for (const option of Object.keys(question.criteria)) {
        probabilities[option] = num(probs[option]) ?? 0;
      }
      return { type: "choice", choice: choice2, confidence: num(raw["confidence"]) ?? 0, probabilities };
    }
    case "score": {
      const score = num(raw["score"]);
      const probs = raw["probabilities"];
      if (score === null) return `the answer to "${name}" had no score`;
      const probabilities = question.criteria.map(
        (_, i) => isRecord(probs) ? num(probs[String(i)]) ?? 0 : 0
      );
      return { type: "score", score, confidence: num(raw["confidence"]) ?? 0, probabilities };
    }
  }
}
function parseReply(request2, requestBody, replyBody) {
  let raw;
  try {
    raw = JSON.parse(replyBody);
  } catch {
    return { ok: false, problem: "the server's reply was not JSON" };
  }
  if (!isRecord(raw) || !isRecord(raw["answers"])) {
    return { ok: false, problem: "the server's reply had no answers" };
  }
  const answersRaw = raw["answers"];
  const answers = {};
  for (const [name, question] of Object.entries(request2.questions)) {
    const parsed = parseOne(name, question, answersRaw[name]);
    if (typeof parsed === "string") return { ok: false, problem: parsed };
    answers[name] = parsed;
  }
  const usageRaw = isRecord(raw["usage"]) ? raw["usage"] : {};
  const inputTokens = num(usageRaw["input_tokens"]);
  const outputTokens = num(usageRaw["output_tokens"]);
  const usage = inputTokens === null ? { inputTokens: estimateTokens(requestBody), outputTokens: outputTokens ?? 0, estimated: true } : { inputTokens, outputTokens: outputTokens ?? 0, estimated: false };
  const model = typeof raw["model"] === "string" ? raw["model"] : null;
  return { ok: true, model, answers, usage };
}

// src/brain/backend.ts
var JEV = Object.freeze({
  kind: "jev",
  label: "Jev",
  url: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  secret: "jev",
  metered: true,
  usdPerMillionInput: 0.04,
  timeoutMs: 15e3
});
var JEV_KEY_VARIABLES = Object.freeze(["TYPESAFE_API_KEY", "JEV_API_KEY"]);
function selfHosted(kind, label, url, model, fallbacks = []) {
  const others = fallbacks.filter((f) => f !== "" && f !== url);
  return Object.freeze({
    kind,
    label,
    url,
    ...others.length === 0 ? {} : { fallbacks: Object.freeze([...others]) },
    ...model === void 0 ? {} : { model },
    metered: false,
    usdPerMillionInput: 0,
    timeoutMs: 3e4
  });
}
var SHARED_MEMORY = /* @__PURE__ */ new Map();
var BUSY_SKIP_MS = 5e3;
var DOWN_SKIP_MS = 3e4;
var PROBE_TIMEOUT_MS = 600;
function originOf(url) {
  const match = /^(https?:\/\/[^/]+)/i.exec(url);
  return match?.[1] ?? url;
}
async function busyReason(net, url) {
  const reply = await net.request({ url: `${originOf(url)}/load`, method: "GET", timeoutMs: PROBE_TIMEOUT_MS });
  if (!reply.ok) return { reason: `not answering (${reply.problem})`, skipMs: DOWN_SKIP_MS };
  if (reply.status === 404) return null;
  if (reply.status !== 200) return { reason: `load check answered HTTP ${String(reply.status)}`, skipMs: DOWN_SKIP_MS };
  try {
    const load = JSON.parse(reply.body);
    if (load.busy === true) return { reason: "busy", skipMs: BUSY_SKIP_MS };
    if (load.ready === false) return { reason: "not ready", skipMs: BUSY_SKIP_MS };
  } catch {
  }
  return null;
}
function retryAfter(headers) {
  const value = headers["retry-after"];
  if (value === void 0) return void 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e3 : void 0;
}
function statusFailure(backend, status, headers) {
  if (status === 401 || status === 403) {
    return {
      kind: "key-refused",
      message: `${backend.label} refused the API key. Check the key in Squire's setup and try again.`,
      retryable: false
    };
  }
  if (status === 429) {
    const after = retryAfter(headers);
    return {
      kind: "rate-limited",
      message: `${backend.label} asked Squire to slow down. Squire will try again shortly.`,
      retryable: true,
      ...after === void 0 ? {} : { retryAfterMs: after }
    };
  }
  if (status >= 500) {
    return {
      kind: "server-error",
      message: `${backend.label} had a problem of its own (HTTP ${String(status)}). Squire will try again shortly.`,
      retryable: true
    };
  }
  return {
    kind: "bad-reply",
    message: `${backend.label} turned the request down (HTTP ${String(status)}). This is likely a bug in Squire; please report it.`,
    retryable: false
  };
}
async function ask(net, backend, request2, now, memory = SHARED_MEMORY) {
  const fallbacks = backend.fallbacks ?? [];
  if (fallbacks.length === 0) return askOne(net, backend, request2, now);
  const started = now();
  const passed = [];
  for (const url of [backend.url, ...fallbacks]) {
    const skipped = memory.get(url);
    if (skipped !== void 0 && skipped.until > now()) {
      passed.push(`${url} ${skipped.reason}`);
      continue;
    }
    const busy = await busyReason(net, url);
    if (busy !== null) {
      memory.set(url, { until: now() + busy.skipMs, reason: busy.reason });
      passed.push(`${url} ${busy.reason}`);
      continue;
    }
    const result = await askOne(net, { ...backend, url }, request2, now);
    if (result.ok) return { ...result, latencyMs: now() - started };
    const kind = result.failure.kind;
    if (kind === "unreachable" || kind === "server-error") {
      const reason = kind === "unreachable" ? "not answering" : "server error";
      memory.set(url, { until: now() + (kind === "unreachable" ? DOWN_SKIP_MS : BUSY_SKIP_MS), reason });
      passed.push(`${url} ${reason}`);
      continue;
    }
    return { ...result, latencyMs: now() - started };
  }
  return {
    ok: false,
    latencyMs: now() - started,
    failure: {
      kind: "unreachable",
      message: `No ${backend.label} server could take the request: ${passed.join("; ")}. Squire will try again shortly.`,
      retryable: true
    }
  };
}
async function askOne(net, backend, request2, now) {
  const started = now();
  const body2 = JSON.stringify(backend.model === void 0 ? request2 : { model: backend.model, ...request2 });
  const headers = { "Content-Type": "application/json" };
  if (backend.secret !== void 0) headers["Authorization"] = `Bearer {secret:${backend.secret}}`;
  const reply = await net.request({ url: backend.url, method: "POST", headers, body: body2, timeoutMs: backend.timeoutMs });
  const latencyMs = now() - started;
  if (!reply.ok) {
    if (reply.code === "not-declared") {
      return {
        ok: false,
        latencyMs,
        failure: {
          kind: "not-allowed",
          message: `Squire is not allowed to reach ${backend.url}. Pick a server Squire's permissions name, or report this if you expected it to work.`,
          retryable: false
        }
      };
    }
    if (reply.code === "secret-missing") {
      return {
        ok: false,
        latencyMs,
        failure: {
          kind: "key-refused",
          message: `No API key is set for ${backend.label}. Add one in Squire's setup.`,
          retryable: false
        }
      };
    }
    return {
      ok: false,
      latencyMs,
      failure: { kind: "unreachable", message: `Could not reach ${backend.label}: ${reply.problem}`, retryable: true }
    };
  }
  if (reply.status !== 200) {
    return { ok: false, latencyMs, failure: statusFailure(backend, reply.status, reply.headers) };
  }
  const parsed = parseReply(request2, body2, reply.body);
  if (!parsed.ok) {
    return {
      ok: false,
      latencyMs,
      failure: {
        kind: "bad-reply",
        message: `${backend.label} answered, but ${parsed.problem}. Squire will try again shortly.`,
        retryable: true
      }
    };
  }
  return { ok: true, answers: parsed.answers, usage: parsed.usage, model: parsed.model, latencyMs, server: backend.url };
}

// src/brain/boot.ts
async function keyReady(secrets, backend, canReadEnv, log) {
  if (backend.secret === void 0) return true;
  const held2 = await secrets.has(backend.secret);
  if (held2.present) return true;
  if (!canReadEnv) {
    log(`No API key is set for ${backend.label}, so Squire runs its errands without a model.`);
    return false;
  }
  const host = new URL(backend.url).host;
  const read = await secrets.fromEnv(backend.secret, JEV_KEY_VARIABLES, { hosts: [host] });
  if (read.ok) return true;
  log(`${read.problem} Squire runs its errands without a model.`);
  return false;
}

// src/brain/brain.ts
function sameToken(a, b) {
  return a !== null && b !== null && a.epoch === b.epoch && a.revision === b.revision;
}
function outcomeLine(end) {
  const parts = [end.stop];
  if (end.stop !== "handed back") parts.push(`${String(end.commands)} command${end.commands === 1 ? "" : "s"}`);
  if (end.refused > 0) parts.push(`${String(end.refused)} refused`);
  if (end.hpBefore !== null && end.hpAfter !== null && end.stop !== "handed back") {
    const change = end.hpAfter - end.hpBefore;
    parts.push(`hp ${change > 0 ? "+" : ""}${String(change)}`);
  }
  return parts.join(", ").slice(0, 64);
}
var BACKOFF_MS = Object.freeze([1e3, 2e3, 4e3, 8e3, 15e3, 3e4]);
var MAX_RETRY_AFTER_MS = 6e4;
var MAX_EMPTY_DECISIONS = 4;
var MAX_PLAN_IDLE_MS = 3e4;
var MAX_PLAN_MS = 6e4;
function createBrain(deps) {
  const { backend, planner, tally } = deps;
  let state = { kind: "idle" };
  let landed = null;
  let attempt = 0;
  let emptyDecisions = 0;
  const emptyLabels = /* @__PURE__ */ new Set();
  let rulesReason = null;
  let retryAt = 0;
  let breakLoop = false;
  let progressGauge = null;
  let progressAt = deps.now();
  function useRules(reason) {
    if (rulesReason === null) deps.log(`${reason} Squire plays by its own rules, choosing from its current offers.`);
    rulesReason = reason;
  }
  function runningStatus(plan) {
    deps.status(plan.label, rulesReason === null ? deps.rulesOnly === true ? "Squire plays by its own rules." : void 0 : `Squire plays by its own rules. ${rulesReason}`);
  }
  function newRun(view) {
    const gauge = deps.gauge?.(view);
    return {
      hpBefore: gauge?.hp ?? null,
      startedAt: deps.now(),
      lastTurn: gauge?.turn ?? null,
      lastDepth: gauge?.depth ?? null,
      lastProgressAt: deps.now(),
      commands: 0,
      refused: 0,
      issuedAt: null,
      issuedDepth: null
    };
  }
  function stopWith(message, view) {
    if (view.player?.().dead !== true && view.player?.().winner !== true) {
      useRules(message);
      breakLoop = true;
      state = { kind: "waiting", until: deps.now() + 1e3 };
      deps.status("trying another move", message);
      return null;
    }
    state = { kind: "stopped", message };
    deps.log(message);
    deps.status("stopped", message);
    return null;
  }
  function failed(failure, view) {
    const wait = Math.min(MAX_RETRY_AFTER_MS, failure.retryAfterMs ?? BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    attempt += 1;
    retryAt = deps.now() + wait;
    useRules(failure.message);
    state = { kind: "idle" };
    startAsking(view);
    return null;
  }
  function startAsking(view) {
    const capped = deps.rulesOnly === true ? null : tally.overCap(backend, deps.now());
    if (capped !== null) useRules(capped.message);
    const own = deps.rulesOnly === true || capped !== null || rulesReason !== null && deps.now() < retryAt || breakLoop;
    const question = own && planner.rules !== void 0 ? planner.rules(view, rulesReason ?? (deps.rulesOnly === true ? "Squire plays by its own rules." : "Squire is trying another move."), breakLoop) : planner.ask(view);
    breakLoop = false;
    if ("handBack" in question) {
      if (question.context !== void 0) {
        deps.onDecision?.({
          token: deps.token(),
          backend: backend.label,
          request: { state: {}, questions: {} },
          context: question.context,
          answers: {},
          usage: { inputTokens: 0, outputTokens: 0, estimated: false },
          model: null,
          latencyMs: 0,
          outcome: `try again: ${question.handBack}`,
          reflex: "nothing to offer"
        });
        const hp = deps.gauge?.(view).hp ?? null;
        deps.onPlanEnd?.({ stop: "interrupted", reason: question.handBack, commands: 0, refused: 0, hpBefore: hp, hpAfter: hp });
      }
      return stopWith(question.handBack, view);
    }
    if ("reflex" in question) {
      deps.onDecision?.({
        token: deps.token(),
        backend: backend.label,
        request: { state: {}, questions: {} },
        context: question.context,
        answers: question.answers,
        usage: { inputTokens: 0, outputTokens: 0, estimated: false },
        model: null,
        latencyMs: 0,
        outcome: question.plan.label,
        reflex: question.reflex
      });
      state = { kind: "running", plan: question.plan, run: newRun(view) };
      runningStatus(question.plan);
      return null;
    }
    if (own) {
      const choice2 = planner.choose({}, question.context, view);
      if ("handBack" in choice2) return stopWith(choice2.handBack, view);
      state = { kind: "running", plan: choice2.plan, run: newRun(view) };
      runningStatus(choice2.plan);
      return null;
    }
    const token = deps.token();
    state = { kind: "asking", token, question };
    deps.status("thinking");
    deps.send(question.request).then(
      (result) => {
        landed = { result, question, token };
      },
      (error) => {
        landed = {
          result: {
            ok: false,
            latencyMs: 0,
            failure: { kind: "unreachable", message: `The request failed: ${String(error)}`, retryable: true }
          },
          question,
          token
        };
      }
    );
    return null;
  }
  function takeLanded(view) {
    if (landed === null) return null;
    const { result, question, token } = landed;
    landed = null;
    if (!result.ok) {
      failed(result.failure, view);
      return null;
    }
    tally.record(backend, result.usage, deps.now());
    attempt = 0;
    if (rulesReason !== null) deps.log("Squire resumes model decisions.");
    rulesReason = null;
    if (!sameToken(token, deps.token())) {
      state = { kind: "idle" };
      return null;
    }
    const choice2 = planner.choose(result.answers, question.context, view);
    const outcome = "plan" in choice2 ? choice2.plan.label : `try again: ${choice2.handBack}`;
    deps.onDecision?.({
      token,
      backend: backend.label,
      request: question.request,
      context: question.context,
      answers: result.answers,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
      server: result.server,
      outcome
    });
    const hp = deps.gauge?.(view).hp ?? null;
    if ("handBack" in choice2) {
      deps.onPlanEnd?.({ stop: "interrupted", reason: choice2.handBack, commands: 0, refused: 0, hpBefore: hp, hpAfter: hp });
      stopWith(choice2.handBack, view);
      return null;
    }
    state = { kind: "running", plan: choice2.plan, run: newRun(view) };
    runningStatus(choice2.plan);
    return "planned";
  }
  const controller = (view, act) => {
    if (view.player?.().dead === true || view.player?.().winner === true) return state.kind === "stopped" ? null : stopWith(view.player().dead ? "The character has died." : "The character has won.", view);
    if (state.kind === "stopped") return null;
    const current2 = deps.gauge?.(view);
    if (current2 !== void 0) {
      if (progressGauge === null || current2.turn !== progressGauge.turn || current2.depth !== progressGauge.depth) progressAt = deps.now();
      progressGauge = current2;
      if ((state.kind === "running" || state.kind === "idle") && deps.now() - progressAt >= MAX_PLAN_IDLE_MS) {
        if (state.kind === "running") deps.onPlanEnd?.({ stop: "interrupted", reason: "Squire made no progress for 30 seconds.", commands: state.run.commands, refused: state.run.refused, hpBefore: state.run.hpBefore, hpAfter: current2.hp });
        progressAt = deps.now();
        breakLoop = true;
        state = { kind: "waiting", until: deps.now() + 1e3 };
        deps.status("trying another move", "Squire made no progress. It will pause briefly and try another move.");
        return null;
      }
    }
    if (state.kind === "asking") {
      if (takeLanded(view) === null) return null;
    }
    if (state.kind === "waiting") {
      if (deps.now() < state.until) return null;
      state = { kind: "idle" };
    }
    if (state.kind === "running") {
      const { plan, run } = state;
      const gauge = deps.gauge?.(view) ?? null;
      if (gauge !== null && (gauge.turn !== run.lastTurn || (gauge.depth ?? null) !== run.lastDepth)) {
        run.lastTurn = gauge.turn;
        run.lastDepth = gauge.depth ?? null;
        run.lastProgressAt = deps.now();
      }
      const moved = gauge?.depth !== void 0 && run.issuedDepth !== null && gauge.depth !== run.issuedDepth;
      if (run.issuedAt !== null && gauge !== null && gauge.turn === run.issuedAt && !moved) run.refused += 1;
      run.issuedAt = null;
      run.issuedDepth = null;
      const reason = deps.now() - run.startedAt >= MAX_PLAN_MS ? "The plan ran for 60 seconds." : gauge !== null && deps.now() - run.lastProgressAt >= MAX_PLAN_IDLE_MS ? "The plan made no progress for 30 seconds." : planner.trigger(view, plan);
      if (reason === null) {
        const command = plan.step(view, act);
        if (command !== null) {
          emptyDecisions = 0;
          emptyLabels.clear();
          run.commands += 1;
          run.issuedAt = gauge?.turn ?? null;
          run.issuedDepth = gauge?.depth ?? null;
          return command;
        }
        deps.log(`finished: ${plan.label}`);
      } else {
        deps.log(`${plan.label}: ${reason}`);
      }
      deps.onPlanEnd?.({
        stop: reason === null ? "finished" : "interrupted",
        reason,
        commands: run.commands,
        refused: run.refused,
        hpBefore: run.hpBefore,
        hpAfter: gauge?.hp ?? null
      });
      if (run.commands === 0) {
        if (emptyLabels.has(plan.label)) emptyDecisions += 1;
        else emptyLabels.add(plan.label);
      }
      if (emptyDecisions > MAX_EMPTY_DECISIONS || emptyLabels.size > MAX_EMPTY_DECISIONS * 4) {
        emptyDecisions = 0;
        emptyLabels.clear();
        breakLoop = true;
        state = { kind: "waiting", until: deps.now() + 1e3 };
        deps.status("trying another move", "Squire's plans issued no commands. It will wait one second and choose another action.");
        return null;
      }
      state = { kind: "idle" };
    }
    if (state.kind === "idle") return startAsking(view);
    return null;
  };
  return {
    controller,
    state: () => state.kind,
    stoppedBecause: () => state.kind === "stopped" ? state.message : null
  };
}

// src/brain/pack.ts
var HUNGRY_BELOW = 1500;
function unseenAttacks(view, response, surveyTreasure = false) {
  const out = [];
  const area = /\b(?:balls?|orbs?|cloud|storm|swarm|dispel evil|sleep monsters)\b/i;
  const aimed = /\b(?:bolts?|balls?|magic missile|stinking cloud|light|dragon's (?:flame|frost|breath))\b/i;
  if (response === "cast_area") {
    for (const spell of canRead(view) ? castable(view) : []) {
      const info = view.spellInfo?.(spell.sidx);
      if (area.test(spell.name + " " + (info?.description ?? "")) && info?.canCastNow !== false && (info?.failChance ?? spell.fail) <= 50 && (info?.mana ?? spell.mana) <= view.player().sp) out.push({ how: "cast", sidx: spell.sidx, name: spell.name });
    }
    return out;
  }
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null || empty(name) || item.timeout > 0 || /\bcharging\b/i.test(name)) continue;
    const how2 = response === "unseen_staff" && /\bStaffs?\b/i.test(name) ? "staff" : response === "unseen_wand" && /\bWands?\b/i.test(name) ? "wand" : response === "unseen_rod" && /\bRods?\b/i.test(name) ? "rod" : null;
    if (how2 === null) continue;
    const shownEffect = /\bof (.+?)(?:\s*\(|$)/i.exec(name)?.[1] ?? "";
    const inspected = view.inspectItem?.(item.handle)?.text ?? "";
    const effect = shownEffect + " " + (/\bWhen (?:aimed|used|zapped)\b[^.]*\./i.exec(inspected)?.[0] ?? "");
    const reaches = how2 === "staff" ? /\b(?:detect evil|dispel evil|sleep\w*\b[^.]*monsters?|light|illumination|mapping)\b/i.test(effect) : how2 === "wand" ? aimed.test(effect) : /\b(?:detection|illumination|light|bolts?|balls?)\b/i.test(effect);
    const usefulTreasure = how2 === "rod" && /\btreasure location\b/i.test(effect) && surveyTreasure;
    if (reaches || usefulTreasure) out.push({ how: how2, handle: item.handle, name });
  }
  return out;
}
function unseenSources(view, response) {
  const pattern = response === "detect" ? /\b(?:Detect Monsters|Detect Invisible|Reveal Monsters|of Detection|Detect Evil)\b/i : response === "see_invisible" ? /\b(?:See Invisible|True Seeing)\b/i : /\b(?:Scrolls?|Rods?|Staffs?) of (?:Light|Illumination)\b/i;
  const effect = response === "detect" ? /\bdetect\w*\b[^.]*\b(?:monsters?|creatures?|invisible|evil)\b/i : response === "see_invisible" ? /\b(?:see invisible|true seeing|see\b[^.]*\binvisible)\b/i : /\b(?:illuminat\w*|light\w*\b[^.]*\b(?:area|room|nearby))\b/i;
  const reading = canRead(view);
  const out = [];
  const spellName = response === "detect" ? /^(?:Detect Monsters|Detect Invisible|Reveal Monsters|Detection|Detect Evil)$/i : response === "see_invisible" ? /^(?:See Invisible|True Seeing)$/i : /^(?:Light Area|Illumination|Light)$/i;
  for (const item of [...view.inventory(), ...view.equipment().filter((item2) => item2 !== null)]) {
    const name = shownName(item);
    if (name === null || empty(name) || item.timeout > 0 || /\bcharging\b/i.test(name)) continue;
    if (item.activation) {
      const text = view.inspectItem?.(item.handle)?.text ?? "";
      const activation = /\bWhen activated\b[^.]*\./i.exec(text)?.[0] ?? "";
      if (effect.test(activation)) out.push({ how: "activate", handle: item.handle, name });
      continue;
    }
    if (!pattern.test(name)) continue;
    const how2 = /\bPotions? of\b/i.test(name) ? "quaff" : /\bScrolls? of\b/i.test(name) ? "read" : /\bRods? of\b/i.test(name) ? "rod" : /\bStaffs? of\b/i.test(name) ? "staff" : null;
    if (how2 !== null && (how2 !== "read" || reading)) out.push({ how: how2, handle: item.handle, name });
  }
  for (const spell of reading ? castable(view) : []) {
    const info = view.spellInfo?.(spell.sidx);
    if (spellName.test(spell.name) && info?.canCastNow !== false && (info?.failChance ?? spell.fail) <= 50 && (info?.mana ?? spell.mana) <= view.player().sp) out.push({ how: "cast", sidx: spell.sidx, name: spell.name });
  }
  return out;
}
var DETECTION_SPELLS = [
  "Find Traps, Doors & Stairs",
  "Detect Monsters",
  "Treasure Detection",
  "Reveal Monsters",
  "Detection",
  "Detect Evil",
  "Object Detection"
];
function detectionSources(view) {
  const out = [];
  const reading = canRead(view);
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null || empty(name)) continue;
    if (reading && /\bScrolls? of Magic Mapping\b/i.test(name)) out.push({ kind: "read", handle: item.handle, name });
    if (/\bRods? of (Treasure Location|Detection|Detect Evil)\b/i.test(name)) out.push({ kind: "zap", handle: item.handle, name });
  }
  for (const spell of reading ? castable(view) : []) {
    if (DETECTION_SPELLS.includes(spell.name)) out.push({ kind: "cast", sidx: spell.sidx, name: spell.name });
  }
  return out;
}
function detectionSource(view) {
  return detectionSources(view)[0] ?? null;
}
var HEAL_POTIONS = [
  [/\bPotions? of Life\b/i, 6],
  [/\bPotions? of \*Healing\*/i, 5],
  [/\bPotions? of Healing\b/i, 4],
  [/\bPotions? of Cure Critical Wounds\b/i, 3],
  [/\bPotions? of Cure Serious Wounds\b/i, 2],
  [/\bPotions? of Cure Light Wounds\b/i, 1]
];
var ATTACK_WANDS = [
  [/\bWands? of Magic Missile\b/i, 1],
  [/\bWands? of Stinking Cloud\b/i, 1],
  [/\bWands? of (Lightning|Frost|Fire|Acid) Bolt\b/i, 2],
  [/\bWands? of Stone to Mud\b/i, 0],
  [/\bWands? of (Lightning|Frost|Fire|Acid) Ball\b/i, 3],
  [/\bWands? of (Drain Life|Annihilation|Dragon's (Flame|Frost|Breath))\b/i, 4]
];
var ATTACK_SPELLS = [
  [/^(Magic Missile|Nether Bolt|Stinking Cloud)$/i, 1],
  [/^(Frost Bolt|Fire Bolt|Acid Bolt|Lightning Strike|Orb of Draining|Crush|Spear of Light)$/i, 2],
  [/^(Frost Ball|Fire Ball|Acid Spray|Mana Bolt|Thrust Away|Disenchant|Dispel Evil|Holy Word)$/i, 3],
  [/^(Mana Storm|Meteor Swarm|Rift|Unleash Chaos|Annihilate)$/i, 4]
];
var HEAL_SPELLS = [
  [/^(Minor Healing|Cure Light Wounds)$/i, 1],
  [/^(Healing|Cure Serious Wounds|Heal)$/i, 3]
];
var ESCAPE_SPELLS = [/^(Phase Door|Blink|Teleport Self|Portal|Shadow Shift|Warp)$/i];
function shownName(item) {
  const name = item.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
function rank(name, table) {
  for (const [re, power] of table) if (re.test(name)) return power;
  return null;
}
function empty(name) {
  return /\(0 charges?\)/i.test(name);
}
function byPower(list) {
  return list.sort((a, b) => b.power - a.power);
}
function castable(view) {
  const sp = view.player().sp;
  const out = [];
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) {
      if (spell.learned && !spell.forgotten && spell.mana <= sp && spell.fail <= 50) out.push(spell);
    }
  }
  return out;
}
function studyable(view, tried = /* @__PURE__ */ new Set()) {
  const level = view.player().level;
  if (!canRead(view)) return null;
  const prefix2 = `${String(level)}:`;
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) if (!spell.learned && tried.has(prefix2 + String(spell.sidx))) return null;
  }
  const carried = view.inventory().flatMap((item) => {
    const name = shownName(item);
    return name === null ? [] : [{ handle: item.handle, name }];
  });
  for (const book of view.spellbooks()) {
    const item = carried.find((c) => book.name.length > 0 && c.name.includes(book.name));
    if (item === void 0) continue;
    const spells = [...book.spells].sort((a, b) => a.level - b.level);
    for (const spell of spells) {
      if (spell.learned || spell.level > level || tried.has(`${String(level)}:${String(spell.sidx)}`)) continue;
      return { handle: item.handle, sidx: spell.sidx, spell: spell.name };
    }
  }
  return null;
}
function attackSpellsOutOfMana(view) {
  if (view.player().maxSp <= 0) return false;
  const sp = view.player().sp;
  let known = false;
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) {
      if (!spell.learned || spell.forgotten || rank(spell.name, ATTACK_SPELLS) === null) continue;
      known = true;
      if ((view.spellInfo?.(spell.sidx)?.mana ?? spell.mana) <= sp) return false;
    }
  }
  return known;
}
function canRead(view) {
  const player = view.player();
  const status = player.status;
  if (status.blind > 0 || status.confused > 0) return false;
  const here = view.cell(player.grid.x, player.grid.y);
  return player.light > 0 || here?.glow === true || player.classFlags.includes("UNLIGHT");
}
function readPack(view) {
  const reading = canRead(view);
  const heal = [];
  const phase = [];
  const teleport = [];
  const descent = [];
  const oil = [];
  const attackWand = [];
  const ammo = [];
  const food = [];
  const quiver = view.quiver?.() ?? [];
  for (const item of [...view.inventory(), ...quiver]) {
    const name = shownName(item);
    if (name === null) continue;
    const entry = (power) => ({ handle: item.handle, name, power });
    const h2 = rank(name, HEAL_POTIONS);
    if (h2 !== null) heal.push(entry(h2));
    else if (/\bScrolls? of Phase Door\b/i.test(name)) {
      if (reading) phase.push(entry(1));
    } else if (/\bScrolls? of Deep Descent\b/i.test(name)) {
      if (reading) descent.push(entry(1));
    } else if (/\bScrolls? of (Teleportation|Teleport Level)\b|\bStaffs? of Teleportation\b/i.test(name) && !empty(name)) {
      if (reading || !/\bScrolls?\b/i.test(name)) teleport.push(entry(/Level/i.test(name) ? 1 : 2));
    } else if (/\bFlasks? of Oil\b/i.test(name)) oil.push(entry(1));
    else if (/\b(Iron Shots?|Pebbles?|Arrows?|Seeker Arrows?|Bolts?|Seeker Bolts?|Mithril Shots?)\b/i.test(name)) {
      ammo.push(entry(1));
    } else if (/\b(Rations? of Food|Slime Molds?|Elvish Waybread|Hard Biscuits?|Honey-cakes?|Flasks? of Whisky|Apples?|Strips? of Venison)\b/i.test(name)) {
      food.push(entry(1));
    } else {
      const w = rank(name, ATTACK_WANDS);
      if (w !== null && w > 0 && !empty(name)) attackWand.push(entry(w));
    }
  }
  let firesKind = null;
  for (const item of view.equipment()) {
    const name = item === null ? null : shownName(item);
    if (name === null || firesKind !== null) continue;
    if (/\bSling\b/i.test(name)) firesKind = /\b(Shots?|Pebbles?)\b/i;
    else if (/\bCrossbow\b/i.test(name)) firesKind = /\bBolts?\b/i;
    else if (/\bBow\b/i.test(name)) firesKind = /\bArrows?\b/i;
  }
  const launcher = firesKind !== null;
  const kind = firesKind;
  const fireable = kind === null ? [] : ammo.filter((item) => kind.test(item.name));
  const attackSpell = [];
  const healSpell = [];
  const escapeSpell = [];
  for (const spell of reading ? castable(view) : []) {
    const entry = (power) => ({ sidx: spell.sidx, name: spell.name, fail: spell.fail, mana: spell.mana, power });
    const a = rank(spell.name, ATTACK_SPELLS);
    const hs = rank(spell.name, HEAL_SPELLS);
    if (a !== null) attackSpell.push(entry(a));
    else if (hs !== null) healSpell.push(entry(hs));
    else if (ESCAPE_SPELLS.some((re) => re.test(spell.name))) escapeSpell.push(entry(1));
  }
  return {
    heal: byPower(heal),
    phase,
    teleport: byPower(teleport),
    descent,
    oil,
    attackWand: byPower(attackWand),
    ammo: fireable,
    food,
    launcher,
    attackSpell: byPower(attackSpell),
    healSpell: byPower(healSpell),
    escapeSpell
  };
}
function hungry(view) {
  return view.player().status.food < HUNGRY_BELOW;
}

// src/town/needs.ts
function shownName2(item) {
  const name = item.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
function matchesSupplyName(shown, wanted2) {
  if (wanted2 === "Flask of Oil") return /\bFlasks? of Oil\b/i.test(shown);
  if (wanted2 === "Ration of Food") return /\bRations? of Food\b/i.test(shown);
  if (wanted2 === "Wooden Torch") return /\bWooden (Torch|Torches)\b/i.test(shown);
  return shown.toLowerCase().includes(wanted2.toLowerCase());
}
function supplyName(kind, level, lantern, launcher) {
  switch (kind) {
    case "healing":
      return level >= 15 ? "Cure Serious Wounds" : "Cure Light Wounds";
    case "phase":
      return "Phase Door";
    case "escape":
      return "Teleportation";
    case "recall":
      return "Word of Recall";
    case "oil":
      return "Flask of Oil";
    case "food":
      return "Ration of Food";
    case "light":
      return lantern ? "Flask of Oil" : "Wooden Torch";
    case "ammo":
      return launcher === "Sling" ? "Iron Shot" : launcher?.includes("Crossbow") ? "Bolt" : "Arrow";
  }
}
function count(items, needle) {
  return items.reduce((sum, item) => {
    const name = shownName2(item);
    const matches = /Cure (Light|Serious) Wounds/.test(needle) ? /\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i.test(name ?? "") : name !== null && matchesSupplyName(name, needle);
    return sum + (matches ? item.number : 0);
  }, 0);
}
var RECALL_FROM_DEPTH = 5;
function scale(base, slider, minimum) {
  return Math.max(minimum, Math.round(base * (0.5 + slider / 100)));
}
function supplyNeeds(view, pack, persona, darkLesson = false) {
  const items = view.inventory();
  const worn = view.equipment().map((item) => item === null ? null : shownName2(item));
  const lantern = worn.some((name) => name !== null && /\bLantern\b/i.test(name));
  const launcher = worn.find((name) => name !== null && /\b(Sling|Short Bow|Long Bow|Light Crossbow|Heavy Crossbow)\b/i.test(name)) ?? null;
  const level = view.player().level;
  const destination = Math.max(view.player().depth + 1, view.player().maxDepth + 1);
  const consumables = persona?.sliders.consumables ?? 50;
  const escapes = persona?.sliders.escapes ?? 50;
  const healAt = persona?.sliders.healat ?? 50;
  const make = (kind, want, extra = {}) => {
    const name = kind === "healing" && destination >= 10 ? "Cure Critical Wounds" : supplyName(kind, level, lantern, launcher);
    return { kind, want, have: count(items, name), name, ...extra };
  };
  const healingBase = view.player().cls === "Warrior" ? 6 : pack.healSpell.length > 0 ? 3 : 5;
  const healing = Math.max(2, scale(healingBase, consumables, 2) + Math.max(0, Math.round((healAt - 50) / 25)));
  const spareFuel = darkLesson && persona?.toggles.darkLessons === true;
  const lightTarget = Math.max(scale(2, consumables, 2), spareFuel && lantern && level < 20 ? scale(10, consumables, 1) : 0) + (spareFuel ? 1 : 0);
  const recall = destination >= RECALL_FROM_DEPTH ? scale(1, escapes, 1) : 0;
  return [
    make("healing", healing),
    make("phase", scale(5, escapes, 2)),
    ...destination >= 10 ? [make("escape", destination > 25 ? 6 : 2)] : [],
    make("recall", recall),
    ...level < 20 ? [make("oil", scale(10, consumables, 1))] : [],
    make("food", scale(5, consumables, 5), { hungry: hungry(view) }),
    ...!view.player().objectFlags.includes("NO_FUEL") && !view.player().classFlags.includes("UNLIGHT") ? [make("light", lightTarget)] : [],
    ...pack.launcher && launcher !== null ? [make("ammo", scale(40, consumables, 1))] : []
  ];
}
function lowOnSupplies(needs) {
  if ((needs.find((n) => n.kind === "recall")?.have ?? 0) < 1) return false;
  return (needs.find((n) => n.kind === "healing")?.have ?? 0) < 2 || (needs.find((n) => n.kind === "phase")?.have ?? 0) < 1 || needs.some((n) => n.kind === "food" && n.have === 0 && n.hungry === true);
}
function recallItem(view) {
  return view.inventory().find((item) => /\bScrolls? of Word of Recall\b/i.test(shownName2(item) ?? "")) ?? null;
}

// src/brain/threat-model.ts
var THREAT_BANDS = ["an easy kill", "a fair fight", "dangerous", "deadly"];
var BAND_RISK = [0.03, 0.15, 0.4, 0.75];
function roundEstimate(level) {
  return 8 + 3 * level;
}
var TOWN_ROUND = 6;
function townsperson(monster, depth2) {
  return depth2 === 0 && monster.level === 0 && !monster.raceFlags.includes("UNIQUE");
}
function fastUniqueAtLowLevel(monster, player) {
  return player.depth > 0 && player.level <= 3 && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed;
}
var HARMLESS_CONTACTS = 3;
var HARMLESS_SPELLS = /* @__PURE__ */ new Set(["BLINK", "TPORT", "HASTE", "HEAL", "SHRIEK"]);
function harmlessKind(monster, view, contacts = 0) {
  if (monster.spellFlags.some((flag) => !HARMLESS_SPELLS.has(flag))) return false;
  const text = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  if (/\(\d+\)/.test(text) || /\bmay breathe\b/i.test(text)) return false;
  if (monster.raceFlags.includes("NEVER_BLOW")) return true;
  if (view.player().depth !== 0 || /\(\d+d\d+/.test(text)) return false;
  return contacts >= HARMLESS_CONTACTS || monster.raceFlags.includes("RAND_25") || monster.raceFlags.includes("RAND_50");
}
function threatIndex(monster, characterLevel, characterHp = Infinity, dreaded = /* @__PURE__ */ new Set(), town = false) {
  let band;
  if (monster.level * 2 <= characterLevel) band = 0;
  else if (monster.level <= characterLevel) band = 1;
  else if (monster.level <= characterLevel + 5) band = 2;
  else band = 3;
  if (monster.raceFlags.includes("UNIQUE")) band = Math.min(3, band + 1);
  const round = town ? TOWN_ROUND : roundEstimate(monster.level);
  if (characterHp <= round / 2) band = 3;
  else if (characterHp <= round) band = Math.max(band, 2);
  if (monster.race !== void 0 && dreaded.has(monster.race)) band = Math.max(band, 2);
  return band;
}
function knownCapability(text, level) {
  const blows = [...text.matchAll(/\b(\d+)d(\d+)(?=[, )])/g)].map((match) => Number(match[1]) * Number(match[2]));
  const spellText = [...text.matchAll(/\bmay (?:breathe|cast spells|[^.]*?)([^.]*?)\.\s{1,2}/gi)].map((match) => match[0]).join(" ");
  const spell = Math.max(0, ...[...spellText.matchAll(/\((\d+)\)/g)].map((match) => Number(match[1])));
  return {
    round: blows.length > 0 ? blows.reduce((sum, damage) => sum + damage, 0) : roundEstimate(level),
    spell,
    breeds: /\bbreeds explosively\b/i.test(text),
    knownBlows: blows.length > 0
  };
}
function unseenDamageAt(hit, at, turn) {
  if (hit === void 0 || turn < hit.turn || turn - hit.turn > 50) return 0;
  const distance = steps(at, hit.grid);
  if (distance > 5) return 0;
  return hit.damage * (1 - (turn - hit.turn) / 51) / (1 + distance / 3);
}
function energyBounds(speed, energy) {
  if (energy !== void 0) {
    const rate2 = Math.max(1, energy(speed));
    return { low: rate2, high: rate2 };
  }
  return {
    low: speed >= 110 ? 10 + Math.min(20, speed - 110) : speed >= 100 ? 5 : 1,
    high: speed >= 110 ? Math.min(49, 10 + speed - 110) : speed > 100 ? 10 : 5
  };
}
function monsterActions(monster, player, actions, energy) {
  return Math.max(1, Math.ceil(actions * energyBounds(monster.speed, energy).high / energyBounds(player.speed, energy).low));
}
var ELEMENTS = [
  [/\bacid\b/i, "ACID", "resAcid"],
  [/\b(?:lightning|electricity)\b/i, "ELEC", "resElec"],
  [/\bfire\b/i, "FIRE", "resFire"],
  [/\b(?:cold|frost)\b/i, "COLD", "resCold"],
  [/\bpoison\b/i, "POIS", "resPois"]
];
function resistedDamage(damage, attack, player, stats) {
  const element = ELEMENTS.find(([pattern]) => pattern.test(attack));
  if (element === void 0) return damage;
  const [, code, timer] = element;
  const derived = stats?.before.stats;
  const index = derived?.resistElements.findIndex((name) => name.toUpperCase() === code) ?? -1;
  const resist = index < 0 ? 0 : derived?.resists[index] ?? 0;
  if (resist >= 3) return 0;
  if (resist < 0) damage = Math.ceil(damage * 4 / 3);
  if (resist > 0) damage = Math.ceil(damage / 3);
  if (resist >= 2) damage = Math.ceil(damage / 3);
  if (player.status[timer] > 0 && resist < 2) damage = Math.ceil(damage / 3);
  return damage;
}
function attackFacts(view, monster, stats) {
  const player = view.player();
  const text = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  const fallback = townsperson(monster, player.depth) ? TOWN_ROUND : roundEstimate(monster.level);
  const blows = [...text.matchAll(/([^.(]*?)\((\d+)d(\d+)(?:,[^)]*)?\)/g)];
  const melee = monster.raceFlags.includes("NEVER_BLOW") ? 0 : blows.length === 0 ? fallback : blows.reduce((sum, blow) => {
    const ceiling = Number(blow[2]) * Number(blow[3]);
    return sum + Math.max(ceiling, resistedDamage(ceiling, blow[1], player, stats));
  }, 0);
  const magic = /\bmay (?:breathe|cast spells)\b/i.test(text) || monster.spellFlags.length > 0;
  const spells = [...text.matchAll(/([^().]*?)\((\d+)\)/g)];
  const ranged = magic ? Math.max(spells.length === 0 ? fallback : 0, ...spells.map((spell) => resistedDamage(Number(spell[2]), spell[1], player, stats))) : 0;
  const flags = player.objectFlags;
  const status = (/\b(?:paraly[sz]|hold)\w*\b/i.test(text) || monster.spellFlags.includes("HOLD")) && !flags.includes("FREE_ACT") ? 150 : (/\bconfus\w*\b/i.test(text) || monster.spellFlags.includes("CONF")) && !flags.includes("PROT_CONF") ? 10 : monster.spellFlags.includes("SLOW") ? 5 : 0;
  return { melee, ranged, status, uncertain: blows.length === 0 || magic && spells.length === 0 || monster.asleep || !monster.visible, bolt: (/\b(?:bolts?|missiles?|arrows?|shots?)\b/i.test(text) || monster.spellFlags.some((flag) => /^(?:BO_|ARROW|SHOT|MISSILE)/.test(flag))) && !/\bbreathe|\bball|\bstorm/i.test(text) && !monster.spellFlags.some((flag) => /^(?:BR_|BA_)/.test(flag)) };
}
function rangedPath(view, from, to, bolt, monsters, openedDoor) {
  const distance = steps(from, to);
  const projection = view.projectionPath;
  if (projection !== void 0 && key(to) === key(view.player().grid) && openedDoor === void 0) {
    const grids = projection.call(view, from).grids;
    const end = grids.findIndex((grid) => key(grid) === key(from));
    if (end < 0) return { clear: false, uncertain: false };
    const blocked = grids.slice(0, end).some((grid) => {
      const cell2 = view.cell(grid.x, grid.y);
      return cell2 !== null && cell2.known && !cell2.passable || bolt && monsters.some((m) => key(m.grid) === key(grid));
    });
    return { clear: !blocked, uncertain: grids.slice(0, end).some((grid) => view.cell(grid.x, grid.y)?.known !== true) };
  }
  let uncertain = false;
  for (let i = 1; i < distance; i += 1) {
    const x = from.x + (to.x - from.x) * i / distance;
    const y = from.y + (to.y - from.y) * i / distance;
    const choices = [Math.floor(x), Math.ceil(x)].flatMap((a) => [Math.floor(y), Math.ceil(y)].map((b) => ({ x: a, y: b })));
    const clear = choices.some((at) => {
      const cell2 = view.cell(at.x, at.y);
      if (cell2 === null) return false;
      if (!cell2.known) uncertain = true;
      else if (!cell2.passable && (openedDoor === void 0 || key(openedDoor) !== key(at))) return false;
      return !bolt || !monsters.some((m) => key(m.grid) === key(at));
    });
    if (!clear) return { clear: false, uncertain };
  }
  return { clear: true, uncertain };
}
function attackPositions(view, monster, at, actions, terrain, monsters, openedDoor, ranged = false, priorActions = 0) {
  const available = actions + priorActions;
  const costs = /* @__PURE__ */ new Map([[key(monster.grid), 0]]);
  const queue = [{ at: monster.grid, cost: 0 }];
  const positions = /* @__PURE__ */ new Map();
  for (let head = 0; head < queue.length && head < 4e3; head += 1) {
    const here = queue[head];
    if (ranged || steps(here.at, at) === 1) positions.set(key(here.at), Math.max(positions.get(key(here.at)) ?? 0, Math.min(actions, available - here.cost)));
    if (monster.raceFlags.includes("NEVER_MOVE") || here.cost >= available - 1) continue;
    for (const next of neighbours(here.at)) {
      if (key(next) === key(at) || priorActions === 0 && !monster.raceFlags.some((flag) => flag === "MOVE_BODY" || flag === "KILL_BODY") && monsters.some((m) => m.id !== monster.id && key(m.grid) === key(next))) continue;
      const cell2 = view.cell(next.x, next.y);
      if (cell2 === null) continue;
      let cost = here.cost + 1;
      if (cell2.known && !cell2.passable && (openedDoor === void 0 || key(openedDoor) !== key(next))) {
        const destroys = monster.raceFlags.some((flag) => flag === "PASS_WALL" || flag === "KILL_WALL" || flag === "SMASH_WALL");
        if (!destroys && !(terrain?.isClosedDoor(cell2.feat) && monster.raceFlags.includes("BASH_DOOR"))) {
          if (terrain?.isClosedDoor(cell2.feat) && monster.raceFlags.includes("OPEN_DOOR")) cost += 1;
          else continue;
        }
      }
      if (cost >= available || cost >= (costs.get(key(next)) ?? Infinity)) continue;
      costs.set(key(next), cost);
      queue.push({ at: next, cost });
    }
  }
  return positions;
}
function incomingDamage(view, at = view.player().grid, actions = 1, terrain, facts = {}) {
  const player = view.player();
  const monsters = facts.monsters ?? view.monsters().filter((m) => m.visible);
  const occupied = /* @__PURE__ */ new Map();
  const ticks = Math.ceil(actions * 10 / energyBounds(player.speed, facts.energy).low);
  const statusDamage = ticks * ((player.status.poisoned > 0 ? 1 : 0) + (player.status.cut > 200 ? 3 : player.status.cut > 100 ? 2 : player.status.cut > 0 ? 1 : 0));
  const unseen = facts.unseenHit === void 0 ? facts.unseenDamage ?? 0 : unseenDamageAt(facts.unseenHit, at, view.turn());
  let damage = unseen * actions + statusDamage;
  let status = 0;
  let uncertainty = unseen * actions;
  if (monsters.length === 0) return { damage, status, uncertainty };
  const stats = view.simulateLoadout?.({}) ?? null;
  const melee = [];
  for (const monster of monsters) {
    if (steps(monster.grid, at) > 20) continue;
    const count2 = monsterActions(monster, player, actions, facts.energy);
    const seen = monster.visible ? void 0 : facts.lastSeen?.get(monster.id);
    const prior = seen === void 0 ? 0 : Math.max(0, Math.ceil((view.turn() - seen) * energyBounds(monster.speed, facts.energy).high / 100));
    const read = attackFacts(view, monster, stats);
    const positions = attackPositions(view, monster, at, count2, terrain, monsters, facts.openedDoor, false, prior);
    const meleeDamage = Math.max(0, ...positions.values()) * read.melee;
    const path = rangedPath(view, monster.grid, at, read.bolt, monsters, facts.openedDoor);
    let spellDamage = path.clear ? count2 * read.ranged : 0;
    let rangedStatus = path.clear;
    if (read.ranged > 0 || read.status > 0) {
      const reachable = attackPositions(view, monster, at, count2, terrain, monsters, facts.openedDoor, true, prior);
      for (const [position, remaining] of reachable) {
        const [x, y] = position.split(",").map(Number);
        const shot = rangedPath(view, { x, y }, at, read.bolt, monsters, facts.openedDoor);
        if (shot.clear) {
          spellDamage = Math.max(spellDamage, remaining * read.ranged);
          rangedStatus = true;
        }
      }
    }
    if (spellDamage >= meleeDamage && (spellDamage > 0 || read.status > 0 && path.clear)) damage += spellDamage;
    else if (meleeDamage > 0) melee.push({ positions, damage: read.melee });
    if (rangedStatus && read.ranged > 0 || positions.size > 0) status += read.status;
    if (read.uncertain || path.uncertain) uncertainty += Math.max(meleeDamage, spellDamage, read.status);
  }
  const assigned = [];
  const place = (index, visited) => {
    const attack = assigned[index];
    for (const slot2 of [...attack.positions.keys()].sort((a, b) => attack.positions.get(b) - attack.positions.get(a))) {
      if (visited.has(slot2)) continue;
      visited.add(slot2);
      const previous = occupied.get(slot2);
      if (previous === void 0 || place(previous, visited)) {
        occupied.set(slot2, index);
        return true;
      }
    }
    return false;
  };
  for (const attack of melee.sort((a, b) => b.damage * Math.max(...b.positions.values()) - a.damage * Math.max(...a.positions.values()))) {
    assigned.push(attack);
    if (!place(assigned.length - 1, /* @__PURE__ */ new Set())) assigned.pop();
  }
  for (const index of occupied.values()) {
    const attack = assigned[index];
    damage += attack.damage * Math.max(...attack.positions.values());
  }
  return { damage, status, uncertainty };
}
function threatWindow(view, at = view.player().grid, terrain, facts = {}) {
  return { one: incomingDamage(view, at, 1, terrain, facts), two: incomingDamage(view, at, 2, terrain, facts) };
}
function assessThreat(monster, player, awake, view, dreaded = /* @__PURE__ */ new Set(), terrain, energy) {
  const town = townsperson(monster, player.depth);
  const uniqueFloor = fastUniqueAtLowLevel(monster, player) ? 3 : 0;
  const recall = view.monsterRecall?.(monster.raceIndex);
  const window2 = threatWindow(view, player.grid, terrain, { monsters: awake.some((m) => m.id === monster.id) ? awake : [...awake, monster], ...energy === void 0 ? {} : { energy } });
  let lethality = player.hp <= window2.one.damage / 2 && window2.one.damage > 0 ? 3 : player.hp <= window2.one.damage && window2.one.damage > 0 ? 2 : player.hp <= window2.two.damage && window2.two.damage > 0 ? 1 : 0;
  if (recall === void 0 || recall === null) {
    const capability2 = Math.max(uniqueFloor, threatIndex(monster, player.level, Infinity, dreaded));
    return { capability: capability2, lethality, band: Math.max(capability2, lethality), round: town ? TOWN_ROUND : roundEstimate(monster.level), description: null, enhanced: false };
  }
  const read = knownCapability(recall.text, monster.level);
  const known = town && !read.knownBlows ? { ...read, round: TOWN_ROUND } : read;
  let capability = Math.max(uniqueFloor, threatIndex(monster, player.level, Infinity, dreaded));
  const knownMagic = /\bmay (?:breathe|cast spells)\b/i.test(recall.text);
  if (known.breeds || known.round >= 16 || knownMagic) capability = Math.max(capability, 1);
  if (known.round >= 32 || known.spell >= 24) capability = Math.max(capability, 2);
  const band = Math.max(capability, lethality);
  const description = known.knownBlows ? `${known.round >= 16 ? "hits hard" : "known blows"} for a level ${String(player.level)} ${player.cls.toLowerCase()} (up to ${String(known.round)} a round)` : known.spell > 0 ? `known magic up to ${String(known.spell)} damage` : knownMagic ? "known spells or breaths" : known.breeds ? "breeds explosively" : "attacks not yet known";
  return { capability, lethality, band, round: known.round, description, enhanced: true };
}
function same(a, b) {
  return a.x === b.x && a.y === b.y;
}
function clearShot(view, target) {
  const { projectionPath } = view;
  if (projectionPath === void 0) return true;
  const path = projectionPath.call(view, target.grid).grids;
  const end = path.findIndex((grid) => same(grid, target.grid));
  if (end < 0) return false;
  return path.slice(0, end).every((grid) => {
    const occupant = view.cell(grid.x, grid.y)?.monster;
    return occupant === void 0 || occupant <= 0;
  });
}
function bestBallAim(view, monsters, target, radius = 2) {
  const { blastArea, projectionPath } = view;
  if (blastArea === void 0 || projectionPath === void 0) return target.grid;
  let best = null;
  let count2 = -1;
  for (const monster of monsters.filter((m) => m.visible)) {
    const at = monster.grid;
    if (!clearShot(view, monster)) continue;
    const grids = blastArea.call(view, at, radius, 0).grids;
    if (grids.some((grid) => same(grid, view.player().grid))) continue;
    const caught = monsters.filter((m) => m.visible && grids.some((grid) => same(grid, m.grid))).length;
    if (caught > count2 && caught > 0) {
      best = at;
      count2 = caught;
    }
  }
  return best;
}

// src/brain/combat-kit.ts
var ATTACK_ELEMENTS = [
  [/\bacid\b/i, "ACID"],
  [/\b(?:lightning|electricity)\b/i, "ELEC"],
  [/\b(?:fire|flame)\b/i, "FIRE"],
  [/\b(?:cold|frost)\b/i, "COLD"],
  [/\b(?:poison|stinking)\b/i, "POIS"]
];
function describedDamage(text, target) {
  const summary = /\baverage of (.+?) damage\b/i.exec(text)?.[1];
  if (summary === void 0) {
    const dice = /\b(?:for\s+)?(?:(\d+)\+)?(\d+)d(\d+)\s+([a-z ]*?)damage\b/i.exec(text);
    if (dice === null) return null;
    if (ATTACK_ELEMENTS.some(([pattern, code]) => pattern.test(dice[4] ?? "") && target.raceFlags.includes(`IM_${code}`))) return 0;
    return Number(dice[1] ?? 0) + Number(dice[2]) * (Number(dice[3]) + 1) / 2;
  }
  const parts = [...summary.matchAll(/(\d+(?:\.\d+)?)\s*([a-z ]*?)(?=\s+and\s+|$)/gi)];
  if (parts.length === 0) return null;
  return parts.reduce((sum, part) => {
    const immune = ATTACK_ELEMENTS.some(([pattern, code]) => pattern.test(part[2] ?? "") && target.raceFlags.includes(`IM_${code}`));
    return sum + (immune ? 0 : Number(part[1]));
  }, 0);
}
function weaponDamage(name, bonus, attacks) {
  const dice = /\((\d+)d(\d+)\)/.exec(name);
  if (dice === null || !Number.isFinite(attacks) || attacks <= 0) return null;
  const plus = Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
  return Math.max(0, Number(dice[1]) * (Number(dice[2]) + 1) / 2 + bonus + plus) * attacks;
}
function escapeMana(view) {
  const pack = readPack(view);
  if (view.player().depth === 0 || pack.phase.length > 0 || pack.teleport.length > 0) return 0;
  const costs = pack.escapeSpell.flatMap((spell) => {
    const info = view.spellInfo?.(spell.sidx);
    const fail = info?.failChance ?? spell.fail;
    const mana = info?.mana ?? spell.mana;
    if (/^(Shadow Shift|Warp)$/i.test(spell.name) || info?.canCastNow === false || fail > 15 || mana > view.player().sp) return [];
    return [mana];
  });
  return costs.length === 0 ? 0 : Math.min(...costs);
}
function attackOutcome(view, target, kind, source = null) {
  const player = view.player();
  let damage = null;
  let minimum = null;
  let failure = 0.5;
  let accuracyKnown = false;
  const text = source === null ? "" : "sidx" in source ? view.spellInfo?.(source.sidx)?.description ?? "" : view.inspectItem?.(source.handle)?.text ?? "";
  if (kind === "fight") {
    const weapon = view.equipment().find((item) => item !== null && [6, 7, 8, 9].includes(item.tval));
    if (steps(player.grid, target.grid) <= 1 && player.status.afraid === 0 && weapon !== void 0 && weapon !== null) {
      const name = shownName2(weapon) ?? "";
      damage = weaponDamage(name, player.toDam, player.blows / 100);
      const dice = /\((\d+)d\d+\)/.exec(name);
      if (dice !== null && player.blows > 0) minimum = Math.max(0, Number(dice[1]) + player.toDam + Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0)) * Math.floor(player.blows / 100);
    }
  } else if (kind === "cast_attack" && source !== null && "sidx" in source) {
    const info = view.spellInfo?.(source.sidx);
    failure = Math.max(0.05, (info?.failChance ?? source.fail) / 100);
    accuracyKnown = true;
    if (info?.canCastNow === false || (info?.mana ?? source.mana) > player.sp) failure = 1;
    damage = describedDamage(text, target);
    const element = ATTACK_ELEMENTS.find(([pattern]) => pattern.test(source.name));
    if (element !== void 0 && !ATTACK_ELEMENTS.some(([pattern]) => pattern.test(text)) && target.raceFlags.includes(`IM_${element[1]}`)) damage = minimum = 0;
    const dice = /\b(\d+)d(\d+)\b/.exec(text);
    if (dice !== null && damage !== null) minimum = Math.min(damage, Number(dice[1]));
    if (/(?:ball|orb|cloud|storm)/i.test(source.name) && view.blastArea !== void 0 && view.projectionPath !== void 0) {
      const aim = bestBallAim(view, view.monsters().filter((monster) => monster.visible && !monster.asleep), target);
      if (aim === null) failure = 1;
      else if (!view.blastArea(aim, 2).grids.some((grid) => grid.x === target.grid.x && grid.y === target.grid.y)) damage = minimum = null;
    }
  } else if (source !== null && "handle" in source) {
    damage = describedDamage(text, target);
    if (kind === "shoot" && damage === null) {
      const bow = view.equipment().find((item) => item !== null && item.tval === 5);
      const name = bow === void 0 || bow === null ? "" : shownName2(bow) ?? "";
      const mult = /\(x(\d+)\)/.exec(name);
      const bowBonus = Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
      const base = weaponDamage(source.name, bowBonus, player.shots / 10);
      damage = mult === null || base === null ? null : base * Number(mult[1]);
    }
    if (kind === "throw_oil") {
      if (damage === null) {
        damage = 7.5;
        minimum = 3;
      }
    }
    const chance = /(?:chance of (?:hitting|success)|(?:hit|success) (?:chance|rate))[^\d]*([\d.]+)%/i.exec(text);
    if (chance !== null) {
      failure = 1 - Number(chance[1]) / 100;
      accuracyKnown = true;
    }
    const element = ATTACK_ELEMENTS.find(([pattern]) => pattern.test(source.name));
    if (element !== void 0 && target.raceFlags.includes(`IM_${element[1]}`)) damage = minimum = 0;
  }
  const killingDamage = kind === "shoot" && damage !== null ? player.shots > 0 ? damage * 10 / player.shots : null : damage;
  return {
    kind,
    source,
    damage,
    minimum,
    failure,
    accuracyKnown,
    kill: killingDamage !== null && target.hp > 0 && killingDamage >= target.hp,
    manaReserve: escapeMana(view),
    fuelReserve: !player.objectFlags.includes("NO_FUEL") && !player.classFlags.includes("UNLIGHT") && view.equipment().some((item) => item !== null && /\bLantern\b/i.test(shownName2(item) ?? "")) ? 1 : 0
  };
}
function attackAllowed(view, target, outcome, context = {}) {
  if (outcome.failure >= 1 || outcome.damage === 0) return false;
  const source = outcome.source;
  const removesDanger = outcome.minimum !== null && target.hp > 0 && outcome.minimum >= target.hp && outcome.failure <= 0.25 && incomingDamage(view, view.player().grid, 1, context.terrain, { ...context.facts, monsters: (context.facts?.monsters ?? view.monsters().filter((monster) => monster.visible)).filter((monster) => monster.id !== target.id) }).damage < view.player().hp;
  if (removesDanger) return true;
  if (outcome.kind === "cast_attack" && source !== null && "sidx" in source) {
    const mana = view.spellInfo?.(source.sidx)?.mana ?? source.mana;
    return view.player().sp - mana >= outcome.manaReserve;
  }
  if (outcome.kind === "throw_oil" && outcome.fuelReserve > 0) {
    return oilCount(view) > outcome.fuelReserve;
  }
  if (outcome.kind === "aim_wand" && source !== null && "handle" in source) {
    const text = view.inspectItem?.(source.handle)?.text ?? "";
    const charges = /\((\d+) charges?\)/i.exec(source.name);
    if (/\bteleport(?:s|ation)?\s+(?:you|the player)\b/i.test(text) && (charges === null || Number(charges[1]) <= 1)) return false;
  }
  return true;
}
function oilCount(view) {
  const quiver = view.quiver?.() ?? [];
  return [...view.inventory(), ...quiver].reduce((sum, item) => sum + (/\bFlasks? of Oil\b/i.test(shownName2(item) ?? "") ? item.number : 0), 0);
}
function attackOptions(view, target, kind, context = {}) {
  const pack = readPack(view);
  const sources = kind === "fight" ? [null] : kind === "shoot" ? pack.ammo : kind === "throw_oil" ? pack.oil : kind === "aim_wand" ? pack.attackWand : pack.attackSpell.map((spell) => {
    const info = view.spellInfo?.(spell.sidx);
    return info === void 0 || info === null ? spell : { ...spell, mana: info.mana, fail: info.failChance };
  });
  return sources.map((source) => attackOutcome(view, target, kind, source)).filter((outcome) => attackAllowed(view, target, outcome, context)).sort((a, b) => Number(b.kill) - Number(a.kill) || (b.damage === null ? -1 : b.damage * (1 - b.failure)) - (a.damage === null ? -1 : a.damage * (1 - a.failure)) || a.failure - b.failure);
}
function attackDescription(outcome, view) {
  const damage = outcome.damage === null ? "Damage per action is unknown" : `Estimated damage per action is ${String(Math.round(outcome.damage * (1 - outcome.failure) * 10) / 10)}`;
  const accuracy = outcome.accuracyKnown ? `${String(Math.round(outcome.failure * 100))}% failure or miss chance` : "accuracy is unknown; the estimate discounts damage by half";
  const source = outcome.source;
  const spendsMana = outcome.kind === "cast_attack" && source !== null && "sidx" in source && view.player().sp - (view.spellInfo?.(source.sidx)?.mana ?? source.mana) < outcome.manaReserve;
  const spendsFuel = outcome.kind === "throw_oil" && outcome.fuelReserve > 0 && oilCount(view) <= outcome.fuelReserve;
  return ` ${damage}; ${accuracy}. ${outcome.kill ? "A hit could kill the target now." : "An immediate kill is not established."} The escape reserve is ${String(outcome.manaReserve)} mana and ${String(outcome.fuelReserve)} fuel units.${spendsMana || spendsFuel ? ` This immediate killing attempt spends the ${spendsMana ? "escape mana" : "fuel"} reserve.` : ""}`;
}
function healingAmount(view, source) {
  const text = "sidx" in source ? view.spellInfo?.(source.sidx)?.description ?? "" : view.inspectItem?.(source.handle)?.text ?? "";
  const fixed = /\b(?:heal\w*|restor\w*)\s+(?:you\s+for\s+|at least\s+)?((?:\d+\+)?\d+d\d+|\d+)\s+(?:hit\s?points|HP)\b(?:\s+\(or\s+(\d+)%, whichever is greater\))?/i.exec(text);
  const fraction2 = /\b(\d+)%\s+of\s+(?:your\s+)?(?:missing hit points|wounds)\b/i.exec(text);
  const missing = Math.max(0, view.player().maxHp - view.player().hp);
  const dice = fixed === null ? null : /^(?:(\d+)\+)?(\d+)d\d+$/.exec(fixed[1]);
  const minimum = dice === null ? Number(fixed?.[1] ?? 0) : Number(dice[1] ?? 0) + Number(dice[2]);
  if (fixed !== null || fraction2 !== null) return Math.min(missing, Math.max(minimum, Math.floor(missing * Number(fraction2?.[1] ?? fixed?.[2] ?? 0) / 100)));
  if ("sidx" in source || !/\bPotions? of\b/i.test(source.name)) return 0;
  const fallback = /\bLife\b|\*Healing\*/i.test(source.name) ? [1200, 0] : /\bHealing\b/i.test(source.name) ? [300, 35] : /\bCritical\b/i.test(source.name) ? [30, 25] : /\bSerious\b/i.test(source.name) ? [25, 20] : [15, 15];
  return Math.min(missing, Math.max(fallback[0], Math.floor(missing * fallback[1] / 100)));
}
function healingPotion(view, incoming) {
  const potions = [...readPack(view).heal].sort((a, b) => a.power - b.power);
  const hp = view.player().hp;
  return potions.find((potion) => {
    const amount = healingAmount(view, potion);
    return hp + amount > incoming && (amount >= incoming || incoming >= hp && amount > incoming / 3);
  }) ?? potions.at(-1);
}
function healingSpell(view, incoming) {
  const spells = readPack(view).healSpell.flatMap((spell) => {
    const info = view.spellInfo?.(spell.sidx);
    if (info !== void 0 && info !== null && (!info.canCastNow || info.mana > view.player().sp)) return [];
    const known = info === void 0 || info === null ? spell : { ...spell, fail: info.failChance, mana: info.mana };
    return known.fail <= 15 ? [known] : [];
  });
  return spells.find((spell) => {
    const amount = healingAmount(view, spell);
    return view.player().hp + amount > incoming && (amount >= incoming || incoming >= view.player().hp && amount > incoming / 3);
  }) ?? spells[0];
}
var BUFF_ITEMS = [
  [/\bPotions? of (Heroism|Berserk Strength|Speed)\b/i, "quaff"],
  [/\bScrolls? of (Blessing|Heroism)\b/i, "read"]
];
var BUFF_SPELLS = [/^(Heroism|Blessing|Berserk Strength|Haste Self)$/i];
var CURING = [
  [/\bStaffs? of Curing\b/i, "staff"],
  [/\bRods? of Curing\b/i, "rod"]
];
function held(view) {
  return view.inventory().flatMap((item) => {
    const name = shownName2(item);
    return name === null ? [] : [{ item, name }];
  });
}
function castable2(view) {
  const sp = view.player().sp;
  const out = [];
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) {
      if (spell.learned && !spell.forgotten && spell.mana <= sp && spell.fail <= 50) out.push({ sidx: spell.sidx, name: spell.name });
    }
  }
  return out;
}
function alreadyBuffed(view) {
  const s = view.player().status;
  return s.hero > 0 || s.shero > 0 || s.blessed > 0 || s.fast > 0 || s.sprint > 0;
}
function buffUse(view) {
  if (alreadyBuffed(view)) return null;
  for (const { item, name } of held(view)) {
    const found = BUFF_ITEMS.find(([pattern]) => pattern.test(name));
    if (found !== void 0) return { how: found[1], handle: item.handle, name };
  }
  for (const spell of castable2(view)) {
    if (BUFF_SPELLS.some((pattern) => pattern.test(spell.name))) return { how: "cast", sidx: spell.sidx, name: spell.name };
  }
  return null;
}
function resistUse(view) {
  for (const { item, name } of held(view)) {
    if (/\bPotions? of Resist/i.test(name)) return { how: "quaff", handle: item.handle, name };
    if (/\bScrolls? of Resist/i.test(name)) return { how: "read", handle: item.handle, name };
  }
  return null;
}
function deviceHealUse(view) {
  for (const { item, name } of held(view)) {
    if (item.timeout > 0 || /\(0 charges?\)/i.test(name)) continue;
    const found = CURING.find(([pattern]) => pattern.test(name));
    if (found !== void 0) return { how: found[1], handle: item.handle, name };
  }
  return null;
}
function activationUse(view) {
  for (const { item, name } of held(view)) {
    if (item.activation && item.timeout <= 0) return { how: "activate", handle: item.handle, name };
  }
  return null;
}
function breatherInSight(view, monsters) {
  const recall = view.monsterRecall;
  if (recall === void 0) return null;
  for (const monster of monsters) {
    if (!monster.visible || monster.asleep) continue;
    const info = recall.call(view, monster.raceIndex);
    if (info === null || info === void 0 || !/\bbreathe/i.test(info.text)) continue;
    const element = /\bbreathe[s]?\s+([a-z]+)/i.exec(info.text)?.[1] ?? null;
    return { race: monster.race, element };
  }
  return null;
}

// src/brain/volley.ts
function volleyAvailable(view) {
  return typeof view.projectionPath === "function";
}
function lineOfFire(view, target) {
  const path = view.projectionPath?.({ x: target.x, y: target.y });
  if (path === void 0) return true;
  const grids = path.grids;
  const last = grids[grids.length - 1];
  return last !== void 0 && last.x === target.x && last.y === target.y;
}
function volleySteps(goal, targetId, spellSidx, safety) {
  return (ctx) => {
    const view = ctx.view;
    const target = view.monsters().find((monster) => monster.id === targetId && monster.visible);
    if (target === void 0) return null;
    if (!lineOfFire(view, target.grid)) return null;
    const outcome = attackOptions(view, target, goal, safety?.(view)).find((attack) => spellSidx === void 0 || attack.source !== null && "sidx" in attack.source && attack.source.sidx === spellSidx);
    const source = outcome?.source;
    if (source === null || source === void 0) return null;
    if (!ctx.act.setTargetMonster(target.id)) return null;
    if ("sidx" in source) return ctx.act.cast(source.sidx);
    if (goal === "shoot") return readLauncher(view) ? ctx.act.fire(source.handle) : null;
    return goal === "throw_oil" ? ctx.act.throw(source.handle) : ctx.act.aimWand(source.handle);
  };
}
function readLauncher(view) {
  return view.equipment().some((item) => item?.tval === 5);
}

// src/persona/catalog.ts
var GROUPS = [
  "temperament",
  "values",
  "affinities",
  "habits",
  "tactics",
  "economy",
  "quirks",
  "lineage",
  "patron",
  "meta"
];
var PARAMETERS = [
  { id: "boldness", group: "temperament", name: "Boldness", kind: "slider", scale: "timid to fearless", description: "How much danger the character accepts before it backs off." },
  { id: "impulsiveness", group: "temperament", name: "Impulsiveness", kind: "slider", scale: "deliberate to rash", description: "How often the character acts on its first instinct." },
  { id: "patience", group: "temperament", name: "Patience", kind: "slider", scale: "restless to patient", description: "Resting fully, waiting in corridors, and reading a level before descending." },
  { id: "composure", group: "temperament", name: "Composure", kind: "slider", scale: "panics to ice-cold", description: "How decisions change at low hit points." },
  { id: "stubbornness", group: "temperament", name: "Stubbornness", kind: "slider", scale: "flexible to never backs down", description: "How hard it is to abandon a chosen fight or goal." },
  { id: "curiosity", group: "temperament", name: "Curiosity", kind: "slider", scale: "incurious to must know", description: "Trying unknown items and exploring every corner." },
  { id: "paranoia", group: "temperament", name: "Paranoia", kind: "slider", scale: "trusting to sees danger everywhere", description: "Detecting, avoiding unknown monsters, and keeping escapes." },
  { id: "optimism", group: "temperament", name: "Optimism", kind: "slider", scale: "expects the worst to expects the best", description: "Shifts perceived threat bands by one step." },
  { id: "volatility", group: "temperament", name: "Volatility", kind: "slider", scale: "steady to mood swings", description: "How much persona strength wanders between decisions." },
  { id: "pride", group: "temperament", name: "Pride", kind: "slider", scale: "humble to glory-seeking", description: "Hunting uniques and chasing depth records." },
  { id: "selfpreservation", group: "values", name: "Self-preservation", kind: "slider", scale: "reckless to survival first", description: "Sets the death-risk ceiling unless Death wish is on.", default: 70 },
  { id: "greed", group: "values", name: "Greed", kind: "slider", scale: "indifferent to gold-hungry", description: "Detours for known gold and loot." },
  { id: "ambition", group: "values", name: "Ambition", kind: "slider", scale: "content to driven to win", description: "Controls the dive rate." },
  { id: "honour", group: "values", name: "Honour", kind: "slider", scale: "fights dirty to fights fair", description: "Attacking sleepers and using corridor tactics." },
  { id: "mercy", group: "values", name: "Mercy", kind: "slider", scale: "kills everything to spares the harmless", description: "Whether to attack harmless or fleeing creatures." },
  { id: "glory", group: "values", name: "Renown", kind: "slider", scale: "private to showboat", description: "Weights Chronicle-worthy moves above equally effective safer moves." },
  { id: "hated", group: "affinities", name: "Hated monster families", kind: "list", scale: "orcs, dragons, undead", description: "Fights these on sight and takes more risk against them." },
  { id: "feared", group: "affinities", name: "Feared monster families", kind: "list", scale: "spiders, ghosts", description: "Avoids these and leaves levels early when they appear." },
  { id: "weapons", group: "affinities", name: "Favoured weapons", kind: "list", scale: "blades, hafted, polearms, bows", description: "Keeps a favoured type when another is slightly better." },
  { id: "distrusted", group: "affinities", name: "Distrusted things", kind: "list", scale: "magic devices, unknown scrolls", description: "Uses these only when necessary." },
  { id: "elements", group: "affinities", name: "Favoured spells or elements", kind: "list", scale: "fire, lightning, healing", description: "Prefers these spells when several work." },
  { id: "superstitions", group: "affinities", name: "Superstitions", kind: "list", scale: "never reads scrolls at 1300 ft", description: "Harmless rules the character keeps." },
  { id: "hoarding", group: "habits", name: "Pack weight", kind: "slider", scale: "travels light to carries everything", description: "How much the character carries." },
  { id: "tidiness", group: "habits", name: "Tidiness", kind: "slider", scale: "ignores junk rules to ignores aggressively", description: "How eagerly it sets ignore rules." },
  { id: "home", group: "habits", name: "Home use", kind: "slider", scale: "never uses the home to stashes treasures", description: "Whether spare gear goes home." },
  { id: "towntrips", group: "habits", name: "Town trips", kind: "slider", scale: "rarely returns to returns often", description: "When low supplies prompt a return to town." },
  { id: "detection", group: "habits", name: "Detection habit", kind: "slider", scale: "never detects to detects on arrival", description: "Use of detection and mapping on a new level." },
  { id: "levelfeel", group: "habits", name: "Level thoroughness", kind: "slider", scale: "takes the first stairs to clears every level", description: "How much ground is explored before descending." },
  { id: "range", group: "tactics", name: "Engagement range", kind: "slider", scale: "melee to ranged and kiting", description: "Closing to melee versus firing from afar." },
  { id: "escapes", group: "tactics", name: "Escape readiness", kind: "slider", scale: "keeps none to keeps many", description: "How many escapes to keep before descending." },
  { id: "healat", group: "tactics", name: "Heal threshold", kind: "slider", scale: "heals late to heals early", description: "Hit-point level at which healing becomes an option." },
  { id: "retreatat", group: "tactics", name: "Retreat threshold", kind: "slider", scale: "holds to the end to leaves early", description: "Hit-point level at which fleeing becomes an option." },
  { id: "targets", group: "tactics", name: "Target priority", kind: "slider", scale: "weakest first to most dangerous first", description: "Which monster in a group is attacked first." },
  { id: "consumables", group: "tactics", name: "Consumable use", kind: "slider", scale: "saves for emergencies to uses freely", description: "How readily potions, scrolls, and charges are spent." },
  { id: "corridors", group: "tactics", name: "Corridor discipline", kind: "slider", scale: "fights in the open to always backs into a corridor", description: "Pulling groups into corridors before fighting." },
  { id: "pricesense", group: "economy", name: "Price sense", kind: "slider", scale: "pays anything to buys only bargains", description: "How prices weigh against want in stores." },
  { id: "savings", group: "economy", name: "Savings goal", kind: "slider", scale: "spends it all to saves for the big item", description: "Whether gold is held for an expensive purchase." },
  { id: "selling", group: "economy", name: "Selling", kind: "slider", scale: "keeps everything to sells everything", description: "Selling where birth options permit it." },
  { id: "forgetful", group: "quirks", name: "Forgetful", kind: "quirk", scale: "on or off, with strength", description: "Randomly drops a lesson, and lets what it saw in the shops fade." },
  { id: "delusional", group: "quirks", name: "Delusional", kind: "quirk", scale: "on or off, with strength", description: "Randomly reads some threat bands wrong." },
  { id: "compulsive", group: "quirks", name: "Compulsive collector", kind: "quirk", scale: "on or off", description: "Must pick up everything it walks over." },
  { id: "pyromaniac", group: "quirks", name: "Pyromaniac", kind: "quirk", scale: "on or off", description: "Reaches for fire in every form." },
  { id: "deathwish", group: "quirks", name: "Death wish", kind: "quirk", scale: "on or off", description: "Allows options above the safety ceiling." },
  { id: "cowardice", group: "quirks", name: "Craven", kind: "quirk", scale: "on or off", description: "Flees from anything new, then circles back." },
  { id: "inheritance", group: "lineage", name: "Inheritance", kind: "slider", scale: "nothing passes to everything passes", description: "How much ancestral lore an heir starts with." },
  { id: "grudges", group: "lineage", name: "Blood grudges", kind: "toggle", scale: "on or off", description: "An heir hates or fears whatever killed its ancestors, and the feeling grows with each one it killed.", default: true },
  { id: "epitaphs", group: "lineage", name: "Epitaphs", kind: "toggle", scale: "on or off", description: "Squire writes an epitaph naming the killer and the character's last choice.", default: true },
  { id: "milestones", group: "lineage", name: "Family milestones", kind: "toggle", scale: "on or off", description: "The family remembers depth records, unique kills and its first artifact.", default: true },
  { id: "namesakes", group: "lineage", name: "Namesakes", kind: "toggle", scale: "on or off", description: "An heir can take an ancestor's name with a number.", default: true },
  { id: "inheritedSuperstitions", group: "lineage", name: "Inherited superstitions", kind: "toggle", scale: "on or off", description: "An heir avoids the scroll, potion or wand its ancestor used just before dying, until that kind is identified.", default: true },
  { id: "darkLessons", group: "lineage", name: "Lessons of the dark", kind: "toggle", scale: "on or off", description: "An heir carries extra fuel after an ancestor died without light.", default: true },
  { id: "trophies", group: "lineage", name: "Trophies", kind: "toggle", scale: "on or off", description: "A proud character keeps one item from each unique it kills while the pack has room.", default: true },
  { id: "favouredGrounds", group: "lineage", name: "Favoured grounds", kind: "toggle", scale: "on or off", description: "An heir prefers hunting where the family made its best find, once it is ready for that depth.", default: true },
  { id: "resemblance", group: "lineage", name: "Family resemblance", kind: "slider", scale: "each heir is new to heirs take after parents", description: "How much personality an heir inherits." },
  { id: "devotion", group: "patron", name: "Devotion", kind: "slider", scale: "ignores you to obeys you", description: "Whether a patron's spoken command is followed." },
  { id: "gratitude", group: "patron", name: "Gratitude", kind: "slider", scale: "takes gifts for granted to deeply grateful", description: "How much a blessing lifts mood and Devotion." },
  { id: "resentment", group: "patron", name: "Resentment", kind: "slider", scale: "forgives trials to holds a grudge", description: "How much a trial lowers Devotion." },
  { id: "strength", group: "meta", name: "Persona strength", kind: "slider", scale: "plays by advice to plays in character", description: "Blends the best move and in-character answers.", default: 35 },
  { id: "backstory", group: "meta", name: "Backstory weight", kind: "slider", scale: "ignored to rules everything", description: "How much backstory the state carries." },
  { id: "backstorycap", group: "meta", name: "Backstory cap", kind: "number", scale: "tokens", description: "Maximum backstory tokens per decision.", default: 600 },
  { id: "learning", group: "meta", name: "Learning rate", kind: "slider", scale: "slow to quick", description: "How fast lessons form and fade." },
  { id: "drift", group: "meta", name: "Trait drift", kind: "slider", scale: "fixed to shaped by experience", description: "How far experience moves traits.", default: 30 },
  { id: "confidence", group: "meta", name: "Confidence gate", kind: "slider", scale: "acts on anything to asks again when unsure", description: "When the brain asks a second question." },
  { id: "depth", group: "meta", name: "Thinking depth", kind: "slider", scale: "fast to thorough", description: "How many questions a decision asks." },
  { id: "chronicle", group: "meta", name: "Chronicle voice", kind: "slider", scale: "terse to chatty", description: "How many events reach the Chronicle." }
];

// src/persona/persona.ts
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function bounded(value, fallback, high = 100) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(high, Math.round(value))) : fallback;
}
function defaultPersona(name = "Squire") {
  const sliders = {};
  const lists = {};
  const quirks = {};
  const toggles = {};
  for (const parameter of PARAMETERS) {
    switch (parameter.kind) {
      case "slider":
        sliders[parameter.id] = "default" in parameter ? parameter.default : 50;
        break;
      case "list":
        lists[parameter.id] = [];
        break;
      case "quirk":
        quirks[parameter.id] = { on: false, strength: 50 };
        break;
      case "toggle":
        toggles[parameter.id] = parameter.default;
        break;
      case "number":
        break;
    }
  }
  return { name, sliders, lists, quirks, toggles, backstoryCap: 600, backstory: "" };
}
function normalize(input) {
  try {
    const raw = record(input);
    const result = defaultPersona(typeof raw["name"] === "string" ? raw["name"].trim().slice(0, 100) || "Squire" : void 0);
    const sliders = record(raw["sliders"]);
    const lists = record(raw["lists"]);
    const quirks = record(raw["quirks"]);
    const toggles = record(raw["toggles"]);
    for (const parameter of PARAMETERS) {
      switch (parameter.kind) {
        case "slider":
          result.sliders[parameter.id] = bounded(sliders[parameter.id], result.sliders[parameter.id]);
          break;
        case "list": {
          const value = lists[parameter.id];
          result.lists[parameter.id] = Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 40)).filter(Boolean).slice(0, 12) : [];
          break;
        }
        case "quirk": {
          const value = record(quirks[parameter.id]);
          result.quirks[parameter.id] = {
            on: typeof value["on"] === "boolean" ? value["on"] : false,
            strength: bounded(value["strength"], 50)
          };
          break;
        }
        case "toggle": {
          const value = toggles[parameter.id];
          result.toggles[parameter.id] = typeof value === "boolean" ? value : result.toggles[parameter.id];
          break;
        }
        case "number":
          break;
      }
    }
    result.backstoryCap = bounded(raw["backstoryCap"], 600, 4e3);
    result.backstory = typeof raw["backstory"] === "string" ? raw["backstory"].slice(0, 2e4) : "";
    return result;
  } catch {
    return defaultPersona();
  }
}
function unit(rng) {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
}
function randomPersona(rng, name = "Squire") {
  const result = defaultPersona(name);
  for (const parameter of PARAMETERS) {
    if (parameter.kind === "slider") result.sliders[parameter.id] = 20 + Math.floor(unit(rng) * 61);
  }
  const pool = ["forgetful", "delusional", "compulsive", "pyromaniac", "cowardice"];
  const count2 = 1 + Math.floor(unit(rng) * 2);
  for (let i = 0; i < count2; i += 1) {
    const index = Math.floor(unit(rng) * pool.length);
    const id = pool.splice(index, 1)[0];
    if (id !== void 0) result.quirks[id].on = true;
  }
  return result;
}
var ARCHETYPES = {
  coward: { sliders: { boldness: 10, selfpreservation: 90, retreatat: 85, escapes: 90, paranoia: 80, strength: 65 }, quirks: { cowardice: { on: true } } },
  berserker: { sliders: { boldness: 90, impulsiveness: 85, selfpreservation: 30, range: 10, strength: 70, pride: 80 } },
  miser: { sliders: { greed: 95, savings: 90, pricesense: 90, hoarding: 85, selling: 80, strength: 65 } },
  scholar: { sliders: { curiosity: 90, patience: 85, detection: 80, levelfeel: 85, impulsiveness: 20, strength: 65 }, lists: { elements: ["magic", "healing"] } },
  zealot: { sliders: { devotion: 95, honour: 85, stubbornness: 85, mercy: 20, strength: 75 }, lists: { hated: ["undead"] } },
  tourist: { sliders: { curiosity: 85, levelfeel: 90, ambition: 20, boldness: 30, towntrips: 80, strength: 60 } }
};
function archetype(id) {
  const override = ARCHETYPES[id];
  return normalize({
    ...defaultPersona(),
    name: id[0].toUpperCase() + id.slice(1),
    sliders: { ...defaultPersona().sliders, ...override.sliders },
    lists: { ...defaultPersona().lists, ...override.lists },
    quirks: { ...defaultPersona().quirks, ...override.quirks }
  });
}

// src/learning/ranks.ts
function rankFor(agreementShare, examples) {
  if (examples >= 150 && agreementShare >= 0.75) return "Knight-Errant";
  if (examples >= 40 && agreementShare >= 0.55) return "Squire";
  return "Page";
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function inferPersona(examples, commands) {
  const persona = defaultPersona("Player");
  const confidence = {};
  for (const key2 of Object.keys(persona.sliders)) {
    persona.sliders[key2] = 50;
    confidence[key2] = 0;
  }
  function set(key2, count2, value) {
    if (count2 === 0) return;
    persona.sliders[key2] = Math.round(clamp01(value) * 100);
    confidence[key2] = clamp01(count2 / 20);
  }
  const danger = commands.filter((command) => command.dangerousNear && (command.kind === "fight" || command.kind === "melee" || command.kind === "retreat"));
  const choiceDanger = examples.filter((example) => example.situation["dangerousNear"] === true && ["fight", "retreat", "phase", "teleport"].includes(example.playerPick));
  const dangerValues = [
    ...danger.map((command) => command.kind === "fight" || command.kind === "melee" ? 1 : 0),
    ...choiceDanger.map((example) => example.playerPick === "fight" ? 1 : 0)
  ];
  set("boldness", dangerValues.length, dangerValues.length ? mean(dangerValues) : 0.5);
  const rests = commands.filter((command) => command.kind === "rest" && command.restedToFull !== void 0);
  set("patience", rests.length, rests.length ? rests.filter((command) => command.restedToFull).length / rests.length : 0.5);
  const heals = commands.filter((command) => command.kind === "heal" && command.hpShare !== void 0);
  set("healat", heals.length, heals.length ? mean(heals.map((command) => command.hpShare)) : 0.5);
  const retreats = commands.filter((command) => command.kind === "retreat" && command.hpShare !== void 0);
  set("retreatat", retreats.length, retreats.length ? mean(retreats.map((command) => command.hpShare)) : 0.5);
  const duration = commands.length < 2 ? 0 : Math.max(...commands.map((command) => command.turn)) - Math.min(...commands.map((command) => command.turn));
  const consumed = commands.filter((command) => command.kind === "consumable");
  if (duration > 0) set("consumables", commands.length, consumed.length * 1e3 / duration / 10);
  const descents = commands.filter((command) => command.kind === "descend" && command.exploredShare !== void 0);
  set("levelfeel", descents.length, descents.length ? mean(descents.map((command) => command.exploredShare)) : 0.5);
  const attacks = commands.filter((command) => command.kind === "ranged" || command.kind === "melee");
  set("range", attacks.length, attacks.length ? attacks.filter((command) => command.kind === "ranged").length / attacks.length : 0.5);
  return { persona, confidence };
}

// src/knight.ts
var DIR_DELTA = {
  1: [-1, 1],
  2: [0, 1],
  3: [1, 1],
  4: [-1, 0],
  6: [1, 0],
  7: [-1, -1],
  8: [0, -1],
  9: [1, -1]
};
function goalOfCommand(command, view) {
  const player = view.player();
  const at = player.grid;
  const awake = view.monsters().filter((m) => m.visible && !m.asleep);
  const handle = typeof command.args?.["handle"] === "number" ? command.args["handle"] : null;
  const pack = readPack(view);
  const detection = detectionSources(view);
  const has = (list) => handle !== null && list.some((i) => i.handle === handle);
  switch (command.code) {
    case "walk":
    case "run":
    case "pathfind": {
      const delta = command.dir === void 0 ? void 0 : DIR_DELTA[command.dir];
      if (delta !== void 0) {
        const to = { x: at.x + delta[0], y: at.y + delta[1] };
        if (view.monsters().some((m) => m.grid.x === to.x && m.grid.y === to.y)) return "fight";
        if (awake.length > 0) {
          const nearestNow = Math.min(...awake.map((m) => steps(at, m.grid)));
          const nearestAfter = Math.min(...awake.map((m) => steps(to, m.grid)));
          if (nearestAfter > nearestNow) return "retreat";
          if (nearestAfter < nearestNow) return "fight";
        }
      }
      return "explore";
    }
    case "descend":
      return "descend";
    case "close":
      return "close_door";
    case "rest":
      return "rest";
    case "pickup":
      return "pick_up";
    case "eat":
      return "eat";
    case "study":
      return "study";
    case "wield":
    case "wear":
      return "wear";
    case "zap-rod":
    case "zap":
      return detection.some((source) => source.kind === "zap" && source.handle === handle) ? "detect" : null;
    case "fire":
      return "shoot";
    case "throw":
      return has(pack.oil) ? "throw_oil" : null;
    case "aim-wand":
      return "aim_wand";
    case "quaff":
      return has(pack.heal) ? "heal" : null;
    case "read":
      if (detection.some((source) => source.kind === "read" && source.handle === handle)) return "detect";
      if (handle !== null && recallItem(view)?.handle === handle) return player.depth === 0 ? "recall_dungeon" : "recall_town";
      if (has(pack.phase)) return "phase";
      if (has(pack.teleport)) return "teleport";
      if (has(pack.descent)) return "deep_descent";
      return null;
    case "use-staff":
      return has(pack.teleport) ? "teleport" : null;
    case "shop-buy":
    case "shop-sell":
      return "shop";
    case "cast": {
      const spell = typeof command.args?.["spell"] === "number" ? command.args["spell"] : null;
      if (spell === null) return null;
      if (pack.attackSpell.some((s) => s.sidx === spell)) return "cast_attack";
      if (pack.healSpell.some((s) => s.sidx === spell)) return "cast_heal";
      if (pack.escapeSpell.some((s) => s.sidx === spell)) return "phase";
      if (detection.some((source) => source.kind === "cast" && source.sidx === spell)) return "detect";
      return null;
    }
    default:
      return null;
  }
}
function proceduralPick(offers, hpShare) {
  const has = (g) => offers.find((o) => o.goal === g);
  const first = (...goals) => goals.find((g) => has(g) !== void 0) ?? null;
  const fight = has("fight");
  if (fight !== void 0 && fight.risk > 0.45) {
    return first("teleport", "phase", "heal", "retreat", "shoot", "cast_attack", "fight");
  }
  if (hpShare < 0.35) {
    const safe = first("heal", "cast_heal");
    if (safe !== null) return safe;
  }
  if (fight !== void 0) return first("shoot", "cast_attack", "throw_oil", "aim_wand", "fight");
  return first("detect", "wear", "study", "recall_town", "shop", "recall_dungeon", "rest", "eat", "pick_up", "explore", "descend");
}
var LABEL = {
  swing_unseen: "swing at an unseen attacker",
  cast_area: "cast an area spell",
  unseen_staff: "use a staff against an unseen attacker",
  unseen_wand: "aim a wand at an unseen attacker",
  unseen_rod: "zap a rod against an unseen attacker",
  step_aside: "try another safe step",
  endure: "wait for an opening",
  fight: "fight in melee",
  shoot: "shoot",
  throw_oil: "throw oil",
  aim_wand: "aim a wand",
  cast_attack: "cast an attack spell",
  heal: "drink a healing potion",
  cast_heal: "cast a healing spell",
  phase: "phase away",
  teleport: "teleport away",
  deep_descent: "read Deep Descent",
  retreat: "back away",
  rest: "rest",
  eat: "eat",
  study: "learn a spell",
  wear: "wear gear",
  detect: "survey the level",
  see_invisible: "see invisible creatures",
  light_room: "light the room",
  pick_up: "pick it up",
  fetch: "fetch an item",
  drop_junk: "drop junk",
  buff: "use a combat buff",
  resist: "drink a resist potion",
  device: "use a curing device",
  activate: "activate an item",
  disarm: "disarm a trap",
  tunnel: "tunnel through rubble",
  explore: "explore",
  descend: "take the stairs",
  leave_level: "leave the level",
  close_door: "close a door",
  recall_town: "recall to town",
  shop: "shop for supplies",
  recall_dungeon: "recall into the dungeon",
  wait: "wait a turn"
};
function goalLabel(goal) {
  return LABEL[goal];
}
function noteLine(squire, knight, hpShare) {
  const hp = `at ${String(Math.round(hpShare * 100))}% health`;
  if (squire === knight) return `Agreed: you chose to ${LABEL[knight]} ${hp}, as I would have.`;
  return `Noted: you chose to ${LABEL[knight]} ${hp}. I would have chosen to ${LABEL[squire]}.`;
}
var WHY_REASONS = ["danger", "saving resources", "setting something up", "instinct", "just because"];
function emptyApprentice() {
  return { entries: [], agreed: 0, total: 0, commands: [], exams: [], examArmed: false, ghostHint: null, ghostGoal: null };
}
function note(apprentice, entry) {
  const weight = entry.demonstration ? 2 : 1;
  return {
    entries: [...apprentice.entries, entry].slice(-200),
    agreed: apprentice.agreed + (entry.agreed ? weight : 0),
    total: apprentice.total + weight,
    commands: apprentice.commands,
    exams: apprentice.exams,
    examArmed: apprentice.examArmed,
    ghostHint: apprentice.ghostHint,
    ghostGoal: apprentice.ghostGoal
  };
}
function rankOf(apprentice) {
  return rankFor(apprentice.total === 0 ? 0 : apprentice.agreed / apprentice.total, apprentice.total);
}
function momentOf(view) {
  const p = view.player();
  const share3 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const awake = view.monsters().filter((m) => m.visible && !m.asleep).map((m) => m.id).sort((a, b) => a - b).join(",");
  return { awake, hpBand: share3 >= 0.9 ? 0 : share3 >= 0.6 ? 1 : share3 >= 0.35 ? 2 : 3, depth: p.depth };
}
function isDecisionPoint(previous, now, goal) {
  if (goal === null) return false;
  if (previous === null) return true;
  if (goal !== "explore") return true;
  return previous.awake !== now.awake || previous.hpBand !== now.hpBand || previous.depth !== now.depth;
}

// src/strategy/readiness.ts
var TV_FLASK = 27;
function namedCount(view, pattern) {
  return view.inventory().reduce((sum, item) => sum + (pattern.test(shownName2(item) ?? "") ? item.number : 0), 0);
}
function supplies(view) {
  const player = view.player();
  const light = view.equipment().find((item) => item !== null && item.tval === TV.LIGHT) ?? null;
  const permanent = light !== null && (light.artifact || light.flags.includes("NO_FUEL"));
  const workingLight = light !== null && (light.timeout > 0 || permanent);
  const lantern = light !== null && /\bLantern\b/i.test(shownName2(light) ?? "");
  const pack = readPack(view);
  const reliable = pack.escapeSpell.filter((spell) => spell.fail <= 15);
  const lastingLight = player.classFlags.includes("UNLIGHT") || player.objectFlags.includes("NO_FUEL") || permanent;
  return {
    cures: namedCount(view, /\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i),
    critical: namedCount(view, /\bPotions? of Cure Critical Wounds\b/i),
    serious: namedCount(view, /\bPotions? of Cure (Serious|Critical) Wounds\b/i),
    phase: namedCount(view, /\bScrolls? of Phase Door\b/i) + (reliable.some((spell) => /^(Phase Door|Blink|Shadow Shift)$/i.test(spell.name)) ? 2 : 0),
    escapes: namedCount(view, /\bScrolls? of (Teleportation|Teleport Level)\b/i) + view.inventory().reduce((sum, item) => {
      const name = shownName2(item) ?? "";
      const charges = /\((\d+) charges?\)/i.exec(name);
      return sum + (/\bStaff of Teleportation\b/i.test(name) && charges !== null ? Number(charges[1]) : 0);
    }, 0) + (reliable.some((spell) => /^(Teleport Self|Portal|Warp)$/i.test(spell.name)) ? 2 : 0),
    recall: namedCount(view, /\bScrolls? of Word of Recall\b/i),
    food: view.inventory().reduce((sum, item) => sum + (pack.food.some((food) => food.handle === item.handle) ? item.number : 0), 0),
    fuel: view.inventory().reduce((sum, item) => {
      const name = shownName2(item) ?? "";
      const matches = lantern ? item.tval === TV_FLASK && /\bFlasks? of Oil\b/i.test(name) : item.tval === TV.LIGHT && /\bWooden (Torch|Torches)\b/i.test(name) && item.timeout > 0;
      return sum + (matches ? item.number : 0);
    }, 0),
    lastingLight,
    workingLight
  };
}
function classFloor(cls, depth2) {
  if (depth2 < 5) {
    if (["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls)) return [50, 4];
    if (cls === "Rogue") return [50, 8];
    if (["Priest", "Druid"].includes(cls)) return [40, 9];
    return [60, 11];
  }
  if (["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls)) return [60, 6];
  if (cls === "Rogue") return [60, 10];
  if (["Priest", "Druid"].includes(cls)) return [60, 15];
  return [80, 15];
}
function missingPreparation(view, depth2) {
  if (depth2 <= 1) return [];
  const player = view.player();
  const stock = supplies(view);
  const level = Number.isFinite(player.maxLevel) ? player.maxLevel : player.level;
  const out = [];
  const need = (kind, enough, reason) => {
    if (!enough) out.push({ kind, reason });
  };
  const [hpFloor, classLevel] = depth2 >= 3 ? classFloor(player.cls, player.depth === 0 ? Math.min(depth2, 4) : depth2) : [30, 2];
  const caster = ["Mage", "Necromancer"].includes(player.cls);
  const levelFloor = Math.max(depth2, classLevel, depth2 >= 10 && caster && level <= 28 ? depth2 + 5 : 0);
  need("level", level >= levelFloor || level >= 50, `maximum character level ${String(levelFloor)}`);
  need("hp", player.maxHp >= hpFloor, `${String(hpFloor)} maximum hit points`);
  need("light", (depth2 >= 10 && player.cls !== "Necromancer" ? player.light >= 2 : stock.workingLight) || player.classFlags.includes("UNLIGHT"), depth2 >= 10 ? "light radius 2" : "working light");
  need("food", stock.food >= 5 && !hungry(view), "five food units and no hunger");
  if (depth2 >= 3 && level < 30) need("healing", stock.cures >= 2, "two Cure Light, Serious or Critical Wounds potions");
  if (depth2 >= 5) need("recall", stock.recall >= 1 && canRead(view), "one usable Word of Recall");
  if (depth2 >= 6) need("phase", stock.phase >= 1 && canRead(view), "one usable Phase Door");
  if (depth2 >= 10) {
    need("phase", stock.escapes >= (depth2 > 25 ? 6 : 2) && canRead(view), depth2 > 25 ? "six long escapes" : "two long escapes");
    if (level < 30) need("healing", depth2 > 25 ? stock.serious >= 10 : stock.critical >= 3, depth2 > 25 ? "ten Cure Serious or Critical Wounds potions" : "three Cure Critical Wounds potions");
    const detectsInvisible = detectionSources(view).some((source) => {
      if (!/^(Detection|Reveal Monsters)$|Rods? of Detection/i.test(source.name) || /charging/i.test(source.name)) return false;
      return source.kind !== "cast" || view.spellbooks().some((book) => book.spells.some((spell) => spell.sidx === source.sidx && spell.fail <= 15));
    });
    need("protection", player.objectFlags.includes("SEE_INVIS") || player.objectFlags.includes("TELEPATHY") || detectsInvisible, "See Invisible, telepathy or usable detection of invisible creatures");
  }
  if (depth2 >= 20) need("protection", player.objectFlags.includes("FREE_ACT"), "Free Action");
  if (depth2 > 20) {
    const inspect = view;
    const texts = view.equipment().flatMap((item) => item === null ? [] : [inspect.inspectItem?.(item.handle)?.text ?? ""]);
    const has = (element) => texts.some((text) => [...text.matchAll(/Provides (?:(?:resistance|immunity) to|protection from) ([^.\n]+)/gi)].some((line) => new RegExp(`\\b${element}\\b`, "i").test(line[1] ?? "")));
    const basics = ["acid", "lightning", "fire", "cold"].filter(has);
    need("protection", has("fire") && basics.length >= (depth2 > 25 ? 4 : 3), depth2 > 25 ? "all four basic resistances" : "fire resistance and two other basic resistances");
    need("protection", player.stats.length >= 5 && [0, 3, 4, ...caster ? [1] : ["Priest", "Druid", "Paladin"].includes(player.cls) ? [2] : []].every((index) => (player.stats[index] ?? 0) >= 7), "Strength, Dexterity, Constitution and the casting stat at least 7");
    if (depth2 >= 40) need("protection", has("poison") && has("confusion"), "poison and confusion resistance");
    if (depth2 >= 56) need("protection", has("blindness"), "blindness resistance");
    if (depth2 >= 60) need("protection", has("chaos") && has("disenchantment"), "chaos and disenchantment resistance");
  }
  if (depth2 >= 46) {
    need("hp", player.maxHp >= 500, "500 maximum hit points");
    const speed = depth2 >= 81 ? 20 : depth2 >= 60 ? 10 : 5;
    need("protection", player.speed >= 110 + speed, `+${String(speed)} speed`);
    need("healing", namedCount(view, /\bPotions? of (\*?Healing\*?|Life)\b/i) > 0, "large healing");
    if (level < 50) need("protection", player.objectFlags.includes("HOLD_LIFE"), "Hold Life before maximum character level 50");
  }
  if (depth2 >= 56) {
    need("protection", player.objectFlags.includes("TELEPATHY"), "telepathy");
    need("healing", namedCount(view, /\bPotions? of Healing\b/i) >= 2 || namedCount(view, /\bPotions? of (\*Healing\*|Life)/i) >= 1, "two Healing potions or one *Healing* or Life potion");
  }
  if (depth2 >= 100) {
    need("healing", namedCount(view, /\bPotions? of Healing\b/i) >= 5, "five Healing potions");
    need("healing", namedCount(view, /\bPotions? of (\*Healing\*|Life)/i) >= 15, "fifteen *Healing* or Life potions");
    need("protection", namedCount(view, /\bPotions? of Speed\b/i) >= 10, "ten Speed potions");
    if (player.maxSp > 100) need("healing", namedCount(view, /\bPotions? of Restore Mana\b/i) >= 15, "fifteen Restore Mana potions");
  }
  return out;
}
function missingEssentials(view) {
  const stock = supplies(view);
  const out = [];
  if (stock.cures < 2) out.push({ kind: "healing", reason: "two healing potions" });
  if (stock.phase < 2 || !canRead(view)) out.push({ kind: "phase", reason: "two usable Phase Doors" });
  if (stock.food < 2) out.push({ kind: "food", reason: "two food units" });
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel < 2)) out.push({ kind: "light", reason: "working light and two fuel units" });
  return out;
}
function supplyMargin(view) {
  const player = view.player();
  if (player.depth === 0) return null;
  const stock = supplies(view);
  if (stock.food <= (player.depth === 1 ? 1 : 3) || hungry(view)) return "food";
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel <= 1)) return "light and fuel";
  if (player.depth <= 2) return null;
  if (stock.cures < (player.depth >= 10 ? 4 : player.depth >= 6 ? 2 : 1)) return "healing";
  if (stock.phase < (player.depth >= 6 ? 2 : 1)) return "Phase Door";
  if (player.depth >= 10 && stock.escapes <= 2) return "long escapes";
  return null;
}

// src/gear/compare.ts
var TV = Object.freeze({
  SHOT: 2,
  ARROW: 3,
  BOLT: 4,
  BOW: 5,
  DIGGING: 6,
  HAFTED: 7,
  POLEARM: 8,
  SWORD: 9,
  BOOTS: 10,
  GLOVES: 11,
  HELM: 12,
  CROWN: 13,
  SHIELD: 14,
  CLOAK: 15,
  SOFT_ARMOR: 16,
  HARD_ARMOR: 17,
  DRAG_ARMOR: 18,
  LIGHT: 19,
  AMULET: 20,
  RING: 21
});
var GEAR_WEIGHTS = {
  ac: 0.5,
  toHit: 1,
  toDam: 1.5,
  blows: 0.2,
  shots: 0.2,
  speed: 5,
  maxHp: 0.2,
  maxSp: 0.7,
  light: 3,
  resist: 6,
  threshold: 2
};
var WEAPONS = [TV.DIGGING, TV.HAFTED, TV.POLEARM, TV.SWORD];
var BODY = [TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR];
var HEAD = [TV.HELM, TV.CROWN];
var LOW_FUEL_TURNS = 500;
var WEARABLE = [...WEAPONS, TV.BOW, TV.BOOTS, TV.GLOVES, ...HEAD, TV.SHIELD, TV.CLOAK, ...BODY, TV.LIGHT, TV.AMULET, TV.RING];
function slot(tval) {
  if (WEAPONS.includes(tval)) return "weapon";
  if (BODY.includes(tval)) return "body";
  if (HEAD.includes(tval)) return "head";
  return { [TV.BOW]: "bow", [TV.BOOTS]: "boots", [TV.GLOVES]: "gloves", [TV.SHIELD]: "shield", [TV.CLOAK]: "cloak", [TV.LIGHT]: "light", [TV.AMULET]: "amulet", [TV.RING]: "ring" }[tval] ?? null;
}
function fullyKnown(name) {
  const marks = [...name.matchAll(/\{([^}]*)\}/g)].flatMap((match) => (match[1] ?? "").toLowerCase().split(/,\s*/));
  return marks.every((mark) => mark === "cursed" || mark === "ignore") && (/\([+-]?\d+,[+-]?\d+\)/.test(name) || /\[\d+,[+-]?\d+\]/.test(name) || /^(?:an?|the|\d+)\s+(?:Rings?|Amulets?) of (?:Free Action|See Invisible|Telepathy)$/i.test(name));
}
function sameKind(a, b) {
  const plain = (name) => name.toLowerCase().replace(/\(\d+ turns\)/g, "").replace(/^(an?|the|\d+)\s+/, "").replace(/(?:es|s)(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
  return plain(a) === plain(b);
}
function cursed(name) {
  return /\{[^}]*curs[^}]*\}|\bcursed\b/i.test(name);
}
function wornFor(item, equipment) {
  const kind = slot(item.tval);
  if (kind === null) return null;
  const matching = equipment.filter((worn) => worn !== null && slot(worn.tval) === kind);
  if (kind === "ring" && matching.length < 2) return null;
  return matching[0] ?? null;
}
function keepsLauncher(equipment, after, hasAmmo) {
  if (!hasAmmo || !equipment.some((worn) => worn?.tval === TV.BOW)) return true;
  return after.some((worn) => worn?.tval === TV.BOW);
}
function visibleBase(name, tval) {
  if (tval === TV.LIGHT && /\(0 turns\)/i.test(name)) return 0;
  if (tval === TV.LIGHT) return /\bLanterns?\b/i.test(name) ? 2 : /\bTorch(?:es)?\b/i.test(name) ? 1 : null;
  if (tval === TV.BOW) {
    const match = /\(x(\d+)\)/.exec(name);
    return match === null ? null : Number(match[1]);
  }
  if ([...BODY, ...HEAD, TV.BOOTS, TV.GLOVES, TV.SHIELD, TV.CLOAK].includes(tval)) {
    const match = /\[(\d+)(?:,[+-]?\d+)?\]/.exec(name);
    return match === null ? null : Number(match[1]);
  }
  if (WEAPONS.includes(tval)) {
    const match = /\((\d+)d(\d+)\)/.exec(name);
    return match === null ? null : Number(match[1]) * (Number(match[2]) + 1) / 2;
  }
  return null;
}
function visibleValue(name, tval, base) {
  if ([...BODY, ...HEAD, TV.BOOTS, TV.GLOVES, TV.SHIELD, TV.CLOAK].includes(tval)) {
    return base + Number(/\[\d+,([+-]?\d+)\]/.exec(name)?.[1] ?? 0);
  }
  if (WEAPONS.includes(tval) || tval === TV.BOW) {
    const plus = /\(([+-]?\d+),([+-]?\d+)\)/.exec(name);
    return base + Number(plus?.[2] ?? 0) + Number(plus?.[1] ?? 0) * 0.3;
  }
  return base;
}
function loadoutDamage(loadout) {
  const weapon = loadout.equipment.find((item) => item !== null && WEAPONS.includes(item.tval));
  if (weapon === void 0 || weapon === null) return null;
  return weaponDamage(shownName2(weapon) ?? "", loadout.player.toDam, loadout.player.blows / 100);
}
function loadoutMissileDamage(loadout, view) {
  const bow = loadout.equipment.find((item) => item?.tval === TV.BOW);
  if (bow === void 0 || bow === null) return null;
  const name = shownName2(bow) ?? "";
  const kind = /Crossbow/i.test(name) ? TV.BOLT : /Sling/i.test(name) ? TV.SHOT : /Bow/i.test(name) ? TV.ARROW : -1;
  const quiver = view?.quiver?.() ?? [];
  const ammo = [...loadout.inventory ?? [], ...quiver].filter((item) => item.tval === kind);
  const mult = loadout.stats.ammoMult > 0 ? loadout.stats.ammoMult : Number(/\(x(\d+)\)/.exec(name)?.[1] ?? 0);
  const bonus = Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
  const damages = ammo.flatMap((item) => {
    const damage = weaponDamage(shownName2(item) ?? "", bonus, loadout.player.shots / 10);
    return damage === null || mult <= 0 ? [] : [damage * mult];
  });
  return damages.length === 0 ? null : Math.max(...damages);
}
function loadoutView(view, loadout) {
  return {
    ...view,
    player: () => ({ ...loadout.player, sp: Math.min(view.player().sp, loadout.player.maxSp) }),
    equipment: () => [...loadout.equipment],
    inventory: () => [...loadout.inventory ?? view.inventory()],
    inspectItem: () => ({ token: view.inputToken?.() ?? { epoch: 0, revision: 0 }, title: "", text: loadout.stats.resistElements.filter((_, i) => (loadout.stats.resists[i] ?? 0) > 0).map((element) => `Provides resistance to ${element === "ELEC" ? "lightning" : element}.`).join(" ") })
  };
}
function keepsCapacity(view, result) {
  if (result.unresolved.length > 0) return false;
  const before = result.before.player;
  const after = result.after.player;
  if (result.before.equipment.some((item) => item?.tval === TV.BOW) && !result.after.equipment.some((item) => item?.tval === TV.BOW)) return false;
  if (["FREE_ACT", "SEE_INVIS", "TELEPATHY"].some((flag) => before.objectFlags.includes(flag) && !after.objectFlags.includes(flag))) return false;
  if (before.light > 0 && after.light <= 0 && !after.classFlags.includes("UNLIGHT")) return false;
  if (!result.before.stats.heavyWield && result.after.stats.heavyWield || !result.before.stats.heavyShoot && result.after.stats.heavyShoot) return false;
  const oldDamage = loadoutDamage(result.before);
  const newDamage = loadoutDamage(result.after);
  if (oldDamage !== null && (newDamage === null || oldDamage > 0 && newDamage <= 0)) return false;
  const oldMissile = loadoutMissileDamage(result.before, view);
  const newMissile = loadoutMissileDamage(result.after, view);
  if (oldMissile !== null && (newMissile === null || oldMissile > 0 && newMissile <= 0)) return false;
  const reserve = escapeMana(view);
  const attacks = readPack({ ...view, player: () => ({ ...before, sp: before.maxSp }) }).attackSpell.filter((spell) => spell.fail <= 25);
  const manaFloor = attacks.length === 0 ? reserve : reserve + Math.min(...attacks.map((spell) => spell.mana));
  if (before.maxSp > 0 && (after.maxSp <= 0 || before.maxSp >= manaFloor && after.maxSp < manaFloor)) return false;
  const depth2 = Math.max(view.player().depth + 1, view.player().maxDepth);
  const has = (loadout, element) => {
    const index = loadout.stats.resistElements.findIndex((name) => name.toUpperCase() === element);
    return index >= 0 && (loadout.stats.resists[index] ?? 0) > 0;
  };
  if (depth2 > 20) {
    const basics = ["ACID", "ELEC", "FIRE", "COLD"];
    if (has(result.before, "FIRE") && !has(result.after, "FIRE")) return false;
    const required = depth2 > 25 ? 4 : 3;
    if (depth2 > 25 && basics.some((element) => has(result.before, element) && !has(result.after, element))) return false;
    if (basics.filter((element) => has(result.before, element)).length >= required && basics.filter((element) => has(result.after, element)).length < required) return false;
    if (depth2 >= 40 && ["POIS", "CONFU"].some((element) => has(result.before, element) && !has(result.after, element))) return false;
  }
  const missingBefore = new Set(missingPreparation(loadoutView(view, result.before), depth2).map((need) => need.reason));
  return !missingPreparation(loadoutView(view, result.after), depth2).some((need) => !missingBefore.has(need.reason));
}
function equipmentValue(result, view) {
  const damageBefore = loadoutDamage(result.before);
  const damageAfter = loadoutDamage(result.after);
  const damage = damageBefore === null || damageAfter === null ? 0 : damageAfter - damageBefore;
  const missileBefore = loadoutMissileDamage(result.before, view);
  const missileAfter = loadoutMissileDamage(result.after, view);
  const missile = missileBefore === null || missileAfter === null ? 0 : missileAfter - missileBefore;
  const d = result.delta;
  return (damage + missile) * 4 + d.speed * 5 + d.maxSp * 2 + d.ac * 0.5 + d.toH + d.maxHp * 0.2 + d.light * 3 + d.resists.reduce((sum, value) => sum + value, 0) * 6 + result.after.player.objectFlags.filter((flag) => ["FREE_ACT", "SEE_INVIS", "TELEPATHY"].includes(flag) && !result.before.player.objectFlags.includes(flag)).length * 20;
}
function simulated(view, name, handle, result) {
  if (result.unresolved.length > 0 || result.placements.length === 0) return null;
  if (!keepsCapacity(view, result)) return null;
  const score = equipmentValue(result, view);
  if (score <= GEAR_WEIGHTS.threshold) return null;
  const before = result.before.player;
  const after = result.after.player;
  const changes = [];
  const note2 = (label, a, b) => {
    if (a !== b) changes.push(`${label} ${String(b)} instead of ${String(a)}`);
  };
  const oldDamage = loadoutDamage(result.before);
  const newDamage = loadoutDamage(result.after);
  if (oldDamage !== null && newDamage !== null) note2("melee damage per action", oldDamage, newDamage);
  else changes.push("melee damage per action is unknown");
  const oldMissile = loadoutMissileDamage(result.before, view);
  const newMissile = loadoutMissileDamage(result.after, view);
  if (oldMissile !== null && newMissile !== null) note2("missile damage per action", oldMissile, newMissile);
  note2("armour class", before.ac, after.ac);
  note2("to-hit", before.toHit, after.toHit);
  note2("to-damage", before.toDam, after.toDam);
  note2("blows", before.blows, after.blows);
  note2("shots", before.shots, after.shots);
  note2("speed", before.speed, after.speed);
  note2("maximum hit points", before.maxHp, after.maxHp);
  note2("maximum mana", before.maxSp, after.maxSp);
  note2("light radius", before.light, after.light);
  result.after.stats.resistElements.forEach((element, i) => {
    const old = result.before.stats.resists[i] ?? 0;
    const now = result.after.stats.resists[i] ?? 0;
    if (old !== now) changes.push(`${element} resistance ${String(now)} instead of ${String(old)}`);
  });
  const lostFlags = before.objectFlags.filter((flag) => !after.objectFlags.includes(flag));
  const gainedFlags = after.objectFlags.filter((flag) => !before.objectFlags.includes(flag));
  const flagName = (flag) => ({ FREE_ACT: "Free Action", SEE_INVIS: "See Invisible", TELEPATHY: "telepathy" })[flag] ?? flag.toLowerCase().replaceAll("_", " ");
  if (gainedFlags.length > 0) changes.push(`gains ${gainedFlags.map(flagName).join(", ")}`);
  if (lostFlags.length > 0) changes.push(`loses ${lostFlags.map(flagName).join(", ")}`);
  const safeUpgrade = lostFlags.length === 0 && result.delta.resists.every((change) => change >= 0) && after.speed >= before.speed && after.maxSp >= before.maxSp && after.maxHp >= before.maxHp && after.ac >= before.ac && after.toHit >= before.toHit && after.shots >= before.shots && (oldDamage === null && newDamage === null || oldDamage !== null && newDamage !== null && newDamage >= oldDamage) && (oldMissile === null && newMissile === null || oldMissile !== null && newMissile !== null && newMissile >= oldMissile);
  return { handle, name, score, unknown: false, safeUpgrade, criteria: `Wear ${name}: ${changes.join(", ")}.` };
}
function gearCandidates(view) {
  const equipment = view.equipment();
  const ammoTypes = [TV.SHOT, TV.ARROW, TV.BOLT];
  const hasAmmo = view.inventory().some((item) => ammoTypes.includes(item.tval));
  const out = [];
  for (const item of view.inventory()) {
    const name = shownName2(item);
    if (name === null || !WEARABLE.includes(item.tval) || cursed(name)) continue;
    if (item.tval === TV.LIGHT && /\(0 turns\)/i.test(name)) continue;
    const replaced = wornFor(item, equipment);
    if (replaced !== null && cursed(shownName2(replaced) ?? "")) continue;
    if (item.tval === TV.LIGHT && !/\{\?\?\}/.test(name)) {
      const oldLight = replaced === null ? null : shownName2(replaced) ?? "";
      const fuel = (shown) => Number(/\((\d+) turns\)/i.exec(shown)?.[1] ?? Infinity);
      const safeLight = () => {
        const result = view.simulateLoadout?.({ wield: [{ from: "gear", handle: item.handle }] });
        if (result !== void 0 && result !== null) return keepsCapacity(view, result);
        return replaced === null || !view.player().objectFlags.some((flag) => ["FREE_ACT", "SEE_INVIS", "TELEPATHY"].includes(flag));
      };
      if (oldLight === null || fuel(oldLight) === 0) {
        if (!safeLight()) continue;
        out.push({
          handle: item.handle,
          name,
          score: 100,
          unknown: false,
          criteria: `Wield ${name}. The character has no light, so it cannot see new ground or creatures.`
        });
        continue;
      }
      if (sameKind(oldLight, name) && fuel(oldLight) < LOW_FUEL_TURNS && fuel(name) > fuel(oldLight)) {
        if (!safeLight()) continue;
        out.push({
          handle: item.handle,
          name,
          score: 50,
          unknown: false,
          criteria: `Wield ${name}. The light in use is nearly out of fuel.`
        });
        continue;
      }
    }
    if (fullyKnown(name) && view.simulateLoadout !== void 0) {
      const result = view.simulateLoadout({ wield: [{ from: "gear", handle: item.handle }] });
      if (result !== null) {
        if (!keepsLauncher(equipment, result.after.equipment, hasAmmo)) continue;
        if (result.placements.some((place) => place.displaced !== null && cursed(shownName2(place.displaced) ?? ""))) continue;
        const candidate = simulated(view, name, item.handle, result);
        if (candidate !== null) out.push(candidate);
        continue;
      }
    }
    const base = visibleBase(name, item.tval);
    if (replaced !== null && (view.player().objectFlags.some((flag) => ["FREE_ACT", "SEE_INVIS", "TELEPATHY"].includes(flag)) || Math.max(view.player().depth, view.player().maxDepth) >= 20)) continue;
    const oldName = replaced === null ? null : shownName2(replaced);
    const oldBase = oldName === null || replaced === null ? null : visibleBase(oldName, replaced.tval);
    const visible = base === null ? null : visibleValue(name, item.tval, base);
    const oldVisible = oldBase === null || oldName === null || replaced === null ? null : visibleValue(oldName, replaced.tval, oldBase);
    if (visible !== null && oldVisible !== null && visible < oldVisible) continue;
    if (oldName !== null && sameKind(oldName, name) && base === oldBase) continue;
    const metric = item.tval === TV.LIGHT ? "light radius" : item.tval === TV.BOW ? "launcher multiplier" : WEAPONS.includes(item.tval) ? "base damage" : "base armour class";
    const detail = base !== null && oldBase !== null && base > oldBase ? ` Its shown ${metric} is ${String(base)} instead of ${String(oldBase)}.` : "";
    out.push({
      handle: item.handle,
      name,
      score: visible !== null && oldVisible !== null ? visible - oldVisible : 0,
      unknown: true,
      criteria: `Try on the unknown ${name} to learn what it does.${detail}`
    });
  }
  return out.sort((a, b) => Number(a.unknown) - Number(b.unknown) || b.score - a.score);
}

// src/persona/blend.ts
function valid(value) {
  return value !== void 0 && Number.isFinite(value) && value > 0 ? value : 0;
}
function normalized(dist) {
  const total = Object.values(dist).reduce((sum, value) => sum + valid(value), 0);
  const result = {};
  for (const [key2, value] of Object.entries(dist)) result[key2] = total > 0 ? valid(value) / total : 0;
  return result;
}
function blend(best, inCharacter, strength01) {
  const strength = Number.isFinite(strength01) ? Math.max(0, Math.min(1, strength01)) : 0;
  const a = normalized(best);
  const b = normalized(inCharacter);
  const combined = {};
  for (const key2 of /* @__PURE__ */ new Set([...Object.keys(best), ...Object.keys(inCharacter)])) {
    combined[key2] = (1 - strength) * (a[key2] ?? 0) + strength * (b[key2] ?? 0);
  }
  return normalized(combined);
}
function jitteredStrength(persona, rng) {
  const draw = rng();
  const unit5 = Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 0.5;
  return Math.max(0, Math.min(1, persona.sliders.strength / 100 + (unit5 * 2 - 1) * persona.sliders.volatility / 400));
}
function riskCeiling(persona) {
  return 0.6 - persona.sliders.selfpreservation * 5e-3;
}
var NONE_OF_THESE = "none_of_these";
function applySafetyFloor(dist, risk, ceiling, deathWish) {
  const keys = Object.keys(dist);
  const removed = deathWish ? [] : keys.filter((key2) => (risk[key2] ?? 0) > ceiling);
  const real = keys.filter((key2) => key2 !== NONE_OF_THESE);
  if (real.length > 0 && real.every((key2) => removed.includes(key2))) {
    let safest = real[0];
    for (const key2 of real.slice(1)) if ((risk[key2] ?? 0) < (risk[safest] ?? 0)) safest = key2;
    removed.splice(removed.indexOf(safest), 1);
  }
  const kept = {};
  for (const key2 of keys) if (!removed.includes(key2)) kept[key2] = valid(dist[key2]);
  const result = normalized(kept);
  if (Object.keys(result).length > 0 && Object.values(result).every((value) => value === 0)) {
    const first = Object.keys(result)[0];
    result[first] = 1;
  }
  return { dist: result, removed };
}
function pick(dist) {
  let choice2;
  let highest = -Infinity;
  for (const [key2, probability] of Object.entries(dist)) {
    if (probability > highest) {
      choice2 = key2;
      highest = probability;
    }
  }
  return choice2;
}

// src/persona/quirks.ts
function shiftThreat(bandIndex, bands, persona, rng) {
  if (bands <= 0) return 0;
  let shifted = Math.round(bandIndex);
  if (persona.sliders.optimism >= 70) shifted -= 1;
  else if (persona.sliders.optimism <= 30) shifted += 1;
  const delusion = persona.quirks.delusional;
  if (delusion.on && rng() < delusion.strength / 200) shifted += rng() < 0.5 ? -1 : 1;
  return Math.max(0, Math.min(bands - 1, shifted));
}
function forget(lessons, persona, rng) {
  const quirk = persona.quirks.forgetful;
  return quirk.on ? lessons.filter(() => rng() >= quirk.strength / 200) : [...lessons];
}
function mustPickUp(persona) {
  return persona.quirks.compulsive.on;
}
function fleesFromNew(persona) {
  return persona.quirks.cowardice.on;
}
var LOOK_BASE = 8;
function lookReach(persona, money) {
  if (persona === null) return LOOK_BASE;
  const { curiosity, greed, boldness, selfpreservation, paranoia } = persona.sliders;
  const lean = curiosity - 50 + (greed - 50) * (money ? 1 : 0.5) + (boldness - 50) / 2 - (selfpreservation - 50) / 2 - (paranoia - 50) / 2;
  return Math.max(0, LOOK_BASE + Math.floor(lean / 2));
}
function nudgeUnseen(dist, offers, persona, damage, hp, ceiling) {
  const result = { ...dist };
  const { boldness, pride, paranoia, selfpreservation, strength } = persona.sliders;
  const fear = (paranoia + selfpreservation + 100 - boldness + 100 - pride) / 400 + (persona.quirks.cowardice.on ? persona.quirks.cowardice.strength / 100 : 0);
  const pressure = Math.min(1, damage / Math.max(1, hp)) * strength / 100;
  for (const offer of offers) {
    if (offer.risk > ceiling) continue;
    const response = ["unseen_staff", "unseen_rod", "detect", "see_invisible", "light_room", "retreat", "leave_level", "phase", "teleport"].includes(offer.goal);
    const advance2 = ["swing_unseen", "cast_area", "unseen_wand", "explore", "descend", "fight", "shoot", "cast_attack"].includes(offer.goal);
    if (response || advance2) result[offer.goal] = (result[offer.goal] ?? 0) * Math.exp(pressure * (response ? fear * 2 : 1 - fear * 2));
  }
  return result;
}

// src/persona/state.ts
function traitWord(id, scale2, value) {
  const [low, high] = scale2.split(" to ");
  const word = id === "boldness" && value > 50 ? "bold" : value < 50 ? low : high;
  return `${Math.abs(value - 50) >= 30 ? "very" : "somewhat"} ${word}`;
}
var NATURE_GROUPS = /* @__PURE__ */ new Set(["temperament", "values", "habits", "tactics", "economy"]);
function personaState(persona, budgetTokens) {
  const state = {};
  const traits = [];
  const activeQuirks = [];
  for (const parameter of PARAMETERS) {
    if (parameter.kind === "slider") {
      if (!NATURE_GROUPS.has(parameter.group)) continue;
      const value = persona.sliders[parameter.id];
      if (Math.abs(value - 50) >= 15) traits.push(`${parameter.name}: ${traitWord(parameter.id, parameter.scale, value)}`);
    } else if (parameter.kind === "list") {
      if (persona.lists[parameter.id].length > 0) state[parameter.id] = persona.lists[parameter.id].join(", ");
    } else if (parameter.kind === "quirk" && persona.quirks[parameter.id].on) {
      activeQuirks.push(parameter.name.toLowerCase());
    }
  }
  if (traits.length > 0) state["traits"] = traits.join("; ");
  if (activeQuirks.length > 0) state["quirks"] = activeQuirks.join(", ");
  const tokens = Math.max(0, Math.min(persona.backstoryCap, Number.isFinite(budgetTokens) ? budgetTokens : 0));
  const limit = Math.floor(tokens * 4 * persona.sliders.backstory / 100);
  if (limit > 0 && persona.backstory.trim()) {
    let excerpt = persona.backstory.trim().slice(0, limit);
    if (excerpt.length < persona.backstory.trim().length) {
      const boundary = Math.max(excerpt.lastIndexOf(". "), excerpt.lastIndexOf("! "), excerpt.lastIndexOf("? "));
      if (boundary >= Math.floor(excerpt.length / 2)) excerpt = excerpt.slice(0, boundary + 1);
    }
    if (excerpt) state["backstory"] = excerpt;
  }
  return state;
}
function inCharacterInstructions(persona) {
  return `Which option would ${persona.name} choose, given this character's nature and history? Answer as the character would act, even when another option seems wiser.`;
}

// src/settings.ts
function defaultCfg() {
  return {
    errandAutofight: true,
    errandAutoexplore: true,
    errandCampaign: false,
    useModel: true,
    stopOnLowHealth: true,
    stopOnNewCreature: true,
    wakeSleepers: false,
    collect: true,
    descend: true,
    retreatFraction: DEFAULT_RETREAT_PERCENT / 100,
    errandSteps: DEFAULT_ERRAND_STEPS,
    idleSteps: 3
  };
}
var RULE_CFG = {
  "squire.errandAutofight": "errandAutofight",
  "squire.errandAutoexplore": "errandAutoexplore",
  "squire.errandCampaign": "errandCampaign",
  "squire.useModel": "useModel",
  "squire.stopOnLowHealth": "stopOnLowHealth",
  "squire.stopOnNewCreature": "stopOnNewCreature",
  "squire.wakeSleepers": "wakeSleepers",
  "squire.collect": "collect",
  "squire.descend": "descend"
};
var RETREAT_PERCENT_SETTING = "squire.retreatPercent";
var ERRAND_STEPS_SETTING = "squire.errandSteps";
var DEFAULT_RETREAT_PERCENT = 50;
var MIN_RETREAT_PERCENT = 10;
var MAX_RETREAT_PERCENT = 90;
var DEFAULT_ERRAND_STEPS = 200;
var MIN_ERRAND_STEPS = 50;
var MAX_ERRAND_STEPS = 500;
function cfgFromFlags(flags, settings) {
  const cfg = defaultCfg();
  for (const [flag, field] of Object.entries(RULE_CFG)) {
    const value = flags[flag];
    if (typeof value === "boolean") cfg[field] = value;
  }
  const retreatPercent = settings?.get(RETREAT_PERCENT_SETTING);
  const errandSteps = settings?.get(ERRAND_STEPS_SETTING);
  if (typeof retreatPercent === "number" && Number.isFinite(retreatPercent)) {
    cfg.retreatFraction = Math.min(MAX_RETREAT_PERCENT, Math.max(MIN_RETREAT_PERCENT, retreatPercent)) / 100;
  }
  if (typeof errandSteps === "number" && Number.isFinite(errandSteps)) {
    cfg.errandSteps = Math.round(Math.min(MAX_ERRAND_STEPS, Math.max(MIN_ERRAND_STEPS, errandSteps)));
  }
  return cfg;
}
function changedFrom(cfg) {
  const stock = defaultCfg();
  return [
    ...Object.values(RULE_CFG).filter((field) => stock[field] !== cfg[field]).map((field) => `${field}=${String(cfg[field])}`),
    ...stock.retreatFraction === cfg.retreatFraction ? [] : [`retreatPercent=${String(Math.round(cfg.retreatFraction * 100))}`],
    ...stock.errandSteps === cfg.errandSteps ? [] : [`errandSteps=${String(cfg.errandSteps)}`]
  ].sort();
}

// src/town/shop.ts
var PRIORITY = ["healing", "phase", "food", "light", "escape", "recall", "oil", "ammo"];
function storesFor(kind) {
  return kind === "healing" || kind === "phase" || kind === "escape" || kind === "recall" ? ["Alchemy Shop"] : ["General Store"];
}
function shoppingList(needs, store, gold, persona) {
  if (store.isHome) return [];
  const reserve = Math.floor(gold * Math.max(0, (persona?.sliders.savings ?? 50) - 50) / 200);
  let left = Math.max(0, gold);
  const out = [];
  const starterBought = /* @__PURE__ */ new Map();
  const stockBought = /* @__PURE__ */ new Map();
  for (const target of [1, 2]) {
    for (const kind of ["healing", "phase", "food", "light"]) {
      const need = needs.find((entry) => entry.kind === kind);
      const already = starterBought.get(kind) ?? 0;
      if (need === void 0 || need.have + already >= Math.min(target, need.want) || !storesFor(kind).includes(store.featName)) continue;
      const ware = store.stock.find((item) => {
        const name = shownName2(item);
        return name !== null && matchesSupplyName(name, need.name) && item.number > (stockBought.get(item.index) ?? 0) && item.price !== void 0 && item.price > 0 && item.price <= left;
      });
      if (ware === void 0 || ware.price === void 0) continue;
      out.push({ index: ware.index, quantity: 1, kind, name: shownName2(ware) ?? need.name });
      left -= ware.price;
      starterBought.set(kind, already + 1);
      stockBought.set(ware.index, (stockBought.get(ware.index) ?? 0) + 1);
    }
  }
  if (out.length > 0) return out;
  const bought = /* @__PURE__ */ new Set();
  for (const kind of PRIORITY) {
    const need = needs.find((entry) => entry.kind === kind);
    if (need === void 0 || need.have >= need.want || !storesFor(kind).includes(store.featName)) continue;
    const ware = store.stock.find((item) => {
      const name = shownName2(item);
      return !bought.has(item.index) && name !== null && matchesSupplyName(name, need.name) && item.price !== void 0 && item.price > 0;
    });
    if (ware === void 0 || ware.price === void 0) continue;
    const budget = kind === "recall" ? left : Math.max(0, left - reserve);
    const sameFuel = kind === "light" && need.name === "Flask of Oil" ? needs.find((entry) => entry.kind === "oil") : void 0;
    const deficit = Math.max(need.want - need.have, sameFuel === void 0 ? 0 : sameFuel.want - sameFuel.have);
    const quantity = Math.min(deficit, ware.number, Math.floor(budget / ware.price));
    if (quantity <= 0) continue;
    out.push({ index: ware.index, quantity, kind, name: shownName2(ware) ?? need.name });
    left -= quantity * ware.price;
    bought.add(ware.index);
  }
  return out;
}
function mightBeSpecial(name) {
  return /\{\?\?\}/.test(name) || /'[^']+'/.test(name) || /(?<!\b(?:Pair|Set))\s+of\s+/i.test(name);
}
function sellList(_pack, view, persona, trophies = /* @__PURE__ */ new Set()) {
  if (persona === null || persona.sliders.selling < 60) return [];
  const worn = new Set(view.equipment().filter((item) => item !== null).map((item) => item.handle));
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const upgrades = new Set(gearCandidates(view).filter((candidate) => !candidate.unknown).map((candidate) => candidate.handle));
  for (const item of view.inventory()) {
    const name = shownName2(item);
    if (name === null || worn.has(item.handle) || mightBeSpecial(name) || upgrades.has(item.handle)) continue;
    const type = /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling|Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)s?\b/i.exec(name)?.[1];
    if (type === void 0) continue;
    if (persona.lists.weapons.some((favoured) => name.toLowerCase().includes(favoured.toLowerCase()))) continue;
    if (seen.has(type.toLowerCase())) {
      const result = view.simulateLoadout?.({ release: [{ handle: item.handle, number: item.number }] });
      if (result !== void 0 && result !== null && (!keepsCapacity(view, result) || result.after.player.speed < result.before.player.speed || result.after.player.maxSp < result.before.player.maxSp || (loadoutDamage(result.after) ?? 0) < (loadoutDamage(result.before) ?? 0) || (loadoutMissileDamage(result.after, view) ?? 0) < (loadoutMissileDamage(result.before, view) ?? 0))) continue;
      const quantity = item.number - (trophies.has(item.handle) ? 1 : 0);
      if (quantity > 0) out.push({ handle: item.handle, quantity, name });
    }
    seen.add(type.toLowerCase());
  }
  return out;
}
function saleFits(name, storeName) {
  return storeName === "Armoury" ? /\b(Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)s?\b/i.test(name) : storeName === "Weapon Smiths" && /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling)s?\b/i.test(name);
}

// src/town/memory.ts
function record2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function readStoreMemory(value) {
  if (!Array.isArray(value)) return [];
  const found = /* @__PURE__ */ new Set();
  return value.flatMap((entry) => {
    const raw = record2(entry);
    if (!number(raw["feat"]) || found.has(raw["feat"]) || !number(raw["turn"]) || !number(raw["lifetime"]) || raw["lifetime"] <= 0 || typeof raw["name"] !== "string" || !Array.isArray(raw["stock"])) return [];
    found.add(raw["feat"]);
    const stock = raw["stock"].flatMap((item) => {
      const ware = record2(item);
      return typeof ware["name"] === "string" && number(ware["tval"]) && number(ware["price"]) && number(ware["count"]) && ware["count"] > 0 ? [{ name: ware["name"], tval: ware["tval"], price: ware["price"], count: ware["count"] }] : [];
    });
    return [{ feat: raw["feat"], name: raw["name"], owner: typeof raw["owner"] === "string" ? raw["owner"] : null, turn: raw["turn"], lifetime: raw["lifetime"], stock }];
  });
}
function stockConfidence(memory, turn) {
  return Math.max(0, 1 - Math.max(0, turn - memory.turn) / memory.lifetime);
}
function wareName(name) {
  return name.replace(/^(?:a|an|the|\d+)\s+/i, "").toLowerCase().replace(/\btorches\b/g, "torch").replace(/\bknives\b/g, "knife").replace(/\bstaves\b/g, "staff").replace(/\b(\w+)s\b/g, "$1");
}
var LASTING_MEMORY = Number.MAX_SAFE_INTEGER;
function lifetime(view, persona, rng) {
  const forgetful = persona?.quirks.forgetful;
  if (persona === null || forgetful === void 0 || !forgetful.on) return LASTING_MEMORY;
  const day = 10 * (view.constants().storeTurns || 1e3);
  const sliders = persona.sliders;
  const habit = (sliders.patience + sliders.greed - sliders.impulsiveness - 50) / 200 - forgetful.strength / 100;
  return day * 2 * Math.max(0.25, 1 + jitteredStrength(persona, rng) * habit);
}
function createStoreMemory(initial = [], save = () => {
}, rng = Math.random) {
  let memories = [...initial];
  let entered = null;
  return {
    all: () => memories,
    reset() {
      memories = [];
      entered = null;
      save(memories);
    },
    observe(view, terrain, persona) {
      const player = view.player();
      const cell2 = view.cell(player.grid.x, player.grid.y);
      if (player.depth !== 0 || cell2 === null || !terrain.isShopEntrance(cell2.feat)) {
        entered = null;
        return { changed: false, entered: false, memory: null };
      }
      let store;
      try {
        store = view.stores().find((entry) => entry.feat === cell2.feat);
      } catch {
        return { changed: false, entered: false, memory: null };
      }
      if (store === void 0 || store.isHome) return { changed: false, entered: false, memory: null };
      const previous = memories.find((entry) => entry.feat === store.feat);
      const owner = store.owner?.name ?? null;
      const fresh = entered !== store.feat;
      entered = store.feat;
      const memory = {
        feat: store.feat,
        name: terrain.shopName(store.feat) ?? store.featName,
        owner,
        turn: view.turn(),
        lifetime: !fresh && previous?.owner === owner ? previous.lifetime : lifetime(view, persona, rng),
        stock: store.stock.flatMap((item) => {
          const name = shownName2(item);
          return name !== null && item.number > 0 && item.price !== void 0 && item.price > 0 ? [{ name, tval: item.tval, price: item.price, count: item.number }] : [];
        })
      };
      const changed = fresh || JSON.stringify(previous === void 0 ? void 0 : { ...previous, turn: memory.turn }) !== JSON.stringify(memory);
      if (changed) {
        memories = [...memories.filter((entry) => entry.feat !== memory.feat), memory];
        save(memories);
      }
      return { changed, entered: fresh, memory };
    }
  };
}

// src/strategy/pursuits.ts
var PURSUIT_FLOOR = 0.4;
var WIN_FLOOR = 0.15;
var WIN_STEPS = [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 99, 100];
var SAURON_DEPTH = 99;
var MORGOTH_DEPTH = 100;
function unit2(value) {
  return Math.max(0, Math.min(1, value / 100));
}
function rounded(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
function winWeight(persona) {
  if (persona === null) return rounded(WIN_FLOOR + 0.75 * 0.5 + 0.1 * 0.5);
  return rounded(WIN_FLOOR + 0.75 * unit2(persona.sliders.ambition) + 0.1 * unit2(persona.sliders.pride));
}
function winUrgency(weight) {
  return weight >= 0.8 ? "driven" : weight >= 0.55 ? "high" : weight >= 0.35 ? "moderate" : "low";
}
function winStep(maxDepth) {
  const depth2 = WIN_STEPS.find((step) => step > maxDepth) ?? MORGOTH_DEPTH;
  if (depth2 === SAURON_DEPTH) return { depth: depth2, text: "kill Sauron, the Sorcerer, on dungeon level 99" };
  if (depth2 === MORGOTH_DEPTH) return { depth: depth2, text: "kill Morgoth, Lord of Darkness, on dungeon level 100" };
  return { depth: depth2, text: `reach dungeon level ${String(depth2)} (${String(depth2 * 50)} ft)` };
}
function paceFactor(persona) {
  const ambition = persona === null ? 0.5 : unit2(persona.sliders.ambition);
  return ambition <= 0.5 ? 0.75 + ambition * 0.5 : 1 + (ambition - 0.5) * 0.7;
}
function pursuitsFor(persona, maxDepth, feelings = [], family = null) {
  const step = winStep(maxDepth);
  const win = {
    kind: "win",
    label: "win the game",
    weight: winWeight(persona),
    detail: `Defeat Sauron on dungeon level 99 and then Morgoth on dungeon level 100. The next step is to ${step.text}.`
  };
  if (persona === null) return [win];
  const s = persona.sliders;
  const out = [win];
  const add2 = (kind, label, weight, detail) => {
    if (weight >= PURSUIT_FLOOR) out.push({ kind, label, weight: rounded(weight), detail });
  };
  add2("riches", "get rich", 0.8 * unit2(s.greed) + 0.2 * unit2(s.savings), "Pick up gold and sellable loot, and detour for it when the detour is safe.");
  add2(
    "treasure",
    "collect artifacts and fine gear",
    0.4 * unit2(s.greed) + 0.3 * unit2(s.curiosity) + 0.3 * unit2(s.hoarding) + (persona.quirks.compulsive.on ? 0.15 : 0),
    "Look over every item on the floor and keep the best gear and any artifact."
  );
  add2(
    "sights",
    "see the dungeon",
    (0.45 * unit2(s.curiosity) + 0.45 * unit2(s.levelfeel) + 0.1 * unit2(s.patience)) * (1 - 0.3 * unit2(s.ambition)),
    "Explore each level and learn its feeling before taking the stairs."
  );
  add2("uniques", "hunt uniques", 0.6 * unit2(s.pride) + 0.4 * unit2(s.glory), "Fight uniques that can be beaten within the risk the character accepts.");
  const hated = persona.toggles.grudges ? feelings.filter((f) => f.unique && f.kind === "hatred").sort((a, b) => b.count - a.count)[0] : void 0;
  if (hated !== void 0) add2("grudge", `settle the grudge with ${hated.name}`, 0.45 + 0.3 * unit2(s.stubbornness) + 0.15 * unit2(s.boldness), `${hated.name} killed some of the family. Kill it when the fight can be won.`);
  if (family !== null && family.heir && family.deepest !== null && family.deepest > maxDepth) {
    add2("record", "beat the family's deepest level", 0.3 + 0.4 * unit2(s.pride) + 0.3 * unit2(s.ambition), `Go below dungeon level ${String(family.deepest)}, the deepest any ancestor reached.`);
  }
  add2("depth", "go deep for its own sake", 0.6 * unit2(s.boldness) + 0.4 * unit2(s.impulsiveness), "Take the stairs down whenever the character is ready for the next level.");
  add2("lineage", "keep the family line going", Math.max(0, (s.selfpreservation - 30) / 70) * 0.8 + (family?.heir === true ? 0.1 : 0), "Leave a fight early and walk out of the dungeon alive. A dead character has no heir to teach.");
  return out.sort((a, b) => b.weight - a.weight || (a.kind === "win" ? -1 : b.kind === "win" ? 1 : 0));
}
function pursuitWeight(pursuits, kind) {
  return pursuits.find((p) => p.kind === kind)?.weight ?? 0;
}
function pursuitFacts(pursuits) {
  const win = pursuits.find((p) => p.kind === "win");
  if (pursuits.length === 0) return {};
  return {
    goals: `Goals, most wanted first: ${pursuits.map((p) => `${p.label} (${p.weight >= 0.7 ? "strongly" : p.weight >= 0.5 ? "clearly" : "somewhat"} wanted)`).join(", ")}.`,
    ...win === void 0 ? {} : { win_urgency: `Winning the game matters ${winUrgency(win.weight) === "driven" ? "above everything" : winUrgency(win.weight) === "high" ? "a great deal" : winUrgency(win.weight) === "moderate" ? "somewhat" : "little"} to this character. ${win.detail}` }
  };
}
var ATTACKS = /* @__PURE__ */ new Set(["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"]);
var ESCAPES = /* @__PURE__ */ new Set(["phase", "teleport", "retreat", "leave_level", "heal", "cast_heal"]);
var PURSUIT_NUDGE = 0.6;
function nudgePursuits(dist, offers, pursuits, view, ceiling, escaping) {
  const out = { ...dist };
  if (pursuits.length === 0) return out;
  const w = (kind) => pursuitWeight(pursuits, kind);
  const player = view.player();
  const uniqueInSight = view.monsters().some((m) => m.visible && m.raceFlags.includes("UNIQUE"));
  const grudge = pursuits.find((p) => p.kind === "grudge");
  const grudgeInSight = grudge !== void 0 && view.monsters().some((m) => m.visible && grudge.label.endsWith(m.race));
  const awake = view.monsters().some((m) => m.visible && !m.asleep);
  for (const offer of offers) {
    if (offer.risk > ceiling) continue;
    const current2 = out[offer.goal];
    if (current2 === void 0) continue;
    let lift = 0;
    switch (offer.goal) {
      case "descend":
        if (!escaping) lift = 0.6 * w("win") + 0.4 * w("depth") + 0.4 * w("record") - 0.5 * w("sights") - 0.3 * w("lineage");
        break;
      case "recall_dungeon":
        lift = 0.5 * w("win") + 0.3 * w("record");
        break;
      case "explore":
        lift = 0.6 * w("sights") + 0.2 * w("treasure") + 0.2 * w("riches");
        break;
      case "fetch":
      case "pick_up":
        lift = 0.7 * w("riches") + 0.5 * w("treasure");
        break;
      case "study":
        lift = 0.2 * w("sights");
        break;
      default:
        if (ATTACKS.has(offer.goal)) lift = (uniqueInSight ? 0.7 * w("uniques") : 0) + (grudgeInSight ? 0.8 * w("grudge") : 0);
        else if (ESCAPES.has(offer.goal) && awake && player.hp < player.maxHp) lift = 0.5 * w("lineage");
    }
    out[offer.goal] = current2 * Math.max(0.4, 1 + PURSUIT_NUDGE * lift);
  }
  return out;
}

// src/strategy/aims.ts
var FIXED_ORDER = ["spellbook", "lantern", "armour", "weapon", "free-action", "see-invisible", "preparation", "depth", "win", "avenge"];
var BOOK_LOOKAHEAD = 5;
var FREE_ACTION_DEPTH = 20;
var SEE_INVISIBLE_DEPTH = 10;
var PROTECTION_LEAD = 5;
var WEAPONS2 = [TV.HAFTED, TV.POLEARM, TV.SWORD];
var ARMOUR_SLOTS = [
  { name: "body", tvals: [TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR] },
  { name: "cloak", tvals: [TV.CLOAK] },
  { name: "shield", tvals: [TV.SHIELD] },
  { name: "head", tvals: [TV.HELM, TV.CROWN] },
  { name: "hands", tvals: [TV.GLOVES] },
  { name: "feet", tvals: [TV.BOOTS] }
];
function shelves(view, memories) {
  const wares = memories.flatMap((memory) => {
    const confidence = stockConfidence(memory, view.turn());
    return confidence <= 0 ? [] : memory.stock.filter((item) => item.count > 0 && item.price > 0).map((item) => ({
      name: item.name,
      tval: item.tval,
      price: item.price,
      stock: { feat: memory.feat, name: item.name, turn: memory.turn, confidence }
    }));
  });
  return { wares };
}
function cheapest(wares, match) {
  let best = null;
  for (const ware of wares) if (match(ware) && (best === null || ware.price / ware.stock.confidence < best.price / best.stock.confidence)) best = ware;
  return best;
}
function sourced(ware) {
  return ware === null ? { how: "hunt", price: null } : { how: "save", price: ware.price, stock: ware.stock };
}
function namesOf(items) {
  return items.flatMap((item) => {
    const name = shownName2(item);
    return name === null ? [] : [name];
  });
}
function depthTarget(level, maxHp) {
  return Math.max(1, Math.min(Math.floor(level / 2), Math.floor(maxHp / 12)));
}
function bookAim(view, shelf, pack) {
  const level = view.player().level;
  for (const book of view.spellbooks()) {
    if (book.spells.length === 0 || book.name.length === 0) continue;
    if (pack.some((name) => name.includes(book.name))) continue;
    const first = Math.min(...book.spells.map((spell) => spell.level));
    if (first > level + BOOK_LOOKAHEAD) return null;
    const source = sourced(cheapest(shelf.wares, (ware) => ware.name.includes(book.name)));
    return {
      kind: "spellbook",
      label: "next spellbook",
      detail: `Get the next spellbook, ${book.name}, whose first spell is level ${String(first)}. ${source.how === "save" ? `I remember it at ${String(source.price)} gold, so save that much.` : "I have no shop memory of it, so hunt for it in the dungeon."}`,
      ...source,
      depth: null
    };
  }
  return null;
}
function lanternAim(shelf, pack, worn) {
  const light = worn.find((item) => item.tval === TV.LIGHT);
  const name = light === void 0 ? null : shownName2(light);
  if (name === null || !/\bTorch/i.test(name) || /\bLantern/i.test(name)) return null;
  const carried = pack.some((n) => /\bLantern/i.test(n));
  const source = carried ? { how: "try", price: null } : sourced(cheapest(shelf.wares, (ware) => /\bLantern/i.test(ware.name)));
  return {
    kind: "lantern",
    label: "lantern over torch",
    detail: `Use a Lantern instead of a wooden torch: it lights farther and refills from flasks of oil. ${source.how === "try" ? "One is in the pack." : source.how === "save" ? `I remember one at ${String(source.price)} gold.` : "I have no shop memory of one, so look for one in the dungeon."}`,
    ...source,
    depth: null
  };
}
function armourAim(view, shelf, packItems, worn) {
  const casts = view.spellbooks().some((book) => /arcane|necromantic/i.test(book.realm));
  const wornTvals = worn.map((item) => item.tval);
  const empty2 = ARMOUR_SLOTS.filter((slot2) => !slot2.tvals.some((t) => wornTvals.includes(t)) && !(casts && slot2.name === "hands"));
  if (empty2.length === 0) return null;
  const wanted2 = empty2.flatMap((slot2) => slot2.tvals);
  const carried = packItems.some((item) => wanted2.includes(item.tval));
  const source = carried ? { how: "try", price: null } : sourced(cheapest(shelf.wares, (ware) => wanted2.includes(ware.tval)));
  return {
    kind: "armour",
    label: "armour for empty slots",
    detail: `Nothing is worn on the ${empty2.map((slot2) => slot2.name).join(", ")}. ${source.how === "try" ? "Armour for it is in the pack." : source.how === "save" ? `I remember a piece at ${String(source.price)} gold.` : "I have no shop memory of any, so look for some in the dungeon."}`,
    ...source,
    depth: null
  };
}
function weaponAim(shelf, packItems, worn) {
  const special = (item) => {
    const name = shownName2(item);
    return name !== null && WEAPONS2.includes(item.tval) && mightBeSpecial(name);
  };
  if (worn.some(special)) return null;
  if (packItems.some(special)) {
    return { kind: "weapon", label: "magic weapon", detail: "Try the unknown or magical weapon in the pack to see whether it beats the one wielded.", how: "try", price: null, depth: null };
  }
  const ware = cheapest(shelf.wares, (w) => WEAPONS2.includes(w.tval) && mightBeSpecial(w.name));
  if (ware === null) return null;
  return { kind: "weapon", label: "magic weapon", detail: `Buy a magical or ego weapon: I remember ${ware.name} at ${String(ware.price)} gold.`, ...sourced(ware), depth: null };
}
function protectionAim(view, kind, pack) {
  const player = view.player();
  const flag = kind === "free-action" ? "FREE_ACT" : "SEE_INVIS";
  const from = kind === "free-action" ? FREE_ACTION_DEPTH : SEE_INVISIBLE_DEPTH;
  if (player.objectFlags.includes(flag)) return null;
  if (Math.max(player.depth, player.maxDepth) < from - PROTECTION_LEAD) return null;
  const words = kind === "free-action" ? "free action" : "see invisible";
  const carried = pack.some((name) => (kind === "free-action" ? /Free Action/i : /See Invisible|Seeing/i).test(name));
  return {
    kind,
    label: words,
    detail: `Get ${words} before dungeon level ${String(from)} (${String(from * 50)} ft), where ${kind === "free-action" ? "paralysis kills characters without it" : "invisible creatures strike unseen"}. ${carried ? "An item that may grant it is in the pack." : "Look for it in the dungeon."}`,
    how: carried ? "try" : "hunt",
    price: null,
    depth: null
  };
}
function winAim(maxDepth) {
  const step = winStep(maxDepth);
  return {
    kind: "win",
    label: "win the game",
    detail: `Defeat Sauron on dungeon level 99 and then Morgoth on dungeon level 100. The next step is to ${step.text}.`,
    how: "dive",
    price: null,
    depth: step.depth
  };
}
function candidateAims(view, memories = [], persona = null) {
  const player = view.player();
  const shelf = shelves(view, memories);
  const packItems = view.inventory();
  const pack = namesOf(packItems);
  const worn = view.equipment().flatMap((item) => item === null ? [] : [item]);
  const target = Math.max(1, Math.round(depthTarget(player.level, player.maxHp) * paceFactor(persona)));
  const next = Math.max(2, player.depth + 1, player.depth === 0 ? player.maxDepth : 0);
  const missing = missingPreparation(view, next);
  const preparation = missing.length === 0 ? null : {
    kind: "preparation",
    label: "prepare for descent",
    detail: `Before dungeon level ${String(next)}, acquire ${missing.map((requirement) => requirement.reason).join(", ")}. Buy named supplies in town, find the required protections, and gain experience on a prepared shallower level for the missing level or hit points.`,
    how: "hunt",
    price: null,
    depth: next
  };
  const depth2 = {
    kind: "depth",
    label: "depth target",
    detail: `Reach dungeon level ${String(target)} (${String(target * 50)} ft), which suits a level ${String(player.level)} character with ${String(player.maxHp)} hit points.`,
    how: "dive",
    price: null,
    depth: target
  };
  const found = [
    bookAim(view, shelf, pack),
    lanternAim(shelf, pack, worn),
    armourAim(view, shelf, packItems, worn),
    weaponAim(shelf, packItems, worn),
    protectionAim(view, "free-action", pack),
    protectionAim(view, "see-invisible", pack),
    preparation,
    depth2,
    winAim(player.maxDepth)
  ];
  return found.filter((aim) => aim !== null);
}
function inFixedOrder(aims) {
  const worth = (aim) => (FIXED_ORDER.length - FIXED_ORDER.indexOf(aim.kind)) * (aim.stock?.confidence ?? 1);
  return [...aims].sort((a, b) => worth(b) - worth(a) || FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
}
function wieldsMagicWeapon(view) {
  return view.equipment().some((item) => {
    if (item === null || !WEAPONS2.includes(item.tval)) return false;
    const name = shownName2(item);
    return name !== null && mightBeSpecial(name);
  });
}
function affordable(aim, gold) {
  return aim.price !== null && gold >= aim.price;
}

// src/town/aims-shop.ts
var ARMOUR = [TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR];
var WEAPONS3 = [TV.HAFTED, TV.POLEARM, TV.SWORD];
function matchesAim(aim, name, tval) {
  switch (aim.kind) {
    case "lantern":
      return /\bLantern\b/i.test(name);
    case "armour":
      return ARMOUR.includes(tval);
    case "weapon":
      return WEAPONS3.includes(tval) && mightBeSpecial(name);
    case "free-action":
      return /Free Action/i.test(name);
    case "see-invisible":
      return /See Invisible|Seeing/i.test(name);
    case "spellbook":
      return /\bBook\b/i.test(name);
    case "preparation":
      return false;
    case "depth":
      return false;
    case "win":
      return false;
    case "avenge":
      return false;
  }
}
function aimPurchase(aims, store, gold, view) {
  if (store.isHome) return null;
  for (const aim of aims) {
    const protection = (aim.kind === "free-action" || aim.kind === "see-invisible") && aim.how === "hunt";
    if (!protection && (aim.price === null || !affordable(aim, gold))) continue;
    const candidates = store.stock.filter((item) => {
      const name = shownName2(item);
      return name !== null && item.number > 0 && item.price !== void 0 && item.price > 0 && item.price <= gold && matchesAim(aim, name, item.tval);
    }).flatMap((item) => {
      if (view === void 0 || aim.kind === "spellbook") return [{ item, value: 0 }];
      const name = shownName2(item) ?? "";
      if (/\{\?\?\}/.test(name)) return [];
      const known = fullyKnown(name) || aim.kind === "lantern" || /\b(?:Free Action|See Invisible|Seeing)\b/i.test(name);
      if (!known) return [];
      const index = view.stores().findIndex((entry) => entry.feat === store.feat);
      const result = index < 0 ? null : view.simulateLoadout?.({ wield: [{ from: "store", store: index, index: item.index }] });
      if (result !== null && result !== void 0) {
        const value = equipmentValue(result, view);
        return keepsCapacity(view, result) && result.placements.length > 0 && value > 2 ? [{ item, value }] : [];
      }
      const trial = gearCandidates({ ...view, inventory: () => [item] })[0];
      return trial !== void 0 && !view.equipment().some((worn) => worn !== null && worn.tval === item.tval) ? [{ item, value: trial.score }] : [];
    }).sort((a, b) => b.value - a.value || (a.item.price ?? Infinity) - (b.item.price ?? Infinity));
    const ware = candidates[0]?.item;
    if (ware === void 0) continue;
    return { index: ware.index, quantity: 1, name: shownName2(ware) ?? aim.label, aim: aim.label };
  }
  return null;
}
function aimStores(aim) {
  switch (aim.kind) {
    case "armour":
      return ["Armoury"];
    case "weapon":
      return ["Weapon Smiths"];
    case "lantern":
      return ["General Store"];
    case "free-action":
    case "see-invisible":
      return ["Alchemy Shop", "General Store", "Armoury"];
    default:
      return [];
  }
}

// src/town/departure.ts
var EARNING_TURNS = 1e3;
var EARNING_LEASH = 6;
function basketNeeds(view, needs) {
  if (missingEssentials(view).length === 0) return [...needs];
  const stock = supplies(view);
  return needs.filter((need) => ["healing", "phase", "food", "light"].includes(need.kind)).map((need) => ({
    ...need,
    have: need.kind === "healing" ? stock.cures : need.kind === "phase" ? stock.phase : need.have,
    want: 2
  }));
}
function createDeparture() {
  const shelves2 = /* @__PURE__ */ new Map();
  let previousDepth = -1;
  let lastTurn = -1;
  let earning = null;
  let failedAtGold = null;
  function observe(view, terrain) {
    const player = view.player();
    if (view.turn() < lastTurn) {
      shelves2.clear();
      earning = null;
      failedAtGold = null;
      previousDepth = -1;
    }
    lastTurn = view.turn();
    if (player.depth === 0 && previousDepth > 0) {
      if (earning !== null && player.gold <= earning.gold) failedAtGold = player.gold;
      earning = null;
      shelves2.clear();
    }
    if (player.depth > 0 && previousDepth === 0 && earning !== null) earning = { ...earning, turn: view.turn() };
    previousDepth = player.depth;
    const cell2 = view.cell(player.grid.x, player.grid.y);
    if (player.depth !== 0 || cell2 === null || !terrain.isShopEntrance(cell2.feat)) return;
    try {
      const store = view.stores().find((entry) => entry.feat === cell2.feat);
      if (store !== void 0) shelves2.set(cell2.feat, { ...store, featName: terrain.shopName(cell2.feat) ?? store.featName });
    } catch {
    }
  }
  function status(view, terrain, persona, visited) {
    observe(view, terrain);
    const player = view.player();
    const missing = missingEssentials(view);
    if (missing.length === 0) return { ready: true, earning: false, reason: "", target: null };
    const needs = basketNeeds(view, supplyNeeds(view, readPack(view), persona)).filter((need) => need.have < need.want);
    const shops = shopEntrances(view, terrain);
    const unknown = player.gold > 0 && shops.some((shop) => !visited.has(shop.feat) && needs.some((need) => storesFor(need.kind).includes(shop.name)));
    let total = 0;
    let priced = true;
    let affordable2 = false;
    for (const need of needs) {
      const prices = [...shelves2.values()].filter((store) => storesFor(need.kind).includes(store.featName)).flatMap((store) => store.stock.filter((item) => item.number > 0 && item.price !== void 0 && item.price > 0 && matchesSupplyName(item.name ?? "", need.name)).map((item) => item.price));
      const price = prices.length === 0 ? null : Math.min(...prices);
      if (price === null) priced = false;
      else {
        total += price * (need.want - need.have);
        if (price <= player.gold) affordable2 = true;
      }
    }
    const stock = supplies(view);
    const canEarn = !unknown && !affordable2 && player.hp === player.maxHp && player.status.poisoned === 0 && player.status.cut === 0 && player.status.blind === 0 && player.status.confused === 0 && stock.food >= 1 && (stock.lastingLight || stock.workingLight && stock.fuel >= 1) && (failedAtGold === null || player.gold > failedAtGold);
    return { ready: false, earning: canEarn, reason: missing.map((requirement) => requirement.reason).join(", "), target: priced ? total : null };
  }
  return {
    status,
    begin(view, target) {
      earning = { turn: view.turn(), gold: view.player().gold, target: target !== null && target > view.player().gold ? target : null };
    },
    active: () => earning !== null,
    finished(view) {
      return earning !== null && (view.player().depth > 1 || view.turn() - earning.turn >= EARNING_TURNS || earning.target !== null && view.player().gold >= earning.target);
    },
    observe
  };
}

// src/brain/items.ts
var TV_GOLD = 1;
var TV_MAGIC = { STAFF: 22, WAND: 23, ROD: 24, SCROLL: 25, POTION: 26, MUSHROOM: 29 };
var FLAVOURED = [TV.AMULET, TV.RING, ...Object.values(TV_MAGIC)];
var LOOT_VALUE = 10;
var PACK_LIMIT = 23;
var GEAR = [
  TV.SHOT,
  TV.ARROW,
  TV.BOLT,
  TV.BOW,
  TV.DIGGING,
  TV.HAFTED,
  TV.POLEARM,
  TV.SWORD,
  TV.BOOTS,
  TV.GLOVES,
  TV.HELM,
  TV.CROWN,
  TV.SHIELD,
  TV.CLOAK,
  TV.SOFT_ARMOR,
  TV.HARD_ARMOR,
  TV.DRAG_ARMOR,
  TV.LIGHT,
  TV.AMULET,
  TV.RING
];
var USEFUL = [
  /\bPotion\b/i,
  /\bScroll\b/i,
  /\bStaff\b/i,
  /\bRod\b/i,
  /\bWand\b/i,
  /\bFlask of Oil\b/i,
  /\bRations? of Food\b/i,
  /\bFood\b/i,
  /\bTorch(?:es)?\b/i,
  /\bLantern\b/i,
  /\bBook\b/i
];
function valueIn(text) {
  const match = /(\d+)\s+gold/i.exec(text) ?? /value[:\s]+(\d+)/i.exec(text);
  return match === null ? null : Number(match[1]);
}
function itemValue(view, at, item) {
  if (typeof item.value === "number") return item.value;
  const index = item.floorIndex;
  if (view.inspectItem === void 0 || index === void 0) return null;
  const info = view.inspectItem({ floor: { x: at.x, y: at.y, index } });
  if (info === null) return null;
  return valueIn(info.text);
}
function unknownFlavour(tval, name) {
  if (!FLAVOURED.includes(tval)) return false;
  return tval === TV_MAGIC.SCROLL ? /\btitled\b/i.test(name) : !/\bof\b/i.test(name);
}
function judge(view, at, item, strict = false) {
  const name = shownName2(item) ?? item.label;
  const unknown = strict && unknownFlavour(item.tval, name);
  const value = unknown ? null : itemValue(view, at, item);
  const gold = item.tval === TV_GOLD;
  const useful = !unknown && USEFUL.some((pattern) => pattern.test(name));
  const sellable = !unknown && !useful && (mightBeSpecial(name) || value !== null && value >= LOOT_VALUE);
  return { gold, sellable, useful, value, name, unknown, money: false, sensed: false };
}
function judgeKnown(view, entry) {
  const look = entry.visibility === "seen" ? view.inspectKnownFloorItem?.(entry.ref) : void 0;
  if (look?.status === "stale") return null;
  if (entry.sensed) {
    return { gold: false, sellable: false, useful: false, value: null, name: entry.money ? "unseen treasure" : "an unseen object", unknown: true, money: entry.money, sensed: true };
  }
  const name = entry.item.name;
  const unknown = unknownFlavour(entry.item.tval, name);
  const value = unknown || look?.status !== "seen" ? null : valueIn(look.inspection.text);
  const gold = entry.item.tval === TV_GOLD;
  const useful = !unknown && USEFUL.some((pattern) => pattern.test(name));
  const sellable = !unknown && !useful && (mightBeSpecial(name) || value !== null && value >= LOOT_VALUE);
  return { gold, sellable, useful, value, name, unknown, money: false, sensed: false };
}
function wanted(verdict, saving) {
  return verdict.gold || verdict.sellable || !saving && verdict.useful;
}
function looksAt(verdict, saving, persona, away) {
  return verdict.unknown && (!saving || verdict.money) && away <= lookReach(persona, verdict.money);
}
function floorTarget(view, terrain, saving, persona = null) {
  const player = view.player();
  const at = player.grid;
  const bounds = view.mapBounds();
  const routable = (grid) => isRoutable(view, terrain, grid);
  const field = flowFrom({ goals: [at], canEnter: routable });
  const memory = view;
  const remembered3 = typeof memory.knownFloorItems === "function";
  let best = null;
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell2 = view.cell(x, y);
      if (cell2 === null || !cell2.known || knownCount(cell2) === 0) continue;
      const here = { x, y };
      if (here.x === at.x && here.y === at.y) continue;
      if (!Number.isFinite(field.distance(here))) continue;
      const verdicts = remembered3 ? (memory.knownFloorItems?.(x, y) ?? []).map((entry) => judgeKnown(memory, entry)).filter((verdict) => verdict !== null) : view.floorItems(x, y).map((item) => judge(view, here, item));
      const away = steps(at, here);
      for (const verdict of verdicts) {
        const fetch = wanted(verdict, saving);
        const look = !fetch && remembered3 && looksAt(verdict, saving, persona, away);
        if (!fetch && !look) continue;
        if (best === null || away < best.away) best = {
          at: here,
          name: verdict.name,
          away,
          gold: verdict.gold,
          sellable: verdict.sellable,
          useful: verdict.useful,
          value: verdict.value,
          ...remembered3 ? { known: true, look, sensed: verdict.sensed } : {}
        };
      }
    }
  }
  return best;
}
function stillWorthIt(view, loot, saving, persona) {
  if (loot.known !== true) return true;
  const keep = (verdict) => wanted(verdict, saving) || looksAt(verdict, saving, persona, 1);
  const here = view.player().grid;
  if (here.x === loot.at.x && here.y === loot.at.y) {
    return view.floorItems(here.x, here.y).some((item) => keep(judge(view, here, item, true)));
  }
  const memory = view;
  const entries = memory.knownFloorItems?.(loot.at.x, loot.at.y) ?? [];
  const same3 = loot.sensed === true ? entries : entries.filter((entry) => !entry.sensed && entry.item.name === loot.name);
  return same3.some((entry) => {
    const verdict = judgeKnown(memory, entry);
    return verdict !== null && (entry.visibility === "remembered" || keep(verdict));
  });
}
function packFull(view) {
  return view.inventory().length >= PACK_LIMIT;
}
function junkInPack(view) {
  for (const item of view.inventory()) {
    const name = shownName2(item);
    if (name === null) continue;
    if (item.tval === TV_GOLD || GEAR.includes(item.tval)) continue;
    if (USEFUL.some((pattern) => pattern.test(name)) || mightBeSpecial(name)) continue;
    return { handle: item.handle, name };
  }
  return null;
}

// src/learning/family-ways.ts
function emptyFlourishes() {
  return { superstitions: [], darkLesson: false, favouredDepth: null, trophies: [], uniqueKills: [], bestFind: null, lastUse: null };
}
function itemKey(item) {
  return item.kindId ?? `${String(item.tval)}:${String(item.sval)}`;
}
function unknownUse(item) {
  const name = shownName2(item);
  if (name === null || !/\b(?:Scrolls?|Potions?|Wands?)\b/i.test(name) || /\b(?:Scrolls?|Potions?|Wands?) of\b/i.test(name)) return null;
  const plain = name.replace(/^(?:an?|the|\d+)\s+/i, "").replace(/\s*\([^)]*\)|\s*\{[^}]*\}/g, "").trim();
  return { key: itemKey(item), name: plain };
}
function usedItem(command, view) {
  if (!["read", "quaff", "aim-wand"].includes(command.code)) return null;
  const item = view.inventory().find((i) => i.handle === command.args?.["handle"]);
  return item === void 0 ? null : unknownUse(item);
}
function distrusted(item, memories, persona) {
  const unknown = unknownUse(item);
  return persona?.toggles.inheritedSuperstitions === true && unknown !== null && memories.superstitions.some((s) => s.key === unknown.key);
}
function distrustedUse(command, view, run, persona) {
  const use = usedItem(command, view);
  return persona?.toggles.inheritedSuperstitions === true && use !== null && run.superstitions.some((s) => s.key === use.key);
}
function learnedSuperstitions(superstitions, view) {
  return superstitions.filter((s) => view.inventory().some((i) => itemKey(i) === s.key && unknownUse(i) === null));
}
function inheritWays(family, parent, heir, rng) {
  const share3 = Math.max(0, Math.min(1, parent.sliders.inheritance / 100));
  const enabled = (id) => parent.toggles[id] && heir.toggles[id];
  return {
    ...emptyFlourishes(),
    superstitions: enabled("inheritedSuperstitions") ? family.superstitions.slice(-Math.ceil(6 * share3)).filter(() => share3 > 0) : [],
    darkLesson: enabled("darkLessons") && family.darkDeaths > 0 && share3 > 0 && (share3 === 1 || rng() < share3),
    favouredDepth: enabled("favouredGrounds") && family.bestFind !== null && share3 > 0 && (share3 === 1 || rng() < share3) ? family.bestFind.depth : null
  };
}
function familyAfterDeath(family, run, view, persona) {
  const last = run.lastUse;
  const known = view?.inventory().some((i) => itemKey(i) === last?.key && unknownUse(i) === null) ?? false;
  const learned = view === null ? [] : learnedSuperstitions(family.superstitions, view);
  const remembered3 = family.superstitions.filter((s) => !learned.some((t) => s.key === t.key));
  const superstitions = persona.toggles.inheritedSuperstitions && last !== null && !known ? [...remembered3.filter((s) => s.key !== last.key), last].slice(-6) : remembered3;
  const dark = view !== null && view.player().depth > 0 && view.player().light <= 0 && !view.player().classFlags.includes("UNLIGHT");
  const bestFind = persona.toggles.favouredGrounds && run.bestFind !== null && run.bestFind.value > (family.bestFind?.value ?? -1) ? run.bestFind : family.bestFind;
  return { superstitions, darkDeaths: family.darkDeaths + (persona.toggles.darkLessons && dark ? 1 : 0), bestFind };
}
function emptyFamilyFlourishes() {
  return { superstitions: [], darkDeaths: 0, bestFind: null };
}
function observeFlourishes(run, view, persona, uniqueKills, acquired) {
  const items = view.inventory();
  const superstitions = run.superstitions.filter((s) => !items.some((i) => itemKey(i) === s.key && unknownUse(i) === null));
  const trophies = run.trophies.flatMap((t) => {
    const item = items.find((i) => i.handle === t.handle);
    return item === void 0 ? [] : [{ ...t, name: shownName2(item) ?? t.name }];
  });
  let bestFind = run.bestFind;
  const upgrades = new Set(gearCandidates(view).map((g) => g.handle));
  for (const item of items) {
    const name = shownName2(item);
    if (name === null) continue;
    const text = view.inspectItem?.(item.handle)?.text ?? "";
    const originDepth = /(?:found|dropped)[\s\S]*?\(level (\d+)\)/i.exec(text);
    const bought = /Bought from a store|An inheritance from your family|Created by debug option/i.test(text);
    const depth2 = bought ? 0 : originDepth === null ? acquired.has(item.handle) ? view.player().depth : 0 : Number(originDepth[1]);
    const value = item.value;
    if (persona?.toggles.favouredGrounds && depth2 > 0 && typeof value === "number" && Number.isFinite(value) && value > (bestFind?.value ?? 0)) bestFind = { depth: depth2, value, name };
    if (!persona?.toggles.trophies || persona.sliders.pride < 70 || items.length >= PACK_LIMIT || upgrades.has(item.handle) || item.number < 1) continue;
    const unique = uniqueKills.find((race) => text.includes(`Dropped by ${race} `) || text.includes(`Dropped by ${race}, `));
    if (unique === void 0 || trophies.some((t) => t.unique === unique || t.handle === item.handle)) continue;
    trophies.push({ unique, handle: item.handle, name });
  }
  return { ...run, superstitions, trophies, bestFind };
}
function trophyHandles(run, view, persona) {
  if (!persona?.toggles.trophies || persona.sliders.pride < 70 || view.inventory().length >= PACK_LIMIT) return /* @__PURE__ */ new Set();
  const upgrades = new Set(gearCandidates(view).map((g) => g.handle));
  return new Set(run.trophies.filter((t) => !upgrades.has(t.handle)).map((t) => t.handle));
}
function flourishLines(run, persona) {
  if (persona === null) return [];
  return [
    ...persona.toggles.inheritedSuperstitions ? run.superstitions.map((s) => `${persona.name} distrusts the ${s.name} until its kind is known.`) : [],
    ...persona.toggles.darkLessons && run.darkLesson ? [`${persona.name} wants a spare torch or extra oil after an ancestor died without light.`] : [],
    ...persona.toggles.favouredGrounds && run.favouredDepth !== null ? [`${persona.name} favours hunting at ${String(run.favouredDepth * 50)} ft.`] : [],
    ...persona.toggles.trophies ? run.trophies.map((t) => `${persona.name} keeps a trophy from ${t.unique}: ${t.name} (one item).`) : []
  ];
}
function nudgeGrounds(dist, offers, run, view, persona, ceiling) {
  const out = { ...dist };
  const target = run.favouredDepth;
  if (!persona?.toggles.favouredGrounds || target === null || missingPreparation(view, target).length > 0) return out;
  const depth2 = view.player().depth;
  const goal = depth2 < target ? "descend" : depth2 === target ? "explore" : null;
  for (const offer of offers) if (offer.goal === goal && offer.risk <= ceiling && out[offer.goal] !== void 0) out[offer.goal] = out[offer.goal] * 1.1;
  return out;
}
function record3(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function strings(raw) {
  return Array.isArray(raw) ? raw.slice(-6).flatMap((s) => {
    const r = record3(s);
    return typeof r["key"] === "string" && typeof r["name"] === "string" ? [{ key: r["key"].slice(0, 100), name: r["name"].slice(0, 100) }] : [];
  }) : [];
}
function depth(raw) {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 127 ? raw : null;
}
function find(raw) {
  const r = record3(raw);
  const at = depth(r["depth"]);
  return at !== null && typeof r["value"] === "number" && Number.isFinite(r["value"]) && r["value"] >= 0 && typeof r["name"] === "string" ? { depth: at, value: r["value"], name: r["name"].slice(0, 100) } : null;
}
function readFamilyFlourishes(raw) {
  const r = record3(raw);
  return { superstitions: strings(r["superstitions"]), darkDeaths: typeof r["darkDeaths"] === "number" && Number.isFinite(r["darkDeaths"]) ? Math.max(0, Math.round(r["darkDeaths"])) : 0, bestFind: find(r["bestFind"]) };
}
function readWays(raw) {
  const r = record3(raw);
  const trophies = Array.isArray(r["trophies"]) ? r["trophies"].slice(0, PACK_LIMIT).flatMap((t) => {
    const s = record3(t);
    return typeof s["unique"] === "string" && typeof s["name"] === "string" && typeof s["handle"] === "number" && Number.isInteger(s["handle"]) && s["handle"] > 0 ? [{ unique: s["unique"].slice(0, 100), name: s["name"].slice(0, 100), handle: s["handle"] }] : [];
  }) : [];
  const uniqueKills = Array.isArray(r["uniqueKills"]) ? r["uniqueKills"].filter((s) => typeof s === "string").slice(-200).map((s) => s.slice(0, 100)) : [];
  return { superstitions: strings(r["superstitions"]), darkLesson: r["darkLesson"] === true, favouredDepth: depth(r["favouredDepth"]), trophies, uniqueKills, bestFind: find(r["bestFind"]), lastUse: strings([r["lastUse"]])[0] ?? null };
}

// src/town/plan.ts
function shopEntrances(view, terrain) {
  const bounds = view.mapBounds();
  const found = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell2 = view.cell(x, y);
      if (cell2 === null || !cell2.known || !terrain.isShopEntrance(cell2.feat)) continue;
      const name = terrain.shopName(cell2.feat);
      if (name !== null) found.push({ x, y, feat: cell2.feat, name });
    }
  }
  return found;
}
function neededEntrances(view, terrain, persona, visited = /* @__PURE__ */ new Set(), aims = [], flourishes = emptyFlourishes(), memories) {
  if (view.player().depth !== 0) return [];
  const pack = readPack(view);
  const needs = basketNeeds(view, supplyNeeds(view, pack, persona, flourishes.darkLesson));
  const sales = sellList(pack, view, persona, trophyHandles(flourishes, view, persona));
  const gold = view.player().gold;
  return shopEntrances(view, terrain).filter((entrance) => {
    if (visited.has(entrance.feat)) return false;
    const buying = gold > 0 && needs.some((need) => need.have < need.want && storesFor(need.kind).includes(entrance.name));
    const aiming = aims.some((aim) => (affordable(aim, gold) || gold > 0 && aim.how === "hunt" && (aim.kind === "free-action" || aim.kind === "see-invisible")) && (aim.stock === void 0 ? aimStores(aim).includes(entrance.name) : aim.stock.feat === entrance.feat));
    const exploring = memories !== void 0 && entrance.name !== "Home" && !memories.some((memory) => memory.feat === entrance.feat && stockConfidence(memory, view.turn()) > 0);
    return buying || aiming || exploring || sales.some((sale) => saleFits(sale.name, entrance.name));
  }).sort((a, b) => {
    const rank2 = (shop) => shop.name === "Alchemy Shop" ? 0 : shop.name === "General Store" ? 1 : 2;
    return rank2(a) - rank2(b);
  });
}
function townTripPlan(terrain, persona, visited = /* @__PURE__ */ new Set(), log = () => {
}, aims = [], flourishes = emptyFlourishes, strategy) {
  const progress = newProgress(0);
  const boughtFor = /* @__PURE__ */ new Set();
  let leftShopForSupplies = false;
  return {
    label: "shop for supplies",
    step(view, act) {
      if (view.player().depth !== 0) return null;
      const at = view.player().grid;
      const cell2 = view.cell(at.x, at.y);
      const current2 = strategy?.();
      const currentAims = current2?.aims ?? aims;
      const first = neededEntrances(view, terrain, persona, visited, currentAims, flourishes(), current2?.storeMemory)[0];
      const alchemyFirst = first?.name === "Alchemy Shop" && first.feat !== cell2?.feat;
      if (alchemyFirst && cell2 !== null && terrain.isShopEntrance(cell2.feat) && !leftShopForSupplies) {
        leftShopForSupplies = true;
        return act.shopExit();
      }
      if (!alchemyFirst) leftShopForSupplies = false;
      if (!alchemyFirst && cell2 !== null && terrain.isShopEntrance(cell2.feat) && !visited.has(cell2.feat)) {
        const found = view.stores().find((entry) => entry.feat === cell2.feat);
        const store = found === void 0 ? void 0 : { ...found, featName: terrain.shopName(cell2.feat) ?? found.featName };
        if (store === void 0) {
          visited.add(cell2.feat);
          log("shop: this store has no stock to read");
          return act.shopExit();
        }
        const pack = readPack(view);
        const sale = sellList(pack, view, persona, trophyHandles(flourishes(), view, persona)).find((item) => saleFits(item.name, store.featName));
        if (sale !== void 0) {
          log(`shop: selling ${sale.name} in the ${store.featName}`);
          return act.shopSell(sale.handle, sale.quantity);
        }
        const purchase = shoppingList(basketNeeds(view, supplyNeeds(view, pack, persona, flourishes().darkLesson)), store, view.player().gold, persona)[0];
        if (purchase !== void 0) {
          log(`shop: buying ${String(purchase.quantity)} from "${purchase.name}" in the ${store.featName}`);
          return act.shopBuy(purchase.index, purchase.quantity);
        }
        const aimed = missingEssentials(view).length > 0 ? null : aimPurchase(currentAims.filter((aim) => !boughtFor.has(aim.label)), store, view.player().gold, view);
        if (aimed !== null) {
          boughtFor.add(aimed.aim);
          log(`shop: buying ${aimed.name} in the ${store.featName} for the aim: ${aimed.aim}`);
          return act.shopBuy(aimed.index, aimed.quantity);
        }
        visited.add(cell2.feat);
        const shelf = store.stock.slice(0, 8).map((item) => `${item.name ?? "?"} at ${String(item.price ?? "?")}`).join("; ");
        log(`shop: done in the ${store.featName} with ${String(view.player().gold)} gold (${shelf})`);
        return act.shopExit();
      }
      const next = neededEntrances(view, terrain, persona, visited, currentAims, flourishes(), current2?.storeMemory)[0];
      if (next === void 0) {
        log("shop: no shop left with anything needed");
        return null;
      }
      const travel = travelTo({ view, act, terrain, cfg: defaultCfg(), progress, log: () => {
      } }, [next]);
      if (travel.kind === "step") return travel.command;
      if (travel.kind === "unreachable") visited.add(next.feat);
      log(`shop: the ${next.name} is ${travel.kind === "unreachable" ? "out of reach" : "blocked for now"}`);
      return null;
    }
  };
}
function recallPlan(item) {
  let read = false;
  return {
    label: "read Word of Recall",
    step(_view, act) {
      if (read) return null;
      read = true;
      return act.read(item.handle);
    }
  };
}

// src/strategy/steer.ts
var MAX_NUDGE = 0.2;
var ARMOUR2 = [TV.BOOTS, TV.GLOVES, TV.HELM, TV.CROWN, TV.SHIELD, TV.CLOAK, TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR];
var WEAPONS4 = [TV.HAFTED, TV.POLEARM, TV.SWORD];
function wornKind(view, criteria) {
  const candidate = gearCandidates(view).find((c) => c.criteria === criteria);
  const item = candidate === void 0 ? void 0 : view.inventory().find((i) => i.handle === candidate.handle);
  if (item === void 0) return null;
  const name = shownName2(item) ?? "";
  if (/Free Action/i.test(name)) return "free-action";
  if (/See Invisible|Seeing/i.test(name)) return "see-invisible";
  if (item.tval === TV.LIGHT && /Lantern/i.test(name)) return "lantern";
  if (WEAPONS4.includes(item.tval)) return "weapon";
  if (ARMOUR2.includes(item.tval)) return "armour";
  return null;
}
function inSight2(view, name) {
  const wanted2 = name.toLowerCase();
  return view.monsters().some((m) => m.visible && m.race.toLowerCase() === wanted2);
}
function servedBy(offer, view, aims, gold) {
  const depth2 = view.player().depth;
  const wear = offer.goal === "wear" ? wornKind(view, offer.criteria) : null;
  for (const [rank2, aim] of aims.entries()) {
    let serves = false;
    switch (offer.goal) {
      case "recall_town":
        serves = affordable(aim, gold);
        break;
      case "pick_up":
      case "fetch":
        serves = aim.how === "save" && !affordable(aim, gold);
        break;
      case "wear":
        serves = wear === aim.kind;
        break;
      case "descend":
        serves = (aim.kind === "depth" || aim.kind === "win") && aim.depth !== null && aim.depth > depth2;
        break;
      case "recall_dungeon":
        serves = aim.kind === "win";
        break;
      case "explore":
        serves = depth2 > 0 && (aim.kind === "depth" && aim.depth !== null && aim.depth <= depth2 || aim.how === "hunt");
        break;
      case "fight":
      case "shoot":
      case "throw_oil":
      case "aim_wand":
      case "cast_attack":
        serves = aim.kind === "avenge" && aim.target !== void 0 && inSight2(view, aim.target);
        break;
    }
    if (serves) return { aim, rank: rank2 };
  }
  return null;
}
function steerOffers(offers, view, steering, context, make) {
  if (steering.aims.length === 0) return [...offers];
  const player = view.player();
  const out = [...offers];
  const wanted2 = steering.aims.find((aim) => affordable(aim, player.gold));
  if (wanted2 !== void 0 && player.depth > 0 && !context.recallActive && !out.some((o) => o.goal === "recall_town") && steering.tripAllowed(player.gold) && canRead(view) && recallItem(view) !== null) {
    out.push(make("recall_town", `Read Word of Recall to return to town with ${String(player.gold)} gold, enough to buy the aim: ${wanted2.label}.`, context.tripRisk));
  }
  return out.map((offer) => {
    const served = servedBy(offer, view, steering.aims, player.gold);
    if (served === null) return offer;
    const text = `${offer.criteria.replace(/\.$/, "")}, which serves the aim: ${served.aim.label}.`;
    return { ...offer, criteria: text, aim: { kind: served.aim.kind, rank: served.rank } };
  });
}
function nudgeAims(dist, offers, ambition, ceiling) {
  const out = { ...dist };
  const scale2 = Math.max(0, Math.min(100, ambition)) / 100;
  for (const offer of offers) {
    if (offer.aim === void 0 || offer.risk > ceiling) continue;
    const weight = offer.goal === "pick_up" ? 1 : Math.max(0.2, 1 - 0.25 * offer.aim.rank);
    const current2 = out[offer.goal];
    if (current2 !== void 0) out[offer.goal] = current2 * (1 + MAX_NUDGE * scale2 * weight);
  }
  return out;
}

// src/strategy/hold.ts
var HOLD_SHARE = 0.25;
function descentEscapes(view, badFeeling) {
  const p = view.player();
  if (badFeeling) return true;
  if (p.maxHp > 0 && p.hp <= p.maxHp * 0.5) return true;
  return view.monsters().some((m) => m.visible && !m.asleep);
}
function holdDescent(dist, aims, view, badFeeling, spent = false) {
  const out = { ...dist };
  const current2 = out["descend"];
  if (current2 === void 0) return out;
  const depth2 = view.player().depth;
  const target = aims.find((a) => a.kind === "depth" && a.depth !== null)?.depth ?? null;
  if (target === null || depth2 < target || spent || descentEscapes(view, badFeeling)) return out;
  out["descend"] = current2 * HOLD_SHARE;
  return out;
}

// src/brain/level-feel.ts
var BAD_MONSTER = [
  /Omens of death haunt this place/i,
  /This place seems murderous/i,
  /This place seems terribly dangerous/i,
  /You feel anxious about this place/i
];
var BAD_OBJECT = [
  /there is naught but cobwebs here/i,
  /there are only scraps of junk here/i
];
function badLevelFeeling(messages) {
  for (const message of messages) {
    if ([...BAD_MONSTER, ...BAD_OBJECT].some((pattern) => pattern.test(message))) return message;
  }
  return null;
}
var ARRIVAL = [
  "You are still uncertain about this place",
  "Omens of death haunt this place",
  "This place seems murderous",
  "This place seems terribly dangerous",
  "You feel anxious about this place",
  "You feel nervous about this place",
  "This place does not seem too risky",
  "This place seems reasonably safe",
  "This seems a tame, sheltered place",
  "This seems a quiet, peaceful place",
  "Looks like a typical town"
];
function arrivalFeeling(messages) {
  return messages.some((message) => ARRIVAL.some((line) => message.startsWith(line)));
}

// src/strategy/pacing.ts
function levelBudget(level) {
  return Math.min(1e4, 500 * Math.max(1, level));
}
function stairLeash(level) {
  return level < 20 ? 3 * Math.max(1, level) + 9 : Infinity;
}
function createLevelPacing() {
  let depth2 = -1;
  let entered = 0;
  let useful = 0;
  let lastTurn = -1;
  let xp = 0;
  let gold = 0;
  let arrival = null;
  let exhausted = false;
  let known = 0;
  let anchor = { x: 0, y: 0 };
  const reached = /* @__PURE__ */ new Set();
  const held2 = /* @__PURE__ */ new Map();
  return {
    observe(view, terrain) {
      const player = view.player();
      const turn = view.turn();
      const feeling = view.messages().find((message) => arrivalFeeling([message])) ?? null;
      const fresh = depth2 !== player.depth || turn < lastTurn || feeling !== null && feeling !== arrival;
      if (fresh) {
        depth2 = player.depth;
        entered = turn;
        useful = turn;
        xp = player.exp;
        gold = player.gold;
        exhausted = false;
        anchor = { ...player.grid };
        reached.clear();
        held2.clear();
        known = 0;
      }
      arrival = feeling;
      lastTurn = turn;
      let progress = player.exp > xp || player.gold > gold;
      const bounds = view.mapBounds();
      let seen = 0;
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) if (view.cell(x, y)?.known === true) seen += 1;
      }
      if (!fresh && seen > known) progress = true;
      known = Math.max(known, seen);
      xp = Math.max(xp, player.exp);
      gold = Math.max(gold, player.gold);
      const counts = /* @__PURE__ */ new Map();
      for (const item of view.inventory()) {
        const name = (shownName2(item) ?? "").replace(/^\d+\s+|^an?\s+/i, "");
        if (!/Cure |Phase Door|Teleport|Recall|Food|Ration|Torch|Lantern|Oil|Book|\(\+\d/i.test(name)) continue;
        counts.set(name, (counts.get(name) ?? 0) + item.number);
      }
      for (const [name, count2] of counts) {
        const was = held2.get(name);
        if (was !== void 0 && count2 > was) progress = true;
        if (was === void 0 && turn > entered) progress = true;
        held2.set(name, Math.max(was ?? 0, count2));
      }
      if (terrain !== void 0 && frontiers(view, terrain).some((grid) => key(grid) === key(player.grid)) && !reached.has(key(player.grid))) {
        reached.add(key(player.grid));
        progress = true;
      }
      if (progress) useful = turn;
      const budget = levelBudget(player.level);
      const expired = player.depth > 0 && (exhausted || turn - useful >= budget || turn - entered >= 4 * budget);
      const review = expired && !exhausted;
      exhausted = expired;
      return { expired, review, fresh, anchor };
    }
  };
}

// src/strategy/journey.ts
var OPTIONAL = /* @__PURE__ */ new Set(["explore", "fetch", "pick_up", "tunnel"]);
function createJourney(terrain, unseenDanger) {
  const pacing2 = createLevelPacing();
  const departure = createDeparture();
  let returnReason = null;
  let previousHp = null;
  let unseenUntil = -1;
  let lastTurn = -1;
  const remembered3 = /* @__PURE__ */ new Map();
  let town = { ready: true, earning: false, reason: "", target: null };
  let expired = false;
  let footOffered = false;
  let recallActive = false;
  let lastPersona = null;
  let widened = false;
  let anchor = { x: 0, y: 0 };
  let leashField = null;
  let breederLevel = false;
  let breederDepth = -1;
  let breederTurn = -1;
  let breederArrival = null;
  function breederExit(view) {
    const player = view.player();
    const arrival = view.messages().find((message) => arrivalFeeling([message])) ?? null;
    if (breederDepth !== player.depth || view.turn() < breederTurn || arrival !== null && arrival !== breederArrival) breederLevel = false;
    breederDepth = player.depth;
    breederTurn = view.turn();
    breederArrival = arrival;
    if (player.depth > 0 && player.level <= 5 && view.monsters().filter((monster) => monster.visible && !monster.asleep && monster.raceFlags.includes("MULTIPLY")).length >= 3) breederLevel = true;
    return breederLevel;
  }
  function observe(view) {
    const player = view.player();
    const turn = view.turn();
    const state = pacing2.observe(view, terrain);
    breederExit(view);
    leashField = null;
    if (state.fresh) {
      if (player.depth === 0 || turn < lastTurn) returnReason = null;
      previousHp = null;
      unseenUntil = -1;
      remembered3.clear();
    }
    for (const monster of view.monsters()) if (monster.visible && !monster.asleep) remembered3.set(monster.id, { monster, until: turn + 100 });
    const live = new Set(view.monsters().map((monster) => monster.id));
    for (const [id, entry] of remembered3) if (!live.has(id) || entry.until < turn) remembered3.delete(id);
    if (previousHp !== null && player.hp < previousHp && !view.monsters().some((monster) => monster.visible && !monster.asleep)) unseenUntil = turn + 100;
    previousHp = player.hp;
    lastTurn = turn;
    departure.observe(view, terrain);
    if (player.depth > 0) {
      if (!departure.active()) returnReason ??= supplyMargin(view);
      else if (departure.finished(view) || supplies(view).food === 0 && hungry(view) || !supplies(view).workingLight && !supplies(view).lastingLight || upStairs(view).length > 0 && checkedRoute(view, upStairs(view)) === null) returnReason ??= "the earning trip's limit or return route";
    }
    expired = state.expired;
    anchor = state.anchor;
  }
  function safeDelay(view) {
    const player = view.player();
    if (standingOnHarm(view, terrain, player.grid)) return false;
    if (player.status.poisoned > 0 || player.status.cut > 0 || player.status.blind > 0 || player.status.confused > 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return false;
    if (view.monsters().some((monster) => monster.visible && (monster.raceFlags.includes("MULTIPLY") && steps(monster.grid, player.grid) <= 10 || !monster.asleep || steps(monster.grid, player.grid) <= 8))) return false;
    return ![...remembered3.values()].some((entry) => entry.until >= view.turn());
  }
  function checkedRoute(view, goals) {
    const player = view.player();
    if (goals.some((grid) => key(grid) === key(player.grid))) return [];
    if (player.status.poisoned > 0 || player.status.cut > 0 || player.status.blind > 0 || player.status.confused > 0 || (unseenDanger?.(view) ?? view.turn() <= unseenUntil)) return null;
    const threats = [...remembered3.values()].filter((entry) => entry.until >= view.turn()).map((entry) => entry.monster);
    const enter2 = (grid) => isRoutable(view, terrain, grid) && !terrain.isClosedDoor(view.cell(grid.x, grid.y)?.feat ?? -1) && !view.cell(grid.x, grid.y)?.trap;
    const field = flowFrom({ goals, canEnter: enter2 });
    if (!Number.isFinite(field.distance(player.grid))) return null;
    const route = [];
    let here = player.grid;
    while (field.distance(here) > 0 && route.length < 250) {
      const direction = stepDown(field, here, (grid) => enter2(grid) && isWalkable(view, terrain, grid));
      if (direction === null) return null;
      here = { x: here.x + direction.dx, y: here.y + direction.dy };
      route.push(here);
    }
    if (field.distance(here) !== 0) return null;
    if (view.monsters().some((monster) => monster.visible && monster.asleep && route.some((grid) => steps(grid, monster.grid) <= (monster.raceFlags.includes("MULTIPLY") ? 10 : 2)))) return null;
    if (threats.length > 0) return null;
    return route;
  }
  function upStairs(view) {
    return knownStairs(view, terrain).filter((grid) => terrain.isUpStair(view.cell(grid.x, grid.y)?.feat ?? -1));
  }
  function earningLeash(view) {
    const bold = Math.min(100, Math.max(0, lastPersona?.sliders.boldness ?? 0)) / 100;
    return EARNING_LEASH + Math.round(Math.max(0, stairLeash(view.player().level) - EARNING_LEASH) * bold);
  }
  function searching(view) {
    const depth2 = view.player().depth;
    if (!departure.active() || depth2 <= 0 || depth2 >= RECALL_FROM_DEPTH || upStairs(view).length > 0) return false;
    if (returnReason === null && !expired && !departure.finished(view)) return false;
    return checkedRoute(view, exitTargets(view)) === null && frontiers(view, terrain).length > 0;
  }
  function leashed(view, at) {
    if (view.player().depth === 0 || view.player().level >= 20 && !departure.active()) return true;
    const stairs = upStairs(view);
    const sources = stairs.length > 0 ? stairs : [anchor];
    const limit = stairs.length === 0 ? departure.active() ? earningLeash(view) : 3 : departure.active() ? earningLeash(view) : stairLeash(view.player().level);
    leashField ??= flowFrom({ goals: sources, canEnter: (grid) => {
      const cell2 = view.cell(grid.x, grid.y);
      if (cell2 === null || !cell2.known) return false;
      return isRoutable(view, terrain, grid) && !terrain.isClosedDoor(cell2.feat) && !cell2.trap;
    } });
    const field = leashField;
    if (view.cell(at.x, at.y)?.known === false) return DIRECTIONS.some((dir) => field.distance({ x: at.x + dir.dx, y: at.y + dir.dy }) + 1 <= limit);
    return field.distance(at) <= limit;
  }
  function exitTargets(view) {
    if (returnReason !== null || missingPreparation(view, view.player().depth + 1).length > 0) return upStairs(view);
    return knownStairs(view, terrain);
  }
  function apply(offers, view, persona, visited, recalling, widen = false) {
    widened = widen;
    footOffered = false;
    recallActive = recalling;
    lastPersona = persona;
    observe(view);
    const player = view.player();
    if (player.depth === 0) town = departure.status(view, terrain, persona, visited);
    const home = returnReason !== null;
    const target = pickTarget(view.monsters(), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
    let out = offers.filter((offer) => {
      if (widen && offer.goal === "explore") return true;
      if (breederLevel && (OPTIONAL.has(offer.goal) || offer.goal === "rest" || offer.goal === "descend")) return false;
      if (breederLevel && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(offer.goal) && (target === null || steps(target.grid, player.grid) > 1)) return false;
      if (offer.goal === "wait" && recalling && !safeDelay(view)) return false;
      if (offer.goal === "rest" && recalling && !safeDelay(view)) return false;
      if (offer.goal === "recall_town" && !safeDelay(view) && !offer.criteria.includes("cannot stop the next blow")) return false;
      if (offer.goal === "recall_dungeon") return !recalling && town.ready && missingPreparation(view, player.maxDepth).length === 0;
      if (offer.goal === "descend") return !recalling && (player.depth === 0 ? town.ready || town.earning || widen : !home && !departure.active() && missingPreparation(view, player.depth + 1).length === 0);
      if (offer.goal === "leave_level" && !unseenDanger?.(view) && !view.monsters().some((monster) => monster.visible && !monster.asleep)) return checkedRoute(view, exitTargets(view)) !== null;
      if (offer.goal === "explore" && searching(view)) return true;
      if (OPTIONAL.has(offer.goal) && (home || expired)) return false;
      if (offer.goal === "explore" && player.depth > 0) return frontiers(view, terrain).some((grid) => leashed(view, grid));
      if (offer.goal === "fetch") {
        const loot = floorTarget(view, terrain, false, lastPersona);
        return loot !== null && leashed(view, loot.at);
      }
      if (offer.goal === "pick_up") return leashed(view, player.grid);
      return true;
    });
    if (player.depth === 0 && !town.ready) out = out.map((offer) => offer.goal === "descend" ? { ...offer, criteria: `Earn gold on dungeon level 1 for the missing ${town.reason}. The trip lasts at most ${String(EARNING_TURNS)} game turns and stays within ${String(EARNING_LEASH)} path steps of the up stairs.` } : offer);
    const reason = home ? `The character's ${returnReason ?? "supplies"} margin calls for town now.` : "This level has used its game-turn budget without enough progress.";
    if (player.depth > 0 && (home || expired)) {
      const walkable = departure.active() && player.depth < RECALL_FROM_DEPTH && (checkedRoute(view, exitTargets(view)) !== null || searching(view));
      if (searching(view)) out = out.map((offer) => offer.goal === "explore" ? { ...offer, criteria: `Search this level for the up stairs; walking home from here is cheaper than a Recall scroll. ${reason}` } : offer);
      if (!walkable && !recalling && safeDelay(view) && canRead(view) && recallItem(view) !== null && !out.some((offer) => offer.goal === "recall_town")) out.push({ goal: "recall_town", criteria: `Read Word of Recall to return to town while waiting is safe. ${reason}`, risk: 0.02 });
      if (checkedRoute(view, exitTargets(view)) !== null) {
        footOffered = true;
        out = out.filter((offer) => offer.goal !== "leave_level");
        out.push({ goal: "leave_level", criteria: home ? `Take the checked route to the up stairs and continue toward town. ${reason}` : `Take a checked staircase to a fresh or safer level. ${reason}`, risk: 0.02, survival: player.hp });
      }
    }
    if (breederLevel && !out.some((offer) => offer.goal === "leave_level") && checkedRoute(view, exitTargets(view)) !== null) {
      footOffered = true;
      out.push({ goal: "leave_level", criteria: "Leave this breeder level by the checked staircase. The exit objective lasts until the level changes.", risk: 0.02, survival: player.hp });
    }
    if (breederLevel && !recalling && safeDelay(view) && canRead(view) && recallItem(view) !== null && !out.some((offer) => offer.goal === "recall_town")) out.push({ goal: "recall_town", criteria: "Read Word of Recall to leave this breeder level while waiting is safe.", risk: 0.02, survival: player.hp });
    if (!footOffered && !view.monsters().some((monster) => monster.visible && !monster.asleep)) {
      const missing = missingPreparation(view, player.depth + 1)[0];
      if (missing !== void 0) out = out.map((offer) => offer.goal === "leave_level" ? { ...offer, criteria: `Take a checked up staircase to a safer level. The next depth needs ${missing.reason}.${offer.criteria.includes("the game says") ? ` ${offer.criteria}` : ""}` } : offer);
    }
    return out;
  }
  function guarded(goal, plan) {
    const foot = goal === "leave_level" && footOffered;
    const recalling = recallActive;
    const wide = widened;
    return { ...plan, step(view, act) {
      observe(view);
      const player = view.player();
      if (wide && goal === "explore" || goal === "explore" && searching(view)) return plan.step(view, act);
      if (breederLevel && (goal === "rest" || goal === "descend" || goal !== null && OPTIONAL.has(goal))) return null;
      if (breederLevel && goal !== null && ["fight", "shoot", "throw_oil", "cast_attack", "aim_wand"].includes(goal)) {
        const target = pickTarget(view.monsters(), player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
        if (target === null || steps(target.grid, player.grid) > 1) return null;
      }
      if (goal === "wait" && !safeDelay(view)) return null;
      if (goal === "rest" && recalling && !safeDelay(view)) return null;
      if (goal === "recall_dungeon" && (!town.ready || missingPreparation(view, player.maxDepth).length > 0)) return null;
      if (goal === "recall_town" && !safeDelay(view) && player.hp >= player.maxHp * 0.35 && !view.monsters().some((monster) => monster.visible && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed && player.level <= 3)) return null;
      if (goal === "descend") {
        if (player.depth === 0 && !town.ready && !town.earning && !wide || player.depth > 0 && missingPreparation(view, player.depth + 1).length > 0) return null;
        if (player.depth === 0 && (town.earning || wide && !town.ready) && !departure.active()) departure.begin(view, town.target);
      }
      if (goal === null) {
        const command = plan.step(view, act);
        if (command === null) return null;
        if (command.code === "descend") return !breederLevel && !expired && returnReason === null && (player.depth === 0 ? town.ready : missingPreparation(view, player.depth + 1).length === 0) ? command : null;
        if (command.code === "walk") {
          const direction = DIRECTIONS.find((entry) => entry.key === command.dir);
          const at = direction === void 0 ? null : { x: player.grid.x + direction.dx, y: player.grid.y + direction.dy };
          return at !== null && !breederLevel && !expired && returnReason === null && leashed(view, at) && !view.monsters().some((monster) => monster.visible && !monster.asleep && steps(monster.grid, at) <= 1) ? command : null;
        }
        return command.code === "pickup" && !breederLevel && leashed(view, player.grid) && !expired && returnReason === null ? command : null;
      }
      if (OPTIONAL.has(goal) && (expired || returnReason !== null || departure.finished(view))) return null;
      if (goal === "fetch") {
        const loot = floorTarget(view, terrain, false, lastPersona);
        if (loot === null ? !hasFloorObject(view, player.grid) || !leashed(view, player.grid) : !leashed(view, loot.at)) return null;
        const single = { ...view };
        delete single.travelPath;
        const command = plan.step(single, act);
        if (command?.code === "walk" || command?.code === "open") {
          const dir = DIRECTIONS.find((entry) => entry.key === command.dir);
          if (dir === void 0 || !leashed(view, { x: player.grid.x + dir.dx, y: player.grid.y + dir.dy })) return null;
        }
        return command;
      }
      if (goal === "leave_level" && !unseenDanger?.(view) && (foot || !view.monsters().some((monster) => monster.visible && !monster.asleep))) {
        const goals = exitTargets(view);
        const route = checkedRoute(view, goals);
        if (route === null) return null;
        const at = player.grid;
        const cell2 = view.cell(at.x, at.y);
        if (route.length === 0) return cell2 !== null && terrain.isUpStair(cell2.feat) ? act.ascend() : act.descend();
        const next = route[0];
        const dir = next === void 0 ? void 0 : DIRECTIONS.find((direction) => at.x + direction.dx === next.x && at.y + direction.dy === next.y);
        return dir === void 0 ? null : act.move(dir.key);
      }
      return plan.step(view, act);
    } };
  }
  function explore(ctx, wide = widened) {
    observe(ctx.view);
    const search = !wide && searching(ctx.view);
    if (!wide && !search && (expired || returnReason !== null || departure.finished(ctx.view))) return null;
    const allowed = (grid) => wide || search || leashed(ctx.view, grid);
    const goals = frontiers(ctx.view, terrain).filter(allowed);
    const at = ctx.view.player().grid;
    if (!goals.some((grid) => key(grid) === key(at))) {
      const field = flowFrom({ goals, canEnter: (grid) => isRoutable(ctx.view, terrain, grid) && allowed(grid) });
      const direction2 = stepDown(field, at, (grid) => isWalkable(ctx.view, terrain, grid) && allowed(grid));
      return direction2 === null ? null : ctx.act.move(direction2.key);
    }
    const direction = DIRECTIONS.find((dir) => {
      const next = { x: at.x + dir.dx, y: at.y + dir.dy };
      const cell2 = ctx.view.cell(next.x, next.y);
      return cell2 !== null && !cell2.known && allowed(next);
    });
    return direction === void 0 ? null : ctx.act.move(direction.key);
  }
  function blocked(view) {
    if (breederLevel) return "Squire must leave this breeder level, but it has no checked exit or safe Recall wait.";
    if (view.player().depth === 0 && !town.ready) return `Squire cannot leave town ready: it still needs ${town.reason}, and no bounded earning trip is safe.`;
    if (returnReason !== null) return `Squire needs town for ${returnReason}, but it has no checked return or safe Recall wait.`;
    const missing = missingPreparation(view, view.player().depth + 1)[0];
    return missing === void 0 ? null : `Squire cannot descend yet: it needs ${missing.reason}.`;
  }
  return { apply, guarded, explore, safeDelay, checkedRoute, leashed, blocked, breederExit };
}

// src/brain/hazards.ts
function trapDirection(view) {
  const at = view.player().grid;
  for (const direction of DIRECTIONS) {
    const cell2 = view.cell(at.x + direction.dx, at.y + direction.dy);
    if (cell2 !== null && cell2.known && cell2.trap) return direction.key;
  }
  return null;
}
function rubbleDirection(view, terrain) {
  if (terrain.isDiggable === void 0) return null;
  const at = view.player().grid;
  const goals = [...frontiers(view, terrain), ...knownStairs(view, terrain)];
  if (goals.length === 0) return null;
  const routable = (grid) => isRoutable(view, terrain, grid);
  const fromGoals = flowFrom({ goals, canEnter: routable });
  if (Number.isFinite(fromGoals.distance(at))) return null;
  for (const direction of DIRECTIONS) {
    const rock = { x: at.x + direction.dx, y: at.y + direction.dy };
    const cell2 = view.cell(rock.x, rock.y);
    if (cell2 === null || !cell2.known || cell2.passable || !terrain.isDiggable(cell2.feat)) continue;
    const beyond = { x: at.x + 2 * direction.dx, y: at.y + 2 * direction.dy };
    if (routable(beyond) && Number.isFinite(fromGoals.distance(beyond))) return direction.key;
  }
  return null;
}

// src/learning/grudges.ts
var MAX_FEELINGS = 6;
var MAX_KILLERS = 30;
var GRUDGE_NUDGE = { mild: 0.15, strong: 0.3, lasting: 0.45 };
var FEAR_SHIFT = { mild: 1, strong: 1, lasting: 2 };
var ATTACK_GOALS = ["fight", "shoot", "throw_oil", "aim_wand", "cast_attack"];
var AVOID_GOALS = ["leave_level", "retreat", "phase", "teleport"];
var NOT_A_CREATURE = /^(?:trap|bug|monster|starvation|hunger|poison|a fall|fall|drowning|lava|cuts?|bleeding|retiring|ripe old age|winning|quitting|suicide)$/i;
function same2(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
function killerOf(cause, seen = []) {
  const bare = cause.replace(/^killed by\s+/i, "").trim();
  const article2 = /^(?:an?|the)\s+/i.test(bare);
  const name = bare.replace(/^(?:an?|the)\s+/i, "").trim();
  if (name === "" || NOT_A_CREATURE.test(name)) return null;
  const match = seen.find((m) => same2(m.race, name));
  if (match !== void 0) return { name: match.race, unique: match.raceFlags.includes("UNIQUE") };
  return { name, unique: !article2 && /^[A-Z]/.test(name) };
}
function recordDeath(killers, killer, death) {
  if (killer === null) return [...killers];
  const at = killers.findIndex((k) => same2(k.name, killer.name));
  if (at === -1) return [...killers, { name: killer.name, unique: killer.unique, deaths: [death] }].slice(-MAX_KILLERS);
  return killers.map((k, i) => i === at ? { ...k, deaths: [...k.deaths, death] } : k);
}
function settle(killers, name, generation) {
  const at = killers.findIndex((k) => k.unique && same2(k.name, name) && active(k).length > 0);
  if (at === -1) return null;
  return killers.map((k, i) => i === at ? { ...k, settled: generation } : k);
}
function active(killer) {
  const since = killer.settled;
  return since === void 0 ? killer.deaths : killer.deaths.filter((d) => d.generation > since);
}
function intensityOf(count2) {
  if (count2 <= 0) return null;
  return count2 === 1 ? "mild" : count2 === 2 ? "strong" : "lasting";
}
function remembered(killer, heirGeneration) {
  const deaths = active(killer);
  if (deaths.length === 0) return 0;
  if (killer.unique || deaths.length >= 3) return deaths.length;
  const last = Math.max(...deaths.map((d) => d.generation));
  const age = Math.max(0, heirGeneration - last - 1);
  return Math.max(0, deaths.length - age);
}
function feelingKind(persona, count2) {
  const { boldness, pride, paranoia } = persona.sliders;
  if (persona.quirks.cowardice.on) return "fear";
  if (persona.quirks.deathwish.on) return "hatred";
  if (boldness >= 70 || pride >= 70) return "hatred";
  if (boldness <= 30 || paranoia >= 70) return "fear";
  const lean = boldness - 50 + (pride - 50) / 2 - (paranoia - 50) / 2;
  return lean >= 10 * (Math.min(3, count2) - 1) ? "hatred" : "fear";
}
function feelingsFor(killers, heirGeneration, heir, inheritance) {
  const share3 = Math.max(0, Math.min(1, inheritance / 100));
  const limit = Math.ceil(MAX_FEELINGS * share3);
  if (limit === 0) return [];
  const out = [];
  for (const killer of killers) {
    const count2 = remembered(killer, heirGeneration);
    const intensity = intensityOf(count2);
    if (intensity === null) continue;
    out.push({ name: killer.name, unique: killer.unique, kind: feelingKind(heir, count2), intensity, count: count2 });
  }
  return out.sort((a, b) => b.count - a.count || Number(b.unique) - Number(a.unique)).slice(0, limit);
}
function feelingToward(feelings, race) {
  return feelings.find((f) => same2(f.name, race));
}
function nudgeGrudges(dist, offers, feelings, inSight3, ceiling) {
  const out = { ...dist };
  let hate = 0;
  let fear = 0;
  for (const race of inSight3) {
    const feeling = feelingToward(feelings, race);
    if (feeling === void 0) continue;
    if (feeling.kind === "hatred") hate = Math.max(hate, GRUDGE_NUDGE[feeling.intensity]);
    else fear = Math.max(fear, GRUDGE_NUDGE[feeling.intensity]);
  }
  for (const offer of offers) {
    if (offer.risk > ceiling) continue;
    const boost = ATTACK_GOALS.includes(offer.goal) ? hate : AVOID_GOALS.includes(offer.goal) ? fear : 0;
    const current2 = out[offer.goal];
    if (boost > 0 && current2 !== void 0) out[offer.goal] = current2 * (1 + boost);
  }
  return out;
}
function fearedBand(band, bands, feeling) {
  if (feeling?.kind !== "fear") return band;
  return Math.max(0, Math.min(bands - 1, band + FEAR_SHIFT[feeling.intensity]));
}
var NUMBERS = ["no one", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function killedWhom(count2) {
  return `${NUMBERS[count2] ?? String(count2)} of the family`;
}
function named(feeling) {
  return feeling.unique ? feeling.name : `the ${feeling.name}`;
}
function feelingLine(feeling) {
  const how2 = feeling.kind === "hatred" ? "hates" : "fears";
  return `Remembers that ${named(feeling)} killed ${killedWhom(feeling.count)}, and ${how2} it (${feeling.intensity}).`;
}
function feelingLog(who, feeling) {
  const line = feelingLine(feeling);
  return `${who} ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}
function feelingBelief(feeling) {
  return `${named(feeling)} killed ${killedWhom(feeling.count)}, and the character ${feeling.kind === "hatred" ? "hates" : "fears"} it`;
}
function settledLine(who, name, _count) {
  return `${who} has slain ${name}. The family's grudge is settled.`;
}
function readKillers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_KILLERS).flatMap((raw) => {
    const k = record4(raw);
    if (k === null || typeof k["name"] !== "string" || k["name"].trim() === "") return [];
    const deaths = Array.isArray(k["deaths"]) ? k["deaths"].slice(-50).flatMap((d) => {
      const r = record4(d);
      if (r === null) return [];
      const generation = num2(r["generation"]);
      return generation === null ? [] : [{ generation, depth: num2(r["depth"]) ?? 0, turn: num2(r["turn"]) ?? 0 }];
    }) : [];
    if (deaths.length === 0) return [];
    const settled = num2(k["settled"]);
    return [{ name: k["name"].slice(0, 80), unique: k["unique"] === true, deaths, ...settled === null ? {} : { settled } }];
  });
}
function readFeelings(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FEELINGS).flatMap((raw) => {
    const f = record4(raw);
    if (f === null || typeof f["name"] !== "string" || f["name"].trim() === "") return [];
    const count2 = num2(f["count"]);
    const kind = f["kind"] === "hatred" || f["kind"] === "fear" ? f["kind"] : null;
    const intensity = count2 === null ? null : intensityOf(count2);
    if (count2 === null || kind === null || intensity === null) return [];
    return [{ name: f["name"].slice(0, 80), unique: f["unique"] === true, kind, intensity, count: count2 }];
  });
}
function record4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function num2(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

// src/brain/goals.ts
var NONE_OF_THESE2 = "None of the listed options suits this moment.";
var RETREAT_STEPS = 4;
var MISSILE_RANGE = 10;
function healthBand(hp, maxHp) {
  if (maxHp <= 0) return "unknown";
  const share3 = hp / maxHp;
  if (share3 >= 0.9) return "full";
  if (share3 >= 0.6) return "lightly hurt";
  if (share3 >= 0.35) return "badly hurt";
  return "near death";
}
var RECALL_MIN_GOLD = 50;
var ESCAPE_BELOW_HP = 0.7;
var DAMAGE_SHARE_REDECIDE = 0.1;
var MANA_STRANDED_MELEE = 3;
var BAD_CUT = 25;
var NASTY_CUT = 50;
var STATIONARY_DECISIONS = 3;
var SWARM_LEAVE = 6;
var SWARM_LEAVE_DREADED = 3;
var REFUSED_COMMANDS = 3;
var SAME_SITUATION_TURNS = 50;
var FORCED_RISK = 0.3;
var ROUTINE = ["wear", "detect", "study", "rest", "wait"];
var SURVIVAL_GOALS = /* @__PURE__ */ new Set(["swing_unseen", "cast_area", "unseen_staff", "unseen_wand", "unseen_rod", "step_aside", "descend", "fight", "shoot", "throw_oil", "aim_wand", "cast_attack", "heal", "cast_heal", "device", "phase", "teleport", "retreat", "leave_level"]);
var READS = /* @__PURE__ */ new Set(["cast_attack", "cast_heal", "study", "detect", "recall_town", "recall_dungeon", "deep_descent"]);
var REFUSAL_HOLD_TURNS = 200;
var SAME_TURN_PLANS = 3;
var HANDBOOK = Object.freeze([
  "Killing creatures earns experience, and experience makes the character stronger.",
  "Going deeper too early is a common way to die, but waking a sleeping creature just to clear a level is not worth the risk; once a level has nothing safe left to do, the stairs are the way on.",
  "Resting with an awake creature in sight gets interrupted. When the character could die before its next useful action, getting away matters more than dealing damage.",
  "Healing potions are worth drinking before hit points get too low to survive one more round. Phase Door jumps a short random distance, Teleportation moves far across the same level, and Teleport Level leaves the level.",
  "Missiles, thrown oil, wands and attack spells hurt a creature before it can reach the character.",
  "A mage under level 10 dies fast in melee; Magic Missile or a flask of oil thrown from a few steps away kills most early creatures before they arrive.",
  "Worm masses, lice and giant white mice split in two every few turns, so a room of them grows faster than a level 5 character can kill it; taking the nearest stairs leaves every one of them behind.",
  "While the character is afraid, the game refuses every melee blow without using a turn, but arrows, spells and wands still hit."
]);
function swarmOf(monsters) {
  const counts = /* @__PURE__ */ new Map();
  for (const m of monsters) {
    if (m.visible && m.raceFlags.includes("MULTIPLY")) counts.set(m.race, (counts.get(m.race) ?? 0) + 1);
  }
  let best = null;
  for (const [race, count2] of counts) if (best === null || count2 > best.count) best = { race, count: count2 };
  return best;
}
function situationOf(view, dreaded = /* @__PURE__ */ new Set(), stationary = /* @__PURE__ */ new Set(), remembered3 = [], unseenDamage = 0, terrain, speedEnergy, harmless) {
  const player = view.player();
  const monsters = view.monsters();
  const awake = awakeInSight(monsters).filter((monster) => harmless?.(monster) !== true);
  const target = pickTarget(monsters, player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
  const worst = awake.reduce((max, m) => Math.max(max, assessThreat(m, player, awake, view, dreaded, terrain, speedEnergy).band), -1);
  const swarm = swarmOf(monsters);
  return {
    dreaded,
    stationary,
    swarm,
    swarming: player.level <= 5 && awake.filter((monster) => monster.raceFlags.includes("MULTIPLY")).length >= 3 || swarm !== null && swarm.count >= (dreaded.has(swarm.race) ? SWARM_LEAVE_DREADED : SWARM_LEAVE),
    view,
    pack: readPack(view),
    awake,
    target,
    worst,
    hpShare: player.maxHp > 0 ? player.hp / player.maxHp : 1,
    threats: [...monsters.filter((m) => m.visible && harmless?.(m) !== true), ...remembered3.filter((m) => harmless?.(m) !== true && !monsters.some((other) => other.visible && other.id === m.id))],
    unseenDamage,
    lastSeen: /* @__PURE__ */ new Map(),
    ...terrain === void 0 ? {} : { terrain },
    ...speedEnergy === void 0 ? {} : { speedEnergy }
  };
}
function clamp012(n) {
  return Math.max(0, Math.min(1, n));
}
function groupLines(lines2) {
  const groups = /* @__PURE__ */ new Map();
  for (const line of lines2) {
    const key2 = `${line.race}|${line.capability ?? ""}|${line.band}|${line.tags}`;
    groups.set(key2, [...groups.get(key2) ?? [], line]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const nearest = Math.min(...group.map((g) => g.away));
    const tags = first.tags === "" ? "" : `, ${first.tags}`;
    const rating = first.capability === void 0 ? first.band : `${first.capability}, ${first.band}`;
    return group.length === 1 ? `${first.race}: ${rating}, ${String(nearest)} steps away${tags}` : `${String(group.length)} ${first.race}: ${rating} each, the nearest ${String(nearest)} steps away${tags}`;
  }).join("; ");
}
function crowd(s) {
  const at = s.view.player().grid;
  const near = s.awake.filter((m) => steps(at, m.grid) <= 5).length;
  return Math.min(1.8, 1 + 0.2 * Math.max(0, near - 1));
}
function statusOf(view, readable) {
  const p = view.player();
  const s = p.status;
  const lines2 = [
    s.paralyzed > 0 ? "Paralyzed, so it cannot act until this wears off." : "",
    s.afraid > 0 ? "Afraid, so it cannot attack in melee, though it can still shoot, throw and cast." : "",
    s.confused > 0 ? "Confused, so it cannot read scrolls or cast spells, and a step may go in a random direction." : "",
    s.blind > 0 ? "Blind, so it cannot read scrolls, cast spells or see monsters." : "",
    !readable && s.blind === 0 && s.confused === 0 ? "Too dark here to read scrolls or cast spells." : "",
    s.stun > 0 ? "Stunned, so its attacks miss more often and its spells fail more often." : "",
    s.poisoned > 0 ? "Poisoned, losing a few hit points each turn." : "",
    s.cut > 0 ? "Bleeding, losing hit points each turn until the cut heals or is cured." : "",
    p.speed < 110 ? "Slowed, so monsters get more turns than it does." : "",
    p.speed > 110 ? "Hasted, so it gets more turns than monsters of normal speed." : ""
  ].filter((line) => line !== "");
  return lines2.length === 0 ? "No status effects." : lines2.join(" ");
}
function swarmNote(seen) {
  const counts = /* @__PURE__ */ new Map();
  for (const m of seen) counts.set(m.race, (counts.get(m.race) ?? 0) + 1);
  const many = [...counts].filter(([, n]) => n >= 3).map(([race, n]) => `${String(n)} ${race}`);
  return many.length === 0 ? {} : { swarm: `${many.join(" and ")} in sight. More of one kind can keep coming, so fighting them all may not end; leaving the level does.` };
}
function fightRisk(s) {
  const target = s.target === null ? 0 : assessThreat(s.target, s.view.player(), s.awake, s.view, s.dreaded, s.terrain, s.speedEnergy).band;
  const band = Math.max(target, s.worst);
  return clamp012((BAND_RISK[band] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.4) * crowd(s) * (s.swarming ? 1.5 : 1));
}
function attackRisk(s, attack) {
  const standing = Math.max(fightRisk(s), exposure(s));
  if (s.target === null || s.target.hp <= 0) return standing;
  if (!attack.kill) return standing;
  const rest = damageFor({ ...s, threats: s.threats.filter((m) => m.id !== s.target.id) }).damage;
  return Math.max(0.05, damageRisk(rest, s.view.player().hp), standing * attack.failure);
}
function exposure(s) {
  const incoming = damageFor(s);
  return damageRisk(incoming.damage, s.view.player().hp);
}
function damageRisk(damage, hp) {
  return damage === 0 ? 0.01 : damage >= hp ? 1 : clamp012(0.02 + damage / Math.max(1, hp) * 0.6);
}
function damageFor(s, at = s.view.player().grid, actions = 1, terrain, openedDoor) {
  return incomingDamage(s.view, at, actions, terrain ?? s.terrain, { monsters: s.threats, unseenDamage: s.unseenDamage, ...s.unseenHit === void 0 ? {} : { unseenHit: s.unseenHit }, lastSeen: s.lastSeen, ...s.speedEnergy === void 0 ? {} : { energy: s.speedEnergy }, ...openedDoor === void 0 ? {} : { openedDoor } });
}
function combatContext(s) {
  return { ...s.terrain === void 0 ? {} : { terrain: s.terrain }, facts: { monsters: s.threats, unseenDamage: s.unseenDamage, ...s.unseenHit === void 0 ? {} : { unseenHit: s.unseenHit }, lastSeen: s.lastSeen, ...s.speedEnergy === void 0 ? {} : { energy: s.speedEnergy } } };
}
function combatOptions(s, kind) {
  return s.target === null ? [] : attackOptions(s.view, s.target, kind, combatContext(s));
}
function hurtsOnTouch(view, monster) {
  return /\btouch/i.test(view.monsterRecall?.(monster.raceIndex)?.text ?? "");
}
function killsQuickly(target, melee) {
  if (melee.kill) return true;
  return melee.damage !== null && melee.damage * 2 >= target.hp;
}
function safeRecovery(s, terrain) {
  const player = s.view.player();
  if (player.status.poisoned > 0 || player.status.cut > 0 || hungry(s.view) || standingOnHarm(s.view, terrain, player.grid)) return false;
  const incoming = damageFor(s, player.grid, 2, terrain);
  return incoming.damage === 0 && incoming.status === 0 && s.unseenDamage === 0 && !s.threats.some((m) => {
    const away = steps(player.grid, m.grid);
    return away <= (m.raceFlags.includes("MULTIPLY") ? 10 : m.asleep ? 8 : 5) || m.raceFlags.includes("PASS_WALL") && away <= 10;
  });
}
function closeDoorStep(s, terrain) {
  const view = s.view;
  const player = view.player();
  const incoming = damageFor(s, player.grid, 1, terrain);
  if (player.status.blind > 0 || player.status.confused > 0 || incoming.damage >= player.hp || incoming.status > 0) return null;
  const before = damageFor(s, player.grid, 2, terrain);
  for (const at of neighbours(player.grid)) {
    const cell2 = view.cell(at.x, at.y);
    if (cell2 === null || !cell2.known || !cell2.passable || !terrain.isOpenDoor?.(cell2.feat) || cell2.monster > 0 || cell2.trap || view.monsters().some((monster) => key(monster.grid) === key(at))) continue;
    const closedView = { ...view, cell: (x, y) => x === at.x && y === at.y ? { ...cell2, feat: -2, passable: false } : view.cell(x, y) };
    const closedTerrain = { ...terrain, isClosedDoor: (feat) => feat === -2 || terrain.isClosedDoor(feat) };
    const after = damageFor({ ...s, view: closedView }, player.grid, 2, closedTerrain);
    const field = flowFrom({ goals: knownStairs(closedView, closedTerrain), canEnter: (grid) => key(grid) !== key(at) && isRoutable(closedView, closedTerrain, grid) });
    if (after.damage < before.damage && after.status <= before.status && Number.isFinite(field.distance(player.grid)) && leaveStep({ ...s, view: closedView }, closedTerrain) !== null) return at;
  }
  return null;
}
function escapeRoute(s, terrain, goals) {
  const player = s.view.player();
  if (goals.some((at) => key(at) === key(player.grid))) return { at: player.grid, damage: 0, down: terrain.isDownStair(s.view.cell(player.grid.x, player.grid.y).feat) };
  if (pinned(s) || player.status.confused > 0) return null;
  const queue = [{ at: player.grid, elapsed: 0, first: player.grid, damage: 0 }];
  const visited = /* @__PURE__ */ new Map([[key(player.grid), 0]]);
  for (let head = 0; head < queue.length && head < 4e3; head += 1) {
    const here = queue[head];
    for (const at of neighbours(here.at)) {
      if (!isWalkable(s.view, terrain, at)) continue;
      const door = isClosedDoor(s.view, terrain, at);
      const elapsed = here.elapsed + (door ? 2 : 1);
      if (elapsed >= (visited.get(key(at)) ?? Infinity)) continue;
      const damage = here.damage + damageFor(s, at, elapsed, terrain, door ? at : void 0).damage + (door ? damageFor(s, here.at, here.elapsed + 1, terrain, at).damage : 0);
      if (damage >= player.hp && damage > 0) continue;
      const first = here.elapsed === 0 ? at : here.first;
      if (here.elapsed === 0 && damageFor(s).damage > 0 && damage > damageFor(s).damage * (player.level < 35 ? 0.8 : 0.6)) continue;
      const goal = goals.find((grid) => key(grid) === key(at));
      if (goal !== void 0) return { at: first, damage, down: terrain.isDownStair(s.view.cell(goal.x, goal.y).feat) };
      visited.set(key(at), elapsed);
      queue.push({ at, elapsed, first, damage });
    }
  }
  return null;
}
function leaveStep(s, terrain) {
  if (s.view.player().depth === 0) return null;
  if (missingPreparation(s.view, s.view.player().depth + 1).length > 0) {
    return escapeRoute(s, terrain, knownStairs(s.view, terrain).filter((at) => terrain.isUpStair(s.view.cell(at.x, at.y).feat)));
  }
  return escapeRoute(s, terrain, knownDownStairs(s.view, terrain)) ?? escapeRoute(s, terrain, knownStairs(s.view, terrain));
}
function retreatStep(s, terrain, flight) {
  if (flight !== "none") {
    const route = escapeRoute(s, terrain, flight === "down" ? knownDownStairs(s.view, terrain) : knownStairs(s.view, terrain));
    if (route !== null) return route;
  }
  if (pinned(s) || s.view.player().status.confused > 0) return null;
  const at = s.view.player().grid;
  const threats = s.threats.filter((m) => !m.asleep).map((m) => m.grid);
  if (s.unseenHit !== void 0 && s.unseenDamage > 0) threats.push(s.unseenHit.grid);
  const field = flowFrom({ goals: threats, canEnter: (grid) => isRoutable(s.view, terrain, grid) || threats.some((t) => key(t) === key(grid)) });
  const current2 = damageFor(s).damage;
  const safe = (grid) => {
    if (!isWalkable(s.view, terrain, grid)) return false;
    const damage = isClosedDoor(s.view, terrain, grid) ? Math.max(damageFor(s, at, 1, terrain, grid).damage, damageFor(s, grid, 2, terrain, grid).damage) : damageFor(s, grid, 1, terrain).damage;
    return damage < s.view.player().hp && (current2 === 0 || damage <= current2 * (s.view.player().level < 35 ? 0.8 : 0.6));
  };
  if (s.unseenDamage > 0) {
    const shelter = (grid) => (s.view.cell(grid.x, grid.y)?.glow === true ? 1 : 0) + 1 / (1 + neighbours(grid).filter((next2) => isRoutable(s.view, terrain, next2)).length);
    const next = neighbours(at).filter((grid) => safe(grid) && !isClosedDoor(s.view, terrain, grid)).sort((a, b) => damageFor(s, a).damage - damageFor(s, b).damage || shelter(b) - shelter(a))[0];
    if (next !== void 0) return { at: next, damage: damageFor(s, next).damage, down: false };
  }
  const direction = stepAway(field, at, safe);
  if (direction === null) return null;
  const to = { x: at.x + direction.dx, y: at.y + direction.dy };
  return { at: to, damage: isClosedDoor(s.view, terrain, to) ? Math.max(damageFor(s, at, 1, terrain, to).damage, damageFor(s, to, 2, terrain, to).damage) : damageFor(s, to, 1, terrain).damage, down: false };
}
function within(s, range) {
  return s.target !== null && steps(s.view.player().grid, s.target.grid) <= range;
}
function pinned(s) {
  const player = s.view.player();
  return s.awake.some((m) => steps(player.grid, m.grid) <= 1 && m.speed >= player.speed);
}
function immediateDanger(s) {
  const incoming = damageFor(s);
  return incoming.damage > 0 || incoming.status > 0;
}
function stairsUnderfoot(s, terrain) {
  const player = s.view.player();
  const cell2 = s.view.cell(player.grid.x, player.grid.y);
  return player.depth > 0 && cell2 !== null && (terrain.isUpStair(cell2.feat) || terrain.isDownStair(cell2.feat));
}
function canReach(view, terrain, grid) {
  const field = flowFrom({ goals: [grid], canEnter: (g) => g.x === grid.x && g.y === grid.y || isRoutable(view, terrain, g) });
  return Number.isFinite(field.distance(view.player().grid));
}
function reachableStairs(view, terrain) {
  const stairs = knownDownStairs(view, terrain);
  if (stairs.length === 0) return false;
  const me = view.player().grid;
  if (stairs.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals: stairs, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(me));
}
function reachableAnyStairs(view, terrain) {
  const stairs = knownStairs(view, terrain);
  if (stairs.length === 0) return false;
  const me = view.player().grid;
  if (stairs.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals: stairs, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(me));
}
function retreatStairs(s, terrain, widen) {
  const player = s.view.player();
  if (player.depth === 0) return "none";
  const pressing = widen || s.worst >= 2 || s.hpShare < ESCAPE_BELOW_HP || player.status.afraid > 0;
  if (pressing) return reachableAnyStairs(s.view, terrain) ? "any" : "none";
  return reachableStairs(s.view, terrain) ? "down" : "none";
}
function reachableFrontier(view, terrain) {
  const goals = frontiers(view, terrain);
  if (goals.length === 0) return false;
  const me = view.player().grid;
  if (goals.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(view.player().grid));
}
var RECALL_WAIT_TURNS = 400;
var RECALL_HOLD_STEPS = 40;
var DEEP_DESCENT_WAIT_TURNS = 80;
function recallPending(player, read, turn) {
  const reported = player.recall;
  if (typeof reported === "number") return reported > 0;
  const depth2 = player.depth;
  return read !== null && read.depth === depth2 && turn - read.turn >= 0 && turn - read.turn <= RECALL_WAIT_TURNS;
}
function offersFor(s, cfg, terrain, persona = null, visited = /* @__PURE__ */ new Set(), triedStudies = /* @__PURE__ */ new Set(), newLevel = false, recallActive = false, widen = false, saving = false, rememberedFeeling = null, aims = [], feelings = [], flourishes = emptyFlourishes(), storeMemory) {
  const view = s.view;
  const player = view.player();
  const at = player.grid;
  const hurt = player.hp < player.maxHp;
  const out = [];
  const incoming = damageFor(s, at, 1, terrain);
  const recovery = safeRecovery(s, terrain);
  const add2 = (goal, criteria, risk, routine = false, survival = player.hp - incoming.damage, uncertain = false) => out.push({ goal, criteria, risk: clamp012(risk), survival, ...routine ? { routine: true } : {}, ...uncertain ? { uncertain: true } : {} });
  const exit = leaveStep(s, terrain);
  const addLeave = (criteria, _risk) => {
    if (exit !== null && !out.some((o) => o.goal === "leave_level")) add2("leave_level", criteria, damageRisk(exit.damage, player.hp), false, player.hp - exit.damage);
  };
  const nearDeath = s.hpShare < 0.35;
  const unseenLethal = s.unseenDamage > 0 && damageFor(s, at, 2, terrain).damage >= player.hp;
  const fastUnique = inSight(view.monsters()).find((m) => fastUniqueAtLowLevel(m, player));
  const melee = s.target === null ? void 0 : combatOptions(s, "fight")[0];
  const strandedMelee = s.target !== null && !s.target.asleep && melee !== void 0 && attackSpellsOutOfMana(view) && (hurtsOnTouch(view, s.target) || !killsQuickly(s.target, melee));
  const meleeDanger = strandedMelee && s.target !== null && steps(at, s.target.grid) <= 1;
  if (s.breederExit === true || player.level <= 5 && s.swarming) {
    const door = closeDoorStep(s, terrain);
    if (door !== null) add2("close_door", "Close the adjacent open door to separate the breeders from the exit route. The closing action is survivable and the door reduces incoming damage over two actions.", damageRisk(incoming.damage, player.hp));
  }
  const addAttack = (goal, criteria, attack, weight = 1) => {
    const remaining = attack.kill && s.target !== null ? damageFor({ ...s, threats: s.threats.filter((monster) => monster.id !== s.target.id) }, at, 1, terrain).damage : incoming.damage;
    add2(goal, criteria + attackDescription(attack, view), attackRisk(s, attack) * weight, false, player.hp - remaining, attack.failure > 0 && attack.kill);
  };
  const needs = supplyNeeds(view, s.pack, persona, flourishes.darkLesson);
  const recall = canRead(view) ? recallItem(view) : null;
  const townRisk = s.awake.some((m) => steps(at, m.grid) <= 3) ? Math.max(0.02, BAND_RISK[s.worst] ?? 0.75) : 0.02;
  const starving = needs.some((n) => n.kind === "food" && n.have === 0 && n.hungry === true);
  const defenceless = s.pack.heal.length === 0 && s.pack.phase.length === 0 && s.pack.teleport.length === 0 && s.pack.escapeSpell.length === 0;
  const tripPays = starving || player.gold >= RECALL_MIN_GOLD && (player.depth >= RECALL_FROM_DEPTH || defenceless);
  if (recallActive && damageFor(s, at, 2, terrain).damage === 0 && incoming.status === 0 && s.unseenDamage === 0) {
    add2("wait", "Wait for the Word of Recall already read to take effect.", exposure(s) * 0.8, s.awake.length === 0);
  }
  if (!recallActive && player.depth > 0 && recall !== null && (nearDeath || fastUnique !== void 0 && !immediateDanger(s))) {
    add2("recall_town", "Read Word of Recall to leave the dungeon. It takes 15 to 34 turns to work and cannot stop the next blow.", exposure(s));
  } else if (!recallActive && player.depth > 0 && recall !== null && lowOnSupplies(needs) && tripPays && !immediateDanger(s)) {
    const low = needs.filter((n) => n.kind !== "recall" && n.have < (n.kind === "healing" ? 2 : n.kind === "phase" ? 1 : n.hungry ? 1 : 0));
    add2("recall_town", `Read Word of Recall to return to town and restock. The character is low on ${low.map((n) => n.name).join(", ")}.`, townRisk);
  }
  if (player.depth === 0) {
    const shops = neededEntrances(view, terrain, persona, visited, aims, flourishes, storeMemory);
    if (shops.length > 0) {
      const missing = needs.filter((n) => n.have < n.want).map((n) => n.name);
      add2("shop", missing.length > 0 ? `Visit the shops for ${missing.join(", ")}.` : `Visit the ${shops[0].name} to inspect its stock.`, townRisk);
    } else if (!recallActive && recall !== null && player.maxDepth > 1) {
      add2("recall_dungeon", `Read Word of Recall to return to the deepest level reached, ${String(player.maxDepth * 50)} ft.`, townRisk);
    }
  }
  if (s.target !== null) {
    const adjacent2 = steps(at, s.target.grid) <= 1;
    const walkUp = !adjacent2 && !fastUniqueAtLowLevel(s.target, player) && !s.stationary.has(s.target.id) && canReach(view, terrain, s.target.grid);
    if ((adjacent2 || walkUp) && player.status.afraid === 0 && melee !== void 0) {
      const away = steps(at, s.target.grid);
      const touch = hurtsOnTouch(view, s.target);
      const warning = strandedMelee ? ` The character is out of mana for its attack spells and this creature ${touch ? "hurts on touch" : "cannot be killed quickly"}, so resting, retreating or leaving the level is safer.` : "";
      addAttack("fight", (adjacent2 ? `Fight the ${s.target.race} in melee until it dies or something changes.` : `Walk ${String(away)} steps to the ${s.target.race}${s.target.asleep ? ", waking it," : ""} and fight it in melee; it can strike first while the character closes in.`) + warning, melee, strandedMelee ? MANA_STRANDED_MELEE : 1);
    }
    const ranged = within(s, MISSILE_RANGE);
    const clear = clearShot(view, s.target);
    const missile = combatOptions(s, "shoot")[0];
    if (ranged && clear && s.pack.launcher && missile !== void 0) {
      addAttack("shoot", `Fire at the ${s.target.race} with the equipped launcher (carrying ${missile.source?.name ?? "ammunition"}).`, missile);
    }
    const oil = combatOptions(s, "throw_oil")[0];
    if (ranged && clear && oil !== void 0) {
      addAttack("throw_oil", `Throw ${oil.source?.name ?? "a flask of oil"} at the ${s.target.race}.`, oil);
    }
    const wand = combatOptions(s, "aim_wand")[0];
    if (ranged && clear && wand !== void 0) {
      addAttack("aim_wand", `Aim ${wand.source?.name ?? "a wand"} at the ${s.target.race}.`, wand);
    }
    const cast = combatOptions(s, "cast_attack")[0];
    const spell = cast?.source !== null && cast?.source !== void 0 && "sidx" in cast.source ? cast.source : void 0;
    if (ranged && spell !== void 0 && (clear || /(?:ball|orb|cloud|storm)/i.test(spell.name) && bestBallAim(view, s.awake, s.target) !== null)) {
      const aim = /(?:ball|orb|cloud|storm)/i.test(spell.name) ? "at the best visible blast position" : `at the ${s.target.race}`;
      addAttack("cast_attack", `Cast ${spell.name} ${aim}: it costs ${String(spell.mana)} of the ${String(player.sp)} mana left (${String(spell.fail)}% chance to fail).`, cast);
    }
  }
  const cutBad = player.status.cut > BAD_CUT && s.pack.heal[0] !== void 0;
  const bleeding = player.status.cut > NASTY_CUT && s.pack.heal[0] !== void 0;
  const potion = healingPotion(view, incoming.damage);
  const cureStatus = player.status.poisoned > 0 || player.status.cut > 0 || player.status.blind > 0 || player.status.confused > 0;
  if ((hurt || cutBad) && potion !== void 0 && (!recovery || cureStatus)) {
    const healed = healingAmount(view, potion);
    const after = Math.min(player.maxHp, player.hp + healed);
    if (healed >= incoming.damage || incoming.damage >= player.hp || cureStatus) {
      add2("heal", `Drink ${potion.name} to restore hit points.${cutBad ? " It also closes the bleeding wound." : ""} The cure reaches at least ${String(after)} HP before up to ${String(incoming.damage)} incoming damage.`, damageRisk(incoming.damage, after), false, after - incoming.damage);
    }
  }
  const healSpell = healingSpell(view, incoming.damage);
  if (hurt && healSpell !== void 0) {
    const after = Math.min(player.maxHp, player.hp + healingAmount(view, healSpell));
    const bound = healSpell.fail === 0 ? after : player.hp;
    if (incoming.damage === 0 || after > incoming.damage && (after - player.hp >= incoming.damage || incoming.damage >= player.hp && after - player.hp > incoming.damage / 3)) add2("cast_heal", `Cast ${healSpell.name} to restore hit points (${String(healSpell.fail)}% chance to fail).`, Math.max(healSpell.fail / 100, damageRisk(incoming.damage, bound)), false, bound - incoming.damage, healSpell.fail > 0);
  }
  const leaveBy = exit?.down === true ? "Walk to a known down staircase and take it" : "Walk to the nearest staircase, up or down, and take it";
  if (s.unseenDamage > 0) {
    addLeave(`${leaveBy}. Recent unexplained damage still makes this region dangerous even with no attacker in sight. The route has been checked against incoming damage.`, exposure(s));
    if (player.status.afraid === 0) add2("swing_unseen", "Swing into an adjacent square where the unseen attacker might stand. Use its last known direction when available, otherwise choose a random direction. A miss spends an action exposed to another hit.", exposure(s), false, player.hp - incoming.damage, true);
    for (const goal of ["cast_area", "unseen_staff", "unseen_wand", "unseen_rod"]) {
      const source = unseenAttacks(view, goal, player.depth > 0 && player.gold < RECALL_MIN_GOLD && !reachableAnyStairs(view, terrain) && reachableFrontier(view, terrain))[0];
      if (source === void 0) continue;
      const purpose = /Treasure Location/i.test(source.name) ? "look for treasure to fund supplies while searching this unexplored floor for an exit; it cannot reveal the attacker" : /Mapping/i.test(source.name) ? "map ground that might lead to an exit; it cannot reveal the attacker" : goal === "cast_area" ? "cast an area effect where the attacker might stand" : goal === "unseen_staff" ? "affect or reveal creatures without seeing a target" : "aim toward the attacker's likely position";
      add2(goal, `Use ${source.name} to ${purpose}. The attacker's position and resistance are uncertain; this costs an action exposed to another hit and can fail or miss.`, exposure(s), false, player.hp - incoming.damage, true);
    }
    for (const goal of ["detect", "see_invisible", "light_room"]) {
      const source = unseenSources(view, goal)[0];
      if (source === void 0) continue;
      const purpose = goal === "detect" ? "look for the creature dealing unexplained damage" : goal === "see_invisible" ? "see an invisible attacker for a while" : "light the room and reveal creatures beyond the carried light";
      add2(goal, `Use ${source.name} to ${purpose}. This spends an action exposed to the unseen threat; success does not prove the region is safe.`, exposure(s));
    }
  }
  if (stairsUnderfoot(s, terrain) && (nearDeath || s.worst >= 2)) {
    addLeave("Take the staircase underfoot now to leave the creatures behind.", 0.01);
  }
  if (fastUnique !== void 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy}. The ${fastUnique.race} moves faster than this low-level character; leave before it closes in.`, exposure(s) * 0.3);
  }
  if (widen && !(s.swarming && s.swarm !== null) && s.awake.length > 0 && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy} to leave every creature on this level behind.`, exposure(s) * 0.4);
  }
  if (s.swarming && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`${leaveBy}. ${String(s.swarm.count)} ${s.swarm.race} are in sight and breed faster than they die; a new level leaves them behind.`, exposure(s) * 0.3);
  }
  const feared = feelings.length === 0 ? void 0 : inSight(view.monsters()).find((m) => feelingToward(feelings, m.race)?.kind === "fear");
  if (feared !== void 0 && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    const who = feared.raceFlags.includes("UNIQUE") ? feared.race : `the ${feared.race}`;
    addLeave(`${leaveBy}. The character fears ${who}, which killed some of its family, and a new level leaves it behind.`, exposure(s) * 0.3);
  }
  const outOfMana = player.maxSp > 0 && player.sp === 0;
  if (outOfMana && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`The character is out of mana and ${s.swarm.race} breeds; walk to the stairs and leave rather than melee it.`, exposure(s) * 0.3);
  }
  const feeling = rememberedFeeling ?? badLevelFeeling(view.messages());
  if (feeling !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`Leave the level: the game says "${feeling}"`, exposure(s) * 0.3);
  }
  if (player.depth > 0 && s.awake.length === 0 && !reachableFrontier(view, terrain) && !reachableStairs(view, terrain) && reachableAnyStairs(view, terrain)) {
    addLeave("Take the nearest staircase to a new level: nothing unexplored can be reached here and no way down is known.", exposure(s) + 0.02);
  }
  if (player.depth > 0 && s.awake.length === 0 && !reachableFrontier(view, terrain) && missingPreparation(view, player.depth + 1).length > 0) {
    addLeave("The character can earn more experience on a fresh floor by taking the up stairs.", exposure(s) + 0.02);
  }
  if (nearDeath || s.unseenDamage > 0 || meleeDanger || s.awake.length > 0 && (widen || s.worst >= 1 || s.hpShare < ESCAPE_BELOW_HP || player.status.afraid > 0)) {
    if (s.pack.phase[0] !== void 0 || s.pack.escapeSpell[0] !== void 0) {
      const how2 = s.pack.phase[0]?.name ?? s.pack.escapeSpell[0]?.name ?? "";
      const short2 = s.pack.phase[0] !== void 0 || /^(Phase Door|Blink|Shadow Shift)$/i.test(how2);
      add2("phase", `Use ${how2}: a ${short2 ? "short" : "long"} random teleport that breaks contact${short2 ? " for a moment" : ""}.`, Math.max(0.1, exposure(s) * 0.4), false, player.hp, true);
    }
    if (s.pack.teleport[0] !== void 0) {
      const teleport = s.pack.teleport[0];
      const leaves = /Teleport Level/i.test(teleport.name);
      add2("teleport", leaves ? `Use ${teleport.name} to leave this level entirely, going one level up or down.` : `Use ${teleport.name} to escape far from every creature in sight.`, Math.max(0.05, exposure(s) * (leaves ? 0.3 : 0.2)), false, player.hp, !leaves || /Staff/i.test(teleport.name));
    }
    if (!immediateDanger(s) && s.pack.descent[0] !== void 0) {
      add2("deep_descent", `Read ${s.pack.descent[0].name} to leave this level after a delay of 4 to 7 turns. It drops the character several levels deeper.`, exposure(s) * 0.8 + 0.2);
    }
    const flight = retreatStairs(s, terrain, widen);
    const retreat = retreatStep(s, terrain, flight);
    if ((s.awake.length > 0 || s.unseenDamage > 0) && retreat !== null) add2("retreat", s.unseenDamage > 0 ? "Step away from the region of unexplained damage toward a checked escape route or safer ground; the unseen attacker could still follow." : flight === "any" ? "Head for the nearest known staircase and take it, leaving the awake creatures behind." : flight === "down" ? "Head for a known down staircase and take it, leaving the awake creatures behind." : "Step up to four steps away from the awake creatures in sight; one standing next to the character may still strike as it leaves.", damageRisk(retreat.damage, player.hp), false, player.hp - retreat.damage);
  }
  if (!bleeding && s.awake.length === 0 && recovery && (hurt || player.sp < player.maxSp)) {
    add2("rest", "Rest until hit points and mana recover.", 0.01, recallActive);
  }
  if (hungry(view) && s.pack.food[0] !== void 0) {
    add2("eat", `Eat ${s.pack.food[0].name}; the character is hungry.`, exposure(s));
  }
  const gear = gearCandidates(view).find((g) => !g.unknown || (persona?.sliders.curiosity ?? 0) >= 50);
  const unlit = gear !== void 0 && gear.criteria.includes("has no light");
  if (!bleeding && incoming.damage < player.hp && gear !== void 0 && (unlit || !s.awake.some((m) => steps(at, m.grid) <= 3))) {
    add2("wear", gear.criteria, Math.max(gear.unknown ? 0.05 : 0.02, exposure(s)), !gear.unknown && gear.safeUpgrade !== false && s.awake.length === 0 && !immediateDanger(s));
  }
  if (!bleeding && newLevel && player.depth > 0 && s.awake.length === 0 && s.unseenDamage === 0) {
    const source = detectionSource(view);
    if (source !== null) add2("detect", `${source.kind === "cast" ? "Cast" : source.kind === "zap" ? "Zap" : "Read"} ${source.name} to survey this new level.`, 0.02, true);
  }
  const study = studyable(view, triedStudies);
  const learnFirst = study !== null && s.awake.length === 0 && !immediateDanger(s);
  if (!bleeding && study !== null && incoming.status === 0 && incoming.damage < player.hp * cfg.retreatFraction) {
    add2("study", `Learn the spell ${study.spell} from a carried book. It takes one turn.`, exposure(s), s.awake.length === 0 && !immediateDanger(s));
  }
  if (!bleeding) {
    if (trapDirection(view) !== null) add2("disarm", "Disarm the visible trap next to the character before stepping onto it.", exposure(s) * 0.5);
    if (rubbleDirection(view, terrain) !== null) add2("tunnel", "Tunnel through the rubble that blocks the way to the rest of the level.", exposure(s) * 0.5);
  }
  const hardFight = s.target !== null && (s.worst >= 2 || fightRisk(s) >= 0.4);
  if (!bleeding && hardFight) {
    const buff = buffUse(view);
    if (buff !== null) add2("buff", `Use ${buff.name} before the fight: it makes the character stronger for a while.`, exposure(s) * 0.6);
    const activation = activationUse(view);
    if (activation !== null) add2("activate", `Activate ${activation.name} before the fight.`, exposure(s) * 0.6);
  }
  if (!bleeding && hurt) {
    const device = deviceHealUse(view);
    if (device !== null && !recovery) {
      const after = Math.min(player.maxHp, player.hp + healingAmount(view, device));
      if (after > incoming.damage || incoming.damage >= player.hp) add2("device", `Use ${device.name} to restore hit points.`, damageRisk(incoming.damage, after), false, player.hp - incoming.damage, true);
    }
  }
  const breather = breatherInSight(view, s.awake);
  if (!bleeding && breather !== null) {
    const resist = resistUse(view);
    if (resist !== null) add2("resist", `Use ${resist.name} before the ${breather.race} breathes${breather.element === null ? "" : ` ${breather.element}`}.`, exposure(s) * 0.6);
  }
  const full = packFull(view);
  if (!bleeding && !full) {
    const loot = floorTarget(view, terrain, saving, persona);
    if (loot?.look === true) add2("fetch", `Walk ${String(loot.away)} step${loot.away === 1 ? "" : "s"} to look at ${loot.name} on the floor.`, exposure(s) + 0.02);
    else if (loot !== null) {
      const why = loot.gold ? " It is gold, which buys the aim." : loot.sellable ? " It looks worth selling." : "";
      add2("fetch", `Walk ${String(loot.away)} step${loot.away === 1 ? "" : "s"} to the ${loot.name} on the floor and pick it up.${why}`, exposure(s) + 0.02);
    }
  }
  if (!bleeding && full) {
    const junk = junkInPack(view);
    if (junk !== null) add2("drop_junk", `The pack is full; drop ${junk.name} to make room.`, exposure(s));
  }
  if (hasFloorObject(view, at) && !full) add2("pick_up", "Pick up the object on the floor under the character.", exposure(s));
  const townNeedsStairs = player.depth === 0 && knownDownStairs(view, terrain).length === 0;
  const townStairsReached = player.depth === 0 && !townNeedsStairs && reachableStairs(view, terrain);
  if ((!unlit || townNeedsStairs) && !learnFirst && !bleeding && !townStairsReached && (reachableFrontier(view, terrain) || townNeedsStairs)) {
    add2("explore", s.unseenDamage > 0 ? "Keep exploring toward unexplored ground despite the recent unexplained hits. Small hits can be endured, but an empty visible list does not prove safety." : "Walk toward the nearest unexplored ground on this level.", exposure(s) + 0.02);
  }
  if ((!unlit || player.depth === 0) && !learnFirst && !bleeding && reachableStairs(view, terrain) && cfg.descend && /* In town, the stairs are the way down whenever recall cannot be: no scroll,
   * or no depth yet to return to. Shopping comes first while there is gold. */
  (player.depth > 0 || (recall === null || player.maxDepth <= 1) && (player.gold <= 0 || neededEntrances(view, terrain, persona, visited, aims, flourishes, storeMemory).length === 0))) {
    add2("descend", "Walk to a known down staircase and take it to the next, more dangerous level.", exposure(s) + (1 - s.hpShare) * 0.3);
  }
  const adequate = out.some((offer) => SURVIVAL_GOALS.has(offer.goal) && (offer.survival ?? 0) > 0);
  return out.filter((offer) => {
    if (unseenLethal && !SURVIVAL_GOALS.has(offer.goal)) return false;
    if (adequate && (offer.goal === "heal" || offer.goal === "cast_heal" || offer.goal === "device") && (offer.survival ?? 0) <= 0) return false;
    return true;
  });
}
function createGoalPlanner(options) {
  const { cfg, terrain, log } = options;
  const journey = createJourney(terrain, (view) => situationNow(view).unseenDamage > 0);
  const personaOption = options.persona;
  const personaOf = typeof personaOption === "function" ? personaOption : () => personaOption ?? null;
  const flourishesNow = () => options.flourishes?.() ?? emptyFlourishes();
  function flourishView(view) {
    const run = flourishesNow();
    const persona = personaOf();
    if (!persona?.toggles.inheritedSuperstitions || run.superstitions.length === 0) return view;
    return { ...view, inventory: () => view.inventory().map((item) => distrusted(item, run, persona) ? { ...item, activation: false } : item) };
  }
  const rng = options.rng ?? Math.random;
  const backstoryTokens = options.backstoryTokens ?? 600;
  let lastAwake = /* @__PURE__ */ new Set();
  const grudgeNoticed = /* @__PURE__ */ new Set();
  const visitedShops = /* @__PURE__ */ new Set();
  const triedStudies = /* @__PURE__ */ new Set();
  let decisionDepth = null;
  let recallRead = null;
  let descentRead = null;
  const rememberedThreats = /* @__PURE__ */ new Map();
  let observed = null;
  let unseenHit = null;
  const hurtBy = /* @__PURE__ */ new Set();
  const contacts = /* @__PURE__ */ new Map();
  function harmlessNow(view, monster) {
    return !hurtBy.has(monster.race) && harmlessKind(monster, view, contacts.get(monster.id) ?? 0);
  }
  function situationNow(view, update2 = false, observe = update2) {
    view = flourishView(view);
    const player = view.player();
    const turn = view.turn();
    if (observed !== null && observed.depth !== player.depth) {
      rememberedThreats.clear();
      unseenHit = null;
      contacts.clear();
    }
    const liveIds = new Set(view.monsters().map((m) => m.id));
    for (const id of rememberedThreats.keys()) if (!liveIds.has(id)) rememberedThreats.delete(id);
    if (observe) {
      const visible = view.monsters().filter((m) => m.visible);
      const explains = (grid, damage) => {
        const background = incomingDamage(view, grid, 2, terrain, { monsters: [], ...options.speedEnergy === void 0 ? {} : { energy: options.speedEnergy } }).damage;
        return visible.some((monster) => !monster.asleep && incomingDamage(view, grid, 2, terrain, { monsters: [monster], ...options.speedEnergy === void 0 ? {} : { energy: options.speedEnergy } }).damage - background >= damage);
      };
      if (unseenHit !== null && explains(unseenHit.grid, unseenHit.damage)) unseenHit = null;
      if (observed !== null && observed.depth === player.depth && observed.hp > player.hp && !explains(observed.grid, observed.hp - player.hp) && !explains(player.grid, observed.hp - player.hp) && player.status.poisoned === 0 && player.status.cut === 0 && !standingOnHarm(view, terrain, observed.grid) && !standingOnHarm(view, terrain, player.grid)) {
        const likely = [...rememberedThreats.values()].filter((m) => steps(player.grid, m.monster.grid) <= 1).sort((a, b) => b.turn - a.turn)[0];
        unseenHit = { grid: { ...player.grid }, damage: observed.hp - player.hp, turn, ...likely === void 0 ? {} : { direction: directionToward(player.grid, likely.monster.grid) ?? void 0 } };
      }
      for (const monster of visible) rememberedThreats.set(monster.id, { monster: { ...monster, grid: { ...monster.grid }, visible: false }, turn });
      const awakeVisible = visible.filter((monster) => !monster.asleep);
      const adjacent2 = awakeVisible.filter((monster) => steps(player.grid, monster.grid) <= 1 || observed !== null && steps(observed.grid, monster.grid) <= 1);
      if (observed !== null && observed.depth === player.depth && observed.hp > player.hp) {
        const blamed = adjacent2.length > 0 ? adjacent2 : awakeVisible.filter((monster) => monster.spellFlags.length > 0);
        for (const monster of blamed) hurtBy.add(monster.race);
      } else {
        for (const monster of adjacent2) contacts.set(monster.id, (contacts.get(monster.id) ?? 0) + 1);
      }
      observed = { depth: player.depth, hp: player.hp, grid: { ...player.grid } };
    }
    for (const [id, memory] of rememberedThreats) if (turn - memory.turn > 50 || turn < memory.turn) rememberedThreats.delete(id);
    const unseenDamage = unseenDamageAt(unseenHit ?? void 0, player.grid, turn);
    const situation = situationOf(view, dreadedNow(), stationaryNow(view, update2), [...rememberedThreats.values()].map((m) => m.monster), unseenDamage, terrain, options.speedEnergy, (monster) => harmlessNow(view, monster));
    return { ...situation, ...unseenHit === null ? {} : { unseenHit }, breederExit: journey.breederExit(view), lastSeen: new Map([...rememberedThreats].map(([id, memory]) => [id, memory.turn])) };
  }
  const stalled = /* @__PURE__ */ new Map();
  const sameTurn = /* @__PURE__ */ new Map();
  let sameTurnAt = null;
  let offeredWiden = false;
  const refused = /* @__PURE__ */ new Map();
  let lastAnswer = null;
  let lastOutcome = null;
  let outcomeVersion = 0;
  let badFeeling = null;
  let feelingDepth = -1;
  function noteFeeling(view) {
    const depth2 = view.player().depth;
    const messages = view.messages();
    if (depth2 !== feelingDepth || arrivalFeeling(messages)) {
      feelingDepth = depth2;
      badFeeling = null;
    }
    const seen = badLevelFeeling(messages);
    if (seen !== null) badFeeling = seen;
  }
  function noteOutcome(text) {
    lastOutcome = text;
    outcomeVersion += 1;
  }
  function noteStalls(goal, plan, turn) {
    plan = journey.guarded(goal, plan);
    if (goal !== null) {
      if (sameTurnAt !== turn) {
        sameTurnAt = turn;
        sameTurn.clear();
      }
      sameTurn.set(goal, (sameTurn.get(goal) ?? 0) + 1);
    }
    let issued = 0;
    let startTurn = null;
    let credited = false;
    const version = outcomeVersion;
    const settle2 = (v) => {
      if (credited || goal === null || issued === 0 || startTurn === null || v.turn() === startTurn) return;
      credited = true;
      options.orders?.carried(goal, v);
    };
    const step = (v, act) => {
      startTurn ??= v.turn();
      settle2(v);
      const proposed = plan.step(v, act);
      const command = proposed !== null && distrustedUse(proposed, v, flourishesNow(), personaOf()) ? null : proposed;
      if (command !== null) issued += 1;
      else if (issued === 0 || v.turn() === startTurn) {
        if (goal !== null) stalled.set(goal, v.turn());
        if (goal !== null && issued > 0) {
          refused.set(goal, { where: whereNow(v), turn: v.turn() });
          const why = refusalOf(goal, v);
          noteOutcome(`${plan.label}: the game refused it${why === null ? "" : ` ${why}`}, and no game time passed.`);
        } else {
          noteOutcome(`${plan.label}: nothing happened and no game time passed.`);
        }
      } else if (outcomeVersion === version) {
        noteOutcome(`${plan.label}: done.`);
      }
      return command;
    };
    return { ...plan, step, settle: settle2 };
  }
  function nothingToDo(v, tried) {
    if (tried.length > 0) {
      const wait = refused.has("wait") ? "the game refused to let it wait a turn here" : stalled.has("wait") ? "waiting a turn passed no game time" : "waiting a turn is not safe here";
      return `Squire has nothing left to try here: ${tried.join(", ")} came to nothing this turn, and ${wait}.`;
    }
    if (knownDownStairs(v, terrain).length > 0 && !reachableStairs(v, terrain)) {
      return "Squire can see nothing to do here: a down staircase is known, but no remembered ground leads to it, and nothing unexplored can be reached.";
    }
    return "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down.";
  }
  function refusalOf(goal, v) {
    const p = v.player();
    if (goal === "fight" && p.status.afraid > 0) return "while the character is afraid";
    if (READS.has(goal) && !canRead(v)) {
      return p.status.blind > 0 ? "while the character is blind" : p.status.confused > 0 ? "while the character is confused" : "because it is too dark here to read";
    }
    return null;
  }
  function whereNow(v) {
    const p = v.player();
    const awake = awakeInSight(v.monsters()).map((m) => `${String(m.id)}@${String(m.grid.x)},${String(m.grid.y)}`).sort();
    return JSON.stringify([p.depth, p.grid.x, p.grid.y, healthBand(p.hp, p.maxHp), statusOf(v, canRead(v)), awake]);
  }
  const fightCfg = { ...cfg, wakeSleepers: true };
  function context(view, act, progress, with_ = cfg) {
    return { view: flourishView(view), act, terrain, cfg: with_, progress, log };
  }
  let seenDepth = -1;
  const seenOnLevel = /* @__PURE__ */ new Map();
  function noteSeen(view) {
    const depth2 = view.player().depth;
    if (depth2 !== seenDepth) {
      seenDepth = depth2;
      seenOnLevel.clear();
      breedersOnLevel.clear();
    }
    for (const m of view.monsters()) {
      if (!m.visible) continue;
      seenOnLevel.set(m.id, m.race);
      if (m.raceFlags.includes("MULTIPLY")) breedersOnLevel.add(m.race);
    }
  }
  const breedersOnLevel = /* @__PURE__ */ new Set();
  function routineBreeder(m) {
    return m.raceFlags.includes("MULTIPLY") && breedersOnLevel.has(m.race);
  }
  function watch(view) {
    const player = view.player();
    const hurt = player.maxHp > 0 && player.hp <= player.maxHp * cfg.retreatFraction;
    noteSeen(view);
    const watcher = createWatcher(view, {
      /* Already under the line: crossing it again is not news, but every
       * further blow is, so the model is asked again after each one. Poison
       * and bleeding cost a point every turn, which would end every plan at
       * once, so then only the damage-share rule below applies. */
      stopOnAnyDamage: (hurt || !view.monsters().some((monster) => monster.visible && !monster.asleep)) && player.status.poisoned === 0 && player.status.cut === 0,
      stopOnNewCreature: true,
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction,
      /* Above the line, a big blow or a run of smaller ones is news too. */
      stopOnDamageShare: DAMAGE_SHARE_REDECIDE,
      routine: (monster) => harmlessNow(view, monster) || routineBreeder(monster) && incomingDamage(view, view.player().grid, 1, terrain, { monsters: [monster], ...options.speedEnergy === void 0 ? {} : { energy: options.speedEnergy } }).damage === 0
    });
    const races = new Map(view.monsters().map((m) => [m.id, m.race]));
    for (const [id, race] of seenOnLevel) {
      if ((races.get(id) ?? race) === race) watcher.acknowledge(id);
      else seenOnLevel.delete(id);
    }
    return watcher;
  }
  function watched(plan, view) {
    return { label: plan.label, watcher: watch(view), step: (v, act) => plan.step(v, act) };
  }
  function missionPlan(label, mission, view, with_ = cfg, limit = Infinity) {
    const progress = newProgress(view.player().depth);
    const player = view.player();
    const hurt = player.maxHp > 0 && player.hp <= player.maxHp * with_.retreatFraction;
    const missionCfg = { ...with_, stopOnNewCreature: false, ...hurt ? { stopOnLowHealth: false } : {} };
    let begun = false;
    let done = false;
    let lastTurn = null;
    let refused2 = 0;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done || progress.steps >= limit) return null;
        const turn = v.turn();
        refused2 = lastTurn !== null && turn === lastTurn ? refused2 + 1 : 0;
        if (refused2 >= REFUSED_COMMANDS) {
          done = true;
          log(`${label}: the game refused the last command and no time passed.`);
          noteOutcome(`${label}: the game refused the command and no time passed.`);
          return null;
        }
        const ctx = context(v, act, progress, missionCfg);
        if (!begun) {
          begun = true;
          const declined = mission.begin(ctx);
          if (declined !== null) {
            done = true;
            log(`${label}: ${declined.detail}`);
            noteOutcome(`${label}: ${declined.detail}`);
            return null;
          }
        }
        const decision2 = mission.step(ctx);
        if (isStop(decision2)) {
          done = true;
          log(`${label}: ${decision2.stop.detail}`);
          noteOutcome(`${label}: ${decision2.stop.detail}`);
          return null;
        }
        lastTurn = turn;
        return decision2.command;
      }
    };
  }
  function stepsPlan(label, view, next) {
    const progress = newProgress(view.player().depth);
    let index = 0;
    let done = false;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done) return null;
        const command = next(context(v, act, progress), index);
        index += 1;
        if (command === null) done = true;
        return command;
      }
    };
  }
  function once(label, view, command) {
    return stepsPlan(label, view, (ctx, i) => i === 0 ? command(ctx) : null);
  }
  function atTarget(label, view, command, ball = false) {
    return once(label, view, (ctx) => {
      const s = situationOf(ctx.view, dreadedNow(), stationaryNow(ctx.view, false));
      if (s.target === null) return null;
      if (ball && ctx.view.blastArea !== void 0 && ctx.view.projectionPath !== void 0) {
        const aim = bestBallAim(ctx.view, s.awake, s.target);
        if (aim === null) return null;
        ctx.act.setTargetLocation(aim.x, aim.y);
      } else if (!ctx.act.setTargetMonster(s.target.id)) return null;
      return command(ctx);
    });
  }
  function volleyPlan(goal, label, view, spellSidx) {
    const target = situationOf(view, dreadedNow(), stationaryNow(view, false)).target;
    if (target === null) return once("no target", view, () => null);
    const next = volleySteps(goal, target.id, spellSidx, (v) => combatContext(situationNow(v)));
    return stepsPlan(label, view, (ctx) => next(ctx));
  }
  function useCommand(ctx, use) {
    switch (use.how) {
      case "cast":
        return ctx.act.cast(use.sidx);
      case "quaff":
        return ctx.act.quaff(use.handle);
      case "read":
        return ctx.act.read(use.handle);
      case "staff":
        return ctx.act.useStaff(use.handle);
      case "rod":
        return ctx.act.zapRod(use.handle);
      case "activate":
        return ctx.act.activate(use.handle);
    }
  }
  function savingFor(view) {
    const aims = options.strategy?.().aims ?? [];
    const gold = view.player().gold;
    return aims.some((aim) => aim.how === "save" && aim.price !== null && gold < aim.price);
  }
  function build(goal, view) {
    view = flourishView(view);
    const pack = readPack(view);
    switch (goal) {
      case "endure":
        return once("wait for an opening", view, (ctx) => ctx.act.hold());
      case "step_aside":
        return once("try another safe step", view, (ctx) => {
          const s = situationNow(ctx.view);
          const at = ctx.view.player().grid;
          const safe = neighbours(at).filter((grid) => isWalkable(ctx.view, terrain, grid) && !standingOnHarm(ctx.view, terrain, grid) && !ctx.view.monsters().some((m) => m.visible && steps(m.grid, grid) <= 1) && damageFor(s, grid, 1, terrain).damage < ctx.view.player().hp);
          const next = safe[Math.floor(rng() * safe.length)];
          const dir = next === void 0 ? null : directionToward(at, next);
          return dir === null ? null : ctx.act.move(dir);
        });
      case "swing_unseen":
        return once("swing at the unseen attacker", view, (ctx) => {
          if (ctx.view.player().status.afraid > 0) return null;
          const s = situationNow(ctx.view);
          const dir = s.unseenHit?.direction ?? DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)].key;
          return ctx.act.melee(dir);
        });
      case "cast_area":
      case "unseen_staff":
      case "unseen_wand":
      case "unseen_rod":
        return once("answer the unseen attacker", view, (ctx) => {
          const s = situationNow(ctx.view);
          if (s.unseenDamage <= 0) return null;
          const source = unseenAttacks(ctx.view, goal, ctx.view.player().depth > 0 && ctx.view.player().gold < RECALL_MIN_GOLD && !reachableAnyStairs(ctx.view, terrain) && reachableFrontier(ctx.view, terrain))[0];
          if (source === void 0) return null;
          const dir = s.unseenHit?.direction ?? DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)].key;
          const offset = DIRECTIONS.find((d) => d.key === dir);
          const at = ctx.view.player().grid;
          ctx.act.setTargetLocation(at.x + offset.dx, at.y + offset.dy);
          return source.how === "wand" ? ctx.act.aimWand(source.handle) : useCommand(ctx, source);
        });
      case "recall_town":
      case "recall_dungeon": {
        const item = recallItem(view);
        if (item === null) return once("no recall scroll", view, () => null);
        recallRead = { turn: view.turn(), depth: view.player().depth };
        return watched(recallPlan(item), view);
      }
      case "shop":
        return watched(townTripPlan(terrain, personaOf(), visitedShops, log, options.strategy?.().aims ?? [], flourishesNow, options.strategy), view);
      case "fight":
        return missionPlan("fight", autofight(), view, fightCfg);
      case "shoot": {
        if (volleyAvailable(view)) return volleyPlan("shoot", "shoot", view);
        const target = situationNow(view).target;
        const next = target === null ? () => null : volleySteps("shoot", target.id, void 0, (v) => combatContext(situationNow(v)));
        return once("shoot", view, next);
      }
      case "throw_oil": {
        if (volleyAvailable(view)) return volleyPlan("throw_oil", "throw oil", view);
        const target = situationNow(view).target;
        const next = target === null ? () => null : volleySteps("throw_oil", target.id, void 0, (v) => combatContext(situationNow(v)));
        return once("throw oil", view, next);
      }
      case "aim_wand": {
        const wand = pack.attackWand[0];
        if (volleyAvailable(view)) return volleyPlan("aim_wand", `aim ${wand?.name ?? "a wand"}`, view);
        const target = situationNow(view).target;
        const next = target === null ? () => null : volleySteps("aim_wand", target.id, void 0, (v) => combatContext(situationNow(v)));
        return once(`aim ${wand?.name ?? "a wand"}`, view, next);
      }
      case "cast_attack": {
        const cast = combatOptions(situationNow(view), "cast_attack")[0];
        const spell = cast?.source !== null && cast?.source !== void 0 && "sidx" in cast.source ? cast.source : void 0;
        const label = `cast ${spell?.name ?? "a spell"}`;
        const ball = spell !== void 0 && /(?:ball|orb|cloud|storm)/i.test(spell.name);
        if (!ball && spell !== void 0 && volleyAvailable(view)) return volleyPlan("cast_attack", label, view, spell.sidx);
        return atTarget(label, view, (ctx) => {
          const usable = spell !== void 0 && combatOptions(situationNow(ctx.view), "cast_attack").some((attack) => attack.source !== null && "sidx" in attack.source && attack.source.sidx === spell.sidx);
          return usable ? ctx.act.cast(spell.sidx) : null;
        }, ball);
      }
      case "heal": {
        const potion = healingPotion(view, damageFor(situationNow(view)).damage);
        return once(`drink ${potion?.name ?? "a potion"}`, view, (ctx) => {
          const s = situationNow(ctx.view);
          if (!offersFor(s, cfg, terrain).some((offer) => offer.goal === "heal")) return null;
          const now = healingPotion(ctx.view, damageFor(s).damage);
          return now === void 0 ? null : ctx.act.quaff(now.handle);
        });
      }
      case "cast_heal": {
        const spell = healingSpell(view, damageFor(situationNow(view)).damage);
        return once(`cast ${spell?.name ?? "a spell"}`, view, (ctx) => {
          const s = situationNow(ctx.view);
          if (!offersFor(s, cfg, terrain).some((offer) => offer.goal === "cast_heal")) return null;
          const now = healingSpell(ctx.view, damageFor(s).damage);
          return now === void 0 ? null : ctx.act.cast(now.sidx);
        });
      }
      case "phase": {
        const scroll = pack.phase[0];
        const spell = pack.escapeSpell[0];
        return once("phase away", view, (ctx) => {
          if (scroll !== void 0) return ctx.act.read(scroll.handle);
          if (spell !== void 0) return ctx.act.cast(spell.sidx);
          return null;
        });
      }
      case "teleport": {
        const item = pack.teleport[0];
        return once("teleport away", view, (ctx) => {
          if (item === void 0) return null;
          return /Staff/i.test(item.name) ? ctx.act.useStaff(item.handle) : ctx.act.read(item.handle);
        });
      }
      case "deep_descent": {
        const scroll = pack.descent[0];
        if (scroll !== void 0) descentRead = { turn: view.turn(), depth: view.player().depth };
        return once("read Deep Descent", view, (ctx) => scroll === void 0 ? null : ctx.act.read(scroll.handle));
      }
      case "retreat": {
        const flight = retreatStairs(situationNow(view), terrain, offeredWiden);
        const depth2 = view.player().depth;
        return stepsPlan("back away", view, (ctx, i) => {
          if (ctx.view.player().depth !== depth2) return null;
          const here = ctx.view.player().grid;
          const cell2 = ctx.view.cell(here.x, here.y);
          if (flight !== "none" && cell2 !== null && terrain.isDownStair(cell2.feat)) return ctx.act.descend();
          if (flight === "any" && cell2 !== null && terrain.isUpStair(cell2.feat)) return ctx.act.ascend();
          if (flight === "none" && i >= RETREAT_STEPS) return null;
          const checked = retreatStep(situationNow(ctx.view), terrain, flight);
          if (checked === null) return null;
          const dir = directionToward(here, checked.at);
          if (dir === null) return null;
          return isClosedDoor(ctx.view, terrain, checked.at) ? ctx.act.open(dir) : ctx.act.move(dir);
        });
      }
      case "rest":
        return once("rest", view, (ctx) => safeRecovery(situationNow(ctx.view), terrain) ? ctx.act.rest() : null);
      case "wait": {
        const holdOne = (ctx) => {
          const incoming = damageFor(situationNow(ctx.view), ctx.view.player().grid, 2, terrain);
          if (incoming.damage !== 0 || incoming.status !== 0) return null;
          const here = ctx.view.player().grid;
          return terrain.isShopEntrance(ctx.view.cell(here.x, here.y)?.feat ?? -1) ? ctx.act.rest(2) : ctx.act.hold();
        };
        const depth2 = view.player().depth;
        if (!recallPending(view.player(), recallRead, view.turn())) return once("wait a turn", view, holdOne);
        return stepsPlan("wait for the recall", view, (ctx, i) => i >= RECALL_HOLD_STEPS || ctx.view.player().depth !== depth2 || !recallPending(ctx.view.player(), recallRead, ctx.view.turn()) ? null : holdOne(ctx));
      }
      case "study": {
        const study = studyable(view, triedStudies);
        if (study === null) return once("nothing to study", view, () => null);
        return once("study", view, (ctx) => {
          triedStudies.add(`${String(ctx.view.player().level)}:${String(study.sidx)}`);
          return ctx.act.raw("study", { handle: study.handle, spell: study.sidx });
        });
      }
      case "wear": {
        const candidate = gearCandidates(view).find((gear) => !gear.unknown || (personaOf()?.sliders.curiosity ?? 0) >= 50);
        return once(`wear ${candidate?.name ?? "gear"}`, view, (ctx) => candidate === void 0 || damageFor(situationNow(ctx.view)).damage >= ctx.view.player().hp || !gearCandidates(ctx.view).some((gear) => gear.handle === candidate.handle) ? null : ctx.act.wear(candidate.handle));
      }
      case "detect": {
        const reactive = situationNow(view).unseenDamage > 0;
        if (reactive) return once("detect", view, (ctx) => {
          const source2 = unseenSources(ctx.view, "detect")[0];
          return source2 === void 0 ? null : useCommand(ctx, source2);
        });
        const source = detectionSource(view);
        return once(`detect with ${source?.name ?? "a known source"}`, view, (ctx) => {
          if (source === null) return null;
          if (source.kind === "cast") return ctx.act.cast(source.sidx);
          return source.kind === "zap" ? ctx.act.zapRod(source.handle) : ctx.act.read(source.handle);
        });
      }
      case "see_invisible":
      case "light_room":
        return once(goal === "see_invisible" ? "see invisible creatures" : "light the room", view, (ctx) => {
          const source = unseenSources(ctx.view, goal)[0];
          return source === void 0 ? null : useCommand(ctx, source);
        });
      case "eat": {
        const food = pack.food[0];
        return once("eat", view, (ctx) => food === void 0 ? null : ctx.act.eat(food.handle));
      }
      case "pick_up":
        return once("pick up", view, (ctx) => ctx.act.pickup());
      case "fetch":
        return (() => {
          const saving = savingFor(view);
          const loot = floorTarget(view, terrain, saving, personaOf());
          if (loot === null) return once("nothing to fetch", view, () => null);
          let grabbed = false;
          return stepsPlan("fetch item", view, (ctx) => {
            if (grabbed || !stillWorthIt(ctx.view, loot, saving, personaOf())) return null;
            const here = ctx.view.player().grid;
            if (here.x === loot.at.x && here.y === loot.at.y) {
              grabbed = true;
              return ctx.act.pickup();
            }
            const engine = engineTravel(ctx, [loot.at], { run: true });
            if (engine !== null) return engine;
            const travel = travelTo(ctx, [loot.at]);
            return travel.kind === "step" ? travel.command : null;
          });
        })();
      case "drop_junk": {
        const junk = junkInPack(view);
        return once(`drop ${junk?.name ?? "junk"}`, view, (ctx) => {
          const now = junkInPack(ctx.view);
          return now === null ? null : ctx.act.drop(now.handle);
        });
      }
      case "buff":
        return once("use a combat buff", view, (ctx) => {
          const use = buffUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "resist":
        return once("drink a resist potion", view, (ctx) => {
          const use = resistUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "device":
        return once("use a curing device", view, (ctx) => {
          const use = deviceHealUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "activate":
        return once("activate an item", view, (ctx) => {
          const use = activationUse(ctx.view);
          return use === null ? null : useCommand(ctx, use);
        });
      case "disarm":
        return once("disarm a trap", view, (ctx) => {
          const dir = trapDirection(ctx.view);
          return dir === null ? null : ctx.act.disarm(dir);
        });
      case "tunnel":
        return once("tunnel through rubble", view, (ctx) => {
          const dir = rubbleDirection(ctx.view, terrain);
          return dir === null ? null : ctx.act.tunnel(dir);
        });
      case "explore":
        return view.player().depth === 0 ? missionPlan("explore", autoexplore({ allowAwake: true, findTownStairs: true }), view) : (() => {
          const wide = offeredWiden;
          return stepsPlan("explore", view, (ctx) => journey.explore(ctx, wide));
        })();
      case "leave_level": {
        const down = leaveStep(situationNow(view), terrain)?.down === true;
        return stepsPlan(down ? "take the stairs down" : "take the nearest stairs", view, (ctx) => {
          const here = ctx.view.player();
          if (here.depth !== view.player().depth) return null;
          const cell2 = ctx.view.cell(here.grid.x, here.grid.y);
          if (cell2 !== null && terrain.isDownStair(cell2.feat) && missingPreparation(ctx.view, here.depth + 1).length === 0) return ctx.act.descend();
          if (cell2 !== null && terrain.isUpStair(cell2.feat)) return ctx.act.ascend();
          const checked = leaveStep(situationNow(ctx.view), terrain);
          if (checked === null) return null;
          const dir = directionToward(here.grid, checked.at);
          if (dir === null) return null;
          return isClosedDoor(ctx.view, terrain, checked.at) ? ctx.act.open(dir) : ctx.act.move(dir);
        });
      }
      case "close_door":
        return once("close a door", view, (ctx) => {
          const s = situationNow(ctx.view);
          if (s.breederExit !== true) return null;
          const at = closeDoorStep(s, terrain);
          const dir = at === null ? null : directionToward(ctx.view.player().grid, at);
          return dir === null ? null : ctx.act.close(dir);
        });
      case "descend":
        return stepsPlan("take the stairs down", view, (ctx, i) => {
          const at = ctx.view.player().grid;
          const stairs = knownDownStairs(ctx.view, terrain);
          if (stairs.some((s) => s.x === at.x && s.y === at.y)) {
            return ctx.view.player().depth === view.player().depth ? ctx.act.descend() : null;
          }
          if (i === 0) {
            const engine = engineTravel(ctx, stairs, { stairs: "down" });
            if (engine !== null) return engine;
          }
          const travel = travelTo(ctx, stairs);
          return travel.kind === "step" ? travel.command : null;
        });
    }
  }
  const stillSince = /* @__PURE__ */ new Map();
  function stationaryNow(view, update2 = true) {
    const out = /* @__PURE__ */ new Set();
    if (!update2) {
      for (const [id, was] of stillSince) if (was.count >= STATIONARY_DECISIONS) out.add(id);
      return out;
    }
    const live = /* @__PURE__ */ new Set();
    for (const m of view.monsters()) {
      if (!m.visible || m.asleep) continue;
      live.add(m.id);
      const was = stillSince.get(m.id);
      const count2 = was !== void 0 && was.x === m.grid.x && was.y === m.grid.y ? was.count + 1 : 1;
      stillSince.set(m.id, { x: m.grid.x, y: m.grid.y, count: count2 });
      if (count2 >= STATIONARY_DECISIONS) out.add(m.id);
    }
    for (const id of [...stillSince.keys()]) if (!live.has(id)) stillSince.delete(id);
    return out;
  }
  function dreadedNow() {
    return options.dreaded?.() ?? /* @__PURE__ */ new Set();
  }
  function grudgesNow() {
    return options.grudges?.() ?? [];
  }
  function lessonsFor(view) {
    const persona = personaOf();
    let lines2 = options.lessons?.(view) ?? [];
    if (persona !== null) lines2 = forget(lines2, persona, rng);
    return lines2.length === 0 ? {} : { lessons: lines2.join(" ") };
  }
  function decide(raw, inCharacter, digest, answers, view) {
    const persona = personaOf();
    const probs = options.calibrate === void 0 ? raw.probabilities : options.calibrate(raw.probabilities);
    const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? raw.choice;
    const best = { ...raw, probabilities: probs, choice: top };
    if (persona === null) return best.choice;
    const offered = new Set(digest.offers.map((o) => o.goal));
    const advice = best.choice;
    const record5 = (pick3, extra) => {
      digest.trace = { advice, pick: pick3, ...extra };
      return pick3;
    };
    const blank = { best: best.probabilities, inCharacter: null, blended: best.probabilities, strength: 0, removed: [] };
    if (mustPickUp(persona) && offered.has("pick_up")) return record5("pick_up", { ...blank, quirk: "compulsive collector" });
    if (fleesFromNew(persona) && digest.newCreatures > 0) {
      const away = ["teleport", "phase", "retreat"].find((g) => offered.has(g));
      if (away !== void 0) return record5(away, { ...blank, quirk: "craven" });
    }
    const inChar = inCharacter?.type === "choice" ? inCharacter.probabilities : null;
    const strength = jitteredStrength(persona, rng);
    const blended = inChar === null ? { ...best.probabilities } : blend(best.probabilities, inChar, strength);
    const risk = { none_of_these: 0 };
    for (const offer of digest.offers) risk[offer.goal] = offer.risk;
    const weighted = options.orders === void 0 ? blended : options.orders.weigh(blended, answers, view, digest.offers);
    for (const goal of options.orders?.passes(view) ?? []) if ((risk[goal] ?? 0) > riskCeiling(persona)) risk[goal] = riskCeiling(persona);
    const spent = !digest.offers.some((o) => o.goal === "explore");
    const sighted = view.monsters().filter((m) => m.visible).map((m) => m.race);
    const pursued = nudgePursuits(nudgeAims(weighted, digest.offers, persona.sliders.ambition, riskCeiling(persona)), digest.offers, options.strategy?.().pursuits ?? [], view, riskCeiling(persona), descentEscapes(view, badFeeling !== null));
    const felt = nudgeGrudges(pursued, digest.offers, grudgesNow(), sighted, riskCeiling(persona));
    const grounded = nudgeGrounds(felt, digest.offers, flourishesNow(), view, persona, riskCeiling(persona));
    const unseen = nudgeUnseen(grounded, digest.offers, persona, situationNow(view).unseenDamage, view.player().hp, riskCeiling(persona));
    const nudged = holdDescent(unseen, options.strategy?.().aims ?? [], view, badFeeling !== null, spent);
    const floor = applySafetyFloor(nudged, risk, riskCeiling(persona), persona.quirks.deathwish.on);
    const pick2 = pick(floor.dist) ?? advice;
    return record5(pick2, { best: best.probabilities, inCharacter: inChar, blended: floor.dist, strength, removed: floor.removed });
  }
  function reflexFor(offers, persona, situation, turn, passes, s) {
    if (options.reflex === false) return null;
    const incoming = damageFor(s).damage;
    const viable = offers.filter((offer) => SURVIVAL_GOALS.has(offer.goal) && (offer.survival ?? 0) > 0 && !(offer.goal === "retreat" && stairsUnderfoot(s, terrain) && offers.some((other) => other.goal === "leave_level")));
    if (incoming > 0 && incoming >= s.view.player().hp && viable.length === 1) return { goal: viable[0].goal, why: viable[0].uncertain === true ? "the only feasible immediate escape" : "the only immediate survival option" };
    const routine = ROUTINE.map((goal) => offers.find((o) => o.goal === goal && o.routine === true)).find((o) => o !== void 0);
    if (routine !== void 0) return { goal: routine.goal, why: "routine upkeep" };
    const only = offers.length === 1 ? offers[0] : void 0;
    const ceiling = persona === null ? FORCED_RISK : persona.quirks.deathwish.on ? 1 : riskCeiling(persona);
    if (only !== void 0 && only.risk <= ceiling) return { goal: only.goal, why: "the only option" };
    const last = lastAnswer;
    const again = last === null ? void 0 : offers.find((o) => o.goal === last.pick);
    const allowed = again !== void 0 && (persona === null || again.risk <= ceiling || passes.has(again.goal));
    if (last !== null && allowed && last.situation === situation && turn - last.turn >= 0 && turn - last.turn <= SAME_SITUATION_TURNS) {
      return { goal: last.pick, why: "same situation as the last answer" };
    }
    return null;
  }
  function ownChoice(digest, view) {
    const s = situationNow(view);
    const persona = personaOf();
    const preferred = proceduralPick(digest.offers, s.hpShare);
    const probabilities = Object.fromEntries(digest.offers.map((offer2) => [offer2.goal, (offer2.goal === preferred ? 2 : 1) / (1 + offer2.risk * 8)]));
    if (s.unseenDamage > 0 && persona !== null) {
      const bold = persona.sliders.boldness / 100;
      for (const offer2 of digest.offers) {
        if (["swing_unseen", "cast_area", "unseen_wand"].includes(offer2.goal)) probabilities[offer2.goal] = (probabilities[offer2.goal] ?? 0) * (1 + bold * 4);
        if (["detect", "see_invisible", "light_room", "unseen_staff", "unseen_rod"].includes(offer2.goal)) probabilities[offer2.goal] = (probabilities[offer2.goal] ?? 0) * (1 + (1 - bold) * 4);
        if (persona.quirks.cowardice.on && ["leave_level", "retreat", "phase", "teleport"].includes(offer2.goal)) probabilities[offer2.goal] = (probabilities[offer2.goal] ?? 0) * 16;
      }
    }
    const answer = { type: "choice", choice: preferred ?? digest.offers[0]?.goal ?? "wait", confidence: 1, probabilities };
    const picked2 = decide(answer, void 0, digest, { goal: answer }, view);
    const offer = digest.offers.find((offer2) => offer2.goal === picked2) ?? [...digest.offers].sort((a, b) => a.risk - b.risk)[0];
    if (offer === void 0) return { plan: build("step_aside", view) };
    digest.trace ??= { best: probabilities, inCharacter: null, blended: probabilities, strength: 0, removed: [], advice: answer.choice, pick: offer.goal };
    options.orders?.decided(offer.goal, view);
    return { plan: noteStalls(offer.goal, build(offer.goal, view), view.turn()) };
  }
  const planner = {
    rules(view, reason, stuck = false) {
      if (stuck) {
        lastAnswer = null;
        for (const goal2 of sameTurn.keys()) stalled.set(goal2, view.turn());
      }
      const question = planner.ask(view);
      if ("handBack" in question || "reflex" in question) return question;
      const choice2 = ownChoice(question.context, view);
      if ("handBack" in choice2) return choice2;
      const goal = question.context.trace?.pick ?? question.context.offers[0]?.goal ?? "wait";
      return { reflex: reason, plan: choice2.plan, context: question.context, answers: { goal: { type: "choice", choice: goal, confidence: 1, probabilities: { [goal]: 1 } } } };
    },
    ask(view) {
      view = flourishView(view);
      const persona = personaOf();
      const player = view.player();
      if (player.depth > 0) visitedShops.clear();
      if (player.dead || player.winner) return { handBack: player.dead ? "The character has died." : "The character has won." };
      noteSeen(view);
      noteFeeling(view);
      const s = situationNow(view, true);
      const turn = view.turn();
      for (const [goal2, at] of stalled) if (at !== turn) stalled.delete(goal2);
      const here = whereNow(view);
      for (const [goal2, r] of refused) if (r.where !== here || turn - r.turn > REFUSAL_HOLD_TURNS) refused.delete(goal2);
      const newLevel = decisionDepth !== player.depth;
      decisionDepth = player.depth;
      const widen = s.hpShare < 0.35 || s.awake.length > 0 && player.hp <= player.maxHp * cfg.retreatFraction;
      offeredWiden = widen;
      if (sameTurnAt !== turn) {
        sameTurnAt = turn;
        sameTurn.clear();
      }
      for (const [goal2, count2] of sameTurn) {
        if (count2 === SAME_TURN_PLANS) {
          log(`goal: ${goal2} is left out until game time passes; it has started ${String(count2)} times on this turn`);
          sameTurn.set(goal2, count2 + 1);
        }
      }
      const recalling = recallPending(player, recallRead, turn);
      const saving = savingFor(view);
      const aims = options.strategy?.().aims ?? [];
      const descending = descentRead !== null && descentRead.depth === player.depth && turn - descentRead.turn >= 0 && turn - descentRead.turn <= DEEP_DESCENT_WAIT_TURNS;
      const usable = (offer) => !(descending && offer.goal === "deep_descent") && !stalled.has(offer.goal) && !refused.has(offer.goal) && (sameTurn.get(offer.goal) ?? 0) < SAME_TURN_PLANS;
      const base = offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, widen, saving, badFeeling, aims, persona === null ? [] : grudgesNow(), flourishesNow(), options.strategy?.().storeMemory);
      const steered = options.strategy === void 0 ? base : steerOffers(base, view, options.strategy(), { recallActive: recalling, tripRisk: Math.max(0.02, exposure(s)) }, (goal2, criteria2, risk) => ({ goal: goal2, criteria: criteria2, risk }));
      const offered = journey.apply(steered, view, persona, visitedShops, recalling);
      let offers = offered.filter(usable);
      if (offers.length === 0 && offered.length > 0 && (!recalling || journey.safeDelay(view)) && damageFor(s, player.grid, 2, terrain).damage === 0 && damageFor(s).status === 0 && !stalled.has("wait") && !refused.has("wait") && (sameTurn.get("wait") ?? 0) < SAME_TURN_PLANS) {
        offers = [{ goal: "wait", criteria: "Wait a turn; nothing else on offer can be done from here right now.", risk: exposure(s) }];
      }
      if (offers.length === 0) {
        const tried = offered.map((o) => o.goal);
        log(`goal: nothing to offer (light ${String(player.light)}, blind ${String(player.status.blind)}, confused ${String(player.status.confused)}, offered: ${tried.join(", ") || "none"}, stalled: ${[...stalled.keys()].join(", ") || "none"}, refused: ${[...refused.keys()].join(", ") || "none"})`);
        const reason = journey.blocked(view) ?? nothingToDo(view, tried);
        offeredWiden = true;
        const wider = offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, true, saving, badFeeling, aims);
        if (reachableFrontier(view, terrain) && !wider.some((o) => o.goal === "explore")) wider.push({ goal: "explore", criteria: "Explore reachable unknown ground to earn experience at this depth.", risk: exposure(s) + 0.02 });
        if (player.depth === 0 && cfg.descend && reachableStairs(view, terrain) && !wider.some((o) => o.goal === "descend")) wider.push({ goal: "descend", criteria: "Walk to the stairs and earn experience and gold on dungeon level 1.", risk: exposure(s) });
        offers = journey.apply(wider, view, persona, visitedShops, recalling, true).filter(usable);
        if (offers.length === 0) {
          if (neighbours(player.grid).some((grid) => isWalkable(view, terrain, grid) && !standingOnHarm(view, terrain, grid) && damageFor(s, grid, 1, terrain).damage < player.hp)) offers.push({ goal: "step_aside", criteria: "Walk one step onto safe ground away from visible creatures.", risk: exposure(s) });
          if (safeRecovery(s, terrain)) offers.push({ goal: "wait", criteria: "Wait a turn for the situation to change.", risk: 0.02 });
          if (offers.length === 0 && player.status.afraid === 0) offers.push({ goal: "swing_unseen", criteria: "Swing around the character while looking for a way out.", risk: exposure(s) });
          if (offers.length === 0) offers.push({ goal: "endure", criteria: "Wait one turn for fear or another condition to pass. No checked escape or usable attack remains; another hit could kill the character.", risk: exposure(s), survival: player.hp - damageFor(s).damage, uncertain: true });
        }
        log(`goal: Squire widens its choices. ${reason}`);
      }
      const aimList = options.strategy?.().aims ?? [];
      const aimNote = aimList.length === 0 ? null : `Aims, best first: ${aimList.map((a) => a.label).join(", ")}.`;
      const criteria = {};
      for (const offer of offers) criteria[offer.goal] = offer.criteria;
      criteria["none_of_these"] = NONE_OF_THESE2;
      const goal = {
        type: "choice",
        instructions: "You are playing Angband, a dungeon game where death is permanent. Which option gives this character the best chance to survive and keep making progress?",
        criteria
      };
      const seen = inSight(view.monsters());
      const awakeNow = new Set(s.awake.map((m) => m.id));
      const newCreatures = [...awakeNow].filter((id) => !lastAwake.has(id)).length;
      lastAwake = awakeNow;
      const unexplored = reachableFrontier(view, terrain);
      const stairs = knownDownStairs(view, terrain).length > 0;
      const believed = [];
      const feelings = persona === null ? [] : grudgesNow();
      const creatureLines = seen.map((m) => {
        const rating = assessThreat(m, player, s.awake, view, s.dreaded, terrain, options.speedEnergy);
        const real = rating.band;
        const feeling = feelingToward(feelings, m.race);
        const seenAs = persona === null ? real : fearedBand(shiftThreat(real, THREAT_BANDS.length, persona, rng), THREAT_BANDS.length, feeling);
        if (seenAs !== real) believed.push(`the ${m.race} is ${THREAT_BANDS[seenAs] ?? "deadly"}`);
        if (feeling !== void 0) {
          believed.push(feelingBelief(feeling));
          if (persona !== null && !grudgeNoticed.has(m.id)) {
            grudgeNoticed.add(m.id);
            log(feelingLog(persona.name, feeling));
          }
        }
        const tags = [m.asleep ? "asleep" : "", m.afraid ? "afraid" : "", m.raceFlags.includes("UNIQUE") ? "unique" : "", m.speed > player.speed ? "faster than the character" : ""].filter((t) => t !== "").join(", ");
        return { race: m.race, band: THREAT_BANDS[real] ?? "deadly", ...rating.description === null ? {} : { capability: rating.description }, away: steps(player.grid, m.grid), tags };
      });
      const creatures = seen.length === 0 ? "No creatures in sight." : groupLines(creatureLines);
      const passes = options.orders?.passes(view) ?? /* @__PURE__ */ new Set();
      const situation = JSON.stringify([
        player.depth,
        healthBand(player.hp, player.maxHp),
        creatures,
        statusOf(view, canRead(view)),
        unexplored,
        stairs,
        player.hp,
        player.sp,
        player.speed,
        player.grid,
        s.threats.map((m) => [m.id, m.grid, m.speed, m.hp]),
        s.unseenDamage,
        hungry(view),
        offers.map((o) => [o.goal, o.risk, o.survival, o.uncertain]).sort(),
        options.orders?.revision(view) ?? "",
        [...passes].sort(),
        persona === null ? null : [riskCeiling(persona), persona.quirks.deathwish.on],
        flourishLines(flourishesNow(), persona)
      ]);
      const reflex = reflexFor(offers, persona, situation, turn, passes, s);
      if (reflex !== null) {
        log(`goal: ${reflex.goal}, without asking (${reflex.why})`);
        options.orders?.decided(reflex.goal, view);
        const decided = {
          reflex: reflex.why,
          plan: noteStalls(reflex.goal, build(reflex.goal, view), turn),
          context: { depth: player.depth, offers, newCreatures, situation, reflex: reflex.why },
          answers: { goal: { type: "choice", choice: reflex.goal, confidence: 1, probabilities: { [reflex.goal]: 1 } } }
        };
        return decided;
      }
      const orderNote = options.orders?.note(view, player.gold, offers) ?? null;
      const question = {
        request: {
          state: {
            rules: HANDBOOK.join(" "),
            character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}).`,
            health: `${healthBand(player.hp, player.maxHp)}: ${String(player.hp)} of ${String(player.maxHp)} hit points`,
            ...player.maxSp > 0 ? { mana: `${String(player.sp)} of ${String(player.maxSp)}` } : {},
            creatures,
            incoming: `Up to ${String(damageFor(s, player.grid, 1, terrain).damage)} HP damage in one action and ${String(damageFor(s, player.grid, 2, terrain).damage)} in two. Status danger ${String(damageFor(s).status)}; uncertainty ${String(damageFor(s).uncertainty)}. These are conservative bounds, not death probabilities.`,
            ground: standingOnHarm(view, terrain, player.grid) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored ? "Unexplored ground remains." : "The level is explored."} ${stairs ? "A down staircase is known." : "No down staircase is known."}`,
            status: statusOf(view, canRead(view)),
            ...lastOutcome === null ? {} : { last: lastOutcome },
            ...aimNote === null ? {} : { aims: aimNote },
            ...orderNote === null ? {} : { orders: orderNote },
            ...hungry(view) ? { hunger: "The character is hungry." } : {},
            ...swarmNote(seen),
            ...lessonsFor(view),
            ...persona === null ? {} : { persona: { name: persona.name, ...personaState(persona, backstoryTokens), ...pursuitFacts(options.strategy?.().pursuits ?? []), ...flourishLines(flourishesNow(), persona).length === 0 ? {} : { family: flourishLines(flourishesNow(), persona).join(" ") }, ...believed.length === 0 ? {} : { believes: `${believed.join("; ")}.` } } }
          },
          questions: persona === null ? { goal } : { goal, in_character: { type: "choice", instructions: inCharacterInstructions(persona), criteria }, ...options.orders?.ask(offers, view) ?? {} }
        },
        context: { depth: player.depth, offers, newCreatures, situation }
      };
      return question;
    },
    choose(answers, digest, view) {
      view = flourishView(view);
      const answer = answers["goal"];
      if (answer?.type !== "choice") return ownChoice(digest, view);
      const pick2 = decide(answer, answers["in_character"], digest, answers, view);
      if (pick2 === "none_of_these") {
        const p = view.player();
        const s = situationNow(view);
        const hurt = p.maxHp > 0 && p.hp <= p.maxHp * cfg.retreatFraction;
        const danger = hurt && (s.awake.length > 0 || p.status.poisoned > 0 || p.status.cut > 0) || s.unseenDamage > 0 || s.worst >= 2 || digest.offers.some((o) => o.risk > 0.3);
        if (danger) {
          const priority2 = [
            ...stairsUnderfoot(s, terrain) ? ["leave_level", "retreat"] : [],
            "teleport",
            "phase",
            "heal",
            "device",
            "cast_heal",
            ...!immediateDanger(s) ? ["recall_town", "deep_descent", "leave_level"] : [],
            ...!pinned(s) ? ["retreat"] : [],
            "fight",
            "shoot",
            "cast_attack",
            "aim_wand",
            "throw_oil"
          ];
          const fresh = offersFor(s, cfg, terrain, personaOf(), visitedShops, triedStudies, false, recallPending(p, recallRead, view.turn()), offeredWiden, false, null, options.strategy?.().aims ?? [], [], flourishesNow(), options.strategy?.().storeMemory);
          const candidates = fresh.filter((offer2) => priority2.includes(offer2.goal) && digest.offers.some((old) => old.goal === offer2.goal));
          const fallback = candidates.sort((a, b) => {
            const adequate = Number((b.survival ?? 0) > 0) - Number((a.survival ?? 0) > 0);
            return adequate || a.risk - b.risk || priority2.indexOf(a.goal) - priority2.indexOf(b.goal);
          })[0]?.goal;
          if (fallback === void 0) return ownChoice(digest, view);
          log(`goal: none fit in danger, taking the survival fallback (${fallback})`);
          return { plan: noteStalls(fallback, build(fallback, view), view.turn()) };
        }
        return ownChoice(digest, view);
      }
      const offer = digest.offers.find((o) => o.goal === pick2);
      if (offer === void 0) {
        return ownChoice(digest, view);
      }
      options.orders?.decided(offer.goal, view);
      if (digest.situation !== void 0) lastAnswer = { situation: digest.situation, turn: view.turn(), pick: offer.goal };
      const trace = digest.trace;
      if (trace !== void 0 && trace.pick !== trace.advice) {
        log(`goal: ${pick2}, against advice (${trace.advice})${trace.quirk === void 0 ? "" : `: ${trace.quirk}`}`);
      } else {
        log(`goal: ${pick2} (${String(Math.round((answer.probabilities[pick2] ?? 0) * 100))}%)`);
      }
      return { plan: noteStalls(offer.goal, build(offer.goal, view), view.turn()) };
    },
    trigger(view, plan) {
      situationNow(view, false, true);
      const exiting = journey.breederExit(view);
      if (exiting && ["explore", "rest", "fetch"].includes(plan.label)) return "Three awake breeders marked this level for departure.";
      const watched2 = plan;
      watched2.settle?.(view);
      const stopped = watched2.watcher?.check(view) ?? null;
      if (stopped !== null) noteOutcome(`${plan.label} stopped: ${stopped.detail}`);
      return stopped === null ? null : stopped.detail;
    }
  };
  return planner;
}

// src/brain/tally.ts
var ZERO = Object.freeze({ requests: 0, inputTokens: 0, outputTokens: 0, estimated: 0, usd: 0 });
function add(totals, usage, usd) {
  return {
    requests: totals.requests + 1,
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
    estimated: totals.estimated + (usage.estimated ? 1 : 0),
    usd: totals.usd + usd
  };
}
function dayKey(ms) {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function createTally(caps, earlierToday) {
  let session = ZERO;
  const perBackend = {};
  let day = earlierToday?.day ?? "";
  let dayUsd = earlierToday?.usd ?? 0;
  function rollDay(now) {
    const today = dayKey(now);
    if (today !== day) {
      day = today;
      dayUsd = 0;
    }
  }
  return {
    record(backend, usage, now) {
      rollDay(now);
      const usd = backend.metered ? usage.inputTokens / 1e6 * backend.usdPerMillionInput : 0;
      session = add(session, usage, usd);
      perBackend[backend.label] = add(perBackend[backend.label] ?? ZERO, usage, usd);
      dayUsd += usd;
    },
    session: () => session,
    byBackend: () => ({ ...perBackend }),
    todayUsd(now) {
      rollDay(now);
      return dayUsd;
    },
    overCap(backend, now) {
      if (!backend.metered) return null;
      rollDay(now);
      if (caps.perSessionUsd > 0 && session.usd >= caps.perSessionUsd) {
        return {
          kind: "over-cap",
          message: `Squire has reached this session's spend limit for ${backend.label} ($${caps.perSessionUsd.toFixed(2)}). Raise the limit in Squire's settings, or reload to start a new session.`,
          retryable: false
        };
      }
      if (caps.perDayUsd > 0 && dayUsd >= caps.perDayUsd) {
        return {
          kind: "over-cap",
          message: `Squire has reached today's spend limit for ${backend.label} ($${caps.perDayUsd.toFixed(2)}). Raise the limit in Squire's settings, or wait until tomorrow.`,
          retryable: false
        };
      }
      return null;
    }
  };
}

// src/strategy/heirs.ts
var INHERITABLE = ["depth", "weapon"];
var MAX_INHERITED_AIMS = INHERITABLE.length;
function depthCeiling(ambition) {
  return 5 + Math.floor(Math.max(0, Math.min(100, ambition)) / 4);
}
function share(persona) {
  return Math.max(0, Math.min(1, persona.sliders.inheritance / 100));
}
function passableAims(aims) {
  return aims.flatMap((aim) => aim.kind === "depth" ? [{ kind: "depth", depth: aim.depth }] : aim.kind === "weapon" ? [{ kind: "weapon", depth: null }] : []);
}
function inheritAims(aims, parent, heir) {
  const s = share(parent);
  const ceiling = depthCeiling(heir.sliders.ambition);
  const kept = [];
  for (const aim of aims) {
    if (!INHERITABLE.includes(aim.kind) || kept.some((k) => k.kind === aim.kind)) continue;
    if (aim.kind === "depth") {
      const depth2 = aim.depth === null ? 0 : Math.max(1, Math.round(aim.depth * s));
      if (depth2 < 1) continue;
      kept.push({ kind: "depth", depth: Math.min(depth2, ceiling) });
    } else {
      kept.push({ kind: "weapon", depth: null });
    }
  }
  return kept.slice(0, Math.floor(MAX_INHERITED_AIMS * s));
}
function withInherited(candidates, inherited) {
  const out = [...candidates];
  for (const aim of inherited) {
    const at = out.findIndex((c) => c.kind === aim.kind);
    if (aim.kind === "depth" && aim.depth !== null) {
      const target = aim.depth;
      const own = at === -1 ? null : out[at];
      if (own !== null && (own.depth ?? 0) >= target) continue;
      const made = {
        kind: "depth",
        label: "depth target",
        detail: `Reach dungeon level ${String(target)} (${String(target * 50)} ft), the depth the family line was aiming for.`,
        how: "dive",
        price: null,
        depth: target
      };
      if (at === -1) out.push(made);
      else out[at] = made;
    } else if (aim.kind === "weapon" && at === -1) {
      out.push({
        kind: "weapon",
        label: "magic weapon",
        detail: "The family line was hunting a magical or ego weapon. Look for one in the dungeon.",
        how: "hunt",
        price: null,
        depth: null
      });
    }
  }
  return out;
}
function stillInherited(inherited, own, maxDepth, wieldsMagic) {
  return inherited.filter((aim) => {
    if (aim.kind === "depth") {
      if (aim.depth === null || maxDepth >= aim.depth) return false;
      return !own.some((c) => c.kind === "depth" && (c.depth ?? 0) >= aim.depth);
    }
    return !wieldsMagic && !own.some((c) => c.kind === "weapon");
  });
}
function avengeAim(feelings) {
  const hated = feelings.filter((f) => f.unique && f.kind === "hatred").sort((a, b) => b.count - a.count)[0];
  if (hated === void 0) return null;
  return {
    kind: "avenge",
    label: `avenge the family on ${hated.name}`,
    detail: `${hated.name} killed ${hated.count === 1 ? "one" : String(hated.count)} of the family line. Kill it when it can be fought without too much risk.`,
    how: "hunt",
    price: null,
    depth: null,
    target: hated.name
  };
}
function withAvenge(candidates, feelings) {
  const aim = avengeAim(feelings);
  return aim === null ? [...candidates] : [...candidates, aim];
}

// src/strategy/review.ts
var REVIEW_TURNS = 2e3;
var TRIGGER_TEXT = {
  arrival: "on reaching a new level",
  town: "after the town trip",
  level: "after gaining a level",
  periodic: "after 2,000 game turns",
  budget: "when the level's game-turn budget runs out",
  stock: "after looking in a shop"
};
function reviewDue(memory, now) {
  if (memory === null) return "arrival";
  if (memory.depth === 0 && now.depth > 0) return "town";
  if (now.level > memory.level) return "level";
  if (now.depth !== memory.depth) return "arrival";
  if (now.turn - memory.reviewTurn >= REVIEW_TURNS) return "periodic";
  return null;
}
var WORTH = [
  "not worth pursuing now",
  "worth pursuing later",
  "worth pursuing soon",
  "worth pursuing first"
];
function scoreRequest(view, aims, pursuits = []) {
  const player = view.player();
  const questions = {};
  const described = {};
  for (const aim of aims) {
    questions[aim.kind] = {
      type: "score",
      instructions: `How worth pursuing right now is this aim: ${aim.label}? Judge it against the character's other aims and its chance of surviving.`,
      criteria: WORTH
    };
    described[aim.kind] = aim.stock === void 0 ? aim.detail : `${aim.detail} I last saw this item ${String(Math.max(0, view.turn() - aim.stock.turn))} game turns ago. I should check the shop before counting on it.`;
  }
  return {
    state: {
      rules: "An aim is something worth working toward over the next few dungeon levels. Dying early ends every aim, so a safe gain outranks a risky one. Rank the aims the way this character would, given the goals it holds.",
      character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}), ${String(player.hp)} of ${String(player.maxHp)} hit points, ${String(player.gold)} gold.`,
      aims: described,
      ...pursuits.length === 0 ? {} : pursuitFacts(pursuits)
    },
    questions
  };
}
function rankByScore(aims, answers) {
  const scoreOf = (aim) => {
    const answer = answers[aim.kind];
    return (answer?.type === "score" ? answer.score : 0) * (aim.stock?.confidence ?? 1);
  };
  return [...aims].sort((a, b) => scoreOf(b) - scoreOf(a) || FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
}
var TRIP_GOLD_GROWTH = 1.5;
function createStrategy(deps) {
  let memory = null;
  let pacing2 = createLevelPacing();
  let aims = [];
  let last = null;
  let tripGold = null;
  let generation = 0;
  let inherited = [];
  let latest = 0;
  let inFlight = Promise.resolve();
  const shops = createStoreMemory(deps.storeMemory, deps.saveStoreMemory, deps.rng);
  let stockReview = false;
  let answers = null;
  let deepest = 0;
  function pursuitsNow() {
    return pursuitsFor(deps.persona?.() ?? null, deepest, deps.feelings?.() ?? [], deps.family?.() ?? null);
  }
  function clear() {
    memory = null;
    pacing2 = createLevelPacing();
    aims = [];
    last = null;
    tripGold = null;
    deepest = 0;
    generation += 1;
    answers = null;
    stockReview = false;
  }
  function reset() {
    clear();
    inherited = [];
    shops.reset();
  }
  async function rank2(view, candidates) {
    const fixed = inFixedOrder(candidates);
    if (candidates.filter((aim) => aim.kind !== "win").length < 2) return { ranked: fixed, source: "fixed", by: "" };
    const backend = deps.backend();
    if (backend === null) return { ranked: fixed, source: "fixed", by: " It kept the usual order, because no model server is set up." };
    const capped = deps.tally.overCap(backend, deps.now());
    if (capped !== null) return { ranked: fixed, source: "fixed", by: " It kept the usual order, because the spend limit is reached." };
    let result;
    try {
      result = await deps.send(scoreRequest(view, candidates, pursuitsNow()));
    } catch {
      return { ranked: fixed, source: "fixed", by: " It kept the usual order, because the request failed." };
    }
    if (!result.ok) return { ranked: fixed, source: "fixed", by: ` It kept the usual order, because ${backend.label} answered with ${result.failure.kind}.` };
    deps.tally.record(backend, result.usage, deps.now());
    return { ranked: rankByScore(candidates, result.answers), source: "model", by: ` ${backend.label} ranked them.`, answers: result.answers };
  }
  async function review(view, trigger, turn, mine) {
    const seq = ++latest;
    const own = candidateAims(view, shops.all(), deps.persona?.() ?? null);
    inherited = stillInherited(inherited, own, view.player().maxDepth, wieldsMagicWeapon(view));
    const candidates = withAvenge(withInherited(own, inherited), deps.feelings?.() ?? []);
    aims = inFixedOrder(candidates);
    const done = await rank2(view, candidates);
    if (mine !== generation || seq !== latest) return;
    answers = done.answers ?? null;
    aims = done.ranked;
    last = { trigger, turn, source: done.source };
    const names = done.ranked.map((aim) => aim.label).join(", ");
    deps.log(`Squire looked over its aims ${TRIGGER_TEXT[trigger]}: ${names === "" ? "none apply" : names}.${done.by}`);
  }
  return {
    remember(view, terrain) {
      const seen = shops.observe(view, terrain, deps.persona?.() ?? null);
      if (!seen.changed) return;
      for (const aim of aims) {
        const stock = aim.stock;
        if (!seen.entered || stock === void 0 || stock.feat !== seen.memory?.feat || seen.memory.stock.some((item) => wareName(item.name) === wareName(stock.name))) continue;
        const owned = [...view.inventory(), ...view.equipment().filter((item) => item !== null)].some((item) => wareName(item.name ?? "") === wareName(stock.name));
        if (!owned) deps.log(`I put coins aside for ${stock.name}. Now the shopkeeper has none. I should have come back sooner.`);
      }
      const own = candidateAims(view, shops.all(), deps.persona?.() ?? null);
      const candidates = withAvenge(withInherited(own, inherited), deps.feelings?.() ?? []);
      aims = answers === null ? inFixedOrder(candidates) : rankByScore(candidates, answers);
      latest += 1;
      stockReview = true;
    },
    shops: shops.all,
    observe(view) {
      const player = view.player();
      if (player.dead) return;
      const turn = view.turn();
      if (memory !== null && turn < memory.reviewTurn) reset();
      if (aims.some((aim) => aim.stock !== void 0)) {
        const fresh = candidateAims(view, shops.all(), deps.persona?.() ?? null);
        const updated = aims.flatMap((aim) => aim.stock === void 0 ? [aim] : fresh.filter((entry) => entry.kind === aim.kind));
        aims = answers === null ? inFixedOrder(updated) : rankByScore(updated, answers);
      }
      deepest = Math.max(deepest, player.maxDepth);
      const budget = pacing2.observe(view);
      const trigger = reviewDue(memory, { depth: player.depth, level: player.level, turn }) ?? (stockReview ? "stock" : budget.review ? "budget" : null);
      memory = { depth: player.depth, level: player.level, reviewTurn: trigger === null ? memory?.reviewTurn ?? turn : turn };
      if (trigger === null) return;
      stockReview = false;
      if (trigger === "town") tripGold = player.gold;
      inFlight = review(view, trigger, turn, generation).catch((error) => {
        deps.log(`Squire couldn't look over its aims: ${String(error)}`);
      });
    },
    ranked: () => aims,
    pursuits: pursuitsNow,
    last: () => last,
    tripAllowed: (gold) => tripGold === null || gold >= tripGold * TRIP_GOLD_GROWTH,
    inherit(list) {
      inherited = list;
    },
    reset,
    settled: () => inFlight
  };
}

// src/persona/drift.ts
function applyDrift(persona, event, _rng) {
  const next = normalize(persona);
  const changes = [];
  const step = Math.round(next.sliders.drift / 20);
  function move(id, amount) {
    const from = next.sliders[id];
    const to = Math.max(0, Math.min(100, from + amount));
    if (to !== from) {
      next.sliders[id] = to;
      changes.push({ id, from, to });
    }
  }
  switch (event) {
    case "near-death":
      move("boldness", -step);
      move("paranoia", step);
      break;
    case "unique-kill":
      move("pride", step);
      move("boldness", step);
      break;
    case "level-up":
      move("composure", step);
      break;
    case "patron-blessing":
      move("devotion", Math.round(step * next.sliders.gratitude / 50));
      break;
    case "patron-trial":
      move("devotion", -Math.round(step * next.sliders.resentment / 50));
      break;
    case "fled":
      move("pride", -step);
      break;
  }
  return { persona: next, changes };
}

// src/orders/adherence.ts
var PASS_ADHERENCE = 0.85;
var IGNORE_BELOW = 0.2;
var GRUDGE_BELOW = 0.4;
var GIVE_UP_REVIEWS = 3;
var VIEWER_PULL = 0.6;
var VERY_DEVOTED = 90;
var SERVE_BOOST = 3;
var BREAK_CUT = 0.85;
function unit3(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
function clash(sorted, persona) {
  const s = persona.sliders;
  const bold = s.boldness / 100;
  const careful = s.selfpreservation / 100;
  const wants = [];
  const response = sorted.response;
  if (response === "flee") wants.push(bold * 0.6 + s.pride / 100 * 0.4);
  if (response === "fight") wants.push((1 - bold) * 0.5 + careful * 0.5);
  if (response === "descend" || sorted.aim === "depth") wants.push(careful * 0.6 + (1 - s.ambition / 100) * 0.4);
  if (response === "buy" || sorted.aim === "armour" || sorted.aim === "weapon" || sorted.aim === "item") wants.push(s.savings / 100 * 0.5 + s.pricesense / 100 * 0.5);
  if (sorted.aim === "gold") wants.push(s.impulsiveness / 100 * 0.5 + s.greed / 100 * 0.5);
  if (response === "rest") wants.push((1 - s.patience / 100) * 0.7);
  if (response === "avoid") wants.push(s.impulsiveness / 100 * 0.6);
  return wants.length === 0 ? 0 : unit3(Math.max(...wants));
}
function targetAdherence(sorted, persona, viewer = false) {
  const s = persona.sliders;
  const pull = (s.devotion - 50) / 50 * 0.9;
  const grudge = s.resentment / 100 * 0.4;
  const friction = clash(sorted, persona) * (0.3 + 0.4 * (s.stubbornness / 100));
  const weight = 0.6 + 0.4 * (s.strength / 100);
  const own = unit3(0.5 + 0.5 * (pull - grudge - friction) * weight);
  return viewer && s.devotion < VERY_DEVOTED ? own * VIEWER_PULL : own;
}
function nextAdherence(previous, sorted, persona, viewer = false) {
  const target = targetAdherence(sorted, persona, viewer);
  if (previous === null) return target;
  const rate2 = Math.max(0.1, 1 - 0.9 * (persona.sliders.stubbornness / 100));
  return unit3(previous + (target - previous) * rate2);
}
function stanceOf(adherence, sorted, persona) {
  if (adherence < IGNORE_BELOW) return "ignoring";
  if (adherence < GRUDGE_BELOW || clash(sorted, persona) >= 0.4 || persona.sliders.resentment >= 60) return "grudgingly";
  return "following";
}
function goalsOf(sorted) {
  const serves = /* @__PURE__ */ new Set();
  const breaks = new Set(sorted.avoids);
  const attacks = ["fight", "shoot", "cast_attack", "throw_oil", "aim_wand"];
  const escapes = ["retreat", "phase", "teleport"];
  switch (sorted.response) {
    case "flee":
      escapes.forEach((g) => serves.add(g));
      serves.add("leave_level");
      attacks.forEach((g) => breaks.add(g));
      break;
    case "fight":
      attacks.forEach((g) => serves.add(g));
      escapes.forEach((g) => breaks.add(g));
      break;
    case "leave-level":
      serves.add("leave_level");
      serves.add("descend");
      break;
    case "descend":
      serves.add("descend");
      break;
    case "buy":
      serves.add("shop");
      serves.add("recall_town");
      break;
    case "rest":
      serves.add("rest");
      break;
    case "avoid":
    case null:
      break;
  }
  switch (sorted.aim) {
    case "armour":
    case "weapon":
    case "spellbook":
    case "lantern":
    case "item":
      serves.add("recall_town");
      serves.add("shop");
      if (sorted.aim === "armour" || sorted.aim === "weapon") serves.add("wear");
      if (sorted.aim === "item") serves.add("pick_up");
      break;
    case "depth":
      serves.add("descend");
      serves.add("leave_level");
      break;
    default:
      break;
  }
  for (const goal of breaks) serves.delete(goal);
  return { serves: [...serves], breaks: [...breaks] };
}
function weigh(dist, instruction, modelServes = /* @__PURE__ */ new Set()) {
  const { serves, breaks } = goalsOf(instruction.sorted);
  const a = unit3(instruction.adherence) * unit3(instruction.memory);
  const out = { ...dist };
  for (const key2 of Object.keys(out)) {
    const serving = serves.includes(key2) || modelServes.has(key2);
    const base = out[key2] ?? 0;
    if (breaks.includes(key2)) out[key2] = base * (1 - BREAK_CUT * a);
    else if (serving) out[key2] = base * (1 + SERVE_BOOST * a);
  }
  return out;
}

// src/orders/memory.ts
var FORGET_BELOW = 0.15;
var REMEMBERED_AT = 0.6;
var FAINT = 0.1;
var TURN_FADE = 1 / 12e4;
var LEVEL_FADE = 0.03;
var ACT_REFRESH = 0.25;
function fadeRate(persona) {
  const forgetful = persona.quirks.forgetful.on ? 1 + 2 * (persona.quirks.forgetful.strength / 100) : 1;
  const devotion = 1.25 - 0.75 * (persona.sliders.devotion / 100);
  return forgetful * devotion;
}
function fade(memory, turns, levelChanges, persona) {
  const t = Number.isFinite(turns) ? Math.max(0, turns) : 0;
  const l = Number.isFinite(levelChanges) ? Math.max(0, levelChanges) : 0;
  return Math.max(0, memory - (t * TURN_FADE + l * LEVEL_FADE) * fadeRate(persona));
}
function refreshed(memory, full) {
  return full ? 1 : Math.min(1, memory + ACT_REFRESH);
}
function isForgotten(memory) {
  return memory < FORGET_BELOW;
}
function comesBack(persona, draw) {
  return draw < 0.3 + 0.4 * (persona.sliders.devotion / 100);
}

// src/orders/vocab.ts
var BELOW = String.raw`(?:below|under|less than|beneath|lower than|at most|(?:drops?|falls?|gets?|goes?) (?:below|under|to))`;
var SHARES = {
  half: 0.5,
  "a half": 0.5,
  "a third": 1 / 3,
  "one third": 1 / 3,
  "a quarter": 0.25,
  "one quarter": 0.25,
  "a fourth": 0.25,
  "two thirds": 2 / 3,
  "three quarters": 0.75
};
var SHARE_WORDS = Object.keys(SHARES).sort((a, b) => b.length - a.length).join("|");
function readHpLine(text) {
  const t = text.toLowerCase();
  const percent = new RegExp(String.raw`${BELOW}\s+(\d{1,3})\s*(?:%|percent)`).exec(t);
  if (percent !== null) {
    const value = Number(percent[1]) / 100;
    return value > 0 && value <= 1 ? { kind: "share", value } : null;
  }
  const words = new RegExp(String.raw`${BELOW}\s+(${SHARE_WORDS})\b`).exec(t) ?? new RegExp(String.raw`\b(${SHARE_WORDS})\s+(?:hp|hit points|health)\b`).exec(t);
  if (words !== null) return { kind: "share", value: SHARES[words[1]] };
  const hp = new RegExp(String.raw`${BELOW}\s+(\d{1,5})(?!\s*(?:ft|feet|gold|gp|%|percent|\d|th\b|st\b|nd\b|rd\b))`).exec(t);
  if (hp !== null) {
    const value = Number(hp[1]);
    return value > 0 ? { kind: "hp", value } : null;
  }
  return null;
}
function underHpLine(line, hp, maxHp) {
  if (maxHp <= 0) return false;
  if (line === void 0) return hp <= maxHp * 0.5;
  return line.kind === "hp" ? hp < line.value : hp < maxHp * line.value;
}
var VERBS = [
  [/^read/, "read"],
  [/^(?:quaff|drink)/, "quaff"],
  [/^zap/, "zap"],
  [/^aim/, "aim"],
  [/^us/, "use"]
];
var NOUNS = [
  [/^scrolls?$/, "read"],
  [/^potions?$/, "quaff"],
  [/^wands?$/, "aim"],
  [/^rods?$/, "zap"],
  [/^(?:staffs?|staves)$/, "use"],
  [/^(?:items?|devices?|objects?|anything|things?)$/, "use"]
];
var FIGHT = /\b(?:in (?:a )?fights?|in combat|in battle|while fighting|when fighting|during (?:a )?fights?|with (?:a |an )?(?:monster|creature|enemy)s? (?:in sight|nearby|around))\b/;
var UNKNOWN = /^(?:unknown|unidentified|untried|unrecogni[sz]ed|unfamiliar)$/;
var FILLER = /^(?:any|a|an|the|my|your|of|those|these)$/;
function readBans(text) {
  const t = text.toLowerCase();
  const out = [];
  const pattern = /\b(?:never|do not|don't|avoid|refuse to)\s+(read(?:ing)?|quaff(?:ing)?|drink(?:ing)?|zap(?:ping)?|aim(?:ing)?|us(?:e|ing))\b([^.,;!?]*)/g;
  for (let m = pattern.exec(t); m !== null; m = pattern.exec(t)) {
    let verb = VERBS.find(([re]) => re.test(m[1]))?.[1] ?? "use";
    const rest = m[2];
    const when = FIGHT.test(rest) ? "fight" : "always";
    const words = rest.replace(FIGHT, " ").replace(/\b(?:when|while|if|during|in|at|on)\b.*$/, " ").trim().split(/\s+/).filter((w) => w !== "");
    const at = words.findIndex((w) => NOUNS.some(([re]) => re.test(w)));
    let item = null;
    if (words.some((w) => UNKNOWN.test(w))) item = "unknown";
    if (at >= 0) {
      const nounVerb = NOUNS.find(([re]) => re.test(words[at]))[1];
      if (verb === "use") verb = nounVerb;
      const after = words.slice(at + 1);
      if (item === null && after[0] === "of" && after.length > 1) item = after.slice(1).join(" ");
    } else if (item === null) {
      const named3 = words.filter((w) => !FILLER.test(w)).join(" ");
      item = named3 === "" ? null : named3;
    }
    out.push({ verb, item, when });
  }
  return out;
}
var GOAL_USES = {
  heal: ["quaff"],
  phase: ["read"],
  teleport: ["read", "use"],
  detect: ["read", "zap"],
  recall_town: ["read"],
  recall_dungeon: ["read"],
  buff: ["quaff", "read"],
  resist: ["quaff", "read"],
  device: ["use", "zap"],
  aim_wand: ["aim"],
  activate: ["use"]
};
function stem(text) {
  return text.toLowerCase().replace(/\b(\w+?)e?s\b/g, "$1");
}
function bannedGoals(bans, offers, fighting2) {
  const out = /* @__PURE__ */ new Set();
  for (const ban of bans) {
    if (ban.when === "fight" && !fighting2) continue;
    for (const offer of offers) {
      const uses = GOAL_USES[offer.goal];
      if (uses === void 0 || ban.verb !== "use" && !uses.includes(ban.verb)) continue;
      const words = offer.criteria;
      const named3 = ban.item === null || (ban.item === "unknown" ? /\b(?:unknown|unidentified|untried)\b/i.test(words) : stem(words).includes(stem(ban.item)));
      if (named3) out.add(offer.goal);
    }
  }
  return [...out];
}
function fighting(view) {
  return view.monsters().some((m) => m.visible && !m.asleep);
}
function inStore(view) {
  const p = view.player();
  if (p.depth !== 0) return false;
  let feats;
  try {
    feats = view.stores().map((s) => s.feat);
  } catch {
    return false;
  }
  const cell2 = view.cell(p.grid.x, p.grid.y);
  return cell2 !== null && feats.includes(cell2.feat);
}

// src/orders/sort.ts
var NONE = "none_of_these";
var STORES = ["General Store", "Armoury", "Weapon Smiths", "Bookseller", "Alchemy shop", "Magic shop", "Black market", "Home"];
var AIM_CHOICES = {
  armour: "Wear armour on the empty or weak slots.",
  weapon: "Get a better weapon.",
  spellbook: "Get the next spellbook.",
  lantern: "Get a lantern or a better light.",
  item: "Buy, find or keep a particular item.",
  depth: "Reach a certain depth.",
  gold: "Save a sum of gold.",
  [NONE]: "The instruction states no aim of this sort."
};
var TRIGGER_CHOICES = {
  unique: "A unique creature comes into view.",
  "low-hp": "Hit points fall below a line.",
  "new-level": "The character arrives on a new level.",
  "in-store": "The character enters a store.",
  always: "The instruction names no trigger; it applies all the time."
};
var RESPONSE_CHOICES = {
  flee: "Run away or escape.",
  fight: "Attack.",
  "leave-level": "Leave the level by the stairs.",
  descend: "Go deeper.",
  buy: "Buy something.",
  rest: "Rest.",
  avoid: "Never do a certain thing.",
  [NONE]: "The instruction states no response of this sort."
};
var KIND_CHOICES = {
  order: "A task that ends once it is done.",
  standing: "A rule that keeps applying until it is retired."
};
var FREQUENCY_CHOICES = {
  once: "It applies the first time only.",
  always: "It applies every time.",
  "until-level": "It applies until the character reaches a level."
};
var NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
var AVOID_WORDS = [
  [/\b(fight|melee|attack)/i, "fight"],
  [/\b(shoot|fire)\b/i, "shoot"],
  [/\b(descend|dive|stairs down|go deeper)\b/i, "descend"],
  [/\brest/i, "rest"],
  [/\b(phase|teleport)\b/i, "phase"],
  [/\b(shop|buy)/i, "shop"]
];
function wordsOf(text) {
  return text.toLowerCase();
}
function sortByCode(text) {
  const t = wordsOf(text);
  let aim = null;
  let item = null;
  let count2 = 1;
  let depth2 = null;
  let deadlineLevel = null;
  let gold = null;
  const feet2 = /(\d[\d,]*)\s*(?:ft|feet)\b/.exec(t);
  const goldMatch = /(\d[\d,]*)\s*(?:gold|gp)\b/.exec(t);
  const before = /\b(?:before|by)\s+(?:character\s+)?level\s+(\d+)/.exec(t);
  const itemMatch = /\b(?:bring back|bring|keep|carry|buy|get|find|fetch|stock up on)\s+(?:(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:of\s+)?((?:potions?|scrolls?|flasks?|rations?|wands?|rods?|staffs?|staves|rings?|amulets?|arrows?|bolts?|shots?|pebbles?)\b[^.,;]*)/.exec(t);
  if (feet2 !== null) {
    depth2 = Math.max(1, Math.round(Number(feet2[1].replace(/,/g, "")) / 50));
    aim = "depth";
  } else if (/\b(?:reach|dive to|descend to|get to)\s+(?:dungeon\s+)?level\s+(\d+)/.exec(t) !== null) {
    depth2 = Number(/level\s+(\d+)/.exec(t)[1]);
    aim = "depth";
  }
  if (before !== null) deadlineLevel = Number(before[1]);
  if (aim === null && itemMatch !== null) {
    aim = "item";
    const raw = itemMatch[1];
    count2 = raw === void 0 ? 1 : /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? 1;
    item = itemMatch[2].replace(/\b(?:from|at|in|with|for|when|before)\b.*$/, "").replace(/\s+/g, " ").trim().replace(/s$/, "");
  }
  if (aim === null && goldMatch !== null && /\b(save|keep|hold|hoard|have|bank)\b/.test(t)) {
    aim = "gold";
    gold = Number(goldMatch[1].replace(/,/g, ""));
  }
  if (aim === null) {
    if (/\b(armou?r|suit up|helm|shield|boots|gloves|cloak|gauntlets)\b/.test(t)) aim = "armour";
    else if (/\b(weapon|sword|axe|blade|polearm|mace)\b/.test(t)) aim = "weapon";
    else if (/\b(spellbook|magic book|prayer book|book of)\b/.test(t)) aim = "spellbook";
    else if (/\b(lantern|torch|light source)\b/.test(t)) aim = "lantern";
  }
  const store = STORES.find((s) => t.includes(s.toLowerCase())) ?? (/\barmou?r(?:y| shop| store)\b/.test(t) ? "Armoury" : /\b(weaponsmith|weapon smith)/.test(t) ? "Weapon Smiths" : /\b(alchemist)\b/.test(t) ? "Alchemy shop" : null);
  let trigger = "always";
  const hpLine = readHpLine(text);
  if (/\bunique/.test(t)) trigger = "unique";
  else if (hpLine !== null || /\b(hit points|hp|health|wounded|badly hurt|low on)\b/.test(t)) trigger = "low-hp";
  else if (/\b(new level|arriv\w+ (?:on|at)|each level|every level|first arrive)\b/.test(t)) trigger = "new-level";
  else if (/\benter\w*\s+(?:a\s+|the\s+)?(?:store|shop)\b/.test(t)) trigger = "in-store";
  const avoidWords = /\b(never|do not|don't|avoid|refuse to|stay out of)\b/.test(t);
  const avoids = avoidWords ? AVOID_WORDS.filter(([pattern]) => new RegExp(`\\b(?:never|do not|don't|avoid|refuse to|stay out of)\\s+(?:\\w+\\s+){0,2}?${pattern.source}`, "i").test(text)).map(([, goal]) => goal) : [];
  const bans = readBans(text);
  let response = null;
  if (avoidWords && (avoids.length > 0 || bans.length > 0)) response = "avoid";
  else if (/\b(flee|run away|run from|escape|retreat|get away|back off)\b/.test(t)) response = "flee";
  else if (/\b(fight|attack|kill|charge|slay|engage)\b/.test(t)) response = "fight";
  else if (/\b(leave the level|take the stairs|leave level|use the stairs)\b/.test(t)) response = "leave-level";
  else if (/\b(descend|dive|go deeper|go down)\b/.test(t) && aim !== "depth") response = "descend";
  else if (/\b(buy|purchase|shop)\b/.test(t) && aim !== "item") response = "buy";
  else if (/\brest\b/.test(t)) response = "rest";
  let frequency = { mode: "always" };
  const until = /\buntil\s+(?:character\s+)?level\s+(\d+)/.exec(t);
  if (/\b(first time|the first|just once|once)\b/.test(t)) frequency = { mode: "once" };
  else if (until !== null) frequency = { mode: "until-level", level: Number(until[1]) };
  const standing = /\b(always|never|whenever|every time|each time|the first time|until level|any time|when(?:ever)? you|if you see)\b/.test(t) || avoidWords;
  return {
    kind: standing ? "standing" : "order",
    sorted: {
      aim,
      trigger,
      response,
      avoids,
      store,
      depth: depth2,
      deadlineLevel,
      item,
      count: count2,
      gold,
      frequency,
      ...hpLine === null ? {} : { hpBelow: hpLine },
      ...bans.length === 0 ? {} : { bans }
    }
  };
}
function choice(instructions, criteria) {
  return { type: "choice", instructions, criteria: { ...criteria } };
}
function sortRequest(text) {
  return {
    state: {
      rules: "A squire has been given an instruction in plain words. Sort it into the squire's own vocabulary. Answer none_of_these for any part the words do not state.",
      instruction: text
    },
    questions: {
      kind: choice("Is this an order that ends when done, or a standing instruction that keeps applying?", { ...KIND_CHOICES, [NONE]: "Neither fits." }),
      aim: choice("What is the instruction aiming for?", AIM_CHOICES),
      trigger: choice("What situation triggers it?", { ...TRIGGER_CHOICES, [NONE]: "It names no trigger." }),
      response: choice("What should the squire do in response?", RESPONSE_CHOICES),
      store: choice("Which store does it name, if any?", { ...Object.fromEntries(STORES.map((s) => [s, `The ${s}.`])), [NONE]: "It names no store." }),
      frequency: choice("How often does it apply?", { ...FREQUENCY_CHOICES, [NONE]: "It does not say." })
    }
  };
}
var SORT_BATCH = 5;
function sortManyRequest(texts) {
  const one = sortRequest("");
  const instructions = {};
  const questions = {};
  texts.forEach((text, n) => {
    const key2 = `n${String(n)}`;
    instructions[key2] = text;
    for (const [part, q] of Object.entries(one.questions)) {
      const c = q;
      questions[`${key2}_${part}`] = { ...c, instructions: `For instruction ${key2}: ${c.instructions}` };
    }
  });
  return {
    state: {
      rules: "A squire has been given several instructions in plain words. Sort each into the squire's own vocabulary. Answer none_of_these for any part the words do not state.",
      instructions
    },
    questions
  };
}
async function sortMany(texts, deps) {
  const byCode = texts.map((text) => ({ ...sortByCode(text), source: "code" }));
  const asked = texts.slice(0, SORT_BATCH);
  const backend = deps.backend();
  if (asked.length === 0 || backend === null || deps.tally.overCap(backend, deps.now()) !== null) return byCode;
  let result;
  try {
    result = await deps.send(sortManyRequest(asked));
  } catch {
    return byCode;
  }
  if (!result.ok) return byCode;
  deps.tally.record(backend, result.usage, deps.now());
  return texts.map((text, n) => {
    if (n >= asked.length) return byCode[n];
    const prefix2 = `n${String(n)}_`;
    const answers = {};
    for (const [key2, answer] of Object.entries(result.answers)) if (key2.startsWith(prefix2)) answers[key2.slice(prefix2.length)] = answer;
    return { ...readSort(text, answers), source: "model" };
  });
}
function picked(answers, key2, allowed) {
  const answer = answers[key2];
  if (answer?.type !== "choice" || answer.choice === NONE) return null;
  return allowed.includes(answer.choice) ? answer.choice : null;
}
var AIM_KINDS = ["armour", "weapon", "spellbook", "lantern", "item", "depth", "gold"];
var TRIGGERS = ["unique", "low-hp", "new-level", "in-store", "always"];
var RESPONSES = ["flee", "fight", "leave-level", "descend", "buy", "rest", "avoid"];
function readSort(text, answers) {
  const code = sortByCode(text);
  const aim = picked(answers, "aim", AIM_KINDS);
  const trigger = picked(answers, "trigger", TRIGGERS);
  const response = picked(answers, "response", RESPONSES);
  const store = picked(answers, "store", STORES);
  const kind = picked(answers, "kind", ["order", "standing"]);
  const mode = picked(answers, "frequency", ["once", "always", "until-level"]);
  const seen = code.sorted.frequency;
  const frequency = mode === null || mode === seen.mode ? seen : mode === "until-level" ? seen : mode === "once" ? { mode: "once" } : { mode: "always" };
  const chosenResponse = response ?? code.sorted.response;
  return {
    kind: kind ?? code.kind,
    sorted: {
      ...code.sorted,
      aim: aim ?? code.sorted.aim,
      trigger: trigger ?? code.sorted.trigger,
      response: chosenResponse,
      store: store ?? code.sorted.store,
      frequency
    }
  };
}
async function sortInstruction(text, deps) {
  const fallback = () => ({ ...sortByCode(text), source: "code" });
  const backend = deps.backend();
  if (backend === null) return fallback();
  if (deps.tally.overCap(backend, deps.now()) !== null) return fallback();
  let result;
  try {
    result = await deps.send(sortRequest(text));
  } catch {
    return fallback();
  }
  if (!result.ok) return fallback();
  deps.tally.record(backend, result.usage, deps.now());
  return { ...readSort(text, result.answers), source: "model" };
}

// src/orders/types.ts
var SOURCES = ["panel", "hotkey", "creed", "channel"];
var LIVE_STATES = ["following", "grudgingly", "ignoring"];
var MAX_TEXT = 2e3;
var MAX_VIEWER = 40;
var STATE_LABELS = {
  following: "following",
  grudgingly: "grudgingly",
  ignoring: "ignoring",
  forgotten: "forgotten",
  done: "done",
  abandoned: "abandoned"
};
function isLive(state) {
  return LIVE_STATES.includes(state);
}

// src/orders/book.ts
var KEEP_ENDED = 20;
var ASKED = 3;
var NOTE_GAP = 500;
var RESENT_STEP = 5;
var THANKS = 3;
var GRUDGING_THANKS = 2;
var SHOWN = 6;
var ROTATE_STEP = 0.5;
var ROTATE_CAP = 8;
var STANCE_WORDS = {
  following: "You intend to follow it.",
  grudgingly: "You intend to follow it grudgingly.",
  ignoring: "You mean to ignore it."
};
function normal(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
function short(text) {
  const one = text.trim().replace(/\s+/g, " ");
  return one.length > 90 ? `${one.slice(0, 87)}...` : one;
}
function noun(kind) {
  return kind === "order" ? "order" : "standing instruction";
}
function createOrders(deps) {
  const rng = deps.rng ?? Math.random;
  let items = [];
  let counter = 0;
  let lastTurn = 0;
  let lastDepth = 0;
  let review = null;
  let arrived = false;
  let generation = 0;
  let inFlight = Promise.resolve();
  const corrected = /* @__PURE__ */ new Set();
  const explicit = /* @__PURE__ */ new Set();
  const rolled = /* @__PURE__ */ new Set();
  const notedAt = /* @__PURE__ */ new Map();
  let asked = [];
  const shownAt = /* @__PURE__ */ new Map();
  const askedAt = /* @__PURE__ */ new Map();
  let noteRound = 0;
  let askRound = 0;
  let pending = null;
  let changes = 0;
  let deferred = [];
  const persona = () => deps.persona() ?? defaultPersona();
  function persist() {
    changes += 1;
    const ended = items.filter((i) => !isLive(i.state));
    const drop = new Set(ended.slice(0, Math.max(0, ended.length - KEEP_ENDED)).map((i) => i.id));
    if (drop.size > 0) items = items.filter((i) => !drop.has(i.id));
    deps.save({ items });
  }
  function say(text, notable) {
    deps.log(text);
    deps.note(text, notable, lastTurn, lastDepth);
  }
  function replace(id, patch) {
    const at = items.findIndex((i) => i.id === id);
    if (at < 0) return void 0;
    const next = { ...items[at], ...patch };
    items = [...items.slice(0, at), next, ...items.slice(at + 1)];
    return next;
  }
  function restance(i, previous) {
    const p = persona();
    const adherence = nextAdherence(previous, i.sorted, p, i.source === "channel");
    return { ...i, adherence, state: stanceOf(adherence, i.sorted, p) };
  }
  function triggerActive(i, view) {
    const p = view.player();
    switch (i.sorted.trigger) {
      case "always":
        return true;
      case "unique":
        return view.monsters().some((m) => m.visible && m.raceFlags.includes("UNIQUE"));
      case "low-hp":
        return underHpLine(i.sorted.hpBelow, p.hp, p.maxHp);
      case "new-level":
        return arrived;
      case "in-store":
        return inStore(view);
    }
  }
  function rotate(view, slots, shown, round, offers) {
    const offered = new Set((offers ?? []).map((o) => o.goal));
    const score = (i) => {
      const goals = goalsOf(i.sorted);
      const meets = [...goals.serves, ...goals.breaks].some((g) => offered.has(g)) ? 1 : 0;
      const waited = Math.min(ROTATE_CAP, round - (shown.get(i.id) ?? round - ROTATE_CAP));
      return (i.sorted.trigger === "always" ? 0 : 2) + meets + i.adherence * i.memory + ROTATE_STEP * waited;
    };
    const picked2 = applicable(view).map((i) => ({ i, s: score(i) })).sort((a, b) => b.s - a.s || a.i.createdTurn - b.i.createdTurn).slice(0, slots).map((x) => x.i);
    for (const i of picked2) shown.set(i.id, round);
    return picked2;
  }
  function said(i) {
    if (i.source !== "channel") return `${i.kind === "order" ? "Your patron ordered" : "Your patron's standing instruction"}: "${i.text}".`;
    return `A viewer${i.viewer === void 0 ? "" : `, ${i.viewer},`} asked: "${i.text}".`;
  }
  function withBans(i, view, offers) {
    const bans = i.sorted.bans;
    if (bans === void 0 || bans.length === 0 || offers === void 0) return i;
    const extra = bannedGoals(bans, offers, fighting(view)).filter((g) => !i.sorted.avoids.includes(g));
    return extra.length === 0 ? i : { ...i, sorted: { ...i.sorted, avoids: [...i.sorted.avoids, ...extra] } };
  }
  function applicable(view) {
    return items.filter((i) => isLive(i.state) && i.memory >= FORGET_BELOW && triggerActive(i, view));
  }
  function finish(i, state, why) {
    const was = i;
    const next = replace(i.id, { state, memory: state === "forgotten" && i.kind === "standing" ? FAINT : i.memory });
    if (next === void 0) return;
    if (state === "done") {
      say(`${why} ${short(was.text)}`, true);
      if (was.kind === "order") answerPatron(was);
    } else if (state === "forgotten") {
      say(`Forgot the ${noun(was.kind)}: ${short(was.text)}`, true);
    } else {
      say(`${why} ${short(was.text)}`, false);
    }
    persist();
  }
  function answerPatron(i) {
    const p = deps.persona();
    if (p === null) return;
    const grateful = (persona2, step) => ({ ...persona2, sliders: { ...persona2.sliders, gratitude: Math.min(100, persona2.sliders.gratitude + step) } });
    if (i.disliked) {
      let next2 = { ...p, sliders: { ...p.sliders, resentment: Math.min(100, p.sliders.resentment + RESENT_STEP) } };
      if (i.state === "grudgingly") next2 = grateful(next2, GRUDGING_THANKS);
      if (next2.sliders.resentment !== p.sliders.resentment || next2.sliders.gratitude !== p.sliders.gratitude) deps.setPersona(next2);
      return;
    }
    const drift = applyDrift(p, "patron-blessing", rng);
    const next = grateful(drift.persona, THANKS);
    if (drift.changes.length > 0 || next.sliders.gratitude !== p.sliders.gratitude) deps.setPersona(next);
  }
  function complete(view, i) {
    const s = i.sorted;
    const p = view.player();
    if (s.frequency.mode === "once" && i.acted >= 1) return "Instruction done:";
    if (s.frequency.mode === "until-level" && p.level >= s.frequency.level) return `Reached level ${String(s.frequency.level)}, so the instruction lapsed:`;
    if (i.kind !== "order") return null;
    if (s.aim === "depth" && s.depth !== null && p.maxDepth >= s.depth) return "Order done:";
    if (s.aim === "gold" && s.gold !== null && p.gold >= s.gold) return "Order done:";
    if (s.aim === "item" && s.item !== null) {
      const stem2 = (t) => t.toLowerCase().replace(/\b(\w+?)e?s\b/g, "$1");
      const want = stem2(s.item);
      const held2 = view.inventory().filter((it) => stem2(it.label).includes(want)).reduce((n, it) => n + it.number, 0);
      if (held2 >= s.count) return "Order done:";
    }
    return null;
  }
  function reviewNow(view) {
    const p = view.player();
    let aims = null;
    for (const i of items.filter((x) => isLive(x.state))) {
      let now = restance(items.find((x) => x.id === i.id) ?? i, i.adherence);
      now = { ...now, lowReviews: now.state === "ignoring" ? now.lowReviews + 1 : 0, disliked: now.state !== "following" };
      replace(i.id, now);
      if (i.kind === "order" && i.sorted.deadlineLevel !== null && p.level >= i.sorted.deadlineLevel && complete(view, i) === null) {
        finish(now, "abandoned", "Order dropped, out of time:");
        continue;
      }
      let done = complete(view, now);
      if (done === null && i.kind === "order" && (i.sorted.aim === "armour" || i.sorted.aim === "weapon" || i.sorted.aim === "spellbook" || i.sorted.aim === "lantern")) {
        aims ??= candidateAims(view);
        const kind = i.sorted.aim;
        if (!aims.some((a) => a.kind === kind)) done = "Order done:";
      }
      if (done !== null) {
        finish(now, "done", done);
        continue;
      }
      if (now.kind === "order" && now.lowReviews >= GIVE_UP_REVIEWS) finish(now, "abandoned", "Order dropped, never followed:");
    }
    persist();
  }
  async function prune(mine, useModel = true) {
    while (mine === generation) {
      const live = items.filter((i) => isLive(i.state));
      if (live.length <= Math.max(1, Math.floor(deps.kept()))) return;
      const fallback = [...live].sort((a, b) => a.adherence * a.memory - b.adherence * b.memory || a.createdTurn - b.createdTurn)[0];
      let target = fallback;
      const backend = useModel ? deps.backend() : null;
      if (backend !== null && deps.tally.overCap(backend, deps.now()) === null) {
        const criteria = {};
        for (const i of live) criteria[i.id] = `${short(i.text)} (it is ${i.state})`;
        criteria[NONE] = "None of these stands out.";
        const request2 = {
          state: { rules: "A squire holds more instructions than it will keep. One must be dropped.", persona: persona().name },
          questions: { drop: { type: "choice", instructions: "Which instruction is least like this persona, the one it follows least readily?", criteria } }
        };
        let result = null;
        try {
          result = await deps.send(request2);
        } catch {
          result = null;
        }
        if (mine !== generation) return;
        if (result !== null && result.ok) {
          deps.tally.record(backend, result.usage, deps.now());
          const answer = result.answers["drop"];
          const named3 = answer?.type === "choice" ? live.find((i) => i.id === answer.choice) : void 0;
          if (named3 !== void 0) target = named3;
        }
      }
      const still = items.find((i) => i.id === target.id);
      if (still === void 0 || !isLive(still.state)) return;
      replace(target.id, { state: "abandoned" });
      say(`Dropped the ${noun(target.kind)} to keep the number down: ${short(target.text)}`, false);
      persist();
    }
  }
  function chain(work) {
    const mine = generation;
    inFlight = inFlight.then(() => work(mine)).catch((error) => {
      deps.log(`Squire could not sort its orders: ${String(error)}`);
    });
  }
  async function refine(id, text, mine) {
    applySorted(id, await sortInstruction(text, deps), mine);
  }
  function applySorted(id, sorted, mine) {
    if (mine !== generation || corrected.has(id)) return;
    const current2 = items.find((i) => i.id === id);
    if (current2 === void 0 || !isLive(current2.state)) return;
    const kind = explicit.has(id) ? current2.kind : sorted.kind;
    const next = restance({ ...current2, sorted: sorted.sorted, kind, familyCreed: kind === "standing" && current2.familyCreed }, current2.adherence);
    replace(id, next);
    persist();
  }
  async function refineMany(batch, mine) {
    const results = await sortMany(batch.map((b) => b.text), deps);
    batch.forEach((b, n) => applySorted(b.id, results[n], mine));
  }
  const self = {
    list: () => items,
    live: () => items.filter((i) => isLive(i.state)),
    give(text, source, options = {}) {
      const trimmed = text.trim().slice(0, MAX_TEXT);
      if (trimmed === "") return { ok: false, problem: "Write the instruction first." };
      const same3 = items.find((i) => normal(i.text) === normal(trimmed) && (isLive(i.state) || i.state === "forgotten" && i.kind === "standing"));
      if (same3 !== void 0) {
        const again = replace(same3.id, { memory: 1, seenTurn: lastTurn, state: isLive(same3.state) ? same3.state : "following" });
        persist();
        return { ok: true, instruction: again ?? same3, repeated: true };
      }
      const code = sortByCode(trimmed);
      const kind = options.kind ?? code.kind;
      const viewer = options.viewer?.trim().slice(0, MAX_VIEWER) ?? "";
      counter += 1;
      const id = `i${String(counter)}`;
      if (options.kind !== void 0) explicit.add(id);
      const made = restance({
        id,
        text: trimmed,
        kind,
        source,
        ...viewer === "" ? {} : { viewer },
        sorted: code.sorted,
        state: "following",
        memory: 1,
        adherence: 0.5,
        familyCreed: kind === "standing" && options.familyCreed === true,
        createdTurn: lastTurn,
        seenTurn: lastTurn,
        acted: 0,
        lowReviews: 0,
        disliked: false
      }, null);
      items = [...items, { ...made, disliked: made.state !== "following" }];
      say(`New ${noun(kind)}${viewer === "" ? "" : ` from viewer ${viewer}`}: ${short(trimmed)}`, false);
      persist();
      if (options.deferSort === true) {
        deferred.push(id);
        return { ok: true, instruction: items.find((i) => i.id === id), repeated: false };
      }
      chain((mine) => refine(id, trimmed, mine));
      chain((mine) => prune(mine));
      return { ok: true, instruction: items.find((i) => i.id === id), repeated: false };
    },
    flush() {
      const ids = deferred;
      deferred = [];
      const batch = ids.map((id) => items.find((i) => i.id === id)).filter((i) => i !== void 0 && isLive(i.state)).map((i) => ({ id: i.id, text: i.text }));
      if (batch.length > 0) chain((mine) => refineMany(batch, mine));
      if (ids.length > 0) chain((mine) => prune(mine, false));
    },
    retire(id) {
      const i = items.find((x) => x.id === id);
      if (i === void 0 || !isLive(i.state)) return false;
      finish(i, i.kind === "order" ? "abandoned" : "done", i.kind === "order" ? "Order withdrawn:" : "Standing instruction retired:");
      return true;
    },
    correct(id, patch) {
      const i = items.find((x) => x.id === id);
      if (i === void 0) return false;
      corrected.add(id);
      const kind = patch.kind ?? i.kind;
      const next = restance({
        ...i,
        kind,
        sorted: { ...i.sorted, ...patch.sorted },
        familyCreed: kind === "standing" && (patch.familyCreed ?? i.familyCreed)
      }, i.adherence);
      replace(id, next);
      persist();
      return true;
    },
    creeds: () => items.filter((i) => i.kind === "standing" && i.familyCreed && isLive(i.state)),
    adopt(creeds, turn) {
      for (const c of creeds) {
        if (items.some((i) => normal(i.text) === normal(c.text))) continue;
        counter += 1;
        items = [...items, { ...c, id: `i${String(counter)}`, kind: "standing", familyCreed: true, source: "creed", state: "following", createdTurn: turn, seenTurn: turn, acted: 0, lowReviews: 0 }];
      }
      items = items.map((i) => isLive(i.state) ? restance(i, null) : i);
      persist();
    },
    observe(view) {
      const p = view.player();
      if (p.dead) return;
      const turn = view.turn();
      if (turn < lastTurn) review = null;
      const levelMoved = p.depth !== lastDepth ? 1 : 0;
      if (levelMoved === 1) arrived = true;
      const persona_ = persona();
      for (const i of items) {
        if (isLive(i.state)) {
          const memory = fade(i.memory, Math.max(0, turn - i.seenTurn), levelMoved, persona_);
          if (memory !== i.memory || i.seenTurn !== turn) {
            const next = replace(i.id, { memory, seenTurn: turn });
            if (next !== void 0 && isForgotten(memory)) finish(next, "forgotten", "");
          }
        } else if (i.state === "forgotten" && i.kind === "standing") {
          const on = triggerActive(i, view);
          if (!on) rolled.delete(i.id);
          else if (!rolled.has(i.id)) {
            rolled.add(i.id);
            if (comesBack(persona_, rng())) {
              replace(i.id, { state: "following", memory: REMEMBERED_AT, seenTurn: turn });
              const back = restance(items.find((x) => x.id === i.id), null);
              replace(i.id, back);
              say(`Remembered: ${short(i.text)}`, false);
            }
          }
        }
      }
      lastTurn = turn;
      lastDepth = p.depth;
      const due = reviewDue(review, { depth: p.depth, level: p.level, turn });
      review = { depth: p.depth, level: p.level, reviewTurn: due === null ? review?.reviewTurn ?? turn : turn };
      if (due !== null) reviewNow(view);
    },
    decided(goal, view) {
      const ids = applicable(view).filter((i) => goalsOf(i.sorted).serves.includes(goal)).map((i) => i.id);
      arrived = false;
      pending = ids.length === 0 ? null : { goal, ids };
    },
    carried(goal, view) {
      const now = pending;
      if (now === null || now.goal !== goal) return;
      pending = null;
      const turn = view.turn();
      for (const id of now.ids) {
        const i = items.find((x) => x.id === id);
        if (i === void 0 || !isLive(i.state)) continue;
        const updated = replace(i.id, { acted: i.acted + 1, memory: refreshed(i.memory, false) });
        const last = notedAt.get(i.id);
        if (updated !== void 0 && (last === void 0 || turn - last >= NOTE_GAP)) {
          notedAt.set(i.id, turn);
          say(`Acted on the ${noun(i.kind)} (${goal.replace(/_/g, " ")}): ${short(i.text)}`, i.acted === 0);
        }
        if (updated !== void 0 && i.sorted.frequency.mode === "once") finish(updated, "done", "Did as told, once:");
      }
    },
    revision(view) {
      const now = applicable(view).map((i) => `${i.id}:${i.state}:${String(Math.round(i.adherence * 20))}:${String(Math.round(i.memory * 10))}`);
      return `${String(changes)}|${now.join(",")}`;
    },
    note(view, gold, offers) {
      noteRound += 1;
      const now = rotate(view, SHOWN, shownAt, noteRound, offers);
      if (now.length === 0) return null;
      const p = persona();
      const lines2 = now.map((i) => {
        const faint = i.memory < 0.35 ? " You only faintly remember it." : "";
        return `${said(i)} ${STANCE_WORDS[i.state] ?? ""}${faint}${routeHint(i, p, gold ?? view.player().gold)}`;
      });
      return lines2.join(" ");
    },
    ask(offers, view) {
      const out = {};
      asked = [];
      if (offers.length === 0) return out;
      askRound += 1;
      const now = rotate(view, ASKED, askedAt, askRound, offers);
      const criteria = {};
      for (const o of offers) criteria[o.goal] = o.criteria;
      criteria[NONE] = "None of these carries it out.";
      for (const i of now) {
        asked.push(i.id);
        const told = i.source === "channel" ? said(i) : `The patron told the squire: "${i.text}".`;
        out[`order_${i.id}`] = { type: "choice", instructions: `${told} Which option best carries that out?`, criteria: { ...criteria } };
      }
      return out;
    },
    weigh(dist, answers, view, offers) {
      let out = { ...dist };
      for (const i of applicable(view)) {
        const serves = /* @__PURE__ */ new Set();
        const answer = asked.includes(i.id) ? answers[`order_${i.id}`] : void 0;
        if (answer?.type === "choice" && answer.choice !== NONE && (answer.probabilities[answer.choice] ?? 0) >= 0.4) serves.add(answer.choice);
        out = weigh(out, withBans(i, view, offers), serves);
      }
      return out;
    },
    passes(view) {
      const out = /* @__PURE__ */ new Set();
      for (const i of applicable(view)) {
        if (i.kind !== "order" || i.state === "ignoring" || i.adherence < PASS_ADHERENCE || i.memory < 0.5) continue;
        for (const goal of goalsOf(i.sorted).serves) out.add(goal);
      }
      return out;
    },
    promote(aims) {
      const named3 = /* @__PURE__ */ new Set();
      for (const i of items) if (isLive(i.state) && i.kind === "order" && i.sorted.aim !== null && i.state !== "ignoring") named3.add(i.sorted.aim);
      if (named3.size === 0) return aims;
      return [...aims.filter((a) => named3.has(a.kind)), ...aims.filter((a) => !named3.has(a.kind))];
    },
    state: () => ({ items }),
    load(state) {
      items = [...state.items];
      changes += 1;
      counter = items.reduce((n, i) => Math.max(n, Number(/^i(\d+)$/.exec(i.id)?.[1] ?? 0)), 0);
    },
    reset() {
      items = [];
      counter = 0;
      review = null;
      arrived = false;
      generation += 1;
      corrected.clear();
      explicit.clear();
      rolled.clear();
      notedAt.clear();
      asked = [];
      shownAt.clear();
      askedAt.clear();
      noteRound = 0;
      askRound = 0;
      pending = null;
      deferred = [];
      changes += 1;
      inFlight = Promise.resolve();
    },
    settled: () => inFlight
  };
  return self;
}
function routeHint(i, p, gold) {
  const s = i.sorted;
  if (i.kind !== "order" || s.aim === null || !["armour", "weapon", "item", "spellbook", "lantern"].includes(s.aim)) return "";
  const store = s.store ?? (s.aim === "armour" ? "Armoury" : s.aim === "weapon" ? "Weapon Smiths" : "store");
  const thrifty = p.sliders.pricesense >= 65 || p.sliders.savings >= 65 || gold < 100;
  const parts = [];
  if (thrifty) parts.push("You would look in the dungeon first and buy only what it does not turn up.");
  else if (p.sliders.patience <= 35 || gold >= 500) parts.push(`You would go to the ${store} and buy.`);
  if (p.sliders.curiosity >= 70) parts.push("You would try unknown pieces found on the way.");
  if (p.sliders.pride >= 70 || p.sliders.ambition >= 70) parts.push("You want the best you can afford.");
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

// src/orders/channel.ts
var CHANNEL_POLL_MS = 5e3;
var CHANNEL_RETRY_MS = 3e4;
var CHANNEL_MAX_TEXT = 300;
var MAX_PER_REPLY = 50;
var MAX_PAGES = 10;
var TIMEOUT_MS = 4e3;
function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}
function readChannelReply(body2) {
  let parsed;
  try {
    parsed = JSON.parse(body2);
  } catch {
    return null;
  }
  let list = parsed;
  let more = false;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const r = parsed;
    list = r["orders"];
    more = r["more"] === true;
  }
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list.slice(0, MAX_PER_REPLY)) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw;
    const text = clean(r["text"], CHANNEL_MAX_TEXT);
    if (text === "") continue;
    out.push({ text, viewer: clean(r["user"], MAX_VIEWER), platform: clean(r["platform"], 20) });
  }
  return { orders: out, more };
}
function createChannelPoller(deps) {
  let dueAt = 0;
  let inFlight = null;
  let generation = 0;
  let failing = false;
  function failed(url, problem) {
    dueAt = deps.now() + CHANNEL_RETRY_MS;
    if (failing) return;
    failing = true;
    deps.log(`Squire couldn't collect viewer orders from ${url}: ${problem}. It will try again in ${String(CHANNEL_RETRY_MS / 1e3)} seconds.`);
  }
  async function collect(net, url, mine) {
    const stale = () => mine !== generation || deps.url().trim() !== url;
    const orders = [];
    let more = true;
    for (let page = 0; more && page < MAX_PAGES; page += 1) {
      const reply = await net.request({ url, method: "GET", timeoutMs: TIMEOUT_MS });
      if (stale()) return;
      if (!reply.ok) {
        failed(url, reply.problem);
        break;
      }
      if (reply.status !== 200) {
        failed(url, `HTTP ${String(reply.status)}`);
        break;
      }
      const read = readChannelReply(reply.body);
      if (read === null) {
        failed(url, "the reply is not a list of orders");
        break;
      }
      if (failing) deps.log("Squire is collecting viewer orders again.");
      failing = false;
      orders.push(...read.orders);
      more = read.more;
    }
    if (more && !failing) dueAt = deps.now();
    for (const order of orders) deps.queue(order);
    if (orders.length > 0) deps.flush?.();
  }
  return {
    tick() {
      const url = deps.url().trim();
      if (url === "" || inFlight !== null || deps.now() < dueAt) return;
      const net = deps.net();
      if (net === null) return;
      dueAt = deps.now() + CHANNEL_POLL_MS;
      inFlight = collect(net, url, generation).catch((error) => failed(url, error instanceof Error ? error.message : String(error))).finally(() => {
        inFlight = null;
      });
    },
    reset() {
      generation += 1;
      dueAt = 0;
    },
    settled: () => inFlight ?? Promise.resolve()
  };
}

// src/orders/input.ts
function queueInstruction(orders, text, source, options) {
  if (!SOURCES.includes(source)) return { ok: false, problem: "Instructions can only come from the panel, the hotkey, a creed file or a channel." };
  if (typeof text !== "string") return { ok: false, problem: "Write the instruction first." };
  return orders.give(text, source, options);
}

// src/orders/read.ts
var BAN_VERBS = ["read", "quaff", "use", "zap", "aim"];
var STATES = ["following", "grudgingly", "ignoring", "forgotten", "done", "abandoned"];
var AIMS = ["spellbook", "lantern", "armour", "weapon", "free-action", "see-invisible", "depth", "item", "gold"];
var TRIGGERS2 = ["always", "unique", "low-hp", "new-level", "in-store"];
var RESPONSES2 = ["flee", "fight", "leave-level", "descend", "buy", "rest", "avoid"];
var MAX_STORED = 60;
function rec(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function num3(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function oneOf(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function optional(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}
function readSorted(value) {
  const r = rec(value) ?? {};
  const f = rec(r["frequency"]) ?? {};
  const mode = oneOf(f["mode"], ["always", "once", "until-level"], "always");
  const frequency = mode === "until-level" ? { mode, level: Math.round(num3(f["level"], 1, 50, 50)) } : { mode };
  const aim = typeof r["aim"] === "string" && AIMS.includes(r["aim"]) ? r["aim"] : null;
  const response = typeof r["response"] === "string" && RESPONSES2.includes(r["response"]) ? r["response"] : null;
  return {
    aim,
    trigger: oneOf(r["trigger"], TRIGGERS2, "always"),
    response,
    avoids: Array.isArray(r["avoids"]) ? r["avoids"].filter((v) => typeof v === "string").slice(0, 8).map((v) => v.slice(0, 30)) : [],
    store: typeof r["store"] === "string" ? r["store"].slice(0, 40) : null,
    depth: optional(r["depth"], 1, 127),
    deadlineLevel: optional(r["deadlineLevel"], 1, 50),
    item: typeof r["item"] === "string" ? r["item"].slice(0, 80) : null,
    count: Math.round(num3(r["count"], 1, 99, 1)),
    gold: optional(r["gold"], 0, 1e8),
    frequency,
    ...readHpBelow(r["hpBelow"]),
    ...readBansField(r["bans"])
  };
}
function readHpBelow(value) {
  const r = rec(value);
  if (r === null || typeof r["value"] !== "number" || !Number.isFinite(r["value"])) return {};
  if (r["kind"] === "hp") return { hpBelow: { kind: "hp", value: Math.round(num3(r["value"], 1, 1e5, 1)) } };
  if (r["kind"] === "share") return { hpBelow: { kind: "share", value: num3(r["value"], 0.01, 1, 0.5) } };
  return {};
}
function readBansField(value) {
  if (!Array.isArray(value)) return {};
  const bans = [];
  for (const raw of value.slice(0, 8)) {
    const r = rec(raw);
    if (r === null) continue;
    bans.push({
      verb: oneOf(r["verb"], BAN_VERBS, "use"),
      item: typeof r["item"] === "string" && r["item"].trim() !== "" ? r["item"].trim().slice(0, 40) : null,
      when: oneOf(r["when"], ["always", "fight"], "always")
    });
  }
  return bans.length === 0 ? {} : { bans };
}
function readInstruction(value) {
  const r = rec(value);
  if (r === null || typeof r["text"] !== "string" || r["text"].trim() === "" || typeof r["id"] !== "string") return null;
  const kind = oneOf(r["kind"], ["order", "standing"], "order");
  return {
    id: r["id"].slice(0, 20),
    text: r["text"].slice(0, MAX_TEXT),
    kind,
    source: oneOf(r["source"], SOURCES, "panel"),
    ...typeof r["viewer"] === "string" && r["viewer"].trim() !== "" ? { viewer: r["viewer"].trim().slice(0, MAX_VIEWER) } : {},
    sorted: readSorted(r["sorted"]),
    state: oneOf(r["state"], STATES, "following"),
    memory: num3(r["memory"], 0, 1, 1),
    adherence: num3(r["adherence"], 0, 1, 0.5),
    familyCreed: kind === "standing" && r["familyCreed"] === true,
    createdTurn: num3(r["createdTurn"], 0, Number.MAX_SAFE_INTEGER, 0),
    seenTurn: num3(r["seenTurn"], 0, Number.MAX_SAFE_INTEGER, 0),
    acted: Math.round(num3(r["acted"], 0, 1e6, 0)),
    lowReviews: Math.round(num3(r["lowReviews"], 0, 1e3, 0)),
    disliked: r["disliked"] === true
  };
}
function readInstructions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value.slice(-MAX_STORED)) {
    const one = readInstruction(raw);
    if (one !== null) out.push(one);
  }
  return out;
}

// src/telemetry/sender.ts
var DEFAULT_ENDPOINT = "https://squire.rpgm.tools";
var QUEUE = "squire/telemetry/queue/";
var BACKOFF = [1e3, 4e3, 15e3, 6e4];
var queues = /* @__PURE__ */ new WeakMap();
function cancellation() {
  let cancel = () => {
  };
  const cancelled = new Promise((resolve) => {
    cancel = resolve;
  });
  return { cancelled, cancel };
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function body(text) {
  try {
    return object(JSON.parse(text));
  } catch {
    return null;
  }
}
function header(headers, name) {
  return Object.entries(headers).find(([key2]) => key2.toLowerCase() === name)?.[1];
}
function retryAfter2(headers, now) {
  const value = header(headers, "retry-after");
  if (value === void 0) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1e3;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : void 0;
}
function createSender(options) {
  const { net, store, endpoint, now, log } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let queue = queues.get(store);
  if (queue === void 0) {
    queue = { generation: 0, pending: Promise.resolve(), ...cancellation() };
    queues.set(store, queue);
  }
  const uploads = queue;
  const generations = /* @__PURE__ */ new Map();
  let lastStamp = 0;
  let stampOrder = 0;
  function exclusive(operation) {
    const result = uploads.pending.then(operation);
    uploads.pending = result.then(() => {
    }, () => {
    });
    return result;
  }
  function deleted() {
    return { ok: false, queued: false, reason: "Deletion removed this batch from the upload queue." };
  }
  async function request2(method, path, payload) {
    return net.request({
      url: `${endpoint.replace(/\/$/, "")}${path}`,
      method,
      headers: { "Content-Type": "application/json" },
      ...payload === void 0 ? {} : { body: payload },
      timeoutMs: 15e3
    });
  }
  async function post(batch, generation) {
    const cancelled = uploads.cancelled;
    const pause = (ms) => Promise.race([sleep(ms), cancelled]);
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
      if (generation !== uploads.generation) return deleted();
      try {
        const reply = await request2("POST", "/v1/batches", JSON.stringify(batch));
        if (reply.ok) {
          const parsed = body(reply.body);
          if ((reply.status === 202 || reply.status === 200) && parsed?.["ok"] === true) {
            const chronicle = object(parsed["chronicle"]);
            return {
              ok: true,
              ...reply.status === 200 && parsed["duplicate"] === true ? { duplicate: true } : {},
              ...chronicle === null ? {} : { chronicle }
            };
          }
          if (reply.status === 400 || reply.status === 413) {
            const field = typeof parsed?.["field"] === "string" ? parsed["field"] : "batch";
            const reason = typeof parsed?.["error"] === "string" ? parsed["error"] : `HTTP ${String(reply.status)}`;
            log(`Telemetry batch was refused at ${field}: ${reason} Check the telemetry data before sending again.`);
            return { ok: false, queued: false, reason, field };
          }
          if (reply.status !== 429 && reply.status < 500) {
            return { ok: false, queued: true, reason: `Telemetry returned HTTP ${String(reply.status)}. Check the endpoint and try again.` };
          }
          if (attempt < BACKOFF.length) {
            await pause(reply.status === 429 ? retryAfter2(reply.headers, now()) ?? BACKOFF[attempt] : BACKOFF[attempt]);
            continue;
          }
        } else if (attempt < BACKOFF.length) {
          await pause(BACKOFF[attempt]);
          continue;
        }
      } catch {
        if (attempt < BACKOFF.length) {
          try {
            await pause(BACKOFF[attempt]);
          } catch {
            break;
          }
          continue;
        }
      }
      break;
    }
    return { ok: false, queued: true, reason: "Telemetry could not be sent. It remains queued for another try." };
  }
  async function drainOnce(generation) {
    const results = /* @__PURE__ */ new Map();
    if (!endpoint) return results;
    try {
      for (const key2 of (await store.keys(QUEUE)).sort()) {
        if (generation !== uploads.generation) break;
        const batch = await store.get(key2);
        if (object(batch) === null) {
          await store.delete(key2);
          continue;
        }
        const result = await post(batch, generation);
        results.set(key2, result);
        if (result.ok || !result.queued) await store.delete(key2);
        else break;
      }
    } catch {
      log("Telemetry queue could not be read. Try sending again later.");
    }
    return results;
  }
  return {
    async send(batch) {
      if (!endpoint) return { ok: false, queued: false, reason: "Telemetry is disabled. Set an endpoint to send batches." };
      const recording = `${batch.run_id}/${batch.sent_at}`;
      const generation = generations.get(recording) ?? uploads.generation;
      generations.set(recording, generation);
      return exclusive(async () => {
        if (generation !== uploads.generation) return deleted();
        try {
          const stamp = Math.max(now(), lastStamp);
          stampOrder = stamp === lastStamp ? stampOrder + 1 : 0;
          lastStamp = stamp;
          const key2 = `${QUEUE}${String(stamp).padStart(16, "0")}-${String(stampOrder).padStart(8, "0")}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
          await store.set(key2, batch);
          const results = await drainOnce(generation);
          if (generation !== uploads.generation) return deleted();
          return results.get(key2) ?? { ok: false, queued: true, reason: "Telemetry is queued behind an earlier batch. Try again later." };
        } catch {
          return { ok: false, queued: false, reason: "Telemetry could not be saved. Check local storage and try again." };
        }
      });
    },
    async drain() {
      const generation = uploads.generation;
      await exclusive(async () => {
        if (generation === uploads.generation) await drainOnce(generation);
      });
    },
    async status(installId2) {
      if (!endpoint) return { ok: false, reason: "Telemetry is disabled. Set an endpoint to check status." };
      try {
        const reply = await request2("GET", `/v1/installs/${encodeURIComponent(installId2)}`);
        if (!reply.ok) return { ok: false, reason: reply.problem };
        const parsed = body(reply.body);
        return reply.status === 200 && parsed?.["ok"] === true ? { ok: true, data: parsed } : { ok: false, reason: String(parsed?.["error"] ?? `HTTP ${String(reply.status)}`), ...typeof parsed?.["field"] === "string" ? { field: parsed["field"] } : {} };
      } catch {
        return { ok: false, reason: "Telemetry status could not be loaded. Try again later." };
      }
    },
    async deleteInstall(installId2) {
      uploads.generation++;
      uploads.cancel();
      Object.assign(uploads, cancellation());
      return exclusive(async () => {
        try {
          for (const key2 of await store.keys(QUEUE)) await store.delete(key2);
          if (!endpoint) return { ok: false, reason: "Telemetry is disabled. Set an endpoint to delete an install." };
          const reply = await request2("DELETE", `/v1/installs/${encodeURIComponent(installId2)}`);
          if (!reply.ok) return { ok: false, reason: reply.problem };
          const parsed = body(reply.body);
          return reply.status === 200 && parsed?.["ok"] === true ? { ok: true, data: parsed } : { ok: false, reason: String(parsed?.["error"] ?? `HTTP ${String(reply.status)}`), ...typeof parsed?.["field"] === "string" ? { field: parsed["field"] } : {} };
        } catch {
          return { ok: false, reason: "Telemetry could not be deleted. Try again later." };
        }
      });
    }
  };
}

// src/learning/flourishes.ts
function share2(inheritance) {
  return Number.isFinite(inheritance) ? Math.max(0, Math.min(1, inheritance / 100)) : 0;
}
function familyVoice(persona, fact, kind = "memory") {
  const line = `${persona.name}: ${fact}`;
  if (persona.sliders.chronicle < 50) return line;
  if (persona.quirks.cowardice.on || persona.sliders.boldness <= 35) return `${line} ${kind === "death" ? "I should have turned back." : "I hope I get home."}`;
  if (persona.sliders.pride >= 70 || persona.sliders.boldness >= 65) return `${line} ${kind === "death" ? "I meant to go deeper." : "I mean to go deeper."}`;
  return line;
}
function namesakeLog(persona, ancestor) {
  if (persona.sliders.chronicle >= 50) {
    if (persona.quirks.cowardice.on || persona.sliders.boldness <= 35) return `${persona.name}: I hope I outlive ${ancestor}, whose name I bear.`;
    if (persona.sliders.pride >= 70 || persona.sliders.boldness >= 65) return `${persona.name}: I took ${ancestor}'s name. I will go deeper than ${ancestor}.`;
  }
  return `${persona.name}: I bear ${ancestor}'s name.`;
}
function epitaphFor(persona, death) {
  if (!persona.toggles.epitaphs) return null;
  const cause = death.cause.replace(/^killed by\s+/i, "");
  const action = goalLabel(death.action);
  const during = action === void 0 ? "with my last choice unrecorded" : `while choosing to ${action}`;
  const where = death.depth === 0 ? "in town" : `at ${String(death.depth * 50)} ft`;
  const fact = `I died to ${cause} ${where}, level ${String(death.level)}, ${during}.`;
  return { name: death.name, generation: death.generation, line: familyVoice({ ...persona, name: death.name }, fact, "death") };
}
function inheritFlourishes(lineage, parent, heir) {
  const epitaphs = lineage.epitaphs ?? [];
  const milestones = lineage.milestones ?? [];
  const amount = share2(parent.sliders.inheritance);
  const epitaphCount = parent.toggles.epitaphs && heir.toggles.epitaphs ? Math.ceil(3 * amount) : 0;
  const milestoneCount = parent.toggles.milestones && heir.toggles.milestones ? Math.ceil(12 * amount) : 0;
  return {
    epitaphs,
    milestones,
    inheritedEpitaphs: epitaphCount === 0 ? [] : epitaphs.slice(-epitaphCount),
    inheritedMilestones: milestoneCount === 0 ? [] : milestones.slice(-milestoneCount),
    mentionedMilestones: []
  };
}
function milestoneId(milestone) {
  return `${milestone.kind}:${String(milestone.generation)}:${String(milestone.depth)}:${milestone.fact.toLowerCase()}`;
}
function addMilestone(lineage, persona, kind, depth2, fact) {
  if (!persona.toggles.milestones) return null;
  const records = lineage.milestones ?? [];
  if (kind === "depth" ? depth2 <= Math.max(0, lineage.deepest ?? 0, ...lineage.ancestors.map((a) => a.deepest ?? a.died?.depth ?? 0), ...records.filter((m) => m.kind === "depth").map((m) => m.depth)) : records.some((m) => m.kind === kind && (kind === "artifact" || m.fact.toLowerCase() === fact.toLowerCase()))) return null;
  return { kind, depth: depth2, fact, name: lineage.name, generation: lineage.generation };
}
function milestoneFact(milestone) {
  if (milestone.kind === "depth") return `${milestone.name} reached ${String(milestone.depth * 50)} ft.`;
  if (milestone.kind === "unique") return `${milestone.name} was the first of the family to slay ${milestone.fact}.`;
  return `${milestone.name} found the family's first artifact: ${milestone.fact}.`;
}
function recallMilestones(lineage, persona, depth2, uniques) {
  if (!persona.toggles.milestones) return [];
  return (lineage.inheritedMilestones ?? []).filter((m) => !(lineage.mentionedMilestones ?? []).includes(milestoneId(m)) && (m.kind === "depth" ? depth2 >= m.depth : m.kind === "unique" && uniques.some((name) => name.toLowerCase() === m.fact.toLowerCase())));
}
var ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
function rootName(name) {
  const match = /^(.*) the (First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|\d+(?:st|nd|rd|th))$/.exec(name);
  if (match === null) return { root: name, number: 1 };
  const word = ORDINALS.indexOf(match[2]);
  return { root: match[1], number: word < 0 ? Number.parseInt(match[2], 10) : word + 1 };
}
function ordinal(number2) {
  const word = ORDINALS[number2 - 1];
  if (word !== void 0) return word;
  const suffix = number2 % 100 >= 11 && number2 % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[number2 % 10] ?? "th";
  return `${String(number2)}${suffix}`;
}
function namesakeFor(lineage, parent, heir, rng) {
  if (lineage === void 0 || !parent.toggles.namesakes || !heir.toggles.namesakes || share2(parent.sliders.inheritance) === 0) return null;
  const candidates = [...lineage.ancestors, { name: lineage.name, race: lineage.race ?? "unknown", cls: lineage.cls ?? "unknown", generation: lineage.generation, died: lineage.died ?? null, ...lineage.deepest === void 0 ? {} : { deepest: lineage.deepest }, ...lineage.turns === void 0 ? {} : { turns: lineage.turns } }];
  const named3 = candidates.filter((a) => a.name.trim() !== "");
  if (named3.length === 0) return null;
  const weight = (a) => 1 + Math.min(4, (a.deepest ?? a.died?.depth ?? 0) / 10) + Math.min(4, (a.turns ?? a.died?.turn ?? 0) / 1e4);
  const total = named3.reduce((sum, a) => sum + weight(a), 0);
  const draw = rng();
  let ticket = (Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 1) * total;
  const ancestor = named3.find((a) => (ticket -= weight(a)) < 0) ?? named3[named3.length - 1];
  const chance = share2(parent.sliders.inheritance) * Math.min(0.8, 0.15 + (weight(ancestor) - 1) * 0.08);
  const roll = rng();
  if (!Number.isFinite(roll) || roll >= chance) return null;
  const root = rootName(ancestor.name).root;
  const next = 1 + Math.max(...named3.filter((a) => rootName(a.name).root === root).map((a) => rootName(a.name).number));
  return { name: `${root} the ${ordinal(next)}`, ancestor: ancestor.name };
}
function readFlourishes(value) {
  const number2 = (v) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  const entries = (v) => Array.isArray(v) ? v.slice(-100).filter((r) => r !== null && typeof r === "object" && !Array.isArray(r)) : [];
  const epitaphs = (v) => entries(v).flatMap((r) => typeof r["name"] === "string" && typeof r["line"] === "string" ? [{ name: r["name"].slice(0, 100), line: r["line"].slice(0, 500), generation: number2(r["generation"]) }] : []).slice(-12);
  const milestones = (v) => entries(v).flatMap((r) => (r["kind"] === "depth" || r["kind"] === "unique" || r["kind"] === "artifact") && typeof r["name"] === "string" && typeof r["fact"] === "string" ? [{ kind: r["kind"], name: r["name"].slice(0, 100), fact: r["fact"].slice(0, 160), generation: number2(r["generation"]), depth: number2(r["depth"]) }] : []);
  return {
    epitaphs: epitaphs(value["epitaphs"]),
    milestones: milestones(value["milestones"]),
    inheritedEpitaphs: epitaphs(value["inheritedEpitaphs"]).slice(-3),
    inheritedMilestones: milestones(value["inheritedMilestones"]).slice(-12),
    mentionedMilestones: Array.isArray(value["mentionedMilestones"]) ? value["mentionedMilestones"].filter((v) => typeof v === "string").slice(-12) : [],
    deepest: number2(value["deepest"]),
    turns: number2(value["turns"])
  };
}

// src/config.ts
var CONFIG_FORMAT = "neo-angband/squire/prefs";
var CONFIG_SCHEMA = 1;
var DEFAULT_INSTRUCTIONS_KEPT = 8;
var MIN_INSTRUCTIONS_KEPT = 1;
var MAX_INSTRUCTIONS_KEPT = 50;
var LAYA_DEFAULT_URL = "http://localhost:8010/v1/systemone";
function defaultConfig() {
  return {
    backend: "jev",
    serverUrl: LAYA_DEFAULT_URL,
    serverFallbacks: [],
    serverModel: "",
    layaShadow: { enabled: false, url: LAYA_DEFAULT_URL, fallbacks: [] },
    contextTokens: 4096,
    caps: { perSessionUsd: 0, perDayUsd: 0 },
    telemetry: { level: "off", backstoryConsent: false, endpoint: DEFAULT_ENDPOINT, asked: false },
    personas: [defaultPersona("Squire")],
    activePersona: 0,
    rollOn: "wait",
    knightsLessons: { enabled: true, ghost: false },
    setupDone: false,
    spend: { day: "", usd: 0 },
    instructionsKept: DEFAULT_INSTRUCTIONS_KEPT,
    channelUrl: "",
    lineages: {},
    pendingHeir: null
  };
}
function lineagesOf(value) {
  const out = {};
  const r = rec2(value);
  if (r === null) return out;
  for (const [name, raw] of Object.entries(r).slice(0, 30)) {
    const l = rec2(raw);
    if (l === null || typeof l["name"] !== "string" || typeof l["generation"] !== "number") continue;
    out[name] = {
      name: l["name"],
      generation: l["generation"],
      ancestors: readAncestors(l["ancestors"]),
      lore: Array.isArray(l["lore"]) ? l["lore"].slice(-60) : [],
      grudges: Array.isArray(l["grudges"]) ? l["grudges"].slice(-30) : [],
      creeds: readInstructions(l["creeds"]).filter((i) => i.kind === "standing" && i.familyCreed),
      aims: readAims(l["aims"]),
      killers: readKillers(l["killers"]),
      feelings: readFeelings(l["feelings"]),
      ...readFlourishes(l),
      ...typeof l["race"] === "string" ? { race: l["race"] } : {},
      ...typeof l["cls"] === "string" ? { cls: l["cls"] } : {},
      ...rec2(l["died"]) === null ? {} : { died: readDeath(l["died"]) },
      flourishRecord: readFamilyFlourishes(l["flourishRecord"]),
      flourishes: readWays(l["flourishes"])
    };
  }
  return out;
}
function readDeath(value) {
  const death = rec2(value);
  if (death === null || typeof death["cause"] !== "string") return null;
  return { cause: death["cause"].slice(0, 160), depth: Math.round(numberIn(death["depth"], 0, 127, 0)), turn: Math.round(numberIn(death["turn"], 0, Number.MAX_SAFE_INTEGER, 0)) };
}
function readAncestors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-50).flatMap((raw) => {
    const ancestor = rec2(raw);
    if (ancestor === null || typeof ancestor["name"] !== "string") return [];
    return [{
      name: ancestor["name"].slice(0, 100),
      race: str(ancestor["race"], "unknown", 80),
      cls: str(ancestor["cls"], "unknown", 80),
      generation: Math.round(numberIn(ancestor["generation"], 1, Number.MAX_SAFE_INTEGER, 1)),
      died: readDeath(ancestor["died"]),
      ...typeof ancestor["deepest"] === "number" ? { deepest: numberIn(ancestor["deepest"], 0, 127, 0) } : {},
      ...typeof ancestor["turns"] === "number" ? { turns: numberIn(ancestor["turns"], 0, Number.MAX_SAFE_INTEGER, 0) } : {}
    }];
  });
}
function readAims(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).flatMap((raw) => {
    const a = rec2(raw);
    if (a === null) return [];
    if (a["kind"] === "weapon") return [{ kind: "weapon", depth: null }];
    return a["kind"] === "depth" && typeof a["depth"] === "number" && Number.isFinite(a["depth"]) ? [{ kind: "depth", depth: Math.max(1, Math.min(127, Math.round(a["depth"]))) }] : [];
  });
}
function rec2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function pickOf(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function numberIn(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function str(value, fallback, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function addresses(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string").map((v) => v.trim()).filter((v) => v !== "" && v.length <= 300).slice(0, 8);
}
function parseAddresses(text) {
  return addresses(text.split(/[\s,]+/));
}
function readConfig(stored) {
  const base = defaultConfig();
  const envelope = rec2(stored);
  if (envelope === null || envelope["format"] !== CONFIG_FORMAT) return base;
  const data = rec2(envelope["data"]);
  if (data === null) return base;
  const caps = rec2(data["caps"]) ?? {};
  const telemetry = rec2(data["telemetry"]) ?? {};
  const knights = rec2(data["knightsLessons"]) ?? {};
  const spend = rec2(data["spend"]) ?? {};
  const layaShadow = rec2(data["layaShadow"]) ?? {};
  const personas = Array.isArray(data["personas"]) ? data["personas"].slice(0, 50).map((p) => normalize(p)) : base.personas;
  return {
    backend: pickOf(data["backend"], ["jev", "laya", "custom", "none"], base.backend),
    serverUrl: str(data["serverUrl"], base.serverUrl),
    serverFallbacks: addresses(data["serverFallbacks"]),
    serverModel: str(data["serverModel"], base.serverModel, 100),
    layaShadow: { enabled: bool(layaShadow["enabled"], false), url: str(layaShadow["url"], LAYA_DEFAULT_URL), fallbacks: addresses(layaShadow["fallbacks"]) },
    contextTokens: numberIn(data["contextTokens"], 512, 2e5, base.contextTokens),
    caps: {
      perSessionUsd: numberIn(caps["perSessionUsd"], 0, 1e3, 0),
      perDayUsd: numberIn(caps["perDayUsd"], 0, 1e3, 0)
    },
    telemetry: {
      level: pickOf(telemetry["level"], ["off", "summary", "decisions", "full"], "off"),
      backstoryConsent: bool(telemetry["backstoryConsent"], false),
      endpoint: str(telemetry["endpoint"], base.telemetry.endpoint),
      asked: bool(telemetry["asked"], false)
    },
    personas: personas.length > 0 ? personas : base.personas,
    activePersona: Math.round(numberIn(data["activePersona"], -1, Math.max(0, personas.length - 1), 0)),
    rollOn: pickOf(data["rollOn"], ["wait", "random", "like"], "wait"),
    knightsLessons: { enabled: bool(knights["enabled"], true), ghost: bool(knights["ghost"], false) },
    setupDone: bool(data["setupDone"], false),
    spend: { day: str(spend["day"], "", 10), usd: numberIn(spend["usd"], 0, 1e6, 0) },
    instructionsKept: Math.round(numberIn(data["instructionsKept"], MIN_INSTRUCTIONS_KEPT, MAX_INSTRUCTIONS_KEPT, DEFAULT_INSTRUCTIONS_KEPT)),
    channelUrl: str(data["channelUrl"], "", 300).trim(),
    lineages: lineagesOf(data["lineages"]),
    pendingHeir: (() => {
      const heir = rec2(data["pendingHeir"]);
      return heir !== null && typeof heir["lineage"] === "string" ? { lineage: heir["lineage"], parent: normalize(heir["parent"]), ...typeof heir["name"] === "string" ? { name: heir["name"].slice(0, 100) } : {} } : null;
    })()
  };
}
function writeConfig(config) {
  return { format: CONFIG_FORMAT, schemaVersion: CONFIG_SCHEMA, data: config };
}
function backendFor(config) {
  switch (config.backend) {
    case "jev":
      return JEV;
    case "laya":
      return selfHosted("laya", "Laya", config.serverUrl, config.serverModel === "" ? void 0 : config.serverModel, config.serverFallbacks);
    case "custom":
      return selfHosted("custom", "your System One server", config.serverUrl, config.serverModel === "" ? void 0 : config.serverModel, config.serverFallbacks);
    case "none":
      return null;
  }
}
function backstoryBudget(config) {
  if (config.backend === "jev") return 2e3;
  return Math.max(0, Math.floor(config.contextTokens * 0.15));
}
function activePersona(config) {
  return config.activePersona < 0 ? null : config.personas[config.activePersona] ?? null;
}

// src/memory/kv.ts
function memoryStore() {
  const values = /* @__PURE__ */ new Map();
  return {
    async get(key2) {
      return values.get(key2);
    },
    async set(key2, value) {
      values.set(key2, value);
    },
    async delete(key2) {
      values.delete(key2);
    },
    async keys(prefix2) {
      return [...values.keys()].filter((key2) => key2.startsWith(prefix2)).sort();
    }
  };
}
function request(operation) {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}
function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function indexedDbStore(dbName) {
  const fallback = memoryStore();
  let disabled = false;
  let opening;
  function database() {
    if (opening !== void 0) return opening;
    const factory = globalThis.indexedDB;
    if (factory === void 0) return Promise.reject(new Error("IndexedDB is unavailable"));
    opening = new Promise((resolve, reject) => {
      const open = factory.open(dbName, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("values")) open.result.createObjectStore("values");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return opening;
  }
  async function run(operation, otherwise) {
    if (disabled) return otherwise();
    try {
      return await operation(await database());
    } catch {
      disabled = true;
      return otherwise();
    }
  }
  return {
    async get(key2) {
      return run(async (db) => {
        const value = await request(db.transaction("values", "readonly").objectStore("values").get(key2));
        if (value !== void 0) await fallback.set(key2, value);
        return value;
      }, () => fallback.get(key2));
    },
    async set(key2, value) {
      await fallback.set(key2, value);
      await run(async (db) => {
        const transaction = db.transaction("values", "readwrite");
        const done = completed(transaction);
        transaction.objectStore("values").put(value, key2);
        await done;
      }, async () => {
      });
    },
    async delete(key2) {
      await fallback.delete(key2);
      await run(async (db) => {
        const transaction = db.transaction("values", "readwrite");
        const done = completed(transaction);
        transaction.objectStore("values").delete(key2);
        await done;
      }, async () => {
      });
    },
    async keys(prefix2) {
      return run(async (db) => {
        const keys = await request(db.transaction("values", "readonly").objectStore("values").getAllKeys());
        return keys.filter((key2) => typeof key2 === "string" && key2.startsWith(prefix2)).sort();
      }, () => fallback.keys(prefix2));
    }
  };
}

// src/memory/log.ts
var CHUNK = 200;
var LIMIT = 2e4;
var PREFIX = "squire/log/";
function prefix(runId) {
  return `${PREFIX}${runId}/`;
}
function chunkKey(runId, index) {
  return `${prefix(runId)}${String(index).padStart(8, "0")}`;
}
function createDecisionLog(store, runId) {
  let entries = [];
  let nextSeq = 0;
  const dirty = /* @__PURE__ */ new Set();
  const removed = /* @__PURE__ */ new Set();
  return {
    append(input) {
      const seq = nextSeq++;
      const id = `${runId}/${String(seq)}`;
      entries.push({ ...input, id, runId, seq, outcome: input.outcome ?? null });
      dirty.add(Math.floor(seq / CHUNK));
      while (entries.length > LIMIT) {
        const index = Math.floor(entries[0].seq / CHUNK);
        entries = entries.filter((entry) => Math.floor(entry.seq / CHUNK) !== index);
        removed.add(index);
        dirty.delete(index);
      }
      return id;
    },
    attachOutcome(id, outcome, result) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      const old = entries[index];
      entries[index] = { ...old, outcome, ...result === void 0 ? {} : { result } };
      dirty.add(Math.floor(old.seq / CHUNK));
    },
    records() {
      return entries.slice();
    },
    async flush() {
      for (const index of [...removed].sort((a, b) => a - b)) {
        await store.delete(chunkKey(runId, index));
        removed.delete(index);
      }
      for (const index of [...dirty].sort((a, b) => a - b)) {
        const chunk = entries.filter((entry) => Math.floor(entry.seq / CHUNK) === index);
        if (chunk.length) await store.set(chunkKey(runId, index), chunk);
        dirty.delete(index);
      }
    },
    exportJsonl() {
      return entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : "");
    },
    async load() {
      const keys = await store.keys(prefix(runId));
      const loaded = [];
      for (const key2 of keys.sort()) {
        const chunk = await store.get(key2);
        if (Array.isArray(chunk)) loaded.push(...chunk);
      }
      entries = loaded.sort((a, b) => a.seq - b.seq).slice(-LIMIT);
      nextSeq = (entries.at(-1)?.seq ?? -1) + 1;
      dirty.clear();
      removed.clear();
      for (const key2 of keys) {
        const index = Number(key2.slice(prefix(runId).length));
        if (Number.isInteger(index) && !entries.some((entry) => Math.floor(entry.seq / CHUNK) === index)) removed.add(index);
      }
    }
  };
}

// src/birth.ts
var ROLL_ON_KEY = "squire/rollOnAt";
var HEIR_KEY = "squire/heirAt";
var ROLL_ON_WINDOW_MS = 12e4;
function sessionMarks() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
function markRollOn(store, now, key2 = ROLL_ON_KEY) {
  try {
    store?.setItem(key2, String(now));
  } catch {
  }
}
function takeRollOn(store, now, key2 = ROLL_ON_KEY) {
  try {
    const raw = store?.getItem(key2) ?? null;
    if (raw === null) return false;
    store?.removeItem(key2);
    const at = Number(raw);
    return Number.isFinite(at) && now - at >= 0 && now - at <= ROLL_ON_WINDOW_MS;
  } catch {
    return false;
  }
}
function rollOnBirth(session, mode, random, log, namesake) {
  const cat = session.catalogue();
  const steps2 = [];
  if (mode === "like" && cat.previous !== null) {
    const previous = cat.previous;
    steps2.push(() => session.usePrevious());
    if (!cat.namePinned && previous.name.trim() !== "") steps2.push(() => {
      const named3 = session.setName(previous.name);
      return named3.ok ? named3 : session.randomName();
    });
  } else {
    const race = cat.races[Math.floor(random() * cat.races.length)];
    const cls = cat.classes[Math.floor(random() * cat.classes.length)];
    if (race === void 0 || cls === void 0) return false;
    steps2.push(() => session.chooseRace(race.name), () => session.chooseClass(cls.name), () => session.roll());
    if (!cat.namePinned) steps2.push(() => session.randomName());
  }
  for (const step of steps2) {
    const result = step();
    if (!result.ok) {
      log(`Squire left the next character to you: ${result.reason ?? "the game refused a step"}`);
      return false;
    }
  }
  if (!cat.namePinned && session.draft().name.trim() === "") {
    const named3 = session.randomName();
    if (!named3.ok) {
      log(`Squire left the next character to you: ${named3.reason ?? "the game refused a name"}`);
      return false;
    }
  }
  if (!cat.namePinned && namesake !== void 0) session.setName(namesake);
  const accepted = session.accept();
  if (!accepted.ok) log(`Squire left the next character to you: ${accepted.reason ?? "the game refused it"}`);
  return accepted.ok;
}
function rollOnPresenter(host, store = sessionMarks(), now = Date.now, random = Math.random) {
  return {
    show(session) {
      if (!takeRollOn(store, now())) return void 0;
      const config = readConfig(host.prefs?.get());
      const mode = config.rollOn;
      if (mode === "wait") return void 0;
      const heir = config.pendingHeir;
      const persona = activePersona(config) ?? defaultPersona();
      const namesake = heir === null || session.catalogue().namePinned ? null : namesakeFor(config.lineages[heir.lineage], heir.parent, persona, random);
      if (!rollOnBirth(session, mode, random, host.log, namesake?.name)) return void 0;
      const name = session.draft().name;
      if (heir !== null) host.prefs?.set?.(writeConfig({ ...config, pendingHeir: { ...heir, name } }));
      if (namesake !== null && name === namesake.name) host.log(namesakeLog({ ...persona, name }, namesake.ancestor));
      markRollOn(store, now(), HEIR_KEY);
      return true;
    }
  };
}

// src/learning/signature.ts
var FAMILIES = [
  [/\bzephyr hound|\bhounds?\b/i, "hound"],
  [/\bdragons?|\bdrakes?\b/i, "dragon"],
  [/\bghosts?|\bwraiths?|\bspectres?|\bspirits?\b/i, "ghost"],
  [/\bzombies?|\bskeletons?|\bundead|\bliches?\b/i, "undead"],
  [/\b(?:jell(?:y|ies)|molds?)\b/i, "jelly"],
  [/\b(?:jackals?|dogs?|wolves?|canines?)\b/i, "dog"],
  [/\bspiders?\b/i, "spider"],
  [/\bsnakes?\b/i, "snake"],
  [/\brats?\b/i, "rat"],
  [/\bworms?\b/i, "worm"],
  [/\bbats?\b/i, "bat"],
  [/\bbirds?\b/i, "bird"],
  [/\binsects?\b/i, "insect"],
  [/\beyes?\b/i, "eye"],
  [/\b(?:orcs?|kobolds?|spiders?|snakes?|rats?|worms?|giants?|trolls?|ogres?|bats?|birds?|insects?|humans?|men|elf|elves|dwarf|dwarves|hobbits?|yeeks?|golems?|demons?|vortices|vortexes|vortex|eyes?)\b/i, ""]
];
var WORD_FAMILIES = {
  orc: "orc",
  kobold: "kobold",
  spider: "spider",
  snake: "snake",
  rat: "rat",
  worm: "worm",
  giant: "giant",
  troll: "troll",
  ogre: "ogre",
  bat: "bat",
  bird: "bird",
  insect: "insect",
  human: "human",
  man: "human",
  men: "human",
  elf: "elf",
  elves: "elf",
  dwarf: "dwarf",
  dwarves: "dwarf",
  hobbit: "hobbit",
  yeek: "yeek",
  golem: "golem",
  demon: "demon",
  vortex: "vortex",
  vortices: "vortex",
  vortexes: "vortex",
  eye: "eye",
  eyes: "eye"
};
function familyOf(race) {
  for (const [pattern, family] of FAMILIES) {
    const match = pattern.exec(race);
    if (match !== null) {
      if (family) return family;
      const word = match[0].toLowerCase();
      return WORD_FAMILIES[word] ?? WORD_FAMILIES[word.replace(/s$/, "")] ?? "other";
    }
  }
  return "other";
}
function signatureOf(input) {
  const share3 = input.maxHp > 0 ? input.hp / input.maxHp : 1;
  const hpBand = share3 >= 0.9 ? 0 : share3 >= 0.6 ? 1 : share3 >= 0.35 ? 2 : 3;
  return {
    depthBand: Math.floor(Math.max(0, input.depth) / 5),
    classId: input.classId,
    levelBand: Math.floor(Math.max(0, input.level) / 5),
    families: [...new Set(input.races.map(familyOf))].sort(),
    hpBand,
    resources: [...new Set(input.resources)].sort()
  };
}
function overlap(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  const union = /* @__PURE__ */ new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / union.size;
}
function similarity(a, b) {
  const depth2 = 1 / (1 + Math.abs(a.depthBand - b.depthBand));
  const level = 1 / (1 + Math.abs(a.levelBand - b.levelBand));
  return 0.4 * overlap(a.families, b.families) + 0.3 * depth2 + 0.1 * (a.classId === b.classId ? 1 : 0) + 0.1 * level + 0.05 * (1 - Math.abs(a.hpBand - b.hpBand) / 3) + 0.05 * overlap(a.resources, b.resources);
}

// src/learning/lessons.ts
var UNCAPTIONED = /* @__PURE__ */ new Set(["rest", "none_of_these", "unknown"]);
var ATTACK_WORDS = {
  shoot: "missiles",
  throw_oil: "thrown oil",
  aim_wand: "the wand",
  cast_attack: "the attack spell",
  fight: "melee blows"
};
var ESCAPE_WORDS = {
  phase: "A short teleport",
  teleport: "A long teleport",
  retreat: "Stepping back"
};
function article(race) {
  if (/^[A-Z]/.test(race)) return race;
  return `${/^[aeiou]/i.test(race) ? "an" : "a"} ${race}`;
}
function capitalized(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function sentence(event, decision2, vars) {
  const foe = vars.race === void 0 ? "a creature" : vars.swarm === void 0 ? article(vars.race) : `a swarm of ${vars.race} (${String(vars.swarm)} in sight)`;
  const Foe = capitalized(foe);
  const action = vars.action ?? decision2.replace(/_/g, " ");
  const place = vars.depth === void 0 ? "in the dungeon" : vars.depth === 0 ? "in town" : `at ${String(vars.depth * 50)} ft`;
  const who = vars.level === void 0 ? "the character" : `a level ${String(vars.level)} ${(vars.cls ?? "character").toLowerCase()}`;
  const hp = vars.hpLeft === void 0 || vars.maxHp === void 0 ? "" : `, leaving ${String(vars.hpLeft)} of ${String(vars.maxHp)} HP`;
  const chose = UNCAPTIONED.has(decision2) ? "" : ` after choosing to ${action}`;
  const damage = vars.damage ?? 0;
  switch (event) {
    case "died":
      return `${Foe} killed ${who} ${place}${chose}; next time avoid it at that depth or keep an escape ready.`;
    case "near-death": {
      const low = vars.hpLeft === void 0 || vars.maxHp === void 0 ? " close to death" : ` down to ${String(vars.hpLeft)} of ${String(vars.maxHp)} HP`;
      return `${Foe} brought ${who}${low} ${place}${chose}; next time leave or escape sooner against it.`;
    }
    case "big-hit": {
      const how2 = vars.melee === true ? vars.closing === true ? " while it closed to melee" : " in melee" : " from range";
      const advice = vars.melee === true ? `prefer range or avoid it below ${String(damage * 2)} HP` : `keep out of its line of sight below ${String(damage * 2)} HP`;
      return `${Foe} hit ${who} for ${String(damage)}${how2}${hp}; ${advice}.`;
    }
    case "disabled": {
      const verbs = { paralyzed: "paralyzed", confused: "confused", blind: "blinded", afraid: "frightened" };
      const advice = {
        paralyzed: "fight it only with free action, or not at all",
        confused: "carry a Cure Light Wounds potion and fight it from range",
        blind: "carry a Cure Light Wounds potion, since scrolls and spells fail while blind",
        afraid: "fight it with missiles, spells or wands, since fear stops melee"
      };
      const status = vars.status ?? "confused";
      return `${Foe} ${verbs[status]} ${who}; ${advice[status]}.`;
    }
    case "ability": {
      const lines2 = {
        breath: "can breathe; stay out of its line of sight when hurt",
        spell: "casts spells; close in fast or break its line of sight",
        summon: "summons help; kill it quickly or leave before more arrive",
        missile: "shoots missiles; close in or break its line of sight rather than trade shots"
      };
      return `${Foe} ${lines2[vars.ability ?? "spell"]}.`;
    }
    case "resisted":
      return `${Foe} resisted ${ATTACK_WORDS[decision2] ?? action}; use a different attack on it.`;
    case "breeding":
      return `${capitalized(article(vars.race ?? "creature"))} breeds${vars.swarm === void 0 ? "" : ` (${String(vars.swarm)} in sight)`}; kill each one at once or take the stairs before it fills the level.`;
    case "failed-escape":
      return `${ESCAPE_WORDS[decision2] ?? capitalized(action)} did not get ${who} clear of ${foe}, which hit for ${String(damage)}${hp}; escape earlier, or use a longer escape.`;
    case "escaped":
      return `Escaped ${foe} by choosing to ${action}.`;
    case "unique-kill":
      return `Defeated ${foe} by choosing to ${action}.`;
    case "loss":
      return `Lost ground to ${foe} after choosing to ${action}.`;
  }
}
function lessonFrom(event, signature, decision2, turn, templateVars = {}, once) {
  return {
    id: once === void 0 ? `${String(turn)}:${event}:${decision2}:${templateVars.race ?? ""}` : `once-${once}:${event}:${decision2}:${templateVars.race ?? ""}`,
    signature,
    decision: decision2,
    outcome: event,
    line: sentence(event, decision2, templateVars),
    weight: 1,
    created: turn,
    lastUsed: turn,
    pinned: false
  };
}
function dreadedRaces(lessons) {
  const out = /* @__PURE__ */ new Set();
  for (const lesson of lessons) {
    if (lesson.outcome !== "died" && lesson.outcome !== "near-death") continue;
    const race = lesson.id.split(":").slice(3).join(":");
    if (race !== "") out.add(race);
  }
  return out;
}
function retrieve(lessons, signature, limit) {
  return lessons.map((lesson, index) => ({ lesson, index, score: similarity(lesson.signature, signature) * lesson.weight })).sort((a, b) => Number(b.lesson.pinned) - Number(a.lesson.pinned) || b.score - a.score || a.index - b.index).slice(0, Math.max(0, Math.floor(limit))).map(({ lesson }) => lesson);
}
function rate(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
function fade2(lessons, turnNow, learningRate01) {
  const decay = rate(learningRate01);
  return lessons.map((lesson) => {
    if (lesson.pinned) return lesson;
    const intervals = Math.max(0, (turnNow - lesson.lastUsed) / 1e3);
    return { ...lesson, weight: lesson.weight * Math.pow(1 - decay, intervals) };
  }).filter((lesson) => lesson.pinned || lesson.weight >= 0.1);
}
function blameQuestion(records) {
  const criteria = {};
  for (const record5 of records) criteria[record5.id] = `${record5.plan}: ${record5.summary}`;
  criteria["none_of_these"] = "No listed decision contributed most to the death.";
  return { type: "choice", instructions: "Which earlier decision contributed most to this death? Choose one listed decision or none_of_these.", criteria };
}
function applyBlame(answer, records) {
  return records.some((record5) => record5.id === answer.choice) ? answer.choice : null;
}

// src/memory/install.ts
var KEY = "squire/install-id";
var UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function installId(store, rng = Math.random) {
  const saved = await store.get(KEY);
  if (typeof saved === "string" && UUID_V4.test(saved)) return saved;
  const random = globalThis.crypto?.randomUUID?.();
  let id = random !== void 0 && UUID_V4.test(random) ? random : "";
  if (!id) {
    const bytes2 = Array.from({ length: 16 }, () => Math.floor(rng() * 256) & 255);
    bytes2[6] = bytes2[6] & 15 | 64;
    bytes2[8] = bytes2[8] & 63 | 128;
    const hex = bytes2.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  await store.set(KEY, id);
  return id;
}

// src/telemetry/batch.ts
var REFUSED = /backstory|persona|quirk|biography|lore/i;
var LIMITS = { summary: 32 * 1024, decisions: 1024 * 1024, full: 1536 * 1024 };
var MAX_RECORDS = 5e3;
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key2]) => !REFUSED.test(key2)).map(([key2, item]) => [key2, strip(item)]));
  }
  return value;
}
function bytes(batch) {
  return Buffer.byteLength(JSON.stringify(batch), "utf8");
}
function decision(record5) {
  return strip({
    t: record5.turn,
    kind: record5.plan.trim().split(/\s+/)[0] || "unknown",
    question: record5.question,
    choice: record5.choice,
    confidence: record5.confidence,
    probs: record5.probs,
    outcome: record5.outcome
  });
}
function buildBatches(input, level) {
  if (level === "off") return [];
  const summary = { ...input.summary, calibration: strip(input.summary.calibration) };
  if (JSON.stringify(summary.calibration).length > 16 * 1024) throw new RangeError("Calibration exceeds the contract limit.");
  const base = {
    schema: 1,
    level,
    install_id: input.installId,
    run_id: input.runId,
    sent_at: input.sentAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    mod_version: input.modVersion,
    game_version: input.gameVersion
  };
  const running = { ...summary, outcome: { ...summary.outcome, ended: false } };
  const batches = [];
  const make = (records, seq) => ({
    ...base,
    seq,
    summary: running,
    ...level === "summary" ? {} : { decisions: records }
  });
  let current2 = make([], input.seq);
  let currentBytes = bytes(current2);
  if (currentBytes > LIMITS[level]) throw new RangeError("The summary exceeds the batch byte limit.");
  if (level !== "summary") {
    for (const record5 of input.decisions) {
      const mapped = decision(record5);
      const count2 = current2.decisions?.length ?? 0;
      const addedBytes = Buffer.byteLength(JSON.stringify(mapped), "utf8") + (count2 ? 1 : 0);
      if (count2 >= MAX_RECORDS || currentBytes + addedBytes > LIMITS[level]) {
        batches.push(current2);
        current2 = make([mapped], input.seq + batches.length);
        currentBytes = bytes(current2);
        if (currentBytes > LIMITS[level]) throw new RangeError("A decision exceeds the batch byte limit.");
      } else {
        current2 = make([...current2.decisions ?? [], mapped], current2.seq);
        currentBytes += addedBytes;
      }
    }
  }
  batches.push(current2);
  if (level === "full" && (input.extra !== void 0 || input.backstoryConsent && input.backstory)) {
    const extras = {
      ...input.extra === void 0 ? {} : { extra: strip(input.extra) },
      ...input.backstoryConsent && input.backstory ? { backstory_consent: true, backstory: input.backstory } : {}
    };
    const withExtras = { ...current2, ...extras };
    if (bytes(withExtras) <= LIMITS.full) batches[batches.length - 1] = withExtras;
    else {
      const separate = { ...make([], input.seq + batches.length), ...extras };
      if (bytes(separate) > LIMITS.full) throw new RangeError("The full run log exceeds the batch byte limit.");
      batches.push(separate);
    }
  }
  if (summary.outcome.ended) {
    const last = batches.length - 1;
    batches[last] = { ...batches[last], summary };
    if (bytes(batches[last]) > LIMITS[level]) {
      const final = { ...make([], input.seq + batches.length), summary };
      if (bytes(final) > LIMITS[level]) throw new RangeError("The final summary exceeds the batch byte limit.");
      batches[last] = { ...batches[last], summary: running };
      batches.push(final);
    }
  }
  return batches;
}

// src/learning/calibration.ts
var EPS = 1e-6;
function clamp(p) {
  return Math.max(EPS, Math.min(1 - EPS, Number.isFinite(p) ? p : 0.5));
}
function logit(p) {
  const value = clamp(p);
  return Math.log(value / (1 - value));
}
function sigmoid(value) {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}
function fitPlatt(samples) {
  if (samples.length < 20) return { a: 1, b: 0 };
  let a = 1;
  let b = 0;
  for (let step = 0; step < 400; step += 1) {
    let da = 0;
    let db = 0;
    for (const sample of samples) {
      const x = logit(sample.p);
      const error = sigmoid(a * x + b) - sample.y;
      da += error * x;
      db += error;
    }
    a -= 0.05 * (da / samples.length + 0.01 * (a - 1));
    b -= 0.05 * (db / samples.length + 0.01 * b);
  }
  return { a, b };
}
function applyTemperature(probs, t) {
  const keys = Object.keys(probs);
  if (keys.length === 0) return {};
  const temperature = Number.isFinite(t) && t > 0 ? t : 1;
  const scaled = keys.map((key2) => Math.pow(Math.max(0, probs[key2] ?? 0), 1 / temperature));
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(keys.map((key2, index) => [key2, total > 0 ? scaled[index] / total : 1 / keys.length]));
}
function fitTemperature(samples) {
  if (samples.length < 20) return 1;
  let best = 1;
  let bestLoss = Infinity;
  for (let index = 0; index <= 100; index += 1) {
    const temperature = 0.5 + index * 0.025;
    let loss = 0;
    for (const sample of samples) {
      const p = clamp(applyTemperature(sample.probs, temperature)[sample.chosen] ?? 0);
      loss -= Math.log(sample.good ? p : 1 - p);
    }
    if (loss < bestLoss - 1e-10 || Math.abs(loss - bestLoss) <= 1e-10 && Math.abs(temperature - 1) < Math.abs(best - 1)) {
      bestLoss = loss;
      best = temperature;
    }
  }
  return best;
}
function bestMoveKey(backend, question) {
  return `${backend}:${question}`;
}
function update(book, key2, sample) {
  const old = book[key2];
  if ("p" in sample) {
    const previous2 = old?.kind === "noul" ? old.samples : [];
    return { ...book, [key2]: { kind: "noul", samples: [...previous2, sample].slice(-2e3), fit: old?.kind === "noul" ? old.fit : { a: 1, b: 0 } } };
  }
  const previous = old?.kind === "choice" ? old.samples : [];
  return { ...book, [key2]: { kind: "choice", samples: [...previous, sample].slice(-2e3), temperature: old?.kind === "choice" ? old.temperature : 1 } };
}
function refit(book) {
  return Object.fromEntries(Object.entries(book).map(([key2, entry]) => [key2, entry.kind === "noul" ? { ...entry, fit: fitPlatt(entry.samples) } : { ...entry, temperature: fitTemperature(entry.samples) }]));
}

// src/orders/creed.ts
var CREED_FORMAT = "neo-angband/squire/creed";
var CREED_SCHEMA = 1;
var MAX_CREED_LINES = 100;
function exportCreed(name, instructions) {
  const entries = instructions.filter((i) => i.kind === "standing" && (i.state === "following" || i.state === "grudgingly" || i.state === "ignoring")).map((i) => ({ text: i.text, familyCreed: i.familyCreed }));
  return JSON.stringify({ format: CREED_FORMAT, schemaVersion: CREED_SCHEMA, data: { name, instructions: entries } }, null, 2);
}
function importCreed(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: "That file isn't a creed file." };
  }
  const env = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  if (env === null || env["format"] !== CREED_FORMAT) return { ok: false, problem: "That file isn't a creed file." };
  if (typeof env["schemaVersion"] !== "number" || env["schemaVersion"] > CREED_SCHEMA) return { ok: false, problem: "That creed file needs a newer version of Squire." };
  const data = env["data"] !== null && typeof env["data"] === "object" ? env["data"] : null;
  const list = data?.["instructions"];
  if (data === null || !Array.isArray(list)) return { ok: false, problem: "That creed file has no instructions in it." };
  const entries = [];
  for (const raw of list.slice(0, MAX_CREED_LINES)) {
    const r = raw !== null && typeof raw === "object" ? raw : null;
    if (r === null || typeof r["text"] !== "string" || r["text"].trim() === "") continue;
    entries.push({ text: r["text"].slice(0, MAX_TEXT), familyCreed: r["familyCreed"] === true });
  }
  return { ok: true, name: typeof data["name"] === "string" ? data["name"].slice(0, 60) : "", entries };
}
function loadCreed(orders, text) {
  const read = importCreed(text);
  if (!read.ok) return read;
  let taken = 0;
  for (const entry of read.entries) {
    const result = queueInstruction(orders, entry.text, "creed", { kind: "standing", familyCreed: entry.familyCreed });
    if (result.ok) taken += 1;
  }
  return { ok: true, taken };
}
function inheritCreeds(creeds, parent) {
  const share3 = Math.max(0, Math.min(1, parent.sliders.inheritance / 100));
  const count2 = Math.min(12, Math.floor(12 * share3));
  return creeds.filter((i) => i.kind === "standing" && i.familyCreed).sort((a, b) => b.memory - a.memory || a.createdTurn - b.createdTurn).slice(0, count2).map((i) => ({ ...i, memory: i.memory / 2 }));
}

// src/learning/lineage.ts
function unit4(rng) {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
function fraction(value) {
  return Math.max(0, Math.min(1, value / 100));
}
function killerRace(cause) {
  return cause.replace(/^killed by\s+/i, "").replace(/^(?:an?|the)\s+/i, "").trim();
}
function inherit(parentLineage, parentPersona, heirPersona, rng) {
  const resemblance = fraction(parentPersona.sliders.resemblance);
  const sliders = { ...heirPersona.sliders };
  for (const parameter of PARAMETERS) {
    if (parameter.kind === "slider" && parameter.group !== "meta" && parameter.group !== "lineage") {
      const id = parameter.id;
      sliders[id] = Math.round(sliders[id] + (parentPersona.sliders[id] - sliders[id]) * resemblance);
    }
  }
  const lists = Object.fromEntries(Object.entries(heirPersona.lists).map(([key2, values]) => [key2, [...values]]));
  const grudges = [...parentLineage.grudges];
  const death = parentLineage.died ?? null;
  const killers = parentLineage.killers ?? [];
  const heirGeneration = parentLineage.generation + 1;
  const shaped = { ...heirPersona, sliders };
  const bloodGrudges = parentPersona.sliders.inheritance > 0 && parentPersona.toggles.grudges && heirPersona.toggles.grudges;
  if (bloodGrudges && death !== null) {
    const race = killerRace(death.cause);
    const family = familyOf(race);
    if (family !== "other") {
      grudges.push({ race, family, generation: parentLineage.generation });
      const known = killers.find((k) => k.name.toLowerCase() === race.toLowerCase());
      const count3 = known === void 0 ? 1 : Math.max(1, remembered(known, heirGeneration));
      const target = feelingKind(shaped, count3) === "hatred" ? lists.hated : lists.feared;
      if (!target.includes(family) && target.length < 12) target.push(family);
    }
  }
  const feelings = bloodGrudges ? feelingsFor(killers, heirGeneration, shaped, parentPersona.sliders.inheritance) : [];
  const count2 = Math.min(12, Math.floor(12 * fraction(parentPersona.sliders.inheritance)));
  const lore = parentLineage.lore.map((lesson) => ({ lesson, tie: unit4(rng) })).sort((a, b) => b.lesson.weight - a.lesson.weight || a.tie - b.tie).slice(0, count2).map(({ lesson }) => ({ ...lesson, weight: lesson.weight / 2 }));
  const parent = {
    name: parentLineage.name,
    race: parentLineage.race ?? "unknown",
    cls: parentLineage.cls ?? "unknown",
    generation: parentLineage.generation,
    died: death,
    ...parentLineage.deepest === void 0 ? {} : { deepest: parentLineage.deepest },
    ...parentLineage.turns === void 0 ? {} : { turns: parentLineage.turns }
  };
  return {
    lineage: {
      name: heirPersona.name,
      generation: heirGeneration,
      ancestors: [...parentLineage.ancestors, parent],
      lore,
      grudges,
      creeds: inheritCreeds(parentLineage.creeds ?? [], parentPersona),
      aims: inheritAims(parentLineage.aims ?? [], parentPersona, shaped),
      killers,
      feelings,
      ...inheritFlourishes(parentLineage, parentPersona, shaped),
      flourishRecord: parentLineage.flourishRecord ?? emptyFamilyFlourishes(),
      flourishes: inheritWays(parentLineage.flourishRecord ?? emptyFamilyFlourishes(), parentPersona, shaped, rng)
    },
    persona: { ...heirPersona, sliders, lists }
  };
}

// src/report/chronicle.ts
function notorietyQuestion(_event) {
  return {
    type: "score",
    instructions: "Rate how much this single run event deserves a place in the character's Chronicle. Judge its impact, danger and rarity from the facts in the state. Do not invent events.",
    criteria: ["routine", "worth a mention", "notable", "memorable", "legendary"]
  };
}
function notorietyState(event, personaName, depth2, level) {
  return {
    persona: personaName,
    kind: event.kind,
    fact: event.text,
    turn: event.turn,
    eventDepth: event.depth,
    depth: depth2,
    level,
    ...event.race === void 0 ? {} : { race: event.race },
    ...event.value === void 0 ? {} : { value: event.value }
  };
}
function isNotable(answer, chronicleSlider) {
  const voice = Number.isFinite(chronicleSlider) ? Math.max(0, Math.min(100, chronicleSlider)) : 0;
  return Number.isFinite(answer.score) && answer.score >= 3 - Math.floor(voice / 50);
}
var TEMPLATES = {
  "kill": [(f, d) => `Killed ${f} at ${d} ft.`, (f, d) => `At ${d} ft, ${f} fell.`, (f, d) => `${f} died at ${d} ft.`],
  "unique-kill": [(f, d) => `Cut down ${f} at ${d} ft.`, (f, d) => `At ${d} ft, I killed ${f}.`, (f, d) => `${f} fell to me at ${d} ft.`],
  "near-death": [(f, d) => `Nearly died at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}. I lived.`, (f, d) => `I survived ${f} at ${d} ft.`],
  "escape": [(f, d) => `Escaped at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, I got away: ${f}.`, (f, d) => `I left danger behind at ${d} ft: ${f}.`],
  "level-up": [(f, d) => `Grew stronger at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `${f} at ${d} ft.`],
  "descend": [(f, d) => `Descended to ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `Went deeper, to ${d} ft: ${f}.`],
  "item-found": [(f, d) => `Found ${f} at ${d} ft.`, (f, d) => `At ${d} ft, I found ${f}.`, (f, d) => `${f} turned up at ${d} ft.`],
  "death": [(f, d) => `Died at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}. That was the end.`, (f, d) => `My run ended at ${d} ft: ${f}.`],
  "divergence": [(f, d) => `Chose my own way at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, I went against advice: ${f}.`, (f, d) => `${f} at ${d} ft. I made the call.`],
  "lesson": [(f, d) => `Learned at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, I learned: ${f}.`, (f, d) => `${f} That lesson came at ${d} ft.`],
  "instruction": [(f, d) => `Kept to my orders at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `${f} That was at ${d} ft.`],
  "lineage": [(f, d) => `Carried the family story to ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `${f} The line reached ${d} ft.`]
};
function chronicleLine(event, persona, rng) {
  const templates = TEMPLATES[event.kind];
  const draw = rng();
  const index = Number.isFinite(draw) ? Math.max(0, Math.min(2, Math.floor(draw * 3))) : 0;
  const fact = event.text.trim().replace(/[.!?]+$/, "");
  const line = templates[index](fact, event.depth * 50);
  if (persona.sliders.chronicle < 50) return line;
  if (persona.sliders.boldness >= 65) return `${line} I earned that story.`;
  if (persona.sliders.boldness <= 35) return `${line} I am glad I got this far.`;
  return `${line} I will remember it.`;
}

// src/report/events.ts
var KINDS = /* @__PURE__ */ new Set([
  "kill",
  "unique-kill",
  "near-death",
  "escape",
  "level-up",
  "descend",
  "item-found",
  "death",
  "divergence",
  "lesson",
  "lineage",
  "instruction"
]);
function eventFrom(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value;
  if (!KINDS.has(raw["kind"]) || typeof raw["text"] !== "string" || typeof raw["turn"] !== "number" || !Number.isFinite(raw["turn"]) || typeof raw["depth"] !== "number" || !Number.isFinite(raw["depth"])) return null;
  return {
    kind: raw["kind"],
    turn: raw["turn"],
    depth: raw["depth"],
    text: raw["text"],
    ...typeof raw["race"] === "string" ? { race: raw["race"] } : {},
    ...typeof raw["value"] === "number" && Number.isFinite(raw["value"]) ? { value: raw["value"] } : {}
  };
}
function createRunLog() {
  const entries = [];
  return {
    record(event) {
      entries.push(event);
    },
    events: () => entries.slice(),
    topKills(n) {
      const counts = /* @__PURE__ */ new Map();
      for (const event of entries) {
        if ((event.kind === "kill" || event.kind === "unique-kill") && event.race) {
          counts.set(event.race, (counts.get(event.race) ?? 0) + 1);
        }
      }
      return [...counts].map(([name, count2]) => ({ name, count: count2 })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, Math.max(0, Math.floor(n)));
    },
    depthCurve() {
      const curve = [];
      for (const event of entries) {
        if (curve.at(-1)?.depth !== event.depth) curve.push({ turn: event.turn, depth: event.depth });
      }
      return curve;
    },
    hpLowPoints() {
      const lows = [];
      let lowest = Infinity;
      for (const event of entries) {
        if (event.kind === "near-death" && event.value !== void 0 && event.value < lowest) {
          lowest = event.value;
          lows.push({ turn: event.turn, depth: event.depth, hp: event.value });
        }
      }
      return lows;
    },
    closeCalls: () => entries.filter((event) => event.kind === "near-death"),
    runClock() {
      if (entries.length === 0) return { startTurn: 0, endTurn: 0, turns: 0 };
      let startTurn = entries[0].turn;
      let endTurn = startTurn;
      for (const event of entries) {
        startTurn = Math.min(startTurn, event.turn);
        endTurn = Math.max(endTurn, event.turn);
      }
      return { startTurn, endTurn, turns: endTurn - startTurn + 1 };
    },
    toJson: () => JSON.stringify({ format: "neo-angband/squire/run-log", schemaVersion: 1, events: entries })
  };
}
function fromJson(json) {
  const log = createRunLog();
  try {
    const raw = JSON.parse(json);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return log;
    const data = raw;
    if (data["format"] !== "neo-angband/squire/run-log" || data["schemaVersion"] !== 1 || !Array.isArray(data["events"])) return log;
    for (const item of data["events"]) {
      const event = eventFrom(item);
      if (event !== null) log.record(event);
    }
  } catch {
  }
  return log;
}

// src/journal.ts
var LESSONS_PER_DECISION = 3;
var MAX_LESSONS = 80;
var MAX_CHRONICLE = 100;
var BLAME_WINDOW = 8;
var REFIT_EVERY = 50;
function emptyJournal() {
  return { runLog: "", chronicle: [], lessons: [], calibration: {} };
}
var BIG_HIT_SHARE = 0.25;
var ESCAPE_WINDOW = 50;
var DISABLING = ["paralyzed", "confused", "blind", "afraid"];
var ESCAPES2 = /* @__PURE__ */ new Set(["phase", "teleport", "retreat"]);
var ATTACKS2 = /* @__PURE__ */ new Set(["shoot", "throw_oil", "aim_wand", "cast_attack", "fight"]);
var ABILITY_WORDS = [
  [/\bbreathes\b/i, "breath"],
  [/\b(summons|calls for help|magically summons)\b/i, "summon"],
  [/\b(fires|shoots|throws)\b/i, "missile"],
  [/\b(casts|invokes|gestures|points at you and curses|mumbles)\b/i, "spell"]
];
var RESIST_WORDS = /\b(resists|is unaffected|is immune)\b/i;
function culprit(view) {
  const at = view.player().grid;
  const awake = view.monsters().filter((m) => m.visible && !m.asleep);
  const adjacent2 = awake.filter((m) => steps(at, m.grid) <= 1);
  if (adjacent2.length === 1) return adjacent2[0];
  if (adjacent2.length === 0 && awake.length === 1) return awake[0];
  return void 0;
}
function named2(view, message) {
  const lower = message.toLowerCase();
  return view.monsters().filter((m) => m.visible).sort((a, b) => b.race.length - a.race.length).find((m) => lower.includes(m.race.toLowerCase()));
}
function signatureFor(view) {
  const p = view.player();
  const pack = readPack(view);
  const resources = [];
  if (pack.heal.length > 0 || pack.healSpell.length > 0) resources.push("heal");
  if (pack.phase.length > 0 || pack.escapeSpell.length > 0) resources.push("phase");
  if (pack.teleport.length > 0) resources.push("teleport");
  return signatureOf({
    depth: p.depth,
    classId: p.cls,
    level: p.level,
    races: view.monsters().filter((m) => m.visible).map((m) => m.race),
    hp: p.hp,
    maxHp: p.maxHp,
    resources
  });
}
function createJournal(initial, deps) {
  const rng = deps.rng ?? Math.random;
  const runLog = initial.runLog === "" ? createRunLog() : fromJson(initial.runLog);
  let chronicle = initial.chronicle.slice(-MAX_CHRONICLE);
  let lessons = initial.lessons.slice(-MAX_LESSONS);
  let calibration = initial.calibration;
  let samplesSinceFit = 0;
  let last = null;
  let pending = null;
  let lastDecision = null;
  function persist() {
    deps.save({ runLog: runLog.toJson(), chronicle, lessons, calibration });
  }
  function drift(event) {
    const persona = deps.persona();
    if (persona === null) return;
    const result = applyDrift(persona, event, rng);
    if (result.changes.length > 0) deps.setPersona(result.persona);
  }
  function learn(outcome, view, race, vars = {}, once) {
    const decision2 = lastDecision?.choice ?? "unknown";
    const p = view.player();
    const lesson = lessonFrom(outcome, signatureFor(view), decision2, view.turn(), {
      ...race === void 0 ? {} : { race },
      depth: p.depth,
      level: p.level,
      cls: p.cls,
      hpLeft: p.hp,
      maxHp: p.maxHp,
      ...vars
    }, once);
    lessons = [...lessons.filter((l) => l.id !== lesson.id), lesson].slice(-MAX_LESSONS);
  }
  function escaping(turn) {
    return lastDecision !== null && ESCAPES2.has(lastDecision.choice) && turn - lastDecision.turn <= ESCAPE_WINDOW;
  }
  function causes(view, before, now, nearDeath) {
    const turn = view.turn();
    const p = view.player();
    const foe = culprit(view);
    const drop = before.hp - now.hp;
    if (foe !== void 0 && p.maxHp > 0 && drop >= Math.max(1, p.maxHp * BIG_HIT_SHARE)) {
      const melee = steps(p.grid, foe.grid) <= 1;
      const closing = melee && lastDecision?.choice === "fight" && (before.away.get(foe.id) ?? 1) > 1;
      if (escaping(turn)) learn("failed-escape", view, foe.race, { damage: drop }, `${foe.race}:${lastDecision?.choice ?? ""}`);
      else if (!nearDeath) learn("big-hit", view, foe.race, { damage: drop, melee, closing }, `${foe.race}:${melee ? "melee" : "range"}`);
    }
    for (const status of DISABLING) {
      if (before.status[status] === 0 && now.status[status] > 0 && foe !== void 0) {
        learn("disabled", view, foe.race, { status }, `${foe.race}:${status}`);
      }
    }
    for (const [race, count2] of now.breeders) {
      const was = before.breeders.get(race) ?? 0;
      if (was > 0 && count2 > was) learn("breeding", view, race, { swarm: count2 }, race);
    }
    for (const message of view.messages()) {
      const who = named2(view, message);
      if (who === void 0) continue;
      if (RESIST_WORDS.test(message) && lastDecision !== null && ATTACKS2.has(lastDecision.choice)) {
        learn("resisted", view, who.race, {}, `${who.race}:${lastDecision.choice}`);
        continue;
      }
      const ability = ABILITY_WORDS.find(([pattern]) => pattern.test(message))?.[1];
      if (ability !== void 0) learn("ability", view, who.race, { ability }, `${who.race}:${ability}`);
    }
  }
  function record5(event, notableByDefault) {
    runLog.record(event);
    const persona = deps.persona();
    const voice = persona?.sliders.chronicle ?? 50;
    const write = () => {
      if (persona === null) return;
      const line = chronicleLine(event, persona, rng);
      chronicle = [...chronicle, line].slice(-MAX_CHRONICLE);
      deps.onChronicle?.(line);
      persist();
    };
    if (deps.send === null || persona === null) {
      if (notableByDefault) write();
      persist();
      return;
    }
    void deps.send({ state: notorietyState(event, persona.name, event.depth, 0), questions: { notoriety: notorietyQuestion(event) } }).then((result) => {
      const answer = result.ok ? result.answers["notoriety"] : void 0;
      if (answer?.type === "score" ? isNotable(answer, voice) : notableByDefault) write();
      else persist();
    });
  }
  function worstRace(view) {
    const awake = view.monsters().filter((m) => m.visible && !m.asleep);
    return awake.sort((a, b) => b.level - a.level)[0]?.race;
  }
  return {
    observe(view) {
      const p = view.player();
      const awake = view.monsters().filter((m) => m.visible && !m.asleep);
      const breeders = /* @__PURE__ */ new Map();
      for (const m of view.monsters()) if (m.visible && m.raceFlags.includes("MULTIPLY")) breeders.set(m.race, (breeders.get(m.race) ?? 0) + 1);
      const now = {
        depth: p.depth,
        maxDepth: p.maxDepth,
        level: p.level,
        hp: p.hp,
        hpShare: p.maxHp > 0 ? p.hp / p.maxHp : 1,
        dead: p.dead,
        status: { paralyzed: p.status.paralyzed, confused: p.status.confused, blind: p.status.blind, afraid: p.status.afraid },
        away: new Map(awake.map((m) => [m.id, steps(p.grid, m.grid)])),
        breeders
      };
      const turn = view.turn();
      if (last !== null) {
        if (now.depth > last.depth) {
          const record_ = now.maxDepth > last.maxDepth;
          record5(
            { kind: "descend", turn, depth: now.depth, text: record_ ? `a new record of ${String(now.depth * 50)} ft` : `down to ${String(now.depth * 50)} ft` },
            record_ && now.maxDepth % 5 === 0
          );
        }
        if (now.level > last.level) {
          record5({ kind: "level-up", turn, depth: now.depth, text: `reached character level ${String(now.level)}` }, now.level % 5 === 0);
          drift("level-up");
        }
        const nearDeath = now.hpShare < 0.2 && last.hpShare >= 0.35 && !now.dead;
        if (nearDeath) {
          const swarm = swarmOf(view.monsters());
          const swarmed = swarm !== null && swarm.count >= SWARM_LEAVE_DREADED ? swarm : null;
          const race = swarmed?.race ?? worstRace(view);
          record5(
            { kind: "near-death", turn, depth: now.depth, text: race === void 0 ? "hit points ran very low" : `the ${race} nearly killed me`, value: p.hp, ...race === void 0 ? {} : { race } },
            true
          );
          learn("near-death", view, race, swarmed === null ? {} : { swarm: swarmed.count });
          drift("near-death");
          if (pending !== null) pending.bad = true;
        }
        if (!now.dead && now.depth === last.depth) causes(view, last, now, nearDeath);
      }
      last = now;
    },
    kill(race, unique, view) {
      const depth2 = view?.player().depth ?? 0;
      const turn = view?.turn() ?? 0;
      record5({ kind: unique ? "unique-kill" : "kill", turn, depth: depth2, text: race, race }, unique);
      if (unique && view !== null) drift("unique-kill");
    },
    decided(record_, view) {
      if (pending !== null) {
        calibration = update(calibration, bestMoveKey(deps.backend, "goal"), { probs: pending.probs, chosen: pending.chosen, good: !pending.bad });
        samplesSinceFit += 1;
        if (samplesSinceFit >= REFIT_EVERY) {
          calibration = refit(calibration);
          samplesSinceFit = 0;
        }
      }
      pending = record_.probs === null ? null : { probs: record_.probs, chosen: record_.choice, bad: false };
      lastDecision = record_;
      if (record_.persona !== void 0 && record_.persona.best !== record_.persona.blended) {
        runLog.record({ kind: "divergence", turn: record_.turn, depth: view.player().depth, text: `${record_.persona.blended} instead of ${record_.persona.best}` });
      }
      if (["phase", "teleport", "retreat"].includes(record_.choice)) drift("fled");
    },
    lessonLines(view) {
      const persona = deps.persona();
      const learningRate = (persona?.sliders.learning ?? 50) / 100;
      lessons = fade2(lessons, view.turn(), learningRate);
      return retrieve(lessons, signatureFor(view), LESSONS_PER_DECISION).map((l) => l.line);
    },
    calibrate(probs) {
      const entry = calibration[bestMoveKey(deps.backend, "goal")];
      return entry?.kind === "choice" && entry.temperature !== 1 ? applyTemperature(probs, entry.temperature) : { ...probs };
    },
    runLog: () => runLog,
    chronicle: () => chronicle,
    lessons: () => lessons,
    async died(records, cause, view) {
      const turn = view?.turn() ?? 0;
      const depth2 = view?.player().depth ?? 0;
      if (pending !== null) pending.bad = true;
      record5({ kind: "death", turn, depth: depth2, text: cause }, true);
      const recent = records.slice(-BLAME_WINDOW);
      let blamed = null;
      if (deps.send !== null && recent.length > 0) {
        const blameRecords = recent.map((r) => ({ id: r.id, plan: r.plan, summary: String(r.state["health"] ?? "") }));
        const result = await deps.send({
          state: { death: cause, depth: `${String(depth2 * 50)} ft` },
          questions: { blame: blameQuestion(blameRecords) }
        });
        const answer = result.ok ? result.answers["blame"] : void 0;
        if (answer?.type === "choice") blamed = applyBlame(answer, blameRecords);
      }
      if (view !== null) {
        const blamedRecord = recent.find((r) => r.id === blamed) ?? recent[recent.length - 1];
        if (blamedRecord !== void 0) lastDecision = blamedRecord;
        learn("died", view, cause.replace(/^killed by\s+/i, ""));
      }
      persist();
      return blamed;
    },
    event: record5,
    state: () => ({ runLog: runLog.toJson(), chronicle, lessons, calibration })
  };
}
function heirFrom(lineage, parent, heir, rng) {
  if (lineage === void 0) return null;
  return inherit(lineage, parent, heir, rng);
}
function withAncestor(lineage, name, race, cls, died, lessons, seen = []) {
  const base = lineage ?? { name, generation: 1, ancestors: [], lore: [], grudges: [] };
  const killers = died === null ? base.killers ?? [] : recordDeath(base.killers ?? [], killerOf(died.cause, seen), { generation: base.generation, depth: died.depth, turn: died.turn });
  return { ...base, name, race, cls, died, lore: [...base.lore, ...lessons].slice(-60), ...killers.length === 0 ? {} : { killers } };
}

// src/lessons/radar.ts
var LESSON_SLIDERS = ["boldness", "patience", "healat", "retreatat", "consumables", "levelfeel", "range"];
function drawRadar(ctx, persona, x, y, radius, color, confidence) {
  ctx.save();
  try {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.textAlign = "center";
    ctx.font = "11px sans-serif";
    for (let i = 0; i < LESSON_SLIDERS.length; i += 1) {
      const key2 = LESSON_SLIDERS[i];
      const angle = -Math.PI / 2 + i * 2 * Math.PI / LESSON_SLIDERS.length;
      const edgeX = x + Math.cos(angle) * radius;
      const edgeY = y + Math.sin(angle) * radius;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(edgeX, edgeY);
      ctx.stroke();
      ctx.globalAlpha = confidence === void 0 ? 1 : Math.max(0.2, Math.min(1, confidence[key2] ?? 0));
      ctx.fillText(key2, x + Math.cos(angle) * (radius + 25), y + Math.sin(angle) * (radius + 18));
    }
    ctx.beginPath();
    for (let i = 0; i < LESSON_SLIDERS.length; i += 1) {
      const key2 = LESSON_SLIDERS[i];
      const angle = -Math.PI / 2 + i * 2 * Math.PI / LESSON_SLIDERS.length;
      const distance = radius * Math.max(0, Math.min(100, persona.sliders[key2])) / 100;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = confidence === void 0 ? 0.3 : 0.18;
    ctx.fill();
    ctx.globalAlpha = confidence === void 0 ? 1 : 0.6;
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

// src/report/summary.ts
function countUse(decisions, key2) {
  const counts = /* @__PURE__ */ new Map();
  for (const decision2 of decisions) {
    const value = decision2.state[key2];
    if (typeof value === "string" && value.trim()) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([name, count2]) => ({ name, count: count2 })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
function buildRunSummary(input) {
  const { report, decisions, persona, runLog, tally } = input;
  const divergences = decisions.filter((decision2) => decision2.persona !== void 0 && decision2.persona.best !== decision2.persona.blended).length;
  const beforeDeath = report.outcome === "death" ? decisions.filter((decision2) => decision2.turn <= report.turn).sort((a, b) => a.turn - b.turn || a.seq - b.seq) : [];
  const last = beforeDeath.slice(-5);
  const blamed = input.blamedDecisionId === void 0 ? void 0 : beforeDeath.find((decision2) => decision2.id === input.blamedDecisionId);
  const deathDecisions = blamed === void 0 || last.some((decision2) => decision2.id === blamed.id) ? last : [blamed, ...last];
  const events = runLog.events();
  const highlightEvent = events.find((event) => event.kind === "unique-kill") ?? events.find((event) => event.kind === "near-death") ?? events.find((event) => event.kind === "escape") ?? events.find((event) => event.kind === "item-found") ?? events[0];
  const apprentice = input.apprentice;
  const inferred = apprentice === void 0 ? null : inferPersona([], apprentice.commands ?? []);
  const apprenticeship = apprentice === void 0 || apprentice.total === 0 || inferred === null ? void 0 : {
    agreementShare: apprentice.agreed / apprentice.total,
    rank: rankOf(apprentice),
    surprises: apprentice.entries.filter((entry) => entry.signature !== void 0 && !entry.agreed).map((entry, index) => ({ entry, index })).sort((a, b) => (b.entry.confidence ?? -1) - (a.entry.confidence ?? -1) || b.index - a.index).slice(0, 3).map(({ entry }) => entry.line),
    latestExam: (apprentice.exams ?? []).at(-1) ?? null,
    squireRadar: LESSON_SLIDERS.map((id) => ({ id, value: persona.sliders[id] })),
    knightRadar: LESSON_SLIDERS.map((id) => ({ id, value: inferred.persona.sliders[id], confidence: inferred.confidence[id] }))
  };
  return {
    headline: {
      name: report.name,
      race: report.race,
      class: report.cls,
      level: report.level,
      deepestFeet: report.maxDepth * 50,
      turns: report.turn,
      outcome: report.outcome,
      cause: report.cause
    },
    personaRadar: PARAMETERS.filter((parameter) => parameter.kind === "slider" && (parameter.group === "temperament" || parameter.group === "values")).map((parameter) => ({
      id: parameter.id,
      name: parameter.name,
      value: Math.max(0, Math.min(100, persona.sliders[parameter.id]))
    })),
    topKills: runLog.topKills(10),
    uniquesKilled: report.history.filter((event) => event.kind === "unique").map((event) => event.text),
    depthCurve: runLog.depthCurve(),
    closeCalls: runLog.closeCalls(),
    deathDecisions,
    divergence: { count: divergences, rate: decisions.length === 0 ? 0 : divergences / decisions.length },
    spellsByUse: countUse(decisions, "spell"),
    weaponsByUse: countUse(decisions, "weapon"),
    tokens: tally.session(),
    tokensByBackend: tally.byBackend(),
    calibration: input.calibration,
    lessonsLearned: input.lessonsLearned.slice(),
    lessonsInherited: input.lessonsInherited.slice(),
    lineageNames: input.lineageNames.slice(),
    chronicleHighlights: input.chronicleHighlights?.slice() ?? (highlightEvent === void 0 ? [] : [chronicleLine(highlightEvent, persona, () => 0)]),
    ...apprenticeship === void 0 ? {} : { apprenticeship }
  };
}
function telemetryCalibration(value) {
  const result = {};
  for (const [backend, metrics] of Object.entries(value)) {
    if (/trait|backstory|persona|biography|lore|quirk/i.test(backend) || metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) continue;
    const numbers = {};
    for (const [name, item] of Object.entries(metrics)) {
      if (!/trait|backstory|persona|biography|lore|quirk/i.test(name) && typeof item === "number" && Number.isFinite(item)) numbers[name] = item;
    }
    result[backend] = numbers;
  }
  return result;
}
function summaryForTelemetry(model) {
  return {
    persona: { name: model.headline.name, race: model.headline.race, class: model.headline.class },
    outcome: {
      ended: true,
      won: model.headline.outcome === "winner",
      depth_max: model.headline.deepestFeet / 50,
      turns: model.headline.turns,
      cause_of_death: model.headline.outcome === "death" ? model.headline.cause : null
    },
    top_kills: model.topKills.slice(0, 10),
    tokens: { input: model.tokens.inputTokens, output: model.tokens.outputTokens, calls: model.tokens.requests },
    calibration: telemetryCalibration(model.calibration)
  };
}

// src/laya/rows.ts
var PREFIX2 = "squire/laya/";
var CHUNK2 = 100;
var MAX_CHUNKS = 50;
var activeHuman = null;
function chunkKey2(runId, seq) {
  return `${PREFIX2}${runId}/${String(Math.floor(seq / CHUNK2)).padStart(8, "0")}`;
}
function rowId(install, runId, seq, pilot) {
  return `squire-${install}-${runId}-${String(seq * 2 + (pilot === "squire_goal" ? 0 : 1))}`;
}
async function allRows(store) {
  const rows = [];
  for (const key2 of await store.keys(PREFIX2)) {
    const chunk = await store.get(key2);
    if (Array.isArray(chunk)) rows.push(...chunk);
  }
  return rows;
}
async function exportRows(store) {
  const rows = await allRows(store);
  return rows.map((row2) => JSON.stringify(row2)).join("\n") + (rows.length > 0 ? "\n" : "");
}
async function countRows(store) {
  return (await allRows(store)).length;
}
function createRows(store, runId) {
  let pending = Promise.resolve();
  function write(operation) {
    const next = pending.then(operation, operation);
    pending = next.catch(() => {
    });
    return next;
  }
  async function change(rowId2, patch, allRuns = false) {
    for (const key2 of await store.keys(allRuns ? PREFIX2 : `${PREFIX2}${runId}/`)) {
      const value = await store.get(key2);
      if (!Array.isArray(value)) continue;
      const rows = value;
      const index = rows.findIndex((row2) => row2.id === rowId2);
      if (index < 0) continue;
      const next = rows.slice();
      next[index] = { ...rows[index], ...patch };
      await store.set(key2, next);
      return;
    }
  }
  activeHuman = (rowId2, answers) => write(() => change(rowId2, { human: answers }, true));
  return {
    append(row2, seq) {
      return write(async () => {
        const slot2 = seq * 2 + (row2.pilot === "squire_goal" ? 0 : 1);
        const key2 = chunkKey2(runId, slot2);
        const old = await store.get(key2);
        const rows = Array.isArray(old) ? old : [];
        await store.set(key2, [...rows.filter((entry) => entry.id !== row2.id), row2]);
        const keys = await store.keys(`${PREFIX2}${runId}/`);
        for (const stale of keys.slice(0, -MAX_CHUNKS)) await store.delete(stale);
      });
    },
    attachLaya(rowId2, adapter, answers, server) {
      return write(() => change(rowId2, { laya: { adapter, answers, ...server === void 0 ? {} : { server } } }));
    },
    /** Knight's Lessons can add a correction without changing the stable row id. */
    attachHuman(rowId2, answers) {
      return write(() => change(rowId2, { human: answers }));
    },
    async idle() {
      await pending;
    }
  };
}

// src/laya/shadow.ts
var PILOTS = [["goal", "squire_goal"], ["in_character", "squire_in_character"]];
function capturingNet(net, adapter) {
  return {
    transport: net.transport,
    async request(request2) {
      const reply = await net.request(request2);
      if (reply.ok) {
        try {
          const raw = JSON.parse(reply.body);
          if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
            const routing = raw["routing"];
            if (routing !== null && typeof routing === "object" && !Array.isArray(routing)) {
              const named3 = routing["adapter"];
              if (typeof named3 === "string") adapter(named3);
            }
          }
        } catch {
        }
      }
      return reply;
    }
  };
}
function createShadow(options) {
  const busy = /* @__PURE__ */ new Set();
  const pendingRows = /* @__PURE__ */ new Set();
  let reportedFailure = false;
  function failed() {
    if (reportedFailure) return;
    reportedFailure = true;
    options.log("Squire could not reach Laya for training. Check the Laya address in Setup.");
  }
  return {
    /** One teacher row is saved per known pilot, including when shadowing is off. */
    record(record5, seq, enabled, url, fallbacks = []) {
      if (record5.backend !== "Jev") return Promise.resolve();
      const ts = new Date(options.now()).toISOString();
      const tasks = [];
      for (const [questionId, pilot] of PILOTS) {
        const question = record5.request.questions[questionId];
        const answer = record5.answers[questionId];
        if (question === void 0 || answer === void 0) continue;
        const shouldSend = enabled && record5.backend === "Jev" && options.net !== null && !busy.has(pilot);
        if (shouldSend) busy.add(pilot);
        let rowWritten = () => {
        };
        const written = new Promise((resolve) => {
          rowWritten = resolve;
        });
        pendingRows.add(written);
        tasks.push((async () => {
          try {
            const install = await options.install;
            const id = rowId(install, options.runId, seq, pilot);
            const questions = { [questionId]: question };
            const row2 = {
              id,
              pilot,
              ts,
              state: record5.request.state,
              questions,
              jev: { model: record5.model ?? "jev-latest", answers: { [questionId]: answer } },
              outcome: { plan: record5.outcome }
            };
            await options.rows.append(row2, seq);
            rowWritten();
            if (!shouldSend || options.net === null) return;
            let adapter = "base";
            const request2 = { state: record5.request.state, questions };
            const backend = selfHosted("laya", "Laya", url, `laya:${pilot}`, fallbacks);
            const result = await ask(capturingNet(options.net, (value) => {
              adapter = value;
            }), backend, request2, options.now);
            if (!result.ok) {
              failed();
              return;
            }
            await options.rows.attachLaya(id, adapter, result.answers, backend.fallbacks === void 0 ? void 0 : result.server);
          } catch {
            failed();
          } finally {
            rowWritten();
            pendingRows.delete(written);
            if (shouldSend) busy.delete(pilot);
          }
        })());
      }
      return Promise.all(tasks).then(() => {
      });
    },
    async rowsReady() {
      await Promise.all([...pendingRows]);
    }
  };
}

// src/runtime.ts
var CHARACTER_FORMAT = "neo-angband/squire/character";
var MOD_VERSION = "0.1.1";
var LESSON_SEQ_BASE = 5e5;
function runIdFor(key2, now) {
  const base = (key2 ?? "char").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "char";
  return `${base}-${now.toString(36)}`;
}
function readCharacter(stored) {
  const env = stored !== null && typeof stored === "object" ? stored : null;
  if (env === null || env["format"] !== CHARACTER_FORMAT) return null;
  const data = env["data"];
  if (data === void 0 || typeof data["runId"] !== "string") return null;
  const kills = {};
  const raw = data["kills"];
  if (raw !== null && typeof raw === "object") {
    for (const [race, n] of Object.entries(raw)) if (typeof n === "number") kills[race] = n;
  }
  const j = data["journal"] ?? {};
  const journal = {
    runLog: typeof j["runLog"] === "string" ? j["runLog"] : "",
    chronicle: Array.isArray(j["chronicle"]) ? j["chronicle"].filter((l) => typeof l === "string") : [],
    lessons: Array.isArray(j["lessons"]) ? j["lessons"] : [],
    calibration: j["calibration"] !== null && typeof j["calibration"] === "object" ? j["calibration"] : {}
  };
  return {
    persona: data["persona"] == null ? null : normalize(data["persona"]),
    runId: data["runId"],
    kills,
    journal,
    lineage: typeof data["lineage"] === "string" ? data["lineage"] : null,
    orders: readInstructions(data["orders"]),
    flourishes: readWays(data["flourishes"]),
    storeMemory: readStoreMemory(data["storeMemory"])
  };
}
var current = null;
function runtime(host) {
  current ??= createRuntime(host);
  return current;
}
function createRuntime(host, options = {}) {
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? indexedDbStore("neo-angband-squire");
  let config = readConfig(host.prefs?.get());
  let character = readCharacter(host.characterStore?.get()) ?? {
    persona: null,
    runId: runIdFor(host.character?.key?.(), now()),
    kills: {},
    journal: emptyJournal(),
    lineage: null,
    orders: []
  };
  const tally = createTally(config.caps, config.spend);
  const log = createDecisionLog(store, character.runId);
  const logLoaded = log.load().catch(() => {
  });
  const layaRows = createRows(store, character.runId);
  const shadow = createShadow({ net: host.net ?? null, rows: layaRows, install: logLoaded.then(() => installId(store)), runId: character.runId, now, log: host.log });
  const listeners = /* @__PURE__ */ new Set();
  let brain = null;
  let lastTurn = 0;
  let ownCommandAt = null;
  const OWN_COMMAND_WINDOW_MS = 2e3;
  const tracked = (controller, terrain) => (view, act) => {
    lastTurn = view.turn();
    lastView = view;
    journal.observe(view);
    observeFamily(view);
    observeWays(view);
    strategy.remember(view, terrain);
    channel.tick();
    if (brain !== null) {
      strategy.observe(view);
      orders.observe(view);
    }
    const command = controller(view, act);
    if (command !== null) rememberUse(command, view);
    if (command !== null) ownCommandAt = Date.now();
    return command;
  };
  let lastView = null;
  let unsavedSpend = 0;
  let summary = null;
  const chronicleListeners = /* @__PURE__ */ new Set();
  const journal = createJournal(character.journal, {
    persona: () => character.persona,
    setPersona: (persona) => self.saveCharacter({ ...character, persona }),
    send: backendFor(config) === null || host.net === void 0 ? null : (request2) => self.send(request2),
    backend: backendFor(config)?.label ?? "none",
    save: (state) => self.saveCharacter({ ...character, journal: state }),
    onChronicle: (line) => {
      for (const l of chronicleListeners) l(line);
    }
  });
  const strategy = createStrategy({
    backend: () => backendFor(config),
    send: (request2) => self.send(request2),
    tally,
    now,
    log: (message) => host.log(message),
    feelings: () => feelingsNow(),
    persona: () => character.persona ?? activePersona(config),
    family: () => {
      const lineage = familyNow();
      if (lineage === null) return null;
      const depths = lineage.ancestors.map((a) => a.deepest ?? a.died?.depth ?? 0);
      return { deepest: depths.length === 0 ? null : Math.max(...depths), heir: lineage.generation > 1 };
    },
    storeMemory: character.storeMemory ?? [],
    saveStoreMemory: (storeMemory) => self.saveCharacter({ ...character, storeMemory })
  });
  const orders = createOrders({
    backend: () => backendFor(config),
    send: (request2) => self.send(request2),
    tally,
    now,
    persona: () => character.persona,
    setPersona: (persona) => self.saveCharacter({ ...character, persona }),
    kept: () => config.instructionsKept,
    note: (text, notable, turn, depth2) => journal.event({ kind: "instruction", turn, depth: depth2, text }, notable),
    log: (message) => host.log(message),
    save: (state) => self.saveCharacter({ ...character, orders: state.items })
  });
  orders.load({ items: character.orders });
  const channel = createChannelPoller({
    url: () => config.channelUrl,
    net: () => host.net ?? null,
    queue: (order) => {
      const result = queueInstruction(orders, order.text, "channel", { deferSort: true, ...order.viewer === "" ? {} : { viewer: order.viewer } });
      if (!result.ok) host.log(`Squire didn't take a viewer's order: ${result.problem}`);
    },
    flush: () => orders.flush(),
    log: (message) => host.log(message),
    now
  });
  const self = {
    config: () => config,
    saveConfig(next) {
      config = next;
      host.prefs?.set(writeConfig(next));
    },
    character: () => character,
    saveCharacter(next) {
      character = next;
      host.characterStore?.set({ format: CHARACTER_FORMAT, schemaVersion: 1, data: next });
    },
    backend: () => backendFor(config),
    async setJevKey(value) {
      const net = host.net;
      if (net === void 0) return "This version of the game cannot store keys for mods.";
      const trimmed = value.trim();
      if (trimmed === "") {
        await net.secrets.delete("jev");
        return "The Jev key is removed.";
      }
      const result = await net.secrets.set("jev", trimmed, { hosts: [new URL(JEV.url).host] });
      if (!result.ok) return result.problem ?? "The key could not be stored.";
      return net.secrets.storage === "page" ? "The key is saved in this browser's storage, where other mods in the page could read it. The desktop app keeps it encrypted instead." : "The key is saved, encrypted by your operating system.";
    },
    async jevKeyFromEnv() {
      const net = host.net;
      if (net === void 0) return "This version of the game cannot read keys for mods.";
      if (net.transport !== "relay") return "Reading a key from the environment works only in the desktop app.";
      const read = await net.secrets.fromEnv("jev", JEV_KEY_VARIABLES, { hosts: [new URL(JEV.url).host] });
      return read.ok ? "Squire will use the key from your environment." : read.problem;
    },
    async hasJevKey() {
      const net = host.net;
      if (net === void 0) return false;
      return (await net.secrets.has("jev")).present;
    },
    async testConnection() {
      const backend = backendFor(config);
      if (backend === null) return { ok: false, message: "No model server is chosen. Squire will run its errands." };
      const net = host.net;
      if (net === void 0) return { ok: false, message: "This version of the game cannot send requests for mods. Update the game to use a model." };
      if (backend.secret !== void 0 && !(await net.secrets.has(backend.secret)).present) {
        return { ok: false, message: `No API key is set for ${backend.label}. Paste one above, or read it from the environment.` };
      }
      const request2 = {
        state: { check: "Squire is testing its connection." },
        questions: { ready: { type: "noul", instructions: "Is this a connection test?", criteria: { true: "It is a test.", false: "It is not." } } }
      };
      const result = await ask(net, backend, request2, now);
      if (!result.ok) return { ok: false, message: result.failure.message, latencyMs: result.latencyMs };
      tally.record(backend, result.usage, now());
      return {
        ok: true,
        message: `Connected to ${backend.label}${result.model === null ? "" : ` (${result.model})`} in ${String(result.latencyMs)} ms.`,
        latencyMs: result.latencyMs,
        model: result.model
      };
    },
    send(request2) {
      const backend = backendFor(config);
      const net = host.net;
      if (backend === null || net === void 0) {
        return Promise.resolve({
          ok: false,
          latencyMs: 0,
          failure: { kind: "not-allowed", message: "No model server is set up.", retryable: false }
        });
      }
      return ask(net, backend, request2, now);
    },
    tally: () => tally,
    onDecision(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    decisionView: () => lastView,
    controllerFor(cfg, terrain, errands) {
      const backend = backendFor(config);
      const net = host.net;
      if (backend === null || net === void 0 || !cfg.useModel) {
        if (cfg.useModel && net === void 0) host.log("This game cannot send model requests. Squire chooses from its own offers.");
        return tracked(!cfg.useModel && !cfg.errandCampaign ? errands() : startBrain(backend ?? JEV, cfg, terrain, true) ?? errands(), terrain);
      }
      const ready = keyReady(net.secrets, backend, false, host.log);
      let chosen = null;
      let picked2 = null;
      ready.then(
        (ok) => picked2 = ok,
        () => picked2 = false
      );
      return (view, act) => {
        channel.tick();
        if (chosen === null) {
          if (picked2 === null) return null;
          chosen = startBrain(backend, cfg, terrain) ?? errands();
        }
        lastTurn = view.turn();
        lastView = view;
        journal.observe(view);
        observeFamily(view);
        observeWays(view);
        strategy.remember(view, terrain);
        if (brain !== null) {
          strategy.observe(view);
          orders.observe(view);
        }
        const command = chosen(view, act);
        if (command !== null) rememberUse(command, view);
        if (command !== null) ownCommandAt = Date.now();
        return command;
      };
    },
    brain: () => brain,
    takeOwnCommand(now2) {
      const own = ownCommandAt !== null && now2 - ownCommandAt >= 0 && now2 - ownCommandAt <= OWN_COMMAND_WINDOW_MS;
      ownCommandAt = null;
      return own;
    },
    recordKill(race, unique, view) {
      const kills = { ...character.kills, [race]: (character.kills[race] ?? 0) + 1 };
      const run = character.flourishes ?? emptyFlourishes();
      self.saveCharacter({ ...character, kills, ...unique ? { flourishes: { ...run, uniqueKills: [.../* @__PURE__ */ new Set([...run.uniqueKills, race])] } } : {} });
      journal.kill(race, unique, view);
      if (unique) settleGrudge(race);
      if (unique) rememberMilestone("unique", view?.player().depth ?? 0, race);
      if (view !== null) observeWays(view);
    },
    grudgeLines: () => feelingsNow().map(feelingLine),
    familyMemoryLines() {
      const lineage = familyNow();
      const persona = character.persona;
      if (lineage === null || persona === null) return self.grudgeLines();
      const epitaphs = [...lineage.inheritedEpitaphs ?? [], ...(lineage.epitaphs ?? []).filter((e) => e.generation === lineage.generation)];
      const milestones = [...lineage.inheritedMilestones ?? [], ...(lineage.milestones ?? []).filter((m) => m.generation === lineage.generation)];
      return [...self.grudgeLines(), ...persona.toggles.epitaphs ? epitaphs.slice(-3).map((e) => e.line) : [], ...persona.toggles.milestones ? milestones.slice(-5).map(milestoneFact) : []];
    },
    flourishLines: () => flourishLines(character.flourishes ?? emptyFlourishes(), character.persona),
    recordCommand: rememberUse,
    observe(view, terrain) {
      lastView = view;
      journal.observe(view);
      observeFamily(view);
      observeWays(view);
      if (terrain !== void 0) strategy.remember(view, terrain);
    },
    journal: () => journal,
    strategy: () => strategy,
    orders: () => orders,
    async lastSummary() {
      if (summary !== null) return summary;
      const stored = await store.get(`squire/reports/${character.runId}`);
      return stored === void 0 ? null : stored;
    },
    onChronicle(listener) {
      chronicleListeners.add(listener);
      return () => chronicleListeners.delete(listener);
    },
    store: () => store,
    exportDecisions: () => log.exportJsonl(),
    async recordLesson(request2, answers, model, n, knightGoal) {
      if (config.backend !== "jev") return;
      const seq = LESSON_SEQ_BASE + n;
      await shadow.record({ token: null, backend: "Jev", request: request2, context: null, answers, usage: { inputTokens: 0, outputTokens: 0, estimated: true }, model, latencyMs: 0, outcome: "lesson" }, seq, config.layaShadow.enabled, config.layaShadow.url, config.layaShadow.fallbacks);
      await layaRows.attachHuman(rowId(await installId(store), character.runId, seq, "squire_goal"), { goal: knightGoal });
    },
    async exportLayaRows() {
      await logLoaded;
      await shadow.rowsReady();
      await layaRows.idle();
      return exportRows(store);
    },
    async layaRowCount() {
      await logLoaded;
      await shadow.rowsReady();
      await layaRows.idle();
      return countRows(store);
    },
    decisions: () => logLoaded.then(() => log.records()),
    net: () => host.net ?? null
  };
  function personaFor() {
    if (character.persona !== null) return character.persona;
    const heir = config.pendingHeir;
    if (heir !== null) {
      const template = activePersona(config) ?? defaultPersona();
      const born = heirFrom(config.lineages[heir.lineage], heir.parent, normalize({ ...template, ...heir.name === void 0 ? {} : { name: heir.name } }), Math.random);
      self.saveConfig({ ...config, pendingHeir: null, ...born === null ? {} : { lineages: { ...config.lineages, [heir.lineage]: born.lineage } } });
      if (born !== null) {
        self.saveCharacter({ ...character, persona: born.persona, lineage: heir.lineage, flourishes: born.lineage.flourishes ?? emptyFlourishes() });
        orders.adopt(born.lineage.creeds ?? [], lastTurn);
        strategy.inherit(born.lineage.aims ?? []);
        host.log(`Squire's new character carries on the ${heir.lineage.trim() || "Squire"} line`);
        for (const feeling of born.lineage.feelings ?? []) host.log(feelingLog(born.persona.name, feeling));
        for (const line of self.flourishLines()) host.log(line);
        return born.persona;
      }
    }
    const chosen = activePersona(config);
    if (chosen === null) return null;
    const adopted = normalize(chosen);
    self.saveCharacter({ ...character, persona: adopted });
    return adopted;
  }
  function familyNow() {
    const name = character.lineage?.trim();
    return name === void 0 || name === "" ? null : config.lineages[name] ?? null;
  }
  function saveFamily(lineage) {
    const name = character.lineage?.trim() || character.persona?.name;
    if (name === void 0) return;
    if (!character.lineage?.trim()) self.saveCharacter({ ...character, lineage: name });
    self.saveConfig({ ...config, lineages: { ...config.lineages, [name]: lineage } });
  }
  function rememberMilestone(kind, depth2, fact) {
    const persona = character.persona;
    if (persona === null || !persona.toggles.milestones) return;
    const lineage = familyNow() ?? { name: persona.name, generation: 1, ancestors: [], lore: [], grudges: [] };
    const milestone = addMilestone(lineage, persona, kind, depth2, fact);
    if (milestone === null) return;
    const kept = (lineage.milestones ?? []).filter((m) => kind !== "depth" || m.kind !== "depth");
    saveFamily({ ...lineage, milestones: [...kept, milestone] });
    host.log(familyVoice(persona, milestoneFact(milestone)));
  }
  function observeFamily(view) {
    const persona = character.persona;
    if (persona === null || !persona.toggles.milestones) return;
    const lineage = familyNow();
    if (lineage !== null) {
      const recalled = recallMilestones(lineage, persona, view.player().depth, view.monsters().filter((m) => m.visible && m.raceFlags.includes("UNIQUE")).map((m) => m.race));
      if (recalled.length > 0) {
        saveFamily({ ...lineage, mentionedMilestones: [...lineage.mentionedMilestones ?? [], ...recalled.map(milestoneId)] });
        for (const milestone of recalled) host.log(familyVoice(persona, milestoneFact(milestone)));
      }
    }
    rememberMilestone("depth", view.player().maxDepth, "");
    const artifact = [...view.inventory(), ...view.equipment()].find((item) => item?.artifact && item.artifactName !== null);
    if (artifact !== void 0 && artifact !== null) rememberMilestone("artifact", view.player().depth, artifact.artifactName);
  }
  function feelingsNow() {
    const line = character.lineage?.trim();
    if (line === void 0 || line === "") return [];
    return config.lineages[line]?.feelings ?? [];
  }
  let seenInventory = null;
  function observeWays(view) {
    const run = character.flourishes ?? emptyFlourishes();
    const handles = new Set(view.inventory().map((i) => i.handle));
    const acquired = new Set([...handles].filter((h2) => seenInventory !== null && !seenInventory.has(h2)));
    seenInventory = handles;
    const before = flourishLines(run, character.persona);
    const next = observeFlourishes(run, view, character.persona, run.uniqueKills, acquired);
    if (JSON.stringify(next) !== JSON.stringify(run)) self.saveCharacter({ ...character, flourishes: next });
    for (const line of flourishLines(next, character.persona)) if (!before.includes(line)) host.log(line);
    const forgotten = run.superstitions.filter((s) => !next.superstitions.some((t) => t.key === s.key));
    for (const s of forgotten) {
      if (character.persona?.toggles.inheritedSuperstitions) host.log(`${character.persona.name} trusts the ${s.name} now.`);
    }
    const lineageName = character.lineage?.trim();
    const lineage = lineageName === void 0 ? void 0 : config.lineages[lineageName];
    if (lineageName !== void 0 && lineage?.flourishRecord !== void 0) {
      const family = lineage.flourishRecord;
      const learned = learnedSuperstitions(family.superstitions, view);
      if (learned.length > 0) self.saveConfig({ ...config, lineages: { ...config.lineages, [lineageName]: {
        ...lineage,
        flourishRecord: { ...family, superstitions: family.superstitions.filter((s) => !learned.some((t) => s.key === t.key)) }
      } } });
    }
  }
  function rememberUse(command, view) {
    const run = character.flourishes ?? emptyFlourishes();
    const lastUse = usedItem(command, view);
    if (lastUse === null && run.lastUse === null) return;
    self.saveCharacter({ ...character, flourishes: { ...run, lastUse } });
  }
  function settleGrudge(race) {
    const line = character.lineage?.trim();
    const lineage = line === void 0 || line === "" ? void 0 : config.lineages[line];
    if (line === void 0 || lineage === void 0) return;
    const before = (lineage.killers ?? []).find((k) => k.unique && k.name.toLowerCase() === race.toLowerCase());
    const killers = settle(lineage.killers ?? [], race, lineage.generation);
    if (before === void 0 || killers === null) return;
    const feelings = (lineage.feelings ?? []).filter((f) => f.name.toLowerCase() !== race.toLowerCase());
    self.saveConfig({ ...config, lineages: { ...config.lineages, [line]: { ...lineage, killers, feelings } } });
    host.log(settledLine(character.persona?.name ?? "Squire", before.name, remembered(before, lineage.generation)));
  }
  function startBrain(backend, cfg, terrain, rulesOnly = false) {
    const mark = host.controller?.markNondeterministic;
    if (!rulesOnly && mark === void 0) {
      host.log("This game cannot mark a save for model decisions. Squire chooses from its own offers.");
      rulesOnly = true;
    }
    if (!rulesOnly) mark?.call(host.controller);
    const persona = personaFor();
    brain = createBrain({
      backend,
      rulesOnly,
      planner: createGoalPlanner({
        cfg,
        terrain,
        ...host.core?.turnEnergy === void 0 ? {} : { speedEnergy: host.core.turnEnergy },
        log: host.log,
        persona: () => persona === null ? null : character.persona,
        backstoryTokens: backstoryBudget(config),
        lessons: (view) => journal.lessonLines(view),
        grudges: () => feelingsNow(),
        flourishes: () => character.flourishes ?? emptyFlourishes(),
        dreaded: () => dreadedRaces([...journal.lessons(), ...config.lineages[character.lineage?.trim() || "Squire"]?.lore ?? []]),
        calibrate: (probs) => journal.calibrate(probs),
        strategy: () => ({ aims: orders.promote(strategy.ranked()), tripAllowed: (gold) => strategy.tripAllowed(gold), storeMemory: strategy.shops(), pursuits: strategy.pursuits() }),
        orders
      }),
      tally,
      send: (request2) => self.send(request2),
      token: () => host.snapshot?.()?.token ?? null,
      now,
      log: host.log,
      status: (label, reason) => host.controller?.setStatus(reason === void 0 ? { label } : { label, reason }),
      onDecision: (record5) => {
        void logLoaded.then(() => logDecision(record5));
        for (const listener of listeners) listener(record5, lastTurn);
      },
      onPlanEnd: (end) => {
        void logLoaded.then(() => endDecision(end));
      },
      gauge: (view) => ({ turn: view.turn(), hp: view.player().hp, depth: view.player().depth })
    });
    host.log(rulesOnly ? "Squire has the keyboard and chooses from its current fight and travel offers." : `Squire has the keyboard and asks ${backend.label} what to do${persona === null ? "" : `, playing as ${persona.name}`}`);
    return brain.controller;
  }
  let openDecision = null;
  function endDecision(end) {
    if (openDecision === null) return;
    log.attachOutcome(openDecision, outcomeLine(end), end);
    openDecision = null;
    void log.flush();
  }
  function logDecision(record5) {
    const goal = record5.answers["goal"];
    const trace = record5.context.trace;
    const id = log.append({
      at: now(),
      turn: lastTurn,
      trigger: record5.reflex === void 0 ? "decision" : "reflex",
      backend: record5.backend,
      question: "goal",
      choice: trace?.pick ?? (goal?.type === "choice" ? goal.choice : ""),
      /* No model answered a reflex, so there is no confidence to log or calibrate. */
      confidence: goal?.type === "choice" && record5.reflex === void 0 ? goal.confidence : null,
      probs: goal?.type === "choice" && record5.reflex === void 0 ? goal.probabilities : null,
      ...record5.reflex === void 0 ? {} : { reflex: record5.reflex },
      state: record5.request.state,
      options: record5.context.offers.map((o) => o.goal),
      plan: record5.outcome,
      latencyMs: record5.latencyMs,
      ...record5.server === void 0 ? {} : { server: record5.server },
      inputTokens: record5.usage.inputTokens,
      outputTokens: record5.usage.outputTokens,
      estimatedTokens: record5.usage.estimated,
      ...trace === void 0 ? {} : {
        persona: {
          best: trace.advice,
          inCharacter: trace.inCharacter === null ? "" : Object.entries(trace.inCharacter).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
          blended: trace.pick,
          strength: trace.strength,
          removed: trace.removed.length > 0
        }
      }
    });
    openDecision = id;
    if (record5.reflex === void 0) void shadow.record(record5, Number(id.slice(id.lastIndexOf("/") + 1)), config.backend === "jev" && config.layaShadow.enabled, config.layaShadow.url, config.layaShadow.fallbacks);
    const logged = log.records().find((r) => r.id === id);
    if (logged !== void 0 && lastView !== null) journal.decided(logged, lastView);
    if (record5.reflex === void 0) unsavedSpend += 1;
    if (unsavedSpend >= 20) persistSpend();
    void log.flush();
  }
  function persistSpend() {
    unsavedSpend = 0;
    const t = now();
    const d = new Date(t);
    const day = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    self.saveConfig({ ...config, spend: { day, usd: tally.todayUsd(t) } });
  }
  host.character?.onRunEnd?.((report) => {
    void finishRun(report);
  });
  async function finishRun(report) {
    const passable = passableAims(strategy.ranked());
    strategy.reset();
    const creeds = orders.creeds();
    orders.reset();
    channel.reset();
    persistSpend();
    const blamed = report.outcome === "death" ? await journal.died(log.records(), report.cause, lastView) : null;
    await log.flush();
    const persona = character.persona ?? activePersona(config) ?? defaultPersona();
    const lineageName = character.lineage?.trim() || (report.name.trim() === "" ? "Squire" : report.name);
    const lineage = config.lineages[lineageName];
    try {
      const storedApprentice = await store.get("squire/apprentice");
      summary = buildRunSummary({
        report,
        runLog: journal.runLog(),
        decisions: log.records(),
        tally,
        persona,
        lessonsLearned: journal.lessons().map((l) => l.line),
        lessonsInherited: (lineage?.lore ?? []).map((l) => l.line),
        lineageNames: (lineage?.ancestors ?? []).map((a) => a.name),
        calibration: {},
        ...blamed === null ? {} : { blamedDecisionId: blamed },
        chronicleHighlights: journal.chronicle().slice(-5),
        ...storedApprentice === void 0 ? {} : { apprentice: storedApprentice }
      });
      await store.set(`squire/reports/${character.runId}`, summary);
    } catch (error) {
      host.log(`Squire could not build this run's report: ${String(error)}`);
    }
    if (report.outcome === "death" && character.persona !== null) {
      const died = { depth: report.maxDepth, cause: report.cause, turn: report.turn };
      const last = log.records().at(-1);
      const epitaph = epitaphFor(persona, { name: report.name.trim() || persona.name, generation: lineage?.generation ?? 1, cause: report.cause, depth: report.depth, level: report.level, action: last?.choice ?? "unknown" });
      if (epitaph !== null) host.log(epitaph.line);
      const next = {
        ...withAncestor(lineage, report.name, report.race, report.cls, died, journal.lessons(), lastView?.monsters() ?? []),
        deepest: report.maxDepth,
        turns: report.turn,
        epitaphs: [...lineage?.epitaphs ?? [], ...epitaph === null ? [] : [epitaph]].slice(-12),
        creeds,
        ...passable.length > 0 ? { aims: passable } : {},
        flourishRecord: familyAfterDeath(lineage?.flourishRecord ?? emptyFamilyFlourishes(), character.flourishes ?? emptyFlourishes(), lastView, persona)
      };
      if (!character.lineage?.trim()) self.saveCharacter({ ...character, lineage: lineageName });
      self.saveConfig({
        ...config,
        lineages: { ...config.lineages, [lineageName]: next },
        pendingHeir: brain !== null && config.rollOn !== "wait" ? { lineage: lineageName, parent: character.persona } : config.pendingHeir
      });
    }
    await sendTelemetry();
    await rollOn(report);
  }
  async function sendTelemetry() {
    const level = config.telemetry.level;
    if (level === "off" || config.telemetry.endpoint === "" || host.net === void 0 || summary === null) return;
    try {
      const batches = buildBatches(
        {
          installId: await installId(store),
          runId: character.runId,
          seq: 0,
          modVersion: MOD_VERSION,
          gameVersion: "unknown",
          summary: summaryForTelemetry(summary),
          decisions: log.records(),
          ...level === "full" ? { extra: { chronicle: journal.chronicle() } } : {},
          ...level === "full" && config.telemetry.backstoryConsent && character.persona !== null ? { backstory: character.persona.backstory, backstoryConsent: true } : {}
        },
        level
      );
      const sender = createSender({ net: host.net, store, endpoint: config.telemetry.endpoint, now, log: host.log });
      for (const batch of batches) await sender.send(batch);
    } catch (error) {
      host.log(`Squire could not build this run's telemetry, so none was sent: ${String(error)}`);
    }
  }
  async function rollOn(report) {
    if (report.outcome !== "death" || config.rollOn === "wait" || brain === null) return;
    const create = host.saves?.create;
    const abandon = (why) => {
      takeRollOn(sessionMarks(), now());
      if (config.pendingHeir !== null) self.saveConfig({ ...config, pendingHeir: null });
      if (why !== null) host.log(`Squire could not start the next character: ${why}`);
    };
    if (create === void 0) {
      abandon(null);
      return;
    }
    const like = config.rollOn === "like" ? report.birth : void 0;
    markRollOn(sessionMarks(), now());
    try {
      const result = await create.call(host.saves, like === void 0 ? { resumeAutoplayer: true } : { like, resumeAutoplayer: true });
      if (!result.ok) abandon(result.reason ?? "the game refused");
    } catch (error) {
      abandon(String(error));
    }
  }
  return self;
}

// src/terrain.ts
var SHOP_NAMES = {
  STORE_GENERAL: "General Store",
  STORE_ALCHEMY: "Alchemy Shop",
  STORE_WEAPON: "Weapon Smiths",
  STORE_ARMOR: "Armoury"
};
function readTerrain(features, tf) {
  const down = /* @__PURE__ */ new Set();
  const up = /* @__PURE__ */ new Set();
  const closed = /* @__PURE__ */ new Set();
  const open = /* @__PURE__ */ new Set();
  const shops = /* @__PURE__ */ new Set();
  const shopNames = /* @__PURE__ */ new Map();
  const harmful = /* @__PURE__ */ new Set();
  const diggable = /* @__PURE__ */ new Set();
  for (const feature of features) {
    const has = (flag) => flag > 0 && feature.flags.has(flag);
    if (has(tf.DOWNSTAIR)) down.add(feature.fidx);
    if (has(tf.UPSTAIR)) up.add(feature.fidx);
    if (has(tf.DOOR_CLOSED)) closed.add(feature.fidx);
    if (tf.CLOSABLE !== void 0 && has(tf.CLOSABLE)) open.add(feature.fidx);
    if (has(tf.SHOP)) {
      shops.add(feature.fidx);
      const name = SHOP_NAMES[feature.code];
      if (name !== void 0) shopNames.set(feature.fidx, name);
    }
    if (tf.ROCK !== void 0 && has(tf.ROCK) && !(tf.PERMANENT !== void 0 && has(tf.PERMANENT))) diggable.add(feature.fidx);
    if (has(tf.PASSABLE) && has(tf.FIERY)) harmful.add(feature.fidx);
  }
  return {
    isDownStair: (feat) => down.has(feat),
    isUpStair: (feat) => up.has(feat),
    isClosedDoor: (feat) => closed.has(feat),
    isOpenDoor: (feat) => open.has(feat),
    isShopEntrance: (feat) => shops.has(feat),
    shopName: (feat) => shopNames.get(feat) ?? null,
    isHarmful: (feat) => harmful.has(feat),
    isDiggable: (feat) => diggable.has(feat),
    size: features.length
  };
}
function noTerrain() {
  return {
    isDownStair: () => false,
    isUpStair: () => false,
    isClosedDoor: () => false,
    isShopEntrance: () => false,
    shopName: () => null,
    isHarmful: () => false,
    isDiggable: () => false,
    size: 0
  };
}

// src/orders/panel.ts
var ORDERS_HEADING = "Orders";
var ORDERS_EMPTY = "No orders. Give one below, or press Squire's order key (O unless that key is taken) while you play.";
var ORDER_PROMPT = "What does your patron order?";
var ORDER_PLACEHOLDER = "For example: suit up at the armour shop";
var KEPT_LABEL = "Instructions kept";
var KEPT_HELP = "How many orders and standing instructions the squire holds before it drops the one it follows least readily.";
var FAMILY_LABEL = "Family creed (heirs inherit it)";
var KIND_ORDER_LABEL = "Order";
var KIND_STANDING_LABEL = "Standing instruction";
var GIVE_LABEL = "Give";
var RETIRE_LABEL = "Retire";
var LOAD_CREED_LABEL = "Load creed";
var SAVE_CREED_LABEL = "Save creed";
var AUTO_KIND_LABEL = "Let the squire tell";
var CHANNEL_LABEL = "Viewer orders address";
var CHANNEL_PLACEHOLDER = "For example: http://127.0.0.1:8765/v1/orders";
var CHANNEL_HELP = "Squire Link can collect orders your viewers give in Twitch or Discord chat. Enter its orders address here and Squire checks it every few seconds while it plays. Leave it empty to take no orders from chat.";
function kindLabel(kind) {
  return kind === "order" ? "Order" : "Standing";
}
function viewerLabel(i) {
  return i.viewer === void 0 ? "" : ` from viewer ${i.viewer}`;
}
function sortedLine(sorted) {
  const parts = [];
  if (sorted.aim !== null) {
    const detail = sorted.aim === "depth" && sorted.depth !== null ? ` ${String(sorted.depth * 50)} ft` : sorted.aim === "item" && sorted.item !== null ? ` ${String(sorted.count)} ${sorted.item}` : sorted.aim === "gold" && sorted.gold !== null ? ` ${String(sorted.gold)} gold` : "";
    parts.push(`aim: ${sorted.aim}${detail}`);
  }
  if (sorted.trigger !== "always") parts.push(`when: ${sorted.trigger}`);
  if (sorted.response !== null) parts.push(`then: ${sorted.response}${sorted.avoids.length > 0 ? ` ${sorted.avoids.join(", ")}` : ""}`);
  if (sorted.store !== null) parts.push(`at: ${sorted.store}`);
  if (sorted.frequency.mode === "once") parts.push("how often: the first time");
  else if (sorted.frequency.mode === "until-level") parts.push(`how often: until level ${String(sorted.frequency.level)}`);
  return parts.length === 0 ? "kept as written" : parts.join("; ");
}

// src/telemetry/consent.ts
function describeLevel(level) {
  switch (level) {
    case "off":
      return "Sends nothing from this install.";
    case "summary":
      return "Sends how each run ended, its deepest level, top kills and token counts, with your character's name, race and class.";
    case "decisions":
      return "Sends the run summary and each decision's turn, kind, question, choice, confidence, probabilities and outcome.";
    case "full":
      return "Sends the run summary, decisions and extra run log; backstory is sent only with separate backstory consent.";
  }
}

// src/ui/dom.ts
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key2, value] of Object.entries(props)) {
    if (value === void 0 || value === null || value === false) continue;
    if (key2.startsWith("on") && typeof value === "function") {
      el.addEventListener(key2.slice(2).toLowerCase(), value);
    } else if (key2 === "class") {
      el.className = String(value);
    } else if (key2 in el && typeof value !== "string") {
      el[key2] = value;
    } else {
      el.setAttribute(key2, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === void 0 || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}
function fill(el, ...children) {
  el.replaceChildren();
  for (const child of children) {
    if (child === null || child === void 0 || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}
function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5e3);
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === void 0) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.click();
  });
}
var STYLE = `
:host { all: initial; }
/* Text grows with the window, from 13px at 1080p to 22px at 4K, times the panel's own A-/A+ scale. */
.squire { font: calc(clamp(13px, 0.68vw, 22px) * var(--squire-scale, 1))/1.45 system-ui, sans-serif; color: #e8e2d0; background: #14120f; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.tabs .size { margin-left: auto; }
.tabs { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid #3a342a; padding: 4px 4px 0; }
.tabs button { background: none; border: 1px solid transparent; border-bottom: none; color: #b9ae93; padding: 4px 8px; cursor: pointer; font: inherit; border-radius: 4px 4px 0 0; }
.tabs button[aria-selected="true"] { background: #221e18; color: #f2e6c4; border-color: #3a342a; }
.body { flex: 1; overflow: auto; padding: 10px; }
h3 { font-size: 1em; margin: 14px 0 6px; color: #f2c66d; }
h3:first-child { margin-top: 0; }
p { margin: 4px 0; }
.muted { color: #9b917a; }
.ok { color: #8fd18f; }
.bad { color: #ef8f7f; }
label { display: block; margin: 6px 0; }
input[type=text], input[type=password], input[type=number], select, textarea { width: 100%; box-sizing: border-box; background: #0c0b09; color: #e8e2d0; border: 1px solid #4a4336; border-radius: 3px; padding: 4px 6px; font: inherit; }
textarea { min-height: 70px; resize: vertical; }
input[type=range] { width: 100%; }
button.act { background: #3a2f1c; color: #f2e6c4; border: 1px solid #6b5a38; border-radius: 3px; padding: 4px 10px; cursor: pointer; font: inherit; margin: 4px 4px 4px 0; }
button.act:hover { background: #4a3c24; }
.row { display: flex; gap: 6px; align-items: center; }
.row > * { flex: 1; }
.slider { display: grid; grid-template-columns: 9em 1fr 2.5em; gap: 6px; align-items: center; margin: 3px 0; }
.slider .ends { grid-column: 2; font-size: 0.85em; color: #9b917a; display: flex; justify-content: space-between; margin-top: -4px; }
pre { background: #0c0b09; border: 1px solid #3a342a; padding: 6px; overflow: auto; max-height: 240px; font-size: 0.85em; }
.entry { border-top: 1px solid #2c271f; padding: 6px 0; }
.entry.disagree { color: #f2e6c4; }
.stat { display: inline-block; margin-right: 14px; }
.stat b { color: #f2c66d; }
canvas { width: 100%; background: #0c0b09; border: 1px solid #3a342a; }
`;

// src/ui/setup.ts
var BACKUP_HELP = "Squire tries these in order when the first server is busy or not answering, such as a second computer running Laya at http://192.168.1.21:8010/v1/systemone. Separate addresses with commas.";
var BRAINS = [
  ["jev", "Jev", "TypeSafe's hosted model. Fast and strong; it needs an API key and charges a small amount per decision."],
  ["laya", "Laya", "An open model you run on your own computer or home network. Free to use, but it plays worse until it has been trained on Squire's decisions."],
  ["custom", "Another server", "Any server that answers the same System One requests."],
  ["none", "No model", "Squire runs its fixed errands and asks nothing."]
];
var LEVELS = ["off", "summary", "decisions", "full"];
var ROLL_ON = [
  ["wait", "Stop and wait for you to make the next character"],
  ["like", "Start a new character like the last one"],
  ["random", "Start a new character of a random race and class"]
];
function mountSetup(body2, rt, done) {
  const status = h("p", { class: "muted" });
  const keyLine = h("p", { class: "muted" });
  let config = rt.config();
  function update2(patch) {
    config = { ...config, ...patch };
    rt.saveConfig(config);
  }
  function say(el, text, good) {
    el.textContent = text;
    el.className = good === void 0 ? "muted" : good ? "ok" : "bad";
  }
  const serverBox = h("div");
  function drawServer() {
    if (config.backend === "jev") {
      const key2 = h("input", { type: "password", placeholder: "Paste your Jev API key", autocomplete: "off" });
      fill(
        serverBox,
        h("label", {}, "Jev API key", key2),
        h(
          "div",
          { class: "row" },
          h("button", { class: "act", onclick: async () => say(keyLine, await rt.setJevKey(key2.value), true) }, "Save key"),
          h("button", { class: "act", onclick: async () => say(keyLine, await rt.jevKeyFromEnv()) }, "Use key from environment")
        ),
        keyLine,
        h("p", { class: "muted" }, "To get a key, sign up at typesafe.ai and create an API key there. In the desktop app, Squire can instead read TYPESAFE_API_KEY or JEV_API_KEY from your environment after you agree."),
        h("h3", {}, "Spend limits"),
        h("p", { class: "muted" }, "Squire pauses when a limit is reached. Zero means no limit. A decision costs a few thousandths of a cent."),
        h(
          "div",
          { class: "row" },
          h("label", {}, "Per session ($)", numberInput(config.caps.perSessionUsd, (v) => update2({ caps: { ...config.caps, perSessionUsd: v } }))),
          h("label", {}, "Per day ($)", numberInput(config.caps.perDayUsd, (v) => update2({ caps: { ...config.caps, perDayUsd: v } })))
        )
      );
      void rt.hasJevKey().then((has) => {
        if (keyLine.textContent === "") say(keyLine, has ? "A key is set." : "No key is set yet.", has);
      });
    } else if (config.backend === "laya" || config.backend === "custom") {
      const url = h("input", { type: "text", value: config.serverUrl, placeholder: LAYA_DEFAULT_URL });
      url.addEventListener("change", () => update2({ serverUrl: url.value.trim() }));
      const backups = h("input", { type: "text", value: config.serverFallbacks.join(", ") });
      backups.addEventListener("change", () => update2({ serverFallbacks: parseAddresses(backups.value) }));
      const model = h("input", { type: "text", value: config.serverModel, placeholder: "Leave empty for the server's default" });
      model.addEventListener("change", () => update2({ serverModel: model.value.trim() }));
      fill(
        serverBox,
        h("label", {}, "Server address", url),
        h("p", { class: "muted" }, "Use localhost or an IP address on your home network, such as http://192.168.1.20:8010/v1/systemone. A name like laya.lan is not allowed."),
        h("label", {}, "Backup server addresses", backups),
        h("p", { class: "muted" }, BACKUP_HELP),
        h("label", {}, "Model name", model),
        h("label", {}, "Context size (tokens)", numberInput(config.contextTokens, (v) => update2({ contextTokens: Math.max(512, Math.round(v)) })))
      );
    } else {
      fill(serverBox, h("p", { class: "muted" }, "With no model, a handover runs one errand: fight what is in front of you, explore the floor, or the long errand if it is switched on."));
    }
  }
  const brainBox = h("div");
  for (const [choice2, label, help] of BRAINS) {
    const radio = h("input", { type: "radio", name: "squire-brain", checked: config.backend === choice2 });
    radio.addEventListener("change", () => {
      update2({ backend: choice2 });
      drawServer();
    });
    brainBox.append(h("label", {}, radio, ` ${label}: `, h("span", { class: "muted" }, help)));
  }
  const test = h("button", {
    class: "act",
    onclick: async () => {
      say(status, "Testing...");
      const result = await rt.testConnection();
      say(status, result.message, result.ok);
    }
  }, "Test connection");
  const shadowEnabled = h("input", { type: "checkbox", checked: config.layaShadow.enabled });
  shadowEnabled.addEventListener("change", () => update2({ layaShadow: { ...config.layaShadow, enabled: shadowEnabled.checked } }));
  const shadowUrl = h("input", { type: "text", value: config.layaShadow.url, placeholder: LAYA_DEFAULT_URL });
  shadowUrl.addEventListener("change", () => update2({ layaShadow: { ...config.layaShadow, url: shadowUrl.value.trim() || LAYA_DEFAULT_URL } }));
  const shadowBackups = h("input", { type: "text", value: config.layaShadow.fallbacks.join(", ") });
  shadowBackups.addEventListener("change", () => update2({ layaShadow: { ...config.layaShadow, fallbacks: parseAddresses(shadowBackups.value) } }));
  const rowCount = h("p", { class: "muted" }, "Counting saved rows...");
  void rt.layaRowCount().then((count2) => {
    rowCount.textContent = `${String(count2)} training rows saved.`;
  });
  const shadowBox = h(
    "div",
    {},
    h("h3", {}, "Train Laya while Jev plays"),
    h("label", {}, shadowEnabled, " Send decisions to Laya (off by default)"),
    h("p", { class: "muted" }, "Squire sends each decision to Laya too. It never acts on Laya's answer."),
    h("label", {}, "Laya address (default: localhost:8010)", shadowUrl),
    h("label", {}, "Backup server addresses", shadowBackups),
    h("p", { class: "muted" }, BACKUP_HELP),
    h("button", { class: "act", onclick: async () => download("squire-laya-rows.jsonl", await rt.exportLayaRows(), "application/x-ndjson") }, "Save Laya training rows"),
    rowCount
  );
  const telemetry = telemetryBox(rt, () => config, update2);
  const rollOn = h("select");
  for (const [value, label] of ROLL_ON) rollOn.append(h("option", { value, selected: config.rollOn === value }, label));
  rollOn.addEventListener("change", () => update2({ rollOn: rollOn.value }));
  const knights = h("input", { type: "checkbox", checked: config.knightsLessons.enabled });
  knights.addEventListener("change", () => update2({ knightsLessons: { ...config.knightsLessons, enabled: knights.checked } }));
  const channelInput = h("input", { type: "text", value: config.channelUrl, placeholder: CHANNEL_PLACEHOLDER });
  channelInput.addEventListener("change", () => update2({ channelUrl: channelInput.value.trim() }));
  body2.append(
    h("h3", {}, "Pick a brain"),
    brainBox,
    serverBox,
    shadowBox,
    h("div", {}, test),
    status,
    h("h3", {}, "When a character dies"),
    rollOn,
    h("p", { class: "muted" }, "Only for characters Squire is playing. Your own characters are never replaced."),
    h("h3", {}, "Knight's Lessons"),
    h("label", {}, knights, " Learn from how I play while I have the keyboard"),
    h("h3", {}, ORDERS_HEADING),
    h("label", {}, KEPT_LABEL, keptInput(config.instructionsKept, (v) => update2({ instructionsKept: v }))),
    h("p", { class: "muted" }, KEPT_HELP),
    h("label", {}, CHANNEL_LABEL, channelInput),
    h("p", { class: "muted" }, CHANNEL_HELP),
    telemetry,
    h("div", {}, h("button", { class: "act", onclick: () => {
      update2({ setupDone: true });
      done();
    } }, "Next: choose a persona"))
  );
  drawServer();
  return () => {
  };
}
function keptInput(value, change) {
  const input = h("input", { type: "number", min: String(MIN_INSTRUCTIONS_KEPT), max: String(MAX_INSTRUCTIONS_KEPT), step: "1", value: String(value) });
  input.addEventListener("change", () => {
    const v = Math.round(Number(input.value));
    if (Number.isFinite(v)) change(Math.min(MAX_INSTRUCTIONS_KEPT, Math.max(MIN_INSTRUCTIONS_KEPT, v)));
  });
  return input;
}
function numberInput(value, change) {
  const input = h("input", { type: "number", min: "0", step: "any", value: String(value) });
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= 0) change(v);
  });
  return input;
}
function telemetryBox(rt, config, update2) {
  const describe = h("p", { class: "muted" }, describeLevel(config().telemetry.level));
  const level = h("select");
  for (const l of LEVELS) level.append(h("option", { value: l, selected: config().telemetry.level === l }, l === "off" ? "Off" : l[0].toUpperCase() + l.slice(1)));
  level.addEventListener("change", () => {
    const next = level.value;
    update2({ telemetry: { ...config().telemetry, level: next, asked: true } });
    describe.textContent = describeLevel(next);
  });
  const backstory = h("input", { type: "checkbox", checked: config().telemetry.backstoryConsent });
  backstory.addEventListener("change", () => update2({ telemetry: { ...config().telemetry, backstoryConsent: backstory.checked } }));
  const endpoint = h("input", { type: "text", value: config().telemetry.endpoint });
  endpoint.addEventListener("change", () => update2({ telemetry: { ...config().telemetry, endpoint: endpoint.value.trim() } }));
  const result = h("p", { class: "muted" });
  return h(
    "div",
    {},
    h("h3", {}, "Share runs with the Squire project"),
    h("p", { class: "muted" }, "Finished runs can be sent to squire.rpgm.tools, which keeps them for 180 days and posts a short summary of each run to the Neo Angband Discord. The privacy note is at squire.rpgm.tools."),
    h("label", {}, "What to send", level),
    describe,
    h("label", {}, backstory, " Also send my persona's backstory, at the Full level"),
    h("label", {}, "Endpoint (empty sends nothing)", endpoint),
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "act",
        onclick: async () => {
          const net = rt.net();
          if (net === null) {
            result.textContent = "This version of the game cannot send requests for mods.";
            return;
          }
          result.textContent = "Asking the server to delete everything from this install...";
          const id = await installId(rt.store());
          const sender = createSender({ net, store: rt.store(), endpoint: config().telemetry.endpoint || DEFAULT_ENDPOINT, now: Date.now, log: () => {
          } });
          const reply = await sender.deleteInstall(id);
          result.textContent = reply.ok ? "Everything sent from this install has been deleted." : `Could not delete: ${reply.reason}`;
        }
      }, "Delete what I have sent")
    ),
    result
  );
}

// src/persona/file.ts
function exportPersona(persona) {
  return JSON.stringify({ format: "neo-angband/squire/persona", schemaVersion: 1, data: normalize(persona) }, null, 2) + "\n";
}
function importPersona(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: "This file is not valid JSON." };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "This file is not a Squire persona." };
  }
  const file = raw;
  if (file["format"] !== "neo-angband/squire/persona") {
    return { ok: false, problem: "This file is not a Squire persona." };
  }
  if (typeof file["schemaVersion"] === "number" && file["schemaVersion"] > 1) {
    return { ok: false, problem: "This file is from a newer Squire." };
  }
  if (file["schemaVersion"] !== 1 || file["data"] === null || typeof file["data"] !== "object" || Array.isArray(file["data"])) {
    return { ok: false, problem: "This file is not a supported Squire persona." };
  }
  return { ok: true, persona: normalize(file["data"]) };
}

// src/ui/persona-sheet.ts
var GROUP_NAMES = {
  temperament: "Temperament",
  values: "Values",
  affinities: "Likes and dislikes",
  habits: "Habits",
  tactics: "Tactics",
  economy: "Money",
  quirks: "Quirks",
  lineage: "Lineage",
  patron: "Patron",
  meta: "How Squire plays it"
};
function mountPersona(body2, rt) {
  const sheet = h("div");
  const message = h("p", { class: "muted" });
  let config = rt.config();
  let index = Math.max(0, config.activePersona);
  function current2() {
    return config.personas[index] ?? defaultPersona();
  }
  function store(p) {
    const personas = config.personas.slice();
    personas[index] = normalize(p);
    config = { ...config, personas };
    rt.saveConfig(config);
  }
  function add2(p) {
    const personas = [...config.personas, normalize(p)].slice(-50);
    index = personas.length - 1;
    config = { ...config, personas, activePersona: index };
    rt.saveConfig(config);
    draw();
  }
  const library = h("select");
  const active2 = h("input", { type: "checkbox" });
  active2.addEventListener("change", () => {
    config = { ...config, activePersona: active2.checked ? index : -1 };
    rt.saveConfig(config);
  });
  library.addEventListener("change", () => {
    index = Number(library.value);
    draw();
  });
  const presets = h("select");
  presets.append(h("option", { value: "" }, "Start a new persona from..."), h("option", { value: "default" }, "Default"), h("option", { value: "random" }, "Random"));
  for (const id of Object.keys(ARCHETYPES)) presets.append(h("option", { value: id }, id[0].toUpperCase() + id.slice(1)));
  presets.addEventListener("change", () => {
    const v = presets.value;
    presets.value = "";
    if (v === "default") add2(defaultPersona("New persona"));
    else if (v === "random") add2(randomPersona(Math.random, "Wanderer"));
    else if (v !== "") add2(archetype(v));
  });
  function draw() {
    config = rt.config();
    fill(library, ...config.personas.map((p2, i) => h("option", { value: String(i), selected: i === index }, p2.name)));
    active2.checked = config.activePersona === index;
    const p = current2();
    const playing = rt.character().persona;
    const name = h("input", { type: "text", value: p.name, maxlength: "40" });
    name.addEventListener("change", () => {
      store({ ...current2(), name: name.value.trim() || "Squire" });
      draw();
    });
    const backstory = h("textarea", { placeholder: "Who is this character? Where are they from, what do they want, what do they fear?" }, p.backstory);
    backstory.addEventListener("change", () => store({ ...current2(), backstory: backstory.value }));
    const groups = GROUPS.map((group) => {
      const rows = PARAMETERS.filter((param) => param.group === group).map((param) => row(param, () => current2(), store));
      return h("div", {}, h("h3", {}, GROUP_NAMES[group]), ...rows);
    });
    fill(
      sheet,
      playing === null ? null : h("p", { class: "muted" }, `This character plays as ${playing.name}. Changes here apply to new characters.`),
      h("label", {}, "Name", name),
      h("label", {}, "Backstory", backstory),
      ...groups
    );
  }
  body2.append(
    h("h3", {}, "Personas"),
    h("div", { class: "row" }, library, presets),
    h("label", {}, active2, " New characters play as this persona"),
    h(
      "div",
      {},
      h("button", { class: "act", onclick: () => download(`${current2().name.replace(/[^A-Za-z0-9_-]+/g, "_")}.persona.json`, exportPersona(current2())) }, "Export"),
      h("button", {
        class: "act",
        onclick: async () => {
          const text = await pickFile(".json,application/json");
          if (text === null) return;
          const result = importPersona(text);
          if (result.ok) {
            add2(result.persona);
            message.textContent = `Imported ${result.persona.name}.`;
          } else {
            message.textContent = result.problem;
          }
        }
      }, "Import"),
      h("button", {
        class: "act",
        onclick: () => {
          if (config.personas.length <= 1) return;
          const personas = config.personas.filter((_, i) => i !== index);
          index = 0;
          config = { ...config, personas, activePersona: Math.min(config.activePersona, personas.length - 1) };
          rt.saveConfig(config);
          draw();
        }
      }, "Delete")
    ),
    message,
    sheet
  );
  draw();
  return () => {
  };
}
function row(param, get, save) {
  const [low, high] = param.scale.split(" to ");
  switch (param.kind) {
    case "slider": {
      const id = param.id;
      const value = h("span", {}, String(get().sliders[id]));
      const input = h("input", { type: "range", min: "0", max: "100", value: String(get().sliders[id]), title: param.description });
      input.addEventListener("input", () => value.textContent = input.value);
      input.addEventListener("change", () => save({ ...get(), sliders: { ...get().sliders, [id]: Number(input.value) } }));
      return h(
        "div",
        { title: param.description },
        h("div", { class: "slider" }, h("span", {}, param.name), input, value),
        h("div", { class: "slider" }, h("span", {}), h("div", { class: "ends" }, h("span", {}, low ?? ""), h("span", {}, high ?? "")))
      );
    }
    case "list": {
      const id = param.id;
      const input = h("input", { type: "text", value: get().lists[id].join(", "), placeholder: param.scale });
      input.addEventListener(
        "change",
        () => save({ ...get(), lists: { ...get().lists, [id]: input.value.split(",").map((s) => s.trim()).filter((s) => s !== "") } })
      );
      return h("label", { title: param.description }, param.name, input);
    }
    case "quirk": {
      const id = param.id;
      const on = h("input", { type: "checkbox", checked: get().quirks[id].on });
      const strength = h("input", { type: "range", min: "0", max: "100", value: String(get().quirks[id].strength) });
      const update2 = () => save({ ...get(), quirks: { ...get().quirks, [id]: { on: on.checked, strength: Number(strength.value) } } });
      on.addEventListener("change", update2);
      strength.addEventListener("change", update2);
      return h("div", { class: "slider", title: param.description }, h("label", {}, on, ` ${param.name}`), strength, h("span", {}));
    }
    case "toggle": {
      const id = param.id;
      const on = h("input", { type: "checkbox", checked: get().toggles[id] });
      on.addEventListener("change", () => save({ ...get(), toggles: { ...get().toggles, [id]: on.checked } }));
      return h("label", { title: param.description }, on, ` ${param.name}: `, h("span", { class: "muted" }, param.description));
    }
    case "number": {
      const input = h("input", { type: "number", min: "0", max: "4000", value: String(get().backstoryCap) });
      input.addEventListener("change", () => save({ ...get(), backstoryCap: Number(input.value) }));
      return h("label", { title: param.description }, `${param.name} (tokens)`, input);
    }
  }
}

// src/ui/lessons.ts
function mountLessons(body2, lessons) {
  const head = h("div");
  const list = h("div");
  const style = h("div");
  const ghost = h("p", { class: "muted" });
  const examButton = h("button", { class: "act", onclick: () => lessons.takeExam() }, "Take an exam");
  const examNote = h("span", { class: "muted" });
  const ghostCheck = h("input", { type: "checkbox", checked: lessons.ghostEnabled() });
  ghostCheck.addEventListener("change", () => lessons.setGhost(ghostCheck.checked));
  function draw(a) {
    const share3 = a.total === 0 ? 0 : Math.round(a.agreed / a.total * 100);
    fill(
      head,
      h("p", {}, h("span", { class: "stat" }, "Rank ", h("b", {}, rankOf(a))), h("span", { class: "stat" }, "Agreement ", h("b", {}, `${String(share3)}%`)), h("span", { class: "stat" }, "Lessons ", h("b", {}, String(a.total))))
    );
    ghost.textContent = lessons.ghostEnabled() ? a.ghostHint ?? "" : "";
    const inferred = lessons.inferred();
    const own = lessons.squirePersona();
    const canvas = h("canvas", { width: "600", height: "260" });
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      if (own !== null) drawRadar(ctx, own, 150, 130, 70, "#d9ac64");
      drawRadar(ctx, inferred.persona, 450, 130, 70, "#8fd18f", inferred.confidence);
    }
    const rows = LESSON_SLIDERS.map((key2) => {
      const parameter = PARAMETERS.find((item) => item.id === key2);
      const confidence = inferred.confidence[key2];
      return h(
        "div",
        { class: "slider", style: confidence < 0.5 ? "opacity: 0.5" : "" },
        h("span", {}, parameter?.name ?? key2),
        h("input", { type: "range", min: "0", max: "100", value: String(inferred.persona.sliders[key2]), disabled: true }),
        h("span", {}, String(inferred.persona.sliders[key2]))
      );
    });
    fill(
      style,
      h("h3", {}, "Play like me"),
      h("div", { class: "row" }, h("span", {}, own?.name ?? "Squire"), h("span", {}, "Your style")),
      canvas,
      ...rows,
      h("button", { class: "act", onclick: () => lessons.savePersona(false) }, "Save as a persona"),
      h("button", { class: "act", onclick: () => lessons.savePersona(true) }, "Use it")
    );
    examButton.hidden = a.entries.filter((entry) => entry.signature !== void 0).length < 40;
    examButton.disabled = a.examArmed;
    examNote.hidden = examButton.hidden;
    examNote.textContent = a.examArmed ? " Exam ready. Press Ctrl-Z, and Squire's first 20 choices are scored against yours." : " After your next Ctrl-Z, Squire's first 20 choices are scored against yours.";
    const recent = a.entries.slice(-40).reverse();
    fill(
      list,
      recent.length === 0 ? h("p", { class: "muted" }, "Nothing noted yet. Play on, and the squire notes what you do each time something happens: a creature appears, you get hurt, or you reach a new level.") : null,
      ...recent.map((entry) => entryRow(entry, lessons))
    );
  }
  body2.append(
    h("p", { class: "muted" }, "While you play, Squire watches as your apprentice. It forms its own choice at each moment that matters and notes where yours differed. It never acts, so your character stays yours."),
    head,
    ghost,
    h("label", {}, ghostCheck, " Show Squire's choice when it differs"),
    style,
    examButton,
    examNote,
    h("button", { class: "act", onclick: () => lessons.watchThis() }, "Watch this"),
    h("span", { class: "muted" }, " Your next five choices count double."),
    list
  );
  draw(lessons.apprentice());
  return lessons.onChange(draw);
}
function entryRow(entry, lessons) {
  const reasons = entry.agreed || entry.reason !== void 0 ? null : h(
    "div",
    {},
    h("span", { class: "muted" }, "Why, sir? "),
    ...WHY_REASONS.map((reason) => h("button", { class: "act", onclick: () => lessons.why(entry, reason) }, reason))
  );
  return h(
    "div",
    { class: entry.agreed ? "entry" : "entry disagree" },
    entry.line,
    entry.demonstration ? h("span", { class: "muted" }, " (demonstration)") : null,
    entry.reason === void 0 ? null : h("span", { class: "muted" }, ` Because: ${entry.reason}.`),
    reasons
  );
}

// src/strategy/panel.ts
var AIMS_HEADING = "Aims";
var AIMS_EMPTY = "No aims yet. Squire reviews them at each new level.";
function feet(level) {
  return `${String(level * 50)} ft`;
}
function how(aim, state) {
  switch (aim.how) {
    case "save":
      return affordable(aim, state.gold) ? `buy for ${String(aim.price)} gold` : `save ${String(aim.price)} gold (have ${String(state.gold)})`;
    case "hunt":
      return "hunt in the dungeon";
    case "try":
      return "try what is in the pack";
    case "dive":
      return `reach ${feet(aim.depth ?? 0)} (now ${feet(state.depth)})`;
  }
}
function aimLines(aims, state) {
  if (aims.length === 0) return [AIMS_EMPTY];
  return aims.map((aim, i) => `${String(i + 1)}. ${aim.label.charAt(0).toUpperCase()}${aim.label.slice(1)}: ${how(aim, state)}`);
}

// src/ui/dashboard.ts
function mountDashboard(body2, rt) {
  const stats = h("div");
  const chart = h("canvas", { width: "600", height: "140" });
  const recent = h("div");
  const chronicle = h("div");
  const aimsBox = h("div");
  const grudgesBox = h("div");
  const rows = [];
  function drawStats() {
    const t = rt.tally().session();
    const brain = rt.brain();
    const state = brain === null ? "not playing" : brain.state();
    const divergent = rows.filter((r) => r.against).length;
    fill(
      stats,
      h(
        "p",
        {},
        h("span", { class: "stat" }, "Squire is ", h("b", {}, state)),
        h("span", { class: "stat" }, "Decisions ", h("b", {}, String(t.requests))),
        h("span", { class: "stat" }, "Tokens ", h("b", {}, t.inputTokens.toLocaleString())),
        t.usd > 0 ? h("span", { class: "stat" }, "Cost ", h("b", {}, `$${t.usd.toFixed(3)}`)) : null,
        rows.length > 0 ? h("span", { class: "stat" }, "Against advice ", h("b", {}, `${String(Math.round(divergent / rows.length * 100))}%`)) : null
      ),
      brain?.stoppedBecause() ? h("p", { class: "bad" }, brain.stoppedBecause() ?? "") : null
    );
  }
  function drawChart() {
    const g = chart.getContext("2d");
    if (g === null) return;
    const points = rt.journal().runLog().depthCurve();
    g.fillStyle = "#0c0b09";
    g.fillRect(0, 0, chart.width, chart.height);
    if (points.length < 2) {
      g.fillStyle = "#9b917a";
      g.font = "12px system-ui";
      g.fillText("The depth chart fills in as the character goes down.", 10, 20);
      return;
    }
    const first = points[0].turn;
    const span = Math.max(1, points[points.length - 1].turn - first);
    const deepest = Math.max(1, ...points.map((p) => p.depth));
    g.strokeStyle = "#f2c66d";
    g.lineWidth = 2;
    g.beginPath();
    points.forEach((p, i) => {
      const x = 10 + (p.turn - first) / span * (chart.width - 20);
      const y = 10 + p.depth / deepest * (chart.height - 20);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    g.fillStyle = "#9b917a";
    g.font = "11px system-ui";
    g.fillText(`deepest ${String(deepest * 50)} ft`, 10, chart.height - 4);
  }
  function drawRecent() {
    fill(
      recent,
      rows.length === 0 ? h("p", { class: "muted" }, "No decisions yet. Hand the keyboard to Squire with Ctrl-Z.") : null,
      ...rows.slice(-12).reverse().map(
        (r) => h("div", { class: r.against ? "entry disagree" : "entry" }, `Turn ${String(r.turn)}: ${r.pick.replace(/_/g, " ")} (${String(Math.round(r.confidence * 100))}%)${r.against ? ", against advice" : ""}`)
      )
    );
  }
  function drawChronicle() {
    const lines2 = rt.journal().chronicle();
    fill(chronicle, lines2.length === 0 ? h("p", { class: "muted" }, "Notable moments land here.") : null, ...lines2.slice(-15).reverse().map((l) => h("div", { class: "entry" }, l)));
  }
  function drawAims() {
    const player = rt.decisionView()?.player();
    const lines2 = aimLines(rt.strategy().ranked(), { gold: player?.gold ?? 0, depth: player?.depth ?? 0 });
    fill(aimsBox, ...lines2.map((l) => h("div", { class: "entry" }, l)));
    const grudges = [...rt.familyMemoryLines(), ...rt.flourishLines()];
    fill(grudgesBox, grudges.length === 0 ? null : h("h3", {}, "Family memory"), ...grudges.map((l) => h("div", { class: "entry" }, l)));
  }
  function drawAll() {
    drawStats();
    drawAims();
    drawChart();
    drawRecent();
    drawChronicle();
  }
  const opened = Date.now();
  void rt.decisions().then((logged) => {
    const earlier = logged.filter((d) => d.at < opened).map((d) => ({ turn: d.turn, pick: d.choice, confidence: d.confidence ?? 0, against: d.persona !== void 0 && d.persona.best !== d.persona.blended }));
    rows.unshift(...earlier.slice(-500));
    drawAll();
  });
  const offDecision = rt.onDecision((record5, turn) => {
    const goal = record5.answers["goal"];
    const trace = record5.context.trace;
    rows.push({
      turn,
      pick: trace?.pick ?? (goal?.type === "choice" ? goal.choice : "?"),
      confidence: goal?.type === "choice" ? goal.confidence : 0,
      against: trace !== void 0 && trace.pick !== trace.advice
    });
    if (rows.length > 500) rows.splice(0, rows.length - 500);
    drawAll();
  });
  const offChronicle = rt.onChronicle(() => drawChronicle());
  const timer = setInterval(() => {
    drawStats();
    drawAims();
  }, 1e3);
  body2.append(h("h3", {}, "Now"), stats, h("h3", {}, AIMS_HEADING), aimsBox, grudgesBox, h("h3", {}, "Depth"), chart, h("h3", {}, "Recent decisions"), recent, h("h3", {}, "Chronicle"), chronicle);
  drawAll();
  return () => {
    offDecision();
    offChronicle();
    clearInterval(timer);
  };
}

// src/report/card.ts
var DEFAULT_CARD_THEME = {
  background: "#101820",
  foreground: "#f4f0e8",
  muted: "#aeb8bb",
  accent: "#d9ac64"
};
function fitted(ctx, text, x, y, width) {
  if (ctx.measureText(text).width <= width) {
    ctx.fillText(text, x, y);
    return;
  }
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}...`).width > width) end -= 1;
  ctx.fillText(`${text.slice(0, end)}...`, x, y);
}
function drawCard(ctx, model, theme = DEFAULT_CARD_THEME) {
  ctx.save();
  try {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = theme.accent;
    ctx.font = "22px sans-serif";
    ctx.fillText("SQUIRE RUN", 56, 62);
    ctx.fillStyle = theme.foreground;
    ctx.font = "bold 54px sans-serif";
    fitted(ctx, model.headline.name, 56, 132, 650);
    ctx.font = "24px sans-serif";
    fitted(ctx, `${model.headline.race} ${model.headline.class}  |  Level ${String(model.headline.level)}`, 56, 177, 650);
    ctx.fillStyle = theme.accent;
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(model.headline.outcome.toUpperCase(), 56, 236);
    ctx.fillStyle = theme.foreground;
    ctx.font = "22px sans-serif";
    fitted(ctx, model.headline.outcome === "death" ? `Cause: ${model.headline.cause}` : model.headline.cause, 56, 274, 650);
    ctx.fillText(`Deepest: ${String(model.headline.deepestFeet)} ft`, 56, 318);
    if (model.apprenticeship !== void 0) {
      ctx.font = "18px sans-serif";
      fitted(ctx, `Apprentice: ${model.apprenticeship.rank} rank, agreed ${String(Math.round(model.apprenticeship.agreementShare * 100))}%`, 56, 341, 650);
    }
    ctx.fillStyle = theme.muted;
    ctx.font = "18px sans-serif";
    ctx.fillText("Top kills", 56, 370);
    ctx.fillStyle = theme.foreground;
    model.topKills.slice(0, 3).forEach((kill, index) => {
      fitted(ctx, `${kill.name} x${String(kill.count)}`, 56, 404 + index * 31, 600);
    });
    const highlight = model.chronicleHighlights[0];
    if (highlight) {
      ctx.fillStyle = theme.muted;
      ctx.font = "18px sans-serif";
      ctx.fillText("Chronicle", 56, 532);
      ctx.fillStyle = theme.foreground;
      fitted(ctx, highlight, 56, 566, 1080);
    }
    const radar = model.personaRadar;
    if (radar.length >= 3) {
      const cx = 940;
      const cy = 297;
      const radius = 174;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      radar.forEach((_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / radar.length;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      radar.forEach((trait, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / radar.length;
        const r = radius * Math.max(0, Math.min(100, trait.value)) / 100;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.fillStyle = theme.muted;
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PERSONA", cx, 505);
    }
  } finally {
    ctx.restore();
  }
}
function shareLinks(text, url) {
  const encoded = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${encoded}${url === void 0 ? "" : `&url=${encodeURIComponent(url)}`}`,
    ...url === void 0 ? {} : { facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    reddit: `https://www.reddit.com/submit?title=${encoded}${url === void 0 ? "" : `&url=${encodeURIComponent(url)}`}`
  };
}

// src/report/render.ts
function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function lines(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded";
}
function reportMarkdown(model) {
  const h2 = model.headline;
  return [
    `# ${h2.name}'s run`,
    "",
    "| Stat | Value |",
    "| --- | --- |",
    `| Character | ${cell(`${h2.race} ${h2.class}`)} |`,
    `| Outcome | ${cell(h2.outcome)} |`,
    `| Cause | ${cell(h2.cause)} |`,
    `| Level | ${cell(h2.level)} |`,
    `| Deepest | ${cell(h2.deepestFeet)} ft |`,
    `| Turns | ${cell(h2.turns)} |`,
    "",
    "## Kills",
    "",
    lines(model.topKills.map((kill) => `${kill.name}: ${String(kill.count)}`)),
    "",
    "## Close calls",
    "",
    lines(model.closeCalls.map((event) => `Turn ${String(event.turn)}, ${String(event.depth * 50)} ft: ${event.text}`)),
    "",
    "## Lessons learned",
    "",
    lines(model.lessonsLearned),
    "",
    "## Lessons inherited",
    "",
    lines(model.lessonsInherited),
    "",
    ...model.apprenticeship === void 0 ? [] : [
      "## Apprenticeship",
      "",
      `Rank: ${model.apprenticeship.rank}`,
      `Agreement: ${String(Math.round(model.apprenticeship.agreementShare * 100))}%`,
      "",
      "### Surprises",
      "",
      lines(model.apprenticeship.surprises),
      "",
      `Latest exam: ${model.apprenticeship.latestExam === null ? "None" : `${String(model.apprenticeship.latestExam.matched)} of ${String(model.apprenticeship.latestExam.scored)}`}`,
      "",
      `Squire radar: ${model.apprenticeship.squireRadar.map((trait) => `${trait.id} ${String(trait.value)}`).join(", ")}`,
      `Knight radar: ${model.apprenticeship.knightRadar.map((trait) => `${trait.id} ${String(trait.value)}`).join(", ")}`,
      ""
    ],
    "## Token tally",
    "",
    "| Measure | Total |",
    "| --- | ---: |",
    `| Calls | ${String(model.tokens.requests)} |`,
    `| Input tokens | ${String(model.tokens.inputTokens)} |`,
    `| Output tokens | ${String(model.tokens.outputTokens)} |`,
    `| Estimated calls | ${String(model.tokens.estimated)} |`,
    `| Cost (USD) | ${model.tokens.usd.toFixed(4)} |`,
    ""
  ].join("\n");
}
function reportJson(model) {
  return JSON.stringify({ format: "neo-angband/squire/report", schemaVersion: 1, data: model });
}

// src/ui/report-view.ts
function mountReport(body2, rt) {
  const view = h("div");
  body2.append(view);
  function draw(model) {
    const exportDecisions = h("button", { class: "act", onclick: () => download("squire-decisions.jsonl", rt.exportDecisions(), "application/x-ndjson") }, "Save decision log");
    if (model === null) {
      fill(
        view,
        h("p", { class: "muted" }, "The report is made when a character Squire played dies, wins or retires. The decision log for this run can be saved now."),
        exportDecisions
      );
      return;
    }
    const hl = model.headline;
    const card = h("canvas", { width: "1200", height: "630" });
    const g = card.getContext("2d");
    if (g !== null) drawCard(g, model);
    const text = `${hl.name}, a level ${String(hl.level)} ${hl.race} ${hl.class}, reached ${String(hl.deepestFeet)} ft in Neo Angband with Squire. ${hl.outcome === "death" ? `Killed by ${hl.cause}.` : hl.outcome === "winner" ? "Won the game." : "Retired."}`;
    const links = shareLinks(text);
    const apprenticeship = model.apprenticeship;
    const radar = apprenticeship === void 0 ? null : h("canvas", { width: "600", height: "260" });
    const radarCtx = radar?.getContext("2d");
    if (radarCtx !== null && radarCtx !== void 0 && apprenticeship !== void 0) {
      const squire = defaultPersona();
      const knight = defaultPersona();
      for (const trait of apprenticeship.squireRadar) squire.sliders[trait.id] = trait.value;
      for (const trait of apprenticeship.knightRadar) knight.sliders[trait.id] = trait.value;
      drawRadar(radarCtx, squire, 150, 130, 70, "#d9ac64");
      drawRadar(
        radarCtx,
        knight,
        450,
        130,
        70,
        "#8fd18f",
        Object.fromEntries(apprenticeship.knightRadar.map((trait) => [trait.id, trait.confidence]))
      );
    }
    const base = hl.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "squire";
    fill(
      view,
      h("h3", {}, `${hl.name}, level ${String(hl.level)} ${hl.race} ${hl.class}`),
      h("p", {}, `${hl.outcome === "death" ? `Killed by ${hl.cause}` : hl.outcome === "winner" ? "Won the game" : "Retired"} at ${String(hl.deepestFeet)} ft after ${hl.turns.toLocaleString()} turns.`),
      model.topKills.length === 0 ? null : h("p", {}, `Most killed: ${model.topKills.slice(0, 5).map((k) => `${k.name} (${String(k.count)})`).join(", ")}`),
      model.uniquesKilled.length === 0 ? null : h("p", {}, `Uniques killed: ${model.uniquesKilled.join(", ")}`),
      h("p", {}, `Went against advice ${String(model.divergence.count)} times. Used ${model.tokens.inputTokens.toLocaleString()} input tokens${model.tokens.usd > 0 ? `, about $${model.tokens.usd.toFixed(3)}` : ""}.`),
      model.chronicleHighlights.length === 0 ? null : h("div", {}, h("h3", {}, "Chronicle"), ...model.chronicleHighlights.map((l) => h("div", { class: "entry" }, l))),
      model.lessonsLearned.length === 0 ? null : h("div", {}, h("h3", {}, "Lessons"), ...model.lessonsLearned.slice(-8).map((l) => h("div", { class: "entry" }, l))),
      apprenticeship === void 0 ? null : h(
        "div",
        {},
        h("h3", {}, "Apprenticeship"),
        h("p", {}, `${apprenticeship.rank} rank, agreed ${String(Math.round(apprenticeship.agreementShare * 100))}%.`),
        h("p", {}, apprenticeship.latestExam === null ? "No exam yet." : `Exam: matched your choice ${String(apprenticeship.latestExam.matched)} of ${String(apprenticeship.latestExam.scored)} times`),
        ...apprenticeship.surprises.map((line) => h("div", { class: "entry" }, line)),
        h("div", { class: "row" }, h("span", {}, "Squire"), h("span", {}, "Your style")),
        radar
      ),
      h("h3", {}, "Share"),
      card,
      h(
        "div",
        {},
        h("button", { class: "act", onclick: () => card.toBlob((blob) => blob && saveBlob(`${base}-card.png`, blob)) }, "Save card image"),
        h("button", { class: "act", onclick: () => download(`${base}-report.md`, reportMarkdown(model), "text/markdown") }, "Save report"),
        h("button", { class: "act", onclick: () => download(`${base}-report.json`, reportJson(model)) }, "Save report data"),
        exportDecisions
      ),
      h(
        "p",
        {},
        h("a", { href: links.x, target: "_blank", rel: "noopener" }, "Post on X"),
        " / ",
        h("a", { href: links.reddit, target: "_blank", rel: "noopener" }, "Post on Reddit")
      )
    );
  }
  void rt.lastSummary().then(draw);
  return () => {
  };
}
function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5e3);
}

// src/ui/orders.ts
var ORDER_HOTKEY = { ctrl: true, shift: true, key: "o" };
function isOrderHotkey(e) {
  return e.ctrlKey === ORDER_HOTKEY.ctrl && e.shiftKey === ORDER_HOTKEY.shift && e.key.toLowerCase() === ORDER_HOTKEY.key;
}
function mountOrders(body2, rt, source = "panel") {
  const orders = rt.orders();
  const list = h("div");
  const message = h("p", { class: "muted" });
  const text = h("textarea", { placeholder: ORDER_PLACEHOLDER, "aria-label": ORDER_PROMPT });
  const kind = h("select");
  for (const [value, label] of [["", AUTO_KIND_LABEL], ["order", KIND_ORDER_LABEL], ["standing", KIND_STANDING_LABEL]]) kind.append(h("option", { value }, label));
  const family = h("input", { type: "checkbox" });
  function draw() {
    const items = orders.list();
    fill(list, ...items.length === 0 ? [h("p", { class: "muted" }, ORDERS_EMPTY)] : items.map((i) => {
      const live = isLive(i.state);
      return h(
        "div",
        { class: "entry" },
        h("p", {}, h("b", {}, STATE_LABELS[i.state]), ` - ${kindLabel(i.kind)}${viewerLabel(i)}${i.familyCreed ? " (family creed)" : ""}: ${i.text}`),
        h("p", { class: "muted" }, sortedLine(i.sorted)),
        live ? h("button", { class: "act", onclick: () => {
          orders.retire(i.id);
          draw();
        } }, RETIRE_LABEL) : null
      );
    }));
  }
  function give() {
    const chosen = kind.value === "" ? void 0 : kind.value;
    const result = queueInstruction(orders, text.value, source, { ...chosen === void 0 ? {} : { kind: chosen }, familyCreed: family.checked });
    if (!result.ok) {
      message.textContent = result.problem;
      message.className = "bad";
      return;
    }
    text.value = "";
    message.textContent = "";
    draw();
  }
  async function load() {
    const file = await pickFile(".json,application/json");
    if (file === null) return;
    const result = loadCreed(orders, file);
    message.textContent = result.ok ? `Loaded ${String(result.taken)} instructions from the creed.` : result.problem;
    message.className = result.ok ? "ok" : "bad";
    draw();
  }
  fill(
    body2,
    h("h3", {}, ORDERS_HEADING),
    list,
    h("label", {}, ORDER_PROMPT, text),
    h("div", { class: "row" }, kind, h("label", {}, family, ` ${FAMILY_LABEL}`)),
    h(
      "div",
      {},
      h("button", { class: "act", onclick: give }, GIVE_LABEL),
      h("button", { class: "act", onclick: () => void load() }, LOAD_CREED_LABEL),
      h("button", { class: "act", onclick: () => download("squire.creed.json", exportCreed(rt.character().persona?.name ?? "Squire", orders.list())) }, SAVE_CREED_LABEL)
    ),
    message
  );
  draw();
  const timer = setInterval(draw, 4e3);
  text.focus();
  return () => clearInterval(timer);
}

// src/ui/panel.ts
var TABS = [
  ["setup", "Setup"],
  ["persona", "Persona"],
  ["lessons", "Lessons"],
  ["dashboard", "Dashboard"],
  ["orders", "Orders"],
  ["report", "Report"]
];
var SCALE_KEY = "squire/panelScale";
var SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5];
function readScale() {
  try {
    const stored = Number(localStorage.getItem(SCALE_KEY));
    return SCALES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}
function writeScale(scale2) {
  try {
    localStorage.setItem(SCALE_KEY, String(scale2));
  } catch {
  }
}
function mountPanel(host, rt, lessons) {
  const root = host.root;
  const body2 = h("div", { class: "body" });
  const bar = h("div", { class: "tabs", role: "tablist" });
  const panel = h("div", { class: "squire" }, bar, body2);
  root.append(h("style", {}, STYLE), panel);
  let scale2 = readScale();
  function applyScale(next) {
    scale2 = next;
    panel.style.setProperty("--squire-scale", String(scale2));
    writeScale(scale2);
  }
  applyScale(scale2);
  const step = (by) => {
    const at = SCALES.indexOf(scale2);
    applyScale(SCALES[Math.max(0, Math.min(SCALES.length - 1, at + by))] ?? 1);
  };
  let cleanup = null;
  let current2 = rt.config().setupDone ? "dashboard" : "setup";
  function show(tab, source = "panel") {
    current2 = tab;
    cleanup?.();
    body2.replaceChildren();
    for (const button of bar.querySelectorAll("button")) {
      button.setAttribute("aria-selected", button.dataset["tab"] === tab ? "true" : "false");
    }
    switch (tab) {
      case "setup":
        cleanup = mountSetup(body2, rt, () => show("persona"));
        break;
      case "persona":
        cleanup = mountPersona(body2, rt);
        break;
      case "lessons":
        cleanup = mountLessons(body2, lessons);
        break;
      case "dashboard":
        cleanup = mountDashboard(body2, rt);
        break;
      case "orders":
        cleanup = mountOrders(body2, rt, source);
        break;
      case "report":
        cleanup = mountReport(body2, rt);
        break;
    }
  }
  for (const [tab, label] of TABS) {
    const button = h("button", { role: "tab", onclick: () => show(tab) }, label);
    button.dataset["tab"] = tab;
    bar.append(button);
  }
  bar.append(
    h("button", { class: "size", title: "Smaller text", "aria-label": "Smaller text", onclick: () => step(-1) }, "A-"),
    h("button", { title: "Larger text", "aria-label": "Larger text", onclick: () => step(1) }, "A+")
  );
  show(current2);
  const onKey = (e) => {
    if (!isOrderHotkey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    host.requestFocus?.();
    show("orders", "hotkey");
  };
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    cleanup?.();
  };
}

// src/lessons/evidence.ts
function commandEvidence(command, goal, view) {
  const p = view.player();
  const near = view.monsters().some((monster) => monster.visible && !monster.asleep && steps(p.grid, monster.grid) <= 3 && monster.level >= p.level);
  let kind;
  switch (goal) {
    case "fight":
      kind = command.code === "walk" ? "melee" : "fight";
      break;
    case "retreat":
    case "phase":
    case "teleport":
      kind = "retreat";
      break;
    case "rest":
      kind = "rest";
      break;
    case "heal":
    case "cast_heal":
      kind = "heal";
      break;
    case "descend":
      kind = "descend";
      break;
    case "shoot":
    case "throw_oil":
    case "aim_wand":
    case "cast_attack":
      kind = "ranged";
      break;
    case "explore":
      kind = "move";
      break;
    default:
      if (["eat", "quaff", "read", "use-staff", "throw"].includes(command.code)) kind = "consumable";
      else return null;
  }
  let exploredShare;
  if (kind === "descend") {
    const bounds = view.mapBounds();
    let known = 0;
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) if (view.cell(x, y)?.known) known += 1;
    }
    exploredShare = bounds.width * bounds.height > 0 ? known / (bounds.width * bounds.height) : 0;
  }
  return {
    kind,
    turn: view.turn(),
    dangerousNear: near,
    hpShare: p.maxHp > 0 ? p.hp / p.maxHp : 1,
    ...exploredShare === void 0 ? {} : { exploredShare }
  };
}
function signatureForView(view) {
  const p = view.player();
  return signatureOf({
    depth: p.depth,
    classId: p.cls,
    level: p.level,
    races: view.monsters().filter((monster) => monster.visible).map((monster) => monster.race),
    hp: p.hp,
    maxHp: p.maxHp,
    resources: view.inventory().map((item) => item.label.toLowerCase()).filter((name) => /heal|teleport|phase|oil|wand/.test(name)).slice(0, 10)
  });
}

// src/lessons/exam.ts
function styleGoal(entries, current2) {
  const close = entries.filter((entry) => entry.signature !== void 0).map((entry) => ({ entry, score: similarity(entry.signature, current2) })).filter(({ score }) => score >= 0.7);
  if (close.length === 0) return null;
  const nearest = Math.max(...close.map(({ score }) => score));
  const votes = /* @__PURE__ */ new Map();
  for (const { entry, score } of close) {
    if (score < nearest - 0.1) continue;
    votes.set(entry.knight, (votes.get(entry.knight) ?? 0) + (entry.demonstration ? 2 : 1));
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  return ranked[0] !== void 0 && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null;
}
function scoreExam(state, pick2, expected) {
  if (state.decisions >= 20) return state;
  return {
    decisions: state.decisions + 1,
    scored: state.scored + (expected === null ? 0 : 1),
    matched: state.matched + (expected !== null && pick2 === expected ? 1 : 0)
  };
}
function subscribeExam(rt, entries, result, onStart = () => {
}) {
  let armed = false;
  let state = null;
  const off = rt.onDecision((record5) => {
    if (record5.reflex !== void 0) return;
    if (state === null) {
      if (!armed) return;
      armed = false;
      state = { decisions: 0, scored: 0, matched: 0 };
      onStart();
    }
    const view = rt.decisionView();
    const expected = view === null ? null : styleGoal(entries(), signatureForView(view));
    const answer = record5.context.trace?.pick ?? (record5.answers["goal"]?.type === "choice" ? record5.answers["goal"].choice : null);
    const pick2 = record5.context.offers.find((offer) => offer.goal === answer)?.goal ?? null;
    state = scoreExam(state, pick2, expected);
    if (state.decisions >= 20) finish();
  });
  function finish() {
    if (state === null) return;
    result({ matched: state.matched, scored: state.scored });
    state = null;
  }
  return { arm: () => {
    armed = true;
  }, end: finish, dispose: off };
}

// src/lessons/persona.ts
function saveInferredPersona(rt, inferred, characterName, use) {
  const config = rt.config();
  const added = [...config.personas, normalize({ ...inferred, name: `${characterName}'s style` })];
  const removed = Math.max(0, added.length - 50);
  const personas = added.slice(removed);
  const index = personas.length - 1;
  rt.saveConfig({ ...config, personas, activePersona: use ? index : Math.max(-1, config.activePersona - removed) });
  return index;
}

// src/lessons/ghost.ts
function ghostHint(squire, knight, view) {
  if (squire === knight) return null;
  const attack = ["fight", "shoot", "throw_oil", "aim_wand", "cast_attack"].includes(squire);
  const target = attack ? view.monsters().filter((monster) => monster.visible).sort((a, b) => steps(view.player().grid, a.grid) - steps(view.player().grid, b.grid))[0] : void 0;
  return `Squire would: ${goalLabel(squire)}${target === void 0 ? "" : ` at the ${target.race}`}`;
}
function ghostAfterCommand(hint, previousGoal, knight) {
  return previousGoal !== null && previousGoal === knight ? null : hint;
}

// src/attach.ts
var APPRENTICE_KEY = "squire/apprentice";
var DEMONSTRATION_DECISIONS = 5;
function attachSquire(ctx, rt) {
  const make = ctx.core?.createAgentView;
  function viewNow() {
    if (make === void 0 || ctx.state === void 0) return null;
    const base = make(ctx.state);
    const snap = ctx.snapshot?.();
    const inventory = [...snap?.core.inventory ?? []];
    const equipment = [...snap?.core.equipment ?? []];
    return { ...base, inventory: () => inventory, equipment: () => equipment };
  }
  ctx.events?.on("combat-outcome", (_name, p) => {
    if (p.attacker !== "player" || p.died !== true || typeof p.target !== "number") return;
    const view = viewNow();
    const monster = view?.monsters().find((m) => m.id === p.target);
    if (monster !== void 0) rt.recordKill(monster.race, monster.raceFlags.includes("UNIQUE"), view ?? null);
  });
  let apprentice = emptyApprentice();
  const listeners = /* @__PURE__ */ new Set();
  let demonstrations = 0;
  let previous = null;
  let asking = false;
  let decisionSerial = 0;
  let pendingRest = null;
  const exam = subscribeExam(rt, () => apprentice.entries, (result) => {
    save({
      ...apprentice,
      examArmed: false,
      exams: [...apprentice.exams, result].slice(-10),
      entries: [...apprentice.entries, {
        turn: rt.decisionView()?.turn() ?? 0,
        squire: "rest",
        knight: "rest",
        agreed: true,
        line: `Exam: matched your choice ${String(result.matched)} of ${String(result.scored)} times`,
        demonstration: false
      }].slice(-200)
    });
  }, () => save({ ...apprentice, examArmed: false }));
  void rt.store().get(APPRENTICE_KEY).then((stored) => {
    const s = stored;
    if (s !== void 0 && Array.isArray(s.entries) && typeof s.agreed === "number" && typeof s.total === "number") {
      apprentice = {
        ...emptyApprentice(),
        ...s,
        entries: s.entries,
        agreed: s.agreed,
        total: s.total,
        commands: Array.isArray(s.commands) ? s.commands : [],
        exams: Array.isArray(s.exams) ? s.exams : []
      };
      if (apprentice.examArmed) exam.arm();
      for (const l of listeners) l(apprentice);
    }
  });
  function save(next) {
    apprentice = next;
    void rt.store().set(APPRENTICE_KEY, next);
    for (const l of listeners) l(next);
  }
  const terrain = ctx.registries?.features !== void 0 && ctx.core?.TF !== void 0 ? readTerrain(ctx.registries.features.allFeatures(), ctx.core.TF) : noTerrain();
  const planner = createGoalPlanner({ cfg: cfgFromFlags(ctx.flags, ctx.settings), terrain, log: () => {
  }, ...ctx.core?.turnEnergy === void 0 ? {} : { speedEnergy: ctx.core.turnEnergy } });
  function record5(squire, knight, view, dangerousNear, serial, confidence) {
    const p = view.player();
    const share3 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const demonstration = demonstrations > 0;
    if (demonstration) demonstrations -= 1;
    save(
      note(apprentice, {
        turn: view.turn(),
        squire,
        knight,
        agreed: squire === knight,
        line: noteLine(squire, knight, share3),
        demonstration,
        signature: signatureForView(view),
        dangerousNear,
        ...confidence === void 0 ? {} : { confidence }
      })
    );
    if (rt.config().knightsLessons.ghost && serial === decisionSerial) {
      save({ ...apprentice, ghostHint: ghostHint(squire, knight, view), ghostGoal: squire === knight ? null : squire });
    }
  }
  ctx.events?.on("player-command", (_name, payload) => {
    exam.end();
    if (rt.takeOwnCommand(Date.now())) return;
    const view = viewNow();
    if (view === null) return;
    const serial = ++decisionSerial;
    rt.observe(view, terrain);
    rt.recordCommand(payload, view);
    if (!rt.config().knightsLessons.enabled) return;
    const knight = goalOfCommand(payload, view);
    const evidence = commandEvidence(payload, knight, view);
    const dangerousNear = evidence?.dangerousNear ?? false;
    if (pendingRest !== null) {
      save({ ...apprentice, commands: apprentice.commands.map((item, index) => index === pendingRest ? { ...item, restedToFull: view.player().hp >= view.player().maxHp } : item) });
      pendingRest = null;
    }
    if (evidence !== null) {
      const commands = [...apprentice.commands, evidence].slice(-1e3);
      pendingRest = evidence.kind === "rest" ? commands.length - 1 : null;
      save({ ...apprentice, commands });
    }
    if (apprentice.ghostHint !== null && ghostAfterCommand(apprentice.ghostHint, apprentice.ghostGoal, knight) === null)
      save({ ...apprentice, ghostHint: null, ghostGoal: null });
    const moment = momentOf(view);
    const point = isDecisionPoint(previous, moment, knight);
    previous = moment;
    if (!point || knight === null) return;
    const asked = planner.ask(view);
    if ("handBack" in asked) return;
    if ("reflex" in asked) {
      const answer = asked.answers["goal"];
      const goal = asked.context.offers.find((o) => answer?.type === "choice" && o.goal === answer.choice)?.goal;
      if (goal !== void 0) record5(goal, knight, view, dangerousNear, serial);
      return;
    }
    const question = asked;
    const p = view.player();
    const share3 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const offline = proceduralPick(question.context.offers, share3);
    const backend = rt.backend();
    if (backend === null || asking) {
      if (offline !== null) record5(offline, knight, view, dangerousNear, serial);
      return;
    }
    asking = true;
    void rt.send(question.request).then((result) => {
      asking = false;
      if (result.ok) {
        rt.tally().record(backend, result.usage, Date.now());
        const answer = result.answers["goal"];
        const pick2 = answer?.type === "choice" ? answer.choice : "none_of_these";
        const squire = question.context.offers.find((o) => o.goal === pick2)?.goal ?? offline;
        if (squire !== null && squire !== void 0) record5(
          squire,
          knight,
          view,
          dangerousNear,
          serial,
          answer?.type === "choice" ? answer.confidence : void 0
        );
        void rt.recordLesson(question.request, result.answers, result.model, apprentice.total, knight).catch(() => {
        });
      } else if (offline !== null) {
        record5(offline, knight, view, dangerousNear, serial);
      }
    });
  });
  const lessons = {
    apprentice: () => apprentice,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watchThis() {
      demonstrations = DEMONSTRATION_DECISIONS;
    },
    why(entry, reason) {
      save({
        ...apprentice,
        entries: apprentice.entries.map((e) => e === entry ? { ...e, reason } : e)
      });
    },
    inferred() {
      const examples = apprentice.entries.filter((entry) => entry.signature !== void 0).map((entry) => ({
        situation: { dangerousNear: entry.dangerousNear === true },
        offered: [],
        squirePick: entry.squire,
        playerPick: entry.knight,
        question: "goal",
        source: entry.demonstration ? "watch" : "takeover",
        weight: entry.demonstration ? 2 : 1
      }));
      return inferPersona(examples, apprentice.commands);
    },
    squirePersona: () => rt.character().persona ?? activePersona(rt.config()),
    savePersona(use) {
      saveInferredPersona(rt, lessons.inferred().persona, ctx.character?.key?.() ?? "Player", use);
    },
    ghostEnabled: () => rt.config().knightsLessons.ghost,
    setGhost(enabled) {
      const config = rt.config();
      rt.saveConfig({ ...config, knightsLessons: { ...config.knightsLessons, ghost: enabled } });
      if (!enabled) save({ ...apprentice, ghostHint: null, ghostGoal: null });
    },
    takeExam() {
      if (apprentice.entries.filter((entry) => entry.signature !== void 0).length < 40) return;
      exam.arm();
      save({ ...apprentice, examArmed: true });
    }
  };
  const register = ctx.ui?.registerPanelKind;
  if (register !== void 0) {
    register.call(ctx.ui, {
      kind: "squire",
      label: "Squire",
      tab: "Squire",
      minSize: { width: 260, height: 200 },
      preferredPlacement: { kind: "dock", target: "main", edge: "right" },
      mount: (host) => mountPanel(host, rt, lessons)
    });
  }
  return lessons;
}

// src/ui/order-command.ts
var ORDER_COMMAND = "squire:order";
var ORDER_VERB = "give an order";
var ORDER_KEYS = ["O", "N"];
var ORDER_PANEL_LABEL = "Give Squire an order";
function registerOrderCommand(host, ctx, rt) {
  const commands = host?.commands;
  const openPanel = ctx.ui?.openPanel;
  if (commands === void 0 || openPanel === void 0) return null;
  let shown = null;
  function prompt() {
    if (shown?.open === true) return;
    const panel = openPanel.call(ctx.ui, { id: "order", modal: true, label: ORDER_PANEL_LABEL });
    const body2 = h("div", { class: "body" });
    panel.root.append(h("style", {}, STYLE), h("div", { class: "squire" }, body2));
    const cleanup = mountOrders(body2, rt, "hotkey");
    shown = panel;
    void panel.closed.then(() => {
      cleanup();
      if (shown === panel) shown = null;
    });
  }
  commands.register(ORDER_COMMAND, () => {
    try {
      prompt();
    } catch (error) {
      ctx.log?.(`Squire couldn't open the order prompt: ${String(error)}`);
    }
    return 0;
  });
  commands.setVerb(ORDER_COMMAND, ORDER_VERB);
  const keymaps = ctx.keymaps;
  if (keymaps === void 0) {
    ctx.log?.("Squire's order key isn't bound, because this game doesn't let mods bind keys.");
    return null;
  }
  for (const key2 of ORDER_KEYS) {
    if (keymaps.isBindableTriggerKey(key2) && keymaps.bind(key2, ORDER_COMMAND)) {
      ctx.log?.(`Squire's order key is ${key2}.`);
      return key2;
    }
  }
  ctx.log?.("Squire's order key isn't bound, because every key it tried is taken.");
  return null;
}

// src/title.ts
var TITLE_LABEL = "New Squire character";
var TITLE_KEY = "S";
var PROFILES_KEY = "squire/profiles";
var WHERE_PROMPT = "Where should the new Squire character live?";
var WHERE_SEPARATE = "In a separate profile, with its own options, mods and characters";
var WHERE_HERE = "In this profile";
var WHICH_PROMPT = "Which profile should Squire use?";
var WHICH_FRESH = "Start a fresh profile";
var WHICH_COPY = "Copy an existing profile";
var COPY_PROMPT = "Copy which profile? Its options, mods and mod settings come across, but not its characters.";
var FALLBACK_HERE = "Start the character in this profile";
var GIVE_UP = "Back to the title";
var ARMED = { kind: "create-character", armController: true };
async function remembered2(store) {
  const saved = await store.get(PROFILES_KEY).catch(() => void 0);
  return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
}
function freshName(taken) {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has("squire")) return "Squire";
  for (let n = 2; ; n++) if (!used.has(`squire ${String(n)}`)) return `Squire ${String(n)}`;
}
function registerSquireTitle(ctx, store) {
  const title = ctx.title;
  const profiles = ctx.profiles;
  if (title === void 0 || profiles === void 0) return false;
  const self = ctx.id ?? "squire";
  async function here() {
    const active2 = profiles.list();
    const id = active2.ok ? active2.value.find((profile) => profile.active)?.id ?? null : null;
    const started = profiles.switchTo(id, ARMED);
    if (!started.ok) await title.choose(`Squire could not start the character: ${started.reason}`, [GIVE_UP]);
  }
  async function refused(reason) {
    const answer = await title.choose(`Squire could not use a separate profile: ${reason}`, [FALLBACK_HERE]);
    if (answer === 0) await here();
  }
  async function separate() {
    const listed = profiles.list();
    if (!listed.ok) return refused(listed.reason);
    const all = listed.value;
    const ours = new Set(await remembered2(store));
    const made = all.filter((profile) => profile.id !== null && ours.has(profile.id));
    const which = await title.choose(WHICH_PROMPT, [WHICH_FRESH, WHICH_COPY, ...made.map((profile) => `Use ${profile.name}`)]);
    if (which === null) return;
    let target;
    if (which >= 2) {
      const chosen = made[which - 2];
      if (chosen === void 0) return;
      target = chosen;
    } else {
      let copyFrom;
      if (which === 1) {
        const source = await title.choose(COPY_PROMPT, all.map((profile) => profile.name));
        if (source === null) return;
        const picked2 = all[source];
        if (picked2 === void 0) return;
        copyFrom = picked2.id;
      }
      const created = profiles.create(freshName(all.map((profile) => profile.name)), copyFrom === void 0 ? {} : { copyFrom });
      if (!created.ok) return refused(created.reason);
      target = created.value;
      if (target.id === null) return refused("the new profile has no id");
      if (copyFrom === void 0) {
        const enabled = profiles.setEnabledMods(target.id, [self]);
        if (!enabled.ok) return refused(enabled.reason);
      }
      await store.set(PROFILES_KEY, [...ours, target.id]).catch(() => void 0);
    }
    const switched = profiles.switchTo(target.id, ARMED);
    if (!switched.ok) return refused(switched.reason);
  }
  title.registerRow({
    label: TITLE_LABEL,
    key: TITLE_KEY,
    async run() {
      const where = await title.choose(WHERE_PROMPT, [WHERE_SEPARATE, WHERE_HERE]);
      if (where === 0) await separate();
      else if (where === 1) await here();
    }
  });
  return true;
}

// plugin.ts
var NOSCORE_BORG = 32;
function characterAlreadyAutoplayed(ctx) {
  const noscore = ctx.state?.actor?.player?.noscore ?? 0;
  return (noscore & NOSCORE_BORG) !== 0;
}
function terrainFrom(ctx) {
  const features = ctx.registries?.features;
  const tf = ctx.core?.TF;
  if (features === void 0 || tf === void 0) return noTerrain();
  return readTerrain(features.allFeatures(), tf);
}
var plugin_default = {
  api: 1,
  /* The panel, Knight's Lessons and run bookkeeping, for every character with
   * Squire enabled, whether or not it has been handed over. */
  register(host, ctx) {
    const rt = runtime(ctx);
    attachSquire(ctx, rt);
    registerOrderCommand(host, ctx, rt);
    registerSquireTitle(ctx, rt.store());
  },
  /* Roll-on: accepts the one creation Squire asked for after a death, and
   * declines every other, so the game shows its own birth screens. */
  birth(ctx) {
    return rollOnPresenter(ctx);
  },
  controller(ctx) {
    if (!characterAlreadyAutoplayed(ctx) && ctx.controllerArmed !== true && !takeRollOn(sessionMarks(), Date.now(), HEIR_KEY)) return void 0;
    const cfg = cfgFromFlags(ctx.flags, ctx.settings);
    const terrain = terrainFrom(ctx);
    ctx.log(
      terrain.size > 0 ? `Squire is reading ${String(terrain.size)} terrain features` : "Squire has no terrain registry: it will not take stairs or open doors"
    );
    const changed = changedFrom(cfg);
    ctx.log(
      changed.length === 0 ? "Squire is on its stock settings" : `Squire's settings differ from stock: ${changed.join(", ")}`
    );
    const errands = () => createSquire({ cfg, terrain, log: ctx.log, status: (reason) => ctx.controller?.setStatus({ label: "Errand ended", reason }) }).controller;
    return { controller: runtime(ctx).controllerFor(cfg, terrain, errands), onDeath: "end" };
  }
};
export {
  plugin_default as default
};
