# Authored-content runtime

This is the single Laya-owned runtime for neutral authored bindings and the
source-visible Flash API shape needed by ported TypeScript. Display, input,
text, timeline and event behavior run on real Laya classes. Production never
loads SWF/ABC, legacy prefab/timeline formats, or a second display runtime.

Serialized hierarchies must use canonical Laya `_$type` IDs. `_$runtime` is
reserved for application linkage classes and `_$var` for named injection.
Call `registerAuthoredContentRuntime` with the explicit application linkage
constructors before loading a linked hierarchy. The bootstrap rejects Flash
type aliases, collisions and non-Laya constructors.

The neutral binding schema remains a fail-closed admission and lifecycle seam.
Ported business classes use `addEventListener`, named fields and timeline
methods directly; there is no `createSourceApi` wrapper or ABC callback path.
