import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { AuthoredContentToolError } from "../types.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });

export function sha256(value: Uint8Array | string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function decodeUtf8(bytes: Uint8Array, label: string): string {
    let text: string;
    try {
        text = UTF8.decode(bytes);
    }
    catch (error) {
        throw new AuthoredContentToolError("AUTHORED_CONTENT_UTF8_INVALID", `${label} must be valid UTF-8.`, { cause: error });
    }
    if (text.charCodeAt(0) === 0xfeff)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_UTF8_BOM", `${label} must not contain a byte-order mark.`);
    return text;
}

export function canonicalLfSha256(bytes: Uint8Array, label: string): string {
    return sha256(decodeUtf8(bytes, label).replace(/\r\n?/g, "\n"));
}

export function canonicalJson(value: unknown): string {
    return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function canonicalJsonSha256(value: unknown): string {
    return sha256(canonicalJson(value));
}

export async function readStrictJson(path: string, label: string, requireLf = false): Promise<unknown> {
    const bytes = await readFile(path);
    return parseStrictJsonBytes(bytes, label, requireLf);
}

export function parseStrictJsonBytes(bytes: Uint8Array, label: string, requireLf = false): unknown {
    let text = decodeUtf8(bytes, label);
    if (requireLf && text.includes("\r"))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_JSON_CR", `${label} must use LF line endings.`);
    text = text.replace(/\r\n?/g, "\n");
    scanJson(text, label);
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new AuthoredContentToolError("AUTHORED_CONTENT_JSON_INVALID", `${label} is invalid JSON.`, { cause: error });
    }
}

function canonicalValue(value: unknown): unknown {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new AuthoredContentToolError("AUTHORED_CONTENT_CANONICAL_NUMBER", "Canonical JSON numbers must be finite.");
        return value;
    }
    if (Array.isArray(value))
        return value.map(canonicalValue);
    if (typeof value === "object") {
        const source = value as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort()) {
            if (source[key] === undefined)
                throw new AuthoredContentToolError("AUTHORED_CONTENT_CANONICAL_UNDEFINED", `Canonical JSON property ${key} is undefined.`);
            output[key] = canonicalValue(source[key]);
        }
        return output;
    }
    throw new AuthoredContentToolError("AUTHORED_CONTENT_CANONICAL_TYPE", `Canonical JSON cannot encode ${typeof value}.`);
}

function scanJson(text: string, label: string): void {
    let cursor = 0;
    const fail = (message: string): never => {
        throw new AuthoredContentToolError("AUTHORED_CONTENT_JSON_INVALID", `${label}: ${message} at byte ${cursor}.`);
    };
    const whitespace = () => {
        while (cursor < text.length && /[\u0009\u000a\u0020]/.test(text[cursor])) cursor++;
    };
    const string = (): string => {
        if (text[cursor] !== '"') fail("expected string");
        const start = cursor++;
        while (cursor < text.length) {
            const character = text[cursor++];
            if (character === '"') {
                try { return JSON.parse(text.slice(start, cursor)); }
                catch { fail("invalid string"); }
            }
            if (character === "\\") {
                if (cursor >= text.length) fail("unterminated escape");
                const escaped = text[cursor++];
                if (escaped === "u") {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor, cursor + 4))) fail("invalid Unicode escape");
                    cursor += 4;
                }
                else if (!'"\\/bfnrt'.includes(escaped)) fail("invalid escape");
            }
            else if (character.charCodeAt(0) < 0x20) fail("unescaped control character");
        }
        return fail("unterminated string");
    };
    const value = (): void => {
        whitespace();
        const character = text[cursor];
        if (character === "{") return object();
        if (character === "[") return array();
        if (character === '"') { string(); return; }
        const remainder = text.slice(cursor);
        const literal = /^(?:true|false|null)/.exec(remainder);
        if (literal) { cursor += literal[0].length; return; }
        const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
        if (number) { cursor += number[0].length; return; }
        fail("expected value");
    };
    const object = (): void => {
        cursor++;
        whitespace();
        const keys = new Set<string>();
        if (text[cursor] === "}") { cursor++; return; }
        while (cursor < text.length) {
            whitespace();
            const key = string();
            if (keys.has(key))
                throw new AuthoredContentToolError("AUTHORED_CONTENT_JSON_DUPLICATE_KEY", `${label} contains duplicate object key ${JSON.stringify(key)}.`);
            keys.add(key);
            whitespace();
            if (text[cursor++] !== ":") fail("expected colon");
            value();
            whitespace();
            const separator = text[cursor++];
            if (separator === "}") return;
            if (separator !== ",") fail("expected comma or object end");
        }
        fail("unterminated object");
    };
    const array = (): void => {
        cursor++;
        whitespace();
        if (text[cursor] === "]") { cursor++; return; }
        while (cursor < text.length) {
            value();
            whitespace();
            const separator = text[cursor++];
            if (separator === "]") return;
            if (separator !== ",") fail("expected comma or array end");
        }
        fail("unterminated array");
    };
    whitespace();
    value();
    whitespace();
    if (cursor !== text.length) fail("trailing content");
}
