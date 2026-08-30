import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("Flash API keeps qualified-name machinery out of production exports", () => {
    assert.equal(existsSync(`${root}src/layaAir/flash/utils/QName.ts`), false);
    const publicRoot = readFileSync(`${root}src/layaAir/flash/index.ts`, "utf8");
    assert.doesNotMatch(publicRoot, /utils\/QName|export\s*\{\s*QName\s*\}/);
});

test("ByteArray delegates synchronous inflation to the native engine utility", () => {
    const byteArraySource = readFileSync(`${root}src/layaAir/flash/utils/ByteArray.ts`, "utf8");
    assert.match(byteArraySource, /import \{ inflateZlibSync \} from "\.\.\/\.\.\/laya\/utils\/Zlib";/);
    assert.match(byteArraySource, /inflateZlibSync\(new Uint8Array\(this\.buffer\)\)/);
    assert.doesNotMatch(byteArraySource, /DeflateBitReader|InflateOutput|HuffmanTable|readDeflateCode|function inflateZlibSync/);

    const utilitySource = readFileSync(`${root}src/layaAir/laya/utils/Zlib.ts`, "utf8");
    assert.match(utilitySource, /export function inflateZlibSync\(input: Uint8Array\): Uint8Array/);
    assert.doesNotMatch(utilitySource, /flash\/|ByteArrayInput|ZlibDecompressionHost/);
});
