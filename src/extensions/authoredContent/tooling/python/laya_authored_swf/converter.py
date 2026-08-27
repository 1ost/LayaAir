#!/usr/bin/env python3
"""Inspect, extract, convert, and validate Adobe SWFs for native LayaAir use."""

from __future__ import annotations

import argparse
import hashlib
import json
import lzma
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import zlib
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET

TOOL_VERSION = "1.5.0"
DEFAULT_NATIVE_CALLBACK_MANIFEST: Path | None = None
SUPPORTED_XML_MAJORS = {2, 3}
VISUAL_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
# FFDec's retained DefineBitsLossless families and composited JPEG alpha are
# emitted as PNG.  Other extensions cannot prove full 8-bit alpha plus
# lossless pixels from the path alone, so keep this acceptance boundary narrow.
LOSSLESS_BITMAP_SUFFIXES = {".png"}
AUDIO_SUFFIXES = {".mp3", ".wav", ".ogg", ".flac"}
FONT_SUFFIXES = {".ttf", ".otf", ".woff", ".woff2"}
TEXT_SUFFIXES = {".txt"}
EVIDENCE_SUFFIXES = VISUAL_SUFFIXES | AUDIO_SUFFIXES | FONT_SUFFIXES | TEXT_SUFFIXES
FLASH_BLEND_MODES = {
    0: "normal",
    1: "normal",
    2: "layer",
    3: "multiply",
    4: "screen",
    5: "lighten",
    6: "darken",
    7: "difference",
    8: "add",
    9: "subtract",
    10: "invert",
    11: "alpha",
    12: "erase",
    13: "overlay",
    14: "hardlight",
}

FILTER_KINDS = {
    "DROPSHADOWFILTER": "drop-shadow",
    "BLURFILTER": "blur",
    "GLOWFILTER": "glow",
    "BEVELFILTER": "bevel",
    "GRADIENTGLOWFILTER": "gradient-glow",
    "CONVOLUTIONFILTER": "convolution",
    "COLORMATRIXFILTER": "color-matrix",
    "GRADIENTBEVELFILTER": "gradient-bevel",
}

PARAMETERIZED_FEATURES = {
    "advancedTextSettings",
    "bitmapDefinitions",
    "placedColorTransforms",
    "scalingGrids",
}

BITMAP_TAG_DEFINITIONS: dict[int, dict[str, Any]] = {
    6: {
        "sourceTag": "DefineBitsTag",
        "encoding": "jpeg-tables",
        "alphaMode": "none",
        "lossless": False,
    },
    20: {
        "sourceTag": "DefineBitsLosslessTag",
        "encoding": "zlib-lossless",
        "alphaMode": "none",
        "lossless": True,
    },
    21: {
        "sourceTag": "DefineBitsJPEG2Tag",
        "encoding": "inline-image",
        "alphaMode": "none",
        "lossless": False,
    },
    35: {
        "sourceTag": "DefineBitsJPEG3Tag",
        "encoding": "inline-image",
        "alphaMode": "separate-zlib",
        "lossless": False,
    },
    36: {
        "sourceTag": "DefineBitsLossless2Tag",
        "encoding": "zlib-lossless",
        "alphaMode": "premultiplied",
        "lossless": True,
    },
    90: {
        "sourceTag": "DefineBitsJPEG4Tag",
        "encoding": "inline-image",
        "alphaMode": "separate-zlib",
        "lossless": False,
    },
}
BITMAP_XML_TAG_CODES = {
    definition["sourceTag"]: code
    for code, definition in BITMAP_TAG_DEFINITIONS.items()
}


class SwfToolError(RuntimeError):
    pass


FFDEC_JAR_ENVIRONMENT_VARIABLE = "LAYA_AUTHORED_CONTENT_FFDEC_JAR"


def _config_ffdec_jar(config_path: Path) -> Path:
    """Resolve an FFDec setting from an explicitly selected project config."""
    config_path = config_path.resolve()
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SwfToolError(f"invalid converter config {config_path}: {error}") from error
    ffdec_raw = raw.get("ffdec_jar") if isinstance(raw, dict) else None
    if not isinstance(ffdec_raw, str) or not ffdec_raw.strip():
        raise SwfToolError(f"converter config does not declare ffdec_jar: {config_path}")
    candidate = Path(ffdec_raw)
    if candidate.is_absolute():
        return candidate.resolve()
    repository_root_raw = raw.get("repository_root")
    if isinstance(repository_root_raw, str) and repository_root_raw.strip():
        toolkit_root = config_path.parent.parent
        repository_root = (toolkit_root / repository_root_raw).resolve()
        return (repository_root / candidate).resolve()
    return (config_path.parent / candidate).resolve()


