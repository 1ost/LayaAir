import { AuthoredContentCockpitModel } from "./AuthoredContentCockpitModel";
import { AuthoredContentCockpitBridgeClient } from "./AuthoredContentCockpitBridge";
import { AuthoredAsyncEpoch, captureFocusedWidgetName, restoreNamedFocus } from "./AuthoredContentCockpitPanelSupport";
import { AuthoredPreviewCanvasController } from "./AuthoredPreviewCanvasController";
import {
    AuthoredActionCapture,
    AuthoredCockpitAction,
    AuthoredCockpitCommand,
    AuthoredCockpitSelection,
    AuthoredPreviewLayer
} from "./AuthoredContentCockpitTypes";

const PREVIEW_SCENE = "AuthoredContentPreviewScene";
const HEADER_HEIGHT = 42;
const STATUS_HEIGHT = 30;
const GUTTER = 8;

/**
 * IDE-process cockpit for authored content. Importing, validation, native asset
 * resolution and rendering remain in the Scene process behind the typed bridge.
 */
export class AuthoredContentCockpitPanel extends IEditor.EditorPanel {
    private readonly model = new AuthoredContentCockpitModel();
    private readonly bridge: AuthoredContentCockpitBridgeClient;
    private readonly snapshotEpoch = new AuthoredAsyncEpoch();
    private readonly previewEpoch = new AuthoredAsyncEpoch();
    private readonly actionEpoch = new AuthoredAsyncEpoch();
    private root!: gui.Widget;
    private headerTitle!: gui.TextField;
    private localeLabel!: gui.TextField;
    private locale!: gui.ComboBox;
    private familyPane!: gui.Panel;
    private previewPane!: gui.Widget;
    private previewCanvas!: IEditor.IRender3DCanvas;
    private previewController!: AuthoredPreviewCanvasController;
    private previewEmpty!: gui.TextField;
    private detailsPane!: gui.Panel;
    private statusText!: gui.TextField;
    private progress!: gui.ProgressBar;
    private readonly actionButtons = new Map<AuthoredCockpitAction, gui.Button>();
    private readonly layerButtons = new Map<AuthoredPreviewLayer, gui.Button>();
    private openXmlButton!: gui.Button;
    private previousConflictButton!: gui.Button;
    private nextConflictButton!: gui.Button;
    private rendering = false;
    private interactionLocked = false;
    private destroyed = false;
    private focusRestoreName?: string;
    private lastWidth = -1;
    private lastHeight = -1;

    constructor(bridge?: AuthoredContentCockpitBridgeClient) {
        super();
        this.bridge = bridge || new AuthoredContentCockpitBridgeClient(
            (command, ...parameters) => Editor.scene.runScript(command, ...parameters)
        );
    }

    async create(): Promise<void> {
        if (this.destroyed)
            return;
        this.root = new gui.Widget();
        this.root.name = "cockpit-root";
        this.root.focusable = true;
        this.root.tabStopChildren = true;
        this._panel = this.root;

        this.createHeader();
        this.createFamilyPane();
        this.createPreviewPane();
        this.createDetailsPane();
        this.createStatusBar();

        Editor.enableHotkey(
            "ctrl+o", "ctrl+r", "ctrl+shift+v", "ctrl+shift+r", "ctrl+shift+d",
            "alt+1", "alt+2", "alt+3", "f8", "shift+f8"
        );
        this.renderModel();
    }

    onStart(): void {
        void this.refreshSnapshot();
    }

    onUpdate(): void {
        if (!this.destroyed && (this.root.width !== this.lastWidth || this.root.height !== this.lastHeight))
            this.layout();
    }

    onDestroy(): void {
        this.destroyed = true;
        this.snapshotEpoch.destroy();
        this.previewEpoch.destroy();
        this.actionEpoch.destroy();
        const controller = this.previewController;
        if (controller)
            void controller.destroy().catch(() => undefined);
    }

    onHotkey(combo: string): boolean {
        const command = AuthoredContentCockpitModel.commandForHotkey(combo);
        if (!command || this.controlsLocked())
            return false;
        void this.executeCommand(command);
        return true;
    }

