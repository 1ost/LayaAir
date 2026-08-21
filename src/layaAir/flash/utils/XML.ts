import { ByteArray } from "./ByteArray";
import {
    StrictXmlDocument,
    StrictXmlElement,
    StrictXmlNode,
} from "../xml/StrictXmlDocument";

export type FlashXmlInput = string | ByteArray | XML;
export type FlashXmlChild = XML | string | number | boolean;

type MutableXmlContent = XML | {
    readonly kind: "text" | "cdata" | "comment";
    value: string;
};

function escapeText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
    return escapeText(value).replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function validateName(name: string, label: string): string {
    if (typeof name !== "string" || name.length === 0)
        throw new TypeError(`${label} must be a non-empty primitive string`);
    try {
        if (StrictXmlDocument.parse(`<${name}/>`).root.name !== name) throw new SyntaxError();
    } catch {
        throw new TypeError(`${label} must be an XML 1.0 name without namespaces`);
    }
    return name;
}

function sourceString(source: string | ByteArray): string {
    if (typeof source === "string") return source;
    if (!(source instanceof ByteArray)) throw new TypeError("XML source must be a string, ByteArray, or XML");
    return new TextDecoder("utf-8", { fatal: false }).decode(source.buffer);
}

/**
 * A snapshot list returned by the mutable Flash XML bridge.
 *
 * Native TypeScript consumers use explicit traversal methods instead of E4X
 * operators. The list preserves node identity and document order.
 */
export class XMLList implements Iterable<XML> {
    private readonly _items: readonly XML[];

    constructor(items: Iterable<XML> = []) {
        const snapshot = [...items];
        if (snapshot.some(item => !(item instanceof XML)))
            throw new TypeError("XMLList items must be XML nodes");
        this._items = Object.freeze(snapshot);
    }

    get length(): number {
        return this._items.length;
    }

    at(index: number): XML | undefined {
        if (!Number.isSafeInteger(index)) throw new TypeError("XMLList index must be an integer");
        const exactIndex = index < 0 ? this._items.length + index : index;
        return this._items[exactIndex];
    }

    item(index: number): XML | undefined {
        return this.at(index);
    }

    toArray(): readonly XML[] {
        return this._items;
    }

    filter(predicate: (node: XML, index: number) => boolean): XMLList {
        if (typeof predicate !== "function") throw new TypeError("XMLList.filter requires a function");
        return new XMLList(this._items.filter(predicate));
    }

    descendants(name?: string): XMLList {
        const result: XML[] = [];
        for (const item of this._items) result.push(...item.descendants(name));
        return new XMLList(result);
    }

    attribute(name: string): readonly string[] {
        validateName(name, "XML attribute name");
        return Object.freeze(this._items.flatMap(item => {
            const value = item.attribute(name);
            return value === undefined ? [] : [value];
        }));
    }

    toXMLString(): string {
        return this._items.map(item => item.toXMLString()).join("\n");
    }

    toString(): string {
        return this._items.map(item => item.toString()).join("\n");
    }

    [Symbol.iterator](): Iterator<XML> {
        return this._items[Symbol.iterator]();
    }
}
Object.freeze(XMLList.prototype);

/**
 * Mutable, parent-aware Flash XML bridge for native TypeScript consumers.
 *
 * Parsing delegates to the fail-closed StrictXmlDocument parser, while this
 * class owns the mutation, traversal, XMLList snapshot, and serialization
 * behavior required by application code. It deliberately exposes explicit
 * methods instead of virtual-machine property interception or JavaScript Proxy traps.
 */
export class XML {
    private _name = "";
    private _attributes: { name: string; value: string }[] = [];
    private _content: MutableXmlContent[] = [];
    private _parent: XML | null = null;

    constructor(source: FlashXmlInput) {
        if (source instanceof XML) {
            this._copyXml(source);
            return;
        }
        const document = StrictXmlDocument.parse(sourceString(source));
        this._copyStrictElement(document.root);
    }

    static from(source: FlashXmlInput): XML {
        return source instanceof XML ? source : new XML(source);
    }

    get nodeName(): string {
        return this._name;
    }

    get textContent(): string {
        return this._content.map(node => node instanceof XML
            ? node.textContent
            : node.kind === "comment" ? "" : node.value).join("");
    }

    parent(): XML | null {
        return this._parent;
    }

    childIndex(): number {
        return this._parent?._content.indexOf(this) ?? -1;
    }

    children(name?: string): XMLList {
        if (name !== undefined) validateName(name, "XML child name");
        return new XMLList(this._content.filter((node): node is XML =>
            node instanceof XML && (name === undefined || node._name === name)));
    }

    elements(name?: string): XMLList {
        return this.children(name);
    }

    descendants(name?: string): XMLList {
        if (name !== undefined) validateName(name, "XML descendant name");
        const result: XML[] = [];
        const visit = (node: XML): void => {
            for (const child of node._content) {
                if (!(child instanceof XML)) continue;
                if (name === undefined || child._name === name) result.push(child);
                visit(child);
            }
        };
        visit(this);
        return new XMLList(result);
    }

