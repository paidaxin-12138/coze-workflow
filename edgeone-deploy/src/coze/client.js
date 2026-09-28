// Coze API 客户端 - 上传文件 + 调用工作流（EdgeOne 版）
import { CONFIG } from '../config.js';

export async function uploadToCoze(fileData, contentType, filename) {
    const form = new FormData();
    form.append('file', new Blob([fileData], { type: contentType }), filename);
    const res = await fetch('https://api.coze.cn/v1/files/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CONFIG.KM_COZE_TOKEN}` },
        body: form
    });
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) { }
    if (!res.ok) {
        throw new Error('上传到 Coze 失败：' + ((j && (j.msg || j.error_message)) || `HTTP ${res.status}`));
    }
    return j?.data?.id || j?.file_id || j?.id;
}

// 将 Coze 文件的 file_id 转换为可公开访问的 URL（与主项目一致）
export async function getCozeFileUrl(fileId) {
    const res = await fetch('https://api.coze.cn/v1/files/retrieve', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.KM_COZE_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file_id: fileId })
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`获取 Coze 文件 URL 失败: ${err}`);
    }
    const data = await res.json();
    if (!data.data || !data.data.url) {
        throw new Error('Coze 文件响应缺少 URL');
    }
    return data.data.url;
}

export async function callCozeStream(workflowId, params, options = {}) {
    const body = { workflow_id: workflowId, parameters: params };
    if (CONFIG.COZE_APP_ID) body.app_id = CONFIG.COZE_APP_ID;
    const headers = {
        'Authorization': `Bearer ${CONFIG.KM_COZE_TOKEN}`,
        'Content-Type': 'application/json',
    };
    if (options.streamMode) headers['x-workflow-stream-mode'] = 'debug';
    const url = options.resume
        ? 'https://api.coze.cn/v1/workflow/stream_resume'
        : 'https://api.coze.cn/v1/workflow/stream_run';
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return res;
}

export async function callCozeFallback(workflowId, params) {
    const body = { workflow_id: workflowId, parameters: params };
    if (CONFIG.COZE_APP_ID) body.app_id = CONFIG.COZE_APP_ID;
    const res = await fetch('https://api.coze.cn/v1/workflow/run', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CONFIG.KM_COZE_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3600_000)
    });
    return res;
}