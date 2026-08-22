import assert from "node:assert/strict";
import test from "node:test";

import { ByteArray } from "../../src/layaAir/flash/utils/ByteArray";
import { XML, XMLList } from "../../src/layaAir/flash/utils/XML";
import { XMLNode } from "../../src/layaAir/flash/xml/XMLNode";

test("preserves the legacy XMLNode tree, namespace and serialization surface", () => {
    const root = new XMLNode(1, "ns:root");
    root.attributes["xmlns:ns"] = "urn:test";
    root.attributes.answer = "1&2";
    const first = new XMLNode(1, "first");
    const text = new XMLNode(3, "<&");
    const last = new XMLNode(1, "last");
    root.appendChild(first);
    root.appendChild(last);
    root.insertBefore(text, last);
    assert.equal(root.firstChild, first);
    assert.equal(text.previousSibling, first);
    assert.equal(text.nextSibling, last);
    assert.equal(root.localName, "root");
    assert.equal(root.prefix, "ns");
    assert.equal(root.namespaceURI, "urn:test");
    assert.equal(last.getPrefixForNamespace("urn:test"), "ns");
    assert.equal(root.toString(), '<ns:root xmlns:ns="urn:test" answer="1&amp;2"><first />&lt;&amp;<last /></ns:root>');
    const copy = root.cloneNode(true);
    assert.equal(copy.toString(), root.toString());
    text.removeNode();
    assert.equal(text.parentNode, null);
    assert.equal(root.childNodes.length, 2);
    assert.throws(() => first.appendChild(root), /ancestor/);
});

test("parses mutable XML without weakening the strict parser boundary", () => {
    const root = new XML("<root a='1'>before<group><item id='x'/><item id='y'>Y&amp;Z</item></group><!--note--><![CDATA[raw<&]]></root>");
    assert.equal(root.nodeName, "root");
    assert.equal(root.attribute("a"), "1");
    assert.equal(root.textContent, "beforeY&Zraw<&");
    assert.deepEqual([...root.descendants("item")].map(item => item.attribute("id")), ["x", "y"]);
    assert.equal(root.descendants("item").at(1)?.toString(), "Y&Z");
    assert.equal(root.toXMLString(),
        '<root a="1">before<group><item id="x"/><item id="y">Y&amp;Z</item></group><!--note--><![CDATA[raw<&]]></root>');
});

test("tracks exact mixed-content childIndex and parent ownership during removal and reparenting", () => {
    const first = new XML("<first>text<child/>tail</first>");
    const second = new XML("<second/>");
    const child = first.children("child").at(0)!;
    assert.equal(child.childIndex(), 1, "text participates in the wildcard child index");
    assert.equal(child.parent(), first);
    assert.equal(child.remove(), true);
    assert.equal(child.parent(), null);
    assert.equal(first.toXMLString(), "<first>texttail</first>");

    first.appendChild(child);
    second.appendChild(child);
    assert.equal(first.children().length, 0);
    assert.equal(child.parent(), second);
    assert.equal(second.toXMLString(), "<second><child/></second>");
    assert.throws(() => child.appendChild(second), /ancestor/);
});

test("supports explicit attribute queries and XMLList snapshots for E4X lowering", () => {
    const root = new XML("<type><method name='a' declaredBy='Base'/><method name='b' declaredBy='Type'/><accessor name='x'/></type>");
    const methods = root.descendants("method");
    assert.ok(methods instanceof XMLList);
    const declared = methods.filter(item => item.hasAttribute("declaredBy", "Type"));
    assert.deepEqual(declared.attribute("name"), ["b"]);
    root.children().at(0)?.setAttribute("name", "changed");
    assert.equal(methods.at(0)?.attribute("name"), "changed", "snapshots preserve node identity");
    assert.equal(methods.length, 2);
    assert.deepEqual(methods.toArray(), [...methods]);
});

test("constructs from ByteArray without moving its cursor and serializes deterministic mutations", () => {
    const bytes = new ByteArray(new TextEncoder().encode("<root><old/></root>"));
    bytes.position = 4;
    const root = new XML(bytes);
    assert.equal(bytes.position, 4);
    const old = root.children("old").at(0)!;
    assert.equal(root.removeChildAt(old.childIndex()), old);
    root.prependChild("<&").appendChild(new XML("<new value='a&amp;b'/>"));
    assert.equal(root.toXMLString(), '<root>&lt;&amp;<new value="a&amp;b"/></root>');
});

test("copies trees deeply and rejects malformed, namespace, cycle, and invalid-index operations", () => {
    const original = new XML("<root><child a='1'/></root>");
    const copy = original.copy();
    copy.children().at(0)?.setAttribute("a", 2);
    assert.equal(original.children().at(0)?.attribute("a"), "1");
    assert.equal(copy.children().at(0)?.attribute("a"), "2");
    assert.throws(() => new XML("<!DOCTYPE x><x/>"), SyntaxError);
    assert.throws(() => new XML("<x:y/>"), SyntaxError);
    assert.throws(() => original.setAttribute("x:y", 1), TypeError);
    assert.throws(() => original.removeChildAt(5), RangeError);
    assert.throws(() => original.appendChild(original), /itself/);
});
