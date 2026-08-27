const axios = require('axios');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

class MemosAdapter {
    constructor(apiUrl, cfg) {
        this.apiUrl = apiUrl;
        this.userId = 'feiniu_default';
        this.threshold = 0.4;
    }

    /**
     * 通用重试包装器
     * @param {string} label - 操作名称（用于日志）
     * @param {Function} fn - 要执行的异步函数
     * @param {number} retries - 最大重试次数
     */
    async _withRetry(label, fn, retries = MAX_RETRIES) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
                const isNetwork = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND';
                const tag = isTimeout ? '超时' : isNetwork ? '连接失败' : '错误';

                if (attempt < retries) {
                    const delay = RETRY_DELAY_MS * attempt;
                    console.warn(`[MemosAdapter] ${label} ${tag}（第${attempt}次），${delay}ms 后重试: ${err.message}`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    console.error(`[MemosAdapter] ${label} ${tag}（已重试${retries}次，放弃）: ${err.message}`);
                    throw err;
                }
            }
        }
    }

    async isAvailable() {
        try {
            const { data } = await axios.get(`${this.apiUrl}/health`, { timeout: 3000 });
            return data.status === 'healthy';
        } catch { return false; }
    }

    async semanticSearch(query, topK = 5) {
        try {
            return await this._withRetry(`search(${query.substring(0, 20)}...)`, async () => {
                const { data } = await axios.post(`${this.apiUrl}/search`, {
                    query,
                    top_k: topK,
                    user_id: this.userId,
                    similarity_threshold: this.threshold
                }, { timeout: 10000 });
                return (data.memories || []).map(m => this._normalize(m));
            });
        } catch {
            return [];
        }
    }

    async getAllMemories(targetCount = 500) {
        const queries = [
            '主人 对话 日常 记忆',
            '游戏 音乐 视频 娱乐',
            '工作 代码 开发 系统',
            '情感 心情 关心 陪伴',
            '食物 生活 习惯 爱好',
            '学习 知识 技术 问题',
            '记忆 历史 过去 回忆',
            '肥牛 主人 聊天 互动',
            '时间 事件 计划 任务',
            '朋友 关系 社交 网络',
        ];

        const seen = new Set();
        const all = [];

        for (const q of queries) {
            if (all.length >= targetCount) break;
            try {
                const { data } = await axios.post(`${this.apiUrl}/search`, {
                    query: q,
                    top_k: 50,
                    user_id: this.userId,
                    similarity_threshold: 0.0
                }, { timeout: 10000 });

                for (const m of (data.memories || [])) {
                    const normalized = this._normalize(m);
                    const key = normalized.id || normalized.content.substring(0, 80);
                    if (!seen.has(key)) {
                        seen.add(key);
                        all.push(normalized);
                    }
                }
            } catch { /* continue */ }
        }

        console.log(`[MemosAdapter] getAllMemories: ${all.length} 条（目标 ${targetCount}）`);
        return all;
    }

    async getMemoriesByTimeRange(minDaysAgo, maxDaysAgo, limit = 20) {
        const all = await this.getAllMemories(limit * 3);
        const now = Date.now();
        const minMs = minDaysAgo * 86400000;
        const maxMs = maxDaysAgo * 86400000;

        return all
            .filter(m => {
                if (!m.timestamp) return false;
                const age = now - new Date(m.timestamp).getTime();
                return age >= minMs && age <= maxMs;
            })
            .slice(0, limit);
    }

    async saveDreamMemory(content, metadata = {}) {
        try {
            return await this._withRetry('saveDreamMemory', async () => {
                const { data } = await axios.post(`${this.apiUrl}/add`, {
                    messages: [{ role: 'assistant', content }],
                    user_id: this.userId
                }, { timeout: 20000 });
                return data;
            });
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    async archiveMemory(memoryId, reason = '') {
        try {
            return await this._withRetry(`archiveMemory(${memoryId})`, async () => {
                const { data } = await axios.post(`${this.apiUrl}/memory/feedback`, {
                    memory_id: memoryId,
                    feedback_type: 'archive',
                    reason,
                    user_id: this.userId
                }, { timeout: 15000 });
                return data;
            });
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    async deleteMemory(memoryId, reason = '') {
        // 向后兼容旧调用名；梦系统现在只归档，不软删除。
        return this.archiveMemory(memoryId, reason);
    }

    async correctMemory(memoryId, newContent, reason = '') {
        try {
            return await this._withRetry(`correctMemory(${memoryId})`, async () => {
                const { data } = await axios.post(`${this.apiUrl}/memory/feedback`, {
                    memory_id: memoryId,
                    feedback_type: 'correct',
                    correction: newContent,
                    reason,
                    user_id: this.userId
                }, { timeout: 15000 });
                return data;
            });
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    async deduplicate(threshold = 0.85, byType = true) {
        try {
            return await this._withRetry('deduplicate', async () => {
                const { data } = await axios.post(`${this.apiUrl}/deduplicate`, null, {
                    params: { threshold, by_type: byType },
                    timeout: 600000
                });
                return data;
            }, 2);
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    _normalize(mem) {
        const content = typeof mem === 'string' ? mem : (mem.content || '');
        const pl = mem?.payload || {};
        const timestamp = mem.created_at || mem.timestamp || pl.created_at || pl.timestamp || null;
        const importance = mem.importance ?? pl.importance ?? null;
        return {
            id: mem.id || null,
            content,
            timestamp,
            score: mem.score || 0,
            importance,
            raw: mem
        };
    }
}

module.exports = { MemosAdapter };
