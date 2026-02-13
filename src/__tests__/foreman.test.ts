import {
  describe,
  it,
  expect,
} from "bun:test";
import {
  ForemanState,
  ArbiterVerdict,
} from "../types.js";

import {
  nextState,
  parseArbiterVerdict,
  type PluginClient,
  type ForemanStatus,
} from "../foreman.js";

describe("nextState pure function", () => {
  const maxIterations = 3;

  describe("Valid transitions", () => {
    it("Idle + startDeveloping -> Developing", () => {
      const result = nextState(
        ForemanState.Idle,
        "startDeveloping",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Developing);
    });

    it("Developing + developmentComplete -> Reviewing", () => {
      const result = nextState(
        ForemanState.Developing,
        "developmentComplete",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Reviewing);
    });

    it("Reviewing + reviewComplete -> Arbitrating", () => {
      const result = nextState(
        ForemanState.Reviewing,
        "reviewComplete",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Arbitrating);
    });

    it("Arbitrating + verdict(Pass) -> Complete", () => {
      const result = nextState(
        ForemanState.Arbitrating,
        "verdict",
        ArbiterVerdict.Pass,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Complete);
    });

    it("Arbitrating + verdict(NeedsWork) + iteration < max -> Developing", () => {
      const result = nextState(
        ForemanState.Arbitrating,
        "verdict",
        ArbiterVerdict.NeedsWork,
        2,
        maxIterations
      );
      expect(result).toBe(ForemanState.Developing);
    });

    it("Arbitrating + verdict(NeedsWork) + iteration >= max -> Complete (max reached)", () => {
      const result = nextState(
        ForemanState.Arbitrating,
        "verdict",
        ArbiterVerdict.NeedsWork,
        3,
        maxIterations
      );
      expect(result).toBe(ForemanState.Complete);
    });

    it("Any state + error -> Failed", () => {
      const result = nextState(
        ForemanState.Developing,
        "error",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Failed);
    });

    it("Failed + error -> Failed (idempotent)", () => {
      const result = nextState(
        ForemanState.Failed,
        "error",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Failed);
    });
  });

  describe("Invalid transitions", () => {
    it("throws error for Idle + developmentComplete (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Idle, "developmentComplete", undefined, 1, maxIterations)
      ).toThrow();
    });

    it("throws error for Complete + startDeveloping (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Complete, "startDeveloping", undefined, 1, maxIterations)
      ).toThrow();
    });

    it("throws error for Developing + verdict (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Developing, "verdict", ArbiterVerdict.Pass, 1, maxIterations)
      ).toThrow();
    });

    it("throws error for Reviewing + startDeveloping (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Reviewing, "startDeveloping", undefined, 1, maxIterations)
      ).toThrow();
    });
  });
});

describe("parseArbiterVerdict", () => {
  it('returns Pass for text containing "PASS" (case-insensitive)', () => {
    expect(parseArbiterVerdict("The implementation is pass")).toBe(ArbiterVerdict.Pass);
    expect(parseArbiterVerdict("PASS - all tests pass")).toBe(ArbiterVerdict.Pass);
    expect(parseArbiterVerdict("I say Pass here")).toBe(ArbiterVerdict.Pass);
  });

  it('returns NeedsWork for text containing "NEEDS_WORK" (case-insensitive)', () => {
    expect(parseArbiterVerdict("needs_work - more fixes needed")).toBe(
      ArbiterVerdict.NeedsWork
    );
    expect(parseArbiterVerdict("NEEDS_WORK")).toBe(ArbiterVerdict.NeedsWork);
    expect(parseArbiterVerdict("I think Needs_Work is the verdict")).toBe(
      ArbiterVerdict.NeedsWork
    );
  });

  it('returns NeedsWork when both PASS and NEEDS_WORK are present (conservative)', () => {
    expect(parseArbiterVerdict("PASS or NEEDS_WORK? I say NEEDS_WORK")).toBe(
      ArbiterVerdict.NeedsWork
    );
    expect(parseArbiterVerdict("The tests pass but I think needs_work is better")).toBe(
      ArbiterVerdict.NeedsWork
    );
  });

  it("returns NeedsWork when neither keyword is present (fallback)", () => {
    expect(parseArbiterVerdict("The implementation looks good")).toBe(
      ArbiterVerdict.NeedsWork
    );
    expect(parseArbiterVerdict("")).toBe(ArbiterVerdict.NeedsWork);
    expect(parseArbiterVerdict("Maybe okay")).toBe(ArbiterVerdict.NeedsWork);
  });
});

describe("ForemanStatus type", () => {
  it("accepts valid status object with all fields", () => {
    const status: ForemanStatus = {
      state: ForemanState.Developing,
      storyId: "1-3",
      iteration: 2,
      maxIterations: 3,
      currentRole: "Developer",
      sessionDurationMs: 5000,
      taskStats: { total: 5, completed: 2 },
    };
    expect(status.state).toBe(ForemanState.Developing);
    expect(status.storyId).toBe("1-3");
    expect(status.currentRole).toBe("Developer");
    expect(status.sessionDurationMs).toBe(5000);
    expect(status.taskStats).toEqual({ total: 5, completed: 2 });
  });

  it("allows null fields for idle state", () => {
    const status: ForemanStatus = {
      state: ForemanState.Idle,
      storyId: null,
      iteration: 1,
      maxIterations: 3,
      currentRole: null,
      sessionDurationMs: null,
      taskStats: null,
    };
    expect(status.storyId).toBeNull();
    expect(status.currentRole).toBeNull();
    expect(status.sessionDurationMs).toBeNull();
    expect(status.taskStats).toBeNull();
  });
});

describe("PluginClient type", () => {
  it("accepts valid client object with status and tui", () => {
    const client: PluginClient = {
      session: {
        create: async () => ({ data: { id: "test" } }),
        promptAsync: async () => undefined,
        messages: async () => ({ data: [] }),
        abort: async () => undefined,
        status: async () => ({ data: {} }),
      },
      tui: {
        showToast: async () => undefined,
      },
    };
    expect(client.session).toBeDefined();
    expect(client.session.status).toBeDefined();
    expect(client.tui).toBeDefined();
  });
});