    private createHeader(): void {
        this.headerTitle = this.createLabel("Authored Content", true);
        this.headerTitle.name = "cockpit-title";
        this.headerTitle.tooltips = "Selected authored family and symbol";
        this.root.addChild(this.headerTitle);

        this.localeLabel = this.createLabel("Locale");
        this.root.addChild(this.localeLabel);

        this.locale = IEditor.GUIUtils.createComboBox();
        this.locale.name = "locale-selector";
        this.locale.focusable = true;
        this.locale.tabStop = true;
        this.locale.tooltips = "Preview locale";
        this.locale.on("changed", () => {
            if (this.rendering || this.controlsLocked())
                return;
            try {
                this.model.selectLocale(this.locale.value);
                this.renderModel();
                void this.refreshPreview();
            } catch (error) {
                this.showError(error);
            }
        });
        this.root.addChild(this.locale);

        this.openXmlButton = this.createButton("Open XML", "Open the immutable source XML (Ctrl+O)", () => void this.openSourceXml());
        this.openXmlButton.name = "action-open-xml";
        this.root.addChild(this.openXmlButton);
        this.root.addChild(this.createActionButton("reimport", "Reimport", "Regenerate the native base (Ctrl+R)"));
        this.root.addChild(this.createActionButton("validate", "Validate", "Check compatibility and binding obligations (Ctrl+Shift+V)"));
        this.root.addChild(this.createActionButton("render", "Render", "Render a deterministic native preview (Ctrl+Shift+R)"));
        this.root.addChild(this.createActionButton("detach", "Detach", "Detach the selected symbol from generated content (Ctrl+Shift+D)"));
    }

    private createFamilyPane(): void {
        this.familyPane = new gui.Panel();
        this.familyPane.name = "FamilySymbolTree";
        this.familyPane.clipping = true;
        this.familyPane.tabStopChildren = true;
        this.familyPane.scroller = this.createVerticalScroller();
        this.root.addChild(this.familyPane);
    }

    private createPreviewPane(): void {
        this.previewPane = new gui.Widget();
        this.previewPane.name = "NativePreview";
        this.root.addChild(this.previewPane);

        for (const layer of ["source", "base", "final"] as AuthoredPreviewLayer[]) {
            const button = this.createButton(
                this.layerTitle(layer),
                `${this.layerDescription(layer)} (Alt+${layer === "source" ? 1 : layer === "base" ? 2 : 3})`,
                () => this.selectPreviewLayer(layer)
            );
            button.name = `preview-${layer}`;
            button.mode = gui.ButtonMode.Radio;
            this.layerButtons.set(layer, button);
            this.previewPane.addChild(button);
        }

        this.previewCanvas = new IEditor.Render3DCanvas();
        this.previewCanvas.focusable = true;
        this.previewCanvas.tabStop = true;
        this.previewCanvas.tooltips = "Native Laya preview canvas";
        this.previewController = new AuthoredPreviewCanvasController(this.previewCanvas, PREVIEW_SCENE);
        this.previewPane.addChild(this.previewCanvas);

        this.previewEmpty = this.createLabel("Select a symbol to preview its native output.");
        this.previewEmpty.wrap = true;
        this.previewPane.addChild(this.previewEmpty);
    }

    private createDetailsPane(): void {
        this.detailsPane = new gui.Panel();
        this.detailsPane.name = "ObligationsAndConflicts";
        this.detailsPane.clipping = true;
        this.detailsPane.tabStopChildren = true;
        this.detailsPane.scroller = this.createVerticalScroller();
        this.root.addChild(this.detailsPane);
    }

    private createStatusBar(): void {
        this.statusText = this.createLabel("Ready");
        this.statusText.name = "cockpit-status";
        this.statusText.selectable = true;
        this.root.addChild(this.statusText);
        this.progress = IEditor.GUIUtils.createProgressBar();
        this.progress.min = 0;
        this.progress.max = 100;
        this.progress.value = 0;
        this.progress.tooltips = "Current authored-content operation progress";
        this.root.addChild(this.progress);
    }

