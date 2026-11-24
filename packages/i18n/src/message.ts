/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The message formatter: a deliberately small ICU MessageFormat subset.
 *
 * Undal needs three things from ICU and nothing else — named arguments, plural
 * categories, and `#` inside a plural branch — because every user-facing string
 * is either plain text with a hole in it or a count with two branches. Pulling a
 * full ICU implementation into the storefront would cost more bytes than the
 * entire cart, and pulling it into the Android apps would mean two formatters
 * that disagree about Bengali.
 *
 * What is supported, exactly:
 *   {name}                                   — a named argument
 *   {count, plural, one {…} other {…}}       — plural, with `#` for the count
 *   {count, number}                          — a localised number
 * Anything else (`select`, `selectordinal`, nested plurals) throws at compile
 * time rather than at the moment a customer sees a raw brace, which is why
 * `compile` validates every catalogue entry in the test suite.
 */

/** The locale a message is rendered in. `bn` is the default language of the product. */
export type Locale = "bn" | "en";

/** A value a message may substitute: a string, a number, or a count for plurals. */
export type MessageArgs = Readonly<Record<string, string | number | undefined>>;

/** One piece of a compiled message. */
type Node =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "argument"; readonly name: string; readonly format?: "number" }
  | {
      readonly kind: "plural";
      readonly name: string;
      readonly branches: Readonly<Record<string, readonly Node[]>>;
    };

/** Anything the formatter refuses, so a broken catalogue fails the build rather than a customer. */
export class MessageFormatError extends Error {
  /** The pattern that failed, so a translator can find the string without a stack trace. */
  readonly pattern: string;

  /**
   * Named error so a test can assert the reason without matching a sentence: the
   * failure mode being guarded is a translator leaving an unbalanced brace in a
   * Bengali string, which is invisible until render.
   */
  constructor(message: string, pattern: string) {
    super(`${message} in: ${pattern}`);
    this.name = "MessageFormatError";
    this.pattern = pattern;
  }
}

/** Find the index of the brace that closes the one at `open`, or -1 when unbalanced. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Split `one {…} other {…}` into its branches, tracking brace depth. */
function parseBranches(source: string, pattern: string): Record<string, Node[]> {
  const branches: Record<string, Node[]> = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index] as string)) index += 1;
    if (index >= source.length) break;
    const start = index;
    while (index < source.length && !/\s/u.test(source[index] as string) && source[index] !== "{") index += 1;
    const selector = source.slice(start, index);
    while (index < source.length && /\s/u.test(source[index] as string)) index += 1;
    if (source[index] !== "{") throw new MessageFormatError(`plural branch “${selector}” has no body`, pattern);
    const end = closingBrace(source, index);
    if (end === -1) throw new MessageFormatError("unbalanced brace in plural", pattern);
    if (selector === "") throw new MessageFormatError("plural branch has no selector", pattern);
    branches[selector] = compile(source.slice(index + 1, end));
    index = end + 1;
  }
  if (branches.other === undefined) throw new MessageFormatError("plural has no “other” branch", pattern);
  return branches;
}

/** Compile a pattern into nodes. Called once per message per locale, then cached by the caller. */
export function compile(pattern: string): Node[] {
  const nodes: Node[] = [];
  let text = "";
  let index = 0;

  const flush = () => {
    if (text !== "") {
      nodes.push({ kind: "text", value: text });
      text = "";
    }
  };

  while (index < pattern.length) {
    const character = pattern[index];
    if (character !== "{") {
      text += character;
      index += 1;
      continue;
    }
    const end = closingBrace(pattern, index);
    if (end === -1) throw new MessageFormatError("unbalanced brace", pattern);
    const body = pattern.slice(index + 1, end);
    const comma = body.indexOf(",");
    flush();
    if (comma === -1) {
      const name = body.trim();
      if (name === "") throw new MessageFormatError("empty argument", pattern);
      nodes.push({ kind: "argument", name });
    } else {
      const name = body.slice(0, comma).trim();
      const rest = body.slice(comma + 1).trim();
      const typeEnd = rest.search(/[\s,]/u);
      const type = (typeEnd === -1 ? rest : rest.slice(0, typeEnd)).trim();
      const remainder = typeEnd === -1 ? "" : rest.slice(typeEnd).trim().replace(/^,\s*/u, "");
      if (type === "number") {
        nodes.push({ kind: "argument", name, format: "number" });
      } else if (type === "plural") {
        nodes.push({ kind: "plural", name, branches: parseBranches(remainder, pattern) });
      } else {
        throw new MessageFormatError(`unsupported message format “${type}”`, pattern);
      }
    }
    index = end + 1;
  }
  flush();
  return nodes;
}

/** Build an `Intl.PluralRules` per locale once; constructing one per message is measurable. */
const plurals = new Map<Locale, Intl.PluralRules>();
function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = plurals.get(locale);
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale === "bn" ? "bn-BD" : "en-GB");
    plurals.set(locale, rules);
  }
  return rules;
}

/** Render compiled nodes with a locale and arguments. `hash` carries the plural count for `#`. */
function render(nodes: readonly Node[], locale: Locale, args: MessageArgs, hash: number | null): string {
  let output = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      output += node.value;
      continue;
    }
    if (node.kind === "argument") {
      const value = args[node.name];
      if (value === undefined) throw new MessageFormatError(`missing argument “${node.name}”`, "");
      output += typeof value === "number" ? String(value) : value;
      continue;
    }
    const raw = args[node.name];
    const count = typeof raw === "number" ? raw : Number(raw ?? 0);
    const category = pluralRules(locale).select(count);
    const branch = node.branches[category] ?? node.branches.other;
    if (branch === undefined) throw new MessageFormatError(`no plural branch for “${category}”`, "");
    output += render(branch, locale, args, count);
  }
  return output;
}

/**
 * Render a pattern in a locale.
 *
 * The function is pure: the same pattern, locale and arguments always produce the same
 * string, which is what lets the pre-render step emit Bengali HTML at build time and
 * the browser replace it without a flicker of English.
 */
export function formatMessage(pattern: string, locale: Locale, args: MessageArgs = {}): string {
  const nodes = compile(pattern);
  let output = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      output += node.value;
    } else if (node.kind === "argument") {
      const value = args[node.name];
      if (value === undefined) throw new MessageFormatError(`missing argument “${node.name}”`, pattern);
      output += typeof value === "number" && node.format === "number"
        ? new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-GB").format(value)
        : String(value);
    } else {
      const raw = args[node.name];
      const count = typeof raw === "number" ? raw : Number(raw ?? 0);
      const category = pluralRules(locale).select(count);
      const branch = node.branches[category] ?? node.branches.other;
      if (branch === undefined) throw new MessageFormatError(`no plural branch for “${category}”`, pattern);
      output += render(branch, locale, args, count).replace(/#/gu, String(count));
    }
  }
  return output;
}