def resolve_ffdec_jar(
    explicit: Path | None = None,
    config_path: Path | None = None,
) -> Path:
    """Resolve FFDec without depending on an application repository module."""
    if explicit is not None:
        return explicit.resolve()
    environment = os.environ.get(FFDEC_JAR_ENVIRONMENT_VARIABLE)
    if environment:
        return Path(environment).resolve()
    if config_path is not None:
        return _config_ffdec_jar(config_path)
    raise SwfToolError(
        "FFDec is required for extract; pass --ffdec-jar, set "
        f"{FFDEC_JAR_ENVIRONMENT_VARIABLE}, or pass --config with ffdec_jar"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffdec_metadata(jar: Path) -> dict[str, str]:
    """Read reproducibility metadata embedded by the JPEXS build."""
    try:
        with zipfile.ZipFile(jar) as archive:
            raw = archive.read("project.properties").decode("utf-8", errors="replace")
    except (OSError, KeyError, zipfile.BadZipFile):
        return {}
    result: dict[str, str] = {}
    for line in raw.splitlines():
        if not line or line.lstrip().startswith(("#", "!")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() in {"version", "build", "buildtime", "builder", "nightly"}:
            result[key.strip()] = value.strip().replace("\\:", ":")
    return result


def ffdec_capabilities(jar: Path) -> dict[str, bool]:
    """Detect CLI syntax that changed across bundled FFDec generations."""
    try:
        with zipfile.ZipFile(jar) as archive:
            help_text = archive.read(
                "com/jpexs/decompiler/flash/console/help.txt"
            ).decode("utf-8", errors="replace")
    except (OSError, KeyError, zipfile.BadZipFile):
        return {"swf2xml_external": False}
    return {
        "swf2xml_external": bool(
            re.search(r"^-swf2xml\s+\[-external\b", help_text, re.MULTILINE)
        )
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def prepare_owned_output(output: Path, marker_name: str, schema: str, force: bool) -> None:
    """Require an empty or provably tool-owned output; refresh it without stale files."""
    if not output.exists():
        return
    if not output.is_dir():
        raise SwfToolError(f"output exists and is not a directory: {output}")
    if not any(output.iterdir()):
        return
    marker = output / marker_name
    try:
        value = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SwfToolError(
            f"refusing to replace unowned/non-empty output {output}; expected valid {marker_name}"
        ) from error
    if value.get("schema") != schema:
        raise SwfToolError(
            f"refusing to replace output with marker schema {value.get('schema')!r}; expected {schema!r}"
        )
    if not force:
        raise SwfToolError(f"tool-owned output already exists: {output}; pass --force to refresh it")
    resolved = output.resolve()
    if resolved in {Path(resolved.anchor), Path.cwd().resolve(), Path.home().resolve()} or len(resolved.parts) < 3:
        raise SwfToolError(f"refusing unsafe output refresh target: {resolved}")
    shutil.rmtree(resolved)


def safe_name(value: str, fallback: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return clean or fallback


class BitReader:
    def __init__(self, data: bytes):
        self.data = data
        self.bit = 0

    def unsigned(self, count: int) -> int:
        if count < 0 or self.bit + count > len(self.data) * 8:
            raise SwfToolError("truncated SWF bit field")
        value = 0
        for _ in range(count):
            byte = self.data[self.bit // 8]
            value = value << 1 | (byte >> (7 - self.bit % 8) & 1)
            self.bit += 1
        return value

    def signed(self, count: int) -> int:
        value = self.unsigned(count)
        return value - (1 << count) if count and value & (1 << (count - 1)) else value

    @property
    def byte_position(self) -> int:
        return (self.bit + 7) // 8


def _uncompressed_body(data: bytes) -> tuple[str, bytes]:
    signature = data[:3]
    if signature == b"FWS":
        return "none", data[8:]
    if signature == b"CWS":
        try:
            return "zlib", zlib.decompress(data[8:])
        except zlib.error as error:
            raise SwfToolError(f"invalid CWS zlib stream: {error}") from error
    if signature == b"ZWS":
        if len(data) < 17:
            raise SwfToolError("truncated ZWS LZMA header")
        props = data[12:17]
        encoded = props[0]
        lc = encoded % 9
        remainder = encoded // 9
        lp = remainder % 5
        pb = remainder // 5
        if pb > 4:
            raise SwfToolError("invalid ZWS LZMA properties")
        dictionary_size = int.from_bytes(props[1:5], "little")
        try:
            body = lzma.decompress(
                data[17:],
                format=lzma.FORMAT_RAW,
                filters=[{"id": lzma.FILTER_LZMA1, "dict_size": dictionary_size, "lc": lc, "lp": lp, "pb": pb}],
            )
        except lzma.LZMAError as error:
            raise SwfToolError(f"invalid ZWS LZMA stream: {error}") from error
        return "lzma", body
    raise SwfToolError(f"not a SWF: expected FWS/CWS/ZWS, found {signature!r}")


def _inspect_swf_header(data: bytes, path: str, compression: str, body: bytes) -> dict[str, Any]:
    reader = BitReader(body)
    nbits = reader.unsigned(5)
    if not 1 <= nbits <= 31:
        raise SwfToolError(f"invalid SWF RECT width: {nbits} bits")
    xmin, xmax, ymin, ymax = (reader.signed(nbits) for _ in range(4))
    offset = reader.byte_position
    if len(body) < offset + 4:
        raise SwfToolError("SWF is truncated before frame metadata")
    frame_rate = body[offset + 1] + body[offset] / 256.0
    frame_count = int.from_bytes(body[offset + 2 : offset + 4], "little")
    declared_length = int.from_bytes(data[4:8], "little")
    logical_length = 8 + len(body)
    return {
        "schema": "swf-header@1",
        "path": path,
        "sha256": hashlib.sha256(data).hexdigest(),
        "signature": data[:3].decode("ascii", errors="replace"),
        "compression": compression,
        "swf_version": data[3],
        "declared_uncompressed_length": declared_length,
        "actual_uncompressed_length": logical_length,
        "length_matches_header": declared_length == logical_length,
        "stage_twips": {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax},
        "stage": {
            "x": xmin / 20.0,
            "y": ymin / 20.0,
            "width": (xmax - xmin) / 20.0,
            "height": (ymax - ymin) / 20.0,
        },
        "frame_rate": frame_rate,
        "frame_count": frame_count,
    }


def inspect_swf_bytes(data: bytes, path: str = "<memory>") -> dict[str, Any]:
    if len(data) < 12:
        raise SwfToolError("SWF is shorter than its fixed header")
    compression, body = _uncompressed_body(data)
    return _inspect_swf_header(data, path, compression, body)


def inspect_swf(path: Path) -> dict[str, Any]:
    path = path.resolve()
    return inspect_swf_bytes(path.read_bytes(), str(path))


SWF_TAG_NAMES = {
    0: "End",
    1: "ShowFrame",
    2: "DefineShape",
    4: "PlaceObject",
    5: "RemoveObject",
    6: "DefineBits",
    7: "DefineButton",
    8: "JPEGTables",
    9: "SetBackgroundColor",
    10: "DefineFont",
    11: "DefineText",
    12: "DoAction",
    13: "DefineFontInfo",
    14: "DefineSound",
    15: "StartSound",
    17: "DefineButtonSound",
    18: "SoundStreamHead",
    19: "SoundStreamBlock",
    20: "DefineBitsLossless",
    21: "DefineBitsJPEG2",
    22: "DefineShape2",
    23: "DefineButtonCxform",
    24: "Protect",
    26: "PlaceObject2",
    28: "RemoveObject2",
    32: "DefineShape3",
    33: "DefineText2",
    34: "DefineButton2",
    35: "DefineBitsJPEG3",
    36: "DefineBitsLossless2",
    37: "DefineEditText",
    39: "DefineSprite",
    41: "ProductInfo",
    43: "FrameLabel",
    45: "SoundStreamHead2",
    46: "DefineMorphShape",
    48: "DefineFont2",
    56: "ExportAssets",
    57: "ImportAssets",
    58: "EnableDebugger",
    59: "DoInitAction",
    60: "DefineVideoStream",
    61: "VideoFrame",
    62: "DefineFontInfo2",
    63: "DebugID",
    64: "EnableDebugger2",
    65: "ScriptLimits",
    66: "SetTabIndex",
    69: "FileAttributes",
    70: "PlaceObject3",
    71: "ImportAssets2",
    72: "DoABCDeprecated",
    73: "DefineFontAlignZones",
    74: "CSMTextSettings",
    75: "DefineFont3",
    76: "SymbolClass",
    77: "Metadata",
    78: "DefineScalingGrid",
    82: "DoABC",
    83: "DefineShape4",
    84: "DefineMorphShape2",
    86: "DefineSceneAndFrameLabelData",
    87: "DefineBinaryData",
    88: "DefineFontName",
    89: "StartSound2",
    90: "DefineBitsJPEG4",
    91: "DefineFont4",
    93: "EnableTelemetry",
    94: "PlaceObject4",
}


def _increment_feature(features: dict[str, int], name: str, count: int = 1) -> None:
    features[name] = features.get(name, 0) + count


def _record_parameter(
    parameters: dict[str, dict[str, dict[str, Any]]],
    feature: str,
    value: dict[str, Any],
) -> None:
    key = json.dumps(value, sort_keys=True, separators=(",", ":"))
    records = parameters.setdefault(feature, {})
    if key not in records:
        records[key] = {"value": value, "count": 0}
    records[key]["count"] += 1


def _skip_swf_string(data: bytes, offset: int) -> int:
    end = data.find(b"\x00", offset)
    if end < 0:
        raise SwfToolError("truncated SWF string")
    return end + 1


def _skip_swf_matrix(data: bytes, offset: int) -> int:
    reader = BitReader(data[offset:])
    if reader.unsigned(1):
        width = reader.unsigned(5)
        reader.signed(width)
        reader.signed(width)
    if reader.unsigned(1):
        width = reader.unsigned(5)
        reader.signed(width)
        reader.signed(width)
    width = reader.unsigned(5)
    reader.signed(width)
    reader.signed(width)
    return offset + reader.byte_position


def _read_swf_color_transform(
    data: bytes,
    offset: int,
    *,
    with_alpha: bool,
) -> dict[str, list[int]]:
    reader = BitReader(data[offset:])
    has_add = bool(reader.unsigned(1))
    has_multiply = bool(reader.unsigned(1))
    width = reader.unsigned(4)
    channel_count = 4 if with_alpha else 3
    multipliers = [256] * channel_count
    offsets = [0] * channel_count
    if has_multiply:
        multipliers = [reader.signed(width) for _ in range(channel_count)]
    if has_add:
        offsets = [reader.signed(width) for _ in range(channel_count)]
    if not with_alpha:
        multipliers.append(256)
        offsets.append(0)
    return {"multipliers": multipliers, "offsets": offsets}


def _color_transform_profile(value: dict[str, list[int]]) -> dict[str, Any]:
    multipliers = value["multipliers"]
    offsets = value["offsets"]
    rgb_multipliers = multipliers[:3]
    rgb_offsets = offsets[:3]
    alpha_multiplier = multipliers[3]
    alpha_offset = offsets[3]

    if rgb_multipliers == [256, 256, 256]:
        rgb_multiplier_class = "identity"
    elif any(item < 0 for item in rgb_multipliers):
        rgb_multiplier_class = "contains-negative"
    elif any(item == 0 for item in rgb_multipliers):
        rgb_multiplier_class = "contains-zero"
    else:
        rgb_multiplier_class = "modified-positive"

    if rgb_offsets == [0, 0, 0]:
        rgb_offset_class = "zero"
    elif all(item >= 0 for item in rgb_offsets):
        rgb_offset_class = "positive"
    elif all(item <= 0 for item in rgb_offsets):
        rgb_offset_class = "negative"
    else:
        rgb_offset_class = "mixed-sign"

    alpha_multiplier_class = (
        "negative" if alpha_multiplier < 0
        else "zero" if alpha_multiplier == 0
        else "identity" if alpha_multiplier == 256
        else "modified-positive"
    )
    alpha_offset_class = "negative" if alpha_offset < 0 else "positive" if alpha_offset > 0 else "zero"
    return {
        "rgbMultiplierClass": rgb_multiplier_class,
        "rgbOffsetClass": rgb_offset_class,
        "alphaMultiplierClass": alpha_multiplier_class,
        "alphaOffsetClass": alpha_offset_class,
        "zeroAlphaMultiplierWithOffset": alpha_multiplier == 0 and alpha_offset != 0,
    }


def _place_object_color_transform_profile(code: int, payload: bytes | memoryview) -> dict[str, Any] | None:
    data = bytes(payload)
    if code == 4:
        if len(data) < 5:
            raise SwfToolError("truncated PlaceObject header")
        offset = _skip_swf_matrix(data, 4)
        if offset == len(data):
            return None
        return _color_transform_profile(
            _read_swf_color_transform(data, offset, with_alpha=False)
        )
    if code not in {26, 70, 94} or not data or not data[0] & 0x08:
        return None
    flags = data[0]
    if code == 26:
        if len(data) < 3:
            raise SwfToolError("truncated PlaceObject2 header")
        extended = 0
        offset = 3
    else:
        if len(data) < 4:
            raise SwfToolError("truncated PlaceObject3/4 header")
        extended = data[1]
        offset = 4
        if extended & 0x08 or (extended & 0x10 and flags & 0x02):
            offset = _skip_swf_string(data, offset)
    if flags & 0x02:
        if offset + 2 > len(data):
            raise SwfToolError("truncated PlaceObject character id")
        offset += 2
    if flags & 0x04:
        offset = _skip_swf_matrix(data, offset)
    return _color_transform_profile(
        _read_swf_color_transform(data, offset, with_alpha=True)
    )


def _bitmap_tag_profile(code: int, payload: bytes | memoryview) -> dict[str, Any] | None:
    """Normalize the six standard SWF bitmap-definition families.

    The fixed fields are intentionally read from the binary tag stream.  FFDec
    XML remains the detailed conversion authority, while this profile makes
    every retained bitmap family visible in the corpus inventory instead of
    singling out DefineBitsJPEG4.
    """
    definition = BITMAP_TAG_DEFINITIONS.get(code)
    data = bytes(payload)
    if definition is None or len(data) < 2:
        return None
    value: dict[str, Any] = {
        "tagCode": code,
        "sourceTag": definition["sourceTag"],
        "characterId": int.from_bytes(data[:2], "little"),
        "encoding": definition["encoding"],
        "alphaMode": definition["alphaMode"],
        "lossless": definition["lossless"],
    }
    if code == 6:
        value["requiresJpegTables"] = True
    elif code in {20, 36}:
        if len(data) < 7:
            return None
        bitmap_format = data[2]
        value.update({
            "bitmapFormat": bitmap_format,
            "width": int.from_bytes(data[3:5], "little"),
            "height": int.from_bytes(data[5:7], "little"),
        })
        if bitmap_format == 3:
            if len(data) < 8:
                return None
            value["colorTableSize"] = data[7] + 1
    elif code in {35, 90}:
        minimum = 8 if code == 90 else 6
        if len(data) < minimum:
            return None
        value["alphaDataOffset"] = int.from_bytes(data[2:6], "little")
        if code == 90:
            deblock_param = int.from_bytes(data[6:8], "little") / 256
            value["deblockParam"] = deblock_param
            if deblock_param > 1:
                value["deblockParamOutOfRange"] = True
    return value


def _inspect_tag_features(
    code: int,
    payload: bytes | memoryview,
    features: dict[str, int],
    parameters: dict[str, dict[str, dict[str, Any]]],
) -> None:
    # Keep every feature recorder argument literal so the census can prove by
    # AST inspection that no computed feature name escapes admission.
    if code in {2, 22, 32, 83}:
        _increment_feature(features, "shapeDefinitions")
    if code in {7, 34}:
        _increment_feature(features, "buttonDefinitions")
    if code in {10, 48, 75, 91}:
        _increment_feature(features, "fontDefinitions")
    if code in {11, 33}:
        _increment_feature(features, "staticTextDefinitions")
    if code in {12, 59}:
        _increment_feature(features, "avm1Scripts")
    if code == 14:
        _increment_feature(features, "soundDefinitions")
    if code in {15, 89}:
        _increment_feature(features, "startSounds")
    if code == 17:
        _increment_feature(features, "buttonSounds")
    if code in {18, 45}:
        _increment_feature(features, "streamingAudioHeaders")
    if code == 19:
        _increment_feature(features, "streamingAudioBlocks")
    if code == 23:
        _increment_feature(features, "buttonColorTransforms")
    if code == 37:
        _increment_feature(features, "editTextDefinitions")
    if code == 39:
        _increment_feature(features, "spriteTimelines")
    if code in {46, 84}:
        _increment_feature(features, "morphShapes")
    if code in {57, 71}:
        _increment_feature(features, "importedLibraries")
    if code in {72, 82}:
        _increment_feature(features, "avm2Scripts")
    if code == 60:
        _increment_feature(features, "videoDefinitions")
    if code == 61:
        _increment_feature(features, "videoFrames")
    if code == 66:
        _increment_feature(features, "tabOrderSettings")
    if code == 73:
        _increment_feature(features, "fontAlignZones")
    if code == 74:
        _increment_feature(features, "advancedTextSettings")
    if code == 78:
        _increment_feature(features, "scalingGrids")
    if code == 86:
        _increment_feature(features, "sceneFrameMetadata")
    if code == 87:
        _increment_feature(features, "binaryDataDefinitions")
    if code == 93:
        _increment_feature(features, "telemetryTags")
    bitmap_profile = _bitmap_tag_profile(code, payload)
    if code in BITMAP_TAG_DEFINITIONS:
        _increment_feature(features, "bitmapDefinitions")
        if BITMAP_TAG_DEFINITIONS[code]["alphaMode"] != "none":
            _increment_feature(features, "alphaBitmapDefinitions")
        if BITMAP_TAG_DEFINITIONS[code]["lossless"]:
            _increment_feature(features, "losslessBitmapDefinitions")
        if code == 90:
            # Preserve the former feature name for downstream inventories while
            # making it a specialization of the normalized family.
            _increment_feature(features, "jpeg4Images")
        if bitmap_profile:
            _record_parameter(parameters, "bitmapDefinitions", bitmap_profile)
    if code in {12, 59, 72, 82}:
        _increment_feature(features, "actionScripts")
    if code == 7:
        # DefineButton always carries a legacy action-record stream after its
        # state records. A zero terminator may make it inert, but the binary
        # tag alone cannot prove that, so keep it review-visible.
        _increment_feature(features, "legacyButtonActionStreams")
    elif code == 34 and len(payload) >= 5:
        if int.from_bytes(payload[3:5], "little") != 0:
            _increment_feature(features, "buttonConditionalActions")
    if code == 74 and len(payload) >= 12:
        flags = payload[2]
        thickness, sharpness = struct.unpack_from("<ff", payload, 3)
        use_flash_type = flags >> 6 & 0x03
        grid_fit = flags >> 3 & 0x07
        _record_parameter(
            parameters,
            "advancedTextSettings",
            {
                "useFlashType": use_flash_type,
                "renderer": "advanced" if use_flash_type == 1 else "standard",
                "gridFit": grid_fit,
                "gridFitMode": {0: "none", 1: "pixel", 2: "subpixel"}.get(grid_fit, f"unknown-{grid_fit}"),
                "thickness": thickness,
                "sharpness": sharpness,
            },
        )
    elif code == 78 and len(payload) >= 3:
        try:
            reader = BitReader(payload[2:])
            nbits = reader.unsigned(5)
            xmin, xmax, ymin, ymax = (reader.signed(nbits) for _ in range(4))
            _record_parameter(
                parameters,
                "scalingGrids",
                {
                    "characterId": int.from_bytes(payload[:2], "little"),
                    "rectTwips": {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax},
                    "rect": {
                        "x": xmin / 20,
                        "y": ymin / 20,
                        "width": (xmax - xmin) / 20,
                        "height": (ymax - ymin) / 20,
                    },
                },
            )
        except SwfToolError:
            pass
    if code == 4:
        try:
            profile = _place_object_color_transform_profile(code, payload)
            if profile:
                _increment_feature(features, "placedColorTransforms")
                _record_parameter(parameters, "placedColorTransforms", profile)
        except SwfToolError:
            pass
    if code in {26, 70, 94} and payload:
        flags = payload[0]
        if flags & 0x80:
            _increment_feature(features, "clipActions")
        if flags & 0x40:
            _increment_feature(features, "depthMasks")
        if flags & 0x08:
            _increment_feature(features, "placedColorTransforms")
            try:
                profile = _place_object_color_transform_profile(code, payload)
                if profile:
                    _record_parameter(parameters, "placedColorTransforms", profile)
            except SwfToolError:
                # Keep the feature visible even when a malformed optional
                # payload cannot be classified. Parameter coverage below makes
                # the resulting gap fail-visible.
                pass
        if code in {70, 94} and len(payload) >= 2:
            extended = payload[1]
            if extended & 0x01:
                _increment_feature(features, "placeObjectFilters")
            if extended & 0x02:
                _increment_feature(features, "placeObjectBlendModes")
            if extended & 0x04:
                _increment_feature(features, "placeObjectBitmapCaches")
            if extended & 0x08:
                _increment_feature(features, "placeObjectClassNames")
            if extended & 0x20:
                _increment_feature(features, "placeObjectVisibility")
            if extended & 0x40:
                _increment_feature(features, "placeObjectOpaqueBackground")


def _swf_tag_inventory_body(body: bytes) -> dict[str, Any]:
    reader = BitReader(body)
    nbits = reader.unsigned(5)
    if not 1 <= nbits <= 31:
        raise SwfToolError(f"invalid SWF RECT width: {nbits} bits")
    for _ in range(4):
        reader.signed(nbits)
    tag_offset = reader.byte_position + 4
    if tag_offset > len(body):
        raise SwfToolError("SWF is truncated before its tag stream")

    counts: dict[int, int] = {}
    features: dict[str, int] = {}
    parameters: dict[str, dict[str, dict[str, Any]]] = {}
    issues: list[str] = []
    top_level_count = 0
    nested_count = 0
    max_depth = 0

    def parse_stream(stream: memoryview, start: int, end: int, depth: int) -> None:
        nonlocal top_level_count, nested_count, max_depth
        if depth > 256:
            raise SwfToolError("SWF sprite nesting exceeds 256 levels")
        cursor = start
        max_depth = max(max_depth, depth)
        saw_end = False
        while cursor < end:
            if cursor + 2 > end:
                issues.append(f"truncated tag header at depth {depth} offset {cursor}")
                return
            record_header = int.from_bytes(stream[cursor : cursor + 2], "little")
            cursor += 2
            code = record_header >> 6
            length = record_header & 0x3F
            if length == 0x3F:
                if cursor + 4 > end:
                    issues.append(f"truncated long tag length at depth {depth} offset {cursor}")
                    return
                length = int.from_bytes(stream[cursor : cursor + 4], "little")
                cursor += 4
            payload_end = cursor + length
            if payload_end > end:
                issues.append(
                    f"tag {code} extends {payload_end - end} bytes beyond depth {depth} stream"
                )
                return
            payload_start = cursor
            payload = stream[payload_start:payload_end]
            cursor = payload_end
            counts[code] = counts.get(code, 0) + 1
            if depth == 0:
                top_level_count += 1
            else:
                nested_count += 1
            _inspect_tag_features(code, payload, features, parameters)
            if code == 39:
                if len(payload) < 4:
                    issues.append("DefineSprite payload is shorter than its fixed header")
                else:
                    parse_stream(stream, payload_start + 4, payload_end, depth + 1)
            if code == 0:
                saw_end = True
                break
        if not saw_end:
            issues.append(f"tag stream at depth {depth} has no End tag")

    parse_stream(memoryview(body), tag_offset, len(body), 0)
    parameter_records = {
        feature: [records[key] for key in sorted(records)]
        for feature, records in sorted(parameters.items())
    }
    parameter_coverage = []
    for feature in sorted(PARAMETERIZED_FEATURES & features.keys()):
        detected_count = features[feature]
        profiled_count = sum(
            int(record["count"])
            for record in parameter_records.get(feature, [])
        )
        unclassified_count = detected_count - profiled_count
        parameter_coverage.append(
            {
                "feature": feature,
                "detectedCount": detected_count,
                "profiledCount": profiled_count,
                "unclassifiedCount": unclassified_count,
            }
        )
        if unclassified_count:
            issues.append(
                f"{feature} parameter coverage mismatch: detected {detected_count}, "
                f"profiled {profiled_count}"
            )

    tags = [
        {
            "code": code,
            "name": SWF_TAG_NAMES.get(code, f"UnknownTag{code}"),
            "count": count,
        }
        for code, count in sorted(counts.items())
    ]
    return {
        "schema": "swf-tag-inventory@1",
        "totalTagCount": top_level_count + nested_count,
        "topLevelTagCount": top_level_count,
        "nestedTagCount": nested_count,
        "maxSpriteDepth": max_depth,
        "tags": tags,
        "features": dict(sorted((name, count) for name, count in features.items() if count)),
        "parameters": parameter_records,
        "parameterCoverage": parameter_coverage,
        "unknownTagCodes": sorted(code for code in counts if code not in SWF_TAG_NAMES),
        "issues": issues,
    }


def swf_tag_inventory_bytes(data: bytes) -> dict[str, Any]:
    """Inventory top-level and nested sprite tags without requiring Java.

    This intentionally records structural risk signals rather than pretending
    to replace JPEXS. Detailed filter, shape-fill, text, and action semantics
    are still taken from the lossless FFDec XML during conversion.
    """
    _, body = _uncompressed_body(data)
    return _swf_tag_inventory_body(body)


def swf_tag_records_bytes(data: bytes, selected_codes: set[int] | None = None) -> list[tuple[int, bytes, int]]:
    """Return lossless tag payloads, including tags nested in DefineSprite.

    This is intentionally a narrow structural primitive for corpus auditors.
    Semantic conversion continues to use JPEXS XML, while auditors can inspect
    fixed-format tags without materializing every shape and bitmap in a SWF.
    """
    _, body = _uncompressed_body(data)
    reader = BitReader(body)
    nbits = reader.unsigned(5)
    if not 1 <= nbits <= 31:
        raise SwfToolError(f"invalid SWF RECT width: {nbits} bits")
    for _ in range(4):
        reader.signed(nbits)
    tag_offset = reader.byte_position + 4
    if tag_offset > len(body):
        raise SwfToolError("SWF is truncated before its tag stream")

    records: list[tuple[int, bytes, int]] = []

    def parse_stream(start: int, end: int, depth: int) -> None:
        if depth > 256:
            raise SwfToolError("SWF sprite nesting exceeds 256 levels")
        cursor = start
        saw_end = False
        while cursor < end:
            if cursor + 2 > end:
                raise SwfToolError(f"truncated tag header at depth {depth} offset {cursor}")
            record_header = int.from_bytes(body[cursor:cursor + 2], "little")
            cursor += 2
            code = record_header >> 6
            length = record_header & 0x3F
            if length == 0x3F:
                if cursor + 4 > end:
                    raise SwfToolError(f"truncated long tag length at depth {depth} offset {cursor}")
                length = int.from_bytes(body[cursor:cursor + 4], "little")
                cursor += 4
            payload_start = cursor
            payload_end = payload_start + length
            if payload_end > end:
                raise SwfToolError(f"tag {code} extends beyond depth {depth} stream")
            if selected_codes is None or code in selected_codes:
                records.append((code, body[payload_start:payload_end], depth))
            if code == 39:
                if length < 4:
                    raise SwfToolError("DefineSprite payload is shorter than its fixed header")
                parse_stream(payload_start + 4, payload_end, depth + 1)
            cursor = payload_end
            if code == 0:
                saw_end = True
                break
        if not saw_end:
            raise SwfToolError(f"tag stream at depth {depth} has no End tag")

    parse_stream(tag_offset, len(body), 0)
    return records


def analyze_swf_bytes(data: bytes, path: str = "<memory>") -> tuple[dict[str, Any], dict[str, Any]]:
    """Return header and structural inventory after one decompression pass."""
    if len(data) < 12:
        raise SwfToolError("SWF is shorter than its fixed header")
    compression, body = _uncompressed_body(data)
    return (
        _inspect_swf_header(data, path, compression, body),
        _swf_tag_inventory_body(body),
    )


def swf_tag_inventory(path: Path) -> dict[str, Any]:
    return swf_tag_inventory_bytes(path.resolve().read_bytes())


def catalog_summary(data: bytes) -> dict[str, Any]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise SwfToolError(f"invalid SWC catalog.xml: {error}") from error
    local = lambda element: element.tag.rsplit("}", 1)[-1]
    scripts = [element for element in root.iter() if local(element) == "script"]
    definitions = sorted(
        element.attrib["id"]
        for element in root.iter()
        if local(element) == "def" and element.attrib.get("id")
    )
    dependencies = [element.attrib.get("id", "") for element in root.iter() if local(element) == "dep"]
    return {
        "scriptCount": len(scripts),
        "definitionCount": len(definitions),
        "dependencyCount": len(dependencies),
        "flashDependencyCount": sum(value.startswith("flash.") for value in dependencies),
        "definitions": definitions,
    }


def unpack_swc(input_path: Path, output: Path, force: bool) -> dict[str, Any]:
    input_path = input_path.resolve()
    output = output.resolve()
    if not input_path.is_file() or not zipfile.is_zipfile(input_path):
        raise SwfToolError(f"input is not a readable SWC/ZIP: {input_path}")
    if output in input_path.parents:
        raise SwfToolError("SWC output cannot be an ancestor of the input archive")
    with zipfile.ZipFile(input_path) as archive:
        names = archive.namelist()
        if "catalog.xml" not in names:
            raise SwfToolError("SWC lacks catalog.xml")
        library_names = sorted(value for value in names if value.lower().endswith(".swf"))
        destinations: dict[str, str] = {}
        for name in library_names:
            raw_path = Path(name.replace("\\", "/"))
            if raw_path.is_absolute() or ".." in raw_path.parts:
                raise SwfToolError(f"unsafe SWC library path: {name}")
            destination_name = raw_path.name.casefold()
            previous = destinations.get(destination_name)
            if previous is not None:
                raise SwfToolError(
                    "SWC library destination basename is duplicated: "
                    f"{previous!r} and {name!r}"
                )
            destinations[destination_name] = name
    prepare_owned_output(output, "swc-manifest.json", "swc-evidence@1", force)
    manifest_path = output / "swc-manifest.json"
    output.mkdir(parents=True, exist_ok=True)
    write_json(manifest_path, {
        "schema": "swc-evidence@1",
        "toolVersion": TOOL_VERSION,
        "complete": False,
        "libraries": [],
    })
    with zipfile.ZipFile(input_path) as archive:
        catalog = archive.read("catalog.xml")
        (output / "catalog.xml").write_bytes(catalog)
        libraries: list[dict[str, Any]] = []
        for name in library_names:
            raw_path = Path(name.replace("\\", "/"))
            if raw_path.is_absolute() or ".." in raw_path.parts:
                raise SwfToolError(f"unsafe SWC library path: {name}")
            data = archive.read(name)
            destination = output / "libraries" / raw_path.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            header = inspect_swf_bytes(data, destination.relative_to(output).as_posix())
            libraries.append(
                {
                    "archivePath": name,
                    "path": destination.relative_to(output).as_posix(),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "size": len(data),
                    "header": header,
                }
            )
    manifest = {
        "schema": "swc-evidence@1",
        "toolVersion": TOOL_VERSION,
        "complete": True,
        "source": {"name": input_path.name, "sha256": sha256_file(input_path), "size": input_path.stat().st_size},
        "catalog": {"path": "catalog.xml", "sha256": hashlib.sha256(catalog).hexdigest(), **catalog_summary(catalog)},
        "libraries": libraries,
    }
    write_json(manifest_path, manifest)
    return manifest


def _resolve_java(explicit: Path | None) -> str:
    if explicit:
        candidate = explicit.resolve()
        if not candidate.is_file():
            raise SwfToolError(f"Java executable does not exist: {candidate}")
        return str(candidate)
    found = shutil.which("java")
    if not found:
        raise SwfToolError("Java was not found. Install a JDK or pass --java C:\\path\\to\\java.exe")
    return found


def _run_logged(command: list[str], cwd: Path, stdout_path: Path, stderr_path: Path) -> dict[str, Any]:
    completed = subprocess.run(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    stdout_path.write_bytes(completed.stdout)
    stderr_path.write_bytes(completed.stderr)
    return {
        "argv": command,
        "exit_code": completed.returncode,
        "stdout": stdout_path.relative_to(cwd).as_posix(),
        "stderr": stderr_path.relative_to(cwd).as_posix(),
        "stdout_sha256": sha256_file(stdout_path),
        "stderr_sha256": sha256_file(stderr_path),
    }


def extract_swf(input_path: Path, output: Path, java: Path | None, ffdec_jar: Path, force: bool) -> dict[str, Any]:
    input_path = input_path.resolve()
    output = output.resolve()
    if not input_path.is_file():
        raise SwfToolError(f"input SWF does not exist: {input_path}")
    if output in input_path.parents:
        raise SwfToolError("extraction output cannot be an ancestor of the input SWF")
    if not ffdec_jar.is_file():
        raise SwfToolError(f"FFDec JAR does not exist: {ffdec_jar}")
    java_executable = _resolve_java(java)
    header = inspect_swf(input_path)
    header["path"] = input_path.name
    prepare_owned_output(output, "extraction-manifest.json", "swf-extraction@1", force)
    manifest_path = output / "extraction-manifest.json"
    output.mkdir(parents=True, exist_ok=True)
    logs = output / "logs"
    evidence = output / "evidence"
    logs.mkdir(exist_ok=True)
    evidence.mkdir(exist_ok=True)
    write_json(output / "swf-header.json", header)

    capabilities = ffdec_capabilities(ffdec_jar)
    prefix = [java_executable, "-jar", str(ffdec_jar.resolve()), "-cli"]
    swf2xml_command = prefix + ["-swf2xml"]
    if capabilities["swf2xml_external"]:
        swf2xml_command += ["-external", "image,definesound"]
    swf2xml_command += [str(input_path), str(output / "structure.xml")]
    commands = [
        (
            "swf2xml",
            swf2xml_command,
        ),
        (
            "export",
            prefix
            + [
                "-onerror",
                "ignore",
                "-ignorebackground",
                "-format",
                "shape:png,morphshape:png_start_end,frame:png,sprite:png,button:png,image:png_gif_jpeg,text:formatted,sound:mp3_wav,font:ttf",
                "-export",
                "shape,morphshape,frame,sprite,button,image,text,sound,font,font4,binarydata,symbolclass,script",
                str(evidence),
                str(input_path),
            ],
        ),
        ("dump-swf", prefix + ["-dumpSWF", str(input_path)]),
        ("dump-as3", prefix + ["-dumpAS3", str(input_path)]),
    ]
    results: list[dict[str, Any]] = []
    for name, command in commands:
        result = _run_logged(command, output, logs / f"{name}.stdout.txt", logs / f"{name}.stderr.txt")
        result["name"] = name
        results.append(result)
        if name in {"swf2xml", "export"} and result["exit_code"] != 0:
            break
    manifest = {
        "schema": "swf-extraction@1",
        "tool_version": TOOL_VERSION,
        "source": {"name": input_path.name, "sha256": sha256_file(input_path), "header": "swf-header.json"},
        "ffdec": {"jar": str(ffdec_jar.resolve()), "sha256": sha256_file(ffdec_jar), "metadata": ffdec_metadata(ffdec_jar), "capabilities": capabilities, "java": java_executable},
        "export_error_policy": "ignore-individual-resource-errors; conversion must report every missing asset",
        "commands": results,
        "complete": len(results) == len(commands) and all(item["exit_code"] == 0 for item in results) and (output / "structure.xml").is_file(),
    }
    write_json(manifest_path, manifest)
    if not manifest["complete"]:
        failed = next((item for item in results if item["exit_code"] != 0), None)
        raise SwfToolError(f"FFDec extraction failed in {failed['name'] if failed else 'swf2xml'}; see {manifest_path}")
    return manifest


def direct_child(element: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in element if child.tag == name), None)


def list_items(element: ET.Element, name: str) -> list[ET.Element]:
    container = direct_child(element, name)
    return list(container) if container is not None else []


def number(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


def integer(value: str | None, default: int = 0) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def swf_float16(value: str | None) -> tuple[float, int]:
    """Decode FFDec's raw UI16 storage for the SWF FLOAT16 data type.

    FFDec deliberately keeps ZONEDATA fields as their round-trippable 16-bit
    payload. SWF FLOAT16 uses a five-bit exponent with bias 16, so treating
    that XML integer as a coordinate loses the authored alignment zone.
    """
    bits = integer(value)
    if not 0 <= bits <= 0xFFFF:
        raise SwfToolError(f"SWF FLOAT16 bit pattern is outside UI16: {value}")
    sign = -1.0 if bits & 0x8000 else 1.0
    exponent = bits >> 10 & 0x1F
    mantissa = bits & 0x3FF
    if exponent == 0:
        decoded = (mantissa / 1024.0) * (2.0 ** -15)
    elif exponent == 0x1F:
        raise SwfToolError(f"non-finite SWF FLOAT16 alignment-zone value: 0x{bits:04x}")
    else:
        decoded = (1.0 + mantissa / 1024.0) * (2.0 ** (exponent - 16))
    return sign * decoded, bits


def truth(value: str | None) -> bool:
    return str(value).lower() == "true"


def decode_ffdec_string(value: str | None) -> str:
    """Decode FFDec XML string escapes without corrupting non-ASCII text."""
    source = value or ""

    def replace(match: re.Match[str]) -> str:
        token = match.group(1)
        if token == "n":
            return "\n"
        if token == "r":
            return "\r"
        if token == "t":
            return "\t"
        if token == "\\":
            return "\\"
        if token.startswith("u"):
            return chr(int(token[1:], 16))
        if token.startswith("x"):
            return chr(int(token[1:], 16))
        return match.group(0)

    return re.sub(r"\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[nrt\\])", replace, source)


def attr_first(element: ET.Element, names: Iterable[str]) -> str | None:
    return next((element.attrib[name] for name in names if name in element.attrib), None)


def character_id(element: ET.Element) -> int | None:
    kind = element.attrib.get("type", "")
    # These tags modify an existing character and must never replace its
    # library definition when they happen to appear later in the tag stream.
    if kind.startswith(("DefineFontInfo", "DefineFontAlignZones", "DefineFontName")) or kind in {
        "DefineScalingGridTag",
        "DefineButtonSoundTag",
        "DefineButtonCxformTag",
        "DefineTextFormatTag",
    }:
        return None
    if kind == "DefineSpriteTag":
        value = element.attrib.get("spriteId")
    elif kind.startswith("DefineShape"):
        value = attr_first(element, ("shapeId", "characterID", "characterId"))
    elif kind.startswith("DefineMorphShape"):
        value = attr_first(element, ("characterId", "characterID"))
    elif kind.startswith("DefineButton"):
        value = attr_first(element, ("buttonId", "characterID", "characterId"))
    elif kind.startswith("DefineFont") or kind == "DefineCompactedFont":
        value = attr_first(element, ("fontID", "fontId", "characterID", "characterId"))
    elif "Sound" in kind and kind.startswith("Define"):
        value = attr_first(element, ("soundId", "characterID", "characterId"))
    elif kind == "DefineBinaryDataTag":
        value = attr_first(element, ("tag", "characterID", "characterId"))
    elif kind.startswith("Define"):
        value = attr_first(element, ("characterID", "characterId", "imageId"))
    else:
        return None
    return integer(value) if value is not None else None


def definition_kind(tag_type: str) -> str:
    if "Sprite" in tag_type:
        return "sprite"
    if "Bits" in tag_type or "Image" in tag_type:
        return "image"
    if "Morph" in tag_type:
        return "morph"
    if "Shape" in tag_type:
        return "shape"
    if "EditText" in tag_type:
        return "input-text"
    if "Text" in tag_type:
        return "text"
    if "Button" in tag_type:
        return "button"
    if "Font" in tag_type:
        return "font"
    if "Sound" in tag_type:
        return "sound"
    if "Video" in tag_type:
        return "video"
    if "BinaryData" in tag_type:
        return "binary"
    return "definition"


def bitmap_definition_value(element: ET.Element) -> dict[str, Any] | None:
    """Return one schema for every standard DefineBits XML tag."""
    tag_type = element.attrib.get("type", "")
    code = BITMAP_XML_TAG_CODES.get(tag_type)
    if code is None:
        return None
    definition = BITMAP_TAG_DEFINITIONS[code]
    value: dict[str, Any] = {
        "tagCode": code,
        "sourceTag": tag_type,
        "encoding": definition["encoding"],
        "alphaMode": definition["alphaMode"],
        "lossless": definition["lossless"],
    }
    if code == 6:
        value["requiresJpegTables"] = True
    for source, destination in (
        ("bitmapFormat", "bitmapFormat"),
        ("bitmapWidth", "width"),
        ("bitmapHeight", "height"),
        ("bitmapColorTableSize", "colorTableSize"),
        ("alphaDataOffset", "alphaDataOffset"),
    ):
        raw = element.attrib.get(source)
        if raw is not None:
            parsed = integer(raw)
            # SWF stores a zero-based palette maximum but the normalized
            # profile reports the actual number of colors.
            value[destination] = parsed + 1 if source == "bitmapColorTableSize" else parsed
    if code == 90 and element.attrib.get("deblockParam") is not None:
        deblock_param = number(element.attrib["deblockParam"]) / 256
        value["deblockParam"] = deblock_param
        if deblock_param > 1:
            value["deblockParamOutOfRange"] = True
    return value


def encoded_image_dimensions(path: Path) -> tuple[int, int] | None:
    """Read exact PNG/JPEG dimensions without decoding or rewriting pixels."""
    data = path.read_bytes()
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
        width, height = struct.unpack(">II", data[16:24])
        return (width, height) if width > 0 and height > 0 else None
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            return None
        marker = data[offset]
        offset += 1
        if marker in {0x01, *range(0xD0, 0xDA)}:
            continue
        if offset + 2 > len(data):
            return None
        length = struct.unpack(">H", data[offset:offset + 2])[0]
        if length < 2 or offset + length > len(data):
            return None
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if length < 7:
                return None
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return (width, height) if width > 0 and height > 0 else None
        offset += length
    return None


def rect_value(element: ET.Element | None) -> dict[str, float] | None:
    if element is None:
        return None
    xmin = number(attr_first(element, ("Xmin", "xmin")))
    xmax = number(attr_first(element, ("Xmax", "xmax")))
    ymin = number(attr_first(element, ("Ymin", "ymin")))
    ymax = number(attr_first(element, ("Ymax", "ymax")))
    return {"x": xmin / 20, "y": ymin / 20, "width": max(0, xmax - xmin) / 20, "height": max(0, ymax - ymin) / 20}


def raw_rect_value(element: ET.Element | None) -> dict[str, int] | None:
    if element is None:
        return None
    values = {
        "xmin": integer(attr_first(element, ("Xmin", "xmin"))),
        "xmax": integer(attr_first(element, ("Xmax", "xmax"))),
        "ymin": integer(attr_first(element, ("Ymin", "ymin"))),
        "ymax": integer(attr_first(element, ("Ymax", "ymax"))),
    }
    # FFDec uses a sentinel rectangle for glyphs such as a space.
    return None if any(abs(value) >= (1 << 30) - 1 for value in values.values()) else values


def scaling_grid_value(
    element: ET.Element,
    bounds: dict[str, float] | None,
) -> dict[str, Any]:
    splitter = rect_value(direct_child(element, "splitter"))
    value: dict[str, Any] = {
        "characterId": integer(attr_first(element, ("characterId", "characterID"))),
        "rect": splitter,
        "units": "pixels",
        "sourceTag": element.attrib.get("type", "DefineScalingGridTag"),
    }
    issues: list[str] = []
    if splitter is None or bounds is None:
        issues.append("scaling grid or target bounds are missing")
    else:
        left = splitter["x"] - bounds["x"]
        top = splitter["y"] - bounds["y"]
        right = bounds["x"] + bounds["width"] - splitter["x"] - splitter["width"]
        bottom = bounds["y"] + bounds["height"] - splitter["y"] - splitter["height"]
        margins = (top, right, bottom, left)
        if any(item < 0 for item in margins):
            issues.append("scaling grid extends outside the target bounds")
        # Laya's native order is top,right,bottom,left,repeat. Flash stretches
        # the middle sections instead of tiling them, hence repeat=0.
        value["sizeGrid"] = [max(0, item) for item in margins] + [0]
    value["valid"] = not issues
    if issues:
        value["issues"] = issues
    return value


def csm_text_settings_value(element: ET.Element) -> dict[str, Any]:
    use_flash_type = integer(element.attrib.get("useFlashType"))
    grid_fit = integer(element.attrib.get("gridFit"))
    return {
        "textId": integer(attr_first(element, ("textID", "textId", "characterId"))),
        "renderer": "advanced" if use_flash_type == 1 else "standard",
        "useFlashType": use_flash_type,
        "gridFit": grid_fit,
        "gridFitMode": {0: "none", 1: "pixel", 2: "subpixel"}.get(grid_fit, f"unknown-{grid_fit}"),
        "thickness": number(element.attrib.get("thickness")),
        "sharpness": number(element.attrib.get("sharpness")),
        "sourceTag": element.attrib.get("type", "CSMSettingsTag"),
    }


def font_align_zones_value(element: ET.Element) -> dict[str, Any]:
    zones = []
    for record in list_items(element, "zoneTable"):
        data = []
        for item in list_items(record, "zonedata"):
            coordinate, coordinate_bits = swf_float16(item.attrib.get("alignmentCoordinate"))
            zone_range, range_bits = swf_float16(item.attrib.get("range"))
            data.append(
                {
                    "alignmentCoordinate": coordinate,
                    "range": zone_range,
                    "alignmentCoordinateBits": coordinate_bits,
                    "rangeBits": range_bits,
                }
            )
        zones.append(
            {
                "maskX": truth(record.attrib.get("zoneMaskX")),
                "maskY": truth(record.attrib.get("zoneMaskY")),
                "data": data,
            }
        )
    hint = integer(element.attrib.get("CSMTableHint"))
    return {
        "fontId": integer(attr_first(element, ("fontID", "fontId", "characterId"))),
        "tableHint": hint,
        "tableHintName": {0: "thin", 1: "medium", 2: "thick"}.get(hint, f"unknown-{hint}"),
        "zones": zones,
        "sourceTag": element.attrib.get("type", "DefineFontAlignZonesTag"),
    }


def scene_frame_metadata_value(element: ET.Element) -> dict[str, Any]:
    def values(name: str) -> list[str]:
        container = direct_child(element, name)
        return [decode_ffdec_string(item.text or "") for item in container] if container is not None else []

    scene_offsets = [integer(item) for item in values("sceneOffsets")]
    scene_names = values("sceneNames")
    frame_numbers = [integer(item) for item in values("frameNums")]
    frame_names = values("frameNames")
    return {
        "scenes": [
            {"name": scene_names[index] if index < len(scene_names) else "", "offset": offset}
            for index, offset in enumerate(scene_offsets)
        ],
        "frameLabels": [
            {"name": frame_names[index] if index < len(frame_names) else "", "frame": frame + 1}
            for index, frame in enumerate(frame_numbers)
        ],
    }


def tag_bounds(element: ET.Element) -> dict[str, float] | None:
    # A morph is authored at its start geometry when ratio is zero.  FFDec's
    # PNG endpoint export is also cropped to this rectangle, so treating the
    # start bounds as the definition bounds keeps the start raster in the same
    # local coordinate system as Flash.
    for field in ("shapeBounds", "startBounds", "bounds", "textBounds", "buttonBounds"):
        found = direct_child(element, field)
        if found is not None:
            return rect_value(found)
    return None


def morph_value(element: ET.Element) -> dict[str, Any]:
    value: dict[str, Any] = {}
    start_bounds = rect_value(direct_child(element, "startBounds"))
    end_bounds = rect_value(direct_child(element, "endBounds"))
    if start_bounds:
        value["startBounds"] = start_bounds
    if end_bounds:
        value["endBounds"] = end_bounds
    geometry = morph_geometry_value(element)
    if geometry:
        value["geometry"] = geometry
    return value


def morph_evidence_rank(path: Path) -> tuple[int, str]:
    """Order FFDec's png_start_end evidence in Flash ratio order."""
    name = path.name.lower()
    if re.search(r"(?:^|[._-])start(?:[._-]|$)", name):
        return (0, name)
    if re.search(r"(?:^|[._-])end(?:[._-]|$)", name):
        return (1, name)
    return (2, name)


def matrix_value(element: ET.Element | None) -> dict[str, float] | None:
    if element is None:
        return None
    has_scale = (
        truth(element.attrib.get("hasScale"))
        if "hasScale" in element.attrib
        else any(field in element.attrib for field in ("scaleX", "scaleY"))
    )
    has_rotate = (
        truth(element.attrib.get("hasRotate"))
        if "hasRotate" in element.attrib
        else any(field in element.attrib for field in ("rotateSkew0", "rotateSkew1"))
    )
    return {
        # FFDec emits numeric zero placeholders when the corresponding SWF
        # MATRIX flag is absent. Flash defines those omitted values as the
        # identity matrix, not a zero-scale transform.
        "a": number(element.attrib.get("scaleX"), 1) if has_scale else 1,
        "b": number(element.attrib.get("rotateSkew0"), 0) if has_rotate else 0,
        "c": number(element.attrib.get("rotateSkew1"), 0) if has_rotate else 0,
        "d": number(element.attrib.get("scaleY"), 1) if has_scale else 1,
        "tx": number(element.attrib.get("translateX"), 0) / 20,
        "ty": number(element.attrib.get("translateY"), 0) / 20,
    }


def color_transform_value(element: ET.Element | None) -> dict[str, float] | None:
    if element is None:
        return None
    keys = {
        "redMultiplier": ("redMultTerm", 256, 1.0),
        "greenMultiplier": ("greenMultTerm", 256, 1.0),
        "blueMultiplier": ("blueMultTerm", 256, 1.0),
        "alphaMultiplier": ("alphaMultTerm", 256, 1.0),
        "redOffset": ("redAddTerm", 1, 0.0),
        "greenOffset": ("greenAddTerm", 1, 0.0),
        "blueOffset": ("blueAddTerm", 1, 0.0),
        "alphaOffset": ("alphaAddTerm", 1, 0.0),
    }
    if not any(source in element.attrib for source, _, _ in keys.values()):
        return None
    result: dict[str, float] = {}
    for output, (source, divisor, default) in keys.items():
        raw = element.attrib.get(source)
        if raw in (None, ""):
            result[output] = default
            continue
        try:
            value = float(raw)
        except ValueError as error:
            raise SwfToolError(f"invalid finite color transform field {source}: {raw!r}") from error
        if not math.isfinite(value):
            raise SwfToolError(f"invalid finite color transform field {source}: {raw!r}")
        result[output] = value / divisor
    return result


def rgba_value(element: ET.Element | None) -> dict[str, float | int] | None:
    if element is None:
        return None
    red = integer(element.attrib.get("red")) & 0xFF
    green = integer(element.attrib.get("green")) & 0xFF
    blue = integer(element.attrib.get("blue")) & 0xFF
    alpha = integer(element.attrib.get("alpha"), 255) & 0xFF
    return {"color": (red << 16) | (green << 8) | blue, "alpha": alpha / 255}


def child_path(element: ET.Element | None, *names: str) -> ET.Element | None:
    current = element
    for name in names:
        if current is None:
            return None
        current = direct_child(current, name)
    return current


def style_items(element: ET.Element, *path: str) -> list[ET.Element]:
    container = child_path(element, *path)
    return list(container) if container is not None else []


def fill_style_value(element: ET.Element, morph: bool) -> dict[str, Any]:
    style_type = integer(element.attrib.get("fillStyleType"))
    if style_type == 0:
        if morph:
            return {
                "kind": "solid",
                "startColor": rgba_value(direct_child(element, "startColor")),
                "endColor": rgba_value(direct_child(element, "endColor")),
            }
        color = rgba_value(direct_child(element, "color"))
        return {"kind": "solid", "startColor": color, "endColor": color}

    gradient_kinds = {0x10: "linear-gradient", 0x12: "radial-gradient", 0x13: "focal-radial-gradient"}
    if style_type in gradient_kinds:
        result: dict[str, Any] = {"kind": gradient_kinds[style_type]}
        if morph:
            start_matrix = matrix_value(direct_child(element, "startGradientMatrix"))
            end_matrix = matrix_value(direct_child(element, "endGradientMatrix"))
            gradient = direct_child(element, "gradient")
            records = style_items(gradient, "gradientRecords") if gradient is not None else []
            result["records"] = [
                {
                    "startRatio": integer(record.attrib.get("startRatio")),
                    "endRatio": integer(record.attrib.get("endRatio")),
                    "startColor": rgba_value(direct_child(record, "startColor")),
                    "endColor": rgba_value(direct_child(record, "endColor")),
                }
                for record in records
            ]
            if start_matrix:
                result["startMatrix"] = start_matrix
            if end_matrix:
                result["endMatrix"] = end_matrix
            if gradient is not None:
                for field in ("spreadMode", "interpolationMode", "startFocalPoint", "endFocalPoint"):
                    if field in gradient.attrib:
                        result[field] = number(gradient.attrib[field])
        else:
            matrix = matrix_value(direct_child(element, "gradientMatrix"))
            gradient = direct_child(element, "gradient")
            records = style_items(gradient, "gradientRecords") if gradient is not None else []
            result["records"] = [
                {
                    "startRatio": integer(record.attrib.get("ratio")),
                    "endRatio": integer(record.attrib.get("ratio")),
                    "startColor": rgba_value(direct_child(record, "color")),
                    "endColor": rgba_value(direct_child(record, "color")),
                }
                for record in records
            ]
            if matrix:
                result["startMatrix"] = result["endMatrix"] = matrix
            if gradient is not None:
                for field in ("spreadMode", "interpolationMode", "focalPoint"):
                    if field in gradient.attrib:
                        result[field] = number(gradient.attrib[field])
        return result

    if style_type in {0x40, 0x41, 0x42, 0x43}:
        result = {
            "kind": "bitmap",
            "bitmapId": integer(element.attrib.get("bitmapId")),
            "repeat": style_type in {0x40, 0x42},
            "smooth": style_type in {0x40, 0x41},
        }
        start_matrix = matrix_value(direct_child(element, "startBitmapMatrix" if morph else "bitmapMatrix"))
        end_matrix = matrix_value(direct_child(element, "endBitmapMatrix" if morph else "bitmapMatrix"))
        if start_matrix:
            result["startMatrix"] = start_matrix
        if end_matrix:
            result["endMatrix"] = end_matrix
        return result
    return {"kind": "unknown", "sourceType": style_type}


def line_style_value(element: ET.Element, morph: bool) -> dict[str, Any]:
    if morph:
        start_color = rgba_value(direct_child(element, "startColor"))
        end_color = rgba_value(direct_child(element, "endColor"))
        result: dict[str, Any] = {
            "startWidth": number(element.attrib.get("startWidth")) / 20,
            "endWidth": number(element.attrib.get("endWidth")) / 20,
            "startColor": start_color,
            "endColor": end_color,
        }
    else:
        color = rgba_value(direct_child(element, "color"))
        width = number(element.attrib.get("width")) / 20
        result = {"startWidth": width, "endWidth": width, "startColor": color, "endColor": color}
    for field in ("startCapStyle", "endCapStyle", "joinStyle", "miterLimitFactor", "noClose", "pixelHintingFlag", "noHScaleFlag", "noVScaleFlag"):
        if field not in element.attrib:
            continue
        result[field] = truth(element.attrib[field]) if element.attrib[field].lower() in {"true", "false"} else number(element.attrib[field])
    return result


def shape_edge_stream(
    element: ET.Element | None,
    fill_styles: list[ET.Element] | None = None,
    line_styles: list[ET.Element] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    if element is None:
        return [], ["missing shape records"]
    records = list_items(element, "shapeRecords")
    current_x = 0.0  # authored twips
    current_y = 0.0  # authored twips
    fill_style0 = 0
    fill_style1 = 0
    line_style = 0
    fill_style_base = 0
    line_style_base = 0
    edges: list[dict[str, Any]] = []
    issues: list[str] = []
    for record in records:
        record_type = record.attrib.get("type", "")
        if record_type == "StyleChangeRecord":
            if truth(record.attrib.get("stateMoveTo")):
                current_x = number(record.attrib.get("moveDeltaX"))
                current_y = number(record.attrib.get("moveDeltaY"))
            if truth(record.attrib.get("stateFillStyle0")):
                local_fill_style0 = integer(record.attrib.get("fillStyle0"))
                fill_style0 = fill_style_base + local_fill_style0 if local_fill_style0 else 0
            if truth(record.attrib.get("stateFillStyle1")):
                local_fill_style1 = integer(record.attrib.get("fillStyle1"))
                fill_style1 = fill_style_base + local_fill_style1 if local_fill_style1 else 0
            if truth(record.attrib.get("stateLineStyle")):
                local_line_style = integer(record.attrib.get("lineStyle"))
                line_style = line_style_base + local_line_style if local_line_style else 0
            if truth(record.attrib.get("stateNewStyles")):
                if fill_styles is None or line_styles is None:
                    issues.append("shape record introduces new styles")
                else:
                    fill_style_base = len(fill_styles)
                    line_style_base = len(line_styles)
                    fill_styles.extend(style_items(record, "fillStyles", "fillStyles"))
                    line_styles.extend(style_items(record, "lineStyles", "lineStyles"))
                    line_styles.extend(style_items(record, "lineStyles", "lineStyles2"))
            continue
        if record_type == "EndShapeRecord":
            break
        start = [current_x / 20, current_y / 20]
        if record_type == "StraightEdgeRecord":
            current_x += number(record.attrib.get("deltaX"))
            current_y += number(record.attrib.get("deltaY"))
            edge: dict[str, Any] = {"kind": "line", "from": start, "to": [current_x / 20, current_y / 20]}
        elif record_type == "CurvedEdgeRecord":
            control_x = current_x + number(record.attrib.get("controlDeltaX"))
            control_y = current_y + number(record.attrib.get("controlDeltaY"))
            current_x = control_x + number(record.attrib.get("anchorDeltaX"))
            current_y = control_y + number(record.attrib.get("anchorDeltaY"))
            edge = {
                "kind": "curve",
                "from": start,
                "control": [control_x / 20, control_y / 20],
                "to": [current_x / 20, current_y / 20],
            }
        else:
            issues.append(f"unsupported shape record {record_type or '<missing>'}")
            continue
        edge.update({"fillStyle0": fill_style0, "fillStyle1": fill_style1, "lineStyle": line_style})
        edges.append(edge)
    return edges, issues


def normalized_control(edge: dict[str, Any]) -> list[float]:
    if edge["kind"] == "curve":
        return edge["control"]
    return [(edge["from"][0] + edge["to"][0]) / 2, (edge["from"][1] + edge["to"][1]) / 2]


def paired_geometry(start_edges: list[dict[str, Any]], end_edges: list[dict[str, Any]] | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    issues: list[str] = []
    if end_edges is not None and len(start_edges) != len(end_edges):
        return [], [f"morph edge count differs ({len(start_edges)} start, {len(end_edges)} end)"]
    segments: list[dict[str, Any]] = []
    for index, start in enumerate(start_edges):
        end = end_edges[index] if end_edges is not None else start
        kind = "curve" if start["kind"] == "curve" or end["kind"] == "curve" else "line"
        segment: dict[str, Any] = {
            "kind": kind,
            "fillStyle0": start["fillStyle0"],
            "fillStyle1": start["fillStyle1"],
            "lineStyle": start["lineStyle"],
            "start": {"from": start["from"], "to": start["to"]},
            "end": {"from": end["from"], "to": end["to"]},
        }
        if kind == "curve":
            segment["start"]["control"] = normalized_control(start)
            segment["end"]["control"] = normalized_control(end)
        segments.append(segment)
    return segments, issues


def shape_geometry_value(element: ET.Element) -> dict[str, Any] | None:
    shapes = direct_child(element, "shapes")
    if shapes is None:
        return None
    fill_items = style_items(shapes, "fillStyles", "fillStyles")
    line_items = style_items(shapes, "lineStyles", "lineStyles") + style_items(shapes, "lineStyles", "lineStyles2")
    edges, issues = shape_edge_stream(shapes, fill_items, line_items)
    segments, pair_issues = paired_geometry(edges)
    return {
        "segments": segments,
        "fillStyles": [fill_style_value(style, False) for style in fill_items],
        "lineStyles": [line_style_value(style, False) for style in line_items],
        "usesFillWindingRule": truth(element.attrib.get("usesFillWindingRule")),
        "interpolatable": bool(segments) and not issues and not pair_issues,
        "issues": issues + pair_issues,
    }


def morph_geometry_value(element: ET.Element) -> dict[str, Any] | None:
    start, start_issues = shape_edge_stream(direct_child(element, "startEdges"))
    end, end_issues = shape_edge_stream(direct_child(element, "endEdges"))
    segments, pair_issues = paired_geometry(start, end)
    if not start and not end:
        return None
    fills = style_items(element, "morphFillStyles", "fillStyles")
    lines = style_items(element, "morphLineStyles", "lineStyles") + style_items(element, "morphLineStyles", "lineStyles2")
    issues = start_issues + end_issues + pair_issues
    drawable_styles = all(fill_style_value(style, True)["kind"] == "solid" for style in fills)
    return {
        "segments": segments,
        "fillStyles": [fill_style_value(style, True) for style in fills],
        "lineStyles": [line_style_value(style, True) for style in lines],
        "usesFillWindingRule": truth(element.attrib.get("usesFillWindingRule")),
        "interpolatable": bool(segments) and drawable_styles and not issues,
        "issues": issues + ([] if drawable_styles else ["native morph gradients and bitmap fills are not implemented"]),
    }


def numeric_items(element: ET.Element | None) -> list[float]:
    if element is None:
        return []
    return [number((item.text or "").strip()) for item in list(element)]


def filter_value(element: ET.Element) -> dict[str, Any]:
    source_type = element.attrib.get("type", "")
    result: dict[str, Any] = {
        "kind": FILTER_KINDS.get(source_type, "unknown"),
        "sourceType": source_type,
    }
    float_fields = ("blurX", "blurY", "angle", "distance", "strength", "divisor", "bias")
    int_fields = ("passes", "matrixX", "matrixY")
    bool_fields = (
        "innerShadow", "innerGlow", "knockout", "compositeSource", "onTop",
        "clamp", "preserveAlpha",
    )
    for field in float_fields:
        if field in element.attrib:
            output = "angleRadians" if field == "angle" else field
            result[output] = number(element.attrib[field])
    for field in int_fields:
        if field in element.attrib:
            result[field] = integer(element.attrib[field])
    for field in bool_fields:
        if field in element.attrib:
            result[field] = truth(element.attrib[field])

    for xml_name, output_name in (
        ("dropShadowColor", "color"),
        ("glowColor", "color"),
        ("shadowColor", "shadowColor"),
        ("highlightColor", "highlightColor"),
        ("defaultColor", "defaultColor"),
    ):
        parsed = rgba_value(direct_child(element, xml_name))
        if parsed is not None:
            result[output_name] = parsed

    gradient_colors = direct_child(element, "gradientColors")
    if gradient_colors is not None:
        result["colors"] = [rgba_value(item) for item in list(gradient_colors)]
    gradient_ratios = direct_child(element, "gradientRatio")
    if gradient_ratios is not None:
        result["ratios"] = [integer((item.text or "").strip()) for item in list(gradient_ratios)]
    matrix = direct_child(element, "matrix")
    if matrix is not None:
        result["matrix"] = numeric_items(matrix)
    if result["kind"] in {"bevel", "gradient-glow", "gradient-bevel"}:
        result["type"] = (
            "inner" if result.get("innerShadow")
            else "full" if result.get("onTop")
            else "outer"
        )
    return result


def direct_bitmap_fill_runtime_value(
    asset: dict[str, Any],
    assets: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve a lossless direct bitmap fill without trusting FFDec previews.

    FFDec shape rasters are useful evidence for geometry, but they are not the
    SWF bitmap character's pixel authority.  The current prefab projection can
    represent only the conservative case where one point-sampled, clamped
    bitmap fills an origin-aligned rectangle at one source pixel per output
    pixel.  Other bitmap geometry must stay unbound until a native fill
    renderer can preserve it; a preview raster is never a runtime fallback.
    """
    shape = asset.get("shape")
    if not isinstance(shape, dict):
        return None, None
    fill_styles = shape.get("fillStyles")
    if not isinstance(fill_styles, list):
        return None, None
    bitmap_fills = [style for style in fill_styles if isinstance(style, dict) and style.get("kind") == "bitmap"]
    if not bitmap_fills:
        return None, None
    if len(fill_styles) != 1 or len(bitmap_fills) != 1:
        return None, "bitmap-filled shape is not a single-fill projection"

    fill = bitmap_fills[0]
    if fill.get("repeat") is not False or fill.get("smooth") is not False:
        return None, "bitmap-filled shape requires unsupported repeat or smooth sampling"
    matrix = fill.get("startMatrix")
    if matrix != fill.get("endMatrix") or matrix != {
        "a": 20.0,
        "b": 0,
        "c": 0,
        "d": 20.0,
        "tx": 0.0,
        "ty": 0.0,
    }:
        return None, "bitmap-filled shape is not an origin-aligned one-pixel projection"

    bitmap_id = integer(fill.get("bitmapId"), -1)
    bitmap_asset = assets.get(str(bitmap_id))
    if not isinstance(bitmap_asset, dict) or bitmap_asset.get("kind") != "image" or not bitmap_asset.get("path"):
        return None, f"bitmap character {bitmap_id} has no runtime image export"
    bitmap = bitmap_asset.get("bitmap")
    bounds = asset.get("bounds")
    if not isinstance(bitmap, dict) or not isinstance(bounds, dict):
        return None, "bitmap-filled shape has incomplete bitmap or bounds metadata"
    if (
        bounds.get("x") != 0.0
        or bounds.get("y") != 0.0
        or bounds.get("width") != bitmap.get("width")
        or bounds.get("height") != bitmap.get("height")
    ):
        return None, "bitmap character dimensions do not match the shape bounds"

    segments = shape.get("segments")
    if not isinstance(segments, list) or len(segments) != 4 or shape.get("lineStyles"):
        return None, "bitmap-filled shape is not a four-edge rectangle"
    expected_edges = {
        frozenset(((0.0, 0.0), (float(bounds["width"]), 0.0))),
        frozenset(((float(bounds["width"]), 0.0), (float(bounds["width"]), float(bounds["height"])))),
        frozenset(((float(bounds["width"]), float(bounds["height"])), (0.0, float(bounds["height"])))),
        frozenset(((0.0, float(bounds["height"])), (0.0, 0.0))),
    }
    actual_edges: set[frozenset[tuple[float, float]]] = set()
    for segment in segments:
        if not isinstance(segment, dict) or segment.get("kind") != "line":
            return None, "bitmap-filled shape contains non-line geometry"
        if {integer(segment.get("fillStyle0")), integer(segment.get("fillStyle1"))} != {0, 1}:
            return None, "bitmap-filled shape edges do not use the sole bitmap fill"
        edge = segment.get("start")
        if not isinstance(edge, dict):
            return None, "bitmap-filled shape has incomplete edge geometry"
        start = edge.get("from")
        end = edge.get("to")
        if not isinstance(start, list) or not isinstance(end, list) or len(start) != 2 or len(end) != 2:
            return None, "bitmap-filled shape has incomplete edge points"
        actual_edges.add(frozenset(((float(start[0]), float(start[1])), (float(end[0]), float(end[1])))))
    if actual_edges != expected_edges:
        return None, "bitmap-filled shape edges do not match the bitmap bounds"

    return {
        "bitmapCharacterId": bitmap_id,
        "filter": "point",
        "visualAuthority": "bitmap-character-export",
        "wrap": "clamp",
    }, None


def filter_list_value(element: ET.Element | None) -> list[dict[str, Any]]:
    if element is None:
        return []
    return [filter_value(item) for item in list(element)]


def blend_mode_value(raw: str | None) -> str:
    value = integer(raw)
    return FLASH_BLEND_MODES.get(value, f"unknown-{value}")


def sound_info_value(element: ET.Element | None) -> dict[str, Any] | None:
    if element is None:
        return None
    result: dict[str, Any] = {}
    for field in ("syncStop", "syncNoMultiple", "hasEnvelope", "hasLoops", "hasOutPoint", "hasInPoint"):
        if field in element.attrib:
            result[field] = truth(element.attrib[field])
    for field in ("inPoint", "outPoint", "loopCount"):
        if field in element.attrib:
            result[field] = integer(element.attrib[field])
    envelope = direct_child(element, "envelopeRecords")
    if envelope is not None:
        result["envelope"] = [
            {
                "position44": integer(attr_first(item, ("pos44", "position44"))),
                "leftLevel": integer(item.attrib.get("leftLevel")),
                "rightLevel": integer(item.attrib.get("rightLevel")),
            }
            for item in list(envelope)
        ]
    return result


def button_record_value(element: ET.Element) -> dict[str, Any]:
    result: dict[str, Any] = {
        "characterId": integer(element.attrib.get("characterId")),
        "depth": integer(element.attrib.get("placeDepth")),
        "states": [
            name
            for attribute, name in (
                ("buttonStateUp", "up"),
                ("buttonStateOver", "over"),
                ("buttonStateDown", "down"),
                ("buttonStateHitTest", "hitTest"),
            )
            if truth(element.attrib.get(attribute))
        ],
    }
    matrix = matrix_value(direct_child(element, "placeMatrix"))
    if matrix:
        result["matrix"] = matrix
    transform = color_transform_value(direct_child(element, "colorTransform"))
    if transform:
        result["colorTransform"] = transform
    if truth(element.attrib.get("buttonHasFilterList")):
        result["filters"] = filter_list_value(direct_child(element, "filterList"))
    if truth(element.attrib.get("buttonHasBlendMode")):
        result["blendMode"] = blend_mode_value(element.attrib.get("blendMode"))
        result["blendModeCode"] = integer(element.attrib.get("blendMode"))
    return result


def button_value(element: ET.Element) -> dict[str, Any]:
    records = [button_record_value(item) for item in list_items(element, "characters")]
    actions = list_items(element, "actions")
    return {
        "trackAsMenu": truth(element.attrib.get("trackAsMenu")),
        "records": records,
        "hasActions": bool(actions),
    }


def edit_text_value(element: ET.Element) -> dict[str, Any]:
    alignments = {0: "left", 1: "right", 2: "center", 3: "justify"}
    color = rgba_value(direct_child(element, "textColor"))
    value: dict[str, Any] = {
        "fieldType": "dynamic" if truth(element.attrib.get("readOnly")) else "input",
        "variableName": decode_ffdec_string(element.attrib.get("variableName")),
        "initialText": decode_ffdec_string(element.attrib.get("initialText")),
        "html": truth(element.attrib.get("html")),
        "multiline": truth(element.attrib.get("multiline")),
        "wordWrap": truth(element.attrib.get("wordWrap")),
        "password": truth(element.attrib.get("password")),
        "selectable": not truth(element.attrib.get("noSelect")),
        "border": truth(element.attrib.get("border")),
        "autoSize": truth(element.attrib.get("autoSize")),
        "useOutlines": truth(element.attrib.get("useOutlines")),
    }
    if truth(element.attrib.get("hasFont")):
        value["fontId"] = integer(element.attrib.get("fontId"))
        value["fontSize"] = number(element.attrib.get("fontHeight")) / 20
    if truth(element.attrib.get("hasFontClass")):
        value["fontClass"] = decode_ffdec_string(element.attrib.get("fontClass"))
    if truth(element.attrib.get("hasTextColor")) and color:
        value["color"] = color
    if truth(element.attrib.get("hasMaxLength")):
        value["maxChars"] = integer(element.attrib.get("maxLength"))
    if truth(element.attrib.get("hasLayout")):
        value.update({
            "align": alignments.get(integer(element.attrib.get("align")), "left"),
            "leftMargin": number(element.attrib.get("leftMargin")) / 20,
            "rightMargin": number(element.attrib.get("rightMargin")) / 20,
            "indent": number(element.attrib.get("indent")) / 20,
            "leading": number(element.attrib.get("leading")) / 20,
        })
    return value


def font_value(element: ET.Element) -> dict[str, Any]:
    name = decode_ffdec_string(element.attrib.get("fontName")).replace("\x00", "")
    glyphs = direct_child(element, "glyphShapeTable")
    codes = [integer(item.text) for item in list_items(element, "codeTable")]
    advances = [integer(item.text) for item in list_items(element, "fontAdvanceTable")]
    bounds = [raw_rect_value(item) for item in list_items(element, "fontBoundsTable")]
    glyph_count = max(len(list(glyphs)) if glyphs is not None else 0, len(codes))
    divider = 20 if element.attrib.get("type") == "DefineFont3Tag" else 1
    glyph_metrics: list[dict[str, Any]] = []
    for index, code_point in enumerate(codes):
        metric: dict[str, Any] = {"index": index, "codePoint": code_point}
        if index < len(advances):
            metric["advance"] = advances[index]
        if index < len(bounds) and bounds[index] is not None:
            metric["bounds"] = bounds[index]
        glyph_metrics.append(metric)
    kerning = [
        {
            "leftCodePoint": integer(record.attrib.get("fontKerningCode1")),
            "rightCodePoint": integer(record.attrib.get("fontKerningCode2")),
            "adjustment": integer(record.attrib.get("fontKerningAdjustment")),
        }
        for record in list_items(element, "fontKerningTable")
    ]
    return {
        "family": name,
        "bold": truth(element.attrib.get("fontFlagsBold")),
        "italic": truth(element.attrib.get("fontFlagsItalic")),
        "hasLayout": truth(element.attrib.get("fontFlagsHasLayout")),
        "embedded": glyph_count > 0,
        "glyphCount": glyph_count,
        "unitsPerEm": 1024 * divider,
        "ascent": integer(element.attrib.get("fontAscent")),
        "descent": integer(element.attrib.get("fontDescent")),
        "leading": integer(element.attrib.get("fontLeading")),
        "glyphs": glyph_metrics,
        "kerning": kerning,
    }


def sound_definition_value(element: ET.Element) -> dict[str, Any]:
    rate_codes = {0: 5512.5, 1: 11025, 2: 22050, 3: 44100}
    rate_code = integer(element.attrib.get("soundRate"), -1)
    return {
        "format": integer(element.attrib.get("soundFormat"), -1),
        "rateCode": rate_code,
        "sampleRate": rate_codes.get(rate_code),
        "sampleSize": 16 if integer(element.attrib.get("soundSize")) else 8,
        "channels": 2 if integer(element.attrib.get("soundType")) else 1,
        "sampleCount": integer(element.attrib.get("soundSampleCount")),
    }


def sound_stream_value(element: ET.Element) -> dict[str, Any]:
    rate_codes = {0: 5512.5, 1: 11025, 2: 22050, 3: 44100}
    rate_code = integer(element.attrib.get("streamSoundRate"), -1)
    playback_rate_code = integer(element.attrib.get("playBackSoundRate"), -1)
    return {
        "format": integer(element.attrib.get("streamSoundCompression"), -1),
        "rateCode": rate_code,
        "sampleRate": rate_codes.get(rate_code),
        "sampleSize": 16 if truth(element.attrib.get("streamSoundSize")) else 8,
        "channels": 2 if truth(element.attrib.get("streamSoundType")) else 1,
        "samplesPerFrame": integer(element.attrib.get("streamSoundSampleCount")),
        "playbackRateCode": playback_rate_code,
        "playbackSampleRate": rate_codes.get(playback_rate_code),
        "playbackSampleSize": 16 if truth(element.attrib.get("playBackSoundSize")) else 8,
        "playbackChannels": 2 if truth(element.attrib.get("playBackSoundType")) else 1,
        "latencySeek": integer(element.attrib.get("latencySeek")),
    }


def symbol_map(root: ET.Element) -> dict[str, int]:
    result: dict[str, int] = {}
    for element in root.iter():
        if element.attrib.get("type") not in {"SymbolClassTag", "ExportAssetsTag"}:
            continue
        ids = [integer((item.text or "").strip()) for item in list_items(element, "tags")]
        names = [(item.text or "").strip() for item in list_items(element, "names")]
        for tag_id, name in zip(ids, names):
            if name:
                result[name] = tag_id
    return result


SCRIPT_TYPES = {"DoActionTag", "DoInitActionTag", "DoABCTag", "DoABC2Tag"}


def timeline_from_tags(tags: list[ET.Element], symbol_id: int, symbol_name: str | None, frame_rate: float, declared_frames: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    frames: list[dict[str, Any]] = []
    operations: list[dict[str, Any]] = []
    label: str | None = None
    issues: list[dict[str, Any]] = []
    index = 1
    active_stream: dict[str, Any] | None = None

    def finish() -> None:
        nonlocal operations, label, index
        frame: dict[str, Any] = {"index": index, "operations": operations}
        if label:
            frame["label"] = label
        frames.append(frame)
        index += 1
        operations = []
        label = None

    for tag in tags:
        kind = tag.attrib.get("type", "")
        if kind == "ShowFrameTag":
            finish()
        elif kind == "FrameLabelTag":
            label = tag.attrib.get("name", "")
            operations.append({"op": "label", "name": label})
        elif kind.startswith("PlaceObject"):
            operation: dict[str, Any] = {
                "op": "place",
                "depth": integer(tag.attrib.get("depth")),
                "move": truth(tag.attrib.get("placeFlagMove")),
            }
            char_value = attr_first(tag, ("characterId", "characterID"))
            if char_value is not None and (truth(tag.attrib.get("placeFlagHasCharacter")) or kind == "PlaceObjectTag" or integer(char_value) != 0):
                operation["characterId"] = integer(char_value)
            for input_name, output_name in (("name", "name"), ("ratio", "ratio"), ("clipDepth", "clipDepth")):
                if input_name in tag.attrib and (not input_name.startswith("clip") or truth(tag.attrib.get("placeFlagHasClipDepth"))):
                    operation[output_name] = integer(tag.attrib[input_name]) if input_name != "name" else tag.attrib[input_name]
            matrix = matrix_value(direct_child(tag, "matrix"))
            if matrix:
                operation["matrix"] = matrix
            color = color_transform_value(direct_child(tag, "colorTransform"))
            if color:
                operation["colorTransform"] = color
            if truth(tag.attrib.get("placeFlagHasFilterList")):
                filters = filter_list_value(direct_child(tag, "surfaceFilterList"))
                operation["filters"] = filters
                for parsed_filter in filters:
                    if parsed_filter["kind"] == "unknown":
                        issues.append({
                            "feature": "unknown-filter",
                            "sourceType": parsed_filter["sourceType"],
                            "tagType": kind,
                            "symbolId": symbol_id,
                            "frame": index,
                        })
            if truth(tag.attrib.get("placeFlagHasBlendMode")):
                blend_code = integer(tag.attrib.get("blendMode"))
                operation["blendMode"] = blend_mode_value(tag.attrib.get("blendMode"))
                operation["blendModeCode"] = blend_code
                if blend_code not in FLASH_BLEND_MODES:
                    issues.append({
                        "feature": "unknown-blend-mode",
                        "blendModeCode": blend_code,
                        "tagType": kind,
                        "symbolId": symbol_id,
                        "frame": index,
                    })
            if truth(tag.attrib.get("placeFlagHasCacheAsBitmap")):
                operation["cacheAsBitmap"] = integer(tag.attrib.get("bitmapCache")) != 0
            if truth(tag.attrib.get("placeFlagHasVisible")):
                operation["visible"] = integer(tag.attrib.get("visible")) != 0
            if truth(tag.attrib.get("placeFlagOpaqueBackground")):
                background = rgba_value(direct_child(tag, "backgroundColor"))
                if background:
                    operation["opaqueBackground"] = background
            if truth(tag.attrib.get("placeFlagHasClassName")) and tag.attrib.get("className"):
                operation["className"] = tag.attrib["className"]
            operations.append(operation)
            if truth(tag.attrib.get("placeFlagHasClipActions")):
                issues.append({"feature": "clip-actions", "tagType": kind, "symbolId": symbol_id, "frame": index})
        elif kind in {"RemoveObjectTag", "RemoveObject2Tag"}:
            operations.append({"op": "remove", "depth": integer(tag.attrib.get("depth"))})
        elif kind in {"StartSoundTag", "StartSound2Tag"}:
            operation = {"op": "sound"}
            if "soundId" in tag.attrib:
                operation["soundId"] = integer(tag.attrib["soundId"])
            if "soundClassName" in tag.attrib:
                operation["symbol"] = tag.attrib["soundClassName"]
            sound_info = sound_info_value(direct_child(tag, "soundInfo"))
            if sound_info:
                operation["soundInfo"] = sound_info
            operations.append(operation)
        elif kind in {"SoundStreamHeadTag", "SoundStreamHead2Tag"}:
            # A stream belongs to its containing timeline rather than the SWF
            # character dictionary. Reserve a stable negative ID per timeline;
            # FFDec exports the main stream as sounds/-1.* using the same rule.
            stream_id = -(symbol_id + 1)
            active_stream = {
                "op": "sound",
                "soundId": stream_id,
                "stream": True,
                "startFrame": index,
                "endFrame": index,
                "streamInfo": sound_stream_value(tag),
            }
            active_stream["streamInfo"]["blockCount"] = 0
            operations.append(active_stream)
        elif kind == "SoundStreamBlockTag":
            if active_stream is None:
                issues.append({"feature": "orphan-stream-block", "tagType": kind, "symbolId": symbol_id, "frame": index})
            else:
                active_stream["endFrame"] = index
                active_stream["streamInfo"]["blockCount"] += 1
        elif kind in SCRIPT_TYPES:
            script_kind = "avm2" if "ABC" in kind else "avm1"
            operations.append({
                "op": "script",
                "kind": script_kind,
                "sourceTag": kind,
                "executable": False,
                "nativeCallbackRequired": True,
            })
            issues.append({
                "feature": "frame-script",
                "tagType": kind,
                "symbolId": symbol_id,
                "frame": index,
                "policy": "never-execute-abc" if script_kind == "avm2" else "native-callback-required",
            })
    if operations or label or not frames:
        finish()
    required = max(declared_frames, len(frames))
    while len(frames) < required:
        frames.append({"index": len(frames) + 1, "operations": []})
    return {
        "schema": "flash-timeline@1",
        "symbolId": symbol_id,
        **({"symbolName": symbol_name} if symbol_name else {}),
        "frameRate": frame_rate,
        "frameCount": required,
        "frames": frames,
    }, issues


def find_evidence_files(bundle: Path) -> list[Path]:
    return sorted(path for path in bundle.rglob("*") if path.is_file() and path.suffix.lower() in EVIDENCE_SUFFIXES)


def formatted_text_content(path: Path) -> str:
    return parse_formatted_text(path)["text"]


FORMATTED_TEXT_KEYS = {
    "xmin", "xmax", "ymin", "ymax", "translatex", "translatey",
    "wordwrap", "multiline", "readonly", "noselect", "wasstatic",
    "html", "useoutlines", "font", "height", "color", "align",
    "leftmargin", "rightmargin", "indent", "leading", "x", "y",
    "spacing", "spacingpair",
}


def _formatted_directives(value: str) -> dict[str, str] | None:
    result: dict[str, str] = {}
    for raw_line in value.strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue
        key, _, remainder = line.partition(" ")
        key = key.lower()
        if key not in FORMATTED_TEXT_KEYS:
            return None
        # Spacing hints describe individual glyph advances, not run style.
        if key not in {"spacing", "spacingpair"}:
            result[key] = remainder.strip().strip('"')
    return result


def _formatted_color(value: str | None) -> dict[str, float | int] | None:
    if not value or not re.fullmatch(r"#[0-9a-fA-F]{8}", value):
        return None
    packed = int(value[1:], 16)  # FFDec formatted text uses AARRGGBB.
    return {"color": packed & 0xFFFFFF, "alpha": (packed >> 24 & 0xFF) / 255}


def parse_formatted_text(path: Path) -> dict[str, Any]:
    """Parse FFDec formatted-text directives without leaking them into text."""
    raw = path.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    cursor = 0
    text_parts: list[str] = []
    runs: list[dict[str, Any]] = []
    state: dict[str, str] = {}
    global_fields: dict[str, str] = {}
    for match in re.finditer(r"\[([\s\S]*?)\]", raw):
        directives = _formatted_directives(match.group(1))
        if directives is None:
            continue
        segment = raw[cursor:match.start()]
        if segment:
            run: dict[str, Any] = {"text": segment}
            for source, output, divisor in (
                ("font", "fontId", 1), ("height", "fontSize", 20),
                ("x", "x", 20), ("y", "y", 20),
            ):
                if source in state:
                    run[output] = integer(state[source]) if output == "fontId" else number(state[source]) / divisor
            parsed_color = _formatted_color(state.get("color"))
            if parsed_color:
                run["color"] = parsed_color
            runs.append(run)
            text_parts.append(segment)
        state.update(directives)
        for key in ("xmin", "xmax", "ymin", "ymax", "translatex", "translatey"):
            if key in directives:
                global_fields[key] = directives[key]
        cursor = match.end()
    tail = raw[cursor:]
    if tail:
        run = {"text": tail}
        for source, output, divisor in (
            ("font", "fontId", 1), ("height", "fontSize", 20),
            ("x", "x", 20), ("y", "y", 20),
        ):
            if source in state:
                run[output] = integer(state[source]) if output == "fontId" else number(state[source]) / divisor
        parsed_color = _formatted_color(state.get("color"))
        if parsed_color:
            run["color"] = parsed_color
        runs.append(run)
        text_parts.append(tail)
    return {
        "text": "".join(text_parts),
        "runs": runs,
        "directives": global_fields,
    }


def static_text_value(
    element: ET.Element,
    formatted: dict[str, Any],
    fonts: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    fonts = fonts or {}
    records = list_items(element, "textRecords")
    runs: list[dict[str, Any]] = []
    issues: list[str] = []
    current_font_id: int | None = None
    current_height = 0.0
    current_color: dict[str, float | int] | None = None
    current_x = 0.0
    current_y = 0.0
    for record in records:
        if truth(record.attrib.get("styleFlagsHasFont")):
            current_font_id = integer(record.attrib.get("fontId"))
            current_height = number(record.attrib.get("textHeight")) / 20
        if truth(record.attrib.get("styleFlagsHasColor")):
            color_element = direct_child(record, "textColorA")
            if color_element is None:
                color_element = direct_child(record, "textColor")
            current_color = rgba_value(color_element)
        if truth(record.attrib.get("styleFlagsHasXOffset")):
            current_x = number(record.attrib.get("xOffset"))
        if truth(record.attrib.get("styleFlagsHasYOffset")):
            current_y = number(record.attrib.get("yOffset"))

        font = fonts.get(current_font_id) if current_font_id is not None else None
        font_glyphs = font.get("glyphs", []) if font else []
        characters: list[str] = []
        positioned: list[dict[str, Any]] = []
        start_x = current_x
        for entry in list_items(record, "glyphEntries"):
            glyph_index = integer(entry.attrib.get("glyphIndex"), -1)
            advance_twips = number(entry.attrib.get("glyphAdvance"))
            advance = advance_twips / 20
            code_point = font_glyphs[glyph_index].get("codePoint") if 0 <= glyph_index < len(font_glyphs) else None
            if code_point is None or not 0 <= code_point <= 0x10FFFF:
                character = "\uFFFD"
                issues.append(f"font {current_font_id} has no code point for glyph {glyph_index}")
            else:
                character = chr(code_point)
            characters.append(character)
            positioned.append({
                "character": character,
                "glyphIndex": glyph_index,
                "x": current_x / 20,
                "advance": advance,
            })
            current_x += advance_twips
        if positioned:
            run: dict[str, Any] = {
                "text": "".join(characters),
                "x": start_x / 20,
                "y": current_y / 20,
                "fontSize": current_height,
                "glyphs": positioned,
                "width": (current_x - start_x) / 20,
            }
            if current_font_id is not None:
                run["fontId"] = current_font_id
            if current_color:
                run["color"] = current_color
            runs.append(run)

    exact = bool(runs) and not issues
    value: dict[str, Any] = {
        "runs": runs or formatted["runs"],
        "exactGlyphs": exact,
        "issues": issues if issues else ([] if runs else ["SWF text records are missing"]),
    }
    matrix = matrix_value(direct_child(element, "textMatrix"))
    if matrix:
        value["matrix"] = matrix
    return value


def match_evidence(tag: ET.Element, tag_id: int, name: str | None, candidates: list[Path], structure: Path) -> list[Path]:
    external = tag.attrib.get("_externalFile")
    if external:
        path = (structure.parent / external.replace("/", os.sep)).resolve()
        if path.is_file():
            return [path]
    expected_folders = {
        "shape": "shapes", "morph": "morphshapes", "image": "images",
        "text": "texts", "input-text": "texts", "button": "buttons",
        "font": "fonts", "sound": "sounds", "sprite": "sprites",
        "binary": "binarydata", "video": "movies",
    }
    expected = expected_folders.get(definition_kind(tag.attrib.get("type", "")))
    evidence_root = structure.parent.resolve()

    def relative_parts(path: Path) -> list[str]:
        try:
            relative = path.resolve().relative_to(evidence_root)
            return [part.lower() for part in relative.parts]
        except ValueError:
            return [part.lower() for part in path.parts]

    # Scope against paths relative to the extraction bundle. Absolute parent
    # folders can legitimately be named "sounds", "frames", etc.; treating
    # those as FFDec evidence categories cross-wires same-numbered resources.
    scoped = [path for path in candidates if expected and expected in set(relative_parts(path))]
    # Never let a full-timeline frame become a character definition merely
    # because both happen to have the same numeric filename.
    candidates = scoped or [path for path in candidates if "frames" not in {part.lower() for part in path.parts}]
    tokens = [str(tag_id)]
    if name:
        tokens.append(safe_name(name, "").lower())
        tokens.append(name.split(".")[-1].lower())
    exact: list[Path] = []
    fuzzy: list[Path] = []
    for path in candidates:
        stem = path.stem.lower()
        # FFDec renders multi-state buttons and multi-frame sprites below a
        # character-named directory (for example
        # buttons/DefineButton2_170/1.png). Match the scoped relative path,
        # not just the leaf frame name.
        lower_parts = relative_parts(path)
        folder_index = lower_parts.index(expected) if expected in lower_parts else len(lower_parts) - 1
        identity = "/".join(lower_parts[folder_index + 1 :]) or stem
        if re.match(rf"^{tag_id}(?:$|[^0-9])", stem) or re.search(rf"(?:^|[^0-9-]){tag_id}(?:$|[^0-9])", identity):
            exact.append(path)
        elif any(token and token in stem for token in tokens[1:]):
            fuzzy.append(path)
    return exact or fuzzy


def match_bitmap_evidence(
    tag: ET.Element,
    tag_id: int,
    name: str | None,
    candidates: list[Path],
    structure: Path,
) -> tuple[list[Path], str | None, list[Path]]:
    """Select one runtime-ready bitmap and keep split alpha fail-visible.

    FFDec's legacy ``png_gif_jpeg_alpha`` export can emit ``N.jpg`` plus
    ``N.alpha.png``.  Laya cannot use the alpha plane as an independent skin,
    so the JPEG must not silently become the runtime asset.  Current
    extraction emits composited PNG evidence; old split bundles are rejected
    until a composited visual is supplied.
    """
    bitmap = bitmap_definition_value(tag)
    if bitmap is None:
        matches = match_evidence(tag, tag_id, name, candidates, structure)
        return (matches[:1], None if matches else "bitmap visual export is missing", [])

    external_raw = tag.attrib.get("_externalFile")
    external: Path | None = None
    external_issue: str | None = None
    if external_raw:
        evidence_root = structure.parent.resolve()
        candidate = (structure.parent / external_raw.replace("/", os.sep)).resolve()
        if candidate != evidence_root and evidence_root not in candidate.parents:
            external_issue = "bitmap external evidence escapes extraction bundle"
        elif not candidate.is_file():
            external_issue = "bitmap external evidence is missing"
        elif candidate.suffix.lower() not in VISUAL_SUFFIXES:
            external_issue = "bitmap external evidence is not a visual asset"
        else:
            external = candidate

    # Search the complete image evidence category even when _externalFile is
    # present so a legacy split-alpha sibling cannot be mistaken for a merged
    # runtime image.
    search_tag = ET.Element(tag.tag, {key: value for key, value in tag.attrib.items() if key != "_externalFile"})
    matches = match_evidence(search_tag, tag_id, name, candidates, structure)
    ordered = ([external] if external is not None else []) + [path for path in matches if path != external]
    alpha_planes = [
        path for path in ordered
        if path.name.lower().endswith(".alpha.png") or ".alpha." in path.name.lower()
    ]
    visuals = [path for path in ordered if path not in alpha_planes and path.suffix.lower() in VISUAL_SUFFIXES]
    if not visuals:
        return [], external_issue or "bitmap visual export is missing", alpha_planes

    lossless_visuals = [path for path in visuals if path.suffix.lower() in LOSSLESS_BITMAP_SUFFIXES]
    if bitmap["lossless"]:
        if not lossless_visuals:
            return [], "lossless bitmap has no lossless runtime export", alpha_planes
        visuals = lossless_visuals
    elif bitmap["alphaMode"] != "none":
        if not lossless_visuals:
            detail = (
                "split alpha evidence has no composited runtime bitmap"
                if alpha_planes
                else "alpha bitmap has no composited runtime bitmap"
            )
            return [], detail, alpha_planes
        visuals = lossless_visuals

    # _externalFile is FFDec's authoritative merged export when it satisfies
    # the alpha/lossless constraint; otherwise prefer PNG, then GIF/WebP, then
    # the original opaque image format.
    def rank(path: Path) -> tuple[int, int, str]:
        extension_rank = {".png": 0, ".gif": 1, ".webp": 2, ".jpg": 3, ".jpeg": 3, ".svg": 4}
        return (0 if path == external else 1, extension_rank.get(path.suffix.lower(), 9), path.as_posix().casefold())

    return [min(visuals, key=rank)], None, alpha_planes


def runtime_image_dimensions(path: Path) -> tuple[int, int] | None:
    """Read dimensions from the exact copied PNG/JPEG bitmap authority."""
    payload = path.read_bytes()
    if len(payload) >= 24 and payload[:8] == b"\x89PNG\r\n\x1a\n" and payload[12:16] == b"IHDR":
        width, height = struct.unpack(">II", payload[16:24])
        return (width, height) if width > 0 and height > 0 else None
    if len(payload) < 4 or payload[:2] != b"\xff\xd8":
        return None
    position = 2
    start_of_frame = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while position + 4 <= len(payload):
        if payload[position] != 0xFF:
            position += 1
            continue
        while position < len(payload) and payload[position] == 0xFF:
            position += 1
        if position >= len(payload):
            return None
        marker = payload[position]
        position += 1
        if marker in {0x01, 0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if position + 2 > len(payload):
            return None
        length = int.from_bytes(payload[position:position + 2], "big")
        if length < 2 or position + length > len(payload):
            return None
        if marker in start_of_frame and length >= 7:
            height = int.from_bytes(payload[position + 3:position + 5], "big")
            width = int.from_bytes(payload[position + 5:position + 7], "big")
            return (width, height) if width > 0 and height > 0 else None
        position += length
    return None


def node_id(*values: object) -> str:
    return hashlib.sha1("|".join(map(str, values)).encode()).hexdigest()[:10]



@dataclass
class ConversionResult:
    library: dict[str, Any]
    report: dict[str, Any]
    output: Path


def _legacy_native_conversion_error() -> SwfToolError:
    return SwfToolError(
        "SWF_NATIVE_CONVERSION_REQUIRES_LAYA_EMITTER: direct prefab emission "
        "is retired; use neutral conversion and the Laya authored-content emitter"
    )


def prefab_for_asset(asset: dict[str, Any], name: str, bounds: dict[str, float] | None) -> dict[str, Any]:
    del asset, name, bounds
    raise _legacy_native_conversion_error()


def prefab_for_timeline(asset: dict[str, Any], name: str, timeline: dict[str, Any], assets: dict[str, dict[str, Any]], timeline_paths: dict[str, str] | None = None) -> dict[str, Any]:
    del asset, name, timeline, assets, timeline_paths
    raise _legacy_native_conversion_error()


def rasterize_main_timeline(
    bundle: Path,
    output: Path,
    original: dict[str, Any],
    assets: dict[str, dict[str, Any]],
    bounds: dict[str, float],
) -> tuple[dict[str, Any], dict[str, Any]]:
    frames_root = (bundle / "evidence" / "frames").resolve()
    numbered: dict[int, Path] = {}
    if frames_root.is_dir():
        for path in frames_root.rglob("*"):
            match = re.fullmatch(r"(\d+)", path.stem)
            if path.is_file() and path.suffix.lower() in VISUAL_SUFFIXES and match:
                numbered.setdefault(int(match.group(1)), path)
    expected = int(original["frameCount"])
    missing = [index for index in range(1, expected + 1) if index not in numbered]
    if missing:
        raise SwfToolError(
            f"raster mode requires FFDec main-frame exports 1..{expected} under "
            f"{frames_root}; missing {missing[:10]}"
        )
    next_id = max((integer(key) for key in assets), default=0) + 1
    frames: list[dict[str, Any]] = []
    original_by_index = {frame["index"]: frame for frame in original["frames"]}
    for index in range(1, expected + 1):
        source = numbered[index]
        character = next_id + index - 1
        destination = output / "assets" / f"raster-frame-{index}{source.suffix.lower()}"
        shutil.copy2(source, destination)
        asset = {
            "characterId": character,
            "kind": "image",
            "sourceTag": "RasterizedMainFrame",
            "path": destination.relative_to(output).as_posix(),
            "bounds": dict(bounds),
        }
        assets[str(character)] = asset
        source_frame = original_by_index.get(index, {"operations": []})
        retained = [
            dict(operation)
            for operation in source_frame.get("operations", [])
            if operation.get("op") in {"label", "sound", "script"}
        ]
        operations = ([] if index == 1 else [{"op": "remove", "depth": 1}]) + [
            {"op": "place", "depth": 1, "move": False, "characterId": character, "name": f"raster_frame_{index}"}
        ] + retained
        frame: dict[str, Any] = {"index": index, "operations": operations}
        if source_frame.get("label"):
            frame["label"] = source_frame["label"]
        frames.append(frame)
    return {
        **{key: value for key, value in original.items() if key != "frames"},
        "frames": frames,
    }, {
        "feature": "raster-timeline-substitution",
        "symbolId": 0,
        "frameCount": expected,
        "detail": "visual children and hit/text accessibility are flattened into full-frame images",
    }

def convert_bundle(
    bundle: Path,
    output: Path,
    mode: str,
    allow_unsupported: bool,
    force: bool,
    native_callback_manifest: Path | None = DEFAULT_NATIVE_CALLBACK_MANIFEST,
) -> ConversionResult:
    if native_callback_manifest is not None:
        raise SwfToolError(
            "SWF_NATIVE_CALLBACK_POLICY_REQUIRES_APPLICATION_ORCHESTRATION: "
            "neutral conversion does not admit application callback manifests"
        )
    bundle = bundle.resolve()
    output = output.resolve()
    structure = bundle / "structure.xml"
    if not structure.is_file():
        raise SwfToolError(f"missing JPEXS structure.xml in {bundle}; run extract first")
    structure_bytes = structure.read_bytes()
    structure_sha256 = hashlib.sha256(structure_bytes).hexdigest()
    if output == bundle or output in bundle.parents or bundle in output.parents:
        raise SwfToolError("conversion bundle and output must be disjoint directories")
    prepare_owned_output(output, "conversion-manifest.json", "swf-conversion@1", force)
    manifest_path = output / "conversion-manifest.json"
    output.mkdir(parents=True, exist_ok=True)
    write_json(manifest_path, {
        "schema": "swf-conversion@1",
        "toolVersion": TOOL_VERSION,
        "complete": False,
        "sourceStructure": {"path": "structure.xml", "sha256": structure_sha256},
        "files": [],
    })
    (output / "assets").mkdir(exist_ok=True)
    (output / "timelines").mkdir(exist_ok=True)

    try:
        root = ET.fromstring(structure_bytes)
    except ET.ParseError as error:
        raise SwfToolError(f"invalid JPEXS XML: {error}") from error
    major = integer(root.attrib.get("_xmlExportMajor"), -1)
    minor = integer(root.attrib.get("_xmlExportMinor"), -1)
    if major not in SUPPORTED_XML_MAJORS:
        raise SwfToolError(f"unsupported JPEXS XML export version {major}.{minor}; supported majors: {sorted(SUPPORTED_XML_MAJORS)}")

    header_path = bundle / "swf-header.json"
    header = json.loads(header_path.read_text(encoding="utf-8")) if header_path.is_file() else {}
    display = direct_child(root, "displayRect")
    stage_rect = rect_value(display) or header.get("stage", {})
    frame_rate = number(root.attrib.get("frameRate"), number(str(header.get("frame_rate", 24)), 24))
    frame_count = integer(root.attrib.get("frameCount"), integer(str(header.get("frame_count", 1)), 1))
    source_name = header.get("path") or "source.swf"
    symbols = symbol_map(root)
    symbol_by_id = {tag_id: name for name, tag_id in symbols.items() if tag_id != 0}
    evidence = find_evidence_files(bundle)
    definitions: dict[int, ET.Element] = {}
    for element in root.iter():
        tag_id = character_id(element)
        if tag_id is not None and tag_id > 0:
            definitions.setdefault(tag_id, element)

    definition_bounds_cache: dict[int, dict[str, float] | None] = {}

    def transformed_bounds(
        bounds: dict[str, float],
        matrix: dict[str, float] | None,
    ) -> dict[str, float]:
        matrix = matrix or {"a": 1, "b": 0, "c": 0, "d": 1, "tx": 0, "ty": 0}
        corners = [
            (bounds["x"], bounds["y"]),
            (bounds["x"] + bounds["width"], bounds["y"]),
            (bounds["x"], bounds["y"] + bounds["height"]),
            (bounds["x"] + bounds["width"], bounds["y"] + bounds["height"]),
        ]
        points = [
            (
                matrix["a"] * x + matrix["c"] * y + matrix["tx"],
                matrix["b"] * x + matrix["d"] * y + matrix["ty"],
            )
            for x, y in corners
        ]
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs), "height": max(ys) - min(ys)}

    def union_bounds(values: list[dict[str, float]]) -> dict[str, float] | None:
        if not values:
            return None
        left = min(value["x"] for value in values)
        top = min(value["y"] for value in values)
        right = max(value["x"] + value["width"] for value in values)
        bottom = max(value["y"] + value["height"] for value in values)
        return {"x": left, "y": top, "width": right - left, "height": bottom - top}

    def definition_bounds(tag_id: int, visiting: set[int] | None = None) -> dict[str, float] | None:
        if tag_id in definition_bounds_cache:
            return definition_bounds_cache[tag_id]
        visiting = set() if visiting is None else visiting
        if tag_id in visiting:
            return None
        visiting.add(tag_id)
        tag = definitions.get(tag_id)
        kind = definition_kind(tag.attrib.get("type", "")) if tag is not None else "definition"
        text_records = direct_child(tag, "textRecords") if kind == "text" and tag is not None else None
        # DefineSprite has no serialized bounds; FFDec's convenience bounds
        # can inherit sentinel rectangles from empty DefineText records. Build
        # sprite bounds from the authenticated display-list closure instead.
        # An empty DefineText renders no glyphs and therefore contributes no
        # visual extent, even when FFDec reports its signed-bit sentinel RECT.
        has_text_records = text_records is not None and len(text_records) > 0
        bounds = None if kind == "sprite" or kind == "text" and not has_text_records else (
            tag_bounds(tag) if tag is not None else None
        )
        child_bounds: list[dict[str, float]] = []
        if bounds is None and tag is not None:
            if kind == "sprite":
                timeline, _ = timeline_from_tags(
                    list_items(tag, "subTags"),
                    tag_id,
                    None,
                    frame_rate,
                    integer(tag.attrib.get("frameCount"), 1),
                )
                operations = [operation for frame in timeline["frames"] for operation in frame["operations"]]
            elif kind == "button":
                operations = [
                    {
                        "characterId": record["characterId"],
                        "matrix": record.get("matrix"),
                    }
                    for record in button_value(tag)["records"]
                ]
            else:
                operations = []
            for operation in operations:
                child_id = operation.get("characterId")
                if child_id is None:
                    continue
                child = definition_bounds(integer(child_id), visiting)
                if child is not None:
                    child_bounds.append(transformed_bounds(child, operation.get("matrix")))
            bounds = union_bounds(child_bounds)
        visiting.remove(tag_id)
        definition_bounds_cache[tag_id] = bounds
        return bounds

    font_metadata = {
        tag_id: font_value(tag)
        for tag_id, tag in definitions.items()
        if definition_kind(tag.attrib.get("type", "")) == "font"
    }
    scaling_grid_tags = {
        integer(attr_first(element, ("characterId", "characterID"))): element
        for element in root.iter()
        if element.attrib.get("type") == "DefineScalingGridTag"
    }
    csm_text_settings = {
        integer(attr_first(element, ("textID", "textId", "characterId"))): csm_text_settings_value(element)
        for element in root.iter()
        if element.attrib.get("type") in {"CSMSettingsTag", "CSMTextSettingsTag"}
    }
    font_align_zones = {
        integer(attr_first(element, ("fontID", "fontId", "characterId"))): font_align_zones_value(element)
        for element in root.iter()
        if element.attrib.get("type") == "DefineFontAlignZonesTag"
    }
    scene_metadata = next(
        (
            scene_frame_metadata_value(element)
            for element in root.iter()
            if element.attrib.get("type") == "DefineSceneAndFrameLabelDataTag"
        ),
        {"scenes": [], "frameLabels": []},
    )

    assets: dict[str, dict[str, Any]] = {}
    missing_assets: list[dict[str, Any]] = []
    unsupported: list[dict[str, Any]] = []
    holds: list[dict[str, Any]] = []
    representations: list[dict[str, Any]] = []
    verification: set[str] = set()
    for tag_id, tag in sorted(definitions.items()):
        tag_type = tag.attrib.get("type", "")
        kind = definition_kind(tag_type)
        symbol_name = symbol_by_id.get(tag_id)
        asset: dict[str, Any] = {"characterId": tag_id, "kind": kind, "sourceTag": tag_type}
        bitmap_issue: str | None = None
        if symbol_name:
            asset["symbolName"] = symbol_name
        bounds = definition_bounds(tag_id)
        if bounds:
            asset["bounds"] = bounds
        if tag_id in scaling_grid_tags:
            asset["scalingGrid"] = scaling_grid_value(scaling_grid_tags[tag_id], bounds)
            verification.add("native-nine-slice-scaling")
        if tag_id in csm_text_settings:
            asset["textRendering"] = csm_text_settings[tag_id]
            verification.add("flash-csm-text-rasterization")
        if tag_id in font_align_zones:
            asset["fontAlignZones"] = font_align_zones[tag_id]
            verification.add("flash-font-align-zone-rasterization")
        if kind == "shape":
            geometry = shape_geometry_value(tag)
            if geometry:
                asset["shape"] = geometry
        elif kind == "button":
            asset["button"] = button_value(tag)
            verification.add("button-state-and-hit-testing")
        elif kind == "input-text":
            asset["textField"] = edit_text_value(tag)
            asset["initialText"] = asset["textField"]["initialText"]
            verification.add("dynamic-text-layout-and-fonts")
        elif kind == "font":
            asset["font"] = font_metadata[tag_id]
            verification.add("embedded-font-registration-and-metrics")
        elif kind == "sound":
            asset["sound"] = sound_definition_value(tag)
            verification.add("sound-loop-envelope-and-sync-semantics")
        elif kind == "morph":
            asset["morph"] = morph_value(tag)
        elif kind == "image":
            bitmap = bitmap_definition_value(tag)
            if bitmap is not None:
                asset["bitmap"] = bitmap
                verification.add("bitmap-alpha-and-lossless-fidelity")
        elif kind == "text":
            static_text = static_text_value(tag, {"runs": []}, font_metadata)
            if static_text["runs"]:
                asset["staticText"] = static_text
                asset["initialText"] = "".join(run.get("text", "") for run in static_text["runs"])
        else:
            initial = attr_first(tag, ("initialText", "text"))
            if initial is not None and kind == "text":
                asset["initialText"] = initial
        if kind == "image":
            matches, bitmap_issue, alpha_planes = match_bitmap_evidence(
                tag, tag_id, symbol_name, evidence, structure
            )
            if asset.get("bitmap") is not None and alpha_planes:
                asset["bitmap"]["splitAlphaEvidenceCount"] = len(alpha_planes)
        else:
            matches = match_evidence(tag, tag_id, symbol_name, evidence, structure)
        bitmap_fill_preview = (
            kind == "shape"
            and any(
                style.get("kind") == "bitmap"
                for style in asset.get("shape", {}).get("fillStyles", [])
                if isinstance(style, dict)
            )
        )
        diagnostic_preview_category = (
            "shape-previews" if bitmap_fill_preview
            else "sprite-previews" if kind == "sprite"
            else None
        )
        if kind == "morph":
            matches = sorted(matches, key=morph_evidence_rank)
        if matches:
            copied: list[str] = []
            copied_text: list[str] = []
            copied_sources: list[tuple[Path, str]] = []
            for index, source in enumerate(matches):
                if diagnostic_preview_category:
                    destination = output / "diagnostics" / diagnostic_preview_category / f"{tag_id}{'-' + str(index + 1) if index else ''}{source.suffix.lower()}"
                else:
                    destination = output / "assets" / f"{tag_id}{'-' + str(index + 1) if index else ''}{source.suffix.lower()}"
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                relative = destination.relative_to(output).as_posix()
                if source.suffix.lower() in TEXT_SUFFIXES:
                    copied_text.append(relative)
                    if kind == "text" and "initialText" not in asset:
                        formatted = parse_formatted_text(source)
                        asset["initialText"] = formatted["text"]
                        asset["staticText"] = static_text_value(tag, formatted, font_metadata)
                else:
                    copied.append(relative)
                    copied_sources.append((source, relative))
            if copied:
                if diagnostic_preview_category:
                    asset["diagnosticPreviewPath"] = copied[0]
                    if len(copied) > 1:
                        asset["diagnosticPreviewPaths"] = copied
                elif kind in {"button", "text", "input-text"}:
                    asset["previewPath"] = copied[0]
                    if len(copied) > 1:
                        asset["previewPaths"] = copied
                else:
                    asset["path"] = copied[0]
                    if kind == "image" and asset.get("bitmap") is not None:
                        dimensions = runtime_image_dimensions(copied_sources[0][0])
                        if dimensions is not None:
                            width, height = dimensions
                            declared_width = asset["bitmap"].get("width")
                            declared_height = asset["bitmap"].get("height")
                            if declared_width not in {None, width} or declared_height not in {None, height}:
                                raise SwfToolError(f"bitmap {tag_id} source dimensions disagree with SWF metadata")
                            asset["bitmap"]["width"] = width
                            asset["bitmap"]["height"] = height
                    if len(copied) > 1:
                        asset["paths"] = copied
                    if kind == "image" and isinstance(asset.get("bitmap"), dict):
                        dimensions = encoded_image_dimensions(copied_sources[0][0])
                        if dimensions is not None:
                            asset["bitmap"].setdefault("width", dimensions[0])
                            asset["bitmap"].setdefault("height", dimensions[1])
                    if kind == "morph":
                        endpoints = asset["morph"]
                        start_path = next((relative for source, relative in copied_sources if morph_evidence_rank(source)[0] == 0), None)
                        end_path = next((relative for source, relative in copied_sources if morph_evidence_rank(source)[0] == 1), None)
                        if start_path:
                            endpoints["startPath"] = start_path
                            asset["path"] = start_path
                        if end_path:
                            endpoints["endPath"] = end_path
            if copied_text:
                asset["textEvidence"] = copied_text[0]
                if len(copied_text) > 1:
                    asset["textEvidencePaths"] = copied_text

        bitmap_fill_issue: str | None = None
        if bitmap_fill_preview:
            bitmap_fill_runtime, bitmap_fill_issue = direct_bitmap_fill_runtime_value(asset, assets)
            if bitmap_fill_runtime is not None:
                bitmap_asset = assets[str(bitmap_fill_runtime["bitmapCharacterId"])]
                asset["path"] = bitmap_asset["path"]
                asset["bitmapFillRuntime"] = bitmap_fill_runtime
                verification.add("bitmap-fill-point-clamp-sampling")
            else:
                holds.append({
                    "feature": "bitmap-fill-runtime-projection",
                    "symbolId": tag_id,
                    "tagType": tag_type,
                    "detail": bitmap_fill_issue,
                })

        required_evidence_missing = (
            (kind in {"image", "shape", "morph", "sound", "video", "binary"} and not asset.get("path"))
            or (kind == "font" and asset.get("font", {}).get("embedded") and not asset.get("path"))
            or (kind == "button" and not asset.get("button", {}).get("records"))
        )
        if required_evidence_missing:
            asset["placeholder"] = True
            missing = {"characterId": tag_id, "kind": kind, "sourceTag": tag_type}
            if bitmap_issue:
                missing["detail"] = bitmap_issue
            missing_assets.append(missing)
        if kind == "shape":
            if asset.get("bitmapFillRuntime"):
                shape_feature = "bitmap-fill-character-runtime"
                visual_authority = "bitmap-character-export"
            elif bitmap_fill_preview:
                shape_feature = "bitmap-fill-geometry-only"
                visual_authority = "unbound"
            else:
                shape_feature = "vector-shape-geometry-with-raster-visual"
                visual_authority = "ffdec-preview"
            representations.append({
                "feature": shape_feature,
                "tagType": tag_type,
                "symbolId": tag_id,
                "losslessForAuthoredScale": bool(asset.get("path")) and not bitmap_fill_issue,
                "vectorHitGeometry": bool(asset.get("shape", {}).get("segments")),
                "visualAuthority": visual_authority,
            })
        elif kind == "morph":
            native_geometry = bool(asset.get("morph", {}).get("geometry", {}).get("interpolatable"))
            representations.append({
                "feature": "morph-native-geometry" if native_geometry else "morph-raster-endpoints",
                "tagType": tag_type,
                "symbolId": tag_id,
                "start": bool(asset.get("morph", {}).get("startPath")),
                "end": bool(asset.get("morph", {}).get("endPath")),
                "nativeGeometry": native_geometry,
            })
            if not native_geometry:
                unsupported.append({
                    "feature": "morph-shape-interpolation",
                    "tagType": tag_type,
                    "symbolId": tag_id,
                    "issues": asset.get("morph", {}).get("geometry", {}).get("issues", ["shape records are missing"]),
                })
        elif kind == "image" and asset.get("bitmap") is not None:
            representations.append({
                "feature": "bitmap-runtime-visual",
                "tagType": tag_type,
                "tagCode": asset["bitmap"]["tagCode"],
                "symbolId": tag_id,
                "alphaMode": asset["bitmap"]["alphaMode"],
                "lossless": asset["bitmap"]["lossless"],
                "runtimeReady": bool(asset.get("path")),
            })
        elif kind == "video":
            unsupported.append({"feature": "video", "tagType": tag_type, "symbolId": tag_id})
        elif kind == "text":
            exact_glyphs = bool(asset.get("staticText", {}).get("exactGlyphs"))
            representations.append({
                "feature": "static-text-exact-glyphs" if exact_glyphs else "static-text-formatted-fallback",
                "tagType": tag_type,
                "symbolId": tag_id,
                "exactGlyphs": exact_glyphs,
            })
            if not exact_glyphs:
                unsupported.append({
                    "feature": "static-text-glyph-metrics",
                    "tagType": tag_type,
                    "symbolId": tag_id,
                    "issues": asset.get("staticText", {}).get("issues", ["SWF text records are missing"]),
                })
            verification.add("static-and-html-text-layout")
        elif kind == "input-text":
            verification.add("static-and-html-text-layout")
        assets[str(tag_id)] = asset

    root_tags = list_items(root, "tags")
    stage_background = next(
        (
            rgba_value(direct_child(tag, "backgroundColor"))
            for tag in root_tags
            if tag.attrib.get("type") == "SetBackgroundColorTag"
        ),
        None,
    )
    main_timeline, issues = timeline_from_tags(root_tags, 0, symbols and next((name for name, value in symbols.items() if value == 0), None), frame_rate, frame_count)
    unsupported.extend(issues)

    def attach_stream_assets(timeline: dict[str, Any]) -> None:
        stream_operations = [
            operation
            for frame in timeline["frames"]
            for operation in frame["operations"]
            if operation.get("op") == "sound" and operation.get("stream")
        ]
        for operation in stream_operations:
            stream_id = integer(operation.get("soundId"))
            key = str(stream_id)
            if key in assets:
                continue
            matches: list[Path] = []
            for candidate in evidence:
                if candidate.suffix.lower() not in AUDIO_SUFFIXES or candidate.stem != key:
                    continue
                try:
                    parts = {part.lower() for part in candidate.resolve().relative_to(bundle).parts}
                except ValueError:
                    parts = {part.lower() for part in candidate.parts}
                if "sounds" in parts:
                    matches.append(candidate)
            stream_info = operation.get("streamInfo", {})
            asset: dict[str, Any] = {
                "characterId": stream_id,
                "kind": "sound-stream",
                "sourceTag": "SoundStreamHeadTag",
                "sound": {
                    "format": stream_info.get("format", -1),
                    "rateCode": stream_info.get("rateCode", -1),
                    "sampleRate": stream_info.get("sampleRate"),
                    "sampleSize": stream_info.get("sampleSize", 16),
                    "channels": stream_info.get("channels", 1),
                    "sampleCount": stream_info.get("samplesPerFrame", 0) * stream_info.get("blockCount", 0),
                },
                "stream": dict(stream_info),
            }
            copied: list[str] = []
            for match_index, source in enumerate(sorted(matches)):
                suffix = f"-{match_index + 1}" if match_index else ""
                destination = output / "assets" / f"stream-{abs(stream_id)}{suffix}{source.suffix.lower()}"
                shutil.copy2(source, destination)
                copied.append(destination.relative_to(output).as_posix())
            if copied:
                asset["path"] = copied[0]
                if len(copied) > 1:
                    asset["paths"] = copied
            else:
                asset["placeholder"] = True
                missing_assets.append({"characterId": stream_id, "kind": "sound-stream", "sourceTag": "SoundStreamHeadTag"})
            assets[key] = asset
            verification.add("stream-sound-frame-synchronization")

    attach_stream_assets(main_timeline)
    if mode == "raster":
        main_timeline, raster_issue = rasterize_main_timeline(
            bundle, output, main_timeline, assets, stage_rect
        )
        unsupported.append(raster_issue)
    timelines: dict[str, str] = {"0": "timelines/main.timeline.json"}
    write_json(output / timelines["0"], main_timeline)
    for tag_id, tag in sorted(definitions.items()):
        if tag.attrib.get("type") != "DefineSpriteTag":
            continue
        timeline, issues = timeline_from_tags(list_items(tag, "subTags"), tag_id, symbol_by_id.get(tag_id), frame_rate, integer(tag.attrib.get("frameCount"), 1))
        attach_stream_assets(timeline)
        relative = f"timelines/{tag_id}.timeline.json"
        write_json(output / relative, timeline)
        timelines[str(tag_id)] = relative
        asset = assets[str(tag_id)]
        asset["timeline"] = relative
        unsupported.extend(issues)

    all_timelines = [main_timeline]
    all_timelines.extend(
        json.loads((output / relative).read_text(encoding="utf-8"))
        for symbol, relative in timelines.items()
        if symbol != "0"
    )
    for timeline in all_timelines:
        for frame in timeline["frames"]:
            for operation in frame["operations"]:
                if operation.get("clipDepth", 0) > operation.get("depth", 0):
                    verification.add("nested-mask-depth-ranges")
                if operation.get("filters"):
                    verification.add("filter-pixel-goldens")
                if "blendMode" in operation:
                    verification.add("blend-mode-backdrop-pixel-goldens")
                if "colorTransform" in operation:
                    verification.add("full-color-transform-pixel-goldens")

    for element in root.iter():
        kind = element.attrib.get("type", "")
        if kind == "UnknownTag":
            unsupported.append({"feature": "unknown-tag", "tagType": kind, "tagId": integer(element.attrib.get("tagId"), -1)})
        elif kind.startswith("ImportAssets"):
            unsupported.append({"feature": "imported-library", "tagType": kind})

    # Stable de-duplication keeps the report usable on large authored files.
    unique_unsupported: list[dict[str, Any]] = []
    seen_issues: set[str] = set()
    for issue in unsupported:
        key = json.dumps(issue, sort_keys=True)
        if key not in seen_issues:
            seen_issues.add(key)
            unique_unsupported.append(issue)
    unsupported = unique_unsupported
    effective_mode = mode
    if mode == "auto":
        effective_mode = "hybrid" if unsupported or missing_assets or holds or representations else "structured"

    verification_required = sorted({"golden-frame-screenshots", "timeline-label-navigation", *verification}) if assets else []

    stage = {
        "width": stage_rect.get("width", 0),
        "height": stage_rect.get("height", 0),
        "frameRate": frame_rate,
        "frameCount": main_timeline["frameCount"],
    }
    if stage_background is not None:
        stage["backgroundColor"] = stage_background

    library = {
        "schema": "flash-library@1",
        "source": source_name,
        "sourceSha256": header.get("sha256"),
        "jpexsXmlVersion": {"major": major, "minor": minor},
        "stage": stage,
        "symbols": symbols,
        "assets": assets,
        "resources": sorted({
            path
            for asset in assets.values()
            for path in (([asset["path"]] if asset.get("path") else []) + asset.get("paths", []))
        }),
        "timelines": timelines,
        "scenes": scene_metadata["scenes"],
        "frameLabels": scene_metadata["frameLabels"],
    }
    write_json(output / "library.json", library)
    report = {
        "schema": "swf-conversion-report@1",
        "toolVersion": TOOL_VERSION,
        "requestedMode": mode,
        "effectiveMode": effective_mode,
        "allowUnsupported": allow_unsupported,
        "clean": not unsupported and not missing_assets and not holds and not verification_required,
        "counts": {"definitions": len(assets), "symbols": len(symbols), "timelines": len(timelines), "unsupported": len(unsupported), "missingAssets": len(missing_assets), "holds": len(holds), "representations": len(representations)},
        "unsupported": unsupported,
        "missingAssets": missing_assets,
        "holds": holds,
        "representations": representations,
        "verificationRequired": verification_required,
    }
    write_json(output / "conversion-report.json", report)
    output_files = sorted(path for path in output.rglob("*") if path.is_file() and path != manifest_path)
    conversion_manifest = {
        "schema": "swf-conversion@1",
        "toolVersion": TOOL_VERSION,
        "complete": True,
        "sourceStructure": {"path": "structure.xml", "sha256": structure_sha256},
        "files": [{"path": path.relative_to(output).as_posix(), "sha256": sha256_file(path), "size": path.stat().st_size} for path in output_files],
    }
    write_json(manifest_path, conversion_manifest)
    return ConversionResult(library, report, output)


def contained_path(root: Path, relative: str, errors: list[str], label: str) -> Path | None:
    candidate_raw = Path(relative)
    if candidate_raw.is_absolute():
        errors.append(f"{label} must be relative: {relative}")
        return None
    candidate = (root / candidate_raw).resolve()
    if candidate != root and root not in candidate.parents:
        errors.append(f"{label} escapes output root: {relative}")
        return None
    return candidate



def _load_conversion_json(path: Path, errors: list[str], label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        errors.append(f"{label} is missing or invalid: {error}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{label} must be an object")
        return {}
    return value


def _contained_conversion_path(root: Path, relative: object, errors: list[str], label: str) -> Path | None:
    if not isinstance(relative, str) or not relative:
        errors.append(f"{label} must be a non-empty relative path")
        return None
    raw = Path(relative)
    if raw.is_absolute() or ".." in raw.parts:
        errors.append(f"{label} must stay inside the conversion root: {relative}")
        return None
    candidate = (root / raw).resolve()
    if candidate != root and root not in candidate.parents:
        errors.append(f"{label} escapes the conversion root: {relative}")
        return None
    return candidate


def validate_conversion(output: Path) -> dict[str, Any]:
    """Validate a neutral flash-library conversion without runtime policy."""
    output = output.resolve()
    errors: list[str] = []
    warnings: list[str] = []
    library = _load_conversion_json(output / "library.json", errors, "library.json")
    report = _load_conversion_json(output / "conversion-report.json", errors, "conversion-report.json")
    manifest = _load_conversion_json(output / "conversion-manifest.json", errors, "conversion-manifest.json")
    if library.get("schema") != "flash-library@1":
        errors.append("library.json has unsupported schema")
    for forbidden in ("timelineRuntime", "mainPrefab"):
        if forbidden in library:
            errors.append(f"library.json contains retired runtime field: {forbidden}")
    stage = library.get("stage")
    if not isinstance(stage, dict):
        errors.append("library stage must be an object")
    else:
        background = stage.get("backgroundColor")
        if background is not None and (
            not isinstance(background, dict)
            or type(background.get("color")) is not int
            or not 0 <= background["color"] <= 0xFFFFFF
            or not isinstance(background.get("alpha"), (int, float))
            or isinstance(background.get("alpha"), bool)
            or not 0 <= background["alpha"] <= 1
        ):
            errors.append("library stage.backgroundColor must be an RGB color with alpha from 0 to 1")
    assets = library.get("assets")
    if not isinstance(assets, dict):
        errors.append("library assets must be an object")
        assets = {}
    timelines = library.get("timelines")
    if not isinstance(timelines, dict):
        errors.append("library timelines must be an object")
        timelines = {}
    resources = library.get("resources")
    if not isinstance(resources, list) or any(not isinstance(item, str) for item in resources):
        errors.append("library resources must be an array of paths")
        resources = []
    referenced_paths: set[str] = set(resources)
    for asset_id, asset in assets.items():
        if not isinstance(asset, dict):
            errors.append(f"asset {asset_id} must be an object")
            continue
        for forbidden in ("prefab", "timelineBinding"):
            if forbidden in asset:
                errors.append(f"asset {asset_id} contains retired runtime field: {forbidden}")
        for field in ("path", "previewPath", "diagnosticPreviewPath"):
            if field not in asset:
                continue
            value = asset[field]
            if isinstance(value, str):
                referenced_paths.add(value)
            else:
                errors.append(f"asset {asset_id} {field} must be a path")
        for field in ("paths", "previewPaths", "diagnosticPreviewPaths", "textEvidencePaths"):
            if field not in asset:
                continue
            values = asset[field]
            if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
                errors.append(f"asset {asset_id} {field} must be an array of paths")
            else:
                referenced_paths.update(values)
        morph = asset.get("morph")
        if morph is not None:
            if not isinstance(morph, dict):
                errors.append(f"asset {asset_id} morph must be an object")
            else:
                for field in ("startPath", "endPath"):
                    if field not in morph:
                        continue
                    value = morph[field]
                    if isinstance(value, str):
                        referenced_paths.add(value)
                    else:
                        errors.append(f"asset {asset_id} morph.{field} must be a path")
        timeline = asset.get("timeline")
        if isinstance(timeline, str):
            referenced_paths.add(timeline)
    for timeline_id, relative in timelines.items():
        path = _contained_conversion_path(output, relative, errors, f"timeline {timeline_id}")
        if path is None or not path.is_file():
            errors.append(f"timeline {timeline_id} is missing: {relative}")
            continue
        timeline = _load_conversion_json(path, errors, f"timeline {timeline_id}")
        if timeline.get("schema") != "flash-timeline@1":
            errors.append(f"timeline {timeline_id} has unsupported schema")
        referenced_paths.add(str(relative))
    for relative in sorted(referenced_paths):
        path = _contained_conversion_path(output, relative, errors, "library resource")
        if path is not None and not path.is_file():
            errors.append(f"library resource is missing: {relative}")
    if report.get("schema") != "swf-conversion-report@1":
        errors.append("conversion-report.json has unsupported schema")
    verification_required = report.get("verificationRequired", [])
    if not isinstance(verification_required, list):
        errors.append("conversion report verificationRequired must be an array")
        verification_required = []
    elif verification_required:
        warnings.append("conversion remains non-clean until verification gates pass: " + ", ".join(map(str, verification_required)))
    unsupported = report.get("unsupported", [])
    missing_assets = report.get("missingAssets", [])
    holds = report.get("holds", [])
    if not all(isinstance(value, list) for value in (unsupported, missing_assets, holds)):
        errors.append("conversion report obligation fields must be arrays")
        unsupported, missing_assets, holds = [], [], []
    representations = report.get("representations", [])
    if not isinstance(representations, list):
        errors.append("conversion report representations must be an array")
        representations = []
    counts = report.get("counts")
    symbols = library.get("symbols", {})
    expected_counts = {
        "definitions": len(assets),
        "symbols": len(symbols) if isinstance(symbols, dict) else 0,
        "timelines": len(timelines),
        "unsupported": len(unsupported),
        "missingAssets": len(missing_assets),
        "holds": len(holds),
        "representations": len(representations),
    }
    if counts != expected_counts:
        errors.append("conversion report counts do not match neutral library obligations")
    expected_clean = not unsupported and not missing_assets and not holds and not verification_required
    if report.get("clean") != expected_clean:
        errors.append("conversion report clean status ignores unresolved obligations")
    if unsupported or missing_assets or holds:
        message = (
            f"conversion has {len(unsupported)} unsupported features and "
            f"{len(missing_assets)} unresolved assets and {len(holds)} HOLDs"
        )
        if report.get("allowUnsupported"):
            warnings.append(message)
        else:
            errors.append(message)
    if manifest.get("schema") != "swf-conversion@1":
        errors.append("conversion-manifest.json has unsupported schema")
    else:
        if manifest.get("complete") is not True:
            errors.append("conversion manifest is incomplete")
        seen: set[str] = set()
        files = manifest.get("files", [])
        if not isinstance(files, list):
            errors.append("conversion manifest files must be an array")
            files = []
        for item in files:
            if not isinstance(item, dict):
                errors.append("conversion manifest file must be an object")
                continue
            relative = item.get("path")
            if not isinstance(relative, str) or relative in seen:
                errors.append(f"duplicate or invalid conversion manifest path: {relative}")
                continue
            seen.add(relative)
            path = _contained_conversion_path(output, relative, errors, "manifest file")
            if path is None or not path.is_file():
                errors.append(f"manifest file missing: {relative}")
            elif sha256_file(path) != item.get("sha256") or path.stat().st_size != item.get("size"):
                errors.append(f"manifest hash/size mismatch: {relative}")
        actual_files = {
            path.relative_to(output).as_posix()
            for path in output.rglob("*")
            if path.is_file() and path != output / "conversion-manifest.json"
        }
        if seen != actual_files:
            errors.append("conversion manifest file census does not match output files")
    return {"ok": not errors, "errors": errors, "warnings": warnings, "summary": {"assets": len(assets), "timelines": len(timelines), "unsupported": len(unsupported), "missingAssets": len(missing_assets), "holds": len(holds)}}


convert_neutral_bundle = convert_bundle


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="explicit converter config containing ffdec_jar")
    parser.add_argument("--version", action="version", version=TOOL_VERSION)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect_parser = commands.add_parser("inspect", help="parse a SWF header without Java")
    inspect_parser.add_argument("input", type=Path)
    extract_parser = commands.add_parser("extract", help="create an auditable JPEXS evidence bundle")
    extract_parser.add_argument("input", type=Path)
    extract_parser.add_argument("output", type=Path)
    extract_parser.add_argument("--java", type=Path)
    extract_parser.add_argument("--ffdec-jar", type=Path)
    extract_parser.add_argument("--force", action="store_true")
    swc_parser = commands.add_parser("unpack-swc", help="safely expose SWC catalogs and library SWFs")
    swc_parser.add_argument("input", type=Path)
    swc_parser.add_argument("output", type=Path)
    swc_parser.add_argument("--force", action="store_true")
    convert_parser = commands.add_parser("convert", help="normalize FFDec evidence to a neutral flash-library bundle")
    convert_parser.add_argument("bundle", type=Path)
    convert_parser.add_argument("output", type=Path)
    convert_parser.add_argument("--mode", choices=("auto", "structured", "hybrid", "raster"), default="auto")
    convert_parser.add_argument("--allow-unsupported", action="store_true")
    convert_parser.add_argument("--native-callback-manifest", type=Path, default=None)
    convert_parser.add_argument("--force", action="store_true")
    validate_parser = commands.add_parser("validate", help="validate a neutral flash-library conversion bundle")
    validate_parser.add_argument("output", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = make_parser().parse_args(argv)
    try:
        if args.command == "inspect":
            result = inspect_swf(args.input)
        elif args.command == "extract":
            ffdec_jar = resolve_ffdec_jar(args.ffdec_jar, args.config)
            result = extract_swf(args.input, args.output, args.java, ffdec_jar, args.force)
        elif args.command == "unpack-swc":
            result = unpack_swc(args.input, args.output, args.force)
        elif args.command == "convert":
            conversion = convert_bundle(args.bundle, args.output, args.mode, args.allow_unsupported, args.force, args.native_callback_manifest)
            validation = validate_conversion(conversion.output)
            result = {"output": str(conversion.output), "report": conversion.report["counts"], "validation": validation}
            print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
            return 0 if validation["ok"] else 1
        elif args.command == "validate":
            result = validate_conversion(args.output)
            print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
            return 0 if result["ok"] else 1
        else:
            raise AssertionError(args.command)
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (OSError, SwfToolError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
