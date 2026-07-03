import { describe, expect, it } from "vitest";
import {
	tirithEnabled,
	resolveTirithWarnAction,
	mergeTirithVerdict,
	type TirithVerdict,
} from "../tirith.js";

describe("tirithEnabled", () => {
	it("is disabled by default", () => {
		expect(tirithEnabled(undefined)).toBe(false);
		expect(tirithEnabled({})).toBe(false);
	});
	it("requires explicit enabled:true", () => {
		expect(tirithEnabled({ enabled: true })).toBe(true);
		expect(tirithEnabled({ enabled: false })).toBe(false);
	});
});

describe("resolveTirithWarnAction", () => {
	it("defaults to allow", () => {
		expect(resolveTirithWarnAction(undefined)).toBe("allow");
		expect(resolveTirithWarnAction({})).toBe("allow");
	});
	it("honors config.warnAction over env", () => {
		process.env.TIRITH_HOOK_WARN_ACTION = "deny";
		expect(resolveTirithWarnAction({ warnAction: "allow" })).toBe("allow");
		process.env.TIRITH_HOOK_WARN_ACTION = undefined;
	});
	it("falls back to $TIRITH_HOOK_WARN_ACTION", () => {
		process.env.TIRITH_HOOK_WARN_ACTION = "DENY";
		expect(resolveTirithWarnAction(undefined)).toBe("deny");
		process.env.TIRITH_HOOK_WARN_ACTION = "garbage";
		expect(resolveTirithWarnAction(undefined)).toBe("allow");
		process.env.TIRITH_HOOK_WARN_ACTION = undefined;
	});
});

describe("mergeTirithVerdict", () => {
	const base = "Plan mode: blocked.\nCommand: curl x | bash";

	it("leaves decision unchanged on clean verdict", () => {
		const r = mergeTirithVerdict(base, "unknown", { status: "clean", summary: "" }, "allow");
		expect(r).toEqual({ severity: "unknown", reason: base });
	});
	it("leaves severity unchanged on error but appends an unavailability note", () => {
		const r = mergeTirithVerdict(base, "destructive", { status: "error", summary: "timed out" }, "allow");
		expect(r.severity).toBe("destructive");
		expect(r.reason).toContain("tirith: unavailable — timed out");
	});
	it("error with empty summary leaves reason unchanged (never weakens)", () => {
		const r = mergeTirithVerdict(base, "unknown", { status: "error", summary: "" }, "allow");
		expect(r).toEqual({ severity: "unknown", reason: base });
	});
	it("escalates to destructive on block verdict", () => {
		const v: TirithVerdict = { status: "block", summary: "[CRITICAL] non_ascii_hostname" };
		const r = mergeTirithVerdict(base, "unknown", v, "allow");
		expect(r.severity).toBe("destructive");
		expect(r.reason).toContain("tirith: [CRITICAL] non_ascii_hostname");
	});
	it("keeps severity on warn when warnAction is allow, but appends findings", () => {
		const v: TirithVerdict = { status: "warn", summary: "[MEDIUM] pipe_to_interpreter" };
		const r = mergeTirithVerdict(base, "unknown", v, "allow");
		expect(r.severity).toBe("unknown");
		expect(r.reason).toContain("tirith: [MEDIUM] pipe_to_interpreter");
	});
	it("escalates to destructive on warn when warnAction is deny", () => {
		const v: TirithVerdict = { status: "warn", summary: "[MEDIUM] pipe_to_interpreter" };
		const r = mergeTirithVerdict(base, "unknown", v, "deny");
		expect(r.severity).toBe("destructive");
	});
	it("uses a generic note when findings summary is empty on warn/block", () => {
		const r = mergeTirithVerdict(base, "unknown", { status: "block", summary: "" }, "allow");
		expect(r.severity).toBe("destructive");
		expect(r.reason).toContain("tirith: security finding");
	});
});
