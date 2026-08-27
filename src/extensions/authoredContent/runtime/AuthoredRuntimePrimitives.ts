import { DisplayObject, MovieClip, SimpleButton, TextField } from "../../../layaAir/flash";
import { Rectangle } from "../../../layaAir/flash/geom/Rectangle";
import { ColorTransform } from "../../../layaAir/flash/geom/ColorTransform";
import { ClassUtils } from "../../../layaAir/laya/utils/ClassUtils";
import type { TextGlyphAlignmentZone } from "../../../layaAir/laya/webgl/text/TextRasterizationSettings";
import { AUTHORED_CONTENT_RUNTIME_IDS } from "../core/AuthoredRuntimeIds";
import {
    AuthoredTextFieldConfiguration,
    configureAuthoredTextField,
    createAuthoredFilters,
    releaseAuthoredTextFieldFontBinding,
} from "./AuthoredTextField";

export { AUTHORED_CONTENT_RUNTIME_IDS } from "../core/AuthoredRuntimeIds";

export class AuthoredMovieClip extends MovieClip {
    private _authoredFilters: ReadonlyArray<import("./AuthoredTextField").AuthoredFilterConfiguration> = [];
    private _authoredScale9Grid: AuthoredScale9GridConfiguration | null = null;
    private _authoredColorTransform: AuthoredColorTransformConfiguration | null = null;

    get authoredFilters(): ReadonlyArray<import("./AuthoredTextField").AuthoredFilterConfiguration> {
        return this._authoredFilters;
    }

    set authoredFilters(value: ReadonlyArray<import("./AuthoredTextField").AuthoredFilterConfiguration>) {
        this._authoredFilters = value;
    }

    get authoredScale9Grid(): AuthoredScale9GridConfiguration | null {
        return this._authoredScale9Grid;
    }

    set authoredScale9Grid(value: AuthoredScale9GridConfiguration | null) {
        this._authoredScale9Grid = value;
    }

    get authoredColorTransform(): AuthoredColorTransformConfiguration | null {
        return this._authoredColorTransform;
    }

    set authoredColorTransform(value: AuthoredColorTransformConfiguration | null) {
        this._authoredColorTransform = value;
    }

    override get width(): number { return super.width; }
    override set width(value: number) {
        super.width = value;
        this._synchronizeAuthoredScale9Target(false);
    }

    override get height(): number { return super.height; }
    override set height(value: number) {
        super.height = value;
        this._synchronizeAuthoredScale9Target(false);
    }

    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        this.filters = createAuthoredFilters(this._authoredFilters);
        this._configureAuthoredColorTransform();
        this._configureAuthoredScale9Grid();
    }

    private _configureAuthoredColorTransform(): void {
        const value = this._authoredColorTransform;
        if (!value)
            return;
        const fields = [
            value.redMultiplier, value.greenMultiplier, value.blueMultiplier, value.alphaMultiplier,
            value.redOffset, value.greenOffset, value.blueOffset, value.alphaOffset,
        ];
        if (fields.some(component => !Number.isFinite(component)) || value.alphaMultiplier < 0 || value.alphaMultiplier > 1)
            throw new Error("AuthoredMovieClip authoredColorTransform is invalid");
        this.transform.colorTransform = new ColorTransform(
            value.redMultiplier, value.greenMultiplier, value.blueMultiplier, value.alphaMultiplier,
            value.redOffset, value.greenOffset, value.blueOffset, value.alphaOffset,
        );
    }

    private _configureAuthoredScale9Grid(): void {
        const configuration = this._authoredScale9Grid;
        if (!configuration)
            return;
        const numbers = [configuration.x, configuration.y, configuration.width, configuration.height, ...configuration.sizeGrid];
        if (numbers.some(value => !Number.isFinite(value)) || configuration.width <= 0 || configuration.height <= 0
            || configuration.x < 0 || configuration.y < 0 || configuration.sizeGrid.length !== 5
            || configuration.sizeGrid.slice(0, 4).some(value => value < 0)
            || (configuration.sizeGrid[4] !== 0 && configuration.sizeGrid[4] !== 1)
            || configuration.sizeGrid[0] !== configuration.y
            || configuration.sizeGrid[1] !== this.width - configuration.x - configuration.width
            || configuration.sizeGrid[2] !== this.height - configuration.y - configuration.height
            || configuration.sizeGrid[3] !== configuration.x
            || !configuration.target)
            throw new Error("AuthoredMovieClip authoredScale9Grid is invalid");
        this.scale9Grid = new Rectangle(configuration.x, configuration.y, configuration.width, configuration.height);
        this._synchronizeAuthoredScale9Target(true);
    }

    private _synchronizeAuthoredScale9Target(required: boolean): void {
        const configuration = this._authoredScale9Grid;
        if (!configuration)
            return;
        if (this.numChildren === 0) {
            if (required)
                throw new Error(`AuthoredMovieClip scale9 target '${configuration.target}' is missing or not a native Image`);
            return;
        }
        const target = this.getChildByName(configuration.target) as unknown as {
            width: number;
            height: number;
            sizeGrid: string | null;
        } | null;
        if (target === null || !("sizeGrid" in target))
            throw new Error(`AuthoredMovieClip scale9 target '${configuration.target}' is missing or not a native Image`);
        target.sizeGrid = configuration.sizeGrid.join(",");
        target.width = this.width;
        target.height = this.height;
    }
}

