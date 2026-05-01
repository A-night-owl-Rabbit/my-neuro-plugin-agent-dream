/**
 * DreamWaveEngine - 记忆涟漪浪潮引擎
 * 移植自 VCP AgentDream 的三阶段时间线算法
 * 底层向量操作替换为 MemOS 语义搜索
 */

const INITIAL_RECENT_DAYS = 7;
const INITIAL_MID_DAYS = 90;
const RECENT_EXPAND_STEP = 7;
const RECENT_EXPAND_MAX = 30;
const MID_EXPAND_STEP = 30;
const MID_EXPAND_MAX = 180;

class DreamWaveEngine {
    constructor(memos, cfg) {
        this.memos = memos;
        this.seedCountRecent = cfg.seed_count_recent || 3;
        this.seedCountMid = cfg.seed_count_mid || 2;
        this.recallK = cfg.recall_k || 12;
    }

    async generateDreamWave() {
        console.log('[DreamWave] 开始生成记忆涟漪浪潮...');

        const available = await this.memos.isAvailable();
        if (!available) {
            console.error('[DreamWave] MemOS 不可用');
            return this._emptyTree();
        }

        // Phase 1: 近期涟漪
        const recentResult = await this._phaseRecent();

        // Phase 2: 中期回音
        const midResult = await this._phaseMid(recentResult.recentBoundary);

        // Phase 3: 深渊浪潮
        const deepResult = await this._phaseDeep(recentResult, midResult);

        const tree = {
            recent: recentResult,
            mid: midResult,
            deep: deepResult,
            totalCount: recentResult.seeds.length + recentResult.resonanceL1.length +
                recentResult.cascadeL2.length + midResult.seeds.length +
                midResult.cascadeL1.length + deepResult.recalls.length
        };

        console.log(`[DreamWave] 浪潮完成: 总计 ${tree.totalCount} 篇记忆`);
        return tree;
    }

    async _phaseRecent() {
        let boundary = INITIAL_RECENT_DAYS;
        let memories = [];

        while (memories.length < 3 && boundary <= RECENT_EXPAND_MAX) {
            memories = await this.memos.getMemoriesByTimeRange(0, boundary, 50);
            if (memories.length < 3) boundary += RECENT_EXPAND_STEP;
        }
        boundary = Math.min(boundary, RECENT_EXPAND_MAX);

        console.log(`[DreamWave] Phase 1: 近期 ${memories.length} 条记忆 (≤${boundary}天)`);

        const seeds = this._sample(memories, this.seedCountRecent);
        const l1Hits = new Map();
        const l1Dict = new Map();

        for (const seed of seeds) {
            if (!seed.content || seed.content.length < 10) continue;
            const k = this._determineK(seed.content.length);
            const recalls = await this.memos.semanticSearch(
                this._extractQuery(seed.content), k
            );

            for (const r of recalls) {
                if (r.content === seed.content) continue;
                const key = r.id || r.content.substring(0, 50);
                l1Hits.set(key, (l1Hits.get(key) || 0) + 1);
                if (!l1Dict.has(key)) l1Dict.set(key, r);
            }
        }

        let resonanceL1 = [];
        for (const [key, count] of l1Hits.entries()) {
            if (count >= 2) resonanceL1.push(l1Dict.get(key));
        }

        if (resonanceL1.length === 0 && l1Dict.size > 0) {
            resonanceL1 = Array.from(l1Dict.values())
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .slice(0, 2);
            console.log(`[DreamWave] 无共振交叉，取 Top-${resonanceL1.length} 替补`);
        } else {
            console.log(`[DreamWave] 共振桥梁 L1: ${resonanceL1.length} 篇`);
        }

        const seenPaths = new Set(seeds.map(s => s.id || s.content.substring(0, 50)));
        resonanceL1.forEach(r => seenPaths.add(r.id || r.content.substring(0, 50)));

        const cascadeL2 = [];
        for (const l1 of resonanceL1) {
            if (!l1.content || l1.content.length < 10) continue;
            const l2Recalls = await this.memos.semanticSearch(
                this._extractQuery(l1.content), 3
            );
            for (const r of l2Recalls) {
                const key = r.id || r.content.substring(0, 50);
                if (!seenPaths.has(key)) {
                    seenPaths.add(key);
                    cascadeL2.push(r);
                }
            }
        }

        console.log(`[DreamWave] L2 下探: ${cascadeL2.length} 篇`);

        return { seeds, resonanceL1, cascadeL2, recentBoundary: boundary };
    }

    async _phaseMid(recentBoundary) {
        const midStart = recentBoundary + 1;
        let midEnd = INITIAL_MID_DAYS;
        let memories = [];

        while (memories.length < 2 && midEnd <= MID_EXPAND_MAX) {
            memories = await this.memos.getMemoriesByTimeRange(midStart, midEnd, 50);
            if (memories.length < 2) midEnd += MID_EXPAND_STEP;
        }
        midEnd = Math.min(midEnd, MID_EXPAND_MAX);

        console.log(`[DreamWave] Phase 2: 中期 ${memories.length} 条记忆 (${midStart}~${midEnd}天)`);

        const seeds = this._sample(memories, this.seedCountMid);
        const seenPaths = new Set(seeds.map(s => s.id || s.content.substring(0, 50)));
        const cascadeL1 = [];

        for (const seed of seeds) {
            if (!seed.content || seed.content.length < 10) continue;
            const k = this._determineK(seed.content.length);
            const recalls = await this.memos.semanticSearch(
                this._extractQuery(seed.content), k
            );
            for (const r of recalls) {
                const key = r.id || r.content.substring(0, 50);
                if (key !== (seed.id || seed.content.substring(0, 50)) && !seenPaths.has(key)) {
                    seenPaths.add(key);
                    cascadeL1.push(r);
                }
            }
        }

        console.log(`[DreamWave] 中期 L1: ${cascadeL1.length} 篇`);
        return { seeds, cascadeL1, midBoundary: midEnd };
    }

    async _phaseDeep(recentResult, midResult) {
        const allTexts = [
            ...recentResult.resonanceL1.map(m => m.content),
            ...recentResult.cascadeL2.map(m => m.content),
            ...midResult.cascadeL1.map(m => m.content)
        ].filter(Boolean);

        if (allTexts.length === 0) {
            console.log('[DreamWave] Phase 3: 无可用文本，跳过深渊浪潮');
            return { recalls: [] };
        }

        const combined = allTexts
            .map(t => t.substring(0, 100))
            .join(' ')
            .substring(0, 500);

        console.log(`[DreamWave] Phase 3: 深渊浪潮 (${allTexts.length} 个文本片段合并查询)`);

        const deepRaw = await this.memos.semanticSearch(combined, 5);
        const recalls = deepRaw.slice(0, 3);

        console.log(`[DreamWave] 深渊召回: ${recalls.length} 篇`);
        return { recalls };
    }

    _sample(arr, count) {
        if (!arr || arr.length === 0) return [];
        if (arr.length <= count) return arr.slice();
        const shuffled = arr.slice().sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    _determineK(contentLen) {
        if (contentLen < 300) return 3;
        if (contentLen < 1200) return 5;
        return 7;
    }

    _extractQuery(content) {
        return content.substring(0, 200);
    }

    _emptyTree() {
        return {
            recent: { seeds: [], resonanceL1: [], cascadeL2: [], recentBoundary: INITIAL_RECENT_DAYS },
            mid: { seeds: [], cascadeL1: [], midBoundary: INITIAL_MID_DAYS },
            deep: { recalls: [] },
            totalCount: 0
        };
    }
}

module.exports = { DreamWaveEngine };
