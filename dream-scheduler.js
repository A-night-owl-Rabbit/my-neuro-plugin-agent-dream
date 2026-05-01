/**
 * DreamScheduler - 自动做梦调度器
 * 每 5 分钟检查一次：时间窗口 + 冷却 + 概率 + 静默门槛
 */

const fs = require('fs');
const path = require('path');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

class DreamScheduler {
    constructor(cfg, transition, onTrigger) {
        this.cfg = cfg;
        this.transition = transition;
        this.onTrigger = onTrigger;

        this._timer = null;
        this._lastDreamTime = 0;
        this._stateFile = path.join(path.dirname(__filename), 'dream_state.json');

        this._loadState();
    }

    start() {
        if (this._timer) clearInterval(this._timer);

        this._timer = setInterval(() => {
            this._check().catch(err => {
                console.error('[DreamScheduler] check error:', err.message);
            });
        }, CHECK_INTERVAL_MS);

        if (this._timer.unref) this._timer.unref();

        console.log(
            `[DreamScheduler] 已启动 | 每${CHECK_INTERVAL_MS / 60000}分钟检查 | ` +
            `窗口 ${this.cfg.time_window_start}:00-${this.cfg.time_window_end}:00 | ` +
            `间隔 ${this.cfg.dream_frequency_hours}h | 概率 ${this.cfg.probability}`
        );
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._saveState();
        console.log('[DreamScheduler] 已停止');
    }

    recordDreamCompleted() {
        this._lastDreamTime = Date.now();
        this._saveState();
    }

    async _check() {
        const now = new Date();
        const hour = now.getHours();

        const start = this.cfg.time_window_start ?? 0;
        const end = this.cfg.time_window_end ?? 6;
        let inWindow = false;
        if (start <= end) {
            inWindow = hour >= start && hour < end;
        } else {
            inWindow = hour >= start || hour < end;
        }

        if (!inWindow) return;

        const frequencyMs = (this.cfg.dream_frequency_hours || 8) * 3600000;
        if (Date.now() - this._lastDreamTime < frequencyMs) return;

        const roll = Math.random();
        if (roll >= (this.cfg.probability || 0.6)) return;

        const { allowed, reason } = this.transition.canDreamNow();
        if (!allowed) {
            console.log(`[DreamScheduler] 未满足静默条件: ${reason}`);
            return;
        }

        console.log('[DreamScheduler] 所有条件满足，启动入梦流程');

        try {
            await this.transition.startDrowsyPhase();
            this.recordDreamCompleted();
            await this.onTrigger();
        } catch (err) {
            if (err.message === 'interrupted') {
                console.log('[DreamScheduler] 入梦被用户打断');
            } else {
                console.error('[DreamScheduler] 入梦失败:', err.message);
            }
        }
    }

    _loadState() {
        try {
            if (fs.existsSync(this._stateFile)) {
                const data = JSON.parse(fs.readFileSync(this._stateFile, 'utf-8'));
                this._lastDreamTime = data.lastDreamTime || 0;
            }
        } catch { /* ignore */ }
    }

    _saveState() {
        try {
            fs.writeFileSync(this._stateFile, JSON.stringify({
                lastDreamTime: this._lastDreamTime,
                savedAt: new Date().toISOString()
            }, null, 2), 'utf-8');
        } catch { /* ignore */ }
    }
}

module.exports = { DreamScheduler };