export interface AuthoredColorTransformConfiguration {
    readonly redMultiplier: number;
    readonly greenMultiplier: number;
    readonly blueMultiplier: number;
    readonly alphaMultiplier: number;
    readonly redOffset: number;
    readonly greenOffset: number;
    readonly blueOffset: number;
    readonly alphaOffset: number;
}

/** Serialized owner for one independently instantiated DefineButton2 state display list. */
export class AuthoredButtonState extends DisplayObject { }

/** Native Flash-shaped button whose four named state children are bound after hierarchy decoding. */
export class AuthoredSimpleButton extends SimpleButton {
    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        for (const state of [this.upState, this.overState, this.downState, this.hitTestState]) {
            if (state !== null)
                state.mouseEnabled = false;
        }
    }
}

export function isAuthoredSimpleButton(value: unknown): value is AuthoredSimpleButton {
    return value instanceof AuthoredSimpleButton;
}

export interface AuthoredScale9GridConfiguration {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly sizeGrid: readonly [number, number, number, number, 0 | 1];
    readonly target: string;
}

export class AuthoredDynamicTextField extends TextField {
    private _authoredConfiguration: AuthoredTextFieldConfiguration = {
        sourceId: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        type: "dynamic",
        multiline: false,
        wordWrap: false,
        selectable: false,
        displayAsPassword: false,
        autoSize: "none",
        html: false,
        gutter: 2,
        overflow: "hidden",
        initialText: "",
        format: {
            fontMode: "device",
            font: "",
            size: 0,
            color: 0,
            bold: false,
            italic: false,
            underline: false,
            align: "left",
            leftMargin: 0,
            rightMargin: 0,
            indent: 0,
            leading: 0,
            letterSpacing: 0,
            kerning: false,
        },
    };

    get authoredConfiguration(): AuthoredTextFieldConfiguration {
        return this._authoredConfiguration;
    }

    set authoredConfiguration(value: AuthoredTextFieldConfiguration) {
        this._authoredConfiguration = value;
    }

    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        configureAuthoredTextField(this, this._authoredConfiguration);
        this._applyAuthoredAlignmentZones();
    }

    override onDestroy(): void {
        releaseAuthoredTextFieldFontBinding(this);
        super.onDestroy();
    }

    private _applyAuthoredAlignmentZones(): void {
        const font = this._authoredConfiguration.format.embeddedFont;
        const settings = this._nativeTextInput.rasterizationSettings;
        if (!font || !this._authoredConfiguration.useOutlines || !settings) return;
        const alignmentZones: Record<string, TextGlyphAlignmentZone> = Object.create(null);
        font.glyphs.forEach((glyph, index) => {
            const zone = font.alignZones.zones[index];
            alignmentZones[String(glyph.codePoint)] = Object.freeze({
                ...(zone.maskX ? { x: Object.freeze({ coordinate: zone.data[0].alignmentCoordinate, range: zone.data[0].range }) } : {}),
                ...(zone.maskY ? { y: Object.freeze({ coordinate: zone.data[1].alignmentCoordinate, range: zone.data[1].range }) } : {}),
            });
        });
        this._nativeTextInput.rasterizationSettings = Object.freeze({ ...settings, alignmentZones: Object.freeze(alignmentZones) });
    }
}

export function registerAuthoredContentPrimitives(): void {
    registerPrimitive(
        AUTHORED_CONTENT_RUNTIME_IDS.button,
        AuthoredSimpleButton,
        "SimpleButton",
    );
    registerPrimitive(
        AUTHORED_CONTENT_RUNTIME_IDS.buttonState,
        AuthoredButtonState,
        "DisplayObject",
    );
    registerPrimitive(
        AUTHORED_CONTENT_RUNTIME_IDS.movieClip,
        AuthoredMovieClip,
        "MovieClip",
    );
    registerPrimitive(
        AUTHORED_CONTENT_RUNTIME_IDS.textField,
        AuthoredDynamicTextField,
        "TextField",
    );
}

function registerPrimitive(
    id: string,
    ctor: typeof AuthoredButtonState | typeof AuthoredDynamicTextField | typeof AuthoredMovieClip | typeof AuthoredSimpleButton,
    sourceType: "DisplayObject" | "MovieClip" | "SimpleButton" | "TextField",
): void {
    const existing = ClassUtils.getClass(id);
    if (existing && existing !== ctor)
        throw new Error(`Authored content primitive collision: ${id}`);
    const registered = ctor as typeof ctor & {
        readonly _$authoredSerializedType?: "Sprite";
        readonly _$authoredSourceType?: "DisplayObject" | "MovieClip" | "SimpleButton" | "TextField";
    };
    if (registered._$authoredSerializedType === undefined) {
        Object.defineProperties(registered, {
            _$authoredSerializedType: { value: "Sprite", configurable: false },
            _$authoredSourceType: { value: sourceType, configurable: false },
        });
    }
    ClassUtils.regClass(id, ctor);
}