    private createActionButton(action: AuthoredCockpitAction, title: string, tooltips: string): gui.Button {
        const button = this.createButton(title, tooltips, () => void this.runAction(action));
        button.name = `action-${action}`;
        this.actionButtons.set(action, button);
        return button;
    }

    private createButton(title: string, tooltips: string, callback: () => void): gui.Button {
        const button = IEditor.GUIUtils.createButton(false);
        button.title = title;
        button.focusable = true;
        button.tabStop = true;
        button.tooltips = tooltips;
        button.onClick(callback);
        return button;
    }

    private createVerticalScroller(): gui.Scroller {
        const scroller = new gui.Scroller();
        scroller.direction = gui.ScrollDirection.Vertical;
        scroller.barDisplay = gui.ScrollBarDisplay.OnOverflowAndScroll;
        scroller.bouncebackEffect = gui.ScrollBounceBackEffect.Off;
        return scroller;
    }

    private createLabel(text: string, strong = false): gui.TextField {
        const label = new gui.TextField();
        label.text = text;
        label.color = IEditor.GUIUtils.textColor.getHex();
        label.style.fontSize = strong ? 14 : 12;
        label.style.bold = strong;
        return label;
    }

    private renderModel(): void {
        if (this.destroyed || !this.root)
            return;
        const focusedName = this.root && captureFocusedWidgetName(this.root);
        if (focusedName)
            this.focusRestoreName = focusedName;
        const locked = this.controlsLocked();
        const hasSymbol = !!this.model.selectedSymbolId;
        this.rendering = true;
        try {
            const symbol = this.model.selectedSymbol;
            this.headerTitle.text = symbol
                ? `${this.familyLabel(this.model.selectedFamilyId)} / ${symbol.label}`
                : "Authored Content";
            this.locale.items = [...this.model.locales];
            this.locale.values = [...this.model.locales];
            this.locale.value = this.model.selectedLocale;
            this.locale.enabled = hasSymbol && !locked;
            this.openXmlButton.enabled = !!this.model.sourcePath && !locked;
            for (const [action, button] of this.actionButtons) {
                button.enabled = !locked && hasSymbol;
            }
            for (const [layer, button] of this.layerButtons) {
                button.selected = layer === this.model.previewLayer;
                button.enabled = hasSymbol && !locked;
            }
            this.rebuildFamilyTree();
            this.rebuildDetails();
            this.statusText.text = this.model.actionStatus.message;
            this.progress.value = Math.round(this.model.actionStatus.progress * 100);
            this.progress.visible = this.model.actionStatus.state !== "idle";
        } finally {
            this.rendering = false;
        }
        this.layout();
        if (this.focusRestoreName && restoreNamedFocus(this.root, this.focusRestoreName))
            this.focusRestoreName = undefined;
    }

    private rebuildFamilyTree(): void {
        this.familyPane.removeChildren(0, undefined, true);
        let y = GUTTER;
        const heading = this.createLabel("FAMILIES / SYMBOLS", true);
        heading.setPos(GUTTER, y).setSize(Math.max(100, this.familyPane.width - GUTTER * 2), 24);
        this.familyPane.addChild(heading);
        y += 27;

        if (!this.model.families.length) {
            const empty = this.createLabel("No authored source is selected.");
            empty.wrap = true;
            empty.setPos(GUTTER, y).setSize(Math.max(100, this.familyPane.width - GUTTER * 2), 44);
            this.familyPane.addChild(empty);
            return;
        }

        for (const family of this.model.families) {
            const familyLabel = this.createLabel(family.label, true);
            familyLabel.name = `family:${family.id}`;
            familyLabel.tooltips = `Family ${family.label}; choose an exact symbol below`;
            familyLabel.setPos(GUTTER, y).setSize(Math.max(100, this.familyPane.width - GUTTER * 2), 25);
            this.familyPane.addChild(familyLabel);
            y += 27;

            for (const symbol of family.symbols) {
                const status = symbol.status && symbol.status !== "ready" ? ` [${symbol.status}]` : "";
                const symbolButton = this.createButton(`  ${symbol.label}${status}`, `${symbol.kind}: ${symbol.label}`, () => {
                    if (this.controlsLocked())
                        return;
                    this.model.selectSymbol(symbol.id);
                    this.selectionChanged();
                });
                symbolButton.name = `symbol:${symbol.id}`;
                symbolButton.enabled = !this.controlsLocked();
                symbolButton.mode = gui.ButtonMode.Radio;
                symbolButton.selected = symbol.id === this.model.selectedSymbolId;
                symbolButton.setPos(GUTTER + 12, y).setSize(Math.max(88, this.familyPane.width - GUTTER * 2 - 12), 25);
                this.familyPane.addChild(symbolButton);
                y += 27;
            }
        }
    }

