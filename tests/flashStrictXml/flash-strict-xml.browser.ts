import { StrictXmlDocument } from "../../src/layaAir/flash/xml/StrictXmlDocument";

try {
    let accessorReads = 0;
    const limits = Object.defineProperty({}, "maxDepth", { get() { accessorReads++; return 2; } });
    let accessorRejected = false;
    try { StrictXmlDocument.parse("<r/>", limits); } catch { accessorRejected = true; }
    const document = StrictXmlDocument.parse(
        "<?xml version='1.0' encoding='UTF-8'?><!--p--><root a='&amp;&#65;' space='x\ty\nz' β='v'>x<a·b/><![CDATA[<&>]]><!--c--><item>z</item></root><!--e-->",
    );
    let dtdRejected = false;
    try { StrictXmlDocument.parse("<!DOCTYPE r [<!ENTITY x SYSTEM 'file:///x'>]><r>&x;</r>"); } catch { dtdRejected = true; }
    requireValue(document.root.attribute("a") === "&A", "entity parity failed");
    requireValue(document.root.textContent === "x<&>z", "mixed text parity failed");
    requireValue(document.root.children().length === 2, "child traversal parity failed");
    requireValue(document.root.descendants("a·b")[0] === document.root.childNodes[1], "identity parity failed");
    requireValue(Object.isFrozen(document) && Object.isFrozen(document.root.childNodes), "immutability parity failed");
    requireValue(document.root.attribute("space") === "x y z" && document.root.attribute("β") === "v",
        "XML 1.0 name or attribute normalization parity failed");
    requireValue(dtdRejected, "DTD was accepted");
    requireValue(accessorRejected && accessorReads === 0, "limits accessor was observed");
    publish({ ok: true, result: {
        kinds: document.root.childNodes.map(node => node.kind), dtdRejected, accessorReads, attributeNormalized: true,
    } });
} catch (error) {
    publish({ ok: false, error: error instanceof Error ? `${error.stack ?? error.message}` : String(error) });
}

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function publish(value: unknown): void {
    const output = document.createElement("pre");
    output.id = "flash-strict-xml-browser-result";
    output.textContent = JSON.stringify(value);
    document.body.appendChild(output);
}
