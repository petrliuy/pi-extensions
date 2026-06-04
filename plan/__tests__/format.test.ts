import { describe, expect, it } from "vitest";
import { formatEditablePlan, normalizePlanProposal, parseEditablePlan } from "../format.js";

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
