import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated LayaFlash declarations expose host/system surfaces and preserve clean-break holds", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    for (const name of ["Capabilities", "ImageDecodingPolicy", "System", "NativeSystemHost",
        "ExternalInterface", "NativeExternalInterfaceHost", "IllegalOperationError"])
        assert.match(declaration, new RegExp(`\\b${name}\\b`));
    for (const held of ["ApplicationDomain", "LoaderContext", "Security", "XMLNode"])
        assert.doesNotMatch(declaration, new RegExp(`\\b(?:class|interface|type|function|const)\\s+${held}\\b`));
    assert.doesNotMatch(declaration, /(?:__AS3__|QName|registerDefinition|addCallback)/);
});
