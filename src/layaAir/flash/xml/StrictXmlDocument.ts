/**
 * Explicit resource limits for {@link StrictXmlDocument.parse}.
 *
 * Limits are copied before parsing. The limits object must be a plain object
 * with data properties only; inherited values, accessors, symbols and unknown
 * keys are rejected without invoking user code.
 */
export interface StrictXmlLimits {
    /** Maximum UTF-16 source units before line-ending normalization. Default 1,048,576. */
    readonly maxSourceLength?: number;
    /** Maximum element nesting depth, counting the root as one. Default 128. */
    readonly maxDepth?: number;
    /** Maximum total element count. Default 50,000. */
    readonly maxElements?: number;
    /** Maximum total attribute count. Default 100,000. */
    readonly maxAttributes?: number;
    /** Maximum total element, text, CDATA and comment node count. Default 200,000. */
    readonly maxNodes?: number;
    /** Maximum aggregate decoded attribute and text/comment/CDATA UTF-16 units. Default 1,048,576. */
    readonly maxTextLength?: number;
}

/** The only XML declaration shape accepted by this resource parser. */
export interface StrictXmlDeclaration {
    readonly version: "1.0";
    readonly encoding: "UTF-8" | null;
    readonly standalone: boolean | null;
}

/** An immutable, source-ordered attribute. */
export interface StrictXmlAttribute {
    readonly name: string;
    readonly value: string;
}

/** A normal decoded text node. */
export interface StrictXmlText {
    readonly kind: "text";
    readonly value: string;
}

/** A CDATA node. Its value is not entity-decoded. */
export interface StrictXmlCData {
    readonly kind: "cdata";
    readonly value: string;
}

/** A comment node. Comments remain observable but have no parser side effects. */
export interface StrictXmlComment {
    readonly kind: "comment";
    readonly value: string;
}

/**
 * An immutable XML element. Arrays and returned traversal results are frozen.
 * Elements preserve source identity: repeated access returns the same objects.
 */
export interface StrictXmlElement {
    readonly kind: "element";
    readonly name: string;
    readonly attributes: readonly StrictXmlAttribute[];
    readonly childNodes: readonly StrictXmlNode[];
    readonly textContent: string;
    attribute(name: string): string | undefined;
    children(name?: string): readonly StrictXmlElement[];
    descendants(name?: string): readonly StrictXmlElement[];
}

export type StrictXmlNode = StrictXmlElement | StrictXmlText | StrictXmlCData | StrictXmlComment;
export type StrictXmlDocumentNode = StrictXmlElement | StrictXmlComment;

interface ResolvedLimits {
    maxSourceLength: number;
    maxDepth: number;
    maxElements: number;
    maxAttributes: number;
    maxNodes: number;
    maxTextLength: number;
}

interface ParsedDocument {
    declaration: StrictXmlDeclaration | null;
    childNodes: StrictXmlDocumentNode[];
    root: StrictXmlElement;
    prologComments: StrictXmlComment[];
    epilogComments: StrictXmlComment[];
}

const LIMIT_KEYS = Object.freeze([
    "maxSourceLength", "maxDepth", "maxElements", "maxAttributes", "maxNodes", "maxTextLength",
] as const);

const DEFAULT_LIMITS: Readonly<ResolvedLimits> = Object.freeze({
    maxSourceLength: 1_048_576,
    maxDepth: 128,
    maxElements: 50_000,
    maxAttributes: 100_000,
    maxNodes: 200_000,
    maxTextLength: 1_048_576,
});

class ImmutableElement implements StrictXmlElement {
    readonly kind = "element" as const;
    readonly name: string;
    readonly attributes: readonly StrictXmlAttribute[];
    readonly childNodes: readonly StrictXmlNode[];
    readonly textContent: string;

    constructor(name: string, attributes: StrictXmlAttribute[], childNodes: StrictXmlNode[]) {
        this.name = name;
        this.attributes = Object.freeze(attributes);
        this.childNodes = Object.freeze(childNodes);
        this.textContent = childNodes.map(node => node.kind === "element" ? node.textContent
            : node.kind === "comment" ? "" : node.value).join("");
        Object.freeze(this);
    }

