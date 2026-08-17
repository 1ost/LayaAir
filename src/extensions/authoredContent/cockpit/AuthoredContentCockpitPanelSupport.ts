export class AuthoredAsyncEpoch {
    private epoch = 0;
    private destroyed = false;

    begin(): number {
        if (this.destroyed)
            return -1;
        return ++this.epoch;
    }

    isCurrent(token: number): boolean {
        return !this.destroyed && token > 0 && token === this.epoch;
    }

    invalidate(): void {
        this.epoch++;
    }

    destroy(): void {
        this.destroyed = true;
        this.epoch++;
    }
}

export function captureFocusedWidgetName(root: gui.Widget): string | undefined {
    if (root.focused && root.name)
        return root.name;
    for (const child of root.children) {
        const name = captureFocusedWidgetName(child);
        if (name)
            return name;
    }
    return undefined;
}

export function restoreNamedFocus(root: gui.Widget, name: string): boolean {
    const target = findNamedWidget(root, name);
    if (!target || !target.visible || !target.enabled || !target.focusable)
        return false;
    target.requestFocus();
    return true;
}

function findNamedWidget(root: gui.Widget, name: string): gui.Widget | undefined {
    if (root.name === name)
        return root;
    for (const child of root.children) {
        const found = findNamedWidget(child, name);
        if (found)
            return found;
    }
    return undefined;
}
