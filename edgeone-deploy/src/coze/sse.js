// Coze SSE 流解析器（EdgeOne 版，不变）
export async function* parseCozeSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let pending = { id: null, event: null, dataLines: [] };
    const emit = () => {
        if (pending.event === null && pending.dataLines.length === 0) return null;
        const dataStr = pending.dataLines.join('\n');
        let data = dataStr;
        try { data = JSON.parse(dataStr); } catch (_) { }
        const out = { id: pending.id, event: pending.event || 'Message', data };
        pending = { id: null, event: null, dataLines: [] };
        return out;
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (line === '') {
                const ev = emit();
                if (ev) yield ev;
            } else if (line.startsWith('id:')) pending.id = line.slice(3).trim();
            else if (line.startsWith('event:')) pending.event = line.slice(6).trim();
            else if (line.startsWith('data:')) pending.dataLines.push(line.slice(5).trim());
        }
    }
    const last = emit();
    if (last) yield last;
}

export function extractImageUrls(content) {
    if (!content) return [];
    const urls = [];
    const mdRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
    const urlRe = /https?:\/\/[^\s"'<>\\]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>\\]*)?/gi;
    let m;
    while ((m = mdRe.exec(content)) !== null) if (!urls.includes(m[1])) urls.push(m[1]);
    while ((m = urlRe.exec(content)) !== null) if (!urls.includes(m[0])) urls.push(m[0]);
    return urls;
}

export function findInterruptId(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    if (typeof obj.interrupt_id === 'string' && obj.interrupt_id) return obj.interrupt_id;
    if (typeof obj.event_id === 'string' && obj.event_id) return obj.event_id;
    for (const k of Object.keys(obj)) {
        const found = findInterruptId(obj[k], depth + 1);
        if (found) return found;
    }
    return null;
}

export function normalizeCozeEvent(eventName, payload) {
    let actualEvent = eventName;
    const dataType = payload?.type;
    if (dataType === 'node_start') actualEvent = 'node_started';
    else if (dataType === 'node_end') actualEvent = 'node_completed';
    else if (dataType === 'workflow_end') actualEvent = 'workflow_completed';
    else if (dataType === 'done' || actualEvent === 'Done') actualEvent = 'done';
    return actualEvent;
}