import { SoundChannel } from "./SoundChannel"
import { Browser } from "../utils/Browser"
import { PAL } from "../platform/PlatformAdapters";
import { IPool, Pool } from "../utils/Pool";

/**
 * @ignore
 */
export class WebAudioChannel extends SoundChannel {
    private _gainNode: GainNode;
    private _leftGainNode: GainNode;
    private _rightGainNode: GainNode;
    private _splitterNode: ChannelSplitterNode;
    private _mergerNode: ChannelMergerNode;
    private _sourceNode: AudioBufferSourceNode;
    private _buffer: AudioBuffer;

    private static gainNodePool: IPool<GainNode> = Pool.createPool2(() => createGainNode(), node => initGainNode(node), node => resetGainNode(node));

    get duration(): number {
        if (this._buffer)
            return this._buffer.duration;
        else
            return 0;
    }

    get stereoGainSupported(): boolean {
        return true;
    }

    protected onPlay(url: string): void {
        PAL.media.audioDataCache.get(url, this.onLoaded, this);
    }

    protected onPlayAgain(): void {
        this.reset();
        this.startPlay(false);
    }

    protected onStop(): void {
        this.reset();
        this._buffer = null;
    }

    protected onPause(): void {
        this.reset();
    }

    protected onResume(): void {
        this.startPlay(true);
    }

    protected onVolumeChanged() {
        if (!this._sourceNode)
            return;

        let volume = this._muted ? 0 : this._volume;
        if (this._gainNode.gain.setTargetAtTime)
            this._gainNode.gain.setTargetAtTime(volume, PAL.media.audioCtx.currentTime, 0.001);
        else
            this._gainNode.gain.value = volume;
    }

    protected onMuted(): void {
        this.onVolumeChanged();
    }

    protected onStereoGainChanged(): void {
        this.applyStereoGain(this.position);
    }

    protected onPlaybackWindowChanged(): void {
        if (!this._sourceNode) return;
        const end = this.validEndTime();
        this._sourceNode.loopEnd = end;
        this._sourceNode.loop = this.loops === 0 && this._stereoGainEnvelope.length === 0;
    }

    private onLoaded(buffer: AudioBuffer): void {
        if (!this._started)
            return;

        this._buffer = buffer;
        if (!buffer || this.startTime >= this.duration) {
            this.stop();
            return;
        }

        this._loaded = true;
        if (this._paused)
            return;

        this.startPlay(false);
    }

    private startPlay(isResuming: boolean) {
        let ctx = PAL.media.audioCtx;

        // iOS may leave the AudioContext suspended or interrupted after losing focus.
        // Do not create or start a source until the context has been resumed.
        let state = ctx.state as string;
        if (state === "closed") {
            this.stop();
            return;
        }

        if (state != null && state !== "running") {
            let resumeTime = isResuming ? this._pauseTime : this.startTime;
            this._startTime = 0;
            PAL.media.resumeUntilGotFocus(this);
            this._pauseTime = resumeTime;
            return;
        }

        this._gainNode = WebAudioChannel.gainNodePool.take();

        let sourceNode = this._sourceNode = ctx.createBufferSource();
        sourceNode.buffer = this._buffer;
        this._splitterNode = ctx.createChannelSplitter(2);
        this._mergerNode = ctx.createChannelMerger(2);
        this._leftGainNode = ctx.createGain();
        this._rightGainNode = ctx.createGain();
        sourceNode.connect(this._splitterNode);
        this._splitterNode.connect(this._leftGainNode, 0);
        this._splitterNode.connect(this._rightGainNode, 1);
        this._leftGainNode.connect(this._mergerNode, 0, 0);
        this._rightGainNode.connect(this._mergerNode, 0, 1);
        this._mergerNode.connect(this._gainNode);
        sourceNode.onended = () => this.onPlayEnd();
        if (sourceNode.playbackRate) { //douyin真机这个为空
            if (sourceNode.playbackRate.setTargetAtTime)
                sourceNode.playbackRate.setTargetAtTime(this.playbackRate, ctx.currentTime, 0.001)
            else
                sourceNode.playbackRate.value = this.playbackRate;
        }
        // An automated envelope must be rescheduled at each loop boundary.
        sourceNode.loop = this.loops === 0 && this._stereoGainEnvelope.length === 0;
        sourceNode.loopStart = this.startTime;
        sourceNode.loopEnd = this.validEndTime();
        this._gainNode.gain.value = this._muted ? 0 : this._volume;
        const offset = isResuming ? this._pauseTime : this.startTime;
        this.applyStereoGain(offset);
        const end = this.validEndTime();
        if (!sourceNode.loop && end > offset && end < this._buffer.duration)
            sourceNode.start(0, offset, end - offset);
        else
            sourceNode.start(0, offset);
        this._startTime = performance.now();
    }