    attribute(name: string): string | undefined {
        requireLookupName(name);
        return this.attributes.find(attribute => attribute.name === name)?.value;
    }

    children(name?: string): readonly StrictXmlElement[] {
        if (name !== undefined) requireLookupName(name);
        return Object.freeze(this.childNodes.filter((node): node is StrictXmlElement =>
            node.kind === "element" && (name === undefined || node.name === name)));
    }

    descendants(name?: string): readonly StrictXmlElement[] {
        if (name !== undefined) requireLookupName(name);
        const result: StrictXmlElement[] = [];
        const visit = (element: StrictXmlElement): void => {
            for (const node of element.childNodes) {
                if (node.kind !== "element") continue;
                if (name === undefined || node.name === name) result.push(node);
                visit(node);
            }
        };
        visit(this);
        return Object.freeze(result);
    }
}
Object.freeze(ImmutableElement.prototype);

/**
 * Strict immutable XML resource document for LayaAir integrations.
 *
 * This deliberately is not E4X. It provides no mutation, XMLList, namespace,
 * serialization, DTD or external-entity surface. It accepts XML 1.0 resources
 * with one root, optional UTF-8 declaration, comments, CDATA, ordered mixed
 * content, and predefined or numeric character references.
 */
export class StrictXmlDocument {
    readonly declaration: StrictXmlDeclaration | null;
    readonly childNodes: readonly StrictXmlDocumentNode[];
    readonly root: StrictXmlElement;
    readonly prologComments: readonly StrictXmlComment[];
    readonly epilogComments: readonly StrictXmlComment[];

    private constructor(
        declaration: StrictXmlDeclaration | null,
        childNodes: StrictXmlDocumentNode[],
        root: StrictXmlElement,
        prologComments: StrictXmlComment[],
        epilogComments: StrictXmlComment[],
    ) {
        this.declaration = declaration;
        this.childNodes = Object.freeze(childNodes);
        this.root = root;
        this.prologComments = Object.freeze(prologComments);
        this.epilogComments = Object.freeze(epilogComments);
        Object.freeze(this);
    }

    static parse(source: string, limits?: StrictXmlLimits): StrictXmlDocument {
        if (typeof source !== "string") throw new TypeError("XML source must be a primitive string");
        const resolved = resolveLimits(limits);
        if (source.length > resolved.maxSourceLength)
            throw new RangeError(`XML source exceeds maxSourceLength ${resolved.maxSourceLength}`);
        validateXmlCharacters(source);
        const normalized = source.replace(/\r\n?/g, "\n");
        const parsed = new StrictXmlParser(normalized, resolved).parse();
        return new StrictXmlDocument(
            parsed.declaration,
            parsed.childNodes,
            parsed.root,
            parsed.prologComments,
            parsed.epilogComments,
        );
    }
}
Object.freeze(StrictXmlDocument.prototype);
Object.freeze(StrictXmlDocument);

class StrictXmlParser {
    private position = 0;
    private elements = 0;
    private attributes = 0;
    private nodes = 0;
    private textLength = 0;

    constructor(private readonly source: string, private readonly limits: ResolvedLimits) { }

    parse(): ParsedDocument {
        if (this.source.charCodeAt(0) === 0xfeff) this.position++;
        const declaration = this.startsWith("<?xml") ? this.parseDeclaration() : null;
        const childNodes: StrictXmlDocumentNode[] = [];
        const prologComments: StrictXmlComment[] = [];
        const epilogComments: StrictXmlComment[] = [];
        let root: StrictXmlElement | null = null;

        while (true) {
            this.skipWhitespace();
            if (this.position === this.source.length) break;
            if (this.startsWith("<!--")) {
                const comment = this.parseComment();
                childNodes.push(comment);
                (root === null ? prologComments : epilogComments).push(comment);
                continue;
            }
            if (root !== null) this.fail("Unexpected trailing content after the root element");
            if (!this.startsWith("<")) this.fail("Text is not allowed outside the root element");
            if (this.startsWith("<?")) this.fail("Processing instructions are not supported");
            if (this.startsWith("<!")) this.fail("DTD and document declarations are not supported");
            root = this.parseElement(1);
            childNodes.push(root);
        }
        if (root === null) this.fail("XML document must contain exactly one root element");
        return { declaration, childNodes, root, prologComments, epilogComments };
    }

