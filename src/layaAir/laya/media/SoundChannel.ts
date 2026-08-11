import { Event } from "../events/Event";
import { EventDispatcher } from "../events/EventDispatcher"
import { AssetDb } from "../resource/AssetDb";
import { Handler } from "../utils/Handler"
import { SoundManager } from "./SoundManager";

/** A per-channel gain keyframe measured from the start of the audio asset. */
export interface StereoGainPoint {
    time: number;
    left: number;
    right: number;
}

/**
 * @en The `SoundChannel` class is used to control sounds in the program. Each sound is assigned to a channel, and an application can have multiple channels mixed together.
 * The `SoundChannel` class contains methods for controlling sound playback, pause, stop, volume, as well as methods for getting information about the sound's playback status, total time, current playback time, total loop count, and playback address.
 * @zh `SoundChannel` 用来控制程序中的声音。每个声音均分配给一个声道，而且应用程序可以具有混合在一起的多个声道。
 * `SoundChannel` 类包含控制声音的播放、暂停、停止、音量的方法，以及获取声音的播放状态、总时间、当前播放时间、总循环次数、播放地址等信息的方法。
 */
export class SoundChannel extends EventDispatcher {
    /**
     * @en The URL of the sound.
     * @zh 声音地址。
     */
    readonly url: string;
    /**
     * @en The number of loops. Zero indicates an infinite loop.
     * @zh 循环次数。零表示无限循环。
     */
    loops: number;
    /**
     * @en The start time of sound playback. In seconds.
     * @zh 播放声音开始时间。以秒为单位。
     */
    startTime: number;
    /**
     * @en Sound playback rate. default value is 1.
     * @zh 声音播放速率。默认值为1。
     */
    playbackRate: number = 1;
    /**
     * @en The handler for playback completion.
     * @zh 播放完成处理器。
     */
    completeHandler: Handler | ((success: boolean) => void);

    protected _started: boolean = false;
    protected _paused: boolean = false;
    protected _loaded: boolean = false;
    protected _completed: boolean = false;
    protected _repeated: number = 0;
    protected _volumeSet: number = 1;
    protected _volume: number = 1;
    protected _muted: boolean = false;
    protected _pan: number = 0;
    protected _stereoGainEnvelope: StereoGainPoint[] = [];
    protected _startTime: number = 0;
    protected _endTime: number = 0;
    protected _pauseTime: number = 0;

    /** @internal */
    _isMusic: boolean = false;
    /** @internal */
    _autoResume: boolean = false;

    constructor(url: string) {
        super();
        this.url = url;
    }

    /**
     * @en The volume. The volume range is from 0 (mute) to 1 (maximum volume).
     * @zh 音量。音量范围从 0（静音）至 1（最大音量）。
     */
    get volume(): number {
        return this._volumeSet;
    }

    set volume(value: number) {
        this._volumeSet = value;
        let t = value * (this._isMusic ? SoundManager.musicVolume : SoundManager.soundVolume);
        if (t !== this._volume) {
            this._volume = t;
            if (this._loaded)
                this.onVolumeChanged();
        }
    }

    /**
     * @en Indicates whether the mute switch is turned on. Note that this property is controlled by the SoundManager's mute switch, so it is generally not recommended to set this value directly.
     * @zh 表示静音开关是否已打开。请注意，这个属性受SoundManager的静音开关控制，因此一般不要直接设置这个值。
     */
    get muted(): boolean {
        return this._muted;
    }

    set muted(value: boolean) {
        value = !!value;
        if (this._muted == value)
            return;

        this._muted = value;
        if (this._loaded)
            this.onMuted();
    }

    /**
     * Stereo pan in the range -1 (left) to 1 (right). Backends which cannot
     * control channels independently retain the value but report
     * stereoGainSupported=false.
     */
    get pan(): number {
        return this._pan;
    }

    set pan(value: number) {
        value = Math.max(-1, Math.min(1, Number(value) || 0));
        if (value === this._pan) return;
        this._pan = value;
        if (this._loaded) this.onStereoGainChanged();
    }

    get stereoGainSupported(): boolean {
        return false;
    }

    get stereoGainEnvelope(): readonly StereoGainPoint[] {
        return this._stereoGainEnvelope;
    }

