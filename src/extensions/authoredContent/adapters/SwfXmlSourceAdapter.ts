import {
    NEUTRAL_AUTHORED_CONTENT_SCHEMA,
    NeutralAuthoredContentIR,
    normalizeNeutralAuthoredContent
} from "../core/NeutralAuthoredContentIR";
import {
    AuthoredContentImportSettings,
    SourceAdapter,
    readImmutableSourceFile
} from "../core/SourceAdapter";

export class SwfXmlSourceAdapter implements SourceAdapter {
    async parse(sourcePath: string, settings: AuthoredContentImportSettings): Promise<NeutralAuthoredContentIR> {
        return this.parseText(await readImmutableSourceFile(sourcePath), settings);
    }

    parseText(text: string, settings: AuthoredContentImportSettings = {}): NeutralAuthoredContentIR {
        rejectIgnoredLexicalContent(text);
        let documentElement: Laya.XML;
        try {
            documentElement = new Laya.XML(text);
        }
        catch (error) {
            throw new Error(`AUTHORED_CONTENT_SWF_XML_INVALID: ${String(error)}`);
        }
        if (documentElement.name !== "swf-authored-content" || documentElement.getAttrString("version") !== "1")
            throw new Error("AUTHORED_CONTENT_SWF_XML_SCHEMA_UNSUPPORTED: Expected swf-authored-content version 1.");
        assertElementGrammar(documentElement, ["version", "id"], ["node", "timeline"], "swf-authored-content");
        const nodeElement = exactlyOneChild(documentElement, "node");
        const timelineElement = exactlyOneChild(documentElement, "timeline");
        const content = {
            schema: NEUTRAL_AUTHORED_CONTENT_SCHEMA,
            documentId: requiredAttribute(documentElement, "id"),
            root: parseNode(nodeElement),
            timeline: parseTimeline(timelineElement)
        };
        return normalizeNeutralAuthoredContent(content, settings.scale ?? 1);
    }
}

function parseNode(element: Laya.XML): Record<string, unknown> {
    assertElementGrammar(
        element,
        ["linkage", "kind", "name", "x", "y", "width", "height", "alpha", "visible", "text", "fontSize", "color"],
        ["node"],
        "node"
    );
    const kind = requiredAttribute(element, "kind");
    const node: Record<string, unknown> = {
        linkage: requiredAttribute(element, "linkage"),
        kind,
        children: element.elements("node").map(parseNode)
    };
    copyStringAttribute(element, node, "name");
    copyNumberAttribute(element, node, "x");
    copyNumberAttribute(element, node, "y");
    copyNumberAttribute(element, node, "width");
    copyNumberAttribute(element, node, "height");
    copyNumberAttribute(element, node, "alpha");
    copyBooleanAttribute(element, node, "visible");
    copyStringAttribute(element, node, "text");
    copyNumberAttribute(element, node, "fontSize");
    copyStringAttribute(element, node, "color");
    return node;
}

function parseTimeline(element: Laya.XML): Record<string, unknown> {
    assertElementGrammar(element, ["frameRate", "duration", "loop"], ["track"], "timeline");
    return {
        frameRate: numberAttribute(element, "frameRate"),
        duration: numberAttribute(element, "duration"),
        loop: booleanAttribute(element, "loop"),
        tracks: element.elements("track").map(track => {
            assertElementGrammar(track, ["target", "property"], ["key"], "track");
            const property = requiredAttribute(track, "property");
            return {
                targetPath: requiredAttribute(track, "target").split("/"),
                property,
                keyframes: track.elements("key").map(key => {
                    assertElementGrammar(key, ["time", "value", "tween"], [], "key");
                    return {
                        time: numberAttribute(key, "time"),
                        value: property === "visible"
                            ? booleanAttribute(key, "value")
                            : numberAttribute(key, "value"),
                        tweenType: key.getAttrString("tween") || undefined
                    };
                })
            };
        })
    };
}