    private parseDeclaration(): StrictXmlDeclaration {
        if (this.position !== (this.source.charCodeAt(0) === 0xfeff ? 1 : 0))
            this.fail("XML declaration must be the first document construct");
        const end = this.source.indexOf("?>", this.position + 5);
        if (end < 0) this.fail("Unterminated XML declaration");
        const raw = this.source.slice(this.position, end + 2);
        const match = /^<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(['"])1\.0\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(['"])[Uu][Tt][Ff]-8\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(['"])(yes|no)\3)?[ \t\n]*\?>$/.exec(raw);
        if (!match) this.fail("Only an ordered XML 1.0 UTF-8 declaration is supported");
        this.position = end + 2;
        return Object.freeze({
            version: "1.0" as const,
            encoding: match[2] === undefined ? null : "UTF-8" as const,
            standalone: match[4] === undefined ? null : match[4].toLowerCase() === "yes",
        });
    }

    private parseElement(depth: number): StrictXmlElement {
        if (depth > this.limits.maxDepth) throw new RangeError(`XML exceeds maxDepth ${this.limits.maxDepth}`);
        this.accountElement();
        this.expect("<");
        const name = this.parseName("element");
        const attributes: StrictXmlAttribute[] = [];
        const seen = new Set<string>();

        while (true) {
            const hadWhitespace = this.skipWhitespace();
            if (this.consume("/>")) return new ImmutableElement(name, attributes, []);
            if (this.consume(">")) break;
            if (!hadWhitespace) this.fail("Whitespace is required before an attribute");
            const attributeName = this.parseName("attribute");
            if (seen.has(attributeName)) this.fail(`Duplicate attribute ${attributeName}`);
            seen.add(attributeName);
            this.skipWhitespace();
            this.expect("=");
            this.skipWhitespace();
            const quote = this.source[this.position];
            if (quote !== '"' && quote !== "'") this.fail("Attribute values must be quoted");
            this.position++;
            const start = this.position;
            while (this.position < this.source.length && this.source[this.position] !== quote) {
                if (this.source[this.position] === "<") this.fail("Attribute values cannot contain <");
                this.position++;
            }
            if (this.position === this.source.length) this.fail("Unterminated attribute value");
            // XML 1.0 normalizes literal attribute whitespace to spaces before
            // resolving character references. A referenced tab/LF/CR therefore
            // remains that referenced character rather than being normalized.
            const normalizedAttribute = this.source.slice(start, this.position).replace(/[\t\n]/g, " ");
            const value = this.decodeEntities(normalizedAttribute);
            this.position++;
            this.accountAttribute();
            this.accountText(value);
            attributes.push(Object.freeze({ name: attributeName, value }));
        }

        const childNodes: StrictXmlNode[] = [];
        while (true) {
            if (this.position >= this.source.length) this.fail(`Unterminated element ${name}`);
            if (this.startsWith("</")) {
                this.position += 2;
                const closingName = this.parseName("closing element");
                this.skipWhitespace();
                this.expect(">");
                if (closingName !== name) this.fail(`Closing element ${closingName} does not match ${name}`);
                return new ImmutableElement(name, attributes, childNodes);
            }
            if (this.startsWith("<!--")) {
                childNodes.push(this.parseComment());
                continue;
            }
            if (this.startsWith("<![CDATA[")) {
                childNodes.push(this.parseCData());
                continue;
            }
            if (this.startsWith("<?")) this.fail("Processing instructions are not supported");
            if (this.startsWith("<!")) this.fail("DTD and document declarations are not supported");
            if (this.startsWith("<")) {
                childNodes.push(this.parseElement(depth + 1));
                continue;
            }
            childNodes.push(this.parseText());
        }
    }

    private parseText(): StrictXmlText {
        const start = this.position;
        while (this.position < this.source.length && this.source[this.position] !== "<") this.position++;
        const raw = this.source.slice(start, this.position);
        if (raw.includes("]]>") ) this.fail("]]> is only valid as a CDATA terminator");
        const value = this.decodeEntities(raw);
        this.accountNode();
        this.accountText(value);
        return Object.freeze({ kind: "text" as const, value });
    }

    private parseCData(): StrictXmlCData {
        this.position += 9;
        const end = this.source.indexOf("]]>", this.position);
        if (end < 0) this.fail("Unterminated CDATA section");
        const value = this.source.slice(this.position, end);
        this.position = end + 3;
        this.accountNode();
        this.accountText(value);
        return Object.freeze({ kind: "cdata" as const, value });
    }

    private parseComment(): StrictXmlComment {
        this.position += 4;
        const end = this.source.indexOf("-->", this.position);
        if (end < 0) this.fail("Unterminated XML comment");
        const value = this.source.slice(this.position, end);
        if (value.includes("--") || value.endsWith("-")) this.fail("XML comments cannot contain -- or end with -");
        this.position = end + 3;
        this.accountNode();
        this.accountText(value);
        return Object.freeze({ kind: "comment" as const, value });
    }

    private parseName(label: string): string {
        const start = this.position;
        if (this.source[this.position] === ":") this.fail("XML namespace syntax is not supported");
        const first = this.source.codePointAt(this.position) ?? -1;
        if (!isNameStart(first)) this.fail(`Invalid ${label} name`);
        this.position += codePointWidth(first);
        while (true) {
            const codePoint = this.source.codePointAt(this.position) ?? -1;
            if (!isNameContinue(codePoint)) break;
            this.position += codePointWidth(codePoint);
        }
        if (this.source[this.position] === ":") this.fail("XML namespace syntax is not supported");
        const name = this.source.slice(start, this.position);
        if (name === "xmlns") this.fail("XML namespace declarations are not supported");
        return name;
    }

    private decodeEntities(raw: string): string {
        if (!raw.includes("&")) return raw;
        let output = "";
        let cursor = 0;
        while (cursor < raw.length) {
            const ampersand = raw.indexOf("&", cursor);
            if (ampersand < 0) return output + raw.slice(cursor);
            output += raw.slice(cursor, ampersand);
            const semicolon = raw.indexOf(";", ampersand + 1);
            if (semicolon < 0) this.fail("Unterminated entity reference");
            const reference = raw.slice(ampersand + 1, semicolon);
            const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
            if (Object.prototype.hasOwnProperty.call(predefined, reference)) output += predefined[reference];
            else if (/^#[0-9]+$/.test(reference) || /^#x[0-9a-fA-F]+$/.test(reference)) {
                const hexadecimal = reference[1] === "x";
                const digits = reference.slice(hexadecimal ? 2 : 1);
                const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
                if (!isXmlCodePoint(codePoint)) this.fail(`Invalid numeric character reference &${reference};`);
                output += String.fromCodePoint(codePoint);
            } else this.fail(`Unsupported entity reference &${reference};`);
            cursor = semicolon + 1;
        }
        return output;
    }

    private accountElement(): void {
        if (++this.elements > this.limits.maxElements)
            throw new RangeError(`XML exceeds maxElements ${this.limits.maxElements}`);
        this.accountNode();
    }

    private accountAttribute(): void {
        if (++this.attributes > this.limits.maxAttributes)
            throw new RangeError(`XML exceeds maxAttributes ${this.limits.maxAttributes}`);
    }

    private accountNode(): void {
        if (++this.nodes > this.limits.maxNodes)
            throw new RangeError(`XML exceeds maxNodes ${this.limits.maxNodes}`);
    }

    private accountText(value: string): void {
        this.textLength += value.length;
        if (this.textLength > this.limits.maxTextLength)
            throw new RangeError(`XML exceeds maxTextLength ${this.limits.maxTextLength}`);
    }

    private skipWhitespace(): boolean {
        const start = this.position;
        while (isWhitespace(this.source.charCodeAt(this.position))) this.position++;
        return this.position !== start;
    }

    private startsWith(value: string): boolean {
        return this.source.startsWith(value, this.position);
    }

    private consume(value: string): boolean {
        if (!this.startsWith(value)) return false;
        this.position += value.length;
        return true;
    }

    private expect(value: string): void {
        if (!this.consume(value)) this.fail(`Expected ${value}`);
    }

    private fail(message: string): never {
        throw new SyntaxError(`${message} at XML offset ${this.position}`);
    }
}

