# Authored-content admission boundary

LayaAir owns one reusable authored-content foundation. Applications may supply
content, locale data, and typed behavior, but they do not own alternate runtime
readers or source-format compatibility layers.

The enforced dependency direction is:

```text
runtime core <- LayaAir runtime adapter <- editor <- offline source adapters
```

`src/extensions/authoredContent/offlineAdapters` is the only source-format
lane. It converts immutable authoring evidence into the current neutral model.
It is never reachable from an engine bundle or runtime package export. Source
executable code is evidence or a typed porting obligation; it is never executed
by the native runtime.

This clean break does not remove the source-visible Flash API used by
transpiled application TypeScript. `src/layaAir/flash` is a separate universal
bridge for the `flash.display`, `flash.events`, `flash.geom`, `flash.text`,
`flash.net`, and `flash.utils` namespaces. Those adapters preserve API names, signatures, and
observable behavior over native LayaAir/browser services. They are not authored
asset readers and may not contain ABC/AVM execution, QName, cinit, trait, or
admission machinery. These six namespaces are the required minimum, not a
closed universe: every additional `flash.*` namespace must be declared and add
its own `api.flash.*` capability row before code can ship. Bridge capability
rows require engine-owned symbols and evidence before the bridge can ship.

Runtime `as`/`is` checks consume the closed, hash-pinned constructor-to-predicate
authority in `docTool/architecture/flash-runtime-type-predicates.json`. Each
entry names one canonical class module, its read-only class-specific predicate,
and its complete Flash heritage closure. Predicates are backed by module-private
brands populated only by construction; the Flash root barrel does not export
predicates, and no registrar, adoption hook, or caller-controlled mint API exists.

The native runtime has one neutral identity, `Laya.AuthoredTimelineClip`, and
one current document schema, `neutral-authored-content@1`. If a runtime class
is introduced, its ID constant, constructor, and direct
`ClassUtils.regClass` call must each resolve exactly once. Parallel readers,
schema aliases, compatibility facades, fallback chains, and alternate class
registrations are rejected.

The exhaustive engine capability vocabulary lives in
`scripts/authoredContentAdmission.policy.json`. Every capability must have one
entry in `docTool/architecture/authored-content-capabilities.json` with one of
these dispositions:

- `native`: engine-owned implementation artifacts plus evidence;
- `declarative`: native Laya resource artifacts plus evidence;
- `typescript-obligation`: resolved exported symbols plus evidence;
- `evidence`: retained proof without a runtime implementation;
- `blocking`: a concrete reason that prevents production admission.

Admitted artifacts and TypeScript obligations are SHA-256 bound. TypeScript
obligations also pin the compiler-resolved symbol kind, exact signature, and
public class member surface. Evidence is SHA-256 bound to one capability and
the exact implementation hashes it covers in sorted, unique order. Its named `node:test` case must be
top-level, executable, and assertion-bearing; skipped, unreachable, empty, or
unrelated tests are rejected. Each code artifact/obligation must be imported by
its declared export and exercised in the assertion's evaluated subject. The
mandatory verification mode executes every referenced evidence file. A renamed
test, signature/member change, or stale artifact hash therefore fails closed.
As with every checked-in test suite, the assertion's domain quality remains a
review responsibility; the gate proves execution, symbol/dataflow linkage, and
integrity, not the human adequacy of the asserted behavior.

Blocking entries are valid while the authored runtime is not exported,
bundled, or reachable from production. The guard fails as soon as a blocked
runtime becomes production-reachable. Unknown source tags or parameters fail
with a synthesized blocking capability ID so that coverage cannot silently
drift.

Production reachability is derived from compiler-resolved module edges, every
root package target and every literal engine bundle `input`, `copy`, and
`output` merge source. The exported
`allBundles` manifest must remain a literal, non-mutated structure; computed,
spread, or post-declaration assembly is rejected because it cannot be audited
fail-closed.

Every production-reachable Flash bridge source (apart from the neutral root
barrel) is hash-bound and public-surface-owned by its namespace capability.
Bridge capabilities use TypeScript obligations even when implemented over
native engine/browser services, so native disposition cannot bypass signature,
static/instance member, modifier, accessor, constructor, or index-surface pins.

The admitted bitmap bridge owns CPU pixel storage, native texture publication,
`BitmapDataChannel`, and the source-visible `Bitmap` state surface. It does not
claim a renderer implementation for `PixelSnapping.AUTO` or
`PixelSnapping.ALWAYS`; those members remain a downstream mapping hold until a
Bitmap-specific transform-aware render path exists. `BitmapData.draw` and
`BitmapData.applyFilter` are intentionally absent rather than throw-only
mapped stubs, and remain separate raster/filter workpacks.

Run the mandatory gates with:

```text
npm run check:authored-content-admission
npm run test:authored-content-admission
npm run verify:authored-content-capabilities
```

The normal engine build has one exact, non-swallowable sequence: admission,
evidence execution, then `buildEngine`. Editor compilation is a separate
IDE-aware gate and is not pulled into production engine builds.
