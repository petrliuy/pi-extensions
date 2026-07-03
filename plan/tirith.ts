/**
 * Tirith security enrichment for Plan Mode bash guards.
 *
 * Mirrors the canonical tirith Pi CLI extension
 * (crates/tirith/assets/hooks/tirith-guard.ts): runs
 *   tirith check --json --non-interactive --shell posix -- <command>
 * and interprets exit codes:
 *   0 = clean, 1 = block, 2 = warn, anything else = error.
 *
 * Enrichment-only contract: callers keep their own decision on clean/error.
 * Tirith may only strengthen (add findings to the reason, escalate severity);
 * it never weakens the caller's verdict. A missing or erroring binary must not
 * open a hole — the caller's block stands unchanged.
 */

import { execFileSync } from 'node:child_process';

export interface TirithConfig {
	/** Opt in to tirith enrichment. Default: disabled. */
	enabled?: boolean;
	/** Override the tirith binary path. Falls back to $TIRITH_BIN, then `tirith`. */
	binary?: string;
	/** execFileSync timeout in ms. Default: 10000 (matches the canonical guard). */
	timeoutMs?: number;
	/** What to do when tirith exits 2 (warn). `allow` keeps the caller's severity; `deny` escalates to a hard block. Default: `allow`. */
	warnAction?: 'allow' | 'deny';
}

export type TirithStatus = 'clean' | 'block' | 'warn' | 'error';

export interface TirithVerdict {
	status: TirithStatus;
	/** One-line findings summary, e.g. "[HIGH] pipe_to_interpreter; [CRITICAL] non_ascii_hostname". Empty when clean. */
	summary: string;
}

/** Plan Mode severity carried alongside a guard decision. */
export type PlanSeverity = 'destructive' | 'unknown';

/**
 * Pure merge of a tirith verdict into Plan Mode's own block decision.
 * Enrichment-only: tirith can only strengthen.
 * - block, or warn with warnAction `deny` → escalate to `destructive`.
 * - warn with warnAction `allow` → keep the caller's severity, append findings.
 * - clean/error → unchanged (error never weakens; an optional note is appended).
 */
export function mergeTirithVerdict(
	baseReason: string,
	severity: PlanSeverity,
	verdict: TirithVerdict,
	warnAction: 'allow' | 'deny',
): { severity: PlanSeverity; reason: string } {
	if (verdict.status === 'clean') {
		return { severity, reason: baseReason };
	}
	if (verdict.status === 'error') {
		const note = verdict.summary ? `\ntirith: unavailable — ${verdict.summary}` : '';
		return { severity, reason: note ? `${baseReason}${note}` : baseReason };
	}
	const findingsNote = verdict.summary ? `tirith: ${verdict.summary}` : 'tirith: security finding';
	const reason = `${baseReason}\n${findingsNote}`;
	if (verdict.status === 'block' || warnAction === 'deny') {
		return { severity: 'destructive', reason };
	}
	return { severity, reason };
}

export function tirithEnabled(config: TirithConfig | undefined): config is TirithConfig {
	return config?.enabled === true;
}

export function tirithBinary(config: TirithConfig | undefined): string {
	return config?.binary || process.env.TIRITH_BIN || 'tirith';
}

/**
 * Resolve the warn action from config, falling back to $TIRITH_HOOK_WARN_ACTION
 * for parity with the canonical tirith guard, then to `allow`.
 */
export function resolveTirithWarnAction(config: TirithConfig | undefined): 'allow' | 'deny' {
	const raw = (config?.warnAction ?? process.env.TIRITH_HOOK_WARN_ACTION ?? 'allow').toLowerCase();
	return raw === 'deny' ? 'deny' : 'allow';
}

export function runTirithCheck(command: string, config: TirithConfig | undefined): TirithVerdict {
	const binary = tirithBinary(config);
	const timeout = config?.timeoutMs ?? 10_000;
	const env = { ...process.env, TIRITH_INTEGRATION: 'pi-cli' };

	try {
		execFileSync(
			binary,
			['check', '--json', '--non-interactive', '--shell', 'posix', '--', command],
			{ timeout, encoding: 'utf-8', env },
		);
		return { status: 'clean', summary: '' };
	} catch (err) {
		const e = err as {
			code?: string;
			killed?: boolean;
			status?: number;
			stdout?: string;
			message?: string;
		};
		if (e.code === 'ENOENT') {
			return { status: 'error', summary: `tirith not found (${binary})` };
		}
		if (e.killed) {
			return { status: 'error', summary: 'tirith check timed out' };
		}
		const exitCode = e.status;
		const stdout = typeof e.stdout === 'string' ? e.stdout : '';
		if (exitCode == null || (exitCode !== 1 && exitCode !== 2)) {
			const detail = exitCode == null ? (e.message ?? 'unknown error') : `exit code ${exitCode}`;
			return { status: 'error', summary: detail };
		}
		const summary = parseTirithFindings(stdout).join('; ');
		if (exitCode === 2) {
			return { status: 'warn', summary };
		}
		return { status: 'block', summary };
	}
}

/**
 * Parse `verdict.findings[]` into `[severity] title` strings.
 * Falls back to a truncated stdout slice on malformed JSON so a reason is still surfaced.
 * Field shape follows the canonical tirith-guard.ts: { findings: [{ title?, rule_id?, severity? }] }.
 */
function parseTirithFindings(stdout: string): string[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];
	try {
		const verdict = JSON.parse(trimmed) as {
			findings?: Array<{ title?: string; rule_id?: string; severity?: string }>;
		};
		const findings = Array.isArray(verdict.findings) ? verdict.findings : [];
		if (findings.length === 0) return [];
		return findings.map((f) => {
			const title = f.title || f.rule_id || 'unknown';
			const sev = f.severity || '';
			return sev ? `[${sev}] ${title}` : title;
		});
	} catch {
		return [trimmed.slice(0, 500)];
	}
}