function resolveLimits(input?: StrictXmlLimits): ResolvedLimits {
    if (input === undefined) return { ...DEFAULT_LIMITS };
    if (typeof input !== "object" || input === null || Object.getPrototypeOf(input) !== Object.prototype)
        throw new TypeError("XML limits must be a plain object");
    if (Object.getOwnPropertySymbols(input).length !== 0) throw new TypeError("XML limits cannot contain symbol keys");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const resolved: ResolvedLimits = { ...DEFAULT_LIMITS };
    for (const key of Object.keys(descriptors)) {
        if (!(LIMIT_KEYS as readonly string[]).includes(key)) throw new TypeError(`Unknown XML limit ${key}`);
        const descriptor = descriptors[key];
        if (!("value" in descriptor)) throw new TypeError(`XML limit ${key} must be a data property`);
        const value = descriptor.value;
        if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`XML limit ${key} must be a positive safe integer`);
        resolved[key as keyof ResolvedLimits] = value;
    }
    return resolved;
}

function validateXmlCharacters(source: string): void {
    for (let index = 0; index < source.length;) {
        const codePoint = source.codePointAt(index)!;
        if (!isXmlCodePoint(codePoint)) throw new SyntaxError(`Invalid XML character at offset ${index}`);
        index += codePoint > 0xffff ? 2 : 1;
    }
}

