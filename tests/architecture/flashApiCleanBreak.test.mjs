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

test("ByteArray DEFLATE support has no authored symbol-decoder surface", () => {
    const source = readFileSync(`${root}src/layaAir/flash/utils/ByteArray.ts`, "utf8");
    assert.doesNotMatch(source, /decodeHuffmanSymbol/);
    assert.match(source, /function readDeflateCode\(/);
    assert.equal(source.match(/readDeflateCode\(/g)?.length, 4);
});
