import { describe, expect, it } from "vitest";
import { getPlanModeTools } from "../config.js";
import { PLAN_PROPOSAL_TOOL } from "../constants.js";

describe("plan mode tools", () => {
	it("does not expose write tools by default", () => {
		expect(getPlanModeTools({})).toEqual([
			"read",
			"bash",
			"grep",
			"find",
			"ls",
			"questionnaire",
			PLAN_PROPOSAL_TOOL,
		]);
	});

	it("filters configured write tools and keeps propose_plan", () => {
		expect(
			getPlanModeTools({
				tools: ["read", "edit", "write", "apply_patch", "mcp.files.edit", "custom_read"],
			}),
		).toEqual(["read", "custom_read", PLAN_PROPOSAL_TOOL]);
	});
});
