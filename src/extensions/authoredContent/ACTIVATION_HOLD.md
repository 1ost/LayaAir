# IDE activation gate — HOLD

The package compiles separately against the installed LayaAir IDE 3.4 UI and
Scene declarations, and its staged package inventory is exact. The installed
IDE exposes no documented headless command that activates an unpacked editor
extension and reports decorator registrations.

MVP activation therefore remains **HOLD** until an IDE-host smoke run records
all of the following:

1. The laya.authoredContent package loads both UIMain.js and EnvMain.js without
   an extension error.
2. swfxml and xflbundle appear as Authored Content Source files.
3. Reimport creates exactly the semantic children prefab (.lh) and timeline
   (.mc).
4. The metadata inspector applies settings and calls reimport.
5. The preview panel creates AuthoredContentPreviewScene, loads the generated
   .lh with Laya.Loader.HIERARCHY, and renders it.

Build/typecheck/unit gates do not substitute for this IDE-host activation gate.
