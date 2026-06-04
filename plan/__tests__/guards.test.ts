import { describe, expect, it } from "vitest";
import { writeToolGuard } from "../guards.js";

describe("plan mode write guard", () => {
	it("directs blocked edits back to propose_plan without asking to exit Plan Mode", () => {
		const decision = writeToolGuard("edit");

		expect(decision?.block).toBe(true);
		expect(decision?.reason).toContain("call propose_plan");
		expect(decision?.reason).toContain("Do not ask the user to exit or switch Plan Mode");
	});
});
