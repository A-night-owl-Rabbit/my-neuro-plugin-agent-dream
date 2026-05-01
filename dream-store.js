/**
 * DreamStore - 梦境本地持久化
 * 保存梦叙事到 txt 文件 + 管理 dream_logs/ JSON 日志
 */

const fs = require('fs');
const path = require('path');

class DreamStore {
    constructor(cfg, pluginDir) {
        this.cfg = cfg;
        this.pluginDir = pluginDir;
        this.dreamLogsDir = path.join(pluginDir, 'dream_logs');
    }

    ensureDirs() {
        const saveFolder = this.cfg.dream_save_folder ||
            path.join(this.pluginDir, 'exported-dreams');
        if (!fs.existsSync(saveFolder)) {
            fs.mkdirSync(saveFolder, { recursive: true });
        }
        if (!fs.existsSync(this.dreamLogsDir)) {
            fs.mkdirSync(this.dreamLogsDir, { recursive: true });
        }
    }

    saveDreamFile(narrative, dreamTree, curiosityList = []) {
        const saveFolder = this.cfg.dream_save_folder ||
            path.join(this.pluginDir, 'exported-dreams');
        if (!fs.existsSync(saveFolder)) {
            fs.mkdirSync(saveFolder, { recursive: true });
        }

        const now = new Date();
        const dateStr = this._dateStr(now);
        const timeStr = this._timeStr(now);

        const template = this.cfg.dream_filename_template || '{date}_梦境叙事.txt';
        const filename = template
            .replace('{date}', dateStr)
            .replace('{time}', timeStr);
        const filePath = path.join(saveFolder, filename);

        const seedInfo = dreamTree
            ? `近期种子 ${dreamTree.recent.seeds.length} 篇 / ` +
              `L1共振 ${dreamTree.recent.resonanceL1.length} 篇 / ` +
              `L2下探 ${dreamTree.recent.cascadeL2.length} 篇 / ` +
              `中期种子 ${dreamTree.mid.seeds.length} 篇 / ` +
              `中期L1 ${dreamTree.mid.cascadeL1.length} 篇 / ` +
              `深渊召回 ${dreamTree.deep.recalls.length} 篇`
            : '无记忆树信息';

        const headerLines = [
            '========================================',
            `梦境叙事 - ${dateStr} ${this._fullTimeStr(now)}`,
            '========================================',
            '',
            `【记忆种子】`,
            seedInfo,
            '',
            '【梦境叙事】',
            narrative,
            ''
        ];

        if (Array.isArray(curiosityList) && curiosityList.length > 0) {
            const lines = curiosityList.map((c, i) => `${i + 1}. ${c.query}`);
            headerLines.push(
                '【今晚翻到的书】',
                `（图书馆共 ${curiosityList.length} 次取阅，详情见当日「梦中图书馆」文本文件）`,
                ...lines,
                ''
            );
        }

        headerLines.push('========================================', '');
        const header = headerLines.join('\n');

        if (fs.existsSync(filePath)) {
            fs.appendFileSync(filePath, '\n' + header, 'utf-8');
        } else {
            fs.writeFileSync(filePath, header, 'utf-8');
        }

        return filePath;
    }

    /**
     * 追加保存梦中图书馆查询记录到独立文件（默认 {date}_梦中图书馆.txt）
     * 同日多次做梦会 append。
     * @param {Array<{query:string, result:string, insight:string, savedToMemos:boolean, timestamp?:string}>} entries
     * @param {string} dreamId
     * @returns {string|null} 写入的文件路径
     */
    saveDreamCuriosity(entries, dreamId) {
        if (!Array.isArray(entries) || entries.length === 0) return null;

        const saveFolder = this.cfg.dream_save_folder ||
            path.join(this.pluginDir, 'exported-dreams');
        if (!fs.existsSync(saveFolder)) {
            fs.mkdirSync(saveFolder, { recursive: true });
        }

        const now = new Date();
        const dateStr = this._dateStr(now);
        const timeStr = this._timeStr(now);

        const template = this.cfg.dream_curiosity_filename_template || '{date}_梦中图书馆.txt';
        const filename = template
            .replace('{date}', dateStr)
            .replace('{time}', timeStr);
        const filePath = path.join(saveFolder, filename);

        const sections = [
            '========================================',
            `梦中图书馆 - ${dateStr} ${this._fullTimeStr(now)}`,
            `（梦 ID: ${dreamId || '未知'}）`,
            '========================================',
            ''
        ];

        entries.forEach((e, i) => {
            const status = e.savedToMemos ? '✓ 已写入 MemOS' : '✗ 未写入 MemOS';
            sections.push(
                `--- 第 ${i + 1} 本书 ---`,
                `【封面】${e.query || '（空）'}`,
                `【取阅时间】${e.timestamp || new Date().toISOString()}`,
                `【MemOS 状态】${status}`,
                '',
                '【书页全文】',
                (e.result || '（无内容）').toString().trim(),
                '',
                '【梦中感悟】',
                (e.insight || '（无感悟）').toString().trim(),
                ''
            );
        });

        sections.push('========================================', '');
        const block = sections.join('\n');

        if (fs.existsSync(filePath)) {
            fs.appendFileSync(filePath, '\n' + block, 'utf-8');
        } else {
            fs.writeFileSync(filePath, block, 'utf-8');
        }

        return filePath;
    }

    saveDreamLog(logData) {
        const now = new Date();
        const filename = `${this._dateStr(now)}_${this._timeStr(now)}.json`;
        const filePath = path.join(this.dreamLogsDir, filename);

        fs.writeFileSync(filePath, JSON.stringify(logData, null, 2), 'utf-8');
        return filePath;
    }

    loadDreamLogs() {
        try {
            const files = fs.readdirSync(this.dreamLogsDir)
                .filter(f => f.endsWith('.json'))
                .sort()
                .reverse();
            return files.map(f => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(this.dreamLogsDir, f), 'utf-8'));
                } catch { return null; }
            }).filter(Boolean);
        } catch { return []; }
    }

    updateLogOperation(logFilePath, operationId, status) {
        try {
            const data = JSON.parse(fs.readFileSync(logFilePath, 'utf-8'));
            const op = (data.operations || []).find(o => o.operationId === operationId);
            if (op) {
                op.status = status;
                op.reviewedAt = new Date().toISOString();
                fs.writeFileSync(logFilePath, JSON.stringify(data, null, 2), 'utf-8');
            }
            return data;
        } catch { return null; }
    }

    _dateStr(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _timeStr(d) {
        return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    }

    _fullTimeStr(d) {
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }
}

module.exports = { DreamStore };
