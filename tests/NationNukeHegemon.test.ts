import { AttackExecution } from "../src/core/execution/AttackExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { NationExecution } from "../src/core/execution/NationExecution";
import { NationNukeBehavior } from "../src/core/execution/nation/NationNukeBehavior";
import {
  Cell,
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// A warhead on the Dark Star does nothing (H8), so the AI never aims one at
// the Hegemon — whatever the rule that would have picked it.
let game: Game;
let hegemon: Player;
let nation: Player;
let rival: Player;

function nukeBehavior(exec: NationExecution): NationNukeBehavior {
  return (exec as unknown as { nukeBehavior: NationNukeBehavior }).nukeBehavior;
}

async function start(difficulty: Difficulty, withRival: boolean) {
  game = await setup("big_plains", {
    hegemon: { enabled: true },
    difficulty,
  });
  hegemon = game.hegemon()!;
  game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  nation = game.player("nation_id");
  for (let x = 10; x < 40; x++) {
    for (let y = 10; y < 40; y++) {
      const tile = game.ref(x, y);
      if (game.map().isLand(tile) && !game.isInDarkStar(tile)) {
        nation.conquer(tile);
      }
    }
  }
  nation.addTroops(100_000);
  if (withRival) {
    game.addPlayer(new PlayerInfo("rival", PlayerType.Human, null, "rival_id"));
    rival = game.player("rival_id");
    for (let x = 160; x < 190; x++) {
      for (let y = 160; y < 190; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile) && !game.isInDarkStar(tile)) {
          rival.conquer(tile);
        }
      }
    }
    rival.addTroops(100_000);
  }
  game.addExecution(new HegemonExecution());
  executeTicks(game, 2);
  const exec = new NationExecution(
    "nuke-hegemon",
    new Nation(new Cell(25, 25), nation.info()),
  );
  exec.init(game);
  exec.tick(0);
  return nukeBehavior(exec);
}

describe("Nations never nuke the Dark Star", () => {
  test("not as the only other player on Impossible", async () => {
    const behavior = await start(Difficulty.Impossible, false);
    expect(game.players()).toHaveLength(2);
    expect(behavior.findBestNukeTarget()).not.toBe(hegemon);
  });

  test("not in retaliation for a Hegemon attack, nor as the most hated", async () => {
    const behavior = await start(Difficulty.Hard, true);
    game.addExecution(new AttackExecution(50_000, hegemon, nation.id()));
    nation.updateRelation(hegemon, -100);
    nation.updateRelation(rival, -100);
    executeTicks(game, 2);
    const target = behavior.findBestNukeTarget();
    expect(target).not.toBe(hegemon);
    // The search goes on past the throne: the hostile rival is still found.
    expect(target).toBe(rival);
  });
});