function isXmlCodePoint(value: number): boolean {
    return value === 0x9 || value === 0xa || value === 0xd
        || (value >= 0x20 && value <= 0xd7ff)
        || (value >= 0xe000 && value <= 0xfffd)
        || (value >= 0x10000 && value <= 0x10ffff);
}

function isWhitespace(value: number): boolean {
    return value === 0x20 || value === 0x9 || value === 0xa;
}

function isNameStart(value: number): boolean {
    // XML 1.0 Fifth Edition NameStartChar, deliberately excluding colon so
    // namespace syntax never enters this namespace-free resource model.
    return value === 0x5f
        || value >= 0x41 && value <= 0x5a
        || value >= 0x61 && value <= 0x7a
        || value >= 0xc0 && value <= 0xd6
        || value >= 0xd8 && value <= 0xf6
        || value >= 0xf8 && value <= 0x2ff
        || value >= 0x370 && value <= 0x37d
        || value >= 0x37f && value <= 0x1fff
        || value >= 0x200c && value <= 0x200d
        || value >= 0x2070 && value <= 0x218f
        || value >= 0x2c00 && value <= 0x2fef
        || value >= 0x3001 && value <= 0xd7ff
        || value >= 0xf900 && value <= 0xfdcf
        || value >= 0xfdf0 && value <= 0xfffd
        || value >= 0x10000 && value <= 0xeffff;
}

function isNameContinue(value: number): boolean {
    return isNameStart(value)
        || value >= 0x30 && value <= 0x39
        || value === 0x2d
        || value === 0x2e
        || value === 0xb7
        || value >= 0x300 && value <= 0x36f
        || value >= 0x203f && value <= 0x2040;
}

function codePointWidth(value: number): number {
    return value > 0xffff ? 2 : 1;
}

function requireLookupName(value: string): void {
    if (typeof value !== "string" || value.length === 0 || value.includes(":"))
        throw new TypeError("XML lookup name must be a nonempty non-namespaced string");
}
