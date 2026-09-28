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
      const choice = raw["choice"];
      const probs = raw["probabilities"];
      if (typeof choice !== "string" || !(choice in question.criteria)) {
        return `the answer to "${name}" picked an option that was not offered`;
      }
      if (!isRecord(probs)) return `the answer to "${name}" had no probabilities`;
      const probabilities = {};
      for (const option of Object.keys(question.criteria)) {
        probabilities[option] = num(probs[option]) ?? 0;
      }
      return { type: "choice", choice, confidence: num(raw["confidence"]) ?? 0, probabilities };
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
function parseReply(request, requestBody, replyBody) {
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
  for (const [name, question] of Object.entries(request.questions)) {
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
async function ask(net, backend, request, now) {
  const started = now();
  const body = JSON.stringify(backend.model === void 0 ? request : { model: backend.model, ...request });
  const headers = { "Content-Type": "application/json" };
  if (backend.secret !== void 0) headers["Authorization"] = `Bearer {secret:${backend.secret}}`;
  const reply = await net.request({ url: backend.url, method: "POST", headers, body, timeoutMs: backend.timeoutMs });
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
  const parsed = parseReply(request, body, reply.body);
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
  return { ok: true, answers: parsed.answers, usage: parsed.usage, model: parsed.model, latencyMs };
}

// src/brain/boot.ts
async function keyReady(secrets, backend, canReadEnv, log) {
  if (backend.secret === void 0) return true;
  const held = await secrets.has(backend.secret);
  if (held.present) return true;
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
function bootController(ready, withModel, withoutModel) {
  let chosen = null;
  let picked = null;
  ready.then(
    (ok) => {
      picked = ok;
    },
    () => {
      picked = false;
    }
  );
  return (view, act) => {
    if (chosen === null) {
      if (picked === null) return null;
      chosen = picked ? withModel() : withoutModel();
    }
    return chosen(view, act);
  };
}

// src/brain/brain.ts
function sameToken(a, b) {
  return a !== null && b !== null && a.epoch === b.epoch && a.revision === b.revision;
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
    const wait = failure.retryAfterMs ?? BACKOFF_MS[attempt];
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
    const choice = planner.choose(result.answers, question.context, view);
    const outcome = "plan" in choice ? choice.plan.label : `hand back: ${choice.handBack}`;
    deps.onDecision?.({
      token,
      backend: backend.label,
      request: question.request,
      context: question.context,
      answers: result.answers,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
      outcome
    });
    if ("handBack" in choice) {
      stopWith(choice.handBack);
      return null;
    }
    state = { kind: "running", plan: choice.plan };
    deps.status(choice.plan.label);
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
      const plan = state.plan;
      const reason = planner.trigger(view, plan);
      if (reason === null) {
        const command = plan.step(view, act);
        if (command !== null) {
          emptyDecisions = 0;
          return command;
        }
        deps.log(`finished: ${plan.label}`);
      } else {
        deps.log(`${plan.label}: ${reason}`);
      }
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
function readPack(view) {
  const heal = [];
  const phase = [];
  const teleport = [];
  const oil = [];
  const attackWand = [];
  const ammo = [];
  const food = [];
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null) continue;
    const entry = (power) => ({ handle: item.handle, name, power });
    const h = rank(name, HEAL_POTIONS);
    if (h !== null) heal.push(entry(h));
    else if (/\bScrolls? of Phase Door\b/i.test(name)) phase.push(entry(1));
    else if (/\bScrolls? of (Teleportation|Teleport Level)\b|\bStaffs? of Teleportation\b/i.test(name) && !empty(name)) {
      teleport.push(entry(/Level/i.test(name) ? 1 : 2));
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
  const launcher = view.equipment().some((item) => {
    if (item === null) return false;
    const name = shownName(item);
    return name !== null && /\b(Sling|Short Bow|Long Bow|Light Crossbow|Heavy Crossbow|Bow)\b/i.test(name);
  });
  const attackSpell = [];
  const healSpell = [];
  const escapeSpell = [];
  for (const spell of castable(view)) {
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
    ammo,
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
  const unit = Number.isFinite(draw) ? Math.max(0, Math.min(1, draw)) : 0.5;
  return Math.max(0, Math.min(1, persona.sliders.strength / 100 + (unit * 2 - 1) * persona.sliders.volatility / 400));
}
function riskCeiling(persona) {
  return 0.6 - persona.sliders.selfpreservation * 5e-3;
}
function applySafetyFloor(dist, risk, ceiling, deathWish) {
  const keys = Object.keys(dist);
  const removed = deathWish ? [] : keys.filter((key2) => (risk[key2] ?? 0) > ceiling);
  if (removed.length === keys.length && keys.length > 0) {
    let safest = keys[0];
    for (const key2 of keys.slice(1)) if ((risk[key2] ?? 0) < (risk[safest] ?? 0)) safest = key2;
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
  let choice;
  let highest = -Infinity;
  for (const [key2, probability] of Object.entries(dist)) {
    if (probability > highest) {
      choice = key2;
      highest = probability;
    }
  }
  return choice;
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
function mustPickUp(persona) {
  return persona.quirks.compulsive.on;
}
function fleesFromNew(persona) {
  return persona.quirks.cowardice.on;
}

// src/persona/catalog.ts
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
function traitWord(id, scale, value) {
  const [low, high] = scale.split(" to ");
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

// src/brain/goals.ts
var NONE_OF_THESE = "No offered option fits. Squire falls back to its fixed errand order for a few steps.";
var FALLBACK_STEPS = 8;
var RETREAT_STEPS = 4;
var MISSILE_RANGE = 10;
function healthBand(hp, maxHp) {
  if (maxHp <= 0) return "unknown";
  const share = hp / maxHp;
  if (share >= 0.9) return "full";
  if (share >= 0.6) return "lightly hurt";
  if (share >= 0.35) return "badly hurt";
  return "near death";
}
var THREAT_BANDS = ["an easy kill", "a fair fight", "dangerous", "deadly"];
function threatIndex(monster, characterLevel) {
  let band;
  if (monster.level * 2 <= characterLevel) band = 0;
  else if (monster.level <= characterLevel) band = 1;
  else if (monster.level <= characterLevel + 5) band = 2;
  else band = 3;
  if (monster.raceFlags.includes("UNIQUE")) band = Math.min(3, band + 1);
  return band;
}
var BAND_RISK = [0.03, 0.15, 0.4, 0.75];
var HANDBOOK = Object.freeze([
  "Killing creatures earns experience, and experience makes the character stronger.",
  "Going deeper before the character is strong enough is a common way to die; a character should usually clear easy creatures before descending.",
  "Resting with an awake creature in sight gets interrupted, and a creature that is deadly should be escaped rather than fought.",
  "Healing potions are worth drinking before hit points get too low to survive one more round, and Phase Door breaks contact for a moment while Teleportation leaves the fight entirely.",
  "Missiles, thrown oil, wands and attack spells hurt a creature before it can reach the character."
]);
function situationOf(view) {
  const player = view.player();
  const monsters = view.monsters();
  const awake = awakeInSight(monsters);
  const target = pickTarget(monsters, player.grid, { wakeSleepers: true, reach: AUTOFIGHT_REACH });
  const worst = awake.reduce((max, m) => Math.max(max, threatIndex(m, player.level)), -1);
  return {
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
function fightRisk(s) {
  const band = s.target === null ? 0 : threatIndex(s.target, s.view.player().level);
  return clamp01((BAND_RISK[band] ?? 0.75) * (0.6 + (1 - s.hpShare) * 1.4));
}
function exposure(s) {
  if (s.worst < 0) return 0.01;
  return clamp01((BAND_RISK[s.worst] ?? 0.75) * (1 - s.hpShare) * 1.2);
}
function within(s, range) {
  return s.target !== null && steps(s.view.player().grid, s.target.grid) <= range;
}
function offersFor(s, cfg, terrain) {
  const view = s.view;
  const player = view.player();
  const at = player.grid;
  const hurt = player.hp < player.maxHp;
  const out = [];
  const add2 = (goal, criteria, risk) => out.push({ goal, criteria, risk: clamp01(risk) });
  if (s.target !== null) {
    add2("fight", `Close with the ${s.target.race} and fight it in melee until it dies or something changes.`, fightRisk(s));
    const ranged = within(s, MISSILE_RANGE);
    if (ranged && s.pack.launcher && s.pack.ammo[0] !== void 0) {
      add2("shoot", `Fire ${s.pack.ammo[0].name} at the ${s.target.race} with the equipped launcher.`, fightRisk(s) * 0.7);
    }
    if (ranged && s.pack.oil[0] !== void 0) {
      add2("throw_oil", `Throw a flask of oil at the ${s.target.race}; it burns for good damage early in the game.`, fightRisk(s) * 0.7);
    }
    if (ranged && s.pack.attackWand[0] !== void 0) {
      add2("aim_wand", `Aim ${s.pack.attackWand[0].name} at the ${s.target.race}.`, fightRisk(s) * 0.65);
    }
    const spell = s.pack.attackSpell[0];
    if (ranged && spell !== void 0) {
      add2("cast_attack", `Cast ${spell.name} at the ${s.target.race} (${String(spell.fail)}% chance to fail).`, fightRisk(s) * 0.65);
    }
  }
  if (hurt && s.pack.heal[0] !== void 0) {
    add2("heal", `Drink ${s.pack.heal[0].name} to restore hit points.`, exposure(s) * 0.5);
  }
  const healSpell = s.pack.healSpell[0];
  if (hurt && healSpell !== void 0) {
    add2("cast_heal", `Cast ${healSpell.name} to restore hit points (${String(healSpell.fail)}% chance to fail).`, exposure(s) * 0.6);
  }
  if (s.awake.length > 0) {
    if (s.pack.phase[0] !== void 0 || s.pack.escapeSpell[0] !== void 0) {
      const how = s.pack.phase[0]?.name ?? s.pack.escapeSpell[0]?.name ?? "";
      add2("phase", `Use ${how}: a short random teleport that breaks contact for a moment.`, exposure(s) * 0.4);
    }
    if (s.pack.teleport[0] !== void 0) {
      add2("teleport", `Use ${s.pack.teleport[0].name} to escape far from every creature in sight.`, exposure(s) * 0.2);
    }
    add2("retreat", "Step away from the awake creatures in sight, to gain distance before they can attack.", exposure(s) * 0.8);
  }
  if (s.awake.length === 0 && (hurt || player.sp < player.maxSp)) {
    add2("rest", "Rest until hit points and mana recover.", 0.01);
  }
  if (hungry(view) && s.pack.food[0] !== void 0) {
    add2("eat", `Eat ${s.pack.food[0].name}; the character is hungry.`, exposure(s));
  }
  if (hasFloorObject(view, at)) add2("pick_up", "Pick up the object on the floor under the character.", exposure(s));
  if (frontiers(view, terrain).length > 0) {
    add2("explore", "Walk toward the nearest unexplored ground on this level.", exposure(s) + 0.02);
  }
  if (knownDownStairs(view, terrain).length > 0 && cfg.descend) {
    add2("descend", "Walk to a known down staircase and take it to the next, more dangerous level.", exposure(s) + (1 - s.hpShare) * 0.3);
  }
  return out;
}
function createGoalPlanner(options) {
  const { cfg, terrain, log } = options;
  const persona = options.persona ?? null;
  const rng = options.rng ?? Math.random;
  const backstoryTokens = options.backstoryTokens ?? 600;
  let lastAwake = /* @__PURE__ */ new Set();
  const fightCfg = { ...cfg, wakeSleepers: true };
  function context(view, act, progress, with_ = cfg) {
    return { view, act, terrain, cfg: with_, progress, log };
  }
  function watch(view) {
    const player = view.player();
    const hurt = player.maxHp > 0 && player.hp <= player.maxHp * cfg.retreatFraction;
    return createWatcher(view, {
      stopOnAnyDamage: false,
      stopOnNewCreature: true,
      /* Already under the line: crossing it again is not news. */
      stopOnLowHealth: !hurt,
      retreatFraction: cfg.retreatFraction
    });
  }
  function missionPlan(label, mission, view, with_ = cfg, limit = Infinity) {
    const progress = newProgress(view.player().depth);
    let begun = false;
    let done = false;
    return {
      label,
      watcher: watch(view),
      step(v, act) {
        if (done || progress.steps >= limit) return null;
        const ctx = context(v, act, progress, with_);
        if (!begun) {
          begun = true;
          const declined = mission.begin(ctx);
          if (declined !== null) {
            done = true;
            log(`${label}: ${declined.detail}`);
            return null;
          }
        }
        const decision = mission.step(ctx);
        if (isStop(decision)) {
          done = true;
          log(`${label}: ${decision.stop.detail}`);
          return null;
        }
        return decision.command;
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
  function atTarget(label, view, command) {
    return once(label, view, (ctx) => {
      const s = situationOf(ctx.view);
      if (s.target === null) return null;
      if (!ctx.act.setTargetMonster(s.target.id)) return null;
      return command(ctx);
    });
  }
  function build(goal, view) {
    const pack = readPack(view);
    switch (goal) {
      case "fight":
        return missionPlan("fight", autofight(), view, fightCfg);
      case "shoot": {
        const ammo = pack.ammo[0];
        return atTarget("shoot", view, (ctx) => ctx.act.fire(ammo?.handle ?? 0));
      }
      case "throw_oil": {
        const oil = pack.oil[0];
        return atTarget("throw oil", view, (ctx) => ctx.act.throw(oil?.handle ?? 0));
      }
      case "aim_wand": {
        const wand = pack.attackWand[0];
        return atTarget(`aim ${wand?.name ?? "a wand"}`, view, (ctx) => ctx.act.aimWand(wand?.handle ?? 0));
      }
      case "cast_attack": {
        const spell = pack.attackSpell[0];
        return atTarget(`cast ${spell?.name ?? "a spell"}`, view, (ctx) => ctx.act.cast(spell?.sidx ?? 0));
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
          if (i >= RETREAT_STEPS) return null;
          const away = retreatFrom(ctx, awakeInSight(ctx.view.monsters()).map((m) => m.grid));
          return away.kind === "step" ? away.command : null;
        });
      case "rest":
        return once("rest", view, (ctx) => ctx.act.rest());
      case "eat": {
        const food = pack.food[0];
        return once("eat", view, (ctx) => food === void 0 ? null : ctx.act.eat(food.handle));
      }
      case "pick_up":
        return once("pick up", view, (ctx) => ctx.act.pickup());
      case "explore":
        return missionPlan("explore", autoexplore(), view);
      case "descend":
        return stepsPlan("take the stairs down", view, (ctx) => {
          const at = ctx.view.player().grid;
          const stairs = knownDownStairs(ctx.view, terrain);
          if (stairs.some((s) => s.x === at.x && s.y === at.y)) {
            return ctx.view.player().depth === view.player().depth ? ctx.act.descend() : null;
          }
          const travel = travelTo(ctx, stairs);
          return travel.kind === "step" ? travel.command : null;
        });
    }
  }
  function decide(best, inCharacter, digest) {
    if (persona === null) return best.choice;
    const offered = new Set(digest.offers.map((o) => o.goal));
    const advice = best.choice;
    const record = (pick3, extra) => {
      digest.trace = { advice, pick: pick3, ...extra };
      return pick3;
    };
    const blank = { best: best.probabilities, inCharacter: null, blended: best.probabilities, strength: 0, removed: [] };
    if (mustPickUp(persona) && offered.has("pick_up")) return record("pick_up", { ...blank, quirk: "compulsive collector" });
    if (fleesFromNew(persona) && digest.newCreatures > 0) {
      const away = ["teleport", "phase", "retreat"].find((g) => offered.has(g));
      if (away !== void 0) return record(away, { ...blank, quirk: "craven" });
    }
    const inChar = inCharacter?.type === "choice" ? inCharacter.probabilities : null;
    const strength = jitteredStrength(persona, rng);
    const blended = inChar === null ? { ...best.probabilities } : blend(best.probabilities, inChar, strength);
    const risk = { none_of_these: 0 };
    for (const offer of digest.offers) risk[offer.goal] = offer.risk;
    const floor = applySafetyFloor(blended, risk, riskCeiling(persona), persona.quirks.deathwish.on);
    const pick2 = pick(floor.dist) ?? advice;
    return record(pick2, { best: best.probabilities, inCharacter: inChar, blended: floor.dist, strength, removed: floor.removed });
  }
  return {
    ask(view) {
      const player = view.player();
      if (player.dead) return { handBack: "The character has died." };
      const s = situationOf(view);
      const offers = offersFor(s, cfg, terrain);
      if (offers.length === 0) {
        return { handBack: "Squire can see nothing to do here: no creature to fight, nothing unexplored, and no known way down." };
      }
      const criteria = {};
      for (const offer of offers) criteria[offer.goal] = offer.criteria;
      criteria["none_of_these"] = NONE_OF_THESE;
      const goal = {
        type: "choice",
        instructions: "You are playing Angband, a dungeon game where death is permanent. Which option gives this character the best chance to survive and keep making progress?",
        criteria
      };
      const seen = inSight(view.monsters());
      const awakeNow = new Set(s.awake.map((m) => m.id));
      const newCreatures = [...awakeNow].filter((id) => !lastAwake.has(id)).length;
      lastAwake = awakeNow;
      const unexplored = frontiers(view, terrain).length > 0;
      const stairs = knownDownStairs(view, terrain).length > 0;
      const question = {
        request: {
          state: {
            rules: HANDBOOK.join(" "),
            character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}).`,
            health: `${healthBand(player.hp, player.maxHp)}: ${String(player.hp)} of ${String(player.maxHp)} hit points`,
            ...player.maxSp > 0 ? { mana: `${String(player.sp)} of ${String(player.maxSp)}` } : {},
            creatures: seen.length === 0 ? "No creatures in sight." : seen.map((m) => {
              const real = threatIndex(m, player.level);
              const seenAs = persona === null ? real : shiftThreat(real, THREAT_BANDS.length, persona, rng);
              const band = THREAT_BANDS[seenAs] ?? "deadly";
              const tags = [m.asleep ? "asleep" : "", m.afraid ? "afraid" : "", m.raceFlags.includes("UNIQUE") ? "unique" : ""].filter((t) => t !== "").join(", ");
              const away = steps(player.grid, m.grid);
              return `${m.race}: ${band}, ${String(away)} steps away${tags === "" ? "" : `, ${tags}`}`;
            }).join("; "),
            ground: standingOnHarm(view, terrain, player.grid) ? "The ground here is hurting the character." : "Safe ground.",
            level: `${unexplored ? "Unexplored ground remains." : "The level is explored."} ${stairs ? "A down staircase is known." : "No down staircase is known."}`,
            ...hungry(view) ? { hunger: "The character is hungry." } : {},
            ...persona === null ? {} : { persona: { name: persona.name, ...personaState(persona, backstoryTokens) } }
          },
          questions: persona === null ? { goal } : { goal, in_character: { type: "choice", instructions: inCharacterInstructions(persona), criteria } }
        },
        context: { depth: player.depth, offers, newCreatures }
      };
      return question;
    },
    choose(answers, digest, view) {
      const answer = answers["goal"];
      if (answer?.type !== "choice") return { handBack: "The model gave no goal." };
      const pick2 = decide(answer, answers["in_character"], digest);
      if (pick2 === "none_of_these") {
        log("goal: none fit, following the fixed errand order");
        return { plan: missionPlan("follow the errand order", campaign(), view, cfg, FALLBACK_STEPS) };
      }
      const offer = digest.offers.find((o) => o.goal === pick2);
      if (offer === void 0) {
        return { handBack: "The model picked an option Squire did not offer, so the keyboard is yours." };
      }
      const trace = digest.trace;
      if (trace !== void 0 && trace.pick !== trace.advice) {
        log(`goal: ${pick2}, against advice (${trace.advice})${trace.quirk === void 0 ? "" : `: ${trace.quirk}`}`);
      } else {
        log(`goal: ${pick2} (${String(Math.round((answer.probabilities[pick2] ?? 0) * 100))}%)`);
      }
      return { plan: build(offer.goal, view) };
    },
    trigger(view, plan) {
      const watched = plan;
      const stopped = watched.watcher?.check(view) ?? null;
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
function errandController(ctx, cfg, terrain) {
  return createSquire({ cfg, terrain, log: ctx.log }).controller;
}
function modelController(ctx, net, cfg, terrain) {
  const now = () => Date.now();
  const brain = createBrain({
    backend: JEV,
    planner: createGoalPlanner({ cfg, terrain, log: ctx.log }),
    tally: createTally({ perSessionUsd: 0, perDayUsd: 0 }),
    send: (request) => ask(net, JEV, request, now),
    token: () => ctx.snapshot?.()?.token ?? null,
    now,
    log: ctx.log,
    status: (label, reason) => ctx.controller?.setStatus(reason === void 0 ? { label } : { label, reason })
  });
  ctx.log(`Squire has the keyboard and asks ${JEV.label} what to do`);
  return brain.controller;
}
function pickController(ctx, net, cfg, terrain) {
  const mark = ctx.controller?.markNondeterministic;
  if (mark === void 0) {
    ctx.log("This version of the game cannot mark the save for a model, so Squire runs its errands without one");
    return errandController(ctx, cfg, terrain);
  }
  mark.call(ctx.controller);
  return modelController(ctx, net, cfg, terrain);
}
var plugin_default = {
  api: 1,
  controller(ctx) {
    if (!characterAlreadyAutoplayed(ctx)) return void 0;
    const cfg = cfgFromFlags(ctx.flags);
    const terrain = terrainFrom(ctx);
    ctx.log(
      terrain.size > 0 ? `Squire is reading ${String(terrain.size)} terrain features` : "Squire has no terrain registry: it will not take stairs or open doors"
    );
    const changed = changedFrom(cfg);
    ctx.log(
      changed.length === 0 ? "Squire is on its stock settings" : `Squire's settings differ from stock: ${changed.join(", ")}`
    );
    const net = ctx.net;
    if (!cfg.useModel || net === void 0) {
      if (cfg.useModel) ctx.log("This version of the game cannot send Squire's requests, so Squire runs its errands without a model");
      return errandController(ctx, cfg, terrain);
    }
    const ready = keyReady(net.secrets, JEV, net.transport === "relay", ctx.log);
    return {
      controller: bootController(
        ready,
        () => pickController(ctx, net, cfg, terrain),
        () => errandController(ctx, cfg, terrain)
      ),
      onDeath: "end"
    };
  }
};
export {
  plugin_default as default
};