    private rebuildDetails(): void {
        this.detailsPane.removeChildren(0, undefined, true);
        let y = GUTTER;
        y = this.addIssueHeading("COMPATIBILITY", y);
        y = this.addObligations("compatibility", y);
        y = this.addIssueHeading("BINDINGS", y + 6);
        y = this.addObligations("binding", y);
        y = this.addIssueHeading("FLASH-SHAPED BRIDGE OBLIGATIONS", y + 6);
        y = this.addObligations("flash-bridge", y);
        y = this.addIssueHeading("CONFLICTS", y + 6);

        const conflicts = this.model.visibleConflicts();
        if (!conflicts.length) {
            y = this.addPlainRow("No conflicts for this symbol.", y);
        } else {
            for (const conflict of conflicts) {
                const button = this.createButton(
                    `[${conflict.severity}] ${conflict.label}`,
                    conflict.details,
                    () => {
                        if (this.controlsLocked())
                            return;
                        this.model.selectConflict(conflict.id);
                        this.selectionChanged();
                    }
                );
                button.name = `conflict:${conflict.id}`;
                button.enabled = !this.controlsLocked();
                button.setPos(GUTTER, y).setSize(Math.max(100, this.detailsPane.width - GUTTER * 2), 27);
                this.detailsPane.addChild(button);
                y += 29;
            }
        }

        this.previousConflictButton = this.createButton("Previous", "Previous conflict (Shift+F8)", () => this.navigateConflict(-1));
        this.nextConflictButton = this.createButton("Next", "Next conflict (F8)", () => this.navigateConflict(1));
        this.previousConflictButton.name = "conflict-previous";
        this.nextConflictButton.name = "conflict-next";
        this.previousConflictButton.setPos(GUTTER, y + 4).setSize(82, 26);
        this.nextConflictButton.setPos(96, y + 4).setSize(62, 26);
        this.previousConflictButton.enabled = this.model.snapshot.conflicts.length > 0 && !this.controlsLocked();
        this.nextConflictButton.enabled = this.model.snapshot.conflicts.length > 0 && !this.controlsLocked();
        this.detailsPane.addChild(this.previousConflictButton);
        this.detailsPane.addChild(this.nextConflictButton);
    }

    private addIssueHeading(text: string, y: number): number {
        const heading = this.createLabel(text, true);
        heading.setPos(GUTTER, y).setSize(Math.max(100, this.detailsPane.width - GUTTER * 2), 22);
        this.detailsPane.addChild(heading);
        return y + 24;
    }

    private addObligations(kind: "compatibility" | "binding" | "flash-bridge", startY: number): number {
        let y = startY;
        const obligations = this.model.visibleObligations().filter(item => item.kind === kind);
        if (!obligations.length)
            return this.addPlainRow("No open obligations.", y);
        for (const obligation of obligations) {
            const bridge = obligation.flashShape
                ? ` (${obligation.flashShape.sourceShape} -> ${obligation.flashShape.nativeContract})`
                : "";
            const label = this.createLabel(`[${obligation.severity}] ${obligation.label}${bridge}`);
            label.wrap = true;
            label.tooltips = obligation.flashShape
                ? `${obligation.details}\nOffline Flash shape: ${obligation.flashShape.sourceShape}\nRequired native contract: ${obligation.flashShape.nativeContract}`
                : obligation.details;
            label.setPos(GUTTER, y).setSize(Math.max(100, this.detailsPane.width - GUTTER * 2), 35);
            this.detailsPane.addChild(label);
            y += 37;
        }
        return y;
    }

