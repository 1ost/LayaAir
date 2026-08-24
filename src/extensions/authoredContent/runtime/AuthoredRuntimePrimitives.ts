import { MovieClip, TextField } from "../../../layaAir/flash";
import { Rectangle } from "../../../layaAir/flash/geom/Rectangle";
import { ClassUtils } from "../../../layaAir/laya/utils/ClassUtils";
import { AUTHORED_CONTENT_RUNTIME_IDS } from "../core/AuthoredRuntimeIds";
import {
    AuthoredTextFieldConfiguration,
    configureAuthoredTextField,
    createAuthoredGlowFilters,
} from "./AuthoredTextField";

export { AUTHORED_CONTENT_RUNTIME_IDS } from "../core/AuthoredRuntimeIds";

export class AuthoredMovieClip extends MovieClip {
    private _authoredFilters: ReadonlyArray<import("./AuthoredTextField").AuthoredGlowFilterConfiguration> = [];
    private _authoredScale9Grid: AuthoredScale9GridConfiguration | null = null;

    get authoredFilters(): ReadonlyArray<import("./AuthoredTextField").AuthoredGlowFilterConfiguration> {
        return this._authoredFilters;
    }

    set authoredFilters(value: ReadonlyArray<import("./AuthoredTextField").AuthoredGlowFilterConfiguration>) {
        this._authoredFilters = value;
    }

    get authoredScale9Grid(): AuthoredScale9GridConfiguration | null {
        return this._authoredScale9Grid;
    }

    set authoredScale9Grid(value: AuthoredScale9GridConfiguration | null) {
        this._authoredScale9Grid = value;
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
        this.filters = createAuthoredGlowFilters(this._authoredFilters);
        this._configureAuthoredScale9Grid();
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
    }
}

export function registerAuthoredContentPrimitives(): void {
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
    ctor: typeof AuthoredMovieClip | typeof AuthoredDynamicTextField,
    sourceType: "MovieClip" | "TextField",
): void {
    const existing = ClassUtils.getClass(id);
    if (existing && existing !== ctor)
        throw new Error(`Authored content primitive collision: ${id}`);
    const registered = ctor as typeof ctor & {
        readonly _$authoredSerializedType?: "Sprite";
        readonly _$authoredSourceType?: "MovieClip" | "TextField";
    };
    if (registered._$authoredSerializedType === undefined) {
        Object.defineProperties(registered, {
            _$authoredSerializedType: { value: "Sprite", configurable: false },
            _$authoredSourceType: { value: sourceType, configurable: false },
        });
    }
    ClassUtils.regClass(id, ctor);
}
