import { describe, expect, it } from "vitest";
import { formatEditablePlan, livingPlanFromUpdate, normalizePlanProposal, parseEditablePlan } from "../format.js";
import type { TodoItem } from "../utils.js";

describe("editable plan format", () => {
	it("renders every editable section and clears empty optional sections", () => {
		const plan = normalizePlanProposal({
			title: "Plan",
			summary: "Summary",
			steps: ["Change code"],
			assumptions: ["Old assumption"],
		});
		const edited = formatEditablePlan(plan)
			.replace("1. Old assumption", "")
			.replace("1. Change code", "1. New step");

		expect(parseEditablePlan(edited)).toEqual({
			title: "Plan",
			summary: "Summary",
			steps: ["New step"],
			assumptions: [],
			verification: [],
			risks: [],
			files: [],
			references: [],
		});
	});

	it("rejects missing required fields", () => {
		expect(() => parseEditablePlan("Title: Plan\n\nSteps:\n1. Change code")).toThrow("Summary is required");
		expect(() => parseEditablePlan("Title: Plan\nSummary: Summary\n\nSteps:")).toThrow(
			"steps must contain at least one item",
		);
	});

	it("normalizes multiline summaries and rejects multiline list items", () => {
		expect(
			normalizePlanProposal({
				title: "Plan",
				summary: "First line\nSecond line",
				steps: ["Change code"],
			}).summary,
		).toBe("First line Second line");
		expect(() =>
			normalizePlanProposal({
				title: "Plan",
				summary: "Summary",
				steps: ["First line\nSecond line"],
			}),
		).toThrow("steps[0] must be a single-line string");
	});
});

describe("livingPlanFromUpdate", () => {
	const base: TodoItem[] = [
		{ id: "task-1", step: 1, text: "Read code", completed: false, status: "completed", source: "plan" },
		{ id: "task-2", step: 2, text: "Write tests", completed: false, status: "in_progress", source: "plan" },
		{ id: "task-3", step: 3, text: "Refactor module", completed: false, status: "pending", source: "plan" },
	];

	it("reuses ids for unchanged step text and resequences step numbers", () => {
		const updated = livingPlanFromUpdate(base, [
			{ step: "Read code", status: "completed" },
			{ step: "Refactor module", status: "in_progress" },
			{ step: "Write tests", status: "pending" },
		]);
		expect(updated.map((t) => t.id)).toEqual(["task-1", "task-3", "task-2"]);
		expect(updated.map((t) => t.step)).toEqual([1, 2, 3]);
	});

	it("assigns new ids to brand-new steps", () => {
		const updated = livingPlanFromUpdate(base, [
			{ step: "Read code", status: "completed" },
			{ step: "Write tests", status: "completed" },
			{ step: "Add CI job", status: "pending" },
		]);
		expect(updated.map((t) => t.id)).toEqual(["task-1", "task-2", "task-4"]);
	});

	it("matches steps case-insensitively across whitespace", () => {
		const updated = livingPlanFromUpdate(base, [{ step: "  read   CODE  ", status: "in_progress" }]);
		expect(updated[0].id).toBe("task-1");
		expect(updated[0].text).toBe("read   CODE");
	});
});