    attribute(name: string): string | undefined {
        validateName(name, "XML attribute name");
        return this._attributes.find(attribute => attribute.name === name)?.value;
    }

    hasAttribute(name: string, value?: string): boolean {
        const actual = this.attribute(name);
        return actual !== undefined && (value === undefined || actual === value);
    }

    setAttribute(name: string, value: unknown): this {
        validateName(name, "XML attribute name");
        const exactValue = String(value);
        const existing = this._attributes.find(attribute => attribute.name === name);
        if (existing) existing.value = exactValue;
        else this._attributes.push({ name, value: exactValue });
        return this;
    }

    removeAttribute(name: string): boolean {
        validateName(name, "XML attribute name");
        const index = this._attributes.findIndex(attribute => attribute.name === name);
        if (index < 0) return false;
        this._attributes.splice(index, 1);
        return true;
    }

    appendChild(child: FlashXmlChild): this {
        this._insertChild(this._content.length, child);
        return this;
    }

    prependChild(child: FlashXmlChild): this {
        this._insertChild(0, child);
        return this;
    }

    removeChild(child: XML): boolean {
        if (!(child instanceof XML) || child._parent !== this) return false;
        const index = this._content.indexOf(child);
        if (index < 0) return false;
        this._content.splice(index, 1);
        child._parent = null;
        return true;
    }

    /** Removes the wildcard child at its mixed-content index. */
    removeChildAt(index: number): XML | null {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this._content.length)
            throw new RangeError("XML child index is outside the current content");
        const [removed] = this._content.splice(index, 1);
        if (removed instanceof XML) {
            removed._parent = null;
            return removed;
        }
        return null;
    }

    remove(): boolean {
        const parent = this._parent;
        if (parent === null) return false;
        const index = parent._content.indexOf(this);
        if (index < 0) return false;
        parent._content.splice(index, 1);
        this._parent = null;
        return true;
    }

    hasSimpleContent(): boolean {
        return !this._content.some(node => node instanceof XML);
    }

    copy(): XML {
        return new XML(this);
    }

    toXMLString(): string {
        const attributes = this._attributes.map(attribute =>
            ` ${attribute.name}=\"${escapeAttribute(attribute.value)}\"`).join("");
        if (this._content.length === 0) return `<${this._name}${attributes}/>`;
        return `<${this._name}${attributes}>${this._content.map(node => {
            if (node instanceof XML) return node.toXMLString();
            if (node.kind === "cdata") return `<![CDATA[${node.value}]]>`;
            if (node.kind === "comment") return `<!--${node.value}-->`;
            return escapeText(node.value);
        }).join("")}</${this._name}>`;
    }

    toString(): string {
        return this.hasSimpleContent() ? this.textContent : this.toXMLString();
    }

    private _insertChild(index: number, child: FlashXmlChild): void {
        if (child instanceof XML) {
            for (let cursor: XML | null = this; cursor !== null; cursor = cursor._parent) {
                if (cursor === child) throw new RangeError("XML cannot contain itself or an ancestor");
            }
            if (child._parent !== null) {
                const previousParent = child._parent;
                const previousIndex = previousParent._content.indexOf(child);
                if (previousIndex < 0) throw new Error("XML parent ownership is inconsistent");
                previousParent._content.splice(previousIndex, 1);
                child._parent = null;
            }
            child._parent = this;
            this._content.splice(index, 0, child);
            return;
        }
        if (typeof child !== "string" && typeof child !== "number" && typeof child !== "boolean")
            throw new TypeError("XML child must be XML or a primitive string, number, or boolean");
        this._content.splice(index, 0, { kind: "text", value: String(child) });
    }

    private _copyStrictElement(element: StrictXmlElement): void {
        this._name = element.name;
        this._attributes = element.attributes.map(attribute => ({ ...attribute }));
        this._content = element.childNodes.map(node => this._fromStrictNode(node));
        for (const child of this._content) if (child instanceof XML) child._parent = this;
    }

    private _fromStrictNode(node: StrictXmlNode): MutableXmlContent {
        return node.kind === "element"
            ? XML._fromStrictElement(node)
            : { kind: node.kind, value: node.value };
    }

    private static _fromStrictElement(element: StrictXmlElement): XML {
        const result = Object.create(XML.prototype) as XML;
        result._parent = null;
        result._copyStrictElement(element);
        return result;
    }

    private _copyXml(source: XML): void {
        this._name = source._name;
        this._attributes = source._attributes.map(attribute => ({ ...attribute }));
        this._content = source._content.map(node => node instanceof XML
            ? new XML(node)
            : { ...node });
        for (const child of this._content) if (child instanceof XML) child._parent = this;
    }
}
Object.freeze(XML.prototype);
