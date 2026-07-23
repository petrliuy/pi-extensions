import { describe, expect, it } from "vitest";
import {
	escapeXml,
	goalIdRejectionReason,
	isContradictoryCompletionSummary,
	migrateGoal,
} from "../index.js";

const goal = (overrides: Partial<{ id: string; objective: string; status: string; iteration: number; updatedAt: string }> = {}) => ({
	id: "goal-abc",
	objective: "ship the feature",
	status: "active" as const,
	iteration: 0,
	updatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

describe("isContradictoryCompletionSummary", () => {
	it("flags plain contradictions", () => {
		expect(isContradictoryCompletionSummary("the work is not complete")).toBe(true);
		expect(isContradictoryCompletionSummary("tests still failing")).toBe(true);
		expect(isContradictoryCompletionSummary("tests still fail")).toBe(true);
		expect(isContradictoryCompletionSummary("it is not yet done")).toBe(true);
	});

	it("does not flag the 'could not complete' hedges", () => {
		// Negative lookbehind: "could not complete" is a hedge, not a contradiction.
		expect(isContradictoryCompletionSummary("we could not complete X without Y, so we did Z and verified it")).toBe(false);
	});

	it("accepts genuine completion summaries", () => {
		expect(isContradictoryCompletionSummary("All tests pass. Feature implemented and verified end-to-end.")).toBe(false);
		expect(isContradictoryCompletionSummary("Done and verified against the spec.")).toBe(false);
	});
});

describe("goalIdRejectionReason", () => {
	it("rejects a missing goal_id", () => {
		expect(goalIdRejectionReason(goal(), "   ")).toBe("missing goal_id");
	});
	it("rejects a stale goal_id", () => {
		expect(goalIdRejectionReason(goal({ id: "goal-new" }), "goal-old")).toBe(
			"goal_id does not match the active goal",
		);
	});
	it("accepts the exact current goal_id", () => {
		expect(goalIdRejectionReason(goal({ id: "goal-xyz" }), "goal-xyz")).toBeUndefined();
	});
});

describe("migrateGoal", () => {
	it("returns undefined for empty/invalid input", () => {
		expect(migrateGoal(undefined)).toBeUndefined();
		expect(migrateGoal(null)).toBeUndefined();
		expect(migrateGoal({ objective: "   " })).toBeUndefined();
	});

	it("passes through the current shape", () => {
		const result = migrateGoal({ id: "goal-1", objective: "x", status: "active", iteration: 3, updatedAt: "t" });
		expect(result).toEqual({ id: "goal-1", objective: "x", status: "active", iteration: 3, updatedAt: "t" });
	});

	it("migrates legacy pursuing/achieved/unmet statuses and backfills id + iteration", () => {
		const pursuing = migrateGoal({ objective: "a", status: "pursuing", updatedAt: "t" });
		expect(pursuing?.status).toBe("active");
		expect(pursuing?.id).toMatch(/^goal-/);
		expect(pursuing?.iteration).toBe(0);

		expect(migrateGoal({ objective: "a", status: "achieved", updatedAt: "t" })?.status).toBe("complete");
		expect(migrateGoal({ objective: "a", status: "unmet", updatedAt: "t" })?.status).toBe("blocked");
		expect(migrateGoal({ objective: "a", status: "paused", updatedAt: "t" })?.status).toBe("paused");
	});
});

describe("escapeXml", () => {
	it("escapes XML metacharacters", () => {
		expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
	});
});
