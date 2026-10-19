// Powerline status: a powerline-style status row around the prompt (in the style of
// Powerlevel10k): model, reasoning effort, project path, git branch with staged (+), unstaged (*)
// and untracked (?) counts, context usage (yellow above 70%, red above 90%), and token counts.
// Nerd Font glyphs are used when the terminal is known to have them (iTerm, WezTerm, kitty,
// Ghostty, Alacritty), with ASCII fallbacks; POWERLINE_NERD_FONTS=1 or 0 forces either way.
//
// /powerline [preset]                 switch preset: default, minimal, compact, full, nerd, ascii
// /powerline on|off                   show or hide the row
// /powerline placement above|below|toggle
// The preset, placement, and on/off choice are saved across sessions.

import {hostname} from 'node:os';
import {basename, sep} from 'node:path';
import type {
	AgentEvent,
	Disposable,
	ModApi,
	ModHostEvent,
} from '@commandcode/harness';

// ── presets ──────────────────────────────────────────────────────────────────────────────────

export type SegmentId =
	| 'hostname'
	| 'model'
	| 'thinking'
	| 'path'
	| 'git'
	| 'context_pct'
	| 'token_in'
	| 'token_out'
	| 'token_total'
	| 'cache_read'
	| 'time';

export type SeparatorStyle = 'powerline' | 'powerline-thin' | 'slash' | 'ascii';
export type PathMode = 'basename' | 'abbreviated';

export interface Preset {
	readonly left: readonly SegmentId[];
	readonly right: readonly SegmentId[];
	readonly separator: SeparatorStyle;
	readonly pathMode: PathMode;
	readonly pathMaxLength: number;
	readonly gitDetail: boolean;
	readonly muted: boolean;
}

export const PRESETS: Readonly<Record<string, Preset>> = {
	default: {
		left: ['model', 'thinking', 'path', 'git', 'context_pct', 'cache_read'],
		right: [],
		separator: 'powerline-thin',
		pathMode: 'basename',
		pathMaxLength: 40,
		gitDetail: true,
		muted: false,
	},
	minimal: {
		left: ['path', 'git'],
		right: ['context_pct'],
		separator: 'slash',
		pathMode: 'basename',
		pathMaxLength: 40,
		gitDetail: false,
		muted: true,
	},
	compact: {
		left: ['model', 'git'],
		right: ['context_pct'],
		separator: 'powerline-thin',
		pathMode: 'basename',
		pathMaxLength: 40,
		gitDetail: true,
		muted: false,
	},
	full: {
		left: ['hostname', 'model', 'thinking', 'path', 'git'],
		right: ['token_in', 'token_out', 'cache_read', 'context_pct', 'time'],
		separator: 'powerline',
		pathMode: 'abbreviated',
		pathMaxLength: 50,
		gitDetail: true,
		muted: false,
	},
	nerd: {
		left: ['hostname', 'model', 'thinking', 'path', 'git'],
		right: ['token_in', 'token_out', 'cache_read', 'context_pct', 'time'],
		separator: 'powerline',
		pathMode: 'abbreviated',
		pathMaxLength: 60,
		gitDetail: true,
		muted: false,
	},
	ascii: {
		left: ['model', 'path', 'git'],
		right: ['token_total', 'context_pct'],
		separator: 'ascii',
		pathMode: 'abbreviated',
		pathMaxLength: 40,
		gitDetail: true,
		muted: true,
	},
};

// ── glyphs and colors ────────────────────────────────────────────────────────────────────────

export interface Glyphs {
	readonly model: string;
	readonly folder: string;
	readonly branch: string;
	readonly context: string;
	readonly input: string;
	readonly output: string;
	readonly tokens: string;
	readonly cache: string;
	readonly time: string;
	readonly host: string;
	readonly separators: Readonly<Record<SeparatorStyle, string>>;
}

const NERD_GLYPHS: Glyphs = {
	model: '',
	folder: '',
	branch: '',
	context: '',
	input: '',
	output: '',
	tokens: '',
	cache: '',
	time: '',
	host: '',
	separators: {powerline: '', 'powerline-thin': '', slash: '/', ascii: '>'},
};

