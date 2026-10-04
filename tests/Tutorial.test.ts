import {
  STEP_DONE_LINGER_TICKS,
  TUTORIAL_STEPS,
  TutorialContext,
  TutorialProgress,
} from "../src/client/hud/Tutorial";

function ctx(overrides: Partial<TutorialContext> = {}): TutorialContext {
  return {
    hasSpawned: false,
    inSpawnPhase: false,
    attacking: false,
    attackRatioMoved: false,
    boatsDisabled: false,
    boatSent: false,
    botsExist: true,
    nationsExist: true,
    alliancesDisabled: false,
    allied: false,
    gold: 0n,
    cityCost: null,
    cityDisabled: false,
    cities: 0,
    portDisabled: false,
    ports: 0,
    defensePostDisabled: false,
    defensePosts: 0,
    factoryDisabled: false,
    factories: 0,
    warshipDisabled: false,
    warships: 0,
    stargateDisabled: false,
    stargates: 0,
    gateReady: false,
    gateShotFired: false,
    atomDisabled: false,
    shieldArrayDisabled: false,
    // Off by default so the flow tests read as plain OpenFront; the Dark
    // Star tests opt in with throne().
    hegemonExists: false,
    ...overrides,
  };
}

/** A context from a game with a Hegemon on the Dark Star. */
function throne(overrides: Partial<TutorialContext> = {}): TutorialContext {
  return ctx({ hegemonExists: true, ...overrides });
}

// Feed the same context until the completed step has lingered and advanced.
function settle(progress: TutorialProgress, c: TutorialContext) {
  for (let i = 0; i <= STEP_DONE_LINGER_TICKS; i++) progress.update(c);
}