    /**
     * Sets piecewise-linear left/right gain automation. Times are seconds on
     * the decoded audio timeline and gains are non-negative linear factors.
     */
    setStereoGainEnvelope(points: readonly StereoGainPoint[] | null): void {
        let previous = -Infinity;
        this._stereoGainEnvelope = (points || []).map(point => {
            const time = Number(point.time);
            const left = Number(point.left);
            const right = Number(point.right);
            if (!Number.isFinite(time) || time < 0 || time < previous)
                throw new RangeError("Stereo gain envelope times must be finite, non-negative, and sorted");
            if (!Number.isFinite(left) || left < 0 || !Number.isFinite(right) || right < 0)
                throw new RangeError("Stereo gain envelope values must be finite and non-negative");
            previous = time;
            return { time, left, right };
        });
        if (this._loaded) this.onStereoGainChanged();
    }

    /**
     * @en The current playback position in seconds
     * @zh 当前播放位置，以秒为单位
     */
    get position(): number {
        if (this._paused)
            return this._pauseTime;
        else if (this._startTime != 0)
            return (performance.now() - this._startTime) / 1000 + this.startTime;
        else
            return this.startTime;
    }

    /**
     * @en The duration of the audio in seconds
     * @zh 音频的持续时间，以秒为单位
     */
    get duration(): number {
        return 0;
    }

    /**
     * @en Indicates whether the sound is paused.
     * @zh 表示声音是否已暂停。
     */
    get paused(): boolean {
        return this._paused;
    }

    /**
     * @en Indicates whether the sound is stopped.
     * @zh 表示声音是否已停止
     */
    get isStopped(): boolean {
        return !this._started;
    }

    /**
     * @en Play the sound.
     * @zh 播放声音。
     */
    play(): void {
        if (this._started) {
            if (this._paused)
                this.resume();
            return;
        }

        this._started = true;
        this._loaded = false;
        this._completed = false;
        this._repeated = 0;
        this._startTime = performance.now();
        SoundManager.addChannel(this);

        AssetDb.inst.resolveURL(this.url, url => {
            if (!this._started)
                return;

            if (!url) {
                this.stop();
                return;
            }
            this.onPlay(url);
        });
    }

    /**
     * @en Stop playing the sound.
     * @zh 停止播放。
     */
    stop(): void {
        if (!this._started)
            return;

        this._started = false;
        this._loaded = false;
        SoundManager.removeChannel(this);
        this.onStop();

        this.callComplete(this._completed);
    }

    /**
     * @en Pause the sound playback.
     * @zh 暂停播放。
     */
    pause(): void {
        if (!this._started || this._paused)
            return;

        this._pauseTime = this.position;
        this._paused = true;
        this._autoResume = false;

        if (this._loaded)
            this.onPause();
    }

    /**
     * @en Resume the sound playback.
     * @zh 继续播放。
     */
    resume(): void {
        if (!this._started || !this._paused)
            return;

        this._paused = false;
        if (this._loaded)
            this.onResume();
    }

    protected onPlay(url: string) {
    }

    protected onPlayAgain() {
    }

    protected onStop() {
    }

    protected onPause() {
    }

    protected onResume() {
    }

    protected onVolumeChanged(): void {
    }

    protected onMuted(): void {
    }

    /**
     * Optional exclusive playback-window end in seconds on the decoded asset.
     * Zero plays to the asset's natural end. Looping repeats startTime..endTime.
     */
    get endTime(): number {
        return this._endTime;
    }

    set endTime(value: number) {
        value = Number(value) || 0;
        if (value < 0) throw new RangeError("SoundChannel.endTime cannot be negative");
        if (value === this._endTime) return;
        this._endTime = value;
        if (this._loaded) this.onPlaybackWindowChanged();
    }

    protected onStereoGainChanged(): void {
    }

    protected onPlaybackWindowChanged(): void {
    }

    protected onPlayEnd() {
        this._repeated++;
        if (this.loops > 0 && this._repeated >= this.loops) {
            this._completed = true;
            this.stop();
        }
        else
            this.onPlayAgain();
    }

    protected callComplete(success: boolean): void {
        if (success)
            this.event(Event.COMPLETE);

        if (!this.completeHandler)
            return;

        let handler = this.completeHandler;
        this.completeHandler = null;
        if (handler instanceof Handler)
            handler.runWith(success ?? true);
        else
            handler(success ?? true);
    }
}

