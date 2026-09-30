// squire - generated from plugin.ts by neo-angband-mod-build
// (@rpgm-tools/neo-angband-mod-sdk). Edit the TypeScript source, not this file.

// src/mission.ts
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
function newProgress(depth) {
  return { steps: 0, idle: 0, at: null, depth, collected: /* @__PURE__ */ new Set(), visited: /* @__PURE__ */ new Set() };
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
      const share2 = options.stopOnDamageShare;
      if (share2 !== void 0 && p.maxHp > 0 && lost > 0 && (lost >= p.maxHp * share2 || startHp - hp >= p.maxHp * share2 * 2)) {
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
function hasFloorObject(view, at) {
  const cell2 = cellAt(view, at);
  return cell2 !== null && cell2.objectCount > 0;
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
      const named2 = ctx.view.target();
      if (named2 !== null && named2.midx > 0) {
        const monster = liveTarget(ctx, named2.midx);
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
function routing(view) {
  return view;
}
function engineTravelAvailable(view) {
  return typeof routing(view).travelPath === "function";
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
  const route = routing(ctx.view).travelPath?.({ x: near.x, y: near.y }) ?? null;
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
function autoexplore(options = {}) {
  let watcher = null;
  let engineTurn = null;
  let engineBlocked = false;
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
      const goals = frontiers(ctx.view, ctx.terrain);
      if (goals.length === 0) {
        return stop("done", "This floor is walked out.");
      }
      const seen = ctx.view.monsters().filter((m) => m.visible).map((m) => m.grid);
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
        const stairs = knownDownStairs(ctx.view, ctx.terrain);
        if (stairs.some((grid) => grid.x === at.x && grid.y === at.y)) {
          return issue(ctx.act.descend());
        }
        if (stairs.length > 0 && ctx.progress.idle < ctx.cfg.idleSteps) {
          const travel = travelTo(ctx, stairs);
          if (travel.kind === "step") return issue(travel.command);
        }
      }
      return stop(
        "done",
        ctx.progress.idle >= ctx.cfg.idleSteps ? "The character has stopped making progress." : "There is nothing left to do on this floor."
      );
    }
  };
}

// src/squire.ts
function chooseMission(cfg, at, monsters) {
  if (cfg.errandCampaign) return campaign();
  const target = pickTarget(monsters, at, {
    wakeSleepers: cfg.wakeSleepers,
    reach: AUTOFIGHT_REACH
  });
  if (target !== null && cfg.errandAutofight) return autofight();
  if (cfg.errandAutoexplore) return autoexplore();
  return null;
}
function createSquire(options) {
  const { cfg, terrain, log } = options;
  let mission = null;
  let progress = null;
  let finished = null;
  function finish(stop2) {
    finished = stop2;
    log(`errand ended (${stop2.reason}): ${stop2.detail}`);
    log("the keyboard is yours again; press any key to take it back from Squire");
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
var RESUME_HINT = "Press any key to take the keyboard back, then Ctrl-Z to hand it to Squire again.";
function createBrain(deps) {
  const { backend, planner, tally } = deps;
  let state = { kind: "idle" };
  let landed = null;
  let attempt = 0;
  let emptyDecisions = 0;
  function stopWith(message) {
    state = { kind: "stopped", message };
    deps.log(message);
    deps.status("stopped", message);
    return null;
  }
  function failed(failure) {
    if (!failure.retryable) return stopWith(`${failure.message} ${RESUME_HINT}`);
    const wait = attempt >= BACKOFF_MS.length ? void 0 : failure.retryAfterMs ?? BACKOFF_MS[attempt];
    if (wait === void 0 || wait > MAX_RETRY_AFTER_MS) {
      return stopWith(`${failure.message} Squire tried ${String(attempt)} times and has stopped. ${RESUME_HINT}`);
    }
    attempt += 1;
    state = { kind: "waiting", until: deps.now() + wait };
    deps.log(`${failure.message} Trying again in ${String(Math.ceil(wait / 1e3))} s.`);
    deps.status("waiting", failure.message);
    return null;
  }
  function startAsking(view) {
    const capped = tally.overCap(backend, deps.now());
    if (capped !== null) return stopWith(`${capped.message} ${RESUME_HINT}`);
    const question = planner.ask(view);
    if ("handBack" in question) return stopWith(question.handBack);
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
      state = { kind: "running", plan: question.plan, run: { hpBefore: deps.gauge?.(view).hp ?? null, commands: 0, refused: 0, issuedAt: null } };
      deps.status(question.plan.label);
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
      failed(result.failure);
      return null;
    }
    tally.record(backend, result.usage, deps.now());
    attempt = 0;
    if (!sameToken(token, deps.token())) {
      state = { kind: "idle" };
      return null;
    }
    const choice2 = planner.choose(result.answers, question.context, view);
    const outcome = "plan" in choice2 ? choice2.plan.label : `hand back: ${choice2.handBack}`;
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
      deps.onPlanEnd?.({ stop: "handed back", reason: choice2.handBack, commands: 0, refused: 0, hpBefore: hp, hpAfter: hp });
      stopWith(choice2.handBack);
      return null;
    }
    state = { kind: "running", plan: choice2.plan, run: { hpBefore: hp, commands: 0, refused: 0, issuedAt: null } };
    deps.status(choice2.plan.label);
    return "planned";
  }
  const controller = (view, act) => {
    if (state.kind === "stopped") return null;
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
      if (run.issuedAt !== null && gauge !== null && gauge.turn === run.issuedAt) run.refused += 1;
      run.issuedAt = null;
      const reason = planner.trigger(view, plan);
      if (reason === null) {
        const command = plan.step(view, act);
        if (command !== null) {
          emptyDecisions = 0;
          run.commands += 1;
          run.issuedAt = gauge?.turn ?? null;
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
      emptyDecisions += 1;
      if (emptyDecisions > MAX_EMPTY_DECISIONS) {
        return stopWith(`Squire's last ${String(MAX_EMPTY_DECISIONS)} plans ended before doing anything, so it has stopped. ${RESUME_HINT}`);
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

// src/brain/threat-model.ts
var THREAT_BANDS = ["an easy kill", "a fair fight", "dangerous", "deadly"];
var BAND_RISK = [0.03, 0.15, 0.4, 0.75];
function inspecting(view) {
  return view;
}
function spellInfoOf(view) {
  const v = inspecting(view);
  return v.spellInfo?.bind(v);
}
function roundEstimate(level) {
  return 8 + 3 * level;
}
function threatIndex(monster, characterLevel, characterHp = Infinity, dreaded = /* @__PURE__ */ new Set()) {
  let band;
  if (monster.level * 2 <= characterLevel) band = 0;
  else if (monster.level <= characterLevel) band = 1;
  else if (monster.level <= characterLevel + 5) band = 2;
  else band = 3;
  if (monster.raceFlags.includes("UNIQUE")) band = Math.min(3, band + 1);
  const round = roundEstimate(monster.level);
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
function assessThreat(monster, player, awake, view, dreaded = /* @__PURE__ */ new Set()) {
  const old = threatIndex(monster, player.level, player.hp, dreaded);
  const recall = inspecting(view).monsterRecall?.(monster.raceIndex);
  if (recall === void 0 || recall === null) {
    return { capability: threatIndex(monster, player.level, Infinity, dreaded), lethality: old, band: old, round: roundEstimate(monster.level), description: null, enhanced: false };
  }
  const known = knownCapability(recall.text, monster.level);
  let capability = threatIndex(monster, player.level, Infinity, dreaded);
  const knownMagic = /\bmay (?:breathe|cast spells)\b/i.test(recall.text);
  if (known.breeds || known.round >= 16 || knownMagic) capability = Math.max(capability, 1);
  if (known.round >= 32 || known.spell >= 24) capability = Math.max(capability, 2);
  const incoming = Math.max(known.round, known.spell);
  const nearby = awake.filter((other) => steps(player.grid, other.grid) <= 5).length;
  const closing = Math.max(0, steps(player.grid, monster.grid) - 1);
  const speed = monster.speed > player.speed ? Math.min(2, Math.ceil((monster.speed - player.speed) / 10)) : 0;
  const exposure2 = incoming * (1 + speed * 0.5) * (1 + Math.min(2, closing) * 0.5);
  let lethality = 0;
  if (player.hp <= exposure2 / 2) lethality = 3;
  else if (player.hp <= exposure2 || player.maxHp > 0 && incoming >= player.maxHp) lethality = 2;
  else if (player.hp <= exposure2 * 2) lethality = 1;
  if (nearby >= 2) lethality = Math.min(3, lethality + (nearby >= 4 ? 2 : 1));
  const band = Math.max(capability, lethality);
  const description = known.knownBlows ? `${known.round >= 16 ? "hits hard" : "known blows"} for a level ${String(player.level)} ${player.cls.toLowerCase()} (up to ${String(known.round)} a round)` : known.spell > 0 ? `known magic up to ${String(known.spell)} damage` : knownMagic ? "known spells or breaths" : known.breeds ? "breeds explosively" : "attacks not yet known";
  return { capability, lethality, band, round: known.round, description, enhanced: true };
}
function pickAttackSpell(spells, info) {
  if (info === void 0) return spells[0];
  let best;
  let fallback;
  let bestScore = -1;
  for (const spell of spells) {
    const detail = info(spell.sidx);
    if (detail === null) {
      fallback ??= spell;
      continue;
    }
    if (!detail.canCastNow) continue;
    fallback ??= spell;
    const summary = /\baverage of (.+?) damage\b/i.exec(detail.description);
    if (summary === null) continue;
    const damage = [...summary[1].matchAll(/\d+(?:\.\d+)?/g)].reduce((sum, match) => sum + Number(match[0]), 0);
    const score = damage * (1 - detail.failChance / 100) / Math.max(1, detail.mana);
    if (score > bestScore) {
      best = spell;
      bestScore = score;
    }
  }
  return best ?? fallback;
}
function same(a, b) {
  return a.x === b.x && a.y === b.y;
}
function clearShot(view, target) {
  const { projectionPath } = inspecting(view);
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
  const { blastArea, projectionPath } = inspecting(view);
  if (blastArea === void 0 || projectionPath === void 0) return target.grid;
  let best = null;
  let count2 = -1;
  for (const monster of monsters.filter((m) => m.visible)) {
    const at = monster.grid;
    if (!clearShot(view, monster)) continue;
    const grids = blastArea.call(view, at, radius, 0).grids;
    const caught = monsters.filter((m) => m.visible && grids.some((grid) => same(grid, m.grid))).length;
    if (caught > count2 && caught > 0) {
      best = at;
      count2 = caught;
    }
  }
  return best;
}

// src/brain/volley.ts
function volleyAvailable(view) {
  return typeof inspecting(view).projectionPath === "function";
}
function lineOfFire(view, target) {
  const path = inspecting(view).projectionPath?.({ x: target.x, y: target.y });
  if (path === void 0) return true;
  const grids = path.grids;
  const last = grids[grids.length - 1];
  return last !== void 0 && last.x === target.x && last.y === target.y;
}
function volleySteps(goal, targetId, spellSidx) {
  return (ctx) => {
    const view = ctx.view;
    const target = view.monsters().find((monster) => monster.id === targetId && monster.visible);
    if (target === void 0) return null;
    if (!lineOfFire(view, target.grid)) return null;
    const command = shot(goal, ctx, readPack(view), spellSidx);
    if (command === null) return null;
    if (!ctx.act.setTargetMonster(target.id)) return null;
    return command;
  };
}
function shot(goal, ctx, pack, spellSidx) {
  switch (goal) {
    case "shoot": {
      const ammo = pack.ammo[0];
      return pack.launcher && ammo !== void 0 ? ctx.act.fire(ammo.handle) : null;
    }
    case "throw_oil": {
      const oil = pack.oil[0];
      return oil === void 0 ? null : ctx.act.throw(oil.handle);
    }
    case "aim_wand": {
      const wand = pack.attackWand[0];
      return wand === void 0 ? null : ctx.act.aimWand(wand.handle);
    }
    case "cast_attack": {
      const spell = spellSidx === void 0 ? pack.attackSpell[0] : pack.attackSpell.find((s) => s.sidx === spellSidx);
      return spell === void 0 ? null : ctx.act.cast(spell.sidx);
    }
  }
}

// src/town/needs.ts
function shownName2(item) {
  const name = item.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
function matchesSupplyName(shown, wanted) {
  if (wanted === "Flask of Oil") return /\bFlasks? of Oil\b/i.test(shown);
  if (wanted === "Ration of Food") return /\bRations? of Food\b/i.test(shown);
  if (wanted === "Wooden Torch") return /\bWooden (Torch|Torches)\b/i.test(shown);
  return shown.toLowerCase().includes(wanted.toLowerCase());
}
function supplyName(kind, level, lantern, launcher) {
  switch (kind) {
    case "healing":
      return level >= 15 ? "Cure Serious Wounds" : "Cure Light Wounds";
    case "phase":
      return "Phase Door";
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
    return sum + (name !== null && matchesSupplyName(name, needle) ? item.number : 0);
  }, 0);
}
var RECALL_FROM_DEPTH = 5;
function scale(base, slider, minimum) {
  return Math.max(minimum, Math.round(base * (0.5 + slider / 100)));
}
function supplyNeeds(view, pack, persona) {
  const items = view.inventory();
  const worn = view.equipment().map((item) => item === null ? null : shownName2(item));
  const lantern = worn.some((name) => name !== null && /\bLantern\b/i.test(name));
  const launcher = worn.find((name) => name !== null && /\b(Sling|Short Bow|Long Bow|Light Crossbow|Heavy Crossbow)\b/i.test(name)) ?? null;
  const level = view.player().level;
  const consumables = persona?.sliders.consumables ?? 50;
  const escapes = persona?.sliders.escapes ?? 50;
  const healAt = persona?.sliders.healat ?? 50;
  const make = (kind, want, extra = {}) => {
    const name = supplyName(kind, level, lantern, launcher);
    return { kind, want, have: count(items, name), name, ...extra };
  };
  const healing = Math.max(2, scale(5, consumables, 2) + Math.max(0, Math.round((healAt - 50) / 25)));
  const recall = view.player().maxDepth >= RECALL_FROM_DEPTH ? scale(1, escapes, 1) : 0;
  return [
    make("healing", healing),
    make("phase", scale(5, escapes, 1)),
    make("recall", recall),
    ...level < 20 ? [make("oil", scale(10, consumables, 1))] : [],
    make("food", scale(4, consumables, 1), { hungry: hungry(view) }),
    make("light", scale(2, consumables, 1)),
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
  return marks.every((mark) => mark === "cursed" || mark === "ignore") && (/\([+-]?\d+,[+-]?\d+\)/.test(name) || /\[\d+,[+-]?\d+\]/.test(name));
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
function simulated(name, handle, result) {
  if (result.unresolved.length > 0 || result.placements.length === 0) return null;
  const d = result.delta;
  const w = GEAR_WEIGHTS;
  const resistValue = d.resists.reduce((sum, change) => sum + change, 0);
  const score = d.ac * w.ac + d.toH * w.toHit + d.toD * w.toDam + d.blows * w.blows + d.shots * w.shots + d.speed * w.speed + d.maxHp * w.maxHp + d.maxSp * w.maxSp + d.light * w.light + resistValue * w.resist;
  if (score <= w.threshold) return null;
  const before = result.before.player;
  const after = result.after.player;
  const changes = [];
  const note2 = (label, a, b) => {
    if (a !== b) changes.push(`${label} ${String(b)} instead of ${String(a)}`);
  };
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
  return { handle, name, score, unknown: false, criteria: `Wear ${name}: ${changes.join(", ")}.` };
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
      if (oldLight === null || fuel(oldLight) === 0) {
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
        const candidate = simulated(name, item.handle, result);
        if (candidate !== null) out.push(candidate);
        continue;
      }
    }
    const base = visibleBase(name, item.tval);
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
  const unit4 = Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 0.5;
  return Math.max(0, Math.min(1, persona.sliders.strength / 100 + (unit4 * 2 - 1) * persona.sliders.volatility / 400));
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
  { id: "forgetful", group: "quirks", name: "Forgetful", kind: "quirk", scale: "on or off, with strength", description: "Randomly drops a lesson from the state." },
  { id: "delusional", group: "quirks", name: "Delusional", kind: "quirk", scale: "on or off, with strength", description: "Randomly reads some threat bands wrong." },
  { id: "compulsive", group: "quirks", name: "Compulsive collector", kind: "quirk", scale: "on or off", description: "Must pick up everything it walks over." },
  { id: "pyromaniac", group: "quirks", name: "Pyromaniac", kind: "quirk", scale: "on or off", description: "Reaches for fire in every form." },
  { id: "deathwish", group: "quirks", name: "Death wish", kind: "quirk", scale: "on or off", description: "Allows options above the safety ceiling." },
  { id: "cowardice", group: "quirks", name: "Craven", kind: "quirk", scale: "on or off", description: "Flees from anything new, then circles back." },
  { id: "inheritance", group: "lineage", name: "Inheritance", kind: "slider", scale: "nothing passes to everything passes", description: "How much ancestral lore an heir starts with." },
  { id: "grudges", group: "lineage", name: "Blood grudges", kind: "toggle", scale: "on or off", description: "An ancestor's killer joins the heir's hated or feared list.", default: true },
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
    retreatFraction: 0.5,
    errandSteps: 200,
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
function cfgFromFlags(flags) {
  const cfg = defaultCfg();
  for (const [flag, field] of Object.entries(RULE_CFG)) {
    const value = flags[flag];
    if (typeof value === "boolean") cfg[field] = value;
  }
  return cfg;
}
function changedFrom(cfg) {
  const stock = defaultCfg();
  return Object.values(RULE_CFG).filter((field) => stock[field] !== cfg[field]).map((field) => `${field}=${String(cfg[field])}`).sort();
}

// src/town/shop.ts
var PRIORITY = ["recall", "healing", "phase", "food", "light", "oil", "ammo"];
function storesFor(kind) {
  return kind === "healing" || kind === "phase" || kind === "recall" ? ["Alchemy Shop"] : ["General Store"];
}
function shoppingList(needs, store, gold, persona) {
  if (store.isHome) return [];
  const reserve = Math.floor(gold * Math.max(0, (persona?.sliders.savings ?? 50) - 50) / 200);
  let left = Math.max(0, gold);
  const out = [];
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
function sellList(_pack, view, persona) {
  if (persona === null || persona.sliders.selling < 60) return [];
  const worn = new Set(view.equipment().filter((item) => item !== null).map((item) => item.handle));
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of view.inventory()) {
    const name = shownName2(item);
    if (name === null || worn.has(item.handle) || mightBeSpecial(name)) continue;
    const type = /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling|Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)\b/i.exec(name)?.[1];
    if (type === void 0) continue;
    if (persona.lists.weapons.some((favoured) => name.toLowerCase().includes(favoured.toLowerCase()))) continue;
    if (seen.has(type.toLowerCase())) out.push({ handle: item.handle, quantity: item.number, name });
    seen.add(type.toLowerCase());
  }
  return out;
}
function saleFits(name, storeName) {
  return storeName === "Armoury" ? /\b(Armour|Armor|Shield|Helm|Boots|Gloves|Cloak)\b/i.test(name) : storeName === "Weapon Smiths" && /\b(Sword|Dagger|Mace|Axe|Spear|Bow|Crossbow|Sling)\b/i.test(name);
}

// src/strategy/aims.ts
var FIXED_ORDER = ["spellbook", "lantern", "armour", "weapon", "free-action", "see-invisible", "depth"];
var BOOK_LOOKAHEAD = 5;
var FREE_ACTION_DEPTH = 20;
var SEE_INVISIBLE_DEPTH = 15;
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
function shelves(view) {
  let stores = [];
  try {
    stores = view.stores();
  } catch {
  }
  const shops = stores.filter((store) => !store.isHome);
  const wares = shops.flatMap((store) => store.stock.flatMap((item) => {
    const name = shownName2(item);
    return name !== null && item.price !== void 0 && item.price > 0 ? [{ name, tval: item.tval, price: item.price }] : [];
  }));
  return { wares };
}
function cheapest(wares, match) {
  let best = null;
  for (const ware of wares) if (match(ware) && (best === null || ware.price < best.price)) best = ware;
  return best;
}
function sourced(ware) {
  return ware === null ? { how: "hunt", price: null } : { how: "save", price: ware.price };
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
      detail: `Get the next spellbook, ${book.name}, whose first spell is level ${String(first)}. ${source.how === "save" ? `The stores sell it for ${String(source.price)} gold, so save that much.` : "The stores do not sell it, so hunt for it in the dungeon."}`,
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
    detail: `Use a Lantern instead of a wooden torch: it lights farther and refills from flasks of oil. ${source.how === "try" ? "One is in the pack." : source.how === "save" ? `The stores sell one for ${String(source.price)} gold.` : "None is for sale, so look for one in the dungeon."}`,
    ...source,
    depth: null
  };
}
function armourAim(view, shelf, packItems, worn) {
  const casts = view.spellbooks().some((book) => /arcane|necromantic/i.test(book.realm));
  const wornTvals = worn.map((item) => item.tval);
  const empty2 = ARMOUR_SLOTS.filter((slot2) => !slot2.tvals.some((t) => wornTvals.includes(t)) && !(casts && slot2.name === "hands"));
  if (empty2.length === 0) return null;
  const wanted = empty2.flatMap((slot2) => slot2.tvals);
  const carried = packItems.some((item) => wanted.includes(item.tval));
  const source = carried ? { how: "try", price: null } : sourced(cheapest(shelf.wares, (ware) => wanted.includes(ware.tval)));
  return {
    kind: "armour",
    label: "armour for empty slots",
    detail: `Nothing is worn on the ${empty2.map((slot2) => slot2.name).join(", ")}. ${source.how === "try" ? "Armour for it is in the pack." : source.how === "save" ? `The cheapest piece in the stores costs ${String(source.price)} gold.` : "None is for sale, so look for some in the dungeon."}`,
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
  return { kind: "weapon", label: "magic weapon", detail: `Buy a magical or ego weapon: the stores have ${ware.name} for ${String(ware.price)} gold.`, how: "save", price: ware.price, depth: null };
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
function candidateAims(view) {
  const player = view.player();
  const shelf = shelves(view);
  const packItems = view.inventory();
  const pack = namesOf(packItems);
  const worn = view.equipment().flatMap((item) => item === null ? [] : [item]);
  const target = depthTarget(player.level, player.maxHp);
  const depth = {
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
    depth
  ];
  return found.filter((aim) => aim !== null);
}
function inFixedOrder(aims) {
  return [...aims].sort((a, b) => FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
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
    case "depth":
      return false;
  }
}
function aimPurchase(aims, store, gold) {
  if (store.isHome) return null;
  for (const aim of aims) {
    if (aim.price === null || !affordable(aim, gold)) continue;
    const ware = store.stock.find((item) => {
      const name = shownName2(item);
      return name !== null && item.price !== void 0 && item.price > 0 && matchesAim(aim, name, item.tval);
    });
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
function neededEntrances(view, terrain, persona, visited = /* @__PURE__ */ new Set(), aims = []) {
  if (view.player().depth !== 0) return [];
  const pack = readPack(view);
  const needs = supplyNeeds(view, pack, persona);
  const sales = sellList(pack, view, persona);
  const gold = view.player().gold;
  return shopEntrances(view, terrain).filter((entrance) => {
    if (visited.has(entrance.feat)) return false;
    const buying = gold > 0 && needs.some((need) => need.have < need.want && storesFor(need.kind).includes(entrance.name));
    const aiming = aims.some((aim) => affordable(aim, gold) && aimStores(aim).includes(entrance.name));
    return buying || aiming || sales.some((sale) => saleFits(sale.name, entrance.name));
  }).sort((a, b) => {
    const rank2 = (shop) => shop.name === "Alchemy Shop" ? 0 : shop.name === "General Store" ? 1 : 2;
    return rank2(a) - rank2(b);
  });
}
function townTripPlan(terrain, persona, visited = /* @__PURE__ */ new Set(), log = () => {
}, aims = []) {
  const progress = newProgress(0);
  return {
    label: "shop for supplies",
    step(view, act) {
      if (view.player().depth !== 0) return null;
      const at = view.player().grid;
      const cell2 = view.cell(at.x, at.y);
      if (cell2 !== null && terrain.isShopEntrance(cell2.feat) && !visited.has(cell2.feat)) {
        const found = view.stores().find((entry) => entry.feat === cell2.feat);
        const store = found === void 0 ? void 0 : { ...found, featName: terrain.shopName(cell2.feat) ?? found.featName };
        if (store === void 0) {
          visited.add(cell2.feat);
          log("shop: this store has no stock to read");
          return act.shopExit();
        }
        const pack = readPack(view);
        const sale = sellList(pack, view, persona).find((item) => saleFits(item.name, store.featName));
        if (sale !== void 0) {
          log(`shop: selling ${sale.name} in the ${store.featName}`);
          return act.shopSell(sale.handle, sale.quantity);
        }
        const purchase = shoppingList(supplyNeeds(view, pack, persona), store, view.player().gold, persona)[0];
        if (purchase !== void 0) {
          log(`shop: buying ${String(purchase.quantity)} from "${purchase.name}" in the ${store.featName}`);
          return act.shopBuy(purchase.index, purchase.quantity);
        }
        const aimed = aimPurchase(aims, store, view.player().gold);
        if (aimed !== null) {
          log(`shop: buying ${aimed.name} in the ${store.featName} for the aim: ${aimed.aim}`);
          return act.shopBuy(aimed.index, aimed.quantity);
        }
        visited.add(cell2.feat);
        const shelf = store.stock.slice(0, 8).map((item) => `${item.name ?? "?"} at ${String(item.price ?? "?")}`).join("; ");
        log(`shop: done in the ${store.featName} with ${String(view.player().gold)} gold (${shelf})`);
        return act.shopExit();
      }
      const next = neededEntrances(view, terrain, persona, visited, aims)[0];
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
function servedBy(offer, view, aims, gold) {
  const depth = view.player().depth;
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
        serves = aim.kind === "depth" && aim.depth !== null && aim.depth > depth;
        break;
      case "explore":
        serves = depth > 0 && (aim.kind === "depth" && aim.depth !== null && aim.depth <= depth || aim.how === "hunt");
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
  const wanted = steering.aims.find((aim) => affordable(aim, player.gold));
  if (wanted !== void 0 && player.depth > 0 && !context.recallActive && !out.some((o) => o.goal === "recall_town") && steering.tripAllowed(player.gold) && canRead(view) && recallItem(view) !== null) {
    out.push(make("recall_town", `Read Word of Recall to return to town with ${String(player.gold)} gold, enough to buy the aim: ${wanted.label}.`, context.tripRisk));
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
function holdDescent(dist, aims, view, badFeeling) {
  const out = { ...dist };
  const current2 = out["descend"];
  if (current2 === void 0) return out;
  const depth = view.player().depth;
  const target = aims.find((a) => a.kind === "depth" && a.depth !== null)?.depth ?? null;
  if (target === null || depth < target || descentEscapes(view, badFeeling)) return out;
  out["descend"] = current2 * HOLD_SHARE;
  return out;
}

// src/brain/combat-kit.ts
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
  const recall = inspecting(view).monsterRecall;
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

// src/brain/items.ts
var TV_GOLD = 1;
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
function itemValue(view, at, item) {
  if (typeof item.value === "number") return item.value;
  const index = item.floorIndex;
  const v = inspecting(view);
  if (v.inspectItem === void 0 || index === void 0) return null;
  const info = v.inspectItem({ floor: { x: at.x, y: at.y, index } });
  if (info === null) return null;
  const match = /(\d+)\s+gold/i.exec(info.text) ?? /value[:\s]+(\d+)/i.exec(info.text);
  return match === null ? null : Number(match[1]);
}
function judge(view, at, item) {
  const name = shownName2(item) ?? item.label;
  const value = itemValue(view, at, item);
  const gold = item.tval === TV_GOLD;
  const useful = USEFUL.some((pattern) => pattern.test(name));
  const sellable = !useful && (mightBeSpecial(name) || value !== null && value >= LOOT_VALUE);
  return { gold, sellable, useful, value, name };
}
function floorTarget(view, terrain, saving) {
  const player = view.player();
  const at = player.grid;
  const bounds = view.mapBounds();
  const routable = (grid) => isRoutable(view, terrain, grid);
  const field = flowFrom({ goals: [at], canEnter: routable });
  let best = null;
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell2 = view.cell(x, y);
      if (cell2 === null || !cell2.known || cell2.objectCount === 0) continue;
      const here = { x, y };
      if (here.x === at.x && here.y === at.y) continue;
      if (!Number.isFinite(field.distance(here))) continue;
      for (const item of view.floorItems(x, y)) {
        const verdict = judge(view, here, item);
        const wanted = verdict.gold || verdict.sellable || !saving && verdict.useful;
        if (!wanted) continue;
        const away = steps(at, here);
        if (best === null || away < best.away) best = { at: here, name: verdict.name, away, gold: verdict.gold, sellable: verdict.sellable, useful: verdict.useful, value: verdict.value };
      }
    }
  }
  return best;
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

// src/brain/goals.ts
var NONE_OF_THESE2 = "None of the listed options suits this moment.";
var FALLBACK_STEPS = 8;
var RETREAT_STEPS = 4;
var MISSILE_RANGE = 10;
function healthBand(hp, maxHp) {
  if (maxHp <= 0) return "unknown";
  const share2 = hp / maxHp;
  if (share2 >= 0.9) return "full";
  if (share2 >= 0.6) return "lightly hurt";
  if (share2 >= 0.35) return "badly hurt";
  return "near death";
}
var RECALL_MIN_GOLD = 50;
var ESCAPE_BELOW_HP = 0.7;
var DAMAGE_SHARE_REDECIDE = 0.1;
var BAD_CUT = 25;
var NASTY_CUT = 50;
var STATIONARY_DECISIONS = 3;
var SWARM_LEAVE = 6;
var SWARM_LEAVE_DREADED = 3;
var REFUSED_COMMANDS = 3;
var SAME_SITUATION_TURNS = 50;
var FORCED_RISK = 0.3;
var ROUTINE = ["wear", "detect", "study", "wait"];
var READS = /* @__PURE__ */ new Set(["cast_attack", "cast_heal", "study", "detect", "recall_town", "recall_dungeon"]);
var REFUSAL_HOLD_TURNS = 200;
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
function situationOf(view, dreaded = /* @__PURE__ */ new Set(), stationary = /* @__PURE__ */ new Set()) {
  const player = view.player();
  const monsters = view.monsters();
  const awake = awakeInSight(monsters);
  const target = pickTarget(monsters, player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
  const worst = awake.reduce((max, m) => Math.max(max, assessThreat(m, player, awake, view, dreaded).band), -1);
  const swarm = swarmOf(monsters);
  return {
    dreaded,
    stationary,
    swarm,
    swarming: swarm !== null && swarm.count >= (dreaded.has(swarm.race) ? SWARM_LEAVE_DREADED : SWARM_LEAVE),
    view,
    pack: readPack(view),
    awake,
    target,
    worst,
    hpShare: player.maxHp > 0 ? player.hp / player.maxHp : 1
  };
}
function clamp01(n) {
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
  const target = s.target === null ? 0 : assessThreat(s.target, s.view.player(), s.awake, s.view, s.dreaded).band;
  const band = Math.max(target, s.worst);
  return clamp01((BAND_RISK[band] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.4) * crowd(s) * (s.swarming ? 1.5 : 1));
}
function exposure(s) {
  if (s.worst < 0) return 0.01;
  const at = s.view.player().grid;
  const nearest = s.awake.reduce((min, m) => Math.min(min, steps(at, m.grid)), Infinity);
  const proximity = nearest <= 2 ? 1 : nearest <= 5 ? 0.8 : 0.55;
  return clamp01((BAND_RISK[s.worst] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.2) * proximity * crowd(s));
}
function within(s, range) {
  return s.target !== null && steps(s.view.player().grid, s.target.grid) <= range;
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
function reachableFrontier(view, terrain) {
  const goals = frontiers(view, terrain);
  if (goals.length === 0) return false;
  const me = view.player().grid;
  if (goals.some((g) => g.x === me.x && g.y === me.y)) return true;
  const field = flowFrom({ goals, canEnter: (grid) => isRoutable(view, terrain, grid) });
  return Number.isFinite(field.distance(view.player().grid));
}
var RECALL_WAIT_TURNS = 400;
function recallPending(player, read, turn) {
  const reported = player.recall;
  if (typeof reported === "number") return reported > 0;
  const depth = player.depth;
  return read !== null && read.depth === depth && turn - read.turn >= 0 && turn - read.turn <= RECALL_WAIT_TURNS;
}
function offersFor(s, cfg, terrain, persona = null, visited = /* @__PURE__ */ new Set(), triedStudies = /* @__PURE__ */ new Set(), newLevel = false, recallActive = false, widen = false, saving = false, rememberedFeeling = null, aims = []) {
  const view = s.view;
  const player = view.player();
  const at = player.grid;
  const hurt = player.hp < player.maxHp;
  const out = [];
  const add2 = (goal, criteria, risk, routine = false) => out.push({ goal, criteria, risk: clamp01(risk), ...routine ? { routine: true } : {} });
  const addLeave = (criteria, risk) => {
    if (!out.some((o) => o.goal === "leave_level")) add2("leave_level", criteria, risk);
  };
  const needs = supplyNeeds(view, s.pack, persona);
  const recall = canRead(view) ? recallItem(view) : null;
  const townRisk = s.awake.some((m) => steps(at, m.grid) <= 3) ? Math.max(0.02, BAND_RISK[s.worst] ?? 0.75) : 0.02;
  const starving = needs.some((n) => n.kind === "food" && n.have === 0 && n.hungry === true);
  const defenceless = s.pack.heal.length === 0 && s.pack.phase.length === 0 && s.pack.teleport.length === 0 && s.pack.escapeSpell.length === 0;
  const tripPays = starving || player.gold >= RECALL_MIN_GOLD && (player.depth >= RECALL_FROM_DEPTH || defenceless);
  if (recallActive) {
    add2("wait", "Wait a turn for the Word of Recall already read to take effect.", exposure(s) * 0.8, s.awake.length === 0);
  }
  if (!recallActive && player.depth > 0 && recall !== null && lowOnSupplies(needs) && tripPays) {
    const low = needs.filter((n) => n.kind !== "recall" && n.have < (n.kind === "healing" ? 2 : n.kind === "phase" ? 1 : n.hungry ? 1 : 0));
    add2("recall_town", `Read Word of Recall to return to town and restock. The character is low on ${low.map((n) => n.name).join(", ")}.`, townRisk);
  }
  if (player.depth === 0) {
    const shops = neededEntrances(view, terrain, persona, visited, aims);
    if (shops.length > 0) {
      const missing = needs.filter((n) => n.have < n.want).map((n) => n.name);
      add2("shop", `Visit the shops for ${missing.join(", ") || "surplus gear sales"}.`, townRisk);
    } else if (!recallActive && recall !== null && player.maxDepth > 1) {
      add2("recall_dungeon", `Read Word of Recall to return to the deepest level reached, ${String(player.maxDepth * 50)} ft.`, townRisk);
    }
  }
  if (s.target !== null) {
    const adjacent2 = steps(at, s.target.grid) <= 1;
    const walkUp = !adjacent2 && !s.stationary.has(s.target.id) && canReach(view, terrain, s.target.grid);
    if ((adjacent2 || walkUp) && player.status.afraid === 0) {
      const away = steps(at, s.target.grid);
      add2("fight", adjacent2 ? `Fight the ${s.target.race} in melee until it dies or something changes.` : `Walk ${String(away)} steps to the ${s.target.race}${s.target.asleep ? ", waking it," : ""} and fight it in melee; it can strike first while the character closes in.`, fightRisk(s));
    }
    const ranged = within(s, MISSILE_RANGE);
    const clear = clearShot(view, s.target);
    const standing = exposure(s);
    if (ranged && clear && s.pack.launcher && s.pack.ammo[0] !== void 0) {
      add2("shoot", `Fire at the ${s.target.race} with the equipped launcher (carrying ${s.pack.ammo[0].name}).`, Math.max(fightRisk(s) * 0.7, standing));
    }
    if (ranged && clear && s.pack.oil[0] !== void 0) {
      add2("throw_oil", `Throw a flask of oil at the ${s.target.race}; it burns for good damage early in the game (carrying ${s.pack.oil[0].name}).`, Math.max(fightRisk(s) * 0.7, standing));
    }
    if (ranged && clear && s.pack.attackWand[0] !== void 0) {
      add2("aim_wand", `Aim ${s.pack.attackWand[0].name} at the ${s.target.race}.`, Math.max(fightRisk(s) * 0.65, standing));
    }
    const spell = pickAttackSpell(s.pack.attackSpell, spellInfoOf(view));
    if (ranged && spell !== void 0 && (clear || /(?:ball|orb|cloud|storm)/i.test(spell.name) && bestBallAim(view, s.awake, s.target) !== null)) {
      add2("cast_attack", `Cast ${spell.name} at the ${s.target.race}: it costs ${String(spell.mana)} of the ${String(player.sp)} mana left (${String(spell.fail)}% chance to fail).`, Math.max(fightRisk(s) * 0.65, standing));
    }
  }
  const cutBad = player.status.cut > BAD_CUT && s.pack.heal[0] !== void 0;
  const bleeding = player.status.cut > NASTY_CUT && s.pack.heal[0] !== void 0;
  if ((hurt || cutBad) && s.pack.heal[0] !== void 0) {
    add2("heal", `Drink ${s.pack.heal[0].name} to restore hit points.${cutBad ? " It also closes the bleeding wound." : ""}`, exposure(s) * (cutBad ? 0.2 : 0.5));
  }
  const healSpell = s.pack.healSpell[0];
  if (hurt && healSpell !== void 0) {
    add2("cast_heal", `Cast ${healSpell.name} to restore hit points (${String(healSpell.fail)}% chance to fail).`, exposure(s) * 0.6);
  }
  if (widen && !(s.swarming && s.swarm !== null) && s.awake.length > 0 && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave("Walk to the nearest staircase, up or down, and take it to leave every creature on this level behind.", exposure(s) * 0.4);
  }
  if (s.swarming && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`Walk to the nearest staircase, up or down, and take it. ${String(s.swarm.count)} ${s.swarm.race} are in sight and breed faster than they die; a new level leaves them behind.`, exposure(s) * 0.3);
  }
  const outOfMana = player.maxSp > 0 && player.sp === 0;
  if (outOfMana && s.swarm !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`The character is out of mana and ${s.swarm.race} breeds; walk to the stairs and leave rather than melee it.`, exposure(s) * 0.3);
  }
  const feeling = rememberedFeeling ?? badLevelFeeling(view.messages());
  if (feeling !== null && player.depth > 0 && reachableAnyStairs(view, terrain)) {
    addLeave(`Leave the level: the game says "${feeling}"`, exposure(s) * 0.3);
  }
  if (s.awake.length > 0 && (widen || s.worst >= 1 || s.hpShare < ESCAPE_BELOW_HP || player.status.afraid > 0)) {
    if (s.pack.phase[0] !== void 0 || s.pack.escapeSpell[0] !== void 0) {
      const how2 = s.pack.phase[0]?.name ?? s.pack.escapeSpell[0]?.name ?? "";
      add2("phase", `Use ${how2}: a short random teleport that breaks contact for a moment.`, exposure(s) * 0.4);
    }
    if (s.pack.teleport[0] !== void 0) {
      const teleport = s.pack.teleport[0];
      const leaves = /Teleport Level/i.test(teleport.name);
      add2("teleport", leaves ? `Use ${teleport.name} to leave this level entirely, going one level up or down.` : `Use ${teleport.name} to escape far from every creature in sight.`, exposure(s) * (leaves ? 0.3 : 0.2));
    }
    add2("retreat", reachableAnyStairs(view, terrain) ? "Head for the nearest known staircase and take it, leaving the awake creatures behind." : "Step up to four steps away from the awake creatures in sight; one standing next to the character may still strike as it leaves.", exposure(s) * 0.8);
  }
  if (!bleeding && s.awake.length === 0 && (hurt || player.sp < player.maxSp)) {
    add2("rest", "Rest until hit points and mana recover.", 0.01);
  }
  if (hungry(view) && s.pack.food[0] !== void 0) {
    add2("eat", `Eat ${s.pack.food[0].name}; the character is hungry.`, exposure(s));
  }
  const gear = gearCandidates(view).find((g) => !g.unknown || (persona?.sliders.curiosity ?? 0) >= 50);
  const unlit = gear !== void 0 && gear.criteria.includes("has no light");
  if (!bleeding && gear !== void 0 && (unlit || !s.awake.some((m) => steps(at, m.grid) <= 3))) {
    add2("wear", gear.criteria, Math.max(gear.unknown ? 0.05 : 0.02, exposure(s)), !gear.unknown && s.awake.length === 0);
  }
  if (!bleeding && newLevel && player.depth > 0 && s.awake.length === 0) {
    const source = detectionSource(view);
    if (source !== null) add2("detect", `${source.kind === "cast" ? "Cast" : source.kind === "zap" ? "Zap" : "Read"} ${source.name} to survey this new level.`, 0.02, true);
  }
  const study = studyable(view, triedStudies);
  const learnFirst = study !== null && s.awake.length === 0;
  if (!bleeding && study !== null && !s.awake.some((m) => steps(at, m.grid) <= 2)) {
    add2("study", `Learn the spell ${study.spell} from a carried book. It takes one turn.`, exposure(s), s.awake.length === 0);
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
    if (device !== null) add2("device", `Use ${device.name} to restore hit points.`, exposure(s) * 0.5);
  }
  const breather = breatherInSight(view, s.awake);
  if (!bleeding && breather !== null) {
    const resist = resistUse(view);
    if (resist !== null) add2("resist", `Use ${resist.name} before the ${breather.race} breathes${breather.element === null ? "" : ` ${breather.element}`}.`, exposure(s) * 0.6);
  }
  const full = packFull(view);
  if (!bleeding && !full) {
    const loot = floorTarget(view, terrain, saving);
    if (loot !== null) {
      const why = loot.gold ? " It is gold, which buys the aim." : loot.sellable ? " It looks worth selling." : "";
      add2("fetch", `Walk ${String(loot.away)} step${loot.away === 1 ? "" : "s"} to the ${loot.name} on the floor and pick it up.${why}`, exposure(s) + 0.02);
    }
  }
  if (!bleeding && full) {
    const junk = junkInPack(view);
    if (junk !== null) add2("drop_junk", `The pack is full; drop ${junk.name} to make room.`, exposure(s));
  }
  if (hasFloorObject(view, at) && !full) add2("pick_up", "Pick up the object on the floor under the character.", exposure(s));
  if (!unlit && !learnFirst && !bleeding && reachableFrontier(view, terrain)) {
    add2("explore", "Walk toward the nearest unexplored ground on this level.", exposure(s) + 0.02);
  }
  if (!unlit && !learnFirst && !bleeding && reachableStairs(view, terrain) && cfg.descend && /* In town, the stairs are the way down whenever recall cannot be: no scroll,
   * or no depth yet to return to. Shopping comes first while there is gold. */
  (player.depth > 0 || (recall === null || player.maxDepth <= 1) && (player.gold <= 0 || neededEntrances(view, terrain, persona, visited, aims).length === 0))) {
    add2("descend", "Walk to a known down staircase and take it to the next, more dangerous level.", exposure(s) + (1 - s.hpShare) * 0.3);
  }
  return out;
}
function createGoalPlanner(options) {
  const { cfg, terrain, log } = options;
  const personaOption = options.persona;
  const personaOf = typeof personaOption === "function" ? personaOption : () => personaOption ?? null;
  const rng = options.rng ?? Math.random;
  const backstoryTokens = options.backstoryTokens ?? 600;
  let lastAwake = /* @__PURE__ */ new Set();
  const visitedShops = /* @__PURE__ */ new Set();
  const triedStudies = /* @__PURE__ */ new Set();
  let decisionDepth = null;
  let recallRead = null;
  const stalled = /* @__PURE__ */ new Map();
  const refused = /* @__PURE__ */ new Map();
  let lastAnswer = null;
  let fallbackStalled = null;
  let widenNext = false;
  let lastOutcome = null;
  let outcomeVersion = 0;
  let badFeeling = null;
  let feelingDepth = -1;
  function noteFeeling(view) {
    const depth = view.player().depth;
    const messages = view.messages();
    if (depth !== feelingDepth || arrivalFeeling(messages)) {
      feelingDepth = depth;
      badFeeling = null;
    }
    const seen = badLevelFeeling(messages);
    if (seen !== null) badFeeling = seen;
  }
  function noteOutcome(text) {
    lastOutcome = text;
    outcomeVersion += 1;
  }
  function noteStalls(goal, plan) {
    let issued = 0;
    let startTurn = null;
    let credited = false;
    const version = outcomeVersion;
    const settle = (v) => {
      if (credited || goal === null || issued === 0 || startTurn === null || v.turn() === startTurn) return;
      credited = true;
      options.orders?.carried(goal, v);
    };
    const step = (v, act) => {
      startTurn ??= v.turn();
      settle(v);
      const command = plan.step(v, act);
      if (command !== null) issued += 1;
      else if (issued === 0 || v.turn() === startTurn) {
        if (goal === null) fallbackStalled = v.turn();
        else stalled.set(goal, v.turn());
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
    return { ...plan, step, settle };
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
    return { view, act, terrain, cfg: with_, progress, log };
  }
  let seenDepth = -1;
  const seenOnLevel = /* @__PURE__ */ new Set();
  function noteSeen(view) {
    const depth = view.player().depth;
    if (depth !== seenDepth) {
      seenDepth = depth;
      seenOnLevel.clear();
      breedersOnLevel.clear();
    }
    const live = new Set(view.monsters().map((m) => m.id));
    for (const id of seenOnLevel) if (!live.has(id)) seenOnLevel.delete(id);
    for (const m of view.monsters()) {
      if (!m.visible) continue;
      seenOnLevel.add(m.id);
      if (m.raceFlags.includes("MULTIPLY")) breedersOnLevel.add(m.race);
    }
  }
  const breedersOnLevel = /* @__PURE__ */ new Set();
  function routineBreeder(m, now) {
    return m.raceFlags.includes("MULTIPLY") && breedersOnLevel.has(m.race) && steps(now.player().grid, m.grid) > 1;
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
      stopOnAnyDamage: hurt && player.status.poisoned === 0 && player.status.cut === 0,
      stopOnNewCreature: true,
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction,
      /* Above the line, a big blow or a run of smaller ones is news too. */
      stopOnDamageShare: DAMAGE_SHARE_REDECIDE,
      routine: routineBreeder
    });
    for (const id of seenOnLevel) watcher.acknowledge(id);
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
      if (ball && inspecting(ctx.view).blastArea !== void 0 && inspecting(ctx.view).projectionPath !== void 0) {
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
    const next = volleySteps(goal, target.id, spellSidx);
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
    const pack = readPack(view);
    switch (goal) {
      case "recall_town":
      case "recall_dungeon": {
        const item = recallItem(view);
        if (item === null) return once("no recall scroll", view, () => null);
        recallRead = { turn: view.turn(), depth: view.player().depth };
        return watched(recallPlan(item), view);
      }
      case "shop":
        return watched(townTripPlan(terrain, personaOf(), visitedShops, log, options.strategy?.().aims ?? []), view);
      case "fight":
        return missionPlan("fight", autofight(), view, fightCfg);
      case "shoot": {
        if (volleyAvailable(view)) return volleyPlan("shoot", "shoot", view);
        const ammo = pack.ammo[0];
        return atTarget("shoot", view, (ctx) => ctx.act.fire(ammo?.handle ?? 0));
      }
      case "throw_oil": {
        if (volleyAvailable(view)) return volleyPlan("throw_oil", "throw oil", view);
        const oil = pack.oil[0];
        return atTarget("throw oil", view, (ctx) => ctx.act.throw(oil?.handle ?? 0));
      }
      case "aim_wand": {
        const wand = pack.attackWand[0];
        if (volleyAvailable(view)) return volleyPlan("aim_wand", `aim ${wand?.name ?? "a wand"}`, view);
        return atTarget(`aim ${wand?.name ?? "a wand"}`, view, (ctx) => ctx.act.aimWand(wand?.handle ?? 0));
      }
      case "cast_attack": {
        const spell = pickAttackSpell(pack.attackSpell, spellInfoOf(view));
        const label = `cast ${spell?.name ?? "a spell"}`;
        const ball = spell !== void 0 && /(?:ball|orb|cloud|storm)/i.test(spell.name);
        if (!ball && spell !== void 0 && volleyAvailable(view)) return volleyPlan("cast_attack", label, view, spell.sidx);
        return atTarget(label, view, (ctx) => ctx.act.cast(spell?.sidx ?? 0), ball);
      }
      case "heal": {
        const potion = pack.heal[0];
        return once(`drink ${potion?.name ?? "a potion"}`, view, (ctx) => potion === void 0 ? null : ctx.act.quaff(potion.handle));
      }
      case "cast_heal": {
        const spell = pack.healSpell[0];
        return once(`cast ${spell?.name ?? "a spell"}`, view, (ctx) => spell === void 0 ? null : ctx.act.cast(spell.sidx));
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
      case "retreat":
        return stepsPlan("back away", view, (ctx, i) => {
          const stairs = knownStairs(ctx.view, terrain);
          if (stairs.length > 0 && reachableAnyStairs(ctx.view, terrain)) {
            const here = ctx.view.player().grid;
            const cell2 = ctx.view.cell(here.x, here.y);
            if (cell2 !== null && terrain.isDownStair(cell2.feat)) return ctx.act.descend();
            if (cell2 !== null && terrain.isUpStair(cell2.feat)) return ctx.act.ascend();
            if (i === 0) {
              const engine = engineTravel(ctx, stairs, { run: true });
              if (engine !== null) return engine;
            }
            const travel = travelTo(ctx, stairs);
            return travel.kind === "step" ? travel.command : null;
          }
          if (i >= RETREAT_STEPS) return null;
          const away = retreatFrom(ctx, awakeInSight(ctx.view.monsters()).map((m) => m.grid));
          return away.kind === "step" ? away.command : null;
        });
      case "rest":
        return once("rest", view, (ctx) => ctx.act.rest());
      case "wait":
        return once("wait a turn", view, (ctx) => ctx.act.hold());
      case "study": {
        const study = studyable(view, triedStudies);
        if (study === null) return once("nothing to study", view, () => null);
        triedStudies.add(`${String(view.player().level)}:${String(study.sidx)}`);
        return once("study", view, (ctx) => ctx.act.raw("study", { handle: study.handle, spell: study.sidx }));
      }
      case "wear": {
        const candidate = gearCandidates(view).find((gear) => !gear.unknown || (personaOf()?.sliders.curiosity ?? 0) >= 50);
        return once(`wear ${candidate?.name ?? "gear"}`, view, (ctx) => candidate === void 0 ? null : ctx.act.wear(candidate.handle));
      }
      case "detect": {
        const source = detectionSource(view);
        return once(`detect with ${source?.name ?? "a known source"}`, view, (ctx) => {
          if (source === null) return null;
          if (source.kind === "cast") return ctx.act.cast(source.sidx);
          return source.kind === "zap" ? ctx.act.zapRod(source.handle) : ctx.act.read(source.handle);
        });
      }
      case "eat": {
        const food = pack.food[0];
        return once("eat", view, (ctx) => food === void 0 ? null : ctx.act.eat(food.handle));
      }
      case "pick_up":
        return once("pick up", view, (ctx) => ctx.act.pickup());
      case "fetch":
        return (() => {
          const loot = floorTarget(view, terrain, savingFor(view));
          if (loot === null) return once("nothing to fetch", view, () => null);
          let grabbed = false;
          return stepsPlan("fetch item", view, (ctx) => {
            if (grabbed) return null;
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
        return missionPlan("explore", autoexplore({ allowAwake: true }), view);
      case "leave_level":
        return stepsPlan("take the nearest stairs", view, (ctx, i) => {
          const here = ctx.view.player();
          if (here.depth !== view.player().depth) return null;
          const cell2 = ctx.view.cell(here.grid.x, here.grid.y);
          if (cell2 !== null && terrain.isDownStair(cell2.feat)) return ctx.act.descend();
          if (cell2 !== null && terrain.isUpStair(cell2.feat)) return ctx.act.ascend();
          if (i === 0) {
            const engine = engineTravel(ctx, knownStairs(ctx.view, terrain), { run: true });
            if (engine !== null) return engine;
          }
          const travel = travelTo(ctx, knownStairs(ctx.view, terrain));
          return travel.kind === "step" ? travel.command : null;
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
    const record2 = (pick3, extra) => {
      digest.trace = { advice, pick: pick3, ...extra };
      return pick3;
    };
    const blank = { best: best.probabilities, inCharacter: null, blended: best.probabilities, strength: 0, removed: [] };
    if (mustPickUp(persona) && offered.has("pick_up")) return record2("pick_up", { ...blank, quirk: "compulsive collector" });
    if (fleesFromNew(persona) && digest.newCreatures > 0) {
      const away = ["teleport", "phase", "retreat"].find((g) => offered.has(g));
      if (away !== void 0) return record2(away, { ...blank, quirk: "craven" });
    }
    const inChar = inCharacter?.type === "choice" ? inCharacter.probabilities : null;
    const strength = jitteredStrength(persona, rng);
    const blended = inChar === null ? { ...best.probabilities } : blend(best.probabilities, inChar, strength);
    const risk = { none_of_these: 0 };
    for (const offer of digest.offers) risk[offer.goal] = offer.risk;
    const weighted = options.orders === void 0 ? blended : options.orders.weigh(blended, answers, view, digest.offers);
    for (const goal of options.orders?.passes(view) ?? []) if ((risk[goal] ?? 0) > riskCeiling(persona)) risk[goal] = riskCeiling(persona);
    const nudged = holdDescent(nudgeAims(weighted, digest.offers, persona.sliders.ambition, riskCeiling(persona)), options.strategy?.().aims ?? [], view, badFeeling !== null);
    const floor = applySafetyFloor(nudged, risk, riskCeiling(persona), persona.quirks.deathwish.on);
    const pick2 = pick(floor.dist) ?? advice;
    return record2(pick2, { best: best.probabilities, inCharacter: inChar, blended: floor.dist, strength, removed: floor.removed });
  }
  function reflexFor(offers, persona, situation, turn, passes) {
    if (options.reflex === false) return null;
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
  return {
    ask(view) {
      const persona = personaOf();
      const player = view.player();
      if (player.depth > 0) visitedShops.clear();
      if (player.dead) return { handBack: "The character has died." };
      noteSeen(view);
      noteFeeling(view);
      const s = situationOf(view, dreadedNow(), stationaryNow(view));
      const turn = view.turn();
      for (const [goal2, at] of stalled) if (at !== turn) stalled.delete(goal2);
      const here = whereNow(view);
      for (const [goal2, r] of refused) if (r.where !== here || turn - r.turn > REFUSAL_HOLD_TURNS) refused.delete(goal2);
      const newLevel = decisionDepth !== player.depth;
      decisionDepth = player.depth;
      const widen = widenNext;
      widenNext = false;
      const recalling = recallPending(player, recallRead, turn);
      const saving = savingFor(view);
      const aims = options.strategy?.().aims ?? [];
      const usable = (offer) => !stalled.has(offer.goal) && !refused.has(offer.goal);
      const base = offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, widen, saving, badFeeling, aims);
      const offered = options.strategy === void 0 ? base : steerOffers(base, view, options.strategy(), { recallActive: recalling, tripRisk: Math.max(0.02, exposure(s)) }, (goal2, criteria2, risk) => ({ goal: goal2, criteria: criteria2, risk }));
      let offers = offered.filter(usable);
      const listed = new Set(offers.map((o) => o.goal));
      const missing = widen ? [] : offersFor(s, cfg, terrain, persona, visitedShops, triedStudies, newLevel, recalling, true, saving, badFeeling, aims).filter((o) => usable(o) && !listed.has(o.goal)).map((o) => o.goal);
      if (offers.length === 0 && offered.length > 0 && !stalled.has("wait")) {
        offers = [{ goal: "wait", criteria: "Wait a turn; nothing else on offer can be done from here right now.", risk: exposure(s) }];
      }
      if (offers.length === 0) {
        log(`goal: nothing to offer (light ${String(player.light)}, blind ${String(player.status.blind)}, confused ${String(player.status.confused)}, stalled: ${[...stalled.keys()].join(", ") || "none"}, refused: ${[...refused.keys()].join(", ") || "none"})`);
        return { handBack: "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down." };
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
      const creatureLines = seen.map((m) => {
        const rating = assessThreat(m, player, s.awake, view, s.dreaded);
        const real = rating.band;
        const seenAs = persona === null ? real : shiftThreat(real, THREAT_BANDS.length, persona, rng);
        if (seenAs !== real) believed.push(`the ${m.race} is ${THREAT_BANDS[seenAs] ?? "deadly"}`);
        const tags = [m.asleep ? "asleep" : "", m.afraid ? "afraid" : "", m.raceFlags.includes("UNIQUE") ? "unique" : ""].filter((t) => t !== "").join(", ");
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
        hungry(view),
        offers.map((o) => o.goal).sort(),
        options.orders?.revision(view) ?? "",
        [...passes].sort(),
        persona === null ? null : [riskCeiling(persona), persona.quirks.deathwish.on]
      ]);
      const reflex = reflexFor(offers, persona, situation, turn, passes);
      if (reflex !== null) {
        log(`goal: ${reflex.goal}, without asking (${reflex.why})`);
        options.orders?.decided(reflex.goal, view);
        const decided = {
          reflex: reflex.why,
          plan: noteStalls(reflex.goal, build(reflex.goal, view)),
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
            ground: standingOnHarm(view, terrain, player.grid) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored ? "Unexplored ground remains." : "The level is explored."} ${stairs ? "A down staircase is known." : "No down staircase is known."}`,
            status: statusOf(view, canRead(view)),
            ...lastOutcome === null ? {} : { last: lastOutcome },
            ...aimNote === null ? {} : { aims: aimNote },
            ...orderNote === null ? {} : { orders: orderNote },
            ...hungry(view) ? { hunger: "The character is hungry." } : {},
            ...swarmNote(seen),
            ...lessonsFor(view),
            ...persona === null ? {} : { persona: { name: persona.name, ...personaState(persona, backstoryTokens), ...believed.length === 0 ? {} : { believes: `${believed.join("; ")}.` } } }
          },
          questions: persona === null ? { goal } : { goal, in_character: { type: "choice", instructions: inCharacterInstructions(persona), criteria }, ...options.orders?.ask(offers, view) ?? {} }
        },
        context: { depth: player.depth, offers, newCreatures, situation, missing, ...widen ? { widened: true } : {} }
      };
      return question;
    },
    choose(answers, digest, view) {
      const answer = answers["goal"];
      if (answer?.type !== "choice") return { handBack: "The model gave no goal." };
      const pick2 = decide(answer, answers["in_character"], digest, answers, view);
      if (pick2 === "none_of_these") {
        const removed = new Set(digest.trace?.removed ?? []);
        const allowed = digest.offers.filter((o) => !removed.has(o.goal));
        const likeliest = [...allowed.length > 0 ? allowed : digest.offers].sort((a, b) => (answer.probabilities[b.goal] ?? 0) - (answer.probabilities[a.goal] ?? 0))[0];
        const p = view.player();
        const hurt = p.maxHp > 0 && p.hp <= p.maxHp * cfg.retreatFraction;
        const danger = hurt || digest.offers.some((o) => o.risk > 0.3);
        const missing = digest.missing ?? [];
        if (danger && digest.widened !== true && missing.length > 0) {
          widenNext = true;
          log(`goal: none fit in danger, asking again with ${missing.join(", ")} added`);
          return { plan: { label: "ask again with more options", step: () => null } };
        }
        if (likeliest !== void 0 && danger) {
          log(`goal: none fit in danger, taking the likeliest listed option (${likeliest.goal})`);
          return { plan: noteStalls(likeliest.goal, build(likeliest.goal, view)) };
        }
        if (likeliest !== void 0 && fallbackStalled === view.turn()) {
          log(`goal: none fit and the errand order has nothing to do, taking ${likeliest.goal}`);
          return { plan: noteStalls(likeliest.goal, build(likeliest.goal, view)) };
        }
        const rated = digest.offers.map((o) => `${o.goal} ${String(Math.round((answer.probabilities[o.goal] ?? 0) * 100))}%`).join(", ");
        log(`goal: none fit (${rated}), following the fixed errand order`);
        return { plan: noteStalls(null, missionPlan("follow the errand order", campaign(), view, cfg, FALLBACK_STEPS)) };
      }
      const offer = digest.offers.find((o) => o.goal === pick2);
      if (offer === void 0) {
        return { handBack: "The model picked an option Squire did not offer, so the keyboard is yours." };
      }
      options.orders?.decided(offer.goal, view);
      if (digest.situation !== void 0) lastAnswer = { situation: digest.situation, turn: view.turn(), pick: offer.goal };
      const trace = digest.trace;
      if (trace !== void 0 && trace.pick !== trace.advice) {
        log(`goal: ${pick2}, against advice (${trace.advice})${trace.quirk === void 0 ? "" : `: ${trace.quirk}`}`);
      } else {
        log(`goal: ${pick2} (${String(Math.round((answer.probabilities[pick2] ?? 0) * 100))}%)`);
      }
      return { plan: noteStalls(offer.goal, build(offer.goal, view)) };
    },
    trigger(view, plan) {
      const watched2 = plan;
      watched2.settle?.(view);
      const stopped = watched2.watcher?.check(view) ?? null;
      if (stopped !== null) noteOutcome(`${plan.label} stopped: ${stopped.detail}`);
      return stopped === null ? null : stopped.detail;
    }
  };
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
      const depth = aim.depth === null ? 0 : Math.max(1, Math.round(aim.depth * s));
      if (depth < 1 || depth > ceiling) continue;
      kept.push({ kind: "depth", depth });
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

// src/strategy/review.ts
var REVIEW_TURNS = 2e3;
var TRIGGER_TEXT = {
  arrival: "on reaching a new level",
  town: "after the town trip",
  level: "after gaining a level",
  periodic: "after 2,000 game turns"
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
function scoreRequest(view, aims) {
  const player = view.player();
  const questions = {};
  const described = {};
  for (const aim of aims) {
    questions[aim.kind] = {
      type: "score",
      instructions: `How worth pursuing right now is this aim: ${aim.label}? Judge it against the character's other aims and its chance of surviving.`,
      criteria: WORTH
    };
    described[aim.kind] = aim.detail;
  }
  return {
    state: {
      rules: "An aim is something worth working toward over the next few dungeon levels. Dying early ends every aim, so a safe gain outranks a risky one.",
      character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}), ${String(player.hp)} of ${String(player.maxHp)} hit points, ${String(player.gold)} gold.`,
      aims: described
    },
    questions
  };
}
function rankByScore(aims, answers) {
  const scoreOf = (aim) => {
    const answer = answers[aim.kind];
    return answer?.type === "score" ? answer.score : 0;
  };
  return [...aims].sort((a, b) => scoreOf(b) - scoreOf(a) || FIXED_ORDER.indexOf(a.kind) - FIXED_ORDER.indexOf(b.kind));
}
var TRIP_GOLD_GROWTH = 1.5;
function createStrategy(deps) {
  let memory = null;
  let aims = [];
  let last = null;
  let tripGold = null;
  let generation = 0;
  let inherited = [];
  let latest = 0;
  let inFlight = Promise.resolve();
  function clear() {
    memory = null;
    aims = [];
    last = null;
    tripGold = null;
    generation += 1;
  }
  function reset() {
    clear();
    inherited = [];
  }
  async function rank2(view, candidates) {
    const fixed = inFixedOrder(candidates);
    if (candidates.length < 2) return { ranked: fixed, source: "fixed", by: "" };
    const backend = deps.backend();
    if (backend === null) return { ranked: fixed, source: "fixed", by: " It kept the usual order, because no model server is set up." };
    const capped = deps.tally.overCap(backend, deps.now());
    if (capped !== null) return { ranked: fixed, source: "fixed", by: " It kept the usual order, because the spend limit is reached." };
    let result;
    try {
      result = await deps.send(scoreRequest(view, candidates));
    } catch {
      return { ranked: fixed, source: "fixed", by: " It kept the usual order, because the request failed." };
    }
    if (!result.ok) return { ranked: fixed, source: "fixed", by: ` It kept the usual order, because ${backend.label} answered with ${result.failure.kind}.` };
    deps.tally.record(backend, result.usage, deps.now());
    return { ranked: rankByScore(candidates, result.answers), source: "model", by: ` ${backend.label} ranked them.` };
  }
  async function review(view, trigger, turn, mine) {
    const seq = ++latest;
    const own = candidateAims(view);
    inherited = stillInherited(inherited, own, view.player().maxDepth, wieldsMagicWeapon(view));
    const candidates = withInherited(own, inherited);
    aims = inFixedOrder(candidates);
    const done = await rank2(view, candidates);
    if (mine !== generation || seq !== latest) return;
    aims = done.ranked;
    last = { trigger, turn, source: done.source };
    const names = done.ranked.map((aim) => aim.label).join(", ");
    deps.log(`Squire looked over its aims ${TRIGGER_TEXT[trigger]}: ${names === "" ? "none apply" : names}.${done.by}`);
  }
  return {
    observe(view) {
      const player = view.player();
      if (player.dead) return;
      const turn = view.turn();
      if (memory !== null && turn < memory.reviewTurn) clear();
      const trigger = reviewDue(memory, { depth: player.depth, level: player.level, turn });
      memory = { depth: player.depth, level: player.level, reviewTurn: trigger === null ? memory?.reviewTurn ?? turn : turn };
      if (trigger === null) return;
      if (trigger === "town") tripGold = player.gold;
      inFlight = review(view, trigger, turn, generation).catch((error) => {
        deps.log(`Squire couldn't look over its aims: ${String(error)}`);
      });
    },
    ranked: () => aims,
    last: () => last,
    tripAllowed: (gold) => tripGold === null || gold >= tripGold * TRIP_GOLD_GROWTH,
    inherit(list) {
      inherited = list;
    },
    reset,
    settled: () => inFlight
  };
}

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
function unit2(value) {
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
  return wants.length === 0 ? 0 : unit2(Math.max(...wants));
}
function targetAdherence(sorted, persona, viewer = false) {
  const s = persona.sliders;
  const pull = (s.devotion - 50) / 50 * 0.9;
  const grudge = s.resentment / 100 * 0.4;
  const friction = clash(sorted, persona) * (0.3 + 0.4 * (s.stubbornness / 100));
  const weight = 0.6 + 0.4 * (s.strength / 100);
  const own = unit2(0.5 + 0.5 * (pull - grudge - friction) * weight);
  return viewer && s.devotion < VERY_DEVOTED ? own * VIEWER_PULL : own;
}
function nextAdherence(previous, sorted, persona, viewer = false) {
  const target = targetAdherence(sorted, persona, viewer);
  if (previous === null) return target;
  const rate2 = Math.max(0.1, 1 - 0.9 * (persona.sliders.stubbornness / 100));
  return unit2(previous + (target - previous) * rate2);
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
  const a = unit2(instruction.adherence) * unit2(instruction.memory);
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
      const named2 = words.filter((w) => !FILLER.test(w)).join(" ");
      item = named2 === "" ? null : named2;
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
      const named2 = ban.item === null || (ban.item === "unknown" ? /\b(?:unknown|unidentified|untried)\b/i.test(words) : stem(words).includes(stem(ban.item)));
      if (named2) out.add(offer.goal);
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
  let depth = null;
  let deadlineLevel = null;
  let gold = null;
  const feet2 = /(\d[\d,]*)\s*(?:ft|feet)\b/.exec(t);
  const goldMatch = /(\d[\d,]*)\s*(?:gold|gp)\b/.exec(t);
  const before = /\b(?:before|by)\s+(?:character\s+)?level\s+(\d+)/.exec(t);
  const itemMatch = /\b(?:bring back|bring|keep|carry|buy|get|find|fetch|stock up on)\s+(?:(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:of\s+)?((?:potions?|scrolls?|flasks?|rations?|wands?|rods?|staffs?|staves|rings?|amulets?|arrows?|bolts?|shots?|pebbles?)\b[^.,;]*)/.exec(t);
  if (feet2 !== null) {
    depth = Math.max(1, Math.round(Number(feet2[1].replace(/,/g, "")) / 50));
    aim = "depth";
  } else if (/\b(?:reach|dive to|descend to|get to)\s+(?:dungeon\s+)?level\s+(\d+)/.exec(t) !== null) {
    depth = Number(/level\s+(\d+)/.exec(t)[1]);
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
      depth,
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
          const named2 = answer?.type === "choice" ? live.find((i) => i.id === answer.choice) : void 0;
          if (named2 !== void 0) target = named2;
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
      const same2 = items.find((i) => normal(i.text) === normal(trimmed) && (isLive(i.state) || i.state === "forgotten" && i.kind === "standing"));
      if (same2 !== void 0) {
        const again = replace(same2.id, { memory: 1, seenTurn: lastTurn, state: isLive(same2.state) ? same2.state : "following" });
        persist();
        return { ok: true, instruction: again ?? same2, repeated: true };
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
      const named2 = /* @__PURE__ */ new Set();
      for (const i of items) if (isLive(i.state) && i.kind === "order" && i.sorted.aim !== null && i.state !== "ignoring") named2.add(i.sorted.aim);
      if (named2.size === 0) return aims;
      return [...aims.filter((a) => named2.has(a.kind)), ...aims.filter((a) => !named2.has(a.kind))];
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
function num2(value, min, max, fallback) {
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
  const frequency = mode === "until-level" ? { mode, level: Math.round(num2(f["level"], 1, 50, 50)) } : { mode };
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
    count: Math.round(num2(r["count"], 1, 99, 1)),
    gold: optional(r["gold"], 0, 1e8),
    frequency,
    ...readHpBelow(r["hpBelow"]),
    ...readBansField(r["bans"])
  };
}
function readHpBelow(value) {
  const r = rec(value);
  if (r === null || typeof r["value"] !== "number" || !Number.isFinite(r["value"])) return {};
  if (r["kind"] === "hp") return { hpBelow: { kind: "hp", value: Math.round(num2(r["value"], 1, 1e5, 1)) } };
  if (r["kind"] === "share") return { hpBelow: { kind: "share", value: num2(r["value"], 0.01, 1, 0.5) } };
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
    memory: num2(r["memory"], 0, 1, 1),
    adherence: num2(r["adherence"], 0, 1, 0.5),
    familyCreed: kind === "standing" && r["familyCreed"] === true,
    createdTurn: num2(r["createdTurn"], 0, Number.MAX_SAFE_INTEGER, 0),
    seenTurn: num2(r["seenTurn"], 0, Number.MAX_SAFE_INTEGER, 0),
    acted: Math.round(num2(r["acted"], 0, 1e6, 0)),
    lowReviews: Math.round(num2(r["lowReviews"], 0, 1e3, 0)),
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
  let draining = null;
  let lastStamp = 0;
  let stampOrder = 0;
  async function request2(method, path, payload) {
    return net.request({
      url: `${endpoint.replace(/\/$/, "")}${path}`,
      method,
      headers: { "Content-Type": "application/json" },
      ...payload === void 0 ? {} : { body: payload },
      timeoutMs: 15e3
    });
  }
  async function post(batch) {
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
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
            await sleep(reply.status === 429 ? retryAfter2(reply.headers, now()) ?? BACKOFF[attempt] : BACKOFF[attempt]);
            continue;
          }
        } else if (attempt < BACKOFF.length) {
          await sleep(BACKOFF[attempt]);
          continue;
        }
      } catch {
        if (attempt < BACKOFF.length) {
          try {
            await sleep(BACKOFF[attempt]);
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
  async function drainOnce() {
    const results = /* @__PURE__ */ new Map();
    if (!endpoint) return results;
    try {
      for (const key2 of (await store.keys(QUEUE)).sort()) {
        const batch = await store.get(key2);
        if (object(batch) === null) {
          await store.delete(key2);
          continue;
        }
        const result = await post(batch);
        results.set(key2, result);
        if (result.ok || !result.queued) await store.delete(key2);
        else break;
      }
    } catch {
      log("Telemetry queue could not be read. Try sending again later.");
    }
    return results;
  }
  function drain() {
    if (draining !== null) return draining;
    draining = drainOnce().finally(() => {
      draining = null;
    });
    return draining;
  }
  return {
    async send(batch) {
      if (!endpoint) return { ok: false, queued: false, reason: "Telemetry is disabled. Set an endpoint to send batches." };
      try {
        const stamp = Math.max(now(), lastStamp);
        stampOrder = stamp === lastStamp ? stampOrder + 1 : 0;
        lastStamp = stamp;
        const key2 = `${QUEUE}${String(stamp).padStart(16, "0")}-${String(stampOrder).padStart(8, "0")}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
        await store.set(key2, batch);
        let results = await drain();
        if (!results.has(key2) && ![...results.values()].some((result) => !result.ok && result.queued)) {
          results = await drain();
        }
        return results.get(key2) ?? { ok: false, queued: true, reason: "Telemetry is queued behind an earlier batch. Try again later." };
      } catch {
        return { ok: false, queued: false, reason: "Telemetry could not be saved. Check local storage and try again." };
      }
    },
    async drain() {
      await drain();
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
      if (!endpoint) return { ok: false, reason: "Telemetry is disabled. Set an endpoint to delete an install." };
      try {
        const reply = await request2("DELETE", `/v1/installs/${encodeURIComponent(installId2)}`);
        if (!reply.ok) return { ok: false, reason: reply.problem };
        const parsed = body(reply.body);
        return reply.status === 200 && parsed?.["ok"] === true ? { ok: true, data: parsed } : { ok: false, reason: String(parsed?.["error"] ?? `HTTP ${String(reply.status)}`), ...typeof parsed?.["field"] === "string" ? { field: parsed["field"] } : {} };
      } catch {
        return { ok: false, reason: "Telemetry could not be deleted. Try again later." };
      }
    }
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
      ancestors: Array.isArray(l["ancestors"]) ? l["ancestors"].slice(-50) : [],
      lore: Array.isArray(l["lore"]) ? l["lore"].slice(-60) : [],
      grudges: Array.isArray(l["grudges"]) ? l["grudges"].slice(-30) : [],
      creeds: readInstructions(l["creeds"]).filter((i) => i.kind === "standing" && i.familyCreed),
      aims: readAims(l["aims"])
    };
  }
  return out;
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
      return heir !== null && typeof heir["lineage"] === "string" ? { lineage: heir["lineage"], parent: normalize(heir["parent"]) } : null;
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
function rollOnBirth(session, mode, random, log) {
  const cat = session.catalogue();
  const steps2 = [];
  if (mode === "like" && cat.previous !== null) {
    const previous = cat.previous;
    steps2.push(() => session.usePrevious());
    if (!cat.namePinned && previous.name.trim() !== "") steps2.push(() => {
      const named2 = session.setName(previous.name);
      return named2.ok ? named2 : session.randomName();
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
    const named2 = session.randomName();
    if (!named2.ok) {
      log(`Squire left the next character to you: ${named2.reason ?? "the game refused a name"}`);
      return false;
    }
  }
  const accepted = session.accept();
  if (!accepted.ok) log(`Squire left the next character to you: ${accepted.reason ?? "the game refused it"}`);
  return accepted.ok;
}
function rollOnPresenter(host, store = sessionMarks(), now = Date.now, random = Math.random) {
  return {
    show(session) {
      if (!takeRollOn(store, now())) return void 0;
      const mode = readConfig(host.prefs?.get()).rollOn;
      if (mode === "wait") return void 0;
      if (!rollOnBirth(session, mode, random, host.log)) return void 0;
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
  const share2 = input.maxHp > 0 ? input.hp / input.maxHp : 1;
  const hpBand = share2 >= 0.9 ? 0 : share2 >= 0.6 ? 1 : share2 >= 0.35 ? 2 : 3;
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
  const depth = 1 / (1 + Math.abs(a.depthBand - b.depthBand));
  const level = 1 / (1 + Math.abs(a.levelBand - b.levelBand));
  return 0.4 * overlap(a.families, b.families) + 0.3 * depth + 0.1 * (a.classId === b.classId ? 1 : 0) + 0.1 * level + 0.05 * (1 - Math.abs(a.hpBand - b.hpBand) / 3) + 0.05 * overlap(a.resources, b.resources);
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
  for (const record2 of records) criteria[record2.id] = `${record2.plan}: ${record2.summary}`;
  criteria["none_of_these"] = "No listed decision contributed most to the death.";
  return { type: "choice", instructions: "Which earlier decision contributed most to this death? Choose one listed decision or none_of_these.", criteria };
}
function applyBlame(answer, records) {
  return records.some((record2) => record2.id === answer.choice) ? answer.choice : null;
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
function decision(record2) {
  return strip({
    t: record2.turn,
    kind: record2.plan.trim().split(/\s+/)[0] || "unknown",
    question: record2.question,
    choice: record2.choice,
    confidence: record2.confidence,
    probs: record2.probs,
    outcome: record2.outcome
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
    for (const record2 of input.decisions) {
      const mapped = decision(record2);
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
  const share2 = Math.max(0, Math.min(1, parent.sliders.inheritance / 100));
  const count2 = Math.min(12, Math.floor(12 * share2));
  return creeds.filter((i) => i.kind === "standing" && i.familyCreed).sort((a, b) => b.memory - a.memory || a.createdTurn - b.createdTurn).slice(0, count2).map((i) => ({ ...i, memory: i.memory / 2 }));
}

// src/learning/lineage.ts
function unit3(rng) {
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
  if (parentPersona.toggles.grudges && death !== null) {
    const race = killerRace(death.cause);
    const family = familyOf(race);
    if (family !== "other") {
      grudges.push({ race, family, generation: parentLineage.generation });
      const target = sliders.boldness >= 50 ? lists.hated : lists.feared;
      if (!target.includes(family) && target.length < 12) target.push(family);
    }
  }
  const count2 = Math.min(12, Math.floor(12 * fraction(parentPersona.sliders.inheritance)));
  const lore = parentLineage.lore.map((lesson) => ({ lesson, tie: unit3(rng) })).sort((a, b) => b.lesson.weight - a.lesson.weight || a.tie - b.tie).slice(0, count2).map(({ lesson }) => ({ ...lesson, weight: lesson.weight / 2 }));
  const parent = {
    name: parentLineage.name,
    race: parentLineage.race ?? "unknown",
    cls: parentLineage.cls ?? "unknown",
    generation: parentLineage.generation,
    died: death
  };
  return {
    lineage: {
      name: heirPersona.name,
      generation: parentLineage.generation + 1,
      ancestors: [...parentLineage.ancestors, parent],
      lore,
      grudges,
      creeds: inheritCreeds(parentLineage.creeds ?? [], parentPersona),
      aims: inheritAims(parentLineage.aims ?? [], parentPersona, { ...heirPersona, sliders })
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
function notorietyState(event, personaName, depth, level) {
  return {
    persona: personaName,
    kind: event.kind,
    fact: event.text,
    turn: event.turn,
    eventDepth: event.depth,
    depth,
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
var ESCAPES = /* @__PURE__ */ new Set(["phase", "teleport", "retreat"]);
var ATTACKS = /* @__PURE__ */ new Set(["shoot", "throw_oil", "aim_wand", "cast_attack", "fight"]);
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
function named(view, message) {
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
    return lastDecision !== null && ESCAPES.has(lastDecision.choice) && turn - lastDecision.turn <= ESCAPE_WINDOW;
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
      const who = named(view, message);
      if (who === void 0) continue;
      if (RESIST_WORDS.test(message) && lastDecision !== null && ATTACKS.has(lastDecision.choice)) {
        learn("resisted", view, who.race, {}, `${who.race}:${lastDecision.choice}`);
        continue;
      }
      const ability = ABILITY_WORDS.find(([pattern]) => pattern.test(message))?.[1];
      if (ability !== void 0) learn("ability", view, who.race, { ability }, `${who.race}:${ability}`);
    }
  }
  function record2(event, notableByDefault) {
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
          record2(
            { kind: "descend", turn, depth: now.depth, text: record_ ? `a new record of ${String(now.depth * 50)} ft` : `down to ${String(now.depth * 50)} ft` },
            record_ && now.maxDepth % 5 === 0
          );
        }
        if (now.level > last.level) {
          record2({ kind: "level-up", turn, depth: now.depth, text: `reached character level ${String(now.level)}` }, now.level % 5 === 0);
          drift("level-up");
        }
        const nearDeath = now.hpShare < 0.2 && last.hpShare >= 0.35 && !now.dead;
        if (nearDeath) {
          const swarm = swarmOf(view.monsters());
          const swarmed = swarm !== null && swarm.count >= SWARM_LEAVE_DREADED ? swarm : null;
          const race = swarmed?.race ?? worstRace(view);
          record2(
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
      const depth = view?.player().depth ?? 0;
      const turn = view?.turn() ?? 0;
      record2({ kind: unique ? "unique-kill" : "kill", turn, depth, text: race, race }, unique);
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
      const depth = view?.player().depth ?? 0;
      if (pending !== null) pending.bad = true;
      record2({ kind: "death", turn, depth, text: cause }, true);
      const recent = records.slice(-BLAME_WINDOW);
      let blamed = null;
      if (deps.send !== null && recent.length > 0) {
        const blameRecords = recent.map((r) => ({ id: r.id, plan: r.plan, summary: String(r.state["health"] ?? "") }));
        const result = await deps.send({
          state: { death: cause, depth: `${String(depth * 50)} ft` },
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
    event: record2,
    state: () => ({ runLog: runLog.toJson(), chronicle, lessons, calibration })
  };
}
function heirFrom(lineage, parent, heir, rng) {
  if (lineage === void 0) return null;
  return inherit(lineage, parent, heir, rng);
}
function withAncestor(lineage, name, race, cls, died, lessons) {
  const base = lineage ?? { name, generation: 1, ancestors: [], lore: [], grudges: [] };
  return { ...base, name, race, cls, died, lore: [...base.lore, ...lessons].slice(-60) };
}

// src/learning/ranks.ts
function rankFor(agreementShare, examples) {
  if (examples >= 150 && agreementShare >= 0.75) return "Knight-Errant";
  if (examples >= 40 && agreementShare >= 0.55) return "Squire";
  return "Page";
}
function clamp012(value) {
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
    persona.sliders[key2] = Math.round(clamp012(value) * 100);
    confidence[key2] = clamp012(count2 / 20);
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
  fight: "fight in melee",
  shoot: "shoot",
  throw_oil: "throw oil",
  aim_wand: "aim a wand",
  cast_attack: "cast an attack spell",
  heal: "drink a healing potion",
  cast_heal: "cast a healing spell",
  phase: "phase away",
  teleport: "teleport away",
  retreat: "back away",
  rest: "rest",
  eat: "eat",
  study: "learn a spell",
  wear: "wear gear",
  detect: "survey the level",
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
  const share2 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const awake = view.monsters().filter((m) => m.visible && !m.asleep).map((m) => m.id).sort((a, b) => a - b).join(",");
  return { awake, hpBand: share2 >= 0.9 ? 0 : share2 >= 0.6 ? 1 : share2 >= 0.35 ? 2 : 3, depth: p.depth };
}
function isDecisionPoint(previous, now, goal) {
  if (goal === null) return false;
  if (previous === null) return true;
  if (goal !== "explore") return true;
  return previous.awake !== now.awake || previous.hpBand !== now.hpBand || previous.depth !== now.depth;
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
      won: model.headline.outcome === "victory",
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
            const routing2 = raw["routing"];
            if (routing2 !== null && typeof routing2 === "object" && !Array.isArray(routing2)) {
              const named2 = routing2["adapter"];
              if (typeof named2 === "string") adapter(named2);
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
    record(record2, seq, enabled, url, fallbacks = []) {
      if (record2.backend !== "Jev") return Promise.resolve();
      const ts = new Date(options.now()).toISOString();
      const tasks = [];
      for (const [questionId, pilot] of PILOTS) {
        const question = record2.request.questions[questionId];
        const answer = record2.answers[questionId];
        if (question === void 0 || answer === void 0) continue;
        const shouldSend = enabled && record2.backend === "Jev" && options.net !== null && !busy.has(pilot);
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
              state: record2.request.state,
              questions,
              jev: { model: record2.model ?? "jev-latest", answers: { [questionId]: answer } },
              outcome: { plan: record2.outcome }
            };
            await options.rows.append(row2, seq);
            rowWritten();
            if (!shouldSend || options.net === null) return;
            let adapter = "base";
            const request2 = { state: record2.request.state, questions };
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
    orders: readInstructions(data["orders"])
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
  const tracked = (controller) => (view, act) => {
    lastTurn = view.turn();
    lastView = view;
    journal.observe(view);
    channel.tick();
    const command = controller(view, act);
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
    log: (message) => host.log(message)
  });
  const orders = createOrders({
    backend: () => backendFor(config),
    send: (request2) => self.send(request2),
    tally,
    now,
    persona: () => character.persona,
    setPersona: (persona) => self.saveCharacter({ ...character, persona }),
    kept: () => config.instructionsKept,
    note: (text, notable, turn, depth) => journal.event({ kind: "instruction", turn, depth, text }, notable),
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
        if (cfg.useModel && net === void 0) host.log("This version of the game cannot send Squire's requests, so Squire runs its errands");
        return tracked(errands());
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
          chosen = picked2 ? startBrain(backend, cfg, terrain) ?? errands() : errands();
        }
        lastTurn = view.turn();
        lastView = view;
        journal.observe(view);
        if (brain !== null) {
          strategy.observe(view);
          orders.observe(view);
        }
        const command = chosen(view, act);
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
      self.saveCharacter({ ...character, kills });
      journal.kill(race, unique, view);
    },
    observe(view) {
      lastView = view;
      journal.observe(view);
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
      const born = heirFrom(config.lineages[heir.lineage], heir.parent, normalize(activePersona(config) ?? defaultPersona()), Math.random);
      self.saveConfig({ ...config, pendingHeir: null, ...born === null ? {} : { lineages: { ...config.lineages, [heir.lineage]: born.lineage } } });
      if (born !== null) {
        self.saveCharacter({ ...character, persona: born.persona, lineage: heir.lineage });
        orders.adopt(born.lineage.creeds ?? [], lastTurn);
        strategy.inherit(born.lineage.aims ?? []);
        host.log(`Squire's new character carries on the ${heir.lineage.trim() || "Squire"} line`);
        return born.persona;
      }
    }
    const chosen = activePersona(config);
    if (chosen === null) return null;
    const adopted = normalize(chosen);
    self.saveCharacter({ ...character, persona: adopted });
    return adopted;
  }
  function startBrain(backend, cfg, terrain) {
    const mark = host.controller?.markNondeterministic;
    if (mark === void 0) {
      host.log("This version of the game cannot mark the save for a model, so Squire runs its errands");
      return null;
    }
    mark.call(host.controller);
    const persona = personaFor();
    brain = createBrain({
      backend,
      planner: createGoalPlanner({
        cfg,
        terrain,
        log: host.log,
        persona: () => persona === null ? null : character.persona,
        backstoryTokens: backstoryBudget(config),
        lessons: (view) => journal.lessonLines(view),
        dreaded: () => dreadedRaces([...journal.lessons(), ...config.lineages[character.lineage?.trim() || "Squire"]?.lore ?? []]),
        calibrate: (probs) => journal.calibrate(probs),
        strategy: () => ({ aims: orders.promote(strategy.ranked()), tripAllowed: (gold) => strategy.tripAllowed(gold) }),
        orders
      }),
      tally,
      send: (request2) => self.send(request2),
      token: () => host.snapshot?.()?.token ?? null,
      now,
      log: host.log,
      status: (label, reason) => host.controller?.setStatus(reason === void 0 ? { label } : { label, reason }),
      onDecision: (record2) => {
        void logLoaded.then(() => logDecision(record2));
        for (const listener of listeners) listener(record2, lastTurn);
      },
      onPlanEnd: (end) => {
        void logLoaded.then(() => endDecision(end));
      },
      gauge: (view) => ({ turn: view.turn(), hp: view.player().hp })
    });
    host.log(`Squire has the keyboard and asks ${backend.label} what to do${persona === null ? "" : `, playing as ${persona.name}`}`);
    return brain.controller;
  }
  let openDecision = null;
  function endDecision(end) {
    if (openDecision === null) return;
    log.attachOutcome(openDecision, outcomeLine(end), end);
    openDecision = null;
    void log.flush();
  }
  function logDecision(record2) {
    const goal = record2.answers["goal"];
    const trace = record2.context.trace;
    const id = log.append({
      at: now(),
      turn: lastTurn,
      trigger: record2.reflex === void 0 ? "decision" : "reflex",
      backend: record2.backend,
      question: "goal",
      choice: trace?.pick ?? (goal?.type === "choice" ? goal.choice : ""),
      /* No model answered a reflex, so there is no confidence to log or calibrate. */
      confidence: goal?.type === "choice" && record2.reflex === void 0 ? goal.confidence : null,
      probs: goal?.type === "choice" && record2.reflex === void 0 ? goal.probabilities : null,
      ...record2.reflex === void 0 ? {} : { reflex: record2.reflex },
      state: record2.request.state,
      options: record2.context.offers.map((o) => o.goal),
      plan: record2.outcome,
      latencyMs: record2.latencyMs,
      ...record2.server === void 0 ? {} : { server: record2.server },
      inputTokens: record2.usage.inputTokens,
      outputTokens: record2.usage.outputTokens,
      estimatedTokens: record2.usage.estimated,
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
    if (record2.reflex === void 0) void shadow.record(record2, Number(id.slice(id.lastIndexOf("/") + 1)), config.backend === "jev" && config.layaShadow.enabled, config.layaShadow.url, config.layaShadow.fallbacks);
    const logged = log.records().find((r) => r.id === id);
    if (logged !== void 0 && lastView !== null) journal.decided(logged, lastView);
    if (record2.reflex === void 0) unsavedSpend += 1;
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
      const next = { ...withAncestor(lineage, report.name, report.race, report.cls, died, journal.lessons()), creeds, ...passable.length > 0 ? { aims: passable } : {} };
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
  const shops = /* @__PURE__ */ new Set();
  const shopNames = /* @__PURE__ */ new Map();
  const harmful = /* @__PURE__ */ new Set();
  const diggable = /* @__PURE__ */ new Set();
  for (const feature of features) {
    const has = (flag) => flag > 0 && feature.flags.has(flag);
    if (has(tf.DOWNSTAIR)) down.add(feature.fidx);
    if (has(tf.UPSTAIR)) up.add(feature.fidx);
    if (has(tf.DOOR_CLOSED)) closed.add(feature.fidx);
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
  const active = h("input", { type: "checkbox" });
  active.addEventListener("change", () => {
    config = { ...config, activePersona: active.checked ? index : -1 };
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
    active.checked = config.activePersona === index;
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
    h("label", {}, active, " New characters play as this persona"),
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
    const share2 = a.total === 0 ? 0 : Math.round(a.agreed / a.total * 100);
    fill(
      head,
      h("p", {}, h("span", { class: "stat" }, "Rank ", h("b", {}, rankOf(a))), h("span", { class: "stat" }, "Agreement ", h("b", {}, `${String(share2)}%`)), h("span", { class: "stat" }, "Lessons ", h("b", {}, String(a.total))))
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
  const offDecision = rt.onDecision((record2, turn) => {
    const goal = record2.answers["goal"];
    const trace = record2.context.trace;
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
  body2.append(h("h3", {}, "Now"), stats, h("h3", {}, AIMS_HEADING), aimsBox, h("h3", {}, "Depth"), chart, h("h3", {}, "Recent decisions"), recent, h("h3", {}, "Chronicle"), chronicle);
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
    const text = `${hl.name}, a level ${String(hl.level)} ${hl.race} ${hl.class}, reached ${String(hl.deepestFeet)} ft in Neo Angband with Squire. ${hl.outcome === "death" ? `Killed by ${hl.cause}.` : hl.outcome === "victory" ? "Won the game." : "Retired."}`;
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
      h("p", {}, `${hl.outcome === "death" ? `Killed by ${hl.cause}` : hl.outcome === "victory" ? "Won the game" : "Retired"} at ${String(hl.deepestFeet)} ft after ${hl.turns.toLocaleString()} turns.`),
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
  const off = rt.onDecision((record2) => {
    if (record2.reflex !== void 0) return;
    if (state === null) {
      if (!armed) return;
      armed = false;
      state = { decisions: 0, scored: 0, matched: 0 };
      onStart();
    }
    const view = rt.decisionView();
    const expected = view === null ? null : styleGoal(entries(), signatureForView(view));
    const answer = record2.context.trace?.pick ?? (record2.answers["goal"]?.type === "choice" ? record2.answers["goal"].choice : null);
    const pick2 = record2.context.offers.find((offer) => offer.goal === answer)?.goal ?? null;
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
    const inventory = snap?.core?.inventory ?? [];
    const equipment = snap?.core?.equipment ?? [];
    return { ...base, inventory: () => inventory, equipment: () => equipment };
  }
  ctx.events?.on("combat-outcome", (_name, payload) => {
    const p = payload;
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
  const planner = createGoalPlanner({ cfg: cfgFromFlags(ctx.flags), terrain, log: () => {
  } });
  function record2(squire, knight, view, dangerousNear, serial, confidence) {
    const p = view.player();
    const share2 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const demonstration = demonstrations > 0;
    if (demonstration) demonstrations -= 1;
    save(
      note(apprentice, {
        turn: view.turn(),
        squire,
        knight,
        agreed: squire === knight,
        line: noteLine(squire, knight, share2),
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
    rt.observe(view);
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
      if (goal !== void 0) record2(goal, knight, view, dangerousNear, serial);
      return;
    }
    const question = asked;
    const p = view.player();
    const share2 = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const offline = proceduralPick(question.context.offers, share2);
    const backend = rt.backend();
    if (backend === null || asking) {
      if (offline !== null) record2(offline, knight, view, dangerousNear, serial);
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
        if (squire !== null && squire !== void 0) record2(
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
        record2(offline, knight, view, dangerousNear, serial);
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
      minWidth: 260,
      minHeight: 200,
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
  },
  /* Roll-on: accepts the one creation Squire asked for after a death, and
   * declines every other, so the game shows its own birth screens. */
  birth(ctx) {
    return rollOnPresenter(ctx);
  },
  controller(ctx) {
    if (!characterAlreadyAutoplayed(ctx) && !takeRollOn(sessionMarks(), Date.now(), HEIR_KEY)) return void 0;
    const cfg = cfgFromFlags(ctx.flags);
    const terrain = terrainFrom(ctx);
    ctx.log(
      terrain.size > 0 ? `Squire is reading ${String(terrain.size)} terrain features` : "Squire has no terrain registry: it will not take stairs or open doors"
    );
    const changed = changedFrom(cfg);
    ctx.log(
      changed.length === 0 ? "Squire is on its stock settings" : `Squire's settings differ from stock: ${changed.join(", ")}`
    );
    const errands = () => createSquire({ cfg, terrain, log: ctx.log }).controller;
    if (ctx.net === void 0) return errands();
    return { controller: runtime(ctx).controllerFor(cfg, terrain, errands), onDeath: "end" };
  }
};
export {
  plugin_default as default
};
