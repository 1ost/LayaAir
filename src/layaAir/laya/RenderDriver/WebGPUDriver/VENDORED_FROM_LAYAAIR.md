# Vendored WebGPU driver provenance

LayaAir references `src/layaAir/laya/RenderDriver/WebGPUDriver` as a private
GitHub submodule. A fresh checkout cannot initialize that gitlink without
access to `git@github.com:layabox/WebGPUDriver.git`, so the source is stored as
ordinary files in this repository instead.

## Recoverable TypeScript baseline

- LayaAir superproject commit: `0e1101c47873b8ac994741112d68f236509c4cd1`
- Commit date: `2025-07-08T15:53:16+08:00`
- WebGPU driver tree: `72579e4c7814d1de95db8b9b66951c538858dfbd`
- Recovered files: 85
- Replaced inaccessible gitlink: `af400048ae6318a1d526087a42df4d662ea2dab5`

That commit is the newest WebGPU driver revision still present as a normal
source tree in the available LayaAir history. It provides reviewable
TypeScript and history instead of an uninitialized directory.

## Installed 3.4.0 compatibility reference

Forward ports are checked against the locally installed LayaAirIDE 3.4.0
runtime at:

`C:\Users\admin\AppData\Local\Programs\LayaAirIDE\resources\engine\libs\laya.webgpu_2D.js.map`

The source map contains 72 WebGPU 2D/RenderDevice module bodies and has SHA-256
`8D45646A00F10AB75EFEEE6E6B750C8F764CE9EDDD38F6B20078FCEC926048A6`.
It is a compatibility reference, not copied generated output. Changes in this
directory remain TypeScript source and must pass the repository's build and
runtime gates.

## Maintenance rule

Keep this directory as ordinary tracked source until the upstream driver can
be fetched reproducibly. If upstream access becomes available, compare its
tree and retain the compositor changes before restoring a submodule.
