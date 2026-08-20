import assert from "node:assert/strict";
import test from "node:test";
import { StrictXmlDocument } from "../../src/layaAir/flash/xml/StrictXmlDocument";

test("preserves immutable declaration, document, root, attributes and ordered mixed content", () => {
    const document = StrictXmlDocument.parse(
        "\ufeff<?xml version='1.0' encoding=\"utf-8\" standalone='yes'?><!--before--><root a='1' b=\"&amp;&#65;&#x1f600;\">left<child id='x'/>mid<![CDATA[<&raw>]]><!--inside--><child>right</child></root><!--after-->",
    );
    assert.deepEqual(document.declaration, { version: "1.0", encoding: "UTF-8", standalone: true });
    assert.equal(document.root, document.root);
    assert.equal(document.childNodes[1], document.root);
    assert.deepEqual(document.childNodes.map(node => node.kind), ["comment", "element", "comment"]);
    assert.equal(document.prologComments[0].value, "before");
    assert.equal(document.epilogComments[0].value, "after");
    assert.equal(document.root.attribute("a"), "1");
    assert.equal(document.root.attribute("b"), "&A😀");
    assert.deepEqual(document.root.attributes.map(attribute => attribute.name), ["a", "b"]);
    assert.deepEqual(document.root.childNodes.map(node => node.kind),
        ["text", "element", "text", "cdata", "comment", "element"]);
    assert.equal(document.root.textContent, "leftmid<&raw>right");
    assert.deepEqual(document.root.children().map(element => element.name), ["child", "child"]);
    assert.equal(document.root.children("child")[0], document.root.childNodes[1]);
    assert.deepEqual(document.root.descendants("child").map(element => element.attribute("id")), ["x", undefined]);
    for (const value of [document, document.declaration, document.childNodes, document.root,
        document.root.attributes, ...document.root.attributes, document.root.childNodes,
        ...document.root.childNodes, document.prologComments, document.epilogComments,
        Object.getPrototypeOf(document), Object.getPrototypeOf(document.root), StrictXmlDocument])
        assert.equal(Object.isFrozen(value), true);
});

test("normalizes XML line endings while preserving CDATA and text node boundaries", () => {
    const root = StrictXmlDocument.parse("<r>a\r\nb\rc<![CDATA[d\r\ne]]>f&amp;g</r>").root;
    assert.deepEqual(root.childNodes.map(node => node.kind === "element" ? node.name : node.value),
        ["a\nb\nc", "d\ne", "f&g"]);
});

test("supports predefined, decimal and hexadecimal entities and rejects non-XML scalar values", () => {
    assert.equal(StrictXmlDocument.parse("<r>&lt;&gt;&quot;&apos;&amp;&#9;&#x10ffff;</r>").root.textContent,
        "<>\"'&\t\udbff\udfff");
    for (const source of ["<r>&bogus;</r>", "<r>&amp</r>", "<r>&#0;</r>", "<r>&#xD800;</r>", "<r>&#1114112;</r>"])
        assert.throws(() => StrictXmlDocument.parse(source), SyntaxError, source);
});

test("rejects DTDs, external entities, namespaces and processing instructions", () => {
    for (const source of [
        "<!DOCTYPE r><r/>",
        "<!DOCTYPE r [<!ENTITY x SYSTEM 'file:///secret'>]><r>&x;</r>",
        "<x:r/>",
        "<r x:a='1'/>",
        "<r xmlns='urn:test'/>",
        "<?work value?><r/>",
        "<r><?work value?></r>",
    ]) assert.throws(() => StrictXmlDocument.parse(source), SyntaxError, source);
});

test("rejects malformed structure, duplicate attributes, invalid comments and trailing content", () => {
    for (const source of [
        "", "text<r/>", "<r/>text", "<r/><s/>", "<r>", "<r></s>", "<r a='1' a='2'/>",
        "<r a=unquoted/>", "<r a='<'/>", "<r>]]></r>", "<!--a--b--><r/>", "<!--a---><r/>",
        "<r><![CDATA[open</r>", "<r><!--open</r>", "<r / extra>",
    ]) assert.throws(() => StrictXmlDocument.parse(source), SyntaxError, source);
});

test("accepts only the explicitly supported XML declaration", () => {
    assert.equal(StrictXmlDocument.parse("<?xml version='1.0'?><r/>").declaration?.encoding, null);
    assert.equal(StrictXmlDocument.parse("<?xml version='1.0' standalone='no'?><r/>").declaration?.standalone, false);
    for (const source of [
        " <?xml version='1.0'?><r/>", "<!--x--><?xml version='1.0'?><r/>", "<?xml version='1.1'?><r/>",
        "<?xml encoding='UTF-8' version='1.0'?><r/>", "<?xml version='1.0' encoding='UTF-16'?><r/>",
        "<?xml version='1.0' foo='bar'?><r/>",
    ]) assert.throws(() => StrictXmlDocument.parse(source), SyntaxError, source);
});

test("enforces every fail-closed resource limit", () => {
    assert.throws(() => StrictXmlDocument.parse("<root/>", { maxSourceLength: 6 }), RangeError);
    assert.throws(() => StrictXmlDocument.parse("<a><b/></a>", { maxDepth: 1 }), RangeError);
    assert.throws(() => StrictXmlDocument.parse("<a><b/></a>", { maxElements: 1 }), RangeError);
    assert.throws(() => StrictXmlDocument.parse("<a x='1' y='2'/>", { maxAttributes: 1 }), RangeError);
    assert.throws(() => StrictXmlDocument.parse("<a>x<!--y--></a>", { maxNodes: 2 }), RangeError);
    assert.throws(() => StrictXmlDocument.parse("<a x='12'>34</a>", { maxTextLength: 3 }), RangeError);
});

test("rejects nonplain, accessor, symbolic, unknown and invalid limits without reading accessors", () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, "maxDepth", { enumerable: true, get() { reads++; return 1; } });
    assert.throws(() => StrictXmlDocument.parse("<r/>", accessor), /data property/);
    assert.equal(reads, 0);
    assert.throws(() => StrictXmlDocument.parse("<r/>", Object.create({ maxDepth: 1 })), /plain object/);
    assert.throws(() => StrictXmlDocument.parse("<r/>", Object.create(null)), /plain object/);
    assert.throws(() => StrictXmlDocument.parse("<r/>", { unknown: 1 } as any), /Unknown XML limit/);
    assert.throws(() => StrictXmlDocument.parse("<r/>", { maxDepth: 0 }), RangeError);
    assert.throws(() => StrictXmlDocument.parse("<r/>", { maxDepth: 1.5 }), RangeError);
    const symbolic = { maxDepth: 1 } as Record<PropertyKey, number>;
    symbolic[Symbol("limit")] = 1;
    assert.throws(() => StrictXmlDocument.parse("<r/>", symbolic), /symbol keys/);
});

test("rejects boxed sources, invalid XML characters and namespace lookup syntax", () => {
    assert.throws(() => StrictXmlDocument.parse(new String("<r/>") as any), TypeError);
    assert.throws(() => StrictXmlDocument.parse("<r>\u0000</r>"), SyntaxError);
    assert.throws(() => StrictXmlDocument.parse("<r>\ud800</r>"), SyntaxError);
    const root = StrictXmlDocument.parse("<r/>").root;
    assert.throws(() => root.attribute("x:y"), TypeError);
    assert.throws(() => root.children(""), TypeError);
});
