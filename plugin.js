// squire - generated from plugin.ts by neo-angband-mod-build
// (@rpgm-tools/neo-angband-mod-sdk). Edit the TypeScript source, not this file.

// src/mission.ts
function isStop(decision) {
  return "stop" in decision;
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
  return { steps: 0, idle: 0, at: null, depth, collected: /* @__PURE__ */ new Set() };
}
function advance(progress, at) {
  progress.steps += 1;
  if (progress.at !== null && key(progress.at) === key(at)) progress.idle += 1;
  else progress.idle = 0;
  progress.at = at;
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
          detail: `The floor changed from ${String(startingDepth)} to ${String(p.depth)}.`
        };
      }
      const current = afflictionsOf(p.status);
      const landed = current.filter((name) => !afflictions.has(name));
      afflictions = new Set(current);
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
  const cell = cellAt(view, at);
  if (cell === null) return false;
  if (!cell.known || !cell.passable) return false;
  return !terrain.isHarmful(cell.feat);
}
function isClosedDoor(view, terrain, at) {
  const cell = cellAt(view, at);
  if (cell === null || !cell.known) return false;
  return terrain.isClosedDoor(cell.feat);
}
function isRoutable(view, terrain, at) {
  return isKnownGround(view, terrain, at) || isClosedDoor(view, terrain, at);
}
function isWalkable(view, terrain, at) {
  if (!isRoutable(view, terrain, at)) return false;
  const cell = cellAt(view, at);
  return cell !== null && cell.monster <= 0;
}
function standingOnHarm(view, terrain, at) {
  const cell = cellAt(view, at);
  return cell !== null && terrain.isHarmful(cell.feat);
}
function frontiers(view, terrain) {
  const bounds = view.mapBounds();
  const found = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const at = { x, y };
      if (!isKnownGround(view, terrain, at)) continue;
      for (const there of neighbours(at)) {
        const cell = cellAt(view, there);
        if (cell !== null && !cell.known) {
          found.push(at);
          break;
        }
      }
    }
  }
  return found;
}
function knownDownStairs(view, terrain) {
  const bounds = view.mapBounds();
  const found = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known) continue;
      if (terrain.isDownStair(cell.feat)) found.push({ x, y });
    }
  }
  return found;
}
function hasFloorObject(view, at) {
  const cell = cellAt(view, at);
  return cell !== null && cell.objectCount > 0;
}

// src/travel.ts
function enter(ctx, from, to) {
  const dir = directionToward(from, to);
  if (dir === null) return null;
  if (isClosedDoor(ctx.view, ctx.terrain, to)) return ctx.act.open(dir);
  return ctx.act.move(dir);
}
function travelTo(ctx, goals) {
  if (goals.length === 0) return { kind: "unreachable" };
  const at = ctx.view.player().grid;
  const here = key(at);
  if (goals.some((goal) => key(goal) === here)) return { kind: "arrived" };
  const field = flowFrom({
    goals,
    canEnter: (grid) => isRoutable(ctx.view, ctx.terrain, grid)
  });
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
    const cell = cellAt(ctx.view, there);
    if (cell === null || cell.known) continue;
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
      const named = ctx.view.target();
      if (named !== null && named.midx > 0) {
        const monster = liveTarget(ctx, named.midx);
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

// src/missions/autoexplore.ts
function autoexplore() {
  let watcher = null;
  return {
    id: "autoexplore",
    label: "explore this floor",
    begin(ctx) {
      const cfg = ctx.cfg;
      const awake = awakeInSight(ctx.view.monsters());
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
      if (watcher === null) return stop("nothing-to-do", "The errand never started.");
      if (ctx.progress.steps > ctx.cfg.errandSteps) {
        return stop("budget", "The walk ran longer than a short errand should.");
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
      const travel = travelTo(ctx, goals);
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
    const decision = mission.step(ctx);
    if (isStop(decision)) return finish(decision.stop);
    return decision.command;
  };
  return {
    controller,
    mission: () => mission?.id ?? null,
    outcome: () => finished
  };
}

// src/settings.ts
function defaultCfg() {
  return {
    errandAutofight: true,
    errandAutoexplore: true,
    errandCampaign: false,
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

// src/terrain.ts
function readTerrain(features, tf) {
  const down = /* @__PURE__ */ new Set();
  const up = /* @__PURE__ */ new Set();
  const closed = /* @__PURE__ */ new Set();
  const shops = /* @__PURE__ */ new Set();
  const harmful = /* @__PURE__ */ new Set();
  for (const feature of features) {
    const has = (flag) => flag > 0 && feature.flags.has(flag);
    if (has(tf.DOWNSTAIR)) down.add(feature.fidx);
    if (has(tf.UPSTAIR)) up.add(feature.fidx);
    if (has(tf.DOOR_CLOSED)) closed.add(feature.fidx);
    if (has(tf.SHOP)) shops.add(feature.fidx);
    if (has(tf.PASSABLE) && has(tf.FIERY)) harmful.add(feature.fidx);
  }
  return {
    isDownStair: (feat) => down.has(feat),
    isUpStair: (feat) => up.has(feat),
    isClosedDoor: (feat) => closed.has(feat),
    isShopEntrance: (feat) => shops.has(feat),
    isHarmful: (feat) => harmful.has(feat),
    size: features.length
  };
}
function noTerrain() {
  return {
    isDownStair: () => false,
    isUpStair: () => false,
    isClosedDoor: () => false,
    isShopEntrance: () => false,
    isHarmful: () => false,
    size: 0
  };
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
  controller(ctx) {
    if (!characterAlreadyAutoplayed(ctx)) return void 0;
    const cfg = cfgFromFlags(ctx.flags);
    const terrain = terrainFrom(ctx);
    const squire = createSquire({ cfg, terrain, log: ctx.log });
    ctx.log(
      terrain.size > 0 ? `Squire has the keyboard, reading ${String(terrain.size)} terrain features` : "Squire has the keyboard, but no terrain registry: it will not take stairs or open doors"
    );
    const changed = changedFrom(cfg);
    ctx.log(
      changed.length === 0 ? "Squire is on its stock settings" : `Squire's settings differ from stock: ${changed.join(", ")}`
    );
    return squire.controller;
  }
};
export {
  plugin_default as default
};
