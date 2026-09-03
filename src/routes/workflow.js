// Kosy Mosy 设计任务中心 - 任务 CRUD + 三步工作流（非流式）
import { Router, raw as rawBody } from 'express';
import { CONFIG } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import {
    createTask, getTaskById, listTasks, updateTask, deleteTask, clearTasks
} from '../../db.js';
import { extractImageUrls } from '../coze/sse.js';
import { uploadToCoze, callCozeFallback } from '../coze/client.js';
import { fileTypeFromBuffer } from 'file-type';

const router = Router();

// ========== 任务 CRUD ==========

router.get('/', requireAuth, (req, res) => {
    res.json({ success: true, tasks: listTasks(req.user.id) });
});

router.post('/', requireAuth, (req, res) => {
    const { name, params } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: '任务名称为必填项' });
    const p = params || {};
    if (!p.user_input || !String(p.user_input).trim())
        return res.status(400).json({ success: false, error: '请输入设计概念描述' });
    const task = createTask(req.user.id, {
        name: String(name).trim(),
        params: { user_input: String(p.user_input).trim(), image_file_id: p.image_file_id || '' }
    });
    res.json({ success: true, task });
});

router.put('/:id', requireAuth, (req, res) => {
    const task = getTaskById(req.user.id, req.params.id);
    if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
    const { status, result, conversation } = req.body || {};
    const fields = {};
    if (status !== undefined) {
        if (!['queued', 'processing', 'waiting_confirm', 'done', 'failed', 'cancelled',
              'spec_ready', 'spec_confirming', 'generating_preview', 'preview_ready',
              'generating_multi', 'multi_ready', 'no_response'].includes(status))
            return res.status(400).json({ success: false, error: '无效的任务状态' });
        fields.status = status;
    }
    if (result !== undefined) fields.result = result;
    if (conversation !== undefined) fields.conversation = conversation;
    updateTask(task.id, fields);
    res.json({ success: true, task: getTaskById(req.user.id, task.id) });
});

// 清空当前用户的所有任务（必须在 /:id 之前，避免被 /:id 拦截）
router.delete('/', requireAuth, (req, res) => {
    try {
        const count = clearTasks(req.user.id);
        res.json({ success: true, deletedCount: count });
    } catch (e) {
        console.error('[DELETE /api/workflow] 清空任务失败:', e);
        res.status(500).json({ success: false, error: '清空任务失败' });
    }
});

// 兼容性路由：/clear 也映射到清空操作
router.delete('/clear', requireAuth, (req, res) => {
    try {
        const count = clearTasks(req.user.id);
        res.json({ success: true, deletedCount: count });
    } catch (e) {
        console.error('[DELETE /api/workflow/clear] 清空任务失败:', e);
        res.status(500).json({ success: false, error: '清空任务失败' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    if (!deleteTask(req.user.id, req.params.id))
        return res.status(404).json({ success: false, error: '任务不存在' });
    res.json({ success: true });
});

// ========== 三步工作流 ==========

/**
 * 调用 Coze 非流式工作流并解析结果
 */
async function callCozeWorkflow(workflowId, parameters) {
    const res = await callCozeFallback(workflowId, parameters);
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_) {
        console.warn(`[callCozeWorkflow] 工作流ID: ${workflowId}, 响应非 JSON:`, txt.slice(0, 200));
    }
    if (!res.ok) {
        const errMsg = (j && (j.msg || j.error_message)) || `HTTP ${res.status}`;
        console.error(`[callCozeWorkflow] 工作流ID: ${workflowId}, 失败: ${errMsg}`);
        throw new Error('工作流调用失败：' + errMsg);
    }
    if (!j) {
        console.error(`[callCozeWorkflow] 工作流ID: ${workflowId}, Coze 返回了非 JSON 响应`);
        throw new Error('Coze 返回了非 JSON 响应');
    }
    // Coze API 返回 HTTP 200 但业务 code 可能不为 0（工作流内部错误）
    // 例如：工作流执行超时、节点错误、参数错误等
    if (j.code !== undefined && j.code !== 0) {
        const errMsg = j.msg || j.error_message || `业务错误码 ${j.code}`;
        console.error(`[callCozeWorkflow] 工作流ID: ${workflowId}, Coze 业务错误: ${errMsg}`);
        throw new Error(`工作流 ${workflowId} 返回错误：${errMsg}`);
    }
    // 解析 Coze 非流式响应
    // data 字段可能是字符串（需 JSON.parse）或对象
    let data = j.data;
    if (data === undefined || data === null) {
        console.error(`[callCozeWorkflow] 工作流ID: ${workflowId}, 响应中 data 字段为空, 完整响应:`, JSON.stringify(j).slice(0, 500));
        throw new Error(`工作流 ${workflowId} 返回数据为空，请检查工作流配置`);
    }
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) {
            // data 不是 JSON 字符串，保持原样
        }
    }
    // 如果 data 是字符串 [object Object]，说明返回了无效数据
    if (typeof data === 'string' && data === '[object Object]') {
        throw new Error('工作流返回了无效数据格式');
    }
    return data;
}

