import { describe, expect, it } from "vitest";
import { transition, transitionApproval } from "../constants.js";

const plan = {
	title: "Plan",
	summary: "Summary",
	steps: ["Change code"],
	assumptions: [],
	verification: [],
	risks: [],
	files: [],
};

describe("approval transitions", () => {
	it("supports a replacement proposal while approval is open", () => {
		const result = transition("approval", { type: "PROPOSE", plan });

		expect(result.mode).toBe("approval");
		expect(result.actions.map((action) => action.type)).toEqual([
			"persist",
			"update_status",
			"show_approval_ui",
		]);
	});

	it("keeps refine and edit as distinct approval actions", () => {
		expect(transitionApproval("Refine plan").effect).toBe("open_refinement");
		expect(transitionApproval("Edit plan").effect).toBe("open_editor");
		expect(transitionApproval("Execute plan").effect).toBe("start_execution");
	});
});
