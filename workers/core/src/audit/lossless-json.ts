/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { encodeAuditV2Value } from "./canonical-v2.ts";

// A 65,536-byte canonical value can take more space as JSON because of quoting and
// Unicode escapes. This is an input bound, not a promise that every string under it
// is an admissible canonical value; the canonical encoder applies the format limits.
const MAX_JSON_BYTES = 400_000;
const MAX_STRING_BYTES = 8_192;
const MAX_NODES = 2_048;
const MAX_DEPTH = 16;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991n;
const encoder = new TextEncoder();
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

function syntaxError(): never {
  throw new SyntaxError("invalid audit v2 JSON");
}

function assertScalarString(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new RangeError("invalid audit v2 JSON Unicode");
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new RangeError("invalid audit v2 JSON Unicode");
    }
  }
}

/**
 * Parse the bounded JSON subset used by the experimental audit v2 format.
 *
 * Number tokens are inspected before conversion: only safe integer literals are
 * accepted. Decimal/exponent spellings, negative zero and duplicate object keys
 * are rejected rather than normalized by an eager JSON-to-number decoder. This
 * function needs the original JSON text; an already-parsed object is not accepted.
 */
export function parseAuditV2Json(source: string): unknown {
  if (typeof source !== "string") throw new TypeError("audit v2 JSON must be raw text");
  if (source.length > MAX_JSON_BYTES) throw new RangeError("audit v2 JSON too large");
  assertScalarString(source);
  if (encoder.encode(source).length > MAX_JSON_BYTES)
    throw new RangeError("audit v2 JSON too large");

  let index = 0;
  let nodes = 0;

  function whitespace(): void {
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) index++;
      else return;
    }
  }

  function node(depth: number): void {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new RangeError("audit v2 JSON too complex");
  }

  function stringValue(): string {
    if (source.charCodeAt(index) !== 0x22) return syntaxError();
    index++;
    const chunks: string[] = [];
    let segmentStart = index;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x22) {
        chunks.push(source.slice(segmentStart, index));
        index++;
        const value = chunks.join("");
        assertScalarString(value);
        if (encoder.encode(value).length > MAX_STRING_BYTES)
          throw new RangeError("audit v2 JSON string too large");
        return value;
      }
      if (code < 0x20) return syntaxError();
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = source.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff))
          throw new RangeError("invalid audit v2 JSON Unicode");
        index += 2;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) throw new RangeError("invalid audit v2 JSON Unicode");
      if (code !== 0x5c) {
        index++;
        continue;
      }

      chunks.push(source.slice(segmentStart, index));
      index++;
      if (index >= source.length) return syntaxError();
      const escaped = source[index++]!;
      switch (escaped) {
        case '"':
          chunks.push('"');
          break;
        case "\\":
          chunks.push("\\");
          break;
        case "/":
          chunks.push("/");
          break;
        case "b":
          chunks.push("\b");
          break;
        case "f":
          chunks.push("\f");
          break;
        case "n":
          chunks.push("\n");
          break;
        case "r":
          chunks.push("\r");
          break;
        case "t":
          chunks.push("\t");
          break;
        case "u": {
          const first = hexCodeUnit(index);
          index += 4;
          if (first >= 0xd800 && first <= 0xdbff) {
            if (source.charCodeAt(index) !== 0x5c || source.charCodeAt(index + 1) !== 0x75) {
              throw new RangeError("invalid audit v2 JSON Unicode");
            }
            index += 2;
            const second = hexCodeUnit(index);
            if (second < 0xdc00 || second > 0xdfff)
              throw new RangeError("invalid audit v2 JSON Unicode");
            index += 4;
            chunks.push(String.fromCharCode(first, second));
          } else if (first >= 0xdc00 && first <= 0xdfff) {
            throw new RangeError("invalid audit v2 JSON Unicode");
          } else {
            chunks.push(String.fromCharCode(first));
          }
          break;
        }
        default:
          return syntaxError();
      }
      segmentStart = index;
    }
    return syntaxError();
  }

  function hexCodeUnit(start: number): number {
    if (start + 4 > source.length) return syntaxError();
    const digits = source.slice(start, start + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(digits)) return syntaxError();
    return Number.parseInt(digits, 16);
  }

  function numberValue(): number {
    const start = index;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (
        code === 0x20 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d ||
        code === 0x2c ||
        code === 0x5d ||
        code === 0x7d
      )
        break;
      index++;
    }
    const token = source.slice(start, index);
    if (!JSON_NUMBER.test(token)) return syntaxError();
    if (/[.eE]/u.test(token) || token === "-0")
      throw new RangeError("audit v2 JSON numbers must be safe integers");
    const digits = token[0] === "-" ? token.slice(1) : token;
    if (digits.length > 16) throw new RangeError("audit v2 JSON integer out of range");
    const exact = BigInt(token);
    if (exact > MAX_SAFE_INTEGER || exact < -MAX_SAFE_INTEGER)
      throw new RangeError("audit v2 JSON integer out of range");
    return Number(exact);
  }

  function value(depth: number): unknown {
    whitespace();
    node(depth);
    const code = source.charCodeAt(index);
    if (code === 0x22) return stringValue();
    if (code === 0x7b) {
      index++;
      whitespace();
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const keys = new Set<string>();
      if (source.charCodeAt(index) === 0x7d) {
        index++;
        return result;
      }
      while (true) {
        if (source.charCodeAt(index) !== 0x22) return syntaxError();
        node(depth + 1); // Object keys are values in the canonical grammar.
        const key = stringValue();
        if (keys.has(key)) throw new RangeError("duplicate audit v2 JSON object key");
        keys.add(key);
        whitespace();
        if (source.charCodeAt(index) !== 0x3a) return syntaxError();
        index++;
        const child = value(depth + 1);
        Object.defineProperty(result, key, {
          value: child,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        whitespace();
        if (source.charCodeAt(index) === 0x7d) {
          index++;
          return result;
        }
        if (source.charCodeAt(index) !== 0x2c) return syntaxError();
        index++;
        whitespace();
      }
    }
    if (code === 0x5b) {
      index++;
      whitespace();
      const result: unknown[] = [];
      if (source.charCodeAt(index) === 0x5d) {
        index++;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        whitespace();
        if (source.charCodeAt(index) === 0x5d) {
          index++;
          return result;
        }
        if (source.charCodeAt(index) !== 0x2c) return syntaxError();
        index++;
        whitespace();
      }
    }
    if (source.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (source.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (source.startsWith("null", index)) {
      index += 4;
      return null;
    }
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return numberValue();
    return syntaxError();
  }

  const parsed = value(0);
  whitespace();
  if (index !== source.length) return syntaxError();
  // Keep source and canonical bounds aligned: the parsed value must encode under
  // the exact same rules as any value passed directly to the v2 payload encoder.
  encodeAuditV2Value(parsed);
  return parsed;
}