const ASCII_GLYPHS: Glyphs = {
	model: '',
	folder: 'dir',
	branch: '⎇',
	context: '◫',
	input: 'in:',
	output: 'out:',
	tokens: '⊛',
	cache: 'cache',
	time: '◷',
	host: 'host',
	separators: {powerline: '>', 'powerline-thin': '|', slash: '/', ascii: '>'},
};

const THINKING_ASCII: Readonly<Record<string, string>> = {
	minimal: '[min]',
	low: '[low]',
	medium: '[med]',
	high: '[high]',
	xhigh: '[xhi]',
	max: '[max]',
};

const THINKING_NERD: Readonly<Record<string, string>> = {
	minimal: '\u{F0E7} min',
	low: '\u{F10C} low',
	medium: '\u{F192} med',
	high: '\u{F111} high',
	xhigh: '\u{F06D} xhi',
	max: '\u{F06D} max',
};

type Env = Readonly<Record<string, string | undefined>>;

/** Nerd Font support: forced by POWERLINE_NERD_FONTS, else guessed from the terminal. */
export function hasNerdFonts(env: Env): boolean {
	if (env.POWERLINE_NERD_FONTS === '1') return true;
	if (env.POWERLINE_NERD_FONTS === '0') return false;
	const term = (env.TERM_PROGRAM ?? env.TERM ?? '').toLowerCase();
	return ['iterm', 'wezterm', 'kitty', 'ghostty', 'alacritty'].some(name =>
		term.includes(name),
	);
}

const RESET = '\x1b[0m';

function rgb(hex: string): string {
	const value = hex.replace('#', '');
	const red = Number.parseInt(value.slice(0, 2), 16);
	const green = Number.parseInt(value.slice(2, 4), 16);
	const blue = Number.parseInt(value.slice(4, 6), 16);
	return `\x1b[38;2;${red};${green};${blue}m`;
}

const COLORS = {
	separator: '\x1b[38;5;244m',
	model: rgb('#d787af'),
	path: rgb('#00afaf'),
	gitClean: rgb('#5faf5f'),
	gitDirty: rgb('#febc38'),
	muted: '\x1b[38;5;245m',
	text: '',
	warning: '\x1b[33m',
	error: '\x1b[31m',
	thinkingLow: '\x1b[38;5;110m',
	thinkingHigh: '\x1b[38;5;213m',
} as const;

function paint(color: string, text: string): string {
	return color ? `${color}${text}${RESET}` : text;
}

// ── segment inputs ───────────────────────────────────────────────────────────────────────────

export interface GitStatus {
	readonly branch: string;
	readonly staged: number;
	readonly unstaged: number;
	readonly untracked: number;
}

/** Parse `git status --porcelain=v1 --branch`. */
export function parseGitStatus(output: string): GitStatus | undefined {
	const lines = output.split('\n').filter(Boolean);
	const head = lines[0];
	if (!head?.startsWith('## ')) return undefined;
	const branchPart = head.slice(3).split('...')[0] ?? '';
	const branch = branchPart
		.replace(/^No commits yet on /, '')
		.replace(/^HEAD \(no branch\)$/, 'detached');
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of lines.slice(1)) {
		if (line.startsWith('??')) {
			untracked += 1;
			continue;
		}
		if (line[0] && line[0] !== ' ') staged += 1;
		if (line[1] && line[1] !== ' ') unstaged += 1;
	}
	return {branch, staged, unstaged, untracked};
}

export interface StatusInputs {
	readonly model?: string;
	readonly effort?: string;
	readonly cwd: string;
	readonly home: string;
	readonly git?: GitStatus;
	readonly contextPercent?: number;
	readonly tokensIn: number;
	readonly tokensOut: number;
	readonly cacheRead: number;
	readonly host: string;
	readonly now: Date;
}

export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

function shortModel(model: string): string {
	const last = model.split('/').at(-1) ?? model;
	return last.replace(/^claude-/, '');
}

