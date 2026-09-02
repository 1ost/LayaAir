from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PYTHON_TOOLING_ROOT = (
    REPOSITORY_ROOT
    / "src"
    / "extensions"
    / "authoredContent"
    / "tooling"
    / "python"
)
sys.path.insert(0, str(PYTHON_TOOLING_ROOT))

import laya_authored_swf as swf  # noqa: E402


def _signed_bits(value: int, width: int) -> str:
    if value < 0:
        value += 1 << width
    return f"{value:0{width}b}"


def _rect(values: tuple[int, int, int, int], width: int = 15) -> bytes:
    bits = f"{width:05b}" + "".join(_signed_bits(value, width) for value in values)
    bits += "0" * ((8 - len(bits) % 8) % 8)
    return int(bits, 2).to_bytes(len(bits) // 8, "big")


def _minimal_swf() -> bytes:
    body = _rect((0, 2000, 0, 1000)) + bytes((0, 24)) + (1).to_bytes(2, "little") + b"\0\0"
    return b"FWS" + bytes((10,)) + (8 + len(body)).to_bytes(4, "little") + body


class ProviderOwnedSwfToolTests(unittest.TestCase):
    def test_color_transform_canonicalizes_flash_identity_defaults(self) -> None:
        self.assertIsNone(swf.color_transform_value(None))
        self.assertIsNone(swf.color_transform_value(ET.fromstring("<colorTransform />")))
        self.assertEqual(
            {
                "redMultiplier": 1.0,
                "greenMultiplier": 1.0,
                "blueMultiplier": 1.0,
                "alphaMultiplier": 0.5,
                "redOffset": 0.0,
                "greenOffset": 0.0,
                "blueOffset": 0.0,
                "alphaOffset": 0.0,
            },
            swf.color_transform_value(ET.fromstring('<colorTransform alphaMultTerm="128" />')),
        )
        self.assertEqual(
            {
                "redMultiplier": 0.5,
                "greenMultiplier": 0.75,
                "blueMultiplier": 1.0,
                "alphaMultiplier": 0.25,
                "redOffset": -5.0,
                "greenOffset": 6.0,
                "blueOffset": 7.0,
                "alphaOffset": 8.0,
            },
            swf.color_transform_value(ET.fromstring(
                '<colorTransform redMultTerm="128" greenMultTerm="192" blueMultTerm="256" '
                'alphaMultTerm="64" redAddTerm="-5" greenAddTerm="6" blueAddTerm="7" alphaAddTerm="8" />'
            )),
        )

    def test_color_transform_rejects_invalid_and_non_finite_fields(self) -> None:
        for value in ("invalid", "NaN", "Infinity", "-Infinity"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(swf.SwfToolError, "invalid finite color transform field redMultTerm"):
                    swf.color_transform_value(ET.fromstring(f'<colorTransform redMultTerm="{value}" />'))

    def test_required_migration_surface_is_exported(self) -> None:
        required = {
            "BitReader", "SWF_TAG_NAMES", "SwfToolError", "TOOL_VERSION",
            "_skip_swf_matrix", "_skip_swf_string", "_uncompressed_body",
            "analyze_swf_bytes", "bitmap_definition_value", "button_value",
            "catalog_summary", "character_id", "convert_bundle", "convert_neutral_bundle",
            "csm_text_settings_value",
            "decode_ffdec_string", "definition_kind", "direct_bitmap_fill_runtime_value",
            "edit_text_value", "encoded_image_dimensions", "extract_swf",
            "ffdec_capabilities", "ffdec_metadata", "find_evidence_files",
            "font_align_zones_value", "font_value", "inspect_swf", "inspect_swf_bytes",
            "list_items", "match_evidence", "matrix_value", "morph_geometry_value",
            "parse_formatted_text", "prefab_for_asset", "prefab_for_timeline",
            "resolve_ffdec_jar", "runtime_image_dimensions", "scaling_grid_value",
            "scene_frame_metadata_value", "sha256_file", "shape_geometry_value",
            "static_text_value", "swf_float16", "swf_tag_inventory_bytes",
            "swf_tag_records_bytes", "symbol_map", "timeline_from_tags", "unpack_swc",
            "validate_conversion",
        }
        self.assertEqual([], sorted(name for name in required if not hasattr(swf, name)))

    def test_inspect_is_provider_local_and_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "minimal.swf"
            source.write_bytes(_minimal_swf())
            result = swf.inspect_swf(source)
            self.assertEqual("none", result["compression"])
            self.assertEqual(100, result["stage"]["width"])
            self.assertEqual(50, result["stage"]["height"])
            self.assertEqual(24, result["frame_rate"])

    def test_ffdec_resolution_is_explicit_then_environment_then_explicit_config(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            explicit = root / "explicit.jar"
            environment = root / "environment.jar"
            config = root / "config" / "project.json"
            config.parent.mkdir()
            config.write_text(json.dumps({"ffdec_jar": "configured.jar"}), encoding="utf-8")
            with mock.patch.dict(os.environ, {swf.FFDEC_JAR_ENVIRONMENT_VARIABLE: str(environment)}):
                self.assertEqual(explicit.resolve(), swf.resolve_ffdec_jar(explicit, config))
                self.assertEqual(environment.resolve(), swf.resolve_ffdec_jar(None, config))
            self.assertEqual((config.parent / "configured.jar").resolve(), swf.resolve_ffdec_jar(None, config))

    def test_ffdec_resolution_never_discovers_an_application_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            config = workspace / "as3-to-layaair-porting-kit" / "config" / "project.json"
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({"ffdec_jar": "forbidden.jar"}), encoding="utf-8")
            previous = Path.cwd()
            try:
                os.chdir(workspace)
                with mock.patch.dict(os.environ, {}, clear=False):
                    os.environ.pop(swf.FFDEC_JAR_ENVIRONMENT_VARIABLE, None)
                    with self.assertRaisesRegex(swf.SwfToolError, "FFDec is required"):
                        swf.resolve_ffdec_jar(None, None)
            finally:
                os.chdir(previous)

    def test_unpack_swc_rejects_flattened_library_name_collisions_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "hostile.swc"
            output = root / "output"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("catalog.xml", "<swc><libraries/></swc>")
                archive.writestr("lib/a.swf", _minimal_swf())
                archive.writestr("other/A.swf", _minimal_swf())
            with self.assertRaisesRegex(swf.SwfToolError, "destination basename is duplicated"):
                swf.unpack_swc(source, output, False)
            self.assertFalse(output.exists())

    def test_legacy_native_emission_fails_closed(self) -> None:
        with self.assertRaisesRegex(swf.SwfToolError, "SWF_NATIVE_CONVERSION_REQUIRES_LAYA_EMITTER"):
            swf.prefab_for_asset({}, "legacy", None)

    def test_neutral_conversion_emits_flash_library_without_runtime_prefabs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "evidence"
            output = root / "neutral"
            (bundle / "evidence" / "shapes").mkdir(parents=True)
            (bundle / "evidence" / "shapes" / "1.png").write_bytes(b"fixture-png")
            (bundle / "structure.xml").write_text(
                '''<?xml version="1.0"?>
<swf type="SWF" _xmlExportMajor="3" _xmlExportMinor="2" frameRate="24" frameCount="1">
  <displayRect type="RECT" Xmin="0" Xmax="2000" Ymin="0" Ymax="1000" />
  <tags>
    <item type="DefineShapeTag" characterID="1"><shapeBounds type="RECT" Xmin="0" Xmax="400" Ymin="0" Ymax="200" /></item>
    <item type="SymbolClassTag"><tags><item>1</item></tags><names><item>ui.Box</item></names></item>
    <item type="PlaceObject2Tag" placeFlagHasCharacter="true" placeFlagHasMatrix="true" depth="1" characterId="1" name="box"><matrix type="MATRIX" scaleX="1" scaleY="1" rotateSkew0="0" rotateSkew1="0" translateX="200" translateY="100" /></item>
    <item type="ShowFrameTag" />
  </tags>
</swf>
''',
                encoding="utf-8",
            )
            (bundle / "swf-header.json").write_text(
                json.dumps({"path": "fixture.swf", "sha256": "a" * 64}),
                encoding="utf-8",
            )
            conversion = swf.convert_neutral_bundle(bundle, output, "auto", False, False)
            self.assertEqual("flash-library@1", conversion.library["schema"])
            self.assertEqual(1, conversion.library["symbols"]["ui.Box"])
            self.assertFalse((output / "prefabs").exists())
            self.assertNotIn("timelineRuntime", conversion.library)
            self.assertNotIn("mainPrefab", conversion.library)
            for asset in conversion.library["assets"].values():
                self.assertNotIn("prefab", asset)
                self.assertNotIn("timelineBinding", asset)
            self.assertTrue(swf.validate_conversion(output)["ok"])
            manifest = json.loads((output / "conversion-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual("structure.xml", manifest["sourceStructure"]["path"])
            self.assertNotIn(str(root), json.dumps(manifest, sort_keys=True))

            structure = bundle / "structure.xml"
            valid_bytes = structure.read_bytes()
            valid_xml = valid_bytes.decode("utf-8")
            original_fromstring = swf.ET.fromstring
            def mutate_after_snapshot(payload: bytes):
                structure.write_text(valid_xml.replace('frameRate="24"', 'frameRate="60"'), encoding="utf-8")
                return original_fromstring(payload)
            with mock.patch.object(swf.ET, "fromstring", side_effect=mutate_after_snapshot):
                snapshot = swf.convert_bundle(bundle, root / "snapshot-neutral", "auto", False, False)
            snapshot_manifest = json.loads((snapshot.output / "conversion-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(hashlib.sha256(valid_bytes).hexdigest(), snapshot_manifest["sourceStructure"]["sha256"])
            self.assertEqual(24, snapshot.library["stage"]["frameRate"])
            structure.write_text(valid_xml, encoding="utf-8")

            library_path = output / "library.json"
            original_library = library_path.read_bytes()
            escaped = json.loads(original_library)
            escaped["assets"]["1"]["previewPath"] = "../escape.png"
            library_path.write_text(json.dumps(escaped), encoding="utf-8")
            escaped_validation = swf.validate_conversion(output)
            self.assertFalse(escaped_validation["ok"])
            self.assertTrue(any("stay inside" in error for error in escaped_validation["errors"]))
            library_path.write_bytes(original_library)
            unexpected = output / "unexpected.bin"
            unexpected.write_bytes(b"not-manifested")
            census_validation = swf.validate_conversion(output)
            self.assertFalse(census_validation["ok"])
            self.assertIn("conversion manifest file census does not match output files", census_validation["errors"])
            unexpected.unlink()
            script = REPOSITORY_ROOT / "src" / "extensions" / "authoredContent" / "scripts" / "swfToLaya.py"
            cli_output = root / "cli-neutral"
            completed = subprocess.run(
                [sys.executable, str(script), "convert", str(bundle), str(cli_output)],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertTrue(json.loads(completed.stdout)["validation"]["ok"])
            self.assertFalse((cli_output / "prefabs").exists())

            structure.write_text(valid_xml.replace('_xmlExportMajor="3"', '_xmlExportMajor="99"'), encoding="utf-8")
            recoverable = root / "recoverable-neutral"
            with self.assertRaisesRegex(swf.SwfToolError, "unsupported JPEXS XML"):
                swf.convert_bundle(bundle, recoverable, "auto", False, False)
            incomplete = json.loads((recoverable / "conversion-manifest.json").read_text(encoding="utf-8"))
            self.assertFalse(incomplete["complete"])
            structure.write_text(valid_xml, encoding="utf-8")
            recovered = swf.convert_bundle(bundle, recoverable, "auto", False, True)
            self.assertTrue(swf.validate_conversion(recovered.output)["ok"])

            unsupported_xml = valid_xml.replace(
                '    <item type="ShowFrameTag" />',
                '    <item type="UnknownTag" tagId="999" />\n    <item type="ShowFrameTag" />',
            )
            structure.write_text(unsupported_xml, encoding="utf-8")
            rejected = swf.convert_bundle(bundle, root / "unsupported-neutral", "auto", False, False)
            self.assertFalse(swf.validate_conversion(rejected.output)["ok"])
            admitted = swf.convert_bundle(bundle, root / "admitted-neutral", "auto", True, False)
            admitted_validation = swf.validate_conversion(admitted.output)
            self.assertTrue(admitted_validation["ok"])
            self.assertTrue(any("unsupported features" in warning for warning in admitted_validation["warnings"]))

    def test_bitmap_fill_runtime_admits_exact_rectangular_mosaics(self) -> None:
        def edges(x: float, y: float, width: float, height: float, style: int) -> list[dict[str, object]]:
            points = (
                ((x + width, y + height), (x, y + height)),
                ((x, y + height), (x, y)),
                ((x, y), (x + width, y)),
                ((x + width, y), (x + width, y + height)),
            )
            return [
                {
                    "kind": "line", "fillStyle0": 0, "fillStyle1": style,
                    "lineStyle": 0,
                    "start": {"from": list(start), "to": list(end)},
                    "end": {"from": list(start), "to": list(end)},
                }
                for start, end in points
            ]

        matrix = {"a": 20.0, "b": 0, "c": 0, "d": 20.0, "tx": 0.0, "ty": 0.0}
        assets = {
            "1": {"characterId": 1, "kind": "image", "path": "assets/1.png",
                  "bitmap": {"width": 100, "height": 10}},
            "2": {"characterId": 2, "kind": "image", "path": "assets/2.png",
                  "bitmap": {"width": 20, "height": 50}},
        }
        asset = {
            "characterId": 3,
            "kind": "shape",
            "bounds": {"x": 0.0, "y": 0.0, "width": 100.0, "height": 60.0},
            "shape": {
                "fillStyles": [
                    {"kind": "bitmap", "bitmapId": 1, "repeat": False, "smooth": False,
                     "startMatrix": matrix},
                    {"kind": "bitmap", "bitmapId": 65535, "repeat": False, "smooth": False,
                     "startMatrix": matrix},
                    {"kind": "bitmap", "bitmapId": 2, "repeat": False, "smooth": True,
                     "startMatrix": {**matrix, "ty": 10.0}},
                ],
                "lineStyles": [],
                "segments": [*edges(0, 0, 100, 10, 1), *edges(0, 10, 20, 50, 3)],
                "usesFillWindingRule": False,
            },
        }

        runtime, issue = swf.direct_bitmap_fill_runtime_value(asset, assets)
        self.assertIsNone(issue)
        self.assertEqual({
            "bitmapCharacterIds": [1, 2],
            "projection": "rectangular-mosaic",
            "visualAuthority": "bitmap-character-export",
        }, runtime)

        malformed = json.loads(json.dumps(asset))
        malformed["shape"]["segments"][0]["start"]["to"] = [50, 5]
        runtime, issue = swf.direct_bitmap_fill_runtime_value(malformed, assets)
        self.assertIsNone(runtime)
        self.assertIn("not one exact rectangle", issue)

        runtime, issue = swf.direct_bitmap_fill_runtime_value(asset, {"1": assets["1"]})
        self.assertIsNone(runtime)
        self.assertEqual("bitmap character 2 has no runtime image export", issue)

        mixed = json.loads(json.dumps(asset))
        mixed["bounds"] = {"x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0}
        mixed["shape"]["fillStyles"] = [
            {"kind": "bitmap", "bitmapId": 1, "repeat": False, "smooth": False,
             "startMatrix": matrix},
            {"kind": "solid", "startColor": {"alpha": 1.0, "color": 0x972AA9},
             "endColor": {"alpha": 1.0, "color": 0x972AA9}},
            {"kind": "solid", "startColor": {"alpha": 0.5, "color": 0},
             "endColor": {"alpha": 0.5, "color": 0}},
        ]
        inner_edges = edges(20, 20, 60, 60, 3)
        for edge in inner_edges:
            edge["fillStyle0"] = 2
        mixed["shape"]["segments"] = [
            *edges(0, 0, 100, 100, 1), *inner_edges, *edges(10, 10, 80, 80, 2),
        ]
        runtime, issue = swf.direct_bitmap_fill_runtime_value(mixed, assets)
        self.assertIsNone(issue)
        self.assertEqual([1], runtime["bitmapCharacterIds"])
        self.assertEqual([
            {"alpha": 1.0, "color": 0x972AA9, "styleIndex": 2, "rectangles": [
                {"x": 10.0, "y": 10.0, "width": 80.0, "height": 10.0},
                {"x": 10.0, "y": 20.0, "width": 10.0, "height": 60.0},
                {"x": 80.0, "y": 20.0, "width": 10.0, "height": 60.0},
                {"x": 10.0, "y": 80.0, "width": 80.0, "height": 10.0},
            ]},
            {"alpha": 0.5, "color": 0, "styleIndex": 3, "rectangles": [
                {"x": 20.0, "y": 20.0, "width": 60.0, "height": 60.0},
            ]},
        ], runtime["solidFillStyles"])

    def test_stable_executable_supports_module_version_and_inspect(self) -> None:
        script = REPOSITORY_ROOT / "src" / "extensions" / "authoredContent" / "scripts" / "swfToLaya.py"
        version = subprocess.run([sys.executable, str(script), "--version"], check=True, capture_output=True, text=True)
        self.assertEqual(f"{swf.TOOL_VERSION}\n", version.stdout)
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "minimal.swf"
            source.write_bytes(_minimal_swf())
            inspected = subprocess.run([sys.executable, str(script), "inspect", str(source)], check=True, capture_output=True, text=True)
            self.assertEqual(100, json.loads(inspected.stdout)["stage"]["width"])

    def test_provider_source_has_no_application_runtime_or_import_dependency(self) -> None:
        source = (PYTHON_TOOLING_ROOT / "laya_authored_swf" / "converter.py").read_text(encoding="utf-8")
        for forbidden in (
            "portkit.project", "as3-to-layaair-porting-kit", "@bleach/",
            "FlashTimelineFont", "registerFlashTimelineClip",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