/**
 * 第一步：规范生成
 * POST /api/workflow/step/spec
 * 输入：{ task_id, user_input }
 * 输出：{ success: true, spec: {...} }
 */
router.post('/step/spec', requireAuth, async (req, res) => {
    try {
        const { task_id, user_input } = req.body || {};
        if (!task_id) return res.status(400).json({ success: false, error: '缺少 task_id' });
        if (!user_input || !String(user_input).trim())
            return res.status(400).json({ success: false, error: '缺少设计概念描述' });

        const task = getTaskById(req.user.id, task_id);
        if (!task) return res.status(404).json({ success: false, error: '任务不存在' });

        // 更新任务状态为处理中
        updateTask(task.id, { status: 'processing', error: null });

        // 调用 Coze 规范工作流 — 输入参数: input(string)
        const parameters = { input: String(user_input).trim() };
        const data = await callCozeWorkflow(CONFIG.WF_SPEC_ID, parameters);
        console.log(`[step/spec] 工作流ID: ${CONFIG.WF_SPEC_ID} | 链接: https://www.coze.cn/workflow/${CONFIG.WF_SPEC_ID}`);
        console.log('[step/spec] 输出:', JSON.stringify(data, null, 2)?.slice(0, 500) || 'undefined');

        // 解析 spec JSON
        let spec = data;
        if (typeof data === 'string') {
            try { spec = JSON.parse(data); } catch (_) {}
        }
        // 如果 data 有 output 字段，取 output
        if (data && data.output) {
            try { spec = JSON.parse(data.output); } catch (_) { spec = data.output; }
        }
        // 如果 spec 是字符串，尝试提取 JSON
        if (typeof spec === 'string') {
            const jsonMatch = spec.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try { spec = JSON.parse(jsonMatch[0]); } catch (_) {}
            }
        }

        // 校验 spec 是否为有效的对象数据
        if (typeof spec === 'string') {
            if (spec === '[object Object]' || spec.trim() === '') {
                throw new Error('设计规范工作流返回了无效数据，请检查工作流配置');
            }
        }
        if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
            throw new Error('设计规范数据格式无效');
        }

        // 保存 spec 到 task.result（task.result 已是解析后的对象）
        const currentResult = (task.result && typeof task.result === 'object') ? { ...task.result } : {};
        currentResult.spec = spec;
        updateTask(task.id, { result: JSON.stringify(currentResult), status: 'spec_ready' });

        res.json({ success: true, spec });
    } catch (e) {
        console.error(`[step/spec] 工作流ID: ${CONFIG.WF_SPEC_ID}`, e);
        const task = req.body?.task_id ? getTaskById(req.user.id, req.body.task_id) : null;
        if (task) updateTask(task.id, { status: 'failed', error: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 第二步：预览图生成
 * POST /api/workflow/step/preview
 * 输入：{ task_id, spec: {...}, ref_file_id: "..." }
 * 输出：{ success: true, image_url: "...", file_id: "..." }
 */
router.post('/step/preview', requireAuth, async (req, res) => {
    try {
        const { task_id, spec, detail, ref_file_id } = req.body || {};
        if (!task_id) return res.status(400).json({ success: false, error: '缺少 task_id' });
        if (!spec) return res.status(400).json({ success: false, error: '缺少设计规范数据' });

        const task = getTaskById(req.user.id, task_id);
        if (!task) return res.status(404).json({ success: false, error: '任务不存在' });

        // 更新任务状态
        updateTask(task.id, { status: 'processing', error: null });

        // 优先使用前端传入的 ref_file_id，其次使用 DB 中存储的 image_file_id
        let refFileId = ref_file_id || '';
        if (!refFileId) {
            const taskParams = (task.params && typeof task.params === 'object') ? task.params : {};
            refFileId = taskParams.image_file_id || '';
        }

        // 将 spec 转为字符串传入工作流 — 输入参数: input(string), image(string), detail(string)
        const specStr = typeof spec === 'object' ? JSON.stringify(spec, null, 2) : String(spec);
        const parameters = {
            input: specStr,
            image: refFileId,
            detail: detail || ''
        };
        const data = await callCozeWorkflow(CONFIG.WF_PREVIEW_ID, parameters);
        console.log(`[step/preview] 工作流ID: ${CONFIG.WF_PREVIEW_ID} | 链接: https://www.coze.cn/workflow/${CONFIG.WF_PREVIEW_ID}`);
        console.log('[step/preview] 输出:', JSON.stringify(data, null, 2)?.slice(0, 500) || 'undefined');

        // 调试：打印 Coze 返回的完整数据结构
        console.log('[step/preview] Coze 返回的完整 data:', JSON.stringify(data, null, 2)?.slice(0, 2000) || 'undefined');

        // 提取图片 URL — 从所有可能的字段中提取
        let imageUrl = '';
        if (data && data.output) {
            const urls = extractImageUrls(data.output);
            if (urls.length > 0) imageUrl = urls[0];
        }
        if (!imageUrl && data && data.output1) {
            const urls = extractImageUrls(data.output1);
            if (urls.length > 0) imageUrl = urls[0];
        }
        if (!imageUrl && data && data.image_url) imageUrl = data.image_url;
        if (!imageUrl && typeof data === 'string') {
            const urls = extractImageUrls(data);
            if (urls.length > 0) imageUrl = urls[0];
        }
        if (!imageUrl && data && data.data) {
            const urls = extractImageUrls(JSON.stringify(data.data));
            if (urls.length > 0) imageUrl = urls[0];
        }
        // 清理 URL 周围的反引号
        if (imageUrl) {
            imageUrl = imageUrl.replace(/^`|`$/g, '');
        }

        if (!imageUrl) {
            console.error(`[step/preview] 工作流ID: ${CONFIG.WF_PREVIEW_ID}, 未找到图片URL, data结构:`, JSON.stringify(data, null, 2)?.slice(0, 1000) || 'undefined');
            // 不抛500，返回结构化失败响应让前端兜底弹窗处理
            const currentResult = (task.result && typeof task.result === 'object') ? { ...task.result } : {};
            currentResult.preview = { error: '工作流未返回图片', spec };
            updateTask(task.id, { result: JSON.stringify(currentResult), status: 'failed', error: '工作流未返回图片' });
            return res.json({ success: false, image_url: null, error: '工作流未返回图片，请检查工作流配置或稍后重试' });
        }

        // 将图片上传到 Coze 获取 file_id（用于下一步作为视觉参考）
        let fileId = '';
        try {
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
                const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                const contentType = imgRes.headers.get('content-type') || 'image/png';
                const filename = 'preview_' + Date.now() + '.png';
                fileId = await uploadToCoze(imgBuffer, contentType, filename);
            }
        } catch (uploadErr) {
            console.warn('[step/preview] 图片上传到 Coze 失败:', uploadErr.message);
            // 不阻塞流程，file_id 留空
        }

        // 解析 data.output1 中的结构化字段（product_key, packaging_key, lighting_key）
        let output1Data = null;
        if (data && typeof data.output1 === 'string' && data.output1.trim()) {
            try {
                output1Data = JSON.parse(data.output1.trim());
                if (output1Data && typeof output1Data === 'object') {
                    console.log('[step/preview] 解析 output1 成功，包含字段:', Object.keys(output1Data).join(', '));
                }
            } catch (_) {
                console.log('[step/preview] data.output1 不是 JSON，跳过');
            }
        }

        // 提取 prompt（用于第三步多角度生成）
        // 尝试从 data 中获取：data.prompt / data.preview_prompt / data.output 中的文本提取
        let prompt = '';
        if (data && typeof data.prompt === 'string' && data.prompt.trim()) {
            prompt = data.prompt.trim();
            // 检查是否为 JSON 字符串（Coze 可能返回结构化的 JSON 而非纯文本）
            if (prompt.startsWith('{') || prompt.startsWith('[')) {
                try {
                    const parsed = JSON.parse(prompt);
                    // 递归提取所有非空字符串值，排除 URL
                    const texts = [];
                    function extractTexts(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        for (const value of Object.values(obj)) {
                            if (typeof value === 'string' && value.trim()) {
                                const cleaned = value.replace(/https?:\/\/[^\s]+/g, '').trim();
                                if (cleaned.length > 5) texts.push(cleaned);
                            } else if (typeof value === 'object') {
                                extractTexts(value);
                            }
                        }
                    }
                    extractTexts(parsed);
                    if (texts.length > 0) {
                        prompt = texts.join('；');
                        console.log('[step/preview] 从 JSON prompt 中提取了文本:', prompt.slice(0, 100) + '...');
                    } else {
                        prompt = '';
                        console.log('[step/preview] JSON prompt 中未提取到有效文本，将回退到其他字段');
                    }
                } catch (_) {
                    // 不是有效 JSON，说明是截断的 JSON 或无效数据，清空 prompt 让后续字段兜底
                    prompt = '';
                    console.log('[step/preview] data.prompt 不是有效 JSON，跳过，尝试其他字段');
                }
            }
        } else if (data && typeof data.preview_prompt === 'string' && data.preview_prompt.trim()) {
            prompt = data.preview_prompt.trim();
            // 同样检查 JSON 字符串
            if (prompt.startsWith('{') || prompt.startsWith('[')) {
                try {
                    const parsed = JSON.parse(prompt);
                    const texts = [];
                    function extractTexts(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        for (const value of Object.values(obj)) {
                            if (typeof value === 'string' && value.trim()) {
                                const cleaned = value.replace(/https?:\/\/[^\s]+/g, '').trim();
                                if (cleaned.length > 5) texts.push(cleaned);
                            } else if (typeof value === 'object') {
                                extractTexts(value);
                            }
                        }
                    }
                    extractTexts(parsed);
                    if (texts.length > 0) {
                        prompt = texts.join('；');
                        console.log('[step/preview] 从 JSON preview_prompt 中提取了文本:', prompt.slice(0, 100) + '...');
                    } else {
                        prompt = '';
                    }
                } catch (_) {
                    // 不是有效 JSON，清空 prompt 让后续字段兜底
                    prompt = '';
                    console.log('[step/preview] data.preview_prompt 不是有效 JSON，跳过，尝试其他字段');
                }
            }
        } else if (data && typeof data.output1 === 'string' && data.output1.trim()) {
            // 优先使用 output1 直接作为 prompt（output1 本身包含完整提示词）
            prompt = data.output1.trim();
            // 如果是 JSON 字符串，尝试解析并提取 preview_prompt 字段
            if (prompt.startsWith('{') || prompt.startsWith('[')) {
                try {
                    const parsed = JSON.parse(prompt);
                    if (parsed && typeof parsed === 'object' && parsed.preview_prompt && typeof parsed.preview_prompt === 'string' && parsed.preview_prompt.trim()) {
                        prompt = parsed.preview_prompt.trim();
                        console.log('[step/preview] 从 data.output1 JSON 提取 preview_prompt:', prompt.slice(0, 80) + '...');
                    } else {
                        // JSON 中没有 preview_prompt，递归提取所有非空文本
                        const texts = [];
                        function extractTexts(obj) {
                            if (!obj || typeof obj !== 'object') return;
                            for (const value of Object.values(obj)) {
                                if (typeof value === 'string' && value.trim()) {
                                    const cleaned = value.replace(/https?:\/\/[^\s]+/g, '').trim();
                                    if (cleaned.length > 5) texts.push(cleaned);
                                } else if (typeof value === 'object') {
                                    extractTexts(value);
                                }
                            }
                        }
                        extractTexts(parsed);
                        if (texts.length > 0) {
                            prompt = texts.join('；');
                            console.log('[step/preview] 从 data.output1 JSON 提取文本:', prompt.slice(0, 80) + '...');
                        } else {
                            prompt = '';
                            console.log('[step/preview] data.output1 JSON 中未提取到有效文本');
                        }
                    }
                } catch (_) {
                    // 解析失败，保持原样
                    console.log('[step/preview] data.output1 不是 JSON，直接使用');
                }
            }
            if (prompt) {
                console.log('[step/preview] 从 data.output1 提取到 prompt:', prompt.slice(0, 80) + (prompt.length > 80 ? '...' : ''));
            }
        } else if (data && typeof data.output === 'string' && data.output) {
            // 如果 output 包含 prompt 文本，提取非图片 URL 部分作为 prompt
            let outputText = data.output;
            // 如果 output 是 JSON 字符串，尝试解析并递归提取文本
            try {
                const outputJson = JSON.parse(outputText);
                if (typeof outputJson === 'object' && outputJson !== null) {
                    const texts = [];
                    function extractTexts(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        for (const value of Object.values(obj)) {
                            if (typeof value === 'string' && value.trim()) {
                                const cleaned = value.replace(/https?:\/\/[^\s]+/g, '').trim();
                                if (cleaned.length > 5) texts.push(cleaned);
                            } else if (typeof value === 'object') {
                                extractTexts(value);
                            }
                        }
                    }
                    extractTexts(outputJson);
                    if (texts.length > 0) {
                        outputText = texts.join('；');
                    }
                }
            } catch (_) {
                // 不是 JSON，保持原样
            }
            const withoutUrls = outputText.replace(/https?:\/\/[^\s]+/g, '').trim();
            // 如果提取后的文本仍是 JSON 结构（以 { 或 [ 开头），说明没有有效文本，跳过
            if (withoutUrls.length > 10 && !withoutUrls.startsWith('{') && !withoutUrls.startsWith('[')) {
                prompt = withoutUrls;
            }
        }
        console.log('[step/preview] 提取到 prompt:', prompt ? prompt.slice(0, 80) + '...' : '(空)');
        if (!prompt) {
            console.log('[step/preview] Coze 返回的完整 data 结构（前1000字符）:', JSON.stringify(data, null, 2)?.slice(0, 1000) || 'undefined');
        }

        // 保存到 task.result（task.result 已是解析后的对象）
        const currentResult = (task.result && typeof task.result === 'object') ? { ...task.result } : {};
        currentResult.preview = { image_url: imageUrl, file_id: fileId, spec, prompt, output1: output1Data };
        updateTask(task.id, { result: JSON.stringify(currentResult), status: 'preview_ready' });

        res.json({ success: true, image_url: imageUrl, file_id: fileId, prompt });
    } catch (e) {
        console.error(`[step/preview] 工作流ID: ${CONFIG.WF_PREVIEW_ID}`, e);
        const task = req.body?.task_id ? getTaskById(req.user.id, req.body.task_id) : null;
        if (task) updateTask(task.id, { status: 'failed', error: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * 第三步：多角度生成
 * POST /api/workflow/step/multi
 * 输入：{ task_id, reference_image_url: "...", reference_prompt: "..." }
 * 输出：{ success: true, image_url: "..." }
 */
router.post('/step/multi', requireAuth, async (req, res) => {
    try {
        const { task_id, reference_image_url } = req.body || {};
        if (!task_id) return res.status(400).json({ success: false, error: '缺少 task_id' });

        const task = getTaskById(req.user.id, task_id);
        if (!task) return res.status(404).json({ success: false, error: '任务不存在' });

        // 更新任务状态
        updateTask(task.id, { status: 'processing', error: null });

        // 从任务结果中获取数据
        let taskResult = null;
        try {
            taskResult = (task.result && typeof task.result === 'object') ? task.result : (task.result ? JSON.parse(task.result) : {});
        } catch (_) { taskResult = {}; }

        // 第三工作流的 input = 第二步 output1 提取的 preview_prompt（存储在 task.result.preview.prompt）
        let inputText = '';
        if (taskResult && taskResult.preview && taskResult.preview.prompt) {
            inputText = String(taskResult.preview.prompt).trim();
            console.log(`[step/multi] 使用第二步 output1 提取的 preview_prompt 作为 input (${inputText.length} 字符)`);
        } else {
            // fallback：如果找不到 preview_prompt，使用原始用户输入
            if (task.params && task.params.user_input) {
                inputText = String(task.params.user_input).trim();
                console.log(`[step/multi] 未找到 preview_prompt，使用任务原始 user_input 作为 fallback: ${inputText.slice(0, 50)}...`);
            }
        }

        // 如果仍然为空，返回友好错误
        if (!inputText) {
            return res.status(400).json({
                success: false,
                error: '找不到第二步输出的 preview_prompt，请确保第一步和第二步工作流已成功完成'
            });
        }

        // 调用 Coze 多角度工作流 — 只接收 input(文本) 和 image(图片) 两个参数
        const parameters = { input: inputText };
        // 只使用 URL（第二步工作流输出），不接受 file_id
        if (reference_image_url) {
            parameters.image = String(reference_image_url).replace(/`/g, '');
            console.log('[step/multi] 使用 URL 作为 image 参数:', parameters.image);
        } else if (taskResult && taskResult.preview && taskResult.preview.image_url) {
            parameters.image = String(taskResult.preview.image_url).replace(/`/g, '');
            console.log('[step/multi] 从 task.result.preview.image_url 获取 URL:', parameters.image);
        } else {
            console.error('[step/multi] 无可用图片 URL，请检查第二步工作流输出');
            return res.status(400).json({ success: false, error: '缺少参考图片 URL，请确保第二步工作流已成功生成预览图' });
        }

        console.log(`[step/multi] 工作流ID: ${CONFIG.WF_MULTI_ID} | 链接: https://www.coze.cn/workflow/${CONFIG.WF_MULTI_ID}`);
        console.log('[step/multi] 参数:', JSON.stringify(parameters, null, 2));

        const data = await callCozeWorkflow(CONFIG.WF_MULTI_ID, parameters);

        // 调试：打印 Coze 返回的完整数据结构
        console.log('[step/multi] Coze 返回的完整 data:', JSON.stringify(data, null, 2)?.slice(0, 2000) || 'undefined');

        // 提取图片 URL
        let imageUrl = '';
        if (data && data.output) {
            const urls = extractImageUrls(data.output);
            if (urls.length > 0) imageUrl = urls[0];
        }
        if (!imageUrl && data && data.image_url) imageUrl = data.image_url;
        if (!imageUrl && typeof data === 'string') {
            const urls = extractImageUrls(data);
            if (urls.length > 0) imageUrl = urls[0];
        }

        // 保存到 task.result（task.result 已是解析后的对象）
        const currentResult = (task.result && typeof task.result === 'object') ? { ...task.result } : {};
        currentResult.multi = { image_url: imageUrl, prompt_text: inputText, reference_image_url };
        if (imageUrl) currentResult.multi_angle_images = [imageUrl];
        updateTask(task.id, { result: JSON.stringify(currentResult), status: 'multi_ready' });

        res.json({ success: true, image_url: imageUrl });
    } catch (e) {
        console.error(`[step/multi] 工作流ID: ${CONFIG.WF_MULTI_ID}`, e);
        const task = req.body?.task_id ? getTaskById(req.user.id, req.body.task_id) : null;
        if (task) updateTask(task.id, { status: 'failed', error: e.message });
        res.status(500).json({ success: false, error: e.message });
    }
});

// ========== 步骤回退（返回上一步） ==========

/**
 * POST /api/workflow/step/rollback
 * 回退任务到指定步骤，清除后续步骤数据
 * 输入：{ task_id, to_step: "spec"|"preview" }
 *  - "spec"   → 回到第一步：清除 preview + multi 数据，status → spec_ready
 *  - "preview" → 回到第二步：清除 multi 数据，status → preview_ready
 */
router.post('/step/rollback', requireAuth, async (req, res) => {
    try {
        const { task_id, to_step } = req.body || {};
        if (!task_id) return res.status(400).json({ success: false, error: '缺少 task_id' });
        if (!to_step || !['spec', 'preview'].includes(to_step))
            return res.status(400).json({ success: false, error: 'to_step 必须为 "spec" 或 "preview"' });

        const task = getTaskById(req.user.id, task_id);
        if (!task) return res.status(404).json({ success: false, error: '任务不存在' });

        const currentResult = (task.result && typeof task.result === 'object') ? { ...task.result } : {};

        if (to_step === 'spec') {
            // 清除第二步和第三步数据
            delete currentResult.preview;
            delete currentResult.multi;
            delete currentResult.multi_angle_images;
            updateTask(task.id, {
                result: JSON.stringify(currentResult),
                status: 'spec_ready'
            });
        } else {
            // to_step === 'preview'：只清除第三步数据
            delete currentResult.multi;
            delete currentResult.multi_angle_images;
            updateTask(task.id, {
                result: JSON.stringify(currentResult),
                status: 'preview_ready'
            });
        }

        res.json({ success: true, status: to_step === 'spec' ? 'spec_ready' : 'preview_ready' });
    } catch (e) {
        console.error('[step/rollback]', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ========== 参考图上传代理（安全加固版）==========

router.post('/image', requireAuth, (req, res, next) => {
    // 1️⃣ 检查 Content-Length（防止超大文件）
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (contentLength > MAX_SIZE) {
        return res.status(413).json({ success: false, error: '图片大小不能超过 5MB' });
    }
    next();
}, rawBody({ type: 'multipart/form-data', limit: '5mb' }), async (req, res) => {
    try {
        const contentType = req.headers['content-type'] || '';
        const bMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
        if (!bMatch || !Buffer.isBuffer(req.body))
            return res.status(400).json({ success: false, error: '无效的 multipart 请求' });

        const boundary = '--' + (bMatch[1] || bMatch[2]).trim();
        const bBuf = Buffer.from(boundary);
        let file = null;
        let start = req.body.indexOf(bBuf);
        while (start >= 0 && !file) {
            const next = req.body.indexOf(bBuf, start + bBuf.length);
            if (next < 0) break;
            let part = req.body.slice(start + bBuf.length, next);
            if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
            if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd >= 0) {
                const headers = part.slice(0, headerEnd).toString('utf-8');
                const fileM = /filename="([^"]*)"/i.exec(headers);
                if (fileM) {
                    const typeM = /content-type:\s*([^\r\n]+)/i.exec(headers);
                    file = {
                        filename: fileM[1] || 'upload.png',
                        contentType: typeM ? typeM[1].trim() : 'application/octet-stream',
                        data: part.slice(headerEnd + 4)
                    };
                }
            }
            start = next;
        }
        if (!file || file.data.length === 0)
            return res.status(400).json({ success: false, error: '未找到上传的图片文件（字段名需为 file）' });
        if (!/^image\//.test(file.contentType))
            return res.status(400).json({ success: false, error: '仅支持图片文件' });

        // 2️⃣ file-type 文件头二次校验（严格白名单，移除 GIF）
        const type = await fileTypeFromBuffer(file.data);
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!type || !allowedMimes.includes(type.mime)) {
            return res.status(415).json({
                success: false,
                error: '仅支持 JPEG、PNG、WEBP 格式的图片'
            });
        }

        // 3️⃣ 二次校验：检测文件头魔数是否匹配扩展名（防止伪装）
        const extMap = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
        const ext = file.filename.split('.').pop().toLowerCase();
        if (!extMap[type.mime]?.includes(ext)) {
            return res.status(415).json({ success: false, error: '文件扩展名与真实内容不匹配' });
        }

        const fileId = await uploadToCoze(file.data, type.mime, file.filename);
        console.log(`[upload] ${file.filename} (${file.data.length}B) → ${fileId} (detected: ${type.mime})`);
        res.json({ success: true, file_id: fileId });
    } catch (e) {
        console.error('[upload]', e);
        res.status(500).json({ success: false, error: '上传失败：' + e.message });
    }
});

export default router;