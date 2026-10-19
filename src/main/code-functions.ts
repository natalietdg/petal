// Splits one file change into the functions it touched, by parsing the file before and after with @babel/parser.
// TS and JS only; anything else, or a file that won't parse, stays one hunk with a label saying why.
import { parse, type ParserPlugin } from '@babel/parser';
import type { CardKind } from '../shared/code-review';

export interface SplitCard {
  name: string;
  kind: CardKind;
  before: string;
  after: string;
  note: string | null;
}

// A named top-level unit: a function, a method, or a function-valued const or property.
export interface Unit {
  name: string;
  start: number;
  end: number;
}

// The few AST fields read here; Babel's own types live in @babel/types, which Petal doesn't depend on.
interface AstNode {
  type: string;
  start?: number | null;
  end?: number | null;
  [field: string]: unknown;
}

const MAX_LINES = 300; // per side of a card, so a huge function can't swamp the page or the prompt
const HUNK_CONTEXT = 3;

const PLUGINS: Record<string, ParserPlugin[]> = {
  ts: ['typescript', 'decorators-legacy'],
  mts: ['typescript', 'decorators-legacy'],
  cts: ['typescript', 'decorators-legacy'],
  tsx: ['typescript', 'jsx', 'decorators-legacy'],
  js: ['jsx'],
  jsx: ['jsx'],
  mjs: ['jsx'],
  cjs: ['jsx'],
};

export const pluginsFor = (file: string): ParserPlugin[] | null => PLUGINS[file.split('.').pop()?.toLowerCase() ?? ''] ?? null;

const isNode = (value: unknown): value is AstNode => typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
const child = (node: AstNode, field: string): AstNode | null => (isNode(node[field]) ? node[field] as AstNode : null);
const children = (node: AstNode, field: string): AstNode[] => (Array.isArray(node[field]) ? (node[field] as unknown[]).filter(isNode) : []);

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression']);
const WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression']);

// A function, or a call wrapping one (memo(() => …)), under any TS casts.
function isFunctionLike(node: AstNode | null): boolean {
  if (!node) return false;
  if (WRAPPERS.has(node.type)) return isFunctionLike(child(node, 'expression'));
  if (FUNCTION_TYPES.has(node.type)) return true;
  return node.type === 'CallExpression' && children(node, 'arguments').some((arg) => FUNCTION_TYPES.has(arg.type));
}

function keyName(key: AstNode | null, code: string): string {
  if (!key) return '?';
  if (key.type === 'Identifier') return String(key.name);
  if (key.type === 'PrivateName') return `#${String(child(key, 'id')?.name ?? '')}`;
  if (key.type === 'StringLiteral' || key.type === 'NumericLiteral') return String(key.value);
  return `[${code.slice(key.start ?? 0, key.end ?? 0)}]`;
}

const span = (node: AstNode): { start: number; end: number } => {
  const comments = Array.isArray(node.leadingComments) ? node.leadingComments as AstNode[] : [];
  return { start: Math.min(node.start ?? 0, ...comments.map((c) => c.start ?? Infinity)), end: node.end ?? 0 };
};

function classUnits(owner: string, body: AstNode | null, code: string): Unit[] {
  return children(body ?? { type: 'none' }, 'body').flatMap((member) => {
    const name = `${owner}.${keyName(child(member, 'key'), code)}`;
    if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
      const kind = member.kind === 'get' || member.kind === 'set' ? ` (${String(member.kind)})` : '';
      return [{ name: `${name}${kind}`, ...span(member) }];
    }
    if ((member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty') && isFunctionLike(child(member, 'value'))) return [{ name, ...span(member) }];
    return [];
  });
}

function objectUnits(owner: string, object: AstNode, code: string): Unit[] {
  return children(object, 'properties').flatMap((prop) => {
    const name = `${owner}.${keyName(child(prop, 'key'), code)}`;
    if (prop.type === 'ObjectMethod' || (prop.type === 'ObjectProperty' && isFunctionLike(child(prop, 'value')))) return [{ name, ...span(prop) }];
    return [];
  });
}

// whole: the statement's span with any export keyword and comment, used when it declares just one name.
function declaratorUnits(statement: AstNode, code: string, whole: { start: number; end: number }): Unit[] {
  const declarators = children(statement, 'declarations');
  return declarators.flatMap((declarator) => {
    const id = child(declarator, 'id');
    const init = child(declarator, 'init');
    if (id?.type !== 'Identifier' || !init) return [];
    const name = String(id.name);
    const range = declarators.length === 1 ? whole : span(declarator);
    if (isFunctionLike(init)) return [{ name, ...range }];
    if (init.type === 'ClassExpression') return classUnits(name, child(init, 'body'), code);
    if (init.type === 'ObjectExpression') return objectUnits(name, init, code);
    return [];
  });
}

// `exports.x = () => …`, `Foo.prototype.y = function…`, and top-level calls handed a function (describe, it, app.on).
function expressionUnits(statement: AstNode, code: string): Unit[] {
  const expression = child(statement, 'expression');
  if (!expression) return [];
  const text = (node: AstNode | null) => (node ? code.slice(node.start ?? 0, node.end ?? 0) : '');
  if (expression.type === 'AssignmentExpression' && isFunctionLike(child(expression, 'right'))) return [{ name: text(child(expression, 'left')), ...span(statement) }];
  if (expression.type === 'CallExpression' && isFunctionLike(expression)) {
    const label = children(expression, 'arguments').find((arg) => arg.type === 'StringLiteral');
    const callee = text(child(expression, 'callee'));
    return callee.length <= 60 ? [{ name: label ? `${callee}('${String(label.value)}')` : `${callee}(…)`, ...span(statement) }] : [];
  }
  return [];
}

function statementUnits(outer: AstNode, code: string): Unit[] {
  const exported = outer.type === 'ExportNamedDeclaration' || outer.type === 'ExportDefaultDeclaration';
  const statement = exported ? child(outer, 'declaration') ?? outer : outer;
  const range = span(outer);
  switch (statement.type) {
    case 'FunctionDeclaration': return [{ name: String(child(statement, 'id')?.name ?? 'default export'), ...range }];
    case 'ClassDeclaration': return classUnits(String(child(statement, 'id')?.name ?? 'default export'), child(statement, 'body'), code);
    case 'VariableDeclaration': return declaratorUnits(statement, code, range);
    case 'ExpressionStatement': return expressionUnits(statement, code);
    default: return isFunctionLike(statement) ? [{ name: 'default export', ...range }] : []; // export default () => …
  }
}

// Named units in source order, a repeated name numbered (#2, #3); null when the code doesn't parse.
export function functionUnits(code: string, plugins: ParserPlugin[]): Unit[] | null {
  let program: AstNode;
  try {
    program = parse(code, { sourceType: 'unambiguous', plugins, errorRecovery: true }).program as unknown as AstNode;
  } catch {
    return null;
  }
  const seen = new Map<string, number>();
  return children(program, 'body').flatMap((s) => statementUnits(s, code)).map((unit) => {
    const count = (seen.get(unit.name) ?? 0) + 1;
    seen.set(unit.name, count);
    return count > 1 ? { ...unit, name: `${unit.name}#${count}` } : unit;
  });
}

const capLines = (text: string): string => {
  const lines = text.split('\n');
  return lines.length > MAX_LINES ? `${lines.slice(0, MAX_LINES).join('\n')}\n… ${lines.length - MAX_LINES} more lines` : text;
};

// What's left of the file once every unit is cut out: imports, types, constants, top-level calls.
const moduleText = (code: string, units: readonly Unit[]): string => {
  let out = '';
  let at = 0;
  for (const unit of [...units].sort((a, b) => a.start - b.start)) {
    if (unit.start < at) continue; // nested inside one already cut
    out += code.slice(at, unit.start);
    at = unit.end;
  }
  return (out + code.slice(at)).split('\n').map((line) => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

// The changed stretch of two texts with a few lines either side; for module-level and hunk cards.
export function changedWindow(before: string, after: string, context = HUNK_CONTEXT): { before: string; after: string } {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const from = Math.max(0, head - context);
  const cut = (lines: string[]) => lines.slice(from, Math.min(lines.length, lines.length - tail + context)).join('\n');
  return { before: capLines(cut(a)), after: capLines(cut(b)) };
}

export const hunkCard = (before: string, after: string, note: string): SplitCard => ({ name: 'Changed lines', kind: 'hunk', ...changedWindow(before, after), note });

// One file's change as cards: each unit whose text differs, then the module level if anything outside units changed.
export function splitChange(file: string, before: string, after: string): SplitCard[] {
  const plugins = pluginsFor(file);
  if (!plugins) return [hunkCard(before, after, 'Not split into functions: Petal parses TypeScript and JavaScript only.')];
  const unitsBefore = functionUnits(before, plugins);
  const unitsAfter = functionUnits(after, plugins);
  if (!unitsBefore || !unitsAfter) return [hunkCard(before, after, 'Not split into functions: the file didn’t parse.')];
  const textOf = (code: string, units: Unit[]) => new Map(units.map((u) => [u.name, code.slice(u.start, u.end)]));
  const was = textOf(before, unitsBefore);
  const now = textOf(after, unitsAfter);
  const names = [...new Set([...unitsAfter.map((u) => u.name), ...unitsBefore.map((u) => u.name)])];
  const cards: SplitCard[] = names.flatMap((name) => {
    const b = was.get(name) ?? '';
    const a = now.get(name) ?? '';
    return a === b ? [] : [{ name, kind: 'function' as const, before: capLines(b), after: capLines(a), note: null }];
  });
  const moduleBefore = moduleText(before, unitsBefore);
  const moduleAfter = moduleText(after, unitsAfter);
  if (moduleBefore !== moduleAfter) cards.push({ name: 'Module level', kind: 'module', ...changedWindow(moduleBefore, moduleAfter), note: 'Imports, types and other top-level code outside any function.' });
  return cards;
}
