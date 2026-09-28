import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { PlayerCommand } from "../knight.js";
import type { Goal } from "../brain/goals.js";
import type { PlayerCommand as CommandEvidence } from "../learning/ranks.js";
import { signatureOf, type SituationSignature } from "../learning/signature.js";
import { steps } from "../grid.js";

/** Keep evidence tied to the view before the command changes the world. */
export function commandEvidence(command: PlayerCommand, goal: Goal | null, view: AgentView): CommandEvidence | null {
  const p = view.player();
  const near = view.monsters().some((monster) => monster.visible && !monster.asleep
    && steps(p.grid, monster.grid) <= 3 && monster.level >= p.level);
  let kind: CommandEvidence["kind"];
  switch (goal) {
    case "fight": kind = command.code === "walk" ? "melee" : "fight"; break;
    case "retreat": case "phase": case "teleport": kind = "retreat"; break;
    case "rest": kind = "rest"; break;
    case "heal": case "cast_heal": kind = "heal"; break;
    case "descend": kind = "descend"; break;
    case "shoot": case "throw_oil": case "aim_wand": case "cast_attack": kind = "ranged"; break;
    case "explore": kind = "move"; break;
    default:
      if (["eat", "quaff", "read", "use-staff", "throw"].includes(command.code)) kind = "consumable";
      else return null;
  }
  let exploredShare: number | undefined;
  if (kind === "descend") {
    const bounds = view.mapBounds();
    let known = 0;
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) if (view.cell(x, y)?.known) known += 1;
    }
    exploredShare = bounds.width * bounds.height > 0 ? known / (bounds.width * bounds.height) : 0;
  }
  return {
    kind, turn: view.turn(), dangerousNear: near, hpShare: p.maxHp > 0 ? p.hp / p.maxHp : 1,
    ...(exploredShare === undefined ? {} : { exploredShare }),
  };
}

/** Use the same compact encounter facts for notebook retrieval and exams. */
export function signatureForView(view: AgentView): SituationSignature {
  const p = view.player();
  return signatureOf({ depth: p.depth, classId: p.cls, level: p.level,
    races: view.monsters().filter((monster) => monster.visible).map((monster) => monster.race),
    hp: p.hp, maxHp: p.maxHp,
    resources: view.inventory().map((item) => item.label.toLowerCase()).filter((name) => /heal|teleport|phase|oil|wand/.test(name)).slice(0, 10),
  });
}
