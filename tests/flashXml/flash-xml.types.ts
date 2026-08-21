import { ByteArray } from "../../src/layaAir/flash/utils/ByteArray";
import { XML, XMLList } from "../../src/layaAir/flash/utils/XML";

const source = new ByteArray(new TextEncoder().encode("<root><item/></root>"));
const root: XML = new XML(source);
const items: XMLList = root.descendants("item");
for (const item of items) item.remove();
root.appendChild(new XML("<next/>")).setAttribute("ready", true);
const serialized: string = root.toXMLString();
void serialized;
