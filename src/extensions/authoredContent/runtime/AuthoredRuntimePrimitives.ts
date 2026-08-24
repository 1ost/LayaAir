import { MovieClip, TextField } from "../../../layaAir/flash";
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

    get authoredFilters(): ReadonlyArray<import("./AuthoredTextField").AuthoredGlowFilterConfiguration> {
        return this._authoredFilters;
    }

    set authoredFilters(value: ReadonlyArray<import("./AuthoredTextField").AuthoredGlowFilterConfiguration>) {
        this._authoredFilters = value;
    }

    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        this.filters = createAuthoredGlowFilters(this._authoredFilters);
    }
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
