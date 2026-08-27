const { ipcRenderer } = require('electron');

const container = document.getElementById('content');

let dreamLogs = [];

ipcRenderer.on('dream:load-logs', (_, logs) => {
    dreamLogs = logs || [];
    render();
});

function render() {
    if (dreamLogs.length === 0) {
        container.innerHTML = '<div class="empty">暂无梦境日志</div>';
        return;
    }

    container.innerHTML = dreamLogs.map((log, logIdx) => {
        const ops = (log.operations || []).map((op, opIdx) => {
            const typeLabels = { merge: '合并', delete: '归档', archive: '归档', insight: '感悟' };
            const typeClass = op.type || 'insight';
            const statusClass = op.status === 'pending_review' ? 'pending'
                : op.status?.includes('approved') ? 'approved' : 'rejected';
            const statusLabel = op.status === 'pending_review' ? '待审批'
                : op.status?.includes('approved') ? '已批准'
                : op.status?.includes('rejected') ? '已拒绝' : op.status;

            let detail = '';
            if (op.type === 'merge') {
                detail = `源记忆: ${(op.sourceMemoryIds || []).join(', ')}\n合并内容: ${op.newContent || ''}`;
            } else if (op.type === 'delete' || op.type === 'archive') {
                detail = `记忆ID: ${op.memoryId || ''}\n归档原因: ${op.reason || ''}\n内容: ${op.content || ''}`;
            } else if (op.type === 'insight') {
                detail = `感悟: ${op.insightContent || ''}`;
            }

            const canAct = op.status === 'pending_review';

            return `<div class="op-card">
                <div class="op-header">
                    <span class="op-type ${typeClass}">${typeLabels[op.type] || op.type}</span>
                    <span class="op-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="op-content">${escapeHtml(detail)}</div>
                ${canAct ? `<div class="op-actions">
                    <button class="btn btn-approve" onclick="approve(${logIdx}, ${opIdx})">批准</button>
                    <button class="btn btn-reject" onclick="reject(${logIdx}, ${opIdx})">拒绝</button>
                </div>` : ''}
            </div>`;
        }).join('');

        return `<div class="dream-card">
            <h3>${log.dreamId || '未知梦境'} - ${log.timestamp ? new Date(log.timestamp).toLocaleString('zh-CN') : ''}</h3>
            ${log.dreamNarrative ? `<div class="narrative">${escapeHtml(log.dreamNarrative)}</div>` : ''}
            ${ops || '<div class="op-content">无操作</div>'}
        </div>`;
    }).join('');
}

function approve(logIdx, opIdx) {
    const log = dreamLogs[logIdx];
    const op = log?.operations?.[opIdx];
    if (!op) return;
    ipcRenderer.send('dream:approve', { logIdx, opIdx, operation: op });
    op.status = 'approved';
    render();
}

function reject(logIdx, opIdx) {
    const log = dreamLogs[logIdx];
    const op = log?.operations?.[opIdx];
    if (!op) return;
    ipcRenderer.send('dream:reject', { logIdx, opIdx, operation: op });
    op.status = 'rejected';
    render();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

ipcRenderer.send('dream:request-logs');
