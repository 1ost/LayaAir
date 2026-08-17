# Authored image publish pipeline

Authoring keeps images as loose files addressed by stable AssetDb UUIDs. A
project supplies one explicit media-map declaration for every common or
locale-owned UUID; locale lookup is data, never a filename convention or
runtime fallback.

`createAuthoredImagePublishPlan` validates and sorts that inventory, then
partitions it by ownership, lifecycle, sampler, alpha model, color space,
compression, and repeat policy. Clamp images receive deterministic atlas page
placements. Repeating or oversized images receive explicit loose publish
records because hardware repeat cannot safely sample an atlas sub-rectangle.
The generated `.atlas` documents use Laya's existing `AtlasLoader` shape and
cache each frame as `res://<uuid>`.

## Required IDE build hook

The engine repository does not expose the LayaAir IDE's asset-publish event or
native image encoder. The IDE integration must therefore provide the required
`AuthoredImagePublishWriter` at its normal pre-publish/publish seam. That
writer must:

1. read the loose source paths from the frozen plan;
2. extrude each placement's declared padding and compose pixels at the exact
   planned coordinates;
3. encode deterministic PNG or KTX1 bytes with the declared alpha, color-space,
   sampler, compression, and mip policy;
4. write the exact planned relative paths atomically; and
5. return the actual dimensions, paths, and SHA-256 digests for validation.

There is intentionally no default writer, browser canvas encoder, runtime
packer, secondary loader, or loose-image fallback. Once the writer completes,
call `verifyAuthoredImageNativePreview` with
`createLayaAtlasPreviewLoader(Laya.loader)`. Verification loads every emitted
manifest through the standard `atlas` loader and checks the native cached
texture for every packed `res://<uuid>`.
