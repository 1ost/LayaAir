import { resolveAliasForClass, resolveClassAlias } from "../net/ClassAlias";

type EncodedValue = ["null"] | ["undefined"] | ["boolean", boolean] | ["number", string]
    | ["string", string] | ["reference", number];

interface EncodedRecord {
    kind: "array" | "date" | "object";
    length?: number;
    value?: string;
    alias?: string | null;
    properties?: Array<[string, EncodedValue]>;
}

interface EncodedEnvelope {
    format: "laya-flash-object@1";
    root: EncodedValue;
    records: EncodedRecord[];
}

function encodeNumber(value: number): string {
    if (Number.isNaN(value)) return "nan";
    if (value === Infinity) return "+infinity";
    if (value === -Infinity) return "-infinity";
    if (Object.is(value, -0)) return "-0";
    return String(value);
}

function decodeNumber(value: string): number {
    if (value === "nan") return NaN;
    if (value === "+infinity") return Infinity;
    if (value === "-infinity") return -Infinity;
    if (value === "-0") return -0;
    const decoded = Number(value);
    if (!Number.isFinite(decoded)) throw new TypeError("Malformed encoded number");
    return decoded;
}

function defineEnumerable(target: object, key: string, value: unknown): void {
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}

/** @internal Deterministic native object graph codec used by ByteArray object I/O. */
export function encodeNativeObject(value: unknown): Uint8Array {
    const records: EncodedRecord[] = [];
    const seen = new Map<object, number>();

    const encode = (current: unknown): EncodedValue => {
        if (current === null) return ["null"];
        if (current === undefined) return ["undefined"];
        if (typeof current === "boolean") return ["boolean", current];
        if (typeof current === "number") return ["number", encodeNumber(current)];
        if (typeof current === "string") return ["string", current];
        if ((typeof current !== "object" && typeof current !== "function")
            || typeof current === "function")
            throw new TypeError(`ByteArray object encoding does not support ${typeof current}`);

        const object = current as object;
        const prior = seen.get(object);
        if (prior !== undefined) return ["reference", prior];
        const identifier = records.length;
        seen.set(object, identifier);
        records.push({ kind: "object" });

        if (Array.isArray(object)) {
            records[identifier] = {
                kind: "array",
                length: object.length,
                properties: Object.keys(object).map(key => [key, encode((object as unknown as Record<string, unknown>)[key])]),
            };
        } else if (object instanceof Date) {
            const timestamp = object.getTime();
            records[identifier] = { kind: "date", value: Number.isNaN(timestamp) ? "nan" : String(timestamp) };
        } else {
            const constructor = Object.getPrototypeOf(object)?.constructor;
            const alias = typeof constructor === "function" ? resolveAliasForClass(constructor) : null;
            records[identifier] = {
                kind: "object",
                alias,
                properties: Object.keys(object).map(key => [key, encode((object as Record<string, unknown>)[key])]),
            };
        }
        return ["reference", identifier];
    };

    const envelope: EncodedEnvelope = { format: "laya-flash-object@1", root: encode(value), records };
    return new TextEncoder().encode(JSON.stringify(envelope));
}

/** @internal Decodes only the exact native object envelope emitted above. */
export function decodeNativeObject(bytes: Uint8Array): unknown {
    let envelope: EncodedEnvelope;
    try {
        envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as EncodedEnvelope;
    } catch (error) {
        throw new TypeError(`Malformed ByteArray object payload: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!envelope || envelope.format !== "laya-flash-object@1" || !Array.isArray(envelope.records))
        throw new TypeError("Malformed ByteArray object envelope");

    const objects: object[] = envelope.records.map(record => {
        if (!record || typeof record !== "object") throw new TypeError("Malformed ByteArray object record");
        if (record.kind === "array") {
            if (!Number.isSafeInteger(record.length) || record.length! < 0) throw new TypeError("Malformed array length");
            return new Array(record.length);
        }
        if (record.kind === "date") {
            if (typeof record.value !== "string") throw new TypeError("Malformed date record");
            const value = record.value === "nan" ? NaN : Number(record.value);
            if (record.value !== "nan" && !Number.isFinite(value)) throw new TypeError("Malformed date value");
            return new Date(value);
        }
        if (record.kind === "object") {
            if (record.alias === null || record.alias === undefined) return {};
            if (typeof record.alias !== "string") throw new TypeError("Malformed class alias");
            const constructor = resolveClassAlias(record.alias);
            if (!constructor) throw new ReferenceError(`No class is registered for alias ${record.alias}`);
            return Object.create(constructor.prototype) as object;
        }
        throw new TypeError("Unknown ByteArray object record kind");
    });

    const decode = (encoded: EncodedValue): unknown => {
        if (!Array.isArray(encoded)) throw new TypeError("Malformed encoded value");
        if (encoded[0] === "null") return null;
        if (encoded[0] === "undefined") return undefined;
        if (encoded[0] === "boolean") {
            if (typeof encoded[1] !== "boolean") throw new TypeError("Malformed boolean value");
            return encoded[1];
        }
        if (encoded[0] === "number") {
            if (typeof encoded[1] !== "string") throw new TypeError("Malformed number value");
            return decodeNumber(encoded[1]);
        }
        if (encoded[0] === "string") {
            if (typeof encoded[1] !== "string") throw new TypeError("Malformed string value");
            return encoded[1];
        }
        if (encoded[0] === "reference") {
            const identifier = encoded[1];
            if (!Number.isSafeInteger(identifier) || identifier < 0 || identifier >= objects.length)
                throw new TypeError("Malformed object reference");
            return objects[identifier];
        }
        throw new TypeError("Unknown encoded value kind");
    };

    envelope.records.forEach((record, index) => {
        if (record.kind === "date") return;
        if (!Array.isArray(record.properties)) throw new TypeError("Malformed object properties");
        const target = objects[index];
        for (const property of record.properties) {
            if (!Array.isArray(property) || property.length !== 2 || typeof property[0] !== "string")
                throw new TypeError("Malformed object property");
            if (Array.isArray(target) && property[0] === "length")
                throw new TypeError("Array length cannot be encoded as a dynamic property");
            defineEnumerable(target, property[0], decode(property[1]));
        }
    });
    return decode(envelope.root);
}
