import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated LayaFlash declarations expose host/system surfaces and preserve clean-break holds", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    for (const name of ["Capabilities", "ImageDecodingPolicy", "System", "NativeSystemHost",
        "NativeSystemHostLease", "ExternalInterface", "ExternalInterfaceValue",
        "NativeExternalInterfaceHost", "NativeExternalInterfaceHostLease", "IllegalOperationError"])
        assert.match(declaration, new RegExp(`\\b${name}\\b`));
    assert.doesNotMatch(declaration, /(?:abstract\s+)?class\s+Native(?:ExternalInterface|System)Host\b/);
    assert.match(declaration, /interface\s+NativeExternalInterfaceHost\b/);
    assert.match(declaration, /interface\s+NativeSystemHost\b/);
    assert.match(declaration, /class\s+NativeExternalInterfaceHostLease\b[\s\S]*?#private;[\s\S]*?private constructor\(\)/);
    assert.match(declaration, /class\s+NativeSystemHostLease\b[\s\S]*?#private;[\s\S]*?private constructor\(\)/);
    assert.doesNotMatch(declaration, /NATIVE_(?:EXTERNAL_INTERFACE|SYSTEM)_HOST_LEASE/);
    assert.match(declaration, /installNativeExternalInterfaceHost\([^)]*\):\s*NativeExternalInterfaceHostLease/);
    assert.match(declaration, /installNativeSystemHost\([^)]*\):\s*NativeSystemHostLease/);
    for (const held of ["ApplicationDomain", "LoaderContext", "Security", "XMLNode"])
        assert.doesNotMatch(declaration, new RegExp(`\\b(?:class|interface|type|function|const)\\s+${held}\\b`));
    assert.doesNotMatch(declaration, /(?:__AS3__|QName|registerDefinition|addCallback)/);
});
