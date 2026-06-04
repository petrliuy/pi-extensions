import { describe, expect, it } from "vitest";
import { PLAN_STATE_SCHEMA_VERSION } from "../constants.js";
import { restorePlanState } from "../state.js";

describe("plan state restore", () => {
	it("restores only the current schema", () => {
		const restored = restorePlanState({
			schemaVersion: PLAN_STATE_SCHEMA_VERSION,
			mode: "approval",
			todos: [],
			continuationCount: 1,
			noProgressContinuationCount: 2,
		});

		expect(restored.mode).toBe("approval");
		expect(restored.continuationCount).toBe(1);
	});

	it("ignores old schemas", () => {
		const restored = restorePlanState({
			schemaVersion: 2,
			mode: "executing",
			todos: [],
			continuationCount: 4,
			noProgressContinuationCount: 1,
		});

		expect(restored.mode).toBe("normal");
		expect(restored.continuationCount).toBe(0);
	});
});
