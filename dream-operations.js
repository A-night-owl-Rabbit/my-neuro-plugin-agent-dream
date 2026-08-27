/**
 * DreamOperations - 梦操作处理
 * 合并(DiaryMerge) / 归档(DiaryArchive) / 感悟(DreamInsight)
 * 所有操作写入 JSON 日志，待审批后执行
 */

class DreamOperations {
    constructor(memos, store, cfg) {
        this.memos = memos;
        this.store = store;
        this.cfg = cfg;
    }

    async processMerge(params) {
        const { sourceMemoryIds, newContent, reason } = params;
        if (!sourceMemoryIds?.length || !newContent) {
            return { status: 'error', error: '合并操作需要 sourceMemoryIds 和 newContent' };
        }

        return {
            type: 'merge',
            operationId: `op-merge-${Date.now()}`,
            sourceMemoryIds,
            newContent,
            reason: reason || '',
            status: 'pending_review'
        };
    }

    async processDelete(params) {
        return this.processArchive(params);
    }

    async processArchive(params) {
        const { memoryId, reason, content, importance } = params;
        if (!memoryId) {
            return { status: 'error', error: '归档操作需要 memoryId' };
        }

        const impPercent = Math.round((importance ?? 0.5) * 100);
        const threshold = this.cfg.archive_importance_threshold ?? this.cfg.delete_importance_threshold ?? 50;
        if (impPercent > threshold) {
            return {
                type: 'archive',
                operationId: `op-archive-${Date.now()}`,
                memoryId,
                reason: reason || '',
                status: 'rejected_by_importance',
                importance: impPercent,
                message: `重要度 ${impPercent}% > 阈值 ${threshold}%，拒绝归档`
            };
        }

        return {
            type: 'archive',
            operationId: `op-archive-${Date.now()}`,
            memoryId,
            content: content || '',
            reason: reason || '',
            importance: impPercent,
            status: 'approved'
        };
    }

    async processInsight(params) {
        const { insightContent, referenceMemoryIds } = params;
        if (!insightContent) {
            return { status: 'error', error: '感悟操作需要 insightContent' };
        }

        return {
            type: 'insight',
            operationId: `op-insight-${Date.now()}`,
            insightContent,
            referenceMemoryIds: referenceMemoryIds || [],
            status: 'pending_review'
        };
    }

    async executeApproved(operation) {
        switch (operation.type) {
            case 'merge': {
                const addResult = await this.memos.saveDreamMemory(
                    `[记忆合并] ${operation.newContent}`,
                    { sourceIds: operation.sourceMemoryIds }
                );
                for (const id of operation.sourceMemoryIds) {
                    await this.memos.archiveMemory(id, '梦中记忆合并 - 已合并到新条目');
                }
                return { status: 'executed', type: 'merge', result: addResult };
            }

            case 'delete':
            case 'archive': {
                const result = await this.memos.archiveMemory(
                    operation.memoryId,
                    operation.reason || '梦中归档 - 管理员已审批'
                );
                return { status: 'executed', type: 'archive', result };
            }

            case 'insight': {
                const result = await this.memos.saveDreamMemory(
                    `[梦感悟] ${operation.insightContent}`,
                    { referenceIds: operation.referenceMemoryIds }
                );
                return { status: 'executed', type: 'insight', result };
            }

            default:
                return { status: 'error', error: `未知操作类型: ${operation.type}` };
        }
    }
}

module.exports = { DreamOperations };
