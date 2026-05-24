import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const UNDO_ROOT = join(homedir(), ".pi", "agent", "undo");

interface FileSnapshot {
	path: string;
	displayPath: string;
	existed: boolean;
	snapshotFile?: string;
	beforeHash?: string;
	beforeMode?: number;
	afterExists?: boolean;
	afterHash?: string;
	afterMode?: number;
	changed: boolean;
}

interface UndoBatch {
	id: string;
	createdAt: string;
	completedAt?: string;
	files: FileSnapshot[];
}

interface UndoStateEntry {
	batch?: UndoBatch;
}

function now(): string {
	return new Date().toISOString();
}

function hashBuffer(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function ensurePrivateDir(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	try {
		chmodSync(path, 0o700);
	} catch {
		// chmod can fail on filesystems without POSIX permissions.
	}
}

function resolvePath(filePath: string, cwd: string): string {
	const expanded = filePath === "~" ? homedir() : filePath.startsWith("~/") ? join(homedir(), filePath.slice(2)) : filePath;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function displayPath(path: string, cwd: string): string {
	const rel = relative(cwd, path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return path;
	return rel;
}

function getFileHash(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	return hashBuffer(readFileSync(path));
}

function getFileMode(path: string): number | undefined {
	if (!existsSync(path)) return undefined;
	return statSync(path).mode;
}

function readSnapshotContent(batch: UndoBatch, snapshot: FileSnapshot): Buffer {
	if (!snapshot.snapshotFile) return Buffer.alloc(0);
	return readFileSync(join(UNDO_ROOT, batch.id, snapshot.snapshotFile));
}

function formatBatch(batch: UndoBatch): string {
	const files = batch.files.filter((file) => file.changed);
	const lines = files.map((file) => `- ${file.displayPath}${file.existed ? "" : " (created)"}`);
	return [`Batch: ${batch.id}`, `Completed: ${batch.completedAt ?? batch.createdAt}`, `Files: ${files.length}`, ...lines].join("\n");
}

function isUndoTool(event: ToolCallEvent | ToolResultEvent): boolean {
	return event.toolName === "edit" || event.toolName === "write";
}

export default function undoExtension(pi: ExtensionAPI): void {
	let latestBatch: UndoBatch | undefined;
	let currentBatch: UndoBatch | undefined;
	const pendingToolFiles = new Map<string, string>();

	function persistState(): void {
		pi.appendEntry("undo-state", {
			batch: latestBatch,
		});
	}

	function getBatchDir(batch: UndoBatch): string {
		return join(UNDO_ROOT, batch.id);
	}

	function createBatch(ctx: ExtensionContext): UndoBatch {
		const batch: UndoBatch = {
			id: `${ctx.sessionManager.getSessionId()}-${Date.now()}`,
			createdAt: now(),
			files: [],
		};
		ensurePrivateDir(getBatchDir(batch));
		currentBatch = batch;
		return batch;
	}

	function snapshotFile(event: ToolCallEvent, ctx: ExtensionContext): { block?: boolean; reason?: string } | undefined {
		if (!isUndoTool(event)) return;

		const inputPath = event.input.path;
		if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
			return { block: true, reason: "Undo extension: edit/write path must be a non-empty string." };
		}

		const absolutePath = resolvePath(inputPath, ctx.cwd);
		const batch = currentBatch ?? createBatch(ctx);
		const existing = batch.files.find((file) => file.path === absolutePath);
		if (existing) {
			pendingToolFiles.set(event.toolCallId, absolutePath);
			return;
		}

		try {
			const existed = existsSync(absolutePath);
			const snapshot: FileSnapshot = {
				path: absolutePath,
				displayPath: displayPath(absolutePath, ctx.cwd),
				existed,
				changed: false,
			};

			if (existed) {
				const content = readFileSync(absolutePath);
				snapshot.beforeHash = hashBuffer(content);
				snapshot.beforeMode = statSync(absolutePath).mode;
				snapshot.snapshotFile = `${batch.files.length + 1}-${snapshot.beforeHash}.bin`;
				writeFileSync(join(getBatchDir(batch), snapshot.snapshotFile), content, { mode: 0o600 });
			}

			batch.files.push(snapshot);
			pendingToolFiles.set(event.toolCallId, absolutePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				block: true,
				reason: `Undo extension: failed to snapshot ${absolutePath}; edit/write blocked to keep /undo reliable. ${message}`,
			};
		}
	}

	function finalizeToolResult(event: ToolResultEvent): void {
		if (!isUndoTool(event) || !currentBatch) return;
		const absolutePath = pendingToolFiles.get(event.toolCallId);
		if (!absolutePath) return;
		pendingToolFiles.delete(event.toolCallId);

		const snapshot = currentBatch.files.find((file) => file.path === absolutePath);
		if (!snapshot) return;

		const afterExists = existsSync(absolutePath);
		const afterHash = getFileHash(absolutePath);
		snapshot.afterExists = afterExists;
		snapshot.afterHash = afterHash;
		snapshot.afterMode = getFileMode(absolutePath);
		snapshot.changed = snapshot.existed !== afterExists || snapshot.beforeHash !== afterHash;
	}

	function closeCurrentBatch(): void {
		if (!currentBatch) return;
		const changedFiles = currentBatch.files.filter((file) => file.changed);
		if (changedFiles.length === 0) {
			rmSync(getBatchDir(currentBatch), { recursive: true, force: true });
			currentBatch = undefined;
			pendingToolFiles.clear();
			return;
		}

		currentBatch.completedAt = now();
		currentBatch.files = changedFiles;
		if (latestBatch) {
			removeStoredBatch(latestBatch);
		}
		latestBatch = currentBatch;
		currentBatch = undefined;
		pendingToolFiles.clear();
		persistState();
	}

	function restoreBatch(batch: UndoBatch, force: boolean): { restored: string[]; skipped: string[] } {
		const restored: string[] = [];
		const skipped: string[] = [];

		for (const snapshot of [...batch.files].reverse()) {
			const currentHash = getFileHash(snapshot.path);
			const currentExists = existsSync(snapshot.path);
			const expectedHash = snapshot.afterExists ? snapshot.afterHash : undefined;
			const changedAgain = snapshot.afterExists !== currentExists || currentHash !== expectedHash;

			if (changedAgain && !force) {
				skipped.push(`${snapshot.displayPath} (changed after captured edit)`);
				continue;
			}

			if (!snapshot.existed) {
				rmSync(snapshot.path, { recursive: true, force: true });
				restored.push(snapshot.displayPath);
				continue;
			}

			mkdirSync(dirname(snapshot.path), { recursive: true });
			writeFileSync(snapshot.path, readSnapshotContent(batch, snapshot));
			if (snapshot.beforeMode !== undefined) {
				try {
					chmodSync(snapshot.path, snapshot.beforeMode);
				} catch {
					// Permission restoration is best-effort across filesystems.
				}
			}
			restored.push(snapshot.displayPath);
		}

		if (skipped.length === 0 && latestBatch?.id === batch.id) {
			removeStoredBatch(batch);
			latestBatch = undefined;
			persistState();
		}

		return { restored, skipped };
	}

	function removeStoredBatch(batch: UndoBatch): void {
		rmSync(getBatchDir(batch), { recursive: true, force: true });
	}

	async function runUndo(args: string, ctx: ExtensionContext): Promise<void> {
		const command = args.trim().toLowerCase();
		if (command === "show") {
			ctx.ui.notify(latestBatch ? formatBatch(latestBatch) : "No undo snapshot.", "info");
			return;
		}
		if (command === "clear") {
			if (latestBatch) {
				removeStoredBatch(latestBatch);
			}
			if (currentBatch) {
				removeStoredBatch(currentBatch);
			}
			latestBatch = undefined;
			currentBatch = undefined;
			pendingToolFiles.clear();
			persistState();
			ctx.ui.notify("Undo snapshot cleared.", "info");
			return;
		}

		const force = command === "force" || command === "--force";
		if (command && !force) {
			ctx.ui.notify("Usage: /undo [show|clear|force]", "warning");
			return;
		}

		const batch = latestBatch;
		if (!batch) {
			ctx.ui.notify("No undo snapshot.", "info");
			return;
		}

		if (!force && ctx.hasUI) {
			const ok = await ctx.ui.confirm("Undo last file changes?", formatBatch(batch));
			if (!ok) return;
		}

		const result = restoreBatch(batch, force);
		const lines = [`Restored ${result.restored.length} file(s).`];
		if (result.restored.length > 0) lines.push(...result.restored.map((file) => `- ${file}`));
		if (result.skipped.length > 0) {
			lines.push("", `Skipped ${result.skipped.length} file(s):`, ...result.skipped.map((file) => `- ${file}`));
			lines.push("", "Run /undo force to overwrite files that changed after the captured edit.");
		}
		ctx.ui.notify(lines.join("\n"), result.skipped.length > 0 ? "warning" : "info");
	}

	pi.registerCommand("undo", {
		description: "Undo files changed by the last Pi edit/write tool turn",
		handler: async (args, ctx) => runUndo(args, ctx),
	});

	pi.on("tool_call", async (event, ctx) => snapshotFile(event, ctx));
	pi.on("tool_result", async (event) => finalizeToolResult(event));
	pi.on("agent_end", async () => closeCurrentBatch());
	pi.on("session_shutdown", async () => closeCurrentBatch());

	pi.on("session_start", async (_event, ctx) => {
		const entry = ctx.sessionManager
			.getEntries()
			.filter((item: { type: string; customType?: string }) => item.type === "custom" && item.customType === "undo-state")
			.pop() as { data?: UndoStateEntry } | undefined;
		latestBatch = entry?.data?.batch;
		currentBatch = undefined;
		pendingToolFiles.clear();
	});
}
