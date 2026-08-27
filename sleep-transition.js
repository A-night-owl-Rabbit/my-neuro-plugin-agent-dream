/**
 * SleepTransition - 自然入梦过渡模块
 * 管理 清醒 -> 犯困 -> 入睡等待 -> 做梦 -> 醒来 的完整状态机
 * 通过主对话模型说话（无动画/字幕）
 */

const { eventBus } = require('../../../js/core/event-bus.js');

const GOODNIGHT_PATTERNS = [
    /晚安/, /睡了/, /拜拜/, /再见/, /下线了/, /关机了/,
    /good\s*night/i, /bye/i, /去睡/, /我先走/
];

class SleepTransition {
    constructor(context, cfg, callbacks) {
        this.context = context;
        this.cfg = cfg;
        this.callbacks = callbacks;

        this._lastInteractionTime = Date.now();
        this._goodnightDetected = false;
        this._goodnightTime = 0;
        this._fallingAsleepTimer = null;
        this._goodnightTimer = null;
        this._onInteractionBound = null;
        // 统一跟踪所有待触发的"入睡等待"定时器 {timer, reject}，
        // interrupt() 时可整体取消，避免单槽 _fallingAsleepTimer 被后来的相位覆盖而遗漏。
        this._pendingSleeps = new Set();
        // 入睡序列进行中标志，防止两次触发并发做梦
        this._sleepPending = false;
    }

    startTracking() {
        this._onInteractionBound = () => { this._lastInteractionTime = Date.now(); };
        eventBus.on('user:message:received', this._onInteractionBound);
        eventBus.on('interaction:updated', this._onInteractionBound);
    }

    stopTracking() {
        if (this._onInteractionBound) {
            eventBus.off('user:message:received', this._onInteractionBound);
            eventBus.off('interaction:updated', this._onInteractionBound);
        }
        this._clearTimers();
    }

    onUserActivity() {
        this._lastInteractionTime = Date.now();
        // B023: 晚安快速通道倒计时期间用户继续说话，说明对话还在进行，取消快速通道，不强制入睡
        this._cancelGoodnightCountdown();
    }

    // 取消尚在倒计时阶段的晚安快速通道，并恢复之前提前 pause 的 mood-chat / 热重载
    _cancelGoodnightCountdown() {
        if (!this._goodnightTimer) return;
        clearTimeout(this._goodnightTimer);
        this._goodnightTimer = null;
        this._goodnightDetected = false;
        this.context.log('info', '[AgentDream] 检测到用户活动，取消晚安快速通道');
        if (typeof this.callbacks.onGoodnightCancelled === 'function') {
            try { this.callbacks.onGoodnightCancelled(); } catch (_) { /* ignore */ }
        }
    }

    checkGoodnightSignal(text) {
        if (!text || this._goodnightDetected) return;
        for (const pattern of GOODNIGHT_PATTERNS) {
            if (pattern.test(text)) {
                this._goodnightDetected = true;
                this._goodnightTime = Date.now();
                this.context.log('info', '[AgentDream] 检测到晚安信号，启动快速通道');
                // 立即通知上层暂停 mood-chat 等会主动调用 sendToLLM 的插件，
                // 避免 180 秒倒计时和入睡过程中产生新的 LLM 调用 / TTS。
                if (typeof this.callbacks.onGoodnightDetected === 'function') {
                    try { this.callbacks.onGoodnightDetected(); } catch (_) { /* ignore */ }
                }
                this._startGoodnightCountdown();
                return;
            }
        }
    }

    getSilenceMinutes() {
        return (Date.now() - this._lastInteractionTime) / 60000;
    }

    canDreamNow() {
        const silenceMin = this.getSilenceMinutes();
        const rawThreshold = Number(this.cfg.silence_threshold_minutes);
        const threshold = Number.isFinite(rawThreshold) && rawThreshold >= 0 ? rawThreshold : 20;

        if (silenceMin < threshold) {
            return { allowed: false, reason: `静默 ${silenceMin.toFixed(1)} 分钟 < 门槛 ${threshold} 分钟` };
        }
        return { allowed: true, reason: '静默条件满足' };
    }

