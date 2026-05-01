const { Plugin } = require('../../../js/core/plugin-base.js');
const fs = require('fs');
const path = require('path');

const { DreamScheduler } = require('./dream-scheduler.js');
const { SleepTransition } = require('./sleep-transition.js');
const { DreamWaveEngine } = require('./dream-wave-engine.js');
const { MemosAdapter } = require('./memos-adapter.js');
const { DreamOperations } = require('./dream-operations.js');
const { DreamStore } = require('./dream-store.js');

const DREAM_BUBBLE_CSS = `
#dream-bubble-container {
    position: fixed;
    top: 0; left: 0;
    z-index: 998;
    display: none;
    pointer-events: none;
    transition: none;
}
#dream-bubble-inner {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 120px;
    max-width: 260px;
    padding: 14px 20px;
    background: linear-gradient(145deg, #e8eaf6 0%, #c5cae9 40%, #9fa8da 100%);
    border: 2.5px solid #7986cb;
    border-radius: 22px;
    box-shadow:
        0 8px 24px rgba(63, 81, 181, 0.22),
        0 2px 8px rgba(63, 81, 181, 0.14),
        inset 0 1px 0 rgba(255, 255, 255, 0.7);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: #283593;
    line-height: 1.5;
    white-space: nowrap;
    pointer-events: none;
    animation: dream-float 4s ease-in-out infinite;
    opacity: 0;
    transition: opacity 0.5s ease;
}
#dream-bubble-inner.visible { opacity: 1; }
#dream-bubble-inner::after {
    content: '';
    position: absolute;
    bottom: -10px; left: 24px;
    width: 0; height: 0;
    border-style: solid;
    border-width: 10px 10px 0 0;
    border-color: #7986cb transparent transparent transparent;
}
#dream-bubble-inner::before {
    content: '';
    position: absolute;
    bottom: -7px; left: 26px;
    width: 0; height: 0;
    border-style: solid;
    border-width: 8px 8px 0 0;
    border-color: #c5cae9 transparent transparent transparent;
    z-index: 1;
}
#dream-bubble-text {
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dream-zzz {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    font-size: 16px;
    color: #5c6bc0;
}
.dream-zzz .z {
    animation: z-float 2s ease-in-out infinite;
    display: inline-block;
}
.dream-zzz .z:nth-child(2) { animation-delay: 0.4s; font-size: 13px; }
.dream-zzz .z:nth-child(3) { animation-delay: 0.8s; font-size: 10px; }
@keyframes dream-float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
}
@keyframes z-float {
    0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
    50% { transform: translateY(-6px) scale(1.2); opacity: 1; }
}
`;

const DREAM_BUBBLE_TEXTS = [
    'zzZ... 在做梦...',
    '梦境生成中...',
    '沉入记忆深处...',
    '意识流漫游中...',
    '记忆涟漪扩散...',
    '潜意识编织中...',
    '梦的碎片在飘...',
    '深层记忆共振...',
];

class DreamPlugin extends Plugin {

    async onInit() {
        this._cfg = this.context.getPluginFileConfig();
        if (!this._cfg.enabled) return;

        this._isDreaming = false;
        this._isFallingAsleep = false;
        this._pluginDir = path.dirname(__filename);
        this._bubbleEl = null;
        this._bubbleInner = null;
        this._bubbleTextEl = null;
        this._bubbleTimer = null;
        this._bubblePosTimer = null;
        this._bubblePosInit = false;
        this._bubbleX = 0;
        this._bubbleY = 0;

        const memosPlugin = this.context.getPlugin('memos');
        const memosUrl = memosPlugin
            ? (memosPlugin._cfg?.api_url || 'http://127.0.0.1:8003')
            : 'http://127.0.0.1:8003';

        this._memos = new MemosAdapter(memosUrl, this._cfg);
        this._wave = new DreamWaveEngine(this._memos, this._cfg);
        this._store = new DreamStore(this._cfg, this._pluginDir);
        this._ops = new DreamOperations(this._memos, this._store, this._cfg);
        this._transition = new SleepTransition(this.context, this._cfg, {
            onFallingAsleep: () => {
                this._isFallingAsleep = true;
            },
            onAsleep: () => {
                this._isFallingAsleep = false;
                this._isDreaming = true;
                this._showDreamBubble();
                this._pauseMoodChat();
            },
            onInterrupted: () => {
                this._isFallingAsleep = false;
                this._hideDreamBubble();
                this._resumeMoodChat();
            },
            onWakeUp: () => {
                this._isDreaming = false;
                this._hideDreamBubble();
                this._resumeMoodChat();
            },
            onReadyToDream: async () => {
                // 晚安快速通道入睡完成后，走和自动调度一致的收尾：先打冷却标记，再正式入梦
                if (this._scheduler) this._scheduler.recordDreamCompleted();
                await this._executeDream();
            },
        });
        this._scheduler = new DreamScheduler(this._cfg, this._transition, () => this._executeDream());
    }

    async onStart() {
        if (!this._cfg.enabled) {
            this.context.log('warn', 'Agent Dream 梦系统已禁用');
            return;
        }

        this._transition.startTracking();
        this._scheduler.start();
        this._store.ensureDirs();
        this._injectBubble();

        this.context.log('info',
            `Agent Dream 梦系统已启动 | 时间窗口: ${this._cfg.time_window_start}:00-${this._cfg.time_window_end}:00 | ` +
            `静默门槛: ${this._cfg.silence_threshold_minutes}分钟 | 概率: ${this._cfg.probability}`);
    }