    private addPlainRow(text: string, y: number): number {
        const label = this.createLabel(text);
        label.setPos(GUTTER, y).setSize(Math.max(100, this.detailsPane.width - GUTTER * 2), 22);
        this.detailsPane.addChild(label);
        return y + 24;
    }

    private layout(): void {
        if (this.destroyed || !this.root)
            return;
        this.lastWidth = this.root.width;
        this.lastHeight = this.root.height;
        const width = Math.max(720, this.root.width);
        const height = Math.max(360, this.root.height);

        const buttonGap = 5;
        const actions: Array<gui.Widget> = [
            this.openXmlButton,
            this.actionButtons.get("reimport")!,
            this.actionButtons.get("validate")!,
            this.actionButtons.get("render")!,
            this.actionButtons.get("detach")!
        ];
        const actionWidths = [72, 68, 67, 58, 60];
        let x = width - GUTTER;
        for (let index = actions.length - 1; index >= 0; index--) {
            x -= actionWidths[index];
            actions[index].setPos(x, 8).setSize(actionWidths[index], 26);
            x -= buttonGap;
        }
        this.locale.setPos(Math.max(255, x - 110), 8).setSize(102, 26);
        this.localeLabel.setPos(this.locale.x - 43, 12).setSize(40, 20);
        this.headerTitle.setPos(GUTTER, 10).setSize(Math.max(150, this.localeLabel.x - GUTTER * 2), 24);

        const contentY = HEADER_HEIGHT;
        const contentHeight = Math.max(250, height - HEADER_HEIGHT - STATUS_HEIGHT);
        const leftWidth = width < 980 ? 210 : 255;
        const rightWidth = width < 980 ? 255 : 320;
        const centerX = leftWidth + GUTTER;
        const centerWidth = Math.max(240, width - leftWidth - rightWidth - GUTTER * 2);

        this.familyPane.setPos(0, contentY).setSize(leftWidth, contentHeight);
        this.previewPane.setPos(centerX, contentY).setSize(centerWidth, contentHeight);
        this.detailsPane.setPos(centerX + centerWidth + GUTTER, contentY).setSize(rightWidth, contentHeight);

        let layerX = 0;
        for (const layer of ["source", "base", "final"] as AuthoredPreviewLayer[]) {
            this.layerButtons.get(layer)!.setPos(layerX, 0).setSize(72, 28);
            layerX += 76;
        }
        this.previewCanvas.setPos(0, 34).setSize(centerWidth, Math.max(100, contentHeight - 34));
        this.previewEmpty.setPos(GUTTER, 48).setSize(Math.max(100, centerWidth - GUTTER * 2), 48);

        this.statusText.setPos(GUTTER, height - STATUS_HEIGHT + 6).setSize(Math.max(160, width - 230), 22);
        this.progress.setPos(width - 210, height - STATUS_HEIGHT + 6).setSize(202, 18);
    }

    private selectionChanged(): void {
        if (this.controlsLocked())
            return;
        this.renderModel();
        void this.refreshPreview();
    }

    private selectPreviewLayer(layer: AuthoredPreviewLayer): void {
        if (this.controlsLocked())
            return;
        this.model.selectPreviewLayer(layer);
        this.renderModel();
        void this.refreshPreview();
    }

    private navigateConflict(direction: 1 | -1): void {
        if (this.controlsLocked())
            return;
        const conflict = this.model.navigateConflict(direction);
        if (!conflict) {
            this.model.resetStatus("No conflicts to navigate");
            this.renderModel();
            return;
        }
        this.model.resetStatus(`Conflict: ${conflict.label}`);
        this.selectionChanged();
    }

