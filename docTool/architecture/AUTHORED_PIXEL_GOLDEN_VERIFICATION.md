# Authored-content pixel-golden verification

LayaAir owns the generic pixel-evidence format and verifier used by authored-content conversion lanes. The verifier compares canonical, top-to-bottom, straight-alpha sRGB RGBA captures. It does not render content, select a fallback renderer, know an application asset, or claim that general rendering fidelity is complete.

Each capture is canonical JSON and records exact dimensions, raw RGBA and capture-body SHA-256 identities, plus explicit browser, backend, platform, device-pixel-ratio, font-rasterizer, and font-manifest pins. JSON artifacts must be exact canonical, BOM-free UTF-8; malformed byte sequences are rejected rather than normalized by a replacement-character decoder. Comparison requires byte-authenticated captures. Because every accepted input byte sequence equals its canonical serialization, the receipt's artifact SHA-256 identifies the exact accepted file bytes. A changed environment or dimensions fails closed even when a permissive pixel policy would otherwise pass.

The default policy is exact equality. An explicitly supplied policy is included in the authenticated receipt. Receipts record exact source and candidate artifact/capture/RGBA identities, dimensions, environment identities, per-channel and aggregate straight-RGBA metrics (including the integer squared-delta total that authenticates RMS derivation), minimal diff bounds, mismatch reasons, and their own SHA-256 identity. Receipt readers and writers enforce the complete schema, metric invariants, and matching/mismatching conditional forms before accepting the receipt hash. All artifacts use deterministic UTF-8 JSON with sorted keys, two-space indentation, and one LF terminator.

## Commands

Create a capture from a raw RGBA byte file and a canonical environment JSON file:

```text
npm run authored-pixel-golden -- capture --rgba frame.rgba --width 320 --height 240 --environment environment.json --output frame.capture.json
```

Compare a source golden to a candidate. Exit status is `0` for a pass, `1` for an authenticated comparison failure, and `2` for invalid or noncanonical input:

```text
npm run authored-pixel-golden -- compare --source source.capture.json --candidate candidate.capture.json --receipt comparison.receipt.json
```

An optional canonical policy JSON may be passed with `--policy`. Policy fields are deliberately exhaustive and are always recorded in the receipt. Golden generation, renderer orchestration, browser installation, font installation, and application-specific baselines remain responsibilities of their respective LayaAir publishing/test lanes; this primitive does not silently provide them.
