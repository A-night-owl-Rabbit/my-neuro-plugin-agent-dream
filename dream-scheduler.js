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

        // 配置 value 可能被 UI 存成字符串，此处强转防止 "23" <= "6" 的字典序陷阱
        const start = Number(this.cfg.time_window_start ?? 0);
        const end = Number(this.cfg.time_window_end ?? 6);
        let inWindow = false;
        if (Number.isFinite(start) && Number.isFinite(end)) {
            if (start <= end) {
                inWindow = hour >= start && hour < end;
            } else {
                inWindow = hour >= start || hour < end;
            }
        } else {
            inWindow = true;
        }

        if (!inWindow) return;

        const freqHours = Number(this.cfg.dream_frequency_hours) || 8;
        const frequencyMs = freqHours * 3600000;
        if (Date.now() - this._lastDreamTime < frequencyMs) return;

        const roll = Math.random();
        const probability = Number(this.cfg.probability);
        if (roll >= (Number.isFinite(probability) ? probability : 0.6)) return;

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
        // 文件不存在才是真正的"首次运行"，此时 lastDreamTime=0 是对的
        if (!fs.existsSync(this._stateFile)) return;
        let raw;
        try {
            raw = fs.readFileSync(this._stateFile, 'utf-8');
        } catch (err) {
            console.warn(`[DreamScheduler] 状态文件读取失败，按安全冷却处理: ${err.message}`);
            this._lastDreamTime = Date.now();
            return;
        }
        try {
            const data = JSON.parse(raw);
            this._lastDreamTime = data.lastDreamTime || 0;
        } catch (err) {
            // 解析失败极可能是写入中途崩溃导致的文件截断，绝不能当成"从未做过梦"把冷却清零，
            // 否则同一晚会立刻再做一次梦。保守起见按"刚做过梦"处理，保留一个安全冷却窗口。
            console.warn(`[DreamScheduler] 状态文件损坏，保留安全冷却（不清零）: ${err.message}`);
            this._lastDreamTime = Date.now();
        }
    }

    _saveState() {
        try {
            // 原子写：先写临时文件再 rename，避免写入中途崩溃留下截断的 JSON
            const tmpFile = `${this._stateFile}.tmp`;
            fs.writeFileSync(tmpFile, JSON.stringify({
                lastDreamTime: this._lastDreamTime,
                savedAt: new Date().toISOString()
            }, null, 2), 'utf-8');
            fs.renameSync(tmpFile, this._stateFile);
        } catch (err) {
            console.warn(`[DreamScheduler] 状态文件保存失败: ${err.message}`);
        }
    }
}

module.exports = { DreamScheduler };