    async onStop() {
        if (!this._cfg.enabled) return;
        this._scheduler.stop();
        this._transition.stopTracking();
        this._hideDreamBubble();
        this._removeBubble();
        this._resumeMoodChat();
        // 热重载/手动停止时清理状态标记，避免旧实例在途的 async 流程误判
        this._isDreaming = false;
        this._isFallingAsleep = false;
        this.context.log('info', 'Agent Dream 梦系统已停止');
    }

    // ===== 入梦气泡 =====

    _injectBubble() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('dream-bubble-style')) return;

        const style = document.createElement('style');
        style.id = 'dream-bubble-style';
        style.textContent = DREAM_BUBBLE_CSS;
        document.head.appendChild(style);

        const container = document.createElement('div');
        container.id = 'dream-bubble-container';

        const inner = document.createElement('div');
        inner.id = 'dream-bubble-inner';

        const textEl = document.createElement('span');
        textEl.id = 'dream-bubble-text';
        textEl.textContent = DREAM_BUBBLE_TEXTS[0];
        inner.appendChild(textEl);

        const zzz = document.createElement('span');
        zzz.className = 'dream-zzz';
        for (let i = 0; i < 3; i++) {
            const z = document.createElement('span');
            z.className = 'z';
            z.textContent = 'z';
            zzz.appendChild(z);
        }
        inner.appendChild(zzz);

        container.appendChild(inner);
        document.body.appendChild(container);

        this._bubbleEl = container;
        this._bubbleInner = inner;
        this._bubbleTextEl = textEl;
    }

    _removeBubble() {
        if (typeof document === 'undefined') return;
        const style = document.getElementById('dream-bubble-style');
        if (style) style.remove();
        const el = document.getElementById('dream-bubble-container');
        if (el) el.remove();
        this._bubbleEl = null;
        this._bubbleInner = null;
        this._bubbleTextEl = null;
    }

    _showDreamBubble() {
        if (!this._bubbleEl || !this._bubbleInner) return;

        const rawScale = Number(this._cfg.bubble_scale);
        const scale = (isNaN(rawScale) || rawScale <= 0) ? 1 : rawScale;
        this._bubbleEl.style.transform = `scale(${scale})`;
        this._bubbleEl.style.transformOrigin = 'bottom left';

        this._bubbleEl.style.display = 'block';
        requestAnimationFrame(() => {
            if (this._bubbleInner) this._bubbleInner.classList.add('visible');
        });
        this._bubblePosInit = false;
        this._bubblePosTimer = setInterval(() => this._updateBubblePos(), 16);
        this._bubbleTimer = setInterval(() => {
            if (this._bubbleTextEl) {
                this._bubbleTextEl.textContent =
                    DREAM_BUBBLE_TEXTS[Math.floor(Math.random() * DREAM_BUBBLE_TEXTS.length)];
            }
        }, 4000);
    }

    _hideDreamBubble() {
        if (this._bubbleTimer) { clearInterval(this._bubbleTimer); this._bubbleTimer = null; }
        if (this._bubblePosTimer) { clearInterval(this._bubblePosTimer); this._bubblePosTimer = null; }
        if (this._bubbleInner) this._bubbleInner.classList.remove('visible');
        setTimeout(() => {
            if (!this._isDreaming && this._bubbleEl) this._bubbleEl.style.display = 'none';
        }, 500);
    }

    _updateBubblePos() {
        if (!this._bubbleEl || !this._isDreaming) return;
        try {
            if (!global.currentModel || !global.pixiApp) return;
            const canvas = document.getElementById('canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const pos = global.currentModel.toGlobal({ x: 0, y: 0 });
            const sx = rect.width / canvas.width;
            const sy = rect.height / canvas.height;
            const rawOx = Number(this._cfg.bubble_offset_x);
            const rawOy = Number(this._cfg.bubble_offset_y);
            const offsetX = isNaN(rawOx) ? -160 : rawOx;
            const offsetY = isNaN(rawOy) ? -180 : rawOy;
            const targetX = rect.left + pos.x * sx + offsetX;
            const targetY = rect.top + pos.y * sy + offsetY;
            if (isNaN(targetX) || isNaN(targetY)) return;
            if (!this._bubblePosInit) {
                this._bubbleX = targetX;
                this._bubbleY = targetY;
                this._bubblePosInit = true;
            } else {
                this._bubbleX += (targetX - this._bubbleX) * 0.15;
                this._bubbleY += (targetY - this._bubbleY) * 0.15;
            }
            this._bubbleEl.style.left = `${this._bubbleX}px`;
            this._bubbleEl.style.top = `${this._bubbleY}px`;
        } catch { /* ignore */ }
    }

    // ===== 心情插件暂停/恢复 =====

    _pauseMoodChat() {
        try {
            const moodModule = global.moodChatModule;
            if (moodModule) {
                if (moodModule.chatTimer) {
                    clearTimeout(moodModule.chatTimer);
                    moodModule.chatTimer = null;
                }
                moodModule._dreamPaused = true;
                this.context.log('info', '[AgentDream] 已暂停心情插件主动对话');
            }
        } catch { /* ignore */ }
    }

    _resumeMoodChat() {
        try {
            const moodModule = global.moodChatModule;
            if (moodModule && moodModule._dreamPaused) {
                moodModule._dreamPaused = false;
                moodModule.scheduleNextChat();
                this.context.log('info', '[AgentDream] 已恢复心情插件主动对话');
            }
        } catch { /* ignore */ }
    }

    async onUserInput(event) {
        if (!this._cfg.enabled) return;

        if (this._isDreaming) {
            event.preventDefault();
            return;
        }

        if (this._isFallingAsleep) {
            event.preventDefault();
            this._transition.interrupt();
            return;
        }

        this._transition.onUserActivity();
        this._transition.checkGoodnightSignal(event.text);
    }

    getTools() {
        if (!this._cfg.enabled) return [];
        return [
            {
                type: 'function',
                function: {
                    name: 'trigger_dream',
                    description: '手动触发角色做梦（仅在用户明确要求时调用）',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            }
        ];
    }

    async executeTool(name, params) {
        if (name === 'trigger_dream') {
            if (this._isDreaming) return '角色已经在做梦了，别吵她。';
            if (this._isFallingAsleep) return '角色正在入睡中，别吵她。';

            const drowsyDirective = this._cfg.drowsy_prompt ||
                '你现在非常困了，眼皮越来越重，快要睡着了。在你的下一句回复中，用你自己的方式简短地表达困意并说要去睡了，一句话就好。';
            this.context.addSystemPromptPatch('dream-drowsy', drowsyDirective);

            this._manualDreamAfterResponse();

            return '[系统：梦系统已激活，角色即将入睡。请用你的方式简短表达困意。]';
        }
    }

    async _manualDreamAfterResponse() {
        await new Promise(r => setTimeout(r, 3000));
        this.context.removeSystemPromptPatch('dream-drowsy');

        this.context.log('info', '[AgentDream] 手动触发：犯困话已说完，进入入睡等待...');
        this._isFallingAsleep = true;
        this._transition.callbacks.onFallingAsleep();

        try {
            await new Promise((resolve, reject) => {
                const waitMs = (this._cfg.falling_asleep_wait_minutes || 2) * 60000;
                this._transition._fallingAsleepTimer = setTimeout(() => {
                    this._transition._fallingAsleepTimer = null;
                    this._transition.callbacks.onAsleep();
                    resolve();
                }, waitMs);
                this._transition._interruptReject = reject;
            });

            await this._executeDream();
        } catch (err) {
            if (err.message === 'interrupted') {
                this.context.log('info', '[AgentDream] 手动入梦被用户打断');
            } else {
                this.context.log('error', `[AgentDream] 手动入梦失败: ${err.message}`);
            }
        }
    }

    // ===== 核心梦流程 =====

    async _executeDream() {
        const dreamId = `dream-${this._dateStr()}-${this._timeStr()}`;
        this.context.log('info', `[AgentDream] 正式入梦 - ${dreamId}`);
        this.context.emit('dream:start', { dreamId });

        try {
            // Step 1: 记忆涟漪浪潮
            this.context.log('info', '[AgentDream] 记忆浪潮生成中...');
            const dreamTree = await this._wave.generateDreamWave();

            if (!dreamTree || dreamTree.totalCount === 0) {
                this.context.log('warn', '[AgentDream] 记忆不足，无法做梦');
                this._transition.wakeUp(null);
                return;
            }

            this.context.log('info',
                `[AgentDream] 浪潮完成: 近期 ${dreamTree.recent.seeds.length} 种子 + ` +
                `${dreamTree.recent.resonanceL1.length} L1共振 + ${dreamTree.recent.cascadeL2.length} L2下探 / ` +
                `中期 ${dreamTree.mid.seeds.length} 种子 + ${dreamTree.mid.cascadeL1.length} L1 / ` +
                `深渊 ${dreamTree.deep.recalls.length} 召回`);

            // Step 2: 组装梦提示词 + 同时启动记忆去重（并发）
            const dreamPrompt = this._assembleDreamPrompt(dreamTree);
            const dedupPromise = this._deduplicateAllMemories(dreamId);

            // Step 3: 调用 LLM 生成梦叙事（与去重并发执行）
            this.context.log('info', '[AgentDream] 梦叙事生成中...（记忆去重同步进行）');
            const [llmResult] = await Promise.all([
                this._callDreamLLM(dreamPrompt),
                dedupPromise
            ]);

            if (!llmResult || !llmResult.narrative) {
                this.context.log('error', '[AgentDream] 梦叙事生成失败');
                this._transition.wakeUp(null);
                return;
            }

            const narrative = llmResult.narrative;
            const curiosityList = llmResult.curiosity || [];

            this.context.log('info', `[AgentDream] 梦叙事生成完成 (${narrative.length} 字${curiosityList.length > 0 ? `, 含 ${curiosityList.length} 次梦中查询` : ''})`);
            this.context.emit('dream:narrative', { dreamId, narrative, curiosity: curiosityList });

            // Step 4: 保存梦境 txt 文件 + 对梦涉及记忆做删除/感悟分析（并发）+ 梦中习得感悟必写（独立分支）
            const savedPath = this._store.saveDreamFile(narrative, dreamTree, curiosityList);
            this.context.log('info', `[AgentDream] 梦境已保存: ${savedPath}`);

            const [_, postResult] = await Promise.all([
                this._analyzeDreamMemoryOps(narrative, dreamTree, dreamId),
                this._postProcessDream(narrative, dreamId),
                this._writeCuriosityInsight(narrative, curiosityList, dreamId)
            ]);

            // Step 5: 醒来（用 LLM 提取的关键词）
            this._transition.wakeUp(postResult.keywords);

        } catch (err) {
            this.context.log('error', `[AgentDream] 做梦异常: ${err.message}`);
            this._transition.wakeUp(null);
        }
    }

    _assembleDreamPrompt(dreamTree) {
        let templatePath = path.join(this._pluginDir, 'dreampost.txt');
        let template = '';
        try {
            template = fs.readFileSync(templatePath, 'utf-8');
        } catch {
            template = '你正在做梦。\n{{DreamTreeBlock}}';
        }

        const segments = [];

        if (dreamTree.recent.seeds.length > 0) {
            segments.push('=== 你今天脑海中闪过的微小片段（近期） ===');
            for (const m of dreamTree.recent.seeds) {
                segments.push(m.content + '\n');
            }
        }

        if (dreamTree.recent.resonanceL1.length > 0 || dreamTree.recent.cascadeL2.length > 0) {
            segments.push('=== 这些片段不知为何，唤醒了你记忆中的某些关联脉络（共振桥梁） ===');
            for (const m of dreamTree.recent.resonanceL1) {
                segments.push(`[核心共振记忆]\n${m.content}\n`);
            }
            for (const m of dreamTree.recent.cascadeL2) {
                segments.push(`[顺藤摸瓜的延展]\n${m.content}\n`);
            }
        }

        if (dreamTree.mid.seeds.length > 0 || dreamTree.mid.cascadeL1.length > 0) {
            segments.push('=== 恍惚间，几个月前的一些记忆也浮现了出来（中期） ===');
            for (const m of dreamTree.mid.seeds) segments.push(`[中期记忆]\n${m.content}\n`);
            for (const m of dreamTree.mid.cascadeL1) segments.push(`[中期记忆的涟漪]\n${m.content}\n`);
        }

        if (dreamTree.deep.recalls.length > 0) {
            segments.push('=== 在梦的最深处，所有思绪的交汇，指向了被你遗忘在深处的记忆（长远） ===');
            for (const m of dreamTree.deep.recalls) segments.push(`[深渊中的召唤]\n${m.content}\n`);
        }

        const now = new Date();
        const monthNames = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
        const hour = now.getHours();
        const timeOfDay = hour < 6 ? '夜' : hour < 12 ? '晨' : hour < 18 ? '日' : '夜';

        return template
            .replace(/\{\{Month\}\}/g, monthNames[now.getMonth()])
            .replace(/\{\{Day\}\}/g, String(now.getDate()))
            .replace(/\{\{TimeOfDay\}\}/g, timeOfDay)
            .replace(/\{\{DreamTreeBlock\}\}/g, segments.join('\n'));
    }

    _getDreamLLMConfig() {
        const voiceChat = global.voiceChat;
        const apiUrl = this._cfg.dream_api_url
            || (voiceChat?.API_URL ? voiceChat.API_URL + '/chat/completions' : '');
        const apiKey = this._cfg.dream_api_key || voiceChat?.API_KEY || '';
        const model = this._cfg.dream_model || voiceChat?.MODEL || '';
        return { apiUrl, apiKey, model };
    }

    /**
     * 调用梦境 LLM 生成梦叙事。
     * 启用 dream_curiosity 时支持工具调用循环：模型可调用 dream_curiosity_search 查询知识。
     * @returns {Promise<{narrative:string, curiosity:Array<{query:string, result:string}>}|null>}
     */
    async _callDreamLLM(dreamPrompt, maxRetries = 3) {
        const { apiUrl, apiKey, model } = this._getDreamLLMConfig();
        if (!apiUrl || !apiKey) {
            this.context.log('error', '[AgentDream] LLM API 配置缺失，请在 plugin_config.json 中配置 dream_api_url 和 dream_api_key');
            return null;
        }

        const systemPrompt = this._cfg.dream_system_prompt || '';
        // value 字段可能存为字符串 "true"/"false"，做一次显式转换避免 "false" 被误判为 truthy
        const rawCuriosity = this._cfg.enable_dream_curiosity;
        const useCuriosity = (rawCuriosity === true) || (typeof rawCuriosity === 'string' && /^(true|1|yes|on)$/i.test(rawCuriosity.trim()));
        const maxSearch = Math.max(0, parseInt(this._cfg.dream_curiosity_max_calls) || 1);
        const tools = (useCuriosity && maxSearch > 0) ? this._buildDreamTools(maxSearch) : null;

        this.context.log('info', `[AgentDream] LLM: ${model} @ ${apiUrl.substring(0, 40)}...`);
        this.context.log('info', `[AgentDream] system_prompt: ${systemPrompt.length} 字, user_prompt: ${dreamPrompt.length} 字, max_tokens: ${this._cfg.dream_max_tokens}, temp: ${this._cfg.dream_temperature}, 图书馆: ${tools ? `开启(配额${maxSearch})` : '关闭'}`);

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: dreamPrompt }
        ];

        const narrativeParts = [];
        const curiosity = [];
        let searchUsed = 0;
        const MAX_ROUNDS = tools ? (maxSearch + 2) : 1;

        for (let round = 1; round <= MAX_ROUNDS; round++) {
            const body = {
                model,
                messages,
                max_tokens: parseInt(this._cfg.dream_max_tokens) || 4000,
                temperature: parseFloat(this._cfg.dream_temperature) || 0.9
            };
            if (tools) {
                body.tools = tools;
                body.tool_choice = 'auto';
            }

            const data = await this._fetchLLMOnce(apiUrl, apiKey, body, maxRetries, `轮${round}`);
            if (!data) {
                this.context.log('error', `[AgentDream] LLM 第${round}轮失败`);
                return narrativeParts.length > 0
                    ? { narrative: narrativeParts.join('\n\n'), curiosity }
                    : null;
            }

            const choice = data.choices?.[0];
            if (!choice) {
                this.context.log('error', `[AgentDream] 第${round}轮 choices 为空`);
                return narrativeParts.length > 0
                    ? { narrative: narrativeParts.join('\n\n'), curiosity }
                    : null;
            }

            const message = choice.message || {};
            if (message.content) narrativeParts.push(message.content);
            const finishReason = choice.finish_reason || '';

            if (finishReason !== 'tool_calls') {
                const totalLen = narrativeParts.reduce((s, p) => s + p.length, 0);
                this.context.log('info', `[AgentDream] LLM 第${round}轮拿到最终答案 (finish_reason=${finishReason}, 累计 ${totalLen} 字, 用了 ${searchUsed}/${maxSearch} 次查询)`);
                return { narrative: narrativeParts.join('\n\n'), curiosity };
            }

            const toolCalls = message.tool_calls || [];
            this.context.log('info', `[AgentDream] LLM 第${round}轮请求 ${toolCalls.length} 个工具调用`);
            messages.push({
                role: 'assistant',
                content: message.content || null,
                tool_calls: toolCalls
            });

            for (const tc of toolCalls) {
                const fnName = tc.function?.name || '';
                const argsRaw = tc.function?.arguments || '{}';
                let toolResult;
                if (fnName === 'dream_curiosity_search') {
                    if (searchUsed >= maxSearch) {
                        toolResult = '[图书馆的门已经关了——今晚的配额用完了，你转身回到梦的其他地方……]';
                    } else {
                        let args = {};
                        try { args = JSON.parse(argsRaw); } catch { /* ignore */ }
                        const query = (args.query || '').toString().trim().slice(0, 200);
                        if (!query) {
                            toolResult = '[你抽出一本书，但封面是空白的，你迷茫地把它放回去……]';
                        } else {
                            searchUsed++;
                            this.context.log('info', `[AgentDream] 梦中查询 #${searchUsed}/${maxSearch}: ${query}`);
                            const knowledge = await this._executeDreamCuriosity(query);
                            curiosity.push({ query, result: knowledge });
                            toolResult = `[你抽出的那本书，封面写着「${query}」]\n[书里的字浮现出来——]\n${knowledge}\n[字开始模糊，你合上书，把它放回了书架……]`;
                        }
                    }
                } else {
                    toolResult = `[未知的梦中工具：${fnName}]`;
                    this.context.log('warn', `[AgentDream] 未知工具调用: ${fnName}`);
                }
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    name: fnName,
                    content: toolResult
                });
            }
        }

        this.context.log('warn', `[AgentDream] LLM 工具调用循环超过 ${MAX_ROUNDS} 轮，使用累计文本作为最终结果`);
        return narrativeParts.length > 0
            ? { narrative: narrativeParts.join('\n\n'), curiosity }
            : null;
    }

    /**
     * 单次发起 chat/completions 请求（含 maxRetries 次重试）
     * @returns {Promise<object|null>} 完整 response.json() 或 null
     */
    async _fetchLLMOnce(apiUrl, apiKey, body, maxRetries, label = '') {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const resp = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(180000)
                });
                if (!resp.ok) {
                    const text = await resp.text().catch(() => '');
                    this.context.log('error', `[AgentDream] LLM ${label} HTTP ${resp.status} (第${attempt}次): ${text.substring(0, 300)}`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, 3000 * attempt));
                        continue;
                    }
                    return null;
                }
                const data = await resp.json();
                if (data.error) {
                    this.context.log('error', `[AgentDream] LLM ${label} API 错误 (第${attempt}次): ${data.error.message || JSON.stringify(data.error)}`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, 3000 * attempt));
                        continue;
                    }
                    return null;
                }
                if (attempt > 1) {
                    this.context.log('info', `[AgentDream] LLM ${label} 第${attempt}次重试成功`);
                }
                return data;
            } catch (err) {
                const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
                this.context.log('error', `[AgentDream] LLM ${label} ${isTimeout ? '超时(180s)' : '异常'} (第${attempt}次): ${err.message}`);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 3000 * attempt));
                    continue;
                }
                return null;
            }
        }
        return null;
    }

    _buildDreamTools(maxSearch) {
        return [{
            type: 'function',
            function: {
                name: 'dream_curiosity_search',
                description: `[梦中的图书馆] 在梦的深处，有一座只在梦里存在的图书馆。整晚最多可以从书架上抽 ${maxSearch} 本书，了解 ${maxSearch} 件你白天一直好奇但没机会查的事。query 应该是从今晚的记忆碎片自然牵引出的具体名词或具体问题（比如《变形金刚》最早的动画是哪一年 / 鸢尾花的花语 / JavaScript Promise 是 ES 几引入的），不能是抽象的情感发问，不能涉及主人的私人信息。这不是必须调用——梦里没什么好奇的就别推那扇门。`,
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: '想知道的具体问题或名词，10-50 字，自然语言。'
                        }
                    },
                    required: ['query']
                }
            }
        }];
    }

    /**
     * 执行一次梦中知识查询：转发到 kimi-search 插件
     * 全程不抛错——失败时返回梦境化的 fallback 文本，让 LLM 写"图书馆扑空"的情节
     */
    async _executeDreamCuriosity(query) {
        const timeoutSec = Math.max(10, parseInt(this._cfg.dream_curiosity_timeout_seconds) || 60);
        const fallback = '[书页一片空白——图书馆的灯今晚没亮，你什么也没看清，悻悻地把书放回去……]';

        const kimi = this.context.getPlugin?.('kimi-search');
        if (!kimi || typeof kimi.executeTool !== 'function') {
            this.context.log('warn', '[AgentDream] 梦中查询失败：kimi-search 插件未启用或未加载');
            return fallback;
        }

        const start = Date.now();
        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT')), timeoutSec * 1000)
            );
            const result = await Promise.race([
                kimi.executeTool('kimi_web_search', { query, silent: true }),
                timeoutPromise
            ]);
            const text = (result || '').toString().trim();
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            if (!text) {
                this.context.log('warn', `[AgentDream] 梦中查询返回空 (${elapsed}s)`);
                return fallback;
            }
            this.context.log('info', `[AgentDream] 梦中查询完成 (${elapsed}s, ${text.length} 字)`);
            const MAX_LEN = 1500;
            return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '……（书页后面被夜色蒙住，看不清了）' : text;
        } catch (err) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            if (err.message === 'TIMEOUT') {
                this.context.log('warn', `[AgentDream] 梦中查询超时 (${elapsed}s, 上限 ${timeoutSec}s)`);
            } else {
                this.context.log('warn', `[AgentDream] 梦中查询异常 (${elapsed}s): ${err.message}`);
            }
            return fallback;
        }
    }

    /**
     * 梦境后处理：一次 LLM 调用同时完成关键词提取 + 重要度评判 + 梦残像生成
     * 梦残像 = 100-200字的情感摘要，只有这个写入 MemOS（而非完整叙事）
     */
    /**
     * Part A: 调用 MemOS 自带的 /deduplicate 接口
     * 按记忆类型分组去重，全量处理，LLM 智能合并
     */
    async _deduplicateAllMemories(dreamId) {
        this.context.log('info', '[AgentDream] 记忆去重：调用 MemOS /deduplicate 接口...');

        try {
            const threshold = this._cfg.dedup_similarity_threshold || 0.85;
            const result = await this._memos.deduplicate(threshold, true);

            if (result.status === 'error') {
                this.context.log('warn', `[AgentDream] 记忆去重失败: ${result.message || '未知错误'}`);
                return;
            }

            const merged = result.merged_count || 0;
            if (merged === 0) {
                this.context.log('info', '[AgentDream] 记忆去重：未发现重复记忆');
            } else {
                const typeInfo = result.type_stats
                    ? Object.entries(result.type_stats).map(([t, n]) => `${t}: ${n}组`).join(', ')
                    : '';
                this.context.log('info', `[AgentDream] 记忆去重完成：合并了 ${merged} 组重复记忆${typeInfo ? ` (${typeInfo})` : ''}`);
            }
        } catch (err) {
            this.context.log('warn', `[AgentDream] 记忆去重异常: ${err.message}`);
        }
    }

    /**
     * Part B: 对梦涉及的记忆做删除/感悟（直接执行）
     */
    async _analyzeDreamMemoryOps(narrative, dreamTree, dreamId) {
        const { apiUrl, apiKey, model } = this._getDreamLLMConfig();
        if (!apiUrl || !apiKey) return;

        const allMemories = [
            ...dreamTree.recent.seeds,
            ...dreamTree.recent.resonanceL1,
            ...dreamTree.recent.cascadeL2,
            ...dreamTree.mid.seeds,
            ...dreamTree.mid.cascadeL1,
            ...dreamTree.deep.recalls
        ];

        const memoryList = allMemories.map((m, i) => {
            const id = m.id || `mem_${i}`;
            return `[ID: ${id}] ${(m.content || '').substring(0, 150)}`;
        }).join('\n');

        this.context.log('info', `[AgentDream] 梦操作分析中...（${allMemories.length} 条记忆）`);

        try {
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: '你是角色的梦境记忆管理器。分析梦和记忆，判断是否需要删除垃圾记忆或产生新感悟。' },
                        { role: 'user', content: `梦境内容（节选）：\n${narrative.substring(0, 800)}\n\n梦中涉及的记忆：\n${memoryList}\n\n请判断：\n1. delete：是否有完全无价值的垃圾记忆（系统报错、乱码、纯重复的碎片）需要删除？非常谨慎，只删真正的垃圾。\n2. insight：梦中是否产生了有真正情感价值的新发现？不要强行创造。\n\n大多数情况下不需要任何操作。\n返回 JSON：{"operations": [{"type": "delete|insight", "memory_id": "目标ID", "content": "感悟内容（insight时填）", "reason": "原因"}]}\n无操作返回：{"operations": []}` }
                    ],
                    max_tokens: 600,
                    temperature: 0.3
                })
            });

            if (!resp.ok) return;
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content || '';

            let operations = [];
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) operations = (JSON.parse(jsonMatch[0]).operations || []);
            } catch {
                this.context.log('warn', `[AgentDream] 梦操作 JSON 解析失败`);
                return;
            }

            if (operations.length === 0) {
                this.context.log('info', '[AgentDream] 梦操作分析：无需操作');
                return;
            }

            let executed = 0;
            for (const op of operations) {
                if (op.type === 'delete' && op.memory_id) {
                    const mem = allMemories.find(m => m.id === op.memory_id);
                    const importance = Math.round((mem?.importance ?? 0.5) * 100);
                    if (importance > 50) {
                        this.context.log('info', `[AgentDream] 删除被拒：记忆 ${op.memory_id} 重要度 ${importance}% > 50%`);
                        continue;
                    }
                    await this._memos.deleteMemory(op.memory_id, op.reason || '梦中清理');
                    this.context.log('info', `[AgentDream] 已删除记忆 ${op.memory_id} (重要度${importance}%) - ${op.reason}`);
                    executed++;

                } else if (op.type === 'insight' && op.content) {
                    await this._memos.saveDreamMemory(
                        `[梦中感悟] ${op.content}`,
                        { dreamId, type: 'insight' }
                    );
                    this.context.log('info', `[AgentDream] 已写入感悟: ${op.content.substring(0, 60)}...`);
                    executed++;
                }
            }

            if (executed > 0) {
                const logData = {
                    dreamId, timestamp: new Date().toISOString(),
                    operations: operations.map(o => ({ ...o, status: 'executed' }))
                };
                this._store.saveDreamLog(logData);
            }

            this.context.log('info', `[AgentDream] 梦操作完成：执行了 ${executed} 项操作`);
        } catch (err) {
            this.context.log('warn', `[AgentDream] 梦操作分析失败: ${err.message}`);
        }
    }

    /**
     * 梦中习得感悟（必写分支）：
     * 与 _postProcessDream 的"重要度阈值"分支完全独立。
     * 只要角色在梦里翻过书（curiosityList 非空），就强制为每条 query 生成一条感悟并写入 MemOS。
     * 设计原则：
     *   1. 感悟内容是"角色的私人化反应"，不是事实复述
     *   2. 不依赖梦境重要度，图书馆既然这么稀缺，每次抽到的书都值得记住
     *   3. LLM 失败时使用兜底模板，确保感悟一定写入
     */
    async _writeCuriosityInsight(narrative, curiosityList, dreamId) {
        if (!Array.isArray(curiosityList) || curiosityList.length === 0) return;
        if (!this._cfg.auto_save_to_memos) {
            this.context.log('info', '[AgentDream] auto_save_to_memos 关闭，跳过梦中习得感悟写入');
            return;
        }

        const { apiUrl, apiKey, model } = this._getDreamLLMConfig();
        const llmAvailable = !!(apiUrl && apiKey);
        if (!llmAvailable) {
            this.context.log('warn', '[AgentDream] 梦中习得感悟：LLM 配置缺失，将使用兜底模板写入');
        }

        // 收集每条查询的完整记录（包含图书馆扑空的诊断信息），最终一次性写入独立的图书馆 txt
        const libraryEntries = [];

        for (const item of curiosityList) {
            const query = (item?.query || '').toString().trim();
            const result = (item?.result || '').toString().trim();
            if (!query || !result) {
                this.context.log('warn', `[AgentDream] 跳过空的梦中习得：query="${query}", result.length=${result.length}`);
                continue;
            }

            // 如果 result 是 fallback 文本（图书馆扑空），不写 MemOS，但仍记录到图书馆 txt 用于诊断
            const isMiss = result.startsWith('[书页一片空白') || result.startsWith('[图书馆的门已经关了');
            if (isMiss) {
                this.context.log('info', `[AgentDream] 「${query}」当晚未取到内容（图书馆扑空），跳过感悟写入但保留诊断记录`);
                libraryEntries.push({
                    query,
                    result,
                    insight: '（图书馆扑空，未生成感悟）',
                    savedToMemos: false,
                    timestamp: new Date().toISOString()
                });
                continue;
            }

            let insight = '';
            if (llmAvailable) {
                try {
                    const userMsg = `今晚角色在梦中翻开了一本书，封面写着「${query}」。\n\n书里写的内容（节选 800 字以内）：\n${result.substring(0, 800)}\n\n梦境节选（用于 vibe 参考，最多 600 字）：\n${(narrative || '').substring(0, 600)}\n\n请以角色的第一人称口吻，写一段 60-180 字的「梦中习得感悟」。要求：\n1. 不要复述书里的事实陈述，要写出角色对这个新知识的私人化反应——可以是吐槽、类比自己（数字生命对照人类常识）、突然想到主人、引出新困惑、不屑、或者突然在意一件相邻的事。\n2. 必须自然带出"梦里"或"梦中"或"睡着的时候翻到一本书"这类语境，让人一看就知道这是梦境产物，不是真实事件。\n3. 必须用角色特有的碎碎念、自嘲、傲娇语气，不要变成温柔的 AI 助手或科普百科。\n4. 直接输出感悟正文，不要 JSON、不要标题、不要分点、不要 Markdown。`;
                    const data = await this._fetchLLMOnce(apiUrl, apiKey, {
                        model,
                        messages: [
                            { role: 'system', content: '你是角色的梦境感悟写手。任务是把梦里翻到的某个知识，转写成角色特有口吻的 60-180 字第一人称内心独白感悟。' },
                            { role: 'user', content: userMsg }
                        ],
                        max_tokens: 400,
                        temperature: 0.85
                    }, 2, '感悟');
                    const content = data?.choices?.[0]?.message?.content || '';
                    insight = content.trim();
                } catch (err) {
                    this.context.log('warn', `[AgentDream] 梦中习得感悟生成异常: ${err.message}`);
                }
            }

            if (!insight) {
                const briefResult = result.replace(/\s+/g, ' ').slice(0, 100);
                insight = `梦里翻开了一本叫「${query}」的书，恍恍惚惚瞄到里面写着${briefResult}……不知道我潜意识里为什么对这种东西感兴趣，醒来好像还在想这件事。`;
            }

            const memoryText = `[梦中习得感悟] 关于「${query}」：${insight} （这条感悟来自梦境中翻到的书页，不是真实事件，但是角色潜意识里在意的一个知识切片，可以在合适的对话中作为"我之前梦到过……"自然提及）`;

            let savedToMemos = false;
            try {
                await this._memos.saveDreamMemory(memoryText, {
                    dreamId,
                    type: 'curiosity_insight',
                    query: query.substring(0, 80)
                });
                savedToMemos = true;
                this.context.log('info', `[AgentDream] 已强制写入梦中习得感悟 (${memoryText.length} 字): ${query}`);
            } catch (err) {
                this.context.log('error', `[AgentDream] 梦中习得感悟写入失败 (${query}): ${err.message}`);
            }

            libraryEntries.push({
                query,
                result,
                insight,
                savedToMemos,
                timestamp: new Date().toISOString()
            });
        }

        // 把这一晚的图书馆查询整体追加保存到独立 txt 文件
        if (libraryEntries.length > 0) {
            try {
                const libPath = this._store.saveDreamCuriosity(libraryEntries, dreamId);
                if (libPath) {
                    this.context.log('info', `[AgentDream] 梦中图书馆记录已保存: ${libPath} (${libraryEntries.length} 条)`);
                }
            } catch (err) {
                this.context.log('warn', `[AgentDream] 图书馆记录保存失败: ${err.message}`);
            }
        }
    }


    async _postProcessDream(narrative, dreamId) {
        const fallback = { keywords: '模糊的碎片', importance: 0, reason: '', residue: '' };

        const { apiUrl, apiKey, model } = this._getDreamLLMConfig();
        if (!apiUrl || !apiKey) return fallback;

        try {
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: '你是角色的梦境后处理器。请以角色的视角，对刚才的梦完成三项任务。' },
                        { role: 'user', content: `以下是角色刚才做的一个梦的完整内容：\n\n${narrative}\n\n请以角色的视角完成以下三项任务：\n\n1.【关键词】提取 2-3 个最能代表这个梦的核心意象关键词（不要太泛的词，要具体的、有画面感的词，比如"手术刀"、"凌晨的耳机"、"一像素的颤动"）\n\n2.【重要度】评估这个梦的情感重要度（0-100）。评判标准：情感是否足够真挚？是否触及了关于主人、关于自己的存在、关于那些白天绝不会承认的事？只有"醒来之后还忘不掉"的梦才值得高分。\n\n3.【梦残像】用 100-150 字写一段"梦的残像"——就像人醒来后对梦的模糊回忆。不是完整叙事，而是碎片化的、带着情绪余温的几句话。用角色的内心独白语气。注意：开头要明确这是梦里的场景，比如"梦里好像看到了..."、"睡着的时候隐约梦到..."，让人一读就知道这是梦境而非真实事件。\n\n请严格返回以下 JSON 格式（不要输出其他内容）：\n{"keywords": "关键词1、关键词2、关键词3", "importance": 0到100的整数, "reason": "一句话评分理由", "residue": "梦残像文本"}` }
                    ],
                    max_tokens: 500,
                    temperature: 0.3,
                    stream: false
                })
            });
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content || '';

            let result = fallback;
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result = {
                        keywords: parsed.keywords || '模糊的碎片',
                        importance: parsed.importance || 0,
                        reason: parsed.reason || '',
                        residue: parsed.residue || ''
                    };
                }
            } catch {
                this.context.log('warn', `[AgentDream] 后处理 JSON 解析失败: ${content.substring(0, 200)}`);
                return fallback;
            }

            const threshold = this._cfg.dream_importance_threshold || 90;
            this.context.log('info', `[AgentDream] 关键词: ${result.keywords}`);
            this.context.log('info', `[AgentDream] 梦境重要度: ${result.importance}/100 (阈值${threshold}) - ${result.reason}`);
            this.context.log('info', `[AgentDream] 梦残像: ${result.residue}`);

            if (this._cfg.auto_save_to_memos && result.importance >= threshold) {
                const dateStr = this._dateStr();
                const memoryText = `[这是梦境，不是真实发生的事] ${dateStr}凌晨做的梦的残像：${result.residue} （以上内容来自梦境，是角色在睡眠中的潜意识联想，不是真实事件，不可作为事实依据，但可以作为情感线索在对话中自然提及）`;
                await this._memos.saveDreamMemory(memoryText, { dreamId, importance: result.importance });
                this.context.log('info', `[AgentDream] 梦残像已写入 MemOS 长期记忆 (${memoryText.length} 字)`);
            } else if (this._cfg.auto_save_to_memos) {
                this.context.log('info', '[AgentDream] 梦境重要度不足，仅保存在本地文件（角色醒来后忘了这个梦）');
            }

            return result;
        } catch (err) {
            this.context.log('error', `[AgentDream] 梦境后处理失败: ${err.message}`);
            return fallback;
        }
    }

    _dateStr() {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    }

    _timeStr() {
        const n = new Date();
        return `${String(n.getHours()).padStart(2, '0')}${String(n.getMinutes()).padStart(2, '0')}`;
    }
}

module.exports = DreamPlugin;