    async startDrowsyPhase() {
        // B022: 已有入睡序列在途时拒绝第二次并发入睡（避免两个定时器 -> 两次并发做梦）
        if (this._sleepPending) {
            this.context.log('warn', '[AgentDream] 已有入睡流程在进行，忽略重复的入睡触发');
            throw new Error('sleep_already_pending');
        }
        this.context.log('info', '[AgentDream] 进入犯困阶段...');
        this.context.emit('dream:drowsy', {});

        this._speakTransitionLine(
            this.cfg.drowsy_line,
            '唔……不行了，眼皮要掉下来了。本小姐先睡了，别半夜再戳我啊。<害羞>'
        );

        this.callbacks.onFallingAsleep();

        const rawMin = Number(this.cfg.falling_asleep_wait_minutes);
        const waitMin = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 2;
        return this.armFallingAsleep(waitMin * 60000);
    }

    /**
     * 装填一个"入睡等待"定时器并纳入统一跟踪，供自动/晚安/手动路径共用。
     * interrupt() 可整体取消所有被跟踪的定时器；已有入睡序列在途时直接拒绝，避免并发做梦。
     * @param {number} waitMs 等待毫秒数
     * @returns {Promise<void>} 到时 resolve（触发 onAsleep），被打断时 reject(new Error('interrupted'))
     */
    armFallingAsleep(waitMs) {
        if (this._sleepPending) {
            return Promise.reject(new Error('sleep_already_pending'));
        }
        this._sleepPending = true;
        return new Promise((resolve, reject) => {
            const entry = { reject };
            entry.timer = setTimeout(() => {
                this._pendingSleeps.delete(entry);
                this._fallingAsleepTimer = null;
                this._sleepPending = false;
                this.callbacks.onAsleep();
                resolve();
            }, waitMs);
            this._fallingAsleepTimer = entry.timer;
            this._pendingSleeps.add(entry);
        });
    }

    interrupt() {
        this.context.log('info', '[AgentDream] 入睡被打断！');
        const wasGoodnight = this._goodnightDetected;
        // B022: 先捕获所有待触发的入睡序列，再统一清理并逐一 reject——
        // 避免只取消最后一个定时器而遗漏更早的定时器（旧的单槽实现会漏掉第一个）。
        const pending = Array.from(this._pendingSleeps);
        this._clearTimers();
        this._goodnightDetected = false;
        // 晚安通道阶段被打断时，需要把之前提前 pause 的 mood-chat 等恢复回来。
        // onInterrupted 自身已经会调 _resumeMoodChat（在 dream/index.js 的回调里），
        // 这里再显式触发一次 onGoodnightCancelled 以便上层能区分两类清理（语义更清晰）。
        if (wasGoodnight && typeof this.callbacks.onGoodnightCancelled === 'function') {
            try { this.callbacks.onGoodnightCancelled(); } catch (_) { /* ignore */ }
        }
        this.callbacks.onInterrupted();

        this._speakTransitionLine(
            this.cfg.interrupted_line,
            '啧，刚要睡着就被你吵醒了……说吧，又怎么了？<生气>'
        );

        for (const entry of pending) {
            if (typeof entry.reject === 'function') {
                try { entry.reject(new Error('interrupted')); } catch (_) { /* ignore */ }
            }
        }
    }

    async wakeUp(keywords) {
        this.context.log('info', '[AgentDream] 醒来...');
        this.callbacks.onWakeUp();
        this._goodnightDetected = false;
        this.context.emit('dream:wakeup', { keywords });

        let spokenLine = null;
        if (this.cfg.enable_wakeup_sharing && keywords) {
            const template = this.cfg.wakeup_line_template ||
                '唔……刚才好像梦到{keywords}，乱七八糟的。算了，别问，本小姐还没醒透呢。<惊讶>';
            spokenLine = this._speakTransitionLine(
                template.replace(/\{keywords\}/g, keywords),
                `唔……刚才好像梦到${keywords}，乱七八糟的。算了，别问，本小姐还没醒透呢。<惊讶>`
            );
        }
        return spokenLine;
    }