    private async executeCommand(command: AuthoredCockpitCommand): Promise<void> {
        switch (command.kind) {
            case "open-xml": await this.openSourceXml(); break;
            case "action": await this.runAction(command.action); break;
            case "preview-layer": this.selectPreviewLayer(command.layer); break;
            case "conflict": this.navigateConflict(command.direction); break;
        }
    }

    private async openSourceXml(): Promise<void> {
        if (this.controlsLocked())
            return;
        if (!this.model.sourcePath) {
            this.model.failAction("No source XML is available for the current selection");
            this.renderModel();
            return;
        }
        IEditor.utils.openCodeEditor(this.model.sourcePath);
        this.model.resetStatus(`Opened ${this.model.sourcePath}`);
        this.renderModel();
    }

    private async refreshSnapshot(): Promise<void> {
        if (this.controlsLocked())
            return;
        const token = this.snapshotEpoch.begin();
        if (token < 0)
            return;
        const selectionRevision = this.model.selectionRevision;
        try {
            const snapshot = await this.bridge.getSnapshot();
            if (!this.snapshotEpoch.isCurrent(token)
                || this.controlsLocked()
                || this.model.selectionRevision !== selectionRevision)
                return;
            this.model.load(snapshot);
            this.model.resetStatus("Authored content loaded");
            this.renderModel();
            await this.refreshPreview();
        } catch (error) {
            if (!this.snapshotEpoch.isCurrent(token))
                return;
            this.model.failAction(`Authored-content snapshot rejected: ${this.errorMessage(error)}`);
            this.previewEmpty.text = "The authored-content importer bridge is not loaded. Install the Scene-process package, then reopen this panel.";
            this.previewEmpty.visible = true;
            this.renderModel();
        }
    }

    private async refreshPreview(): Promise<void> {
        if (this.destroyed)
            return;
        const token = this.previewEpoch.begin();
        if (token < 0)
            return;
        const selectionRevision = this.model.selectionRevision;
        if (!this.model.selectedSymbolId) {
            try {
                const presentation = await this.previewController.clear(() => this.previewEpoch.isCurrent(token));
                if (presentation === "stale" || !this.previewEpoch.isCurrent(token))
                    return;
                this.previewEmpty.text = "Select a symbol to preview its native output.";
                this.previewEmpty.visible = true;
            } catch (error) {
                if (!this.previewEpoch.isCurrent(token))
                    return;
                this.previewEmpty.text = `Preview cleanup failed: ${this.errorMessage(error)}`;
                this.previewEmpty.visible = true;
            }
            return;
        }
        let selection: AuthoredCockpitSelection;
        try {
            selection = this.model.captureSelection();
        } catch (error) {
            this.previewEmpty.text = `Preview rejected: ${this.errorMessage(error)}`;
            this.previewEmpty.visible = true;
            return;
        }
        this.previewEmpty.text = `Loading ${this.layerTitle(selection.previewLayer)} native preview...`;
        this.previewEmpty.visible = true;
        try {
            const presentation = await this.previewController.resolveAndPresent(
                () => this.bridge.resolvePreview(selection),
                () => this.previewEpoch.isCurrent(token) && this.model.selectionRevision === selectionRevision
            );
            if (presentation !== "presented"
                || !this.previewEpoch.isCurrent(token)
                || this.model.selectionRevision !== selectionRevision)
                return;
            this.previewEmpty.visible = false;
        } catch (error) {
            if (!this.previewEpoch.isCurrent(token))
                return;
            this.previewEmpty.text = `Preview unavailable: ${this.errorMessage(error)}`;
            this.previewEmpty.visible = true;
        }
    }

