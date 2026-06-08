import { describe, expect, it } from "vitest";
import { writeToolGuard, shellPlanGuard } from "../guards.js";

describe("writeToolGuard", () => {
	it("directs blocked edits back to propose_plan without asking to exit Plan Mode", () => {
		const decision = writeToolGuard("edit");

		expect(decision?.block).toBe(true);
		expect(decision?.reason).toContain("call propose_plan");
		expect(decision?.reason).toContain("Do not ask the user to exit or switch Plan Mode");
	});
});

describe("shellPlanGuard", () => {
	it("passes read-only commands through (returns undefined)", () => {
		expect(shellPlanGuard("git log --oneline")).toBeUndefined();
	});

	it("passes read-only git -C commands through (returns undefined)", () => {
		expect(shellPlanGuard("git -C /home/user/repo log --oneline -5")).toBeUndefined();
	});

	it("blocks destructive commands with severity 'destructive'", () => {
		const decision = shellPlanGuard("git push");

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("destructive");
	});

	it("blocks git -C destructive commands with severity 'destructive'", () => {
		const decision = shellPlanGuard("git -C /home/user/repo push");

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("destructive");
	});

	it("blocks git commit with severity 'destructive'", () => {
		const decision = shellPlanGuard('git commit -m "msg"');

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("destructive");
	});

	it("blocks destructive commands without confirmation prompt instruction", () => {
		const decision = shellPlanGuard("rm -rf /tmp/test");

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("destructive");
		expect(decision!.reason).toContain("side effects");
	});

	it("blocks unknown commands (not destructive but not read-only) with severity 'unknown'", () => {
		const decision = shellPlanGuard("git add AGENTS.md");

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("unknown");
	});

	it("blocks unknown git -C commands with severity 'unknown'", () => {
		const decision = shellPlanGuard("git -C /home/user/repo add AGENTS.md");

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("unknown");
	});

	it("blocks unknown commands with allowlist-aware fallback message", () => {
		const decision = shellPlanGuard("some-unknown-tool");

		expect(decision).toBeDefined();
		expect(decision!.block).toBe(true);
		expect(decision!.severity).toBe("unknown");
		expect(decision!.reason).toContain("not in the read-only allowlist");
	});

	it("respects manual allowlist overrides", () => {
		const allowlist = { prefixes: ["git stash"] };
		expect(shellPlanGuard("git stash list", allowlist)).toBeUndefined();
	});
});