    triggerManual() {
        this.context.log('info', '[AgentDream] 手动触发入梦');
        return this.startDrowsyPhase();
    }

    _startGoodnightCountdown() {
        const rawWait = Number(this.cfg.goodnight_fast_track_seconds);
        const waitSec = Number.isFinite(rawWait) && rawWait > 0 ? rawWait : 180;
        this.context.log('info', `[AgentDream] 晚安快速通道：等待 ${waitSec} 秒（预留时间给 AI 日志等插件完成工作）...`);

        this._goodnightTimer = setTimeout(async () => {
            this._goodnightTimer = null;

            if (!this._isInTimeWindow()) {
                this.context.log('info', '[AgentDream] 晚安快速通道：不在做梦时间窗口内，取消');
                this._goodnightDetected = false;
                // 之前在 checkGoodnightSignal 已经 pause 了 mood-chat，这里要恢复回去
                if (typeof this.callbacks.onGoodnightCancelled === 'function') {
                    try { this.callbacks.onGoodnightCancelled(); } catch (_) { /* ignore */ }
                }
                return;
            }

            // B023: 倒计时结束前再次校验活动——若用户在说晚安之后仍有交互（对话在继续），取消快速通道。
            // onUserActivity 已会即时取消倒计时，这里兜底覆盖鼠标/interaction 等未走 onUserInput 的活动。
            if (this._lastInteractionTime > this._goodnightTime) {
                this.context.log('info', '[AgentDream] 晚安快速通道：倒计时期间检测到用户仍在活动，取消');
                this._goodnightDetected = false;
                if (typeof this.callbacks.onGoodnightCancelled === 'function') {
                    try { this.callbacks.onGoodnightCancelled(); } catch (_) { /* ignore */ }
                }
                return;
            }

            this.context.log('info', '[AgentDream] 晚安快速通道确认，进入犯困阶段');
            this.startDrowsyPhase()
                .then(() => {
                    if (typeof this.callbacks.onReadyToDream === 'function') {
                        return this.callbacks.onReadyToDream();
                    }
                })
                .catch(err => {
                    if (err && err.message === 'interrupted') {
                        this.context.log('info', '[AgentDream] 晚安快速通道入梦被打断');
                    } else if (err) {
                        this.context.log('error', `[AgentDream] 晚安快速通道入梦失败: ${err.message}`);
                    }
                });
        }, waitSec * 1000);
    }

    _isInTimeWindow() {
        const hour = new Date().getHours();
        // 配置读出的 value 可能是字符串（"23"/"6"），必须强转成数字，
        // 否则 "23" <= "6" 会走字符串字典序比较，跨午夜窗口会被判错。
        const rawStart = this.cfg.time_window_start ?? 0;
        const rawEnd = this.cfg.time_window_end ?? 6;
        const start = Number(rawStart);
        const end = Number(rawEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            return true;
        }
        if (start <= end) return hour >= start && hour < end;
        return hour >= start || hour < end;
    }

    _clearTimers() {
        if (this._fallingAsleepTimer) {
            clearTimeout(this._fallingAsleepTimer);
            this._fallingAsleepTimer = null;
        }
        if (this._goodnightTimer) {
            clearTimeout(this._goodnightTimer);
            this._goodnightTimer = null;
        }
        // 清理所有被跟踪的入睡定时器，避免遗留孤儿定时器（interrupt 会另行 reject 它们）
        for (const entry of this._pendingSleeps) {
            if (entry.timer) clearTimeout(entry.timer);
        }
        this._pendingSleeps.clear();
        this._sleepPending = false;
    }

    _speakTransitionLine(line, fallback) {
        const text = (typeof line === 'string' && line.trim()) ? line.trim() : fallback;
        try {
            if (typeof this.context.speakText === 'function') {
                this.context.speakText(text);
                return text;
            }
            if (typeof this.context.showSubtitle === 'function') {
                this.context.showSubtitle(text, 5000);
            }
        } catch (err) {
            this.context.log('error', `[AgentDream] 过渡话术播放失败: ${err.message}`);
        }
        return text;
    }
}

module.exports = { SleepTransition };