    private async runAction(action: AuthoredCockpitAction): Promise<void> {
        if (this.controlsLocked())
            return;
        let capture: AuthoredActionCapture;
        try {
            capture = this.model.captureAction(action);
        } catch (error) {
            this.showError(error);
            return;
        }
        this.snapshotEpoch.invalidate();
        this.previewEpoch.invalidate();
        if (action === "detach") {
            this.interactionLocked = true;
            this.model.resetStatus(`Confirm detach for ${capture.symbolLabel} (${capture.request.symbolId})`);
            this.renderModel();
            let answer: IEditor.MessageBoxReturnValue;
            try {
                answer = await Editor.showMessageBox({
                    type: "warning",
                    title: `Detach ${capture.symbolLabel}?`,
                    message: `Detach "${capture.symbolLabel}" (${capture.request.symbolId}) from generated authored content?`,
                    detail: `Family: ${capture.request.familyId}\nLocale: ${capture.request.locale}\nDetach stops future reimports from updating this exact symbol.`,
                    buttons: ["Detach", "Cancel"],
                    defaultId: 1,
                    cancelId: 1
                });
            } catch (error) {
                if (this.destroyed)
                    return;
                this.interactionLocked = false;
                this.showError(error);
                void this.refreshPreview();
                return;
            }
            if (this.destroyed)
                return;
            if (!this.model.isCaptureCurrent(capture)) {
                this.interactionLocked = false;
                this.model.failAction("Detach canceled because the selected family, symbol, locale, or preview layer changed");
                this.renderModel();
                void this.refreshPreview();
                return;
            }
            if (answer.response !== 0) {
                this.interactionLocked = false;
                this.model.resetStatus(`Detach canceled for ${capture.symbolLabel}`);
                this.renderModel();
                void this.refreshPreview();
                return;
            }
        }

        if (!this.model.isCaptureCurrent(capture)) {
            this.interactionLocked = false;
            this.model.failAction(`${this.actionTitle(action)} canceled because the exact selection became stale`);
            this.renderModel();
            void this.refreshPreview();
            return;
        }
        this.interactionLocked = true;
        this.model.beginAction(action, `${this.actionTitle(action)} in progress...`);
        this.model.reportProgress(0.12);
        this.renderModel();
        const token = this.actionEpoch.begin();
        try {
            const result = await this.bridge.runAction(action, capture.request);
            if (!this.actionEpoch.isCurrent(token))
                return;
            this.model.reportProgress(0.85, result?.message || `${this.actionTitle(action)} completed`);
            if (result?.snapshot)
                this.model.load(result.snapshot);
            else {
                const snapshot = await this.bridge.getSnapshot();
                if (!this.actionEpoch.isCurrent(token))
                    return;
                this.model.load(snapshot);
            }
            this.model.finishAction(result?.message || `${this.actionTitle(action)} completed`);
            this.interactionLocked = false;
            this.renderModel();
            await this.refreshPreview();
        } catch (error) {
            if (!this.actionEpoch.isCurrent(token))
                return;
            const message = `${this.actionTitle(action)} failed: ${this.errorMessage(error)}`;
            this.model.failAction(message);
            this.interactionLocked = false;
            this.renderModel();
            Editor.showToast(message, "error", undefined, 6000);
            void this.refreshPreview();
        }
    }

    private familyLabel(familyId?: string): string {
        return this.model.families.find(family => family.id === familyId)?.label || "Authored Content";
    }

    private layerTitle(layer: AuthoredPreviewLayer): string {
        return layer === "source" ? "Source" : layer === "base" ? "Base" : "Final";
    }

    private layerDescription(layer: AuthoredPreviewLayer): string {
        if (layer === "source")
            return "Native preview generated from immutable source evidence";
        if (layer === "base")
            return "Generated native base before project and locale patches";
        return "Published native result after project and locale patches";
    }

    private actionTitle(action: AuthoredCockpitAction): string {
        return action.charAt(0).toUpperCase() + action.slice(1);
    }

    private showError(error: unknown): void {
        if (this.destroyed)
            return;
        const message = this.errorMessage(error);
        this.model.failAction(message);
        this.renderModel();
        Editor.showToast(message, "error", undefined, 6000);
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private controlsLocked(): boolean {
        return this.destroyed || this.interactionLocked || this.model.busy;
    }
}

IEditor.panel("AuthoredContentCockpit", {
    title: "Authored Content",
    menuGroup: "Authoring",
    location: "right",
    locationBase: "ScenePanel",
    stretchPriorityX: 1,
    stretchPriorityY: 1,
    allowPopup: true,
    showInMenu: true
})(AuthoredContentCockpitPanel);
