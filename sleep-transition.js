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
    }

    checkGoodnightSignal(text) {
        if (!text || this._goodnightDetected) return;
        for (const pattern of GOODNIGHT_PATTERNS) {
            if (pattern.test(text)) {
                this._goodnightDetected = true;
                this._goodnightTime = Date.now();
                this.context.log('info', '[AgentDream] 检测到晚安信号，启动快速通道');
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
        this.context.log('info', '[AgentDream] 进入犯困阶段...');
        this.context.emit('dream:drowsy', {});

        const drowsyDirective = this.cfg.drowsy_prompt ||
            '你现在非常困了，眼皮越来越重，快要睡着了。在你的下一句回复中，用你自己的方式简短地表达困意并说要去睡了，一句话就好。';

        this.context.addSystemPromptPatch('dream-drowsy', drowsyDirective);
        try {
            await this.context.sendMessage('...');
        } catch (err) {
            this.context.log('error', `[AgentDream] 犯困话发送失败: ${err.message}`);
        }
        this.context.removeSystemPromptPatch('dream-drowsy');

        this.callbacks.onFallingAsleep();

        return new Promise((resolve, reject) => {
            const rawMin = Number(this.cfg.falling_asleep_wait_minutes);
            const waitMin = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 2;
            const waitMs = waitMin * 60000;

            this._fallingAsleepTimer = setTimeout(() => {
                this._fallingAsleepTimer = null;
                this.callbacks.onAsleep();
                resolve();
            }, waitMs);

            this._interruptReject = reject;
        });
    }

    interrupt() {
        this.context.log('info', '[AgentDream] 入睡被打断！');
        this._clearTimers();
        this._goodnightDetected = false;
        this.callbacks.onInterrupted();

        const interruptedDirective = this.cfg.interrupted_prompt ||
            '你刚要睡着就被主人吵醒了，不爽但还是回应一句，然后恢复正常对话。';

        this.context.addSystemPromptPatch('dream-interrupted', interruptedDirective);
        this.context.sendMessage('...').catch(() => {});
        setTimeout(() => this.context.removeSystemPromptPatch('dream-interrupted'), 5000);

        if (this._interruptReject) {
            this._interruptReject(new Error('interrupted'));
            this._interruptReject = null;
        }
    }

    async wakeUp(keywords) {
        this.context.log('info', '[AgentDream] 醒来...');
        this.callbacks.onWakeUp();
        this._goodnightDetected = false;
        this.context.emit('dream:wakeup', { keywords });

        if (this.cfg.enable_wakeup_sharing && keywords) {
            const template = this.cfg.wakeup_prompt_template ||
                '你刚从睡梦中醒来，隐约记得梦里出现了{keywords}，迷迷糊糊地说一句梦话碎片，不要完整叙述梦，一两句就好。';
            const directive = template.replace(/\{keywords\}/g, keywords);

            this.context.addSystemPromptPatch('dream-wakeup', directive);
            try {
                await this.context.sendMessage('...');
            } catch (err) {
                this.context.log('error', `[AgentDream] 醒来话发送失败: ${err.message}`);
            }
            this.context.removeSystemPromptPatch('dream-wakeup');
        }
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
    }
}

module.exports = { SleepTransition };