    private applyStereoGain(offset: number): void {
        if (!this._leftGainNode || !this._rightGainNode) return;
        const ctx = PAL.media.audioCtx;
        const now = ctx.currentTime;
        const leftParam = this._leftGainNode.gain;
        const rightParam = this._rightGainNode.gain;
        leftParam.cancelScheduledValues(now);
        rightParam.cancelScheduledValues(now);
        const panLeft = this._pan > 0 ? 1 - this._pan : 1;
        const panRight = this._pan < 0 ? 1 + this._pan : 1;
        const points = this._stereoGainEnvelope;
        if (!points.length) {
            leftParam.setValueAtTime(panLeft, now);
            rightParam.setValueAtTime(panRight, now);
            return;
        }
        let left = points[0].left;
        let right = points[0].right;
        for (let index = 1; index < points.length; index++) {
            const before = points[index - 1];
            const after = points[index];
            if (offset >= after.time) {
                left = after.left;
                right = after.right;
                continue;
            }
            if (offset > before.time) {
                const ratio = (offset - before.time) / Math.max(0.000001, after.time - before.time);
                left = before.left + (after.left - before.left) * ratio;
                right = before.right + (after.right - before.right) * ratio;
            }
            break;
        }
        leftParam.setValueAtTime(left * panLeft, now);
        rightParam.setValueAtTime(right * panRight, now);
        for (const point of points) {
            if (point.time <= offset) continue;
            const when = now + (point.time - offset) / Math.max(0.000001, this.playbackRate);
            leftParam.linearRampToValueAtTime(point.left * panLeft, when);
            rightParam.linearRampToValueAtTime(point.right * panRight, when);
        }
    }

    private validEndTime(): number {
        if (!this._buffer || this._endTime <= this.startTime || this._endTime > this._buffer.duration)
            return this._buffer?.duration ?? 0;
        return this._endTime;
    }

    private reset(): void {
        if (!this._sourceNode)
            return;

        let sourceNode = this._sourceNode;
        if (sourceNode.stop)
            sourceNode.stop(0);
        else
            (sourceNode as any).noteOff(0);
        sourceNode.disconnect();
        sourceNode.onended = null;
        this._sourceNode = null;

        this._splitterNode?.disconnect();
        this._splitterNode = null;
        this._leftGainNode?.disconnect();
        this._leftGainNode = null;
        this._rightGainNode?.disconnect();
        this._rightGainNode = null;
        this._mergerNode?.disconnect();
        this._mergerNode = null;

        WebAudioChannel.gainNodePool.recover(this._gainNode);
        this._gainNode = null;
    }
}

function createGainNode(): GainNode {
    let node: GainNode;
    if (PAL.media.audioCtx.createGain)
        node = PAL.media.audioCtx.createGain();
    else
        node = (PAL.media.audioCtx as any).createGainNode();
    return node;
}

function initGainNode(node: GainNode) {
    node.connect(PAL.media.audioCtx.destination);
}

function resetGainNode(node: GainNode) {
    node.disconnect();
}
