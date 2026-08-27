# SWF evidence tooling

`laya_authored_swf` is LayaAir's provider-owned Python module for deterministic
SWF inspection, FFDec/JPEXS evidence extraction, safe SWC unpacking, and the
generic XML/binary parsing functions used by authored-content corpus audits.

Run it through the stable executable:

```text
python src/extensions/authoredContent/scripts/swfToLaya.py inspect input.swf
python src/extensions/authoredContent/scripts/swfToLaya.py extract input.swf evidence --ffdec-jar path/to/ffdec.jar
python src/extensions/authoredContent/scripts/swfToLaya.py unpack-swc input.swc output
python src/extensions/authoredContent/scripts/swfToLaya.py convert evidence neutral-library
python src/extensions/authoredContent/scripts/swfToLaya.py validate neutral-library
```

FFDec resolution precedence is `--ffdec-jar`,
`LAYA_AUTHORED_CONTENT_FFDEC_JAR`, then an explicitly supplied `--config`
containing `ffdec_jar`. The provider never searches a caller workspace.

For imports, add this directory to `sys.path` and import from
`laya_authored_swf`. The provider has no dependency on an application checkout.

`convert` (also exported as `convert_neutral_bundle`) emits only authenticated
`flash-library@1` assets, timelines, resources, report, and manifest output.
It never emits prefabs or application runtime bindings. `prefab_for_asset` and
`prefab_for_timeline` remain fail-closed compatibility boundaries. Native
delivery uses the TypeScript authored-content emitter with explicit bundle,
linkage, and runtime identities.