describe("TutorialProgress", () => {
  it("walks the steps in order as the player acts", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(true);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");

    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("troops");

    p.acknowledge();
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("troop_rate");
    p.acknowledge();
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("attack_ratio");
    // Completed by moving the slider, which only shows up for a single tick.
    p.update(
      ctx({ hasSpawned: true, attacking: true, attackRatioMoved: true }),
    );
    expect(p.stepDone()).toBe(true);
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("capture_tribes");

    settle(
      p,
      ctx({
        hasSpawned: true,
        attacking: true,
        gold: 125_000n,
        cityCost: 125_000n,
      }),
    );
    expect(p.current()?.id).toBe("buy_city");
  });

  it("holds the spawn step until the multiplayer spawn timer ends", () => {
    const p = new TutorialProgress();
    // Spot picked, but the spawn phase is still running: stay put.
    for (let i = 0; i < 100; i++) {
      p.update(ctx({ hasSpawned: true, inSpawnPhase: true }));
    }
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("lingers on a completed step before advancing", () => {
    const p = new TutorialProgress();
    p.update(ctx({ hasSpawned: true }));
    for (let i = 1; i < STEP_DONE_LINGER_TICKS; i++) {
      p.update(ctx({ hasSpawned: true }));
      expect(p.current()?.id).toBe("spawn");
    }
    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("only advances informational steps on acknowledge", () => {
    const p = new TutorialProgress();
    const c = ctx({ hasSpawned: true, attacking: true });
    settle(p, c);
    settle(p, c);
    expect(p.current()?.id).toBe("troops");

    for (let i = 0; i < 100; i++) p.update(c);
    expect(p.current()?.id).toBe("troops");
    expect(p.stepDone()).toBe(false);

    p.acknowledge();
    expect(p.stepDone()).toBe(true);
    settle(p, c);
    expect(p.current()?.id).toBe("troop_rate");
  });

  it("ignores acknowledge on action steps", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    p.acknowledge();
    expect(p.stepDone()).toBe(false);
  });

  it("skips steps that don't apply to the game and counts only the rest", () => {
    const p = new TutorialProgress();
    const c = ctx({
      hasSpawned: true,
      attacking: true,
      boatsDisabled: true,
      botsExist: false,
      nationsExist: false,
      cityDisabled: true,
      portDisabled: true,
      defensePostDisabled: true,
      factoryDisabled: true,
      warshipDisabled: true,
      stargateDisabled: true,
      atomDisabled: true,
      shieldArrayDisabled: true,
    });
    // Everything but spawn, the spawn ring, troops, troop rate and the ratio.
    expect(p.total(c)).toBe(5);

    settle(p, c);
    settle(p, c);
    expect(p.current()?.id).toBe("troops");
    expect(p.position(c)).toBe(3);

    p.acknowledge();
    settle(p, c);
    expect(p.current()?.id).toBe("troop_rate");
    expect(p.position(c)).toBe(4);
    p.acknowledge();
    settle(p, c);
    expect(p.current()?.id).toBe("attack_ratio");
    p.update({ ...c, attackRatioMoved: true });
    settle(p, c);
    expect(p.finished()).toBe(true);
    expect(p.current()).toBeNull();
  });

  it("asks for an alliance after the city, then explains traitors", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "propose_alliance");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    p.update(ctx());
    expect(p.current()?.id).toBe("propose_alliance");
    expect(p.current()?.highlight).toBe("nation");

    settle(p, ctx({ allied: true }));
    expect(p.current()?.id).toBe("alliance_info");
    p.acknowledge();
    settle(p, ctx({ allied: true }));
    expect(p.current()?.id).toBe("buy_factory");

    // Without nations (or with alliances off) both steps are skipped.
    const q = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    q.update(ctx({ nationsExist: false }));
    expect(q.current()?.id).toBe("buy_factory");
  });

  it("gates the tribes step on affordable gold, then the city step on the city existing", () => {
    const p = new TutorialProgress([
      TUTORIAL_STEPS.find((s) => s.id === "capture_tribes")!,
      TUTORIAL_STEPS.find((s) => s.id === "buy_city")!,
    ]);
    p.update(ctx({ gold: 500_000n, cityCost: null }));
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ gold: 100_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ gold: 125_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(true);
    settle(p, ctx({ gold: 125_000n, cityCost: 125_000n }));
    expect(p.current()?.id).toBe("buy_city");

    // Spending the gold elsewhere doesn't complete the step; the city does.
    p.update(ctx({ gold: 0n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);
    p.update(ctx({ gold: 0n, cityCost: 250_000n, cities: 1 }));
    expect(p.stepDone()).toBe(true);
  });

  it("runs factory, port, warship, stargate, pausing on each info step", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "buy_factory");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    p.update(throne());
    expect(p.current()?.id).toBe("buy_factory");

    settle(p, throne({ factories: 1 }));
    expect(p.current()?.id).toBe("factory_info");
    for (let i = 0; i < 50; i++) p.update(throne({ factories: 1 }));
    expect(p.current()?.id).toBe("factory_info");
    p.acknowledge();
    settle(p, throne({ factories: 1 }));

    expect(p.current()?.id).toBe("send_boat");
    settle(p, throne({ factories: 1, boatSent: true }));

    expect(p.current()?.id).toBe("buy_port");
    expect(p.current()?.highlight).toBe("port");
    settle(p, throne({ factories: 1, ports: 1 }));
    expect(p.current()?.id).toBe("port_info");
    expect(p.current()?.bullets).toHaveLength(2);
    p.acknowledge();
    settle(p, throne({ factories: 1, ports: 1 }));

    expect(p.current()?.id).toBe("buy_defense_post");
    expect(p.current()?.highlight).toBe("defense_post");
    settle(p, throne({ factories: 1, ports: 1, defensePosts: 1 }));

    expect(p.current()?.id).toBe("buy_warship");
    expect(p.current()?.highlight).toBe("warship");
    settle(p, throne({ factories: 1, ports: 1, warships: 1 }));

    expect(p.current()?.id).toBe("buy_stargate");
    expect(p.current()?.highlight).toBe("stargate");
    p.update(throne({ factories: 1, ports: 1, warships: 1 }));
    expect(p.stepDone()).toBe(false);
    settle(p, throne({ factories: 1, ports: 1, warships: 1, stargates: 1 }));

    // The shot step waits for a shot, not for the gate to be ready.
    expect(p.current()?.id).toBe("fire_gate");
    expect(p.current()?.highlight).toBe("stargate");
    for (let i = 0; i < 50; i++)
      p.update(throne({ stargates: 1, gateReady: true }));
    expect(p.current()?.id).toBe("fire_gate");
    settle(p, throne({ stargates: 1, gateShotFired: true }));

    for (const [id, highlight, bullets] of [
      ["warhead_info", "atom", 2],
      ["shield_info", "shield_array", undefined],
      ["strike_info", undefined, 2],
      ["invade_info", "hegemon", 2],
    ] as const) {
      expect(p.current()?.id).toBe(id);
      expect(p.current()?.highlight).toBe(highlight);
      expect(p.current()?.bullets?.length).toBe(bullets);
      p.acknowledge();
      settle(p, throne({ stargates: 1 }));
    }
    expect(p.finished()).toBe(true);
  });

  it("tells the player about the Dark Star once they are on the map", () => {
    const p = new TutorialProgress();
    p.update(throne());
    expect(p.current()?.id).toBe("spawn");
    settle(p, throne({ hasSpawned: true }));
    expect(p.current()?.id).toBe("dark_star");
    expect(p.current()?.highlight).toBe("hegemon");
    // Informational: stays until acknowledged.
    for (let i = 0; i < 50; i++) p.update(throne({ hasSpawned: true }));
    expect(p.current()?.id).toBe("dark_star");
    p.acknowledge();
    settle(p, throne({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("drops every Dark Star step in a game without a throne", () => {
    const noThrone = ctx({ hasSpawned: true });
    const p = new TutorialProgress();
    settle(p, noThrone);
    expect(p.current()?.id).toBe("attack_wilderness");
    const ids = TUTORIAL_STEPS.filter((s) => s.applies?.(noThrone) ?? true).map(
      (s) => s.id,
    );
    expect(ids).not.toContain("dark_star");
    expect(ids).not.toContain("strike_info");
    expect(ids).not.toContain("invade_info");
    // The gate and shield steps are about units, not the throne.
    expect(ids).toContain("buy_stargate");
    expect(ids).toContain("shield_info");
  });

  it("skips the gate, warhead and shield steps when those units are off", () => {
    const off = throne({
      stargateDisabled: true,
      shieldArrayDisabled: true,
      hasSpawned: true,
    });
    const ids = TUTORIAL_STEPS.filter((s) => s.applies?.(off) ?? true).map(
      (s) => s.id,
    );
    for (const id of [
      "buy_stargate",
      "fire_gate",
      "warhead_info",
      "shield_info",
    ]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).toContain("strike_info");
  });
});

describe("TutorialProgress.skip", () => {
  it("moves past the current step without completing it", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");

    p.skip();
    expect(p.stepDone()).toBe(false);
    p.update(ctx());
    expect(p.current()?.id).toBe("attack_wilderness");

    // Skipping lands on the next *applicable* step.
    p.skip();
    p.update(ctx({ botsExist: false }));
    expect(p.current()?.id).toBe("troops");
    p.skip();
    p.skip();
    p.skip();
    p.update(ctx({ botsExist: false, cityDisabled: true }));
    expect(p.current()?.id).toBe("propose_alliance");
  });

  it("can skip through to the end", () => {
    const p = new TutorialProgress();
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) p.skip();
    p.update(ctx());
    expect(p.finished()).toBe(true);
    p.skip();
    expect(p.finished()).toBe(true);
  });
});

describe("TutorialProgress step counter", () => {
  it("doesn't shrink when bots or nations die off mid-tutorial", () => {
    const p = new TutorialProgress();
    // Pre-spawn ticks (nothing spawned yet) must not freeze the counter.
    p.update(ctx({ botsExist: false, nationsExist: false }));
    const before = throne({ hasSpawned: true });
    p.update(before);
    const total = p.total(before);
    expect(total).toBe(TUTORIAL_STEPS.length);

    const after = throne({
      hasSpawned: true,
      botsExist: false,
      nationsExist: false,
    });
    p.update(after);
    expect(p.total(after)).toBe(total);
    expect(p.position(after)).toBeGreaterThanOrEqual(1);
  });
});