function rejectIgnoredLexicalContent(text: string): void {
    if (/<!--|<!\[CDATA\[|<!DOCTYPE|<\?/i.test(text))
        throw new Error("AUTHORED_CONTENT_SWF_XML_IGNORED_CONTENT: Comments, CDATA, declarations, and processing instructions are unsupported.");
    const outsideTags = text.replace(/<[^>]*>/g, "");
    if (outsideTags.trim().length > 0)
        throw new Error("AUTHORED_CONTENT_SWF_XML_IGNORED_CONTENT: Element text content is unsupported; use declared attributes.");
    for (const match of text.matchAll(/<([A-Za-z_][A-Za-z0-9_.:-]*)([^<>]*)>/g)) {
        const attributes = new Set<string>();
        for (const attribute of match[2].matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*=/g)) {
            if (attributes.has(attribute[1]))
                throw new Error(`AUTHORED_CONTENT_SWF_XML_ATTRIBUTE_DUPLICATE: ${match[1]}.${attribute[1]}`);
            attributes.add(attribute[1]);
        }
    }
}

function assertElementGrammar(
    element: Laya.XML,
    allowedAttributes: ReadonlyArray<string>,
    allowedChildren: ReadonlyArray<string>,
    path: string
): void {
    const attributeSet = new Set(allowedAttributes);
    for (const name of Object.keys(element.attributes)) {
        if (!attributeSet.has(name))
            throw new Error(`AUTHORED_CONTENT_SWF_XML_ATTRIBUTE_UNSUPPORTED: ${path}.${name}`);
    }
    const childSet = new Set(allowedChildren);
    for (const child of element.elements()) {
        if (!childSet.has(child.name))
            throw new Error(`AUTHORED_CONTENT_SWF_XML_ELEMENT_UNSUPPORTED: ${path}/${child.name}`);
    }
    if (element.text?.trim())
        throw new Error(`AUTHORED_CONTENT_SWF_XML_IGNORED_CONTENT: ${path} contains unsupported text.`);
}

function exactlyOneChild(element: Laya.XML, name: string): Laya.XML {
    const children = element.elements(name);
    if (children.length !== 1)
        throw new Error(`AUTHORED_CONTENT_SWF_XML_ELEMENT_COUNT: Expected exactly one ${name}; received ${children.length}.`);
    return children[0];
}

function requiredAttribute(element: Laya.XML, name: string): string {
    const value = element.getAttrString(name);
    if (value === undefined || value === null || value.length === 0)
        throw new Error(`AUTHORED_CONTENT_SWF_XML_ATTRIBUTE_MISSING: ${element.name}.${name}`);
    return value;
}

function numberAttribute(element: Laya.XML, name: string): number {
    const raw = requiredAttribute(element, name);
    const value = Number(raw);
    if (!Number.isFinite(value))
        throw new Error(`AUTHORED_CONTENT_SWF_XML_NUMBER_INVALID: ${element.name}.${name}`);
    return value;
}

function booleanAttribute(element: Laya.XML, name: string): boolean {
    const value = requiredAttribute(element, name);
    if (value !== "true" && value !== "false")
        throw new Error(`AUTHORED_CONTENT_SWF_XML_BOOLEAN_INVALID: ${element.name}.${name}`);
    return value === "true";
}

function copyStringAttribute(element: Laya.XML, target: Record<string, unknown>, name: string): void {
    const value = element.getAttrString(name);
    if (value !== undefined && value !== null)
        target[name] = value;
}

function copyNumberAttribute(element: Laya.XML, target: Record<string, unknown>, name: string): void {
    if (element.attributes[name] !== undefined)
        target[name] = numberAttribute(element, name);
}

function copyBooleanAttribute(element: Laya.XML, target: Record<string, unknown>, name: string): void {
    const value = element.getAttrString(name);
    if (value !== undefined && value !== null) {
        target[name] = booleanAttribute(element, name);
    }
}
