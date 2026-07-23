import { describe, expect, it } from "vitest";
import { getExecuteModeTools, getNormalModeTools, getPlanModeTools } from "../config.js";
import { PLAN_PROPOSAL_TOOL, PLAN_TASK_UPDATE_TOOL } from "../constants.js";

describe("plan mode tools", () => {
	it("does not expose write tools by default", () => {
		expect(getPlanModeTools({})).toEqual([
			"read",
			"bash",
			"grep",
			"find",
			"ls",
			"ask_user_question",
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

	it("removes plan-only tools from normal mode tools", () => {
		expect(
			getNormalModeTools([
				"read",
				"bash",
				PLAN_PROPOSAL_TOOL,
				"edit",
				PLAN_TASK_UPDATE_TOOL,
				"custom_tool",
			]),
		).toEqual(["read", "bash", "edit", "custom_tool"]);
	});

	it("keeps execution progress reporting without exposing proposal submission", () => {
		expect(
			getExecuteModeTools({
				tools: ["read", "bash", PLAN_PROPOSAL_TOOL, "edit"],
			}),
		).toEqual(["read", "bash", "edit", PLAN_TASK_UPDATE_TOOL]);
	});
});
