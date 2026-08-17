import {
    AuthoredActionResult,
    AuthoredCockpitAction,
    AuthoredCockpitRequest,
    AuthoredCockpitSnapshot,
    AuthoredNativePreviewTarget
} from "./AuthoredContentCockpitTypes";

export const AUTHORED_COCKPIT_SCENE_BRIDGE = "AuthoredContentCockpitSceneBridge";

export type AuthoredSceneScriptRunner = (command: string, ...parameters: unknown[]) => Promise<unknown>;

/** UI-process proxy only. The Scene-process bridge is supplied by integration. */
export class AuthoredContentCockpitBridgeClient {
    constructor(private readonly runSceneScript: AuthoredSceneScriptRunner) {}

    getSnapshot(): Promise<AuthoredCockpitSnapshot> {
        return this.runSceneScript(`${AUTHORED_COCKPIT_SCENE_BRIDGE}.getSnapshot`) as Promise<AuthoredCockpitSnapshot>;
    }

    resolvePreview(request: Omit<AuthoredCockpitRequest, "action">): Promise<AuthoredNativePreviewTarget> {
        return this.runSceneScript(
            `${AUTHORED_COCKPIT_SCENE_BRIDGE}.resolvePreview`,
            request
        ) as Promise<AuthoredNativePreviewTarget>;
    }

    runAction(action: AuthoredCockpitAction, request: AuthoredCockpitRequest): Promise<AuthoredActionResult> {
        return this.runSceneScript(
            `${AUTHORED_COCKPIT_SCENE_BRIDGE}.${action}`,
            request
        ) as Promise<AuthoredActionResult>;
    }
}
