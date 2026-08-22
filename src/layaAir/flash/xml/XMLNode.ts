const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Flash-compatible legacy XML tree node.
 *
 * This is the small, non-E4X DOM surface exposed by flash.xml.XMLNode. It is
 * deliberately data-only: parsing remains owned by the strict XML and E4X
 * bridges, while legacy callers can construct, inspect, move and serialize
 * nodes without a browser DOM dependency.
 */
export class XMLNode {
    readonly nodeType: number;
    nodeName: string | null;
    nodeValue: string | null;
    attributes: Record<string, string>;
    parentNode: XMLNode | null = null;
    childNodes: XMLNode[] = [];

    constructor(type: number, value: string) {
        if (type !== ELEMENT_NODE && type !== TEXT_NODE)
            throw new RangeError("XMLNode type must be 1 (element) or 3 (text)");
        if (typeof value !== "string") throw new TypeError("XMLNode value must be a string");
        this.nodeType = type;
        this.nodeName = type === ELEMENT_NODE ? value : null;
        this.nodeValue = type === TEXT_NODE ? value : null;
        this.attributes = Object.create(null) as Record<string, string>;
    }

    get firstChild(): XMLNode | null { return this.childNodes[0] ?? null; }
    get lastChild(): XMLNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
    get previousSibling(): XMLNode | null {
        if (this.parentNode === null) return null;
        const index = this.parentNode.childNodes.indexOf(this);
        return index > 0 ? this.parentNode.childNodes[index - 1] : null;
    }
    get nextSibling(): XMLNode | null {
        if (this.parentNode === null) return null;
        const index = this.parentNode.childNodes.indexOf(this);
        return index >= 0 ? this.parentNode.childNodes[index + 1] ?? null : null;
    }
    get localName(): string | null {
        if (this.nodeName === null) return null;
        const separator = this.nodeName.indexOf(":");
        return separator < 0 ? this.nodeName : this.nodeName.slice(separator + 1);
    }
    get prefix(): string | null {
        if (this.nodeName === null) return null;
        const separator = this.nodeName.indexOf(":");
        return separator < 0 ? "" : this.nodeName.slice(0, separator);
    }
    get namespaceURI(): string | null {
        const prefix = this.prefix;
        return prefix === null ? null : this.getNamespaceForPrefix(prefix);
    }

    appendChild(node: XMLNode): void {
        this.#adopt(node, this.childNodes.length);
    }

    insertBefore(node: XMLNode, before: XMLNode | null): void {
        if (before === null) {
            this.appendChild(node);
            return;
        }
        const index = this.childNodes.indexOf(before);
        if (index < 0) return;
        this.#adopt(node, index);
    }

    removeNode(): void {
        if (this.parentNode === null) return;
        const siblings = this.parentNode.childNodes;
        const index = siblings.indexOf(this);
        if (index >= 0) siblings.splice(index, 1);
        this.parentNode = null;
    }

    hasChildNodes(): boolean { return this.childNodes.length !== 0; }

    cloneNode(deep: boolean): XMLNode {
        const clone = new XMLNode(this.nodeType, this.nodeName ?? this.nodeValue ?? "");
        clone.attributes = Object.assign(Object.create(null), this.attributes);
        if (deep) for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
        return clone;
    }

    getNamespaceForPrefix(prefix: string): string | null {
        const key = prefix.length === 0 ? "xmlns" : `xmlns:${prefix}`;
        for (let node: XMLNode | null = this; node !== null; node = node.parentNode) {
            if (Object.prototype.hasOwnProperty.call(node.attributes, key)) return node.attributes[key];
        }
        return null;
    }

    getPrefixForNamespace(namespaceURI: string): string | null {
        for (let node: XMLNode | null = this; node !== null; node = node.parentNode) {
            for (const [name, value] of Object.entries(node.attributes)) {
                if (value !== namespaceURI) continue;
                if (name === "xmlns") return "";
                if (name.startsWith("xmlns:")) return name.slice(6);
            }
        }
        return null;
    }

    toString(): string {
        if (this.nodeType === TEXT_NODE) return escapeText(this.nodeValue ?? "");
        const name = this.nodeName ?? "";
        const attributes = Object.entries(this.attributes)
            .map(([key, value]) => ` ${key}=\"${escapeAttribute(String(value))}\"`).join("");
        if (this.childNodes.length === 0) return `<${name}${attributes} />`;
        return `<${name}${attributes}>${this.childNodes.map(child => child.toString()).join("")}</${name}>`;
    }

    #adopt(node: XMLNode, index: number): void {
        if (!(node instanceof XMLNode)) throw new TypeError("XMLNode child must be canonical");
        if (node === this) throw new TypeError("XMLNode cannot contain itself");
        for (let ancestor: XMLNode | null = this; ancestor !== null; ancestor = ancestor.parentNode)
            if (ancestor === node) throw new TypeError("XMLNode cannot contain an ancestor");
        const sameParent = node.parentNode === this;
        const oldIndex = sameParent ? this.childNodes.indexOf(node) : -1;
        node.removeNode();
        if (sameParent && oldIndex >= 0 && oldIndex < index) index--;
        this.childNodes.splice(index, 0, node);
        node.parentNode = this;
    }
}

function escapeText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
    return escapeText(value).replace(/\"/g, "&quot;");
}