export function formatPath(params: {
	readonly cwd: string;
	readonly home: string;
	readonly mode: PathMode;
	readonly maxLength: number;
}): string {
	if (params.mode === 'basename') return basename(params.cwd) || params.cwd;
	const withHome =
		params.home && params.cwd.startsWith(params.home)
			? `~${params.cwd.slice(params.home.length)}`
			: params.cwd;
	if (withHome.length <= params.maxLength) return withHome;
	const parts = withHome.split(sep);
	const tail = parts.slice(-2).join(sep);
	return `…${sep}${tail}`.slice(-params.maxLength);
}

function contextColor(percent: number): string {
	if (percent > 90) return COLORS.error;
	if (percent > 70) return COLORS.warning;
	return COLORS.muted;
}

function thinkingColor(effort: string): string {
	if (effort === 'high' || effort === 'xhigh' || effort === 'max')
		return COLORS.thinkingHigh;
	return COLORS.thinkingLow;
}

/** One segment's colored text, or undefined when it has nothing to show. */
export function renderSegment(params: {
	readonly id: SegmentId;
	readonly inputs: StatusInputs;
	readonly preset: Preset;
	readonly glyphs: Glyphs;
	readonly isNerd: boolean;
}): string | undefined {
	const {id, inputs, preset, glyphs} = params;
	const icon = (glyph: string, text: string): string =>
		glyph ? `${glyph} ${text}` : text;
	const color = (accent: string): string =>
		preset.muted ? COLORS.text : accent;
	if (id === 'hostname')
		return paint(COLORS.muted, icon(glyphs.host, inputs.host));
	if (id === 'model') {
		if (!inputs.model) return undefined;
		return paint(
			color(COLORS.model),
			icon(glyphs.model, shortModel(inputs.model)),
		);
	}
	if (id === 'thinking') {
		if (!inputs.effort || inputs.effort === 'off') return undefined;
		const table = params.isNerd ? THINKING_NERD : THINKING_ASCII;
		return paint(
			thinkingColor(inputs.effort),
			table[inputs.effort] ?? `[${inputs.effort}]`,
		);
	}
	if (id === 'path') {
		const path = formatPath({
			cwd: inputs.cwd,
			home: inputs.home,
			mode: preset.pathMode,
			maxLength: preset.pathMaxLength,
		});
		return paint(color(COLORS.path), icon(glyphs.folder, path));
	}
	if (id === 'git') {
		const git = inputs.git;
		if (!git) return undefined;
		const counts = preset.gitDetail
			? [
					git.staged > 0 ? `+${git.staged}` : '',
					git.unstaged > 0 ? `*${git.unstaged}` : '',
					git.untracked > 0 ? `?${git.untracked}` : '',
				].filter(Boolean)
			: [];
		const isDirty = git.staged + git.unstaged + git.untracked > 0;
		const text = [git.branch, ...counts].join(' ');
		return paint(
			color(isDirty ? COLORS.gitDirty : COLORS.gitClean),
			icon(glyphs.branch, text),
		);
	}
	if (id === 'context_pct') {
		if (inputs.contextPercent === undefined) return undefined;
		const percent = Math.round(inputs.contextPercent);
		return paint(
			contextColor(percent),
			icon(glyphs.context, `${percent}%`),
		);
	}
	if (id === 'token_in')
		return paint(
			COLORS.muted,
			icon(glyphs.input, formatTokens(inputs.tokensIn)),
		);
	if (id === 'token_out')
		return paint(
			COLORS.muted,
			icon(glyphs.output, formatTokens(inputs.tokensOut)),
		);
	if (id === 'token_total')
		return paint(
			COLORS.muted,
			icon(
				glyphs.tokens,
				formatTokens(inputs.tokensIn + inputs.tokensOut),
			),
		);
	if (id === 'cache_read') {
		if (inputs.cacheRead === 0) return undefined;
		return paint(
			COLORS.muted,
			icon(glyphs.cache, formatTokens(inputs.cacheRead)),
		);
	}
	const hours = String(inputs.now.getHours()).padStart(2, '0');
	const minutes = String(inputs.now.getMinutes()).padStart(2, '0');
	return paint(COLORS.muted, icon(glyphs.time, `${hours}:${minutes}`));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape byte is the point.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function visibleLength(text: string): number {
	return [...text.replace(ANSI_PATTERN, '')].length;
}

/**
 * The whole row: left segments joined by the preset's separator, right segments pushed to the
 * edge. Segments drop from the end of each side until the row fits `width`.
 */
export function renderRow(params: {
	readonly inputs: StatusInputs;
	readonly preset: Preset;
	readonly isNerd: boolean;
	readonly width: number;
}): string {
	const glyphs = params.isNerd ? NERD_GLYPHS : ASCII_GLYPHS;
	const render = (ids: readonly SegmentId[]): string[] =>
		ids.flatMap(id => {
			const text = renderSegment({
				id,
				inputs: params.inputs,
				preset: params.preset,
				glyphs,
				isNerd: params.isNerd,
			});
			return text ? [text] : [];
		});
	const separator = paint(
		COLORS.separator,
		` ${glyphs.separators[params.preset.separator]} `,
	);
	const join = (parts: readonly string[]): string => parts.join(separator);
	let left = render(params.preset.left);
	let right = render(params.preset.right);
	const total = (): number =>
		visibleLength(join(left)) +
		visibleLength(join(right)) +
		(right.length > 0 ? 1 : 0);
	while (total() > params.width && (left.length > 1 || right.length > 0)) {
		if (right.length > 0) right = right.slice(0, -1);
		else left = left.slice(0, -1);
	}
	if (right.length === 0) return join(left);
	const gap = Math.max(
		1,
		params.width - visibleLength(join(left)) - visibleLength(join(right)),
	);
	return `${join(left)}${' '.repeat(gap)}${join(right)}`;
}

// ── the mod ──────────────────────────────────────────────────────────────────────────────────

type Placement = 'above-editor' | 'below-editor';

interface Settings {
	readonly preset: string;
	readonly placement: Placement;
	readonly isEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	preset: 'default',
	placement: 'above-editor',
	isEnabled: true,
};
const GIT_TTL_MS = 1000;
// Tools that can change the working tree: a git status cached before them is stale.
const WRITING_TOOLS: ReadonlySet<string> = new Set([
	'edit_file',
	'write_file',
	'shell_command',
	'codemode',
]);

/** The placement a `/powerline placement <word>` asks for; undefined for an unknown word. */
export function parsePlacement(params: {
	readonly word: string | undefined;
	readonly current: Placement;
}): Placement | undefined {
	if (params.word === 'above') return 'above-editor';
	if (params.word === 'below') return 'below-editor';
	if (params.word !== 'toggle') return undefined;
	return params.current === 'above-editor' ? 'below-editor' : 'above-editor';
}

function readSettings(value: unknown): Settings {
	if (!value || typeof value !== 'object') return DEFAULT_SETTINGS;
	const raw = value as Partial<Settings>;
	return {
		preset:
			typeof raw.preset === 'string' && PRESETS[raw.preset]
				? raw.preset
				: DEFAULT_SETTINGS.preset,
		placement:
			raw.placement === 'below-editor' ? 'below-editor' : 'above-editor',
		isEnabled: raw.isEnabled !== false,
	};
}

function isAgentEvent(event: AgentEvent | ModHostEvent): event is AgentEvent {
	return event.type !== 'session_start' && event.type !== 'session_shutdown';
}

export default function powerlineStatus(cmd: ModApi): void {
	const env = process.env;
	const isNerd = hasNerdFonts(env);
	const home = env.HOME ?? env.USERPROFILE ?? '';
	const host = hostname().split('.')[0] ?? 'host';
	let settings = readSettings(cmd.store.get('settings'));
	let git: GitStatus | undefined;
	let gitCheckedAt = 0;
	let gitPending = false;
	let tokens = {input: 0, output: 0, cacheRead: 0};
	let widget: Disposable | undefined;

	const refreshGit = async (): Promise<void> => {
		if (gitPending) return;
		gitPending = true;
		try {
			const result = await cmd.exec({
				command: 'git',
				args: ['status', '--porcelain=v1', '--branch'],
			});
			git = result.code === 0 ? parseGitStatus(result.stdout) : undefined;
		} catch {
			git = undefined;
		} finally {
			gitCheckedAt = Date.now();
			gitPending = false;
			cmd.ui.refreshWidgets();
		}
	};

	const inputs = (): StatusInputs => {
		if (Date.now() - gitCheckedAt > GIT_TTL_MS) void refreshGit();
		const usage = cmd.getContextUsage();
		const model = cmd.getModel();
		const effort = cmd.getEffort();
		return {
			...(model ? {model} : {}),
			...(effort ? {effort} : {}),
			cwd: cmd.cwd,
			home,
			...(git ? {git} : {}),
			...(usage?.percent !== null && usage?.percent !== undefined
				? {contextPercent: usage.percent}
				: {}),
			tokensIn: tokens.input,
			tokensOut: tokens.output,
			cacheRead: tokens.cacheRead,
			host,
			now: new Date(),
		};
	};

	const mount = (): void => {
		widget?.dispose();
		widget = undefined;
		if (!settings.isEnabled) return;
		widget = cmd.ui.widget({
			placement: settings.placement,
			render: ({width}) => [
				renderRow({
					inputs: inputs(),
					preset:
						PRESETS[settings.preset] ?? (PRESETS.default as Preset),
					isNerd,
					width,
				}),
			],
		});
	};

	const saveSettings = (next: Settings): void => {
		settings = next;
		// A failed write keeps the setting for this session; never an unhandled rejection.
		cmd.store.set('settings', next).catch(() => {});
		mount();
	};

	mount();

	const onEvent = (event: AgentEvent): void => {
		if (event.type === 'model_request_end') {
			const cacheRead = event.usage.cacheReadTokens;
			tokens = {
				input:
					tokens.input +
					Math.max(
						0,
						event.usage.inputTokens -
							cacheRead -
							event.usage.cacheWriteTokens,
					),
				output: tokens.output + event.usage.outputTokens,
				cacheRead: tokens.cacheRead + cacheRead,
			};
			cmd.ui.refreshWidgets();
			return;
		}
		if (event.type === 'tool_completed' || event.type === 'tool_errored') {
			if (WRITING_TOOLS.has(event.toolName)) gitCheckedAt = 0;
			cmd.ui.refreshWidgets();
			return;
		}
		cmd.ui.refreshWidgets();
	};
	for (const type of [
		'model_request_end',
		'tool_completed',
		'tool_errored',
		'turn_end',
		'run_end',
		'permission_mode_changed',
	] as const) {
		cmd.on(type, event => {
			if (isAgentEvent(event)) onEvent(event);
		});
	}
	// Repaint the clock and pick up git changes made outside the agent.
	cmd.clock.every(30_000, () => {
		gitCheckedAt = 0;
		cmd.ui.refreshWidgets();
	});

	cmd.addCommand({
		name: 'powerline',
		description:
			'Switch the powerline preset, turn it on or off, or move it above or below the prompt',
		argumentHint: '[preset|on|off|placement above|below|toggle]',
		handler: ({args}) => {
			const words = args
				.trim()
				.toLowerCase()
				.split(/\s+/)
				.filter(Boolean);
			const [first, second] = words;
			if (!first) {
				saveSettings({...settings, isEnabled: !settings.isEnabled});
				return {
					message: `Powerline ${settings.isEnabled ? 'on' : 'off'}.`,
				};
			}
			if (first === 'on' || first === 'off') {
				saveSettings({...settings, isEnabled: first === 'on'});
				return {message: `Powerline ${first}.`};
			}
			if (first === 'placement') {
				const next = parsePlacement({
					word: second,
					current: settings.placement,
				});
				if (!next)
					return {
						message:
							'Usage: /powerline placement above|below|toggle',
					};
				saveSettings({...settings, placement: next, isEnabled: true});
				return {
					message: `Powerline ${next === 'above-editor' ? 'above' : 'below'} the prompt.`,
				};
			}
			if (!PRESETS[first])
				return {
					message: `Unknown preset "${first}". Presets: ${Object.keys(PRESETS).join(', ')}.`,
				};
			saveSettings({...settings, preset: first, isEnabled: true});
			return {message: `Powerline preset: ${first}.`};
		},
	});
}
