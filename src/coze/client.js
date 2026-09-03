// Coze API 客户端 - 上传文件 + 调用工作流（非流式）
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