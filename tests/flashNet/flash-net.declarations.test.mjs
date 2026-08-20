import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated Flash declarations expose the source-used network bridge family", async () => {
    const declaration = await readFile(new URL("../../build/types/LayaFlash.d.ts", import.meta.url), "utf8");
    for (const className of ["FileReference", "LocalConnection", "SharedObject", "Socket", "URLLoader", "URLVariables"])
        assert.match(declaration, new RegExp(`\\bclass ${className}\\b`), `${className} declaration missing`);
    for (const functionName of ["registerClassAlias", "sendToURL"])
        assert.match(declaration, new RegExp(`\\bfunction ${functionName}\\b`), `${functionName} declaration missing`);
});
