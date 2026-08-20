const URL_VARIABLE_VALUES = new WeakSet<object>();

function decodeFormComponent(value: string): string {
    return decodeURIComponent(value.replace(/\+/g, " "));
}

function encodeFormComponent(value: unknown): string {
    return encodeURIComponent(String(value))
        .replace(/[!'()~]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/%20/g, "+");
}

/** @internal Read-only nominal proof for canonical Flash URLVariables values. */
export function isFlashURLVariables(value: unknown): value is URLVariables {
    return typeof value === "object" && value !== null && URL_VARIABLE_VALUES.has(value);
}

/**
 * Source-shaped form data object. Dynamic own properties are the form fields;
 * duplicate decoded names are retained as arrays and serialize as repeated
 * pairs rather than being silently collapsed.
 */
export class URLVariables {
    [name: string]: unknown;

    constructor(source: string | null = null) {
        URL_VARIABLE_VALUES.add(this);
        if (source !== null) this.decode(source);
    }

    decode(source: string): void {
        if (typeof source !== "string") throw new TypeError("URLVariables.decode requires a string");
        if (source.length === 0) return;
        for (const pair of source.split("&")) {
            const separator = pair.indexOf("=");
            const name = decodeFormComponent(separator < 0 ? pair : pair.slice(0, separator));
            const value = decodeFormComponent(separator < 0 ? "" : pair.slice(separator + 1));
            const descriptor = Object.getOwnPropertyDescriptor(this, name);
            const previous = descriptor?.value;
            const next = descriptor
                ? Array.isArray(previous) ? [...previous, value] : [previous, value]
                : value;
            Object.defineProperty(this, name, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: next,
            });
        }
    }

    toString(): string {
        const pairs: string[] = [];
        for (const name of Object.keys(this)) {
            const descriptor = Object.getOwnPropertyDescriptor(this, name);
            if (!descriptor || !("value" in descriptor))
                throw new TypeError(`URLVariables field ${name} must be an own data property`);
            const value = descriptor.value;
            const values = Array.isArray(value) ? value : [value];
            for (let index = 0; index < values.length; index++) {
                const itemDescriptor = Array.isArray(value)
                    ? Object.getOwnPropertyDescriptor(value, String(index))
                    : null;
                if (Array.isArray(value) && (!itemDescriptor || !("value" in itemDescriptor)))
                    throw new TypeError(`URLVariables field ${name}[${index}] must be a dense data element`);
                const item = itemDescriptor && "value" in itemDescriptor ? itemDescriptor.value : values[index];
                pairs.push(`${encodeFormComponent(name)}=${encodeFormComponent(item)}`);
            }
        }
        return pairs.join("&");
    }
}
