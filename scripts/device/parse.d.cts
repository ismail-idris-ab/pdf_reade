// Types for parse.cjs (used by __tests__/scripts/ui-parse.test.ts).
export type Bounds = { x1: number; y1: number; x2: number; y2: number };
export type Point = { x: number; y: number };

export type UiNode = {
  index: number;
  depth: number;
  parent: number;
  text: string;
  desc: string;
  resourceId: string;
  cls: string;
  pkg: string;
  clickable: boolean;
  longClickable: boolean;
  enabled: boolean;
  focused: boolean;
  focusable: boolean;
  scrollable: boolean;
  selected: boolean;
  checked: boolean;
  bounds: Bounds;
  center: Point;
};

export type NodeQuery = {
  text?: string;
  desc?: string;
  label?: string;
  resourceId?: string;
  textContains?: string;
  descContains?: string;
  labelContains?: string;
  regex?: RegExp | string;
  textRegex?: RegExp | string;
  descRegex?: RegExp | string;
  cls?: string;
  clickable?: boolean;
  enabled?: boolean;
  focused?: boolean;
  where?: (node: UiNode) => boolean;
};

export type LogEntry = {
  date: string;
  time: string;
  pid: number;
  tid: number;
  level: string;
  tag: string;
  message: string;
  raw: string;
};

export type CrashLine = LogEntry & { kind: string };

export function decodeEntities(value: string): string;
export function parseBounds(value: string): Bounds | null;
export function centerOf(bounds: Bounds): Point;
export function parseDump(xml: string): { nodes: UiNode[]; rotation: number };
export function matches(node: UiNode, query: NodeQuery): boolean;
export function findNodes(nodes: readonly UiNode[], query: NodeQuery): UiNode[];
export function describeQuery(query: NodeQuery): string;
export function escapeInputText(value: string): string;
export function parseLogLine(line: string): LogEntry | null;
export function findCrashLines(
  logText: string,
  options: { pkg: string; pids?: readonly number[] },
): CrashLine[];
export function parseFocusedPackage(dumpsysText: string): string | null;
