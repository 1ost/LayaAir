import {
    StrictXmlDocument,
    StrictXmlLimits,
    StrictXmlElement,
    StrictXmlNode,
} from "../../src/layaAir/flash/xml/StrictXmlDocument";

const limits: StrictXmlLimits = { maxDepth: 8, maxNodes: 100 };
const document: StrictXmlDocument = StrictXmlDocument.parse("<root><child/></root>", limits);
const root: StrictXmlElement = document.root;
const nodes: readonly StrictXmlNode[] = root.childNodes;
const value: string | undefined = root.attribute("id");
const children: readonly StrictXmlElement[] = root.children("child");
const descendants: readonly StrictXmlElement[] = root.descendants();
void [nodes, value, children, descendants];

// @ts-expect-error immutable document root
document.root = root;
// @ts-expect-error immutable child collection
root.childNodes.push(root);
// @ts-expect-error unsupported E4X mutation API
root.appendChild(root);
// @ts-expect-error no XMLList surface
document.XMLList;
