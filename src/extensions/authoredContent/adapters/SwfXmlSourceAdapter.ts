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
        let documentElement: Laya.XML;
        try {
            documentElement = new Laya.XML(text);
        }
        catch (error) {
            throw new Error(`AUTHORED_CONTENT_SWF_XML_INVALID: ${String(error)}`);
        }
        if (documentElement.name !== "swf-authored-content" || documentElement.getAttrString("version") !== "1")
            throw new Error("AUTHORED_CONTENT_SWF_XML_SCHEMA_UNSUPPORTED: Expected swf-authored-content version 1.");
        const nodeElement = documentElement.getNode("node");
        if (!nodeElement)
            throw new Error("AUTHORED_CONTENT_SWF_XML_ROOT_MISSING: A root node is required.");
        const timelineElement = documentElement.getNode("timeline");
        if (!timelineElement)
            throw new Error("AUTHORED_CONTENT_SWF_XML_TIMELINE_MISSING: A captured timeline is required.");
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
    return {
        frameRate: numberAttribute(element, "frameRate"),
        duration: numberAttribute(element, "duration"),
        loop: booleanAttribute(element, "loop"),
        tracks: element.elements("track").map(track => {
            const property = requiredAttribute(track, "property");
            return {
                targetPath: requiredAttribute(track, "target").split("/"),
                property,
                keyframes: track.elements("key").map(key => ({
                    time: numberAttribute(key, "time"),
                    value: property === "visible"
                        ? booleanAttribute(key, "value")
                        : numberAttribute(key, "value"),
                    tweenType: key.getAttrString("tween") || undefined
                }))
            };
        })
    };
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
