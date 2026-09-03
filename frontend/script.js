/* ===============================================================
   Perfume Concept Studio · script.js
   香水概念生图 · 三步工作流（规范 → 预览 → 多角度）
   =============================================================== */

// -----------------------------
// 1. DOM 引用（加 null 检查防崩溃）
// -----------------------------
const $ = (id) => document.getElementById(id);

const form = $('workflow-form');
const promptInput = $('promptInput');
const charCount = $('charCount');

const advancedToggle = $('advancedToggle');
const advancedContent = $('advancedContent');
const advancedIcon = $('advancedIcon');

const generateBtn = $('generateBtn');
const btnText = $('btnText');
const btnIcon = $('btnIcon');

const initialState = $('initialState');
const loadingState = $('loadingState');
const resultGrid = $('resultGrid');
const errorState = $('errorState');
const errorText = $('errorText');

const loadingPhaseText = $('loadingPhaseText');
const loadingPhaseSubtext = $('loadingPhaseSubtext');

const resultConceptTitle = $('resultConceptTitle');
const resultConceptMeta = $('resultConceptMeta');
const imagesContainer = $('imagesContainer');
const downloadBrochureBtn = $('downloadBrochureBtn');
const downloadBrochureBtnText = $('downloadBrochureBtnText');

const useInspirationBtn = $('useInspirationBtn');
const imageModal = $('imageModal');
const modalImage = $('modalImage');

// 节点卡片 + 原始错误容器
const rawErrorContainer = $('rawErrorContainer');
const rawErrorContent = $('rawErrorContent');
const rawErrorDebugLink = $('rawErrorDebugLink');

// 进度条
const progressBarSection = $('progressBarSection');
const progressBar = $('progressBar');
const progressLabel = $('progressLabel');
const progressCount = $('progressCount');
const progressSubtext = $('progressSubtext');

// -----------------------------
// 1.1 全局状态：三步工作流
// -----------------------------
const tasksMap = new Map(); // taskId -> { prompt, spec, previewUrl, previewFileId, multiUrl, status, createdAt }
// 暴露到 window 供 studio.html 内联脚本使用
window.tasksMap = tasksMap;
let selectedTaskId = null;

// displayResults 防抖：防止重复调用导致 saveToHistory 频繁触发 429
let _lastDisplayResult = { taskId: null, timestamp: 0 };

// -----------------------------
// 1.2 DOM 引用守卫 + 历史记录辅助
// -----------------------------
const MISSING_DOM = new Set();
[form, promptInput, charCount, advancedToggle, advancedContent, advancedIcon,
 generateBtn, btnText, btnIcon, initialState, loadingState, resultGrid,
 errorState, errorText, loadingPhaseText, loadingPhaseSubtext,
 resultConceptTitle, resultConceptMeta, imagesContainer, downloadBrochureBtn,
 downloadBrochureBtnText, useInspirationBtn, imageModal, modalImage].forEach((el, i) => {
    if (!el) MISSING_DOM.add(i);
});

const HISTORY_STORAGE_KEY = 'perfume_concept_history';
const SESSION_KEY = 'pcs_user_session';
const TASKS_MAP_KEY = 'pcs_tasks_map';

// ==== 新增：错误码枚举 ====
const ERR_NETWORK = 'ERR_NETWORK';
const ERR_UNAUTHORIZED = 'ERR_UNAUTHORIZED';
const ERR_TIMEOUT = 'ERR_TIMEOUT';
const ERR_SERVER = 'ERR_SERVER';
const ERR_UNKNOWN = 'ERR_UNKNOWN';

const ERROR_CODE_MAP = {
    [ERR_NETWORK]: '网络连接异常，请检查网络后重试 🌐',
    [ERR_UNAUTHORIZED]: '登录已过期，正在跳转到登录页...',
    [ERR_TIMEOUT]: '请求超时，请稍后重试 ⏰',
    [ERR_SERVER]: '服务器暂时不可用，请稍后重试 🙏',
    [ERR_UNKNOWN]: '生成失败了，请稍后重试 🙏'
};

function classifyError(err) {
    if (!err) return ERR_UNKNOWN;
    const msg = String(err.message || err);
    if (msg === 'LOGIN_EXPIRED') return ERR_UNAUTHORIZED;
    const lower = msg.toLowerCase();
    if (lower.includes('timeout') || lower.includes('timeout') || lower.includes('abort')) return ERR_TIMEOUT;
    if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('fetch') || lower.includes('网络')) return ERR_NETWORK;
    if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('service') || lower.includes('server')) return ERR_SERVER;
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('未登录')) return ERR_UNAUTHORIZED;
    return ERR_UNKNOWN;
}

function getFriendlyErrorByCode(code) {
    return ERROR_CODE_MAP[code] || ERROR_CODE_MAP[ERR_UNKNOWN];
}

function handleError(err) {
    const errCode = classifyError(err);
    if (errCode === ERR_UNAUTHORIZED) {
        showErrorInline(ERROR_CODE_MAP[ERR_UNAUTHORIZED]);
        setTimeout(() => { window.location.href = 'login.html?redirect=studio.html'; }, 1200);
    } else {
        showErrorInline(getFriendlyErrorByCode(errCode), err.message);
    }
}

// 保存任务列表到 localStorage
function saveTasksToStorage() {
    try {
        const arr = Array.from(tasksMap.entries()).map(([id, task]) => {
            // 只保存关键字段，不保存函数等不可序列化数据
            const { taskId, prompt, spec, previewUrl, previewFileId, multiUrl, step, status, createdAt, error, statusChangedAt } = task;
            return [id, { taskId, prompt, spec, previewUrl, previewFileId, multiUrl, step, status, createdAt, error, statusChangedAt }];
        });
        localStorage.setItem(TASKS_MAP_KEY, JSON.stringify(arr));
    } catch (_) {}
}

// 从 localStorage 恢复任务列表
function loadTasksFromStorage() {
    try {
        const raw = localStorage.getItem(TASKS_MAP_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return;
        tasksMap.clear();
        for (const [id, task] of arr) {
            if (id && task && task.taskId) {
                // 恢复时转换时间字段为数字，防止存储的字符串类型
                task.createdAt = Number(task.createdAt) || Date.now();
                task.statusChangedAt = Number(task.statusChangedAt) || Date.now();
                task.updatedAt = Number(task.updatedAt) || Date.now();
                tasksMap.set(id, task);
            }
        }
        if (tasksMap.size > 0) {
            renderTaskProgress();
        }
    } catch (_) {}
}

// 获取当前登录 token（未登录返回 null）
function getAuthToken() {
    try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        return s && s.token ? s.token : null;
    } catch (_) { return null; }
}

// 获取当前用户信息
function getCurrentUser() {
    try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        return s && s.user ? s.user : null;
    } catch (_) { return null; }
}

// -----------------------------
// 2. API Base URL 解析
// -----------------------------
const API_CONFIG = {
    getBaseUrl() {
        if (typeof window !== 'undefined' && window.__API_BASE__) {
            return window.__API_BASE__;
        }
        return '';
    }
};

function getAPIUrl() {
    return API_CONFIG.getBaseUrl();
}

// -----------------------------
// 3. 辅助：收集高级选项
// -----------------------------
function collectSelectedOptions(containerId, singleSelect = false) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    const btns = container.querySelectorAll(singleSelect ? '.style-btn' : '.tag-btn');
    const selected = [];
    btns.forEach(b => {
        if (b.dataset.selected === 'true' ||
            b.classList.contains('border-primary') ||
            (singleSelect && b.classList.contains('text-primary') && b.classList.contains('bg-surface-container-highest'))) {
            selected.push(b.dataset.value || b.textContent.trim());
        }
    });
    return selected;
}

function setOptionSelected(btn, selected) {
    btn.dataset.selected = selected ? 'true' : 'false';
    btn.classList.toggle('border-primary', selected);
    btn.classList.toggle('text-primary', selected);
    btn.classList.toggle('bg-primary/10', selected);
    btn.classList.toggle('border-outline-variant', !selected);
    btn.classList.toggle('text-on-surface/70', !selected);
}

function buildFinalPrompt() {
    const base = promptInput.value.trim();
    const fragrances = collectSelectedOptions('fragranceTags');
    const moods = collectSelectedOptions('moodTags');
    const styles = collectSelectedOptions('styleSelect', true);

    let parts = [];
    if (base) parts.push(base);
    if (fragrances.length) parts.push(`【香调】${fragrances.join('、')}`);
    if (moods.length) parts.push(`【氛围】${moods.join('、')}`);
    if (styles.length) parts.push(`【视觉风格】${styles.join('、')}`);
    return parts.join('\n');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

function truncateForDisplay(s, max = 220) {
    if (s === null || s === undefined) return '';
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    return str.length > max ? str.slice(0, max) + '…' : str;
}

// -----------------------------
// 4. 历史记录辅助
// -----------------------------
async function saveToHistory(entry) {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        arr.unshift({
            id: 'pc_' + Date.now(),
            prompt: entry.prompt || '',
            title: entry.title || '未命名概念',
            thumbnail: (entry.imageUrls && entry.imageUrls[0]) || '',
            imageUrls: entry.imageUrls || [],
            docId: entry.docId || '',
            status: entry.status || 'completed',
            createdAt: new Date().toISOString(),
            options: entry.options || {}
        });
        const trimmed = arr.slice(0, 50);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('本地历史保存失败:', e);
    }

    const token = getAuthToken();
    if (!token) return;
    const baseUrl = getAPIUrl();
    const body = JSON.stringify({
        prompt: entry.prompt || '',
        title: entry.title || '未命名概念',
        imageUrls: entry.imageUrls || [],
        docId: entry.docId || '',
        status: entry.status || 'completed',
        options: entry.options || {}
    });
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // 尝试发送，遇到 429 等待 1 秒后重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(`${baseUrl}/api/history`, { method: 'POST', headers, body });
            if (res.ok) return;
            if (res.status === 429 && attempt === 0) {
                console.warn('后端历史保存 429，1 秒后重试...');
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            console.warn('后端历史保存失败:', res.status);
            return;
        } catch (e) {
            if (attempt === 0) {
                console.warn('后端历史保存异常，1 秒后重试:', e.message);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            console.warn('后端历史保存异常:', e.message);
            return;
        }
    }
}

// -----------------------------
// 5. UI 交互：字数统计、高级选项折叠、标签选择
// -----------------------------
function initUIInteractions() {
    // 字数统计
    promptInput.addEventListener('input', (e) => {
        const len = e.target.value.length;
        charCount.textContent = `${len} / 500`;
        if (len > 500) {
            charCount.classList.add('text-error');
            e.target.value = e.target.value.substring(0, 500);
            charCount.textContent = `500 / 500`;
        } else {
            charCount.classList.remove('text-error');
        }
    });

    // 高级选项折叠
    let isAdvancedOpen = false;
    advancedToggle.addEventListener('click', () => {
        isAdvancedOpen = !isAdvancedOpen;
        if (isAdvancedOpen) {
            advancedContent.classList.remove('h-0', 'opacity-0', 'py-0');
            advancedContent.classList.add('h-auto', 'opacity-100', 'py-6');
            advancedIcon.classList.add('rotate-180');
            advancedToggle.classList.add('border-b', 'border-primary/10');
        } else {
            advancedContent.classList.add('h-0', 'opacity-0', 'py-0');
            advancedContent.classList.remove('h-auto', 'opacity-100', 'py-6');
            advancedIcon.classList.remove('rotate-180');
            setTimeout(() => { advancedToggle.classList.remove('border-b', 'border-primary/10'); }, 300);
        }
    });

    ['fragranceTags', 'moodTags'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.querySelectorAll('.tag-btn').forEach(btn => {
            btn.dataset.selected = 'false';
            btn.addEventListener('click', () => {
                const isSelected = btn.dataset.selected === 'true';
                setOptionSelected(btn, !isSelected);
            });
        });
    });

    const styleContainer = document.getElementById('styleSelect');
    if (styleContainer) {
        const btns = styleContainer.querySelectorAll('.style-btn');
        btns.forEach(btn => {
            btn.dataset.selected = 'false';
            btn.addEventListener('click', () => {
                btns.forEach(b => {
                    b.dataset.selected = 'false';
                    b.classList.remove('border-primary', 'text-primary', 'bg-surface-container-highest');
                    b.classList.add('border-outline-variant', 'text-on-surface/70', 'bg-surface-container-lowest/50');
                    const icon = b.querySelector('span.material-symbols-outlined');
                    if (icon) icon.classList.remove('opacity-100');
                });
                btn.dataset.selected = 'true';
                btn.classList.add('border-primary', 'text-primary', 'bg-surface-container-highest');
                btn.classList.remove('border-outline-variant', 'text-on-surface/70', 'bg-surface-container-lowest/50');
                const icon = btn.querySelector('span.material-symbols-outlined');
                if (icon) icon.classList.add('opacity-100');
            });
        });
    }

    if (useInspirationBtn) {
        useInspirationBtn.addEventListener('click', () => {
            promptInput.value = 'Deep amber tones with intricate gold filigree, set against a dramatic moody backdrop. Evening luxury fragrance with warm vanilla, oud wood and a whisper of rose.';
            promptInput.dispatchEvent(new Event('input'));
            promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            promptInput.focus();
        });
    }
}

// -----------------------------
// 6. 阶段提示文案
// -----------------------------
function setLoadingPhase(elapsedSeconds) {
    const phases = [
        { max: 20, title: 'Parsing Concept...', sub: '正在解析香水概念与视觉参数' },
        { max: 60, title: 'Crafting Notes...', sub: '正在生成文案 · 调香 · 匹配关键词' },
        { max: 120, title: 'Rendering Vision...', sub: '正在渲染视觉概念图 · 合成中' },
        { max: 240, title: 'Assembling Lookbook...', sub: '正在合成宣传册 · 排版中' },
    ];
    let current = phases[phases.length - 1];
    for (const p of phases) {
        if (elapsedSeconds <= p.max) { current = p; break; }
    }
    if (loadingPhaseText) loadingPhaseText.textContent = current.title;
    if (loadingPhaseSubtext) loadingPhaseSubtext.textContent = current.sub;
}

// -----------------------------
// 7. 状态切换
// -----------------------------
function showState(target) {
    const all = [initialState, loadingState, resultGrid, errorState];
    all.forEach(el => {
        if (!el) return;
        el.classList.add('hidden', 'opacity-0');
        el.style.display = 'none';
    });
    if (!target) return;
    target.style.display = 'flex';
    if (target === resultGrid) target.style.display = 'block';
    requestAnimationFrame(() => {
        target.classList.remove('hidden', 'opacity-0');
    });
}

function hideAllStates() {
    [initialState, loadingState, resultGrid, errorState, progressBarSection].forEach(el => {
        if (!el) return;
        el.classList.add('hidden', 'opacity-0');
        el.style.display = 'none';
    });
}

// -----------------------------
// 8. 按钮状态
// -----------------------------
function setButtonLoading() {
    generateBtn.disabled = true;
    btnText.textContent = '生成中...';
    btnIcon.textContent = 'hourglass_empty';
    btnIcon.classList.add('animate-spin');
    generateBtn.classList.remove('from-primary', 'to-primary-container');
    generateBtn.classList.add('from-surface-variant', 'to-surface-container', 'text-on-surface/50');
}

function setButtonRunning() {
    generateBtn.disabled = false;
    btnText.textContent = '任务进行中·可继续构思';
    btnIcon.textContent = 'add';
    btnIcon.classList.remove('animate-spin');
}

function setButtonReset(text = '重新生成') {
    generateBtn.disabled = false;
    btnText.textContent = text;
    btnIcon.textContent = 'refresh';
    btnIcon.classList.remove('animate-spin');
    generateBtn.classList.remove('from-surface-variant', 'to-surface-container', 'text-on-surface/50');
    generateBtn.classList.add('from-primary', 'to-primary-container');
}

// -----------------------------
// 9. 弹窗控制（迁移自 studio.html）
// -----------------------------

// ----- 规范确认弹窗状态 -----
let _currentSpecTaskId = null;
let _currentSpecData = null;

// ----- 预览/多角度弹窗状态 -----
window._previewTaskId = null;
window._previewSpec = null;
window._previewFileId = null;
window._previewPromptText = null;

// ===== 规范确认弹窗（Modal 1） =====

window.openSpecModal = function(taskId, spec) {
    _currentSpecTaskId = taskId;
    _currentSpecData = spec;
    // ==== 修复：打开弹窗时重置超时计时 ====
    const task = window.tasksMap && window.tasksMap.get(taskId);
    if (task) task.statusChangedAt = Date.now();
    const modal = document.getElementById('specModal');
    const form = document.getElementById('specForm');
    if (!modal || !form) return;

    // 递归展平嵌套对象，生成扁平化的 { key: value } 结构
    function flattenSpec(obj, prefix) {
        let result = {};
        if (!obj || typeof obj !== 'object') {
            result[prefix || 'value'] = obj;
            return result;
        }
        for (const [k, v] of Object.entries(obj)) {
            const fullKey = prefix ? prefix + '.' + k : k;
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                const nested = flattenSpec(v, fullKey);
                Object.assign(result, nested);
            } else {
                result[fullKey] = v;
            }
        }
        return result;
    }

    const flatSpec = flattenSpec(spec, '');
    let html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">';
    if (Object.keys(flatSpec).length > 0) {
        for (const [key, value] of Object.entries(flatSpec)) {
            const label = key;
            const isEmpty = value === null || value === '' || value === undefined;
            const strValue = value !== null && value !== undefined ? String(value) : '';
            html += '<div>';
            html += '<label class="section-label block mb-1">' + escapeHtml(label) + '</label>';
            if (strValue.length > 80) {
                html += '<textarea class="w-full input-field spec-field' + (isEmpty ? ' field-empty' : '') + '" data-key="' + escapeAttr(key) + '" rows="3">' + escapeHtml(strValue) + '</textarea>';
            } else {
                html += '<input type="text" class="w-full input-field spec-field' + (isEmpty ? ' field-empty' : '') + '" data-key="' + escapeAttr(key) + '" value="' + escapeHtml(strValue) + '" />';
            }
            if (isEmpty) {
                html += '<p class="field-empty-hint">⚠ 该字段为空，建议填写</p>';
            }
            html += '</div>';
        }
    }
    html += '</div>';
    form.innerHTML = html;

    // 初始化参考图上传区域状态
    updateSpecRefState(task);

    modal.style.display = 'flex';
    modal.classList.add('active');
    setTimeout(() => { modal.style.opacity = '1'; }, 10);
};

// 终态任务状态列表
const TERMINAL_STATES = ['completed', 'failed', 'no_response', 'cancelled'];

// ===== 取消任务：终止当前任务并标记为已取消 =====
function cancelTask(taskId) {
    if (!taskId || !window.tasksMap || !tasksMap.has(taskId)) return;
    const task = tasksMap.get(taskId);
    // 终态任务不再取消
    if (TERMINAL_STATES.includes(task.status)) return;
    task.status = 'cancelled';
    task.statusChangedAt = Date.now();
    renderTaskProgress();
    selectTask(taskId);
    // 检查是否所有任务都已结束，重置按钮
    const allTerminal = Array.from(tasksMap.values()).every(t => TERMINAL_STATES.includes(t.status));
    if (allTerminal) setButtonReset();
}

// 关闭规范确认弹窗
window.closeSpecModal = function(cancelTaskOnClose) {
    const taskId = _currentSpecTaskId;
    const modal = document.getElementById('specModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        modal.style.opacity = '0';
    }
    // 不清理 _currentSpecTaskId 和 _currentSpecData，保留以便提交时使用
    if (cancelTaskOnClose && taskId) cancelTask(taskId);
};

// 提交修改 — 切换为只读模式，显示"确认无误，开始生成"和"返回修改"
document.addEventListener('click', function(e) {
    const submitBtn = e.target.closest('#specSubmitBtn');
    if (!submitBtn) return;
    const form = document.getElementById('specForm');
    if (!form || !_currentSpecData) return;
    const fields = form.querySelectorAll('.spec-field');
    const updatedSpec = {};
    fields.forEach(f => {
        updatedSpec[f.dataset.key] = f.value;
    });
    _currentSpecData = updatedSpec;

    fields.forEach(f => f.disabled = true);
    document.getElementById('specSubmitBtn').classList.add('hidden');
    document.getElementById('specConfirmBtn').classList.add('hidden');
    document.getElementById('specConfirmFinalBtn').classList.remove('hidden');
    document.getElementById('specEditBackBtn').classList.remove('hidden');
});

// 确认无误，开始生成 — 关闭弹窗，调用 confirmSpec
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#specConfirmFinalBtn');
    if (!btn) return;
    const taskId = _currentSpecTaskId;
    const spec = _currentSpecData;
    document.getElementById('specSubmitBtn').classList.remove('hidden');
    document.getElementById('specConfirmBtn').classList.remove('hidden');
    document.getElementById('specConfirmFinalBtn').classList.add('hidden');
    document.getElementById('specEditBackBtn').classList.add('hidden');
    window.closeSpecModal();
    if (typeof window.confirmSpec === 'function') {
        window.confirmSpec(taskId, spec);
    }
});

// 返回修改 — 恢复可编辑状态
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#specEditBackBtn');
    if (!btn) return;
    const form = document.getElementById('specForm');
    if (!form) return;
    const fields = form.querySelectorAll('.spec-field');
    fields.forEach(f => f.disabled = false);
    document.getElementById('specSubmitBtn').classList.remove('hidden');
    document.getElementById('specConfirmBtn').classList.remove('hidden');
    document.getElementById('specConfirmFinalBtn').classList.add('hidden');
    document.getElementById('specEditBackBtn').classList.add('hidden');
});

// 直接确认 — 调用 confirmSpec 直接使用原始 spec
document.addEventListener('click', function(e) {
    const confirmBtn = e.target.closest('#specConfirmBtn');
    if (!confirmBtn) return;
    const taskId = _currentSpecTaskId;
    const spec = _currentSpecData;
    window.closeSpecModal();
    if (typeof window.confirmSpec === 'function') {
        window.confirmSpec(taskId, spec);
    }
});

// ===== 预览满意弹窗（Modal 2） =====

window.openPreviewModal = function(taskId, imageUrl, fileId, promptText, spec, fallbackError) {
    window._previewTaskId = taskId;
    window._previewFileId = fileId || null;
    window._previewPromptText = promptText || null;
    window._previewSpec = spec || null;
    // ==== 修复：打开弹窗时重置超时计时 ====
    const task = window.tasksMap && window.tasksMap.get(taskId);
    if (task) task.statusChangedAt = Date.now();
    const modal = document.getElementById('previewModal');
    const img = document.getElementById('previewImage');
    if (!modal || !img) return;

    const isFallback = !imageUrl || fallbackError;

    // 使用 style.display 直接控制显隐，避免 classList.toggle 可能因之前状态残留导致隐藏
    document.getElementById('previewImageSection').style.display = isFallback ? 'none' : 'block';
    document.getElementById('previewFallbackSection').style.display = isFallback ? 'block' : 'none';
    document.getElementById('previewNormalButtons').style.display = isFallback ? 'none' : 'flex';
    document.getElementById('previewFallbackButtons').style.display = isFallback ? 'flex' : 'none';

    if (isFallback) {
        document.getElementById('previewFallbackError').textContent = fallbackError || '工作流未返回图片';
        const headingEl = modal.querySelector('.heading-serif');
        if (headingEl) headingEl.textContent = '预览图生成失败';
    } else {
        img.src = imageUrl || '';
        const headingEl = modal.querySelector('.heading-serif');
        if (headingEl) headingEl.textContent = '您对预览图满意吗？';
        document.getElementById('previewDetailSection').classList.add('hidden');
        document.getElementById('previewDetailInput').value = '';
        document.getElementById('previewRegenLoading').classList.add('hidden');
        document.getElementById('previewSubmitDetailBtn').classList.add('hidden');
        document.getElementById('previewSatisfiedBtn').disabled = false;
        document.getElementById('previewRetryBtn').classList.remove('hidden');
        document.getElementById('previewBackBtn').disabled = false;
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
    setTimeout(() => { modal.style.opacity = '1'; }, 10);
};

window.closePreviewModal = function(cancelTaskOnClose) {
    const taskId = window._previewTaskId;
    const modal = document.getElementById('previewModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        modal.style.opacity = '0';
    }
    if (cancelTaskOnClose && taskId) cancelTask(taskId);
};

// 满意，继续生成多角度 — 调用 confirmPreview
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewSatisfiedBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    window.closePreviewModal();
    if (typeof window.confirmPreview === 'function') {
        window.confirmPreview(taskId);
    }
});

// 不满意，重新生成 — 展开修改意见输入区
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewRetryBtn');
    if (!btn) return;
    document.getElementById('previewDetailSection').classList.remove('hidden');
    document.getElementById('previewSubmitDetailBtn').classList.remove('hidden');
    btn.classList.add('hidden');
    document.getElementById('previewSatisfiedBtn').disabled = true;
    document.getElementById('previewBackBtn').disabled = true;
    document.getElementById('previewDetailInput').focus();
});

// 提交修改意见 — 收集 detail 文本，调用 regeneratePreviewWithDetail
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewSubmitDetailBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    const detail = document.getElementById('previewDetailInput').value;
    document.getElementById('previewRegenLoading').classList.remove('hidden');
    btn.disabled = true;
    document.getElementById('previewDetailInput').disabled = true;

    if (typeof window.regeneratePreviewWithDetail === 'function') {
        window.regeneratePreviewWithDetail(taskId, detail).then(result => {
            btn.disabled = false;
            document.getElementById('previewDetailInput').disabled = false;
            if (result && result.success) {
                document.getElementById('previewDetailSection').classList.add('hidden');
                document.getElementById('previewSubmitDetailBtn').classList.add('hidden');
                btn.disabled = false;
                document.getElementById('previewSatisfiedBtn').disabled = false;
                document.getElementById('previewRetryBtn').classList.remove('hidden');
                document.getElementById('previewBackBtn').disabled = false;
            } else {
                document.getElementById('previewRegenLoading').classList.remove('hidden');
            }
        });
    }
});

// 返回上一步 — 回退到规范确认弹窗
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewBackBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    const spec = window._previewSpec;
    window.closePreviewModal();
    if (typeof window.rollbackTask === 'function') {
        window.rollbackTask(taskId, 'spec').then(() => {
            if (typeof window.openSpecModal === 'function') {
                window.openSpecModal(taskId, spec);
            }
        });
    } else {
        if (typeof window.openSpecModal === 'function') {
            window.openSpecModal(taskId, spec);
        }
    }
});

// ============ 预览兜底弹窗按钮事件 ============

// 重试 — 重新调用 preview 工作流
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewFallbackRetryBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    const spec = window._previewSpec;
    window.closePreviewModal();
    if (typeof window.confirmSpec === 'function') {
        window.confirmSpec(taskId, spec);
    }
});

// 退出 — 关闭弹窗并终止任务
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewFallbackExitBtn');
    if (!btn) return;
    window.closePreviewModal(true);
});

// 下一步（开发测试）— 强制进入多角度生成
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#previewFallbackNextBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    window.closePreviewModal();
    if (typeof window.confirmPreview === 'function') {
        window.confirmPreview(taskId);
    }
});

// ===== 多角度满意弹窗（Modal 3） =====

window.openMultiModal = function(taskId, imageUrl, fallbackError) {
    // ==== 修复：打开弹窗时重置超时计时 ====
    const task = window.tasksMap && window.tasksMap.get(taskId);
    if (task) task.statusChangedAt = Date.now();
    const modal = document.getElementById('multiModal');
    const img = document.getElementById('multiImage');
    if (!modal || !img) return;

    const isFallback = !imageUrl || fallbackError;

    // 使用 style.display 直接控制显隐，避免 classList.toggle 状态残留
    document.getElementById('multiImageSection').style.display = isFallback ? 'none' : 'block';
    document.getElementById('multiFallbackSection').style.display = isFallback ? 'block' : 'none';
    document.getElementById('multiNormalButtons').style.display = isFallback ? 'none' : 'flex';
    document.getElementById('multiFallbackButtons').style.display = isFallback ? 'flex' : 'none';

    if (isFallback) {
        document.getElementById('multiFallbackError').textContent = fallbackError || '多角度图生成失败，未返回图片';
        document.getElementById('multiModalTitle').textContent = '多角度图生成失败';
    } else {
        img.src = imageUrl || '';
        document.getElementById('multiModalTitle').textContent = '多角度设计图已生成，是否满意？';
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
    setTimeout(() => { modal.style.opacity = '1'; }, 10);
};

window.closeMultiModal = function(cancelTaskOnClose) {
    const taskId = window._previewTaskId;
    const modal = document.getElementById('multiModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        modal.style.opacity = '0';
    }
    if (cancelTaskOnClose && taskId) cancelTask(taskId);
};

// 下载多角度图片
window.downloadMultiImage = function() {
    const img = document.getElementById('multiImage');
    if (img && img.src) {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = 'multi-angle-design.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};

// 满意，完成 — 调用 confirmMulti 完成流程
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#multiConfirmBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    window.closeMultiModal();
    if (typeof window.confirmMulti === 'function') {
        window.confirmMulti(taskId);
    }
});

// 不满意，重新生成 — 调用 regenerateMulti
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#multiRetryBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    window.closeMultiModal();
    if (typeof window.regenerateMulti === 'function') {
        window.regenerateMulti(taskId);
    }
});

// 返回上一步 — 回退到预览确认弹窗
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#multiBackBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    const task = window.tasksMap ? window.tasksMap.get(taskId) : null;
    window.closeMultiModal();
    if (typeof window.rollbackTask === 'function') {
        window.rollbackTask(taskId, 'preview').then(() => {
            const previewUrl = task ? task.previewUrl : '';
            const fileId = task ? task.previewFileId : '';
            const promptText = task ? task.prompt : '';
            const spec = task ? task.spec : null;
            if (typeof window.openPreviewModal === 'function') {
                window.openPreviewModal(taskId, previewUrl, fileId, promptText, spec);
            }
        });
    }
});

// ============ 多角度兜底弹窗按钮事件 ============

// 重试 — 重新调用 multi 工作流
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#multiFallbackRetryBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    window.closeMultiModal();
    if (typeof window.confirmPreview === 'function') {
        window.confirmPreview(taskId);
    }
});

// 退出 — 关闭弹窗并终止任务
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#multiFallbackExitBtn');
    if (!btn) return;
    window.closeMultiModal(true);
});

// 下一步（开发测试）— 强制完成
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#multiFallbackNextBtn');
    if (!btn) return;
    const taskId = window._previewTaskId;
    window.closeMultiModal();
    if (typeof window.confirmMulti === 'function') {
        window.confirmMulti(taskId);
    }
});

// ===== 大图预览（双击缩略图） =====

window.openLargeImageModal = function(url) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    if (!modal || !img || !url) return;
    img.style.backgroundImage = 'url(' + url + ')';
    modal.style.display = 'flex';
    modal.classList.add('flex');
    setTimeout(() => { modal.style.opacity = '1'; }, 10);
};

// -----------------------------
// 11. 参考图上传
// -----------------------------
const refZone = $('refZone');
const refFileInput = $('refFile');
const refUploadedBox = $('refUploaded');
const refThumb = $('refThumb');
const refFileName = $('refFileName');
const refFileIdText = $('refFileId');
const refUploadingText = $('refUploading');
let refImageFileId = null;

if (refZone && refFileInput) {
    refZone.addEventListener('click', () => refFileInput.click());
    refFileInput.addEventListener('change', () => {
        const f = refFileInput.files && refFileInput.files[0];
        if (f) uploadRefImage(f);
    });
    refZone.addEventListener('dragover', e => {
        e.preventDefault();
        refZone.classList.add('border-forest-600', 'bg-forest-50');
    });
    refZone.addEventListener('dragleave', () => refZone.classList.remove('border-forest-600', 'bg-forest-50'));
    refZone.addEventListener('drop', e => {
        e.preventDefault();
        refZone.classList.remove('border-forest-600', 'bg-forest-50');
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadRefImage(f);
    });
    const refRemoveBtn = $('refRemove');
    if (refRemoveBtn) refRemoveBtn.addEventListener('click', () => {
        refImageFileId = null;
        refUploadedBox.classList.add('hidden');
        refUploadedBox.classList.remove('flex');
        refFileInput.value = '';
    });
}

async function uploadRefImage(file) {
    if (!file.type.startsWith('image/')) { showErrorInline('参考图仅支持图片文件'); return; }
    if (file.size > 5 * 1024 * 1024) { showErrorInline('参考图不能超过 5MB'); return; }
    if (!getAuthToken()) { window.location.href = 'login.html?redirect=studio.html'; return; }
    if (refUploadingText) refUploadingText.classList.remove('hidden');
    try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${getAPIUrl()}/api/upload/image`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getAuthToken()}` },
            body: fd
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 401) {
            try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
            alert('登录已过期，请重新登录');
            window.location.href = 'login.html?redirect=studio.html';
            return;
        }
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        refImageFileId = j.file_id;
        if (refThumb) refThumb.src = URL.createObjectURL(file);
        if (refFileName) refFileName.textContent = file.name;
        if (refFileIdText) refFileIdText.textContent = 'file_id: ' + j.file_id;
        if (refUploadedBox) {
            refUploadedBox.classList.remove('hidden');
            refUploadedBox.classList.add('flex');
        }
        showToast(`参考图「${file.name}」上传成功`);
        console.log('🖼️ 参考图已上传:', file.name, '→', j.file_id);
    } catch (e) {
        refImageFileId = null;
        showErrorInline('参考图上传失败，请稍后重试');
    } finally {
        if (refUploadingText) refUploadingText.classList.add('hidden');
    }
}

// 新增：上传图片并返回 file_id（供并发调用使用，不操作 UI）
async function uploadRefImageAndGetId(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('请选择图片文件');
    }
    if (file.size > 5 * 1024 * 1024) {
        throw new Error('图片不能超过 5MB');
    }
    if (!getAuthToken()) {
        throw new Error('未登录');
    }
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${getAPIUrl()}/api/upload/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        body: fd
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || '上传失败');
    }
    return data.file_id;
}

// 更新 specModal 中的参考图上传区域状态
function updateSpecRefState(task) {
    if (!task) return;
    const emptyEl = document.getElementById('specRefEmpty');
    const uploadingEl = document.getElementById('specRefUploading');
    const successEl = document.getElementById('specRefSuccess');
    const failedEl = document.getElementById('specRefFailed');
    const fileIdDisplay = document.getElementById('specRefFileIdDisplay');
    if (!emptyEl || !uploadingEl || !successEl || !failedEl) return;

    // 全部隐藏
    emptyEl.classList.add('hidden');
    uploadingEl.classList.add('hidden');
    successEl.classList.add('hidden');
    failedEl.classList.add('hidden');

    const refFileId = task.refFileId || '';
    if (refFileId) {
        // 已上传成功
        successEl.classList.remove('hidden');
        successEl.classList.add('flex');
        if (fileIdDisplay) fileIdDisplay.textContent = 'file_id: ' + refFileId;
    } else {
        // 未上传
        emptyEl.classList.remove('hidden');
        emptyEl.classList.add('flex');
    }
}

// specModal 参考图上传事件绑定
(function initSpecRefUpload() {
    const uploadBtn = document.getElementById('specRefUploadBtn');
    const changeBtn = document.getElementById('specRefChangeBtn');
    const removeBtn = document.getElementById('specRefRemoveBtn');
    const retryBtn = document.getElementById('specRefRetryBtn');
    const fileInput = document.getElementById('specRefFileInput');
    if (!uploadBtn || !fileInput) return;

    // 点击上传/更换 -> 打开文件选择
    uploadBtn.addEventListener('click', () => fileInput.click());
    if (changeBtn) changeBtn.addEventListener('click', () => fileInput.click());
    if (retryBtn) retryBtn.addEventListener('click', () => fileInput.click());

    // 选择文件后上传
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        const taskId = _currentSpecTaskId;
        const task = taskId ? window.tasksMap.get(taskId) : null;
        if (!task) return;

        // 切换到上传中状态
        const emptyEl = document.getElementById('specRefEmpty');
        const uploadingEl = document.getElementById('specRefUploading');
        const successEl = document.getElementById('specRefSuccess');
        const failedEl = document.getElementById('specRefFailed');
        if (emptyEl) emptyEl.classList.add('hidden');
        if (uploadingEl) { uploadingEl.classList.remove('hidden'); uploadingEl.classList.add('flex'); }
        if (successEl) successEl.classList.add('hidden');
        if (failedEl) failedEl.classList.add('hidden');

        try {
            const fileId = await uploadRefImageAndGetId(f);
            task.refFileId = fileId;
            refImageFileId = fileId;
            showToast('参考图上传成功');
            // 更新状态
            const fileIdDisplay = document.getElementById('specRefFileIdDisplay');
            if (uploadingEl) uploadingEl.classList.add('hidden');
            if (successEl) { successEl.classList.remove('hidden'); successEl.classList.add('flex'); }
            if (fileIdDisplay) fileIdDisplay.textContent = 'file_id: ' + fileId;
        } catch (e) {
            const errorMsg = document.getElementById('specRefErrorMsg');
            if (uploadingEl) uploadingEl.classList.add('hidden');
            if (failedEl) { failedEl.classList.remove('hidden'); failedEl.classList.add('flex'); }
            if (errorMsg) errorMsg.textContent = e.message || '上传失败';
        }
    });

    // 移除参考图
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            const taskId = _currentSpecTaskId;
            const task = taskId ? window.tasksMap.get(taskId) : null;
            if (task) {
                task.refFileId = '';
                refImageFileId = null;
            }
            const emptyEl = document.getElementById('specRefEmpty');
            const successEl = document.getElementById('specRefSuccess');
            if (successEl) { successEl.classList.add('hidden'); successEl.classList.remove('flex'); }
            if (emptyEl) { emptyEl.classList.remove('hidden'); emptyEl.classList.add('flex'); }
            fileInput.value = '';
        });
    }
})();

// -----------------------------
// 12. 表单提交 → 三步工作流（直接创建任务，跳过中间确认弹窗）
// -----------------------------
let pendingPrompt = '';

if (form) form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const inputValue = promptInput.value.trim();
    if (!inputValue) {
        showErrorInline('请先描述你的香水概念~');
        return;
    }
    if (!getAuthToken()) {
        window.location.href = 'login.html?redirect=studio.html';
        return;
    }

    const finalPrompt = buildFinalPrompt();
    console.log('📋 最终提交给工作流的 input:\n', finalPrompt);

    pendingPrompt = finalPrompt;
    // 直接执行三步工作流（不再经过已删除的 confirmModal）
    window.confirmGenerate();
});

// -----------------------------
// 13. 三步工作流核心 API 调用
// -----------------------------

// 第一步：生成设计规范
async function stepSpec(taskId, userInput) {
    const API_BASE_URL = getAPIUrl();
    const token = getAuthToken();
    console.log('🚀 调用 stepSpec:', taskId);

    const res = await fetch(`${API_BASE_URL}/api/workflow/step/spec`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ task_id: taskId, user_input: userInput })
    });

    if (res.status === 401) {
        try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
        throw new Error('LOGIN_EXPIRED');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

// 第二步：生成预览图（可选 detail 参数，用于修改意见）
async function stepPreview(taskId, spec, detail, refFileId) {
    const API_BASE_URL = getAPIUrl();
    const token = getAuthToken();
    console.log('🚀 调用 stepPreview:', taskId, detail ? '(带修改意见)' : '');

    const body = { task_id: taskId, spec };
    if (detail) body.detail = detail;
    if (refFileId) body.ref_file_id = refFileId;

    const res = await fetch(`${API_BASE_URL}/api/workflow/step/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });

    if (res.status === 401) {
        try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
        throw new Error('LOGIN_EXPIRED');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    // 安全解析 JSON 响应，防止后端返回非 JSON 内容导致崩溃
    try {
        return await res.json();
    } catch (parseErr) {
        console.error('[stepPreview] 响应 JSON 解析失败:', parseErr);
        throw new Error('服务器返回了无效的响应格式');
    }
}

// 第三步：生成多角度图
async function stepMulti(taskId, referenceImageUrl, referencePrompt) {
    const API_BASE_URL = getAPIUrl();
    const token = getAuthToken();
    console.log(`🚀 调用 stepMulti [taskId=${taskId}]`);
    console.log(`[stepMulti] 传递提示词: "${referencePrompt?.slice(0, 100)}"`);
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.log('[stepMulti] 完整请求体:', JSON.stringify({ task_id: taskId, reference_image_url: referenceImageUrl ? referenceImageUrl.slice(0, 60) + '...' : null, reference_prompt: referencePrompt?.slice(0, 100), prompt_text: referencePrompt?.slice(0, 100) }));
    }

    const body = { task_id: taskId };
    if (referenceImageUrl) body.reference_image_url = referenceImageUrl;
    if (referencePrompt) {
        body.reference_prompt = referencePrompt;
        body.prompt_text = referencePrompt;   // 确保后端能收到
    }

    const res = await fetch(`${API_BASE_URL}/api/workflow/step/multi`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });

    if (res.status === 401) {
        try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
        throw new Error('LOGIN_EXPIRED');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '请求失败' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

// -----------------------------
// 14. 三步工作流业务逻辑
// -----------------------------

// 显示加载状态（通用）
function showLoadingState(message) {
    hideAllStates();
    setButtonLoading();
    setLoadingPhase(0);
    loadingState.style.display = 'flex';
    requestAnimationFrame(() => loadingState.classList.remove('opacity-0'));
    setTimeout(() => loadingState.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// -----------------------------
// 14.5 三步工作流确认函数
// -----------------------------

// 确认规范 → 生成预览图（更新 spec 可选，detail 可选）
window.confirmSpec = async function (taskId, updatedSpec, detail) {
    const task = tasksMap.get(taskId);
    if (!task) return;

    task.spec = updatedSpec || task.spec;
    task.status = 'generating_preview';
    task.statusChangedAt = Date.now();
    renderTaskProgress();
    showLoadingState('正在生成预览图...');

    try {
        const result = await stepPreview(taskId, task.spec, detail, task.refFileId || undefined);
        console.log('✅ stepPreview 完成:', result);

        // 保存 previewPrompt（从工作流返回的 prompt 字段）
        task.previewPrompt = result.prompt || result.preview_prompt || result.previewPrompt || '';

        // 如果工作流未返回 prompt，从 spec 提取非空字段构建 prompt
        if (!task.previewPrompt && task.spec) {
            try {
                const spec = typeof task.spec === 'string' ? JSON.parse(task.spec) : task.spec;
                const parts = [];

                // 递归遍历 spec 对象，收集所有非空字符串值
                function collectNonEmpty(obj, path = '') {
                    if (!obj || typeof obj !== 'object') return;
                    for (const [key, value] of Object.entries(obj)) {
                        const fullPath = path ? `${path}.${key}` : key;
                        if (value === null || value === undefined || value === '') continue;
                        if (typeof value === 'string' && String(value).trim()) {
                            parts.push(`${fullPath}：${String(value).trim()}`);
                        } else if (typeof value === 'object') {
                            collectNonEmpty(value, fullPath);
                        }
                    }
                }

                collectNonEmpty(spec);

                if (parts.length > 0) {
                    task.previewPrompt = parts.join('；');
                    console.log(`[stepPreview] 从 spec 提取了 ${parts.length} 个非空字段:`, task.previewPrompt.slice(0, 150) + (task.previewPrompt.length > 150 ? '...' : ''));
                } else {
                    task.previewPrompt = '';
                    console.log('[stepPreview] spec 中未找到非空字段，留空将回退到原始prompt');
                }
            } catch (_) {
                console.warn('[stepPreview] spec 解析失败，留空回退到原始prompt');
                task.previewPrompt = '';
            }
        }
        console.log('[stepPreview] 保存 previewPrompt:', task.previewPrompt || '(空，将使用原始用户输入)');

        // 兜底机制：无图片 URL 时展示兜底弹窗
        if (!result.success || !result.image_url) {
            task.status = 'failed';
            task.statusChangedAt = Date.now();
            task.error = result.error || '预览图生成失败，未返回图片';
            renderTaskProgress();
            setButtonReset('再试一次');
            hideAllStates();
            // 打开兜底弹窗，传入错误信息
            window.openPreviewModal(taskId, '', task.previewFileId, task.prompt || '', task.spec, result.error || '工作流未返回图片，请检查工作流配置或稍后重试');
            return;
        }

        task.previewUrl = result.image_url || result.preview_url || '';
        task.previewFileId = result.file_id || '';
        task.status = 'preview_ready';
        task.statusChangedAt = Date.now();

        hideAllStates();
        renderTaskProgress();
        // 解锁生成按钮，允许继续提交新任务
        setButtonRunning();

        // 打开预览满意弹窗
            window.openPreviewModal(taskId, task.previewUrl, task.previewFileId, task.prompt || '', task.spec);
    } catch (err) {
        console.error('❌ stepPreview 失败:', err);
        task.status = 'failed';
        task.statusChangedAt = Date.now();
        renderTaskProgress();
        setButtonReset('再试一次');
        // ==== 新增：使用差异化错误处理 ====
        if (classifyError(err) === ERR_UNAUTHORIZED) {
            showErrorInline(ERROR_CODE_MAP[ERR_UNAUTHORIZED]);
            setTimeout(() => { window.location.href = 'login.html?redirect=studio.html'; }, 1200);
        } else {
            showErrorInline(getFriendlyErrorByCode(classifyError(err)), err.message);
        }
    }
};

// 确认预览满意 → 生成多角度
window.confirmPreview = async function (taskId) {
    const task = tasksMap.get(taskId);
    if (!task) return;

    // ----- 优先使用 previewPrompt（第二步的输出），其次 spec，最后原始 prompt -----
    let promptText = '';

    // 1. 优先使用 previewPrompt（第二步工作流返回或从 spec 构建）
    promptText = task.previewPrompt || '';
    if (promptText) {
        console.log('[confirmPreview] 提示词来源: previewPrompt ✅');
    }

    // 2. 如果 previewPrompt 为空，从 spec 提取非空字段构建（兜底）
    if (!promptText && task.spec) {
        try {
            const spec = typeof task.spec === 'string' ? JSON.parse(task.spec) : task.spec;
            const parts = [];

            // 递归遍历 spec 对象，收集所有非空字符串值
            function collectNonEmpty(obj, path = '') {
                if (!obj || typeof obj !== 'object') return;
                for (const [key, value] of Object.entries(obj)) {
                    const fullPath = path ? `${path}.${key}` : key;
                    if (value === null || value === undefined || value === '') continue;
                    if (typeof value === 'string' && String(value).trim()) {
                        parts.push(`${fullPath}：${String(value).trim()}`);
                    } else if (typeof value === 'object') {
                        collectNonEmpty(value, fullPath);
                    }
                }
            }

            collectNonEmpty(spec);

            if (parts.length > 0) {
                promptText = parts.join('；');
                console.log(`[confirmPreview] 提示词来源: 从 spec 提取 ${parts.length} 个非空字段 ⚠️`);
            } else {
                promptText = '';
                console.log('[confirmPreview] spec 中未找到非空字段，留空回退到原始prompt');
            }
        } catch (_) {
            console.warn('[confirmPreview] spec 解析失败');
            promptText = '';
        }
    }

    // 3. 最终兜底
    if (!promptText) {
        promptText = task.prompt || '高端香水瓶设计，多角度展示，奢华质感';
        console.log('[confirmPreview] 提示词来源: 原始 prompt 🔄');
    }

    console.log('[confirmPreview] 最终传递给 stepMulti 的提示词:', JSON.stringify(promptText));
    console.log('[confirmPreview] task.prompt (原始用户输入):', JSON.stringify(task.prompt));
    console.log('[confirmPreview] task.previewPrompt:', JSON.stringify(task.previewPrompt));
    console.log('[confirmPreview] task.spec:', JSON.stringify(task.spec));
    // ---------------------------------

    task.status = 'generating_multi';
    task.statusChangedAt = Date.now();
    renderTaskProgress();
    showLoadingState('正在生成多角度展示图...');

    try {
        const result = await stepMulti(taskId, task.previewUrl || undefined, promptText);
        console.log('✅ stepMulti 完成:', result);

        // 兜底机制：无图片 URL 时展示兜底弹窗
        if (!result.success || !result.image_url) {
            task.status = 'failed';
            task.statusChangedAt = Date.now();
            task.error = result.error || '多角度图生成失败，未返回图片';
            renderTaskProgress();
            setButtonReset('再试一次');
            hideAllStates();
            window.openMultiModal(taskId, '', result.error || '多角度图生成失败，未返回图片');
            return;
        }

        task.multiUrl = result.image_url || result.multi_url || '';
        task.status = 'multi_ready';
        task.statusChangedAt = Date.now();

        hideAllStates();
        renderTaskProgress();
        // 解锁生成按钮，允许继续提交新任务
        setButtonRunning();

        // 打开多角度满意弹窗
        window.openMultiModal(taskId, task.multiUrl);
    } catch (err) {
        console.error('❌ stepMulti 失败:', err);
        task.status = 'failed';
        task.statusChangedAt = Date.now();
        renderTaskProgress();
        setButtonReset('再试一次');
        // ==== 新增：使用差异化错误处理 ====
        if (classifyError(err) === ERR_UNAUTHORIZED) {
            showErrorInline(ERROR_CODE_MAP[ERR_UNAUTHORIZED]);
            setTimeout(() => { window.location.href = 'login.html?redirect=studio.html'; }, 1200);
        } else {
            showErrorInline(getFriendlyErrorByCode(classifyError(err)), err.message);
        }
    }
};

// 确认多角度满意 → 完成
window.confirmMulti = function (taskId) {
    console.log('✅ confirmMulti 被调用，taskId:', taskId);
    const task = tasksMap.get(taskId);
    if (!task) {
        console.warn('⚠️ confirmMulti: 任务不存在', taskId);
        return;
    }

    // 1. 先更新状态
    task.status = 'completed';
    task.statusChangedAt = Date.now();

    // 2. 立即更新 UI 并持久化
    renderTaskProgress();
    saveTasksToStorage();
    // 任务完成后重置按钮状态
    setButtonReset();

    // 3. 重置防抖时间戳，确保 displayResults 能正常执行
    _lastDisplayResult = { taskId: null, timestamp: 0 };

    // 4. 展示最终结果
    const images = [task.previewUrl, task.multiUrl].filter(Boolean);
    window.displayResults({
        success: true,
        images,
        message: '生成完成！',
        jobId: taskId,
        infoJson: { timestamp: new Date().toISOString() }
    });

    showToast('香水概念生成完成！');
};

// 重新生成预览图
window.regeneratePreview = function (taskId) {
    const task = tasksMap.get(taskId);
    if (!task) return;
    window.confirmSpec(taskId, task.spec);
};

// 带修改意见重新生成预览图（第二步"不满意→提交修改意见"）
window.regeneratePreviewWithDetail = async function (taskId, detail) {
    const task = tasksMap.get(taskId);
    if (!task) return;
    task.status = 'generating_preview';
    task.statusChangedAt = Date.now();
    renderTaskProgress();
    try {
        const result = await stepPreview(taskId, task.spec, detail, task.refFileId || undefined);
        // 兜底机制：无图片 URL 时展示兜底弹窗
        if (!result.success || !result.image_url) {
            task.status = 'failed';
            task.statusChangedAt = Date.now();
            task.error = result.error || '预览图生成失败，未返回图片';
            renderTaskProgress();
            const loadingEl = document.getElementById('previewRegenLoading');
            if (loadingEl) loadingEl.style.display = 'none';
            window.closePreviewModal();
            window.openPreviewModal(taskId, '', task.previewFileId, task.prompt || '', task.spec, result.error || '重新生成失败，未返回图片');
            return { success: false, error: result.error || '未返回图片' };
        }
        // 保存 previewPrompt（从工作流返回的 prompt 字段）
        task.previewPrompt = result.prompt || result.preview_prompt || result.previewPrompt || '';
        // 如果工作流未返回 prompt，从 spec 提取非空字段构建
        if (!task.previewPrompt && task.spec) {
            try {
                const spec = typeof task.spec === 'string' ? JSON.parse(task.spec) : task.spec;
                const parts = [];

                // 递归遍历 spec 对象，收集所有非空字符串值
                function collectNonEmpty(obj, path = '') {
                    if (!obj || typeof obj !== 'object') return;
                    for (const [key, value] of Object.entries(obj)) {
                        const fullPath = path ? `${path}.${key}` : key;
                        if (value === null || value === undefined || value === '') continue;
                        if (typeof value === 'string' && String(value).trim()) {
                            parts.push(`${fullPath}：${String(value).trim()}`);
                        } else if (typeof value === 'object') {
                            collectNonEmpty(value, fullPath);
                        }
                    }
                }

                collectNonEmpty(spec);

                if (parts.length > 0) {
                    task.previewPrompt = parts.join('；');
                    console.log(`[regeneratePreviewWithDetail] 从 spec 提取了 ${parts.length} 个非空字段:`, task.previewPrompt.slice(0, 150) + (task.previewPrompt.length > 150 ? '...' : ''));
                }
                console.log('[regeneratePreviewWithDetail] 从 spec 提取 previewPrompt:', task.previewPrompt || '(所有字段为空，留空将回退到原始prompt)');
            } catch (_) {}
        }
        console.log('[regeneratePreviewWithDetail] 保存 previewPrompt:', task.previewPrompt || '(空，将使用原始用户输入)');

        task.previewUrl = result.image_url || '';
        task.previewFileId = result.file_id || '';
        task.status = 'preview_ready';
        task.statusChangedAt = Date.now();
        renderTaskProgress();
        // 解锁生成按钮，允许继续提交新任务
        setButtonRunning();
        // 更新预览弹窗图片
        const img = document.getElementById('previewImage');
        if (img) img.src = task.previewUrl;
        // 隐藏加载状态，重新显示按钮
        const loadingEl = document.getElementById('previewRegenLoading');
        if (loadingEl) loadingEl.style.display = 'none';
        window._previewFileId = task.previewFileId;
        return { success: true };
    } catch (err) {
        task.status = 'failed';
        task.statusChangedAt = Date.now();
        renderTaskProgress();
        const loadingEl = document.getElementById('previewRegenLoading');
        if (loadingEl) {
            loadingEl.innerHTML = '<span class="text-red-600">重新生成失败：' + escapeHtml(err.message) + '</span>';
        }
        return { success: false, error: err.message };
    }
};

// 重新生成多角度图
window.regenerateMulti = function (taskId) {
    window.confirmPreview(taskId);
};

// 回退任务到指定步骤（由 studio.html 弹窗调用）
window.rollbackTask = async function (taskId, toStep) {
    const API_BASE_URL = getAPIUrl();
    const token = getAuthToken();
    try {
        const res = await fetch(`${API_BASE_URL}/api/workflow/step/rollback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ task_id: taskId, to_step: toStep })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: '回退失败' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        // 更新 tasksMap 中的任务状态
        const task = tasksMap.get(taskId);
        if (task) {
            if (toStep === 'spec') {
                // 回退到第一步：清空所有预览图和多角度数据
                task.previewUrl = null;
                task.previewFileId = null;
                task.previewPrompt = null; // 清空预览提示词
                task.multiUrl = null;
                task.status = 'spec_ready';
                console.log('🔄 回退到 spec，已清空 previewUrl, previewPrompt, multiUrl');
            } else {
                // 回退到第二步：只清空多角度数据，保留预览图相关
                task.multiUrl = null;
                task.status = 'preview_ready';
                // previewPrompt 保留，因为预览图还在
                console.log('🔄 回退到 preview，已清空 multiUrl，保留 previewUrl 和 previewPrompt');
            }
            task.statusChangedAt = Date.now();
            renderTaskProgress();
        }
        return data;
    } catch (err) {
        console.error('❌ rollbackTask 失败:', err);
        showToast('回退失败：' + err.message);
        return { success: false };
    }
};

// 隐藏加载状态
function hideAllLoadingStates() {
    hideAllStates();
}

// -----------------------------
// 15. 确认生成
// -----------------------------
window.confirmGenerate = function () {
    window.closeConfirmModal();
    const inputValue = pendingPrompt || '';
    if (!inputValue) {
        showErrorInline('请先描述你的香水概念~');
        return;
    }
    pendingPrompt = '';

    // 执行三步工作流
    (async () => {
        let taskEntry = null;
        try {
            const API_BASE_URL = getAPIUrl();
            const token = getAuthToken();

            showLoadingState('正在创建任务...');

            // a. 创建任务
            const taskName = inputValue.length > 30 ? inputValue.slice(0, 30) + '...' : inputValue;
            const createRes = await fetch(`${API_BASE_URL}/api/workflow`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    name: taskName,
                    params: {
                        user_input: inputValue,
                        image_file_id: typeof refImageFileId !== 'undefined' ? (refImageFileId || '') : ''
                    }
                })
            });

            if (createRes.status === 401) {
                try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
                throw new Error('LOGIN_EXPIRED');
            }
            if (!createRes.ok) {
                const err = await createRes.json().catch(() => ({ error: '创建任务失败' }));
                throw new Error(err.error || '创建任务失败');
            }

            const createData = await createRes.json();
            const taskId = createData.task?.id || createData.id;
            if (!taskId) throw new Error('创建任务失败：未返回任务 ID');

            // 注册到 tasksMap
            taskEntry = {
                taskId,
                prompt: inputValue,
                spec: null,
                previewUrl: null,
                previewPrompt: null,
                previewFileId: null,
                multiUrl: null,
                step: 1,
                status: 'spec_confirming',
                createdAt: Date.now(),
                statusChangedAt: Date.now(),
                refFileId: typeof refImageFileId !== 'undefined' ? (refImageFileId || '') : ''
            };
            tasksMap.set(taskId, taskEntry);
            selectedTaskId = taskId;
            renderTaskProgress();

            // 提示用户并解封按钮，允许继续提交新任务
            showToast('🎨 创意正在生成中，完成后会弹出确认窗口', 'success');
            setButtonRunning();

            // b. 并发执行 stepSpec 和图片上传（如果待上传的文件尚未处理）
            const refFileInput = document.getElementById('refFile');
            const hasPendingFile = refFileInput && refFileInput.files && refFileInput.files[0];
            let uploadPromise = Promise.resolve(taskEntry.refFileId || null);
            if (hasPendingFile) {
                const file = refFileInput.files[0];
                uploadPromise = uploadRefImageAndGetId(file).catch(err => {
                    console.warn('[confirmGenerate] 图片上传失败:', err.message);
                    // 不阻塞工作流，上传失败仍可继续
                    return null;
                });
            }

            const [specResult, uploadedFileId] = await Promise.all([
                stepSpec(taskId, inputValue),
                uploadPromise
            ]);
            console.log('✅ stepSpec 完成:', specResult);

            // 如果上传成功，更新 refFileId
            if (uploadedFileId) {
                taskEntry.refFileId = uploadedFileId;
                refImageFileId = uploadedFileId;
            }

            const spec = specResult.spec || specResult.data || specResult;
            taskEntry.spec = spec;

            // c. 打开 Modal 1 让用户确认/修改规范
            window.openSpecModal(taskId, spec);
        } catch (err) {
            console.error('💔 生成失败:', err);
            // 如果任务已经创建但失败了，标记为失败
            if (taskEntry && tasksMap.has(taskEntry.taskId)) {
                const task = tasksMap.get(taskEntry.taskId);
                task.status = 'failed';
                task.error = err.message || '生成失败';
                task.statusChangedAt = Date.now();
                renderTaskProgress();
                // 更新选中任务显示，让用户看到错误提示
                selectTask(taskEntry.taskId);
            }
            // ==== 新增：使用差异化错误处理 ====
            if (classifyError(err) === ERR_UNAUTHORIZED) {
                showErrorInline(ERROR_CODE_MAP[ERR_UNAUTHORIZED]);
                setTimeout(() => { window.location.href = 'login.html?redirect=studio.html'; }, 1200);
            } else {
                showErrorInline(getFriendlyErrorByCode(classifyError(err)), err.message);
            }
            setButtonReset('再试一次');
        }
    })();
};

// -----------------------------
// 16. 渲染右侧任务面板
// -----------------------------
function renderTaskProgress() {
    const list = document.getElementById('taskCardsList');
    const empty = document.getElementById('taskEmptyState');
    const count = document.getElementById('taskCount');
    if (!list) return;

    const entries = Array.from(tasksMap.entries());

    if (count) count.textContent = entries.length + ' 个';

    if (entries.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = 'flex';
        return;
    }
    if (empty) empty.style.display = 'none';

    entries.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

    const statusMap = {
        'spec_ready': ['规范已就绪', 'bg-amber-100 text-amber-800'],
        'spec_confirming': ['规范确认中', 'bg-amber-100 text-amber-800'],
        'confirmed': ['规范已确认', 'bg-amber-100 text-amber-800'],
        'processing': ['处理中', 'bg-amber-100 text-amber-800'],
        'generating_preview': ['生成预览图中', 'bg-amber-100 text-amber-800'],
        'preview_ready': ['预览图已就绪', 'bg-amber-100 text-amber-800'],
        'generating_multi': ['生成多角度中', 'bg-amber-100 text-amber-800'],
        'multi_ready': ['多角度已就绪', 'bg-amber-100 text-amber-800'],
        'completed': ['已完成', 'bg-forest-100 text-forest-700'],
        'failed': ['失败', 'bg-clay-100 text-clay-700'],
        'no_response': ['无应答', 'bg-clay-100 text-clay-700'],
        'cancelled': ['已取消', 'bg-clay-100 text-clay-700']
    };

    function getStepStates(taskStatus) {
        const s = taskStatus || '';
        if (s === 'failed' || s === 'no_response' || s === 'cancelled') return [2, 2, 2];
        if (s === 'spec_ready' || s === 'spec_confirming' || s === 'confirmed') return [1, 0, 0];
        if (s === 'processing' || s === 'generating_preview') return [2, 1, 0];
        if (s === 'preview_ready') return [2, 2, 0];
        if (s === 'generating_multi') return [2, 2, 1];
        if (s === 'multi_ready' || s === 'completed') return [2, 2, 2];
        return [0, 0, 0];
    }
    const stepLabels = ['规范', '预览图', '多角度'];

    function stepIndicatorHtml(states) {
        const colors = ['bg-sand-300', 'bg-amber-500', 'bg-forest-600'];
        const textColors = ['text-sand-400', 'text-amber-700', 'text-forest-700'];
        return '<div class="step-indicator-inner flex items-center gap-1 mt-1.5 pt-1.5 border-t border-sand-200/50">' +
            stepLabels.map((label, i) => {
                const state = states[i] || 0;
                const dot = '<span class="step-dot w-1.5 h-1.5 rounded-full ' + colors[state] + ' flex-shrink-0"></span>';
                const txt = '<span class="step-label text-[10px] ' + textColors[state] + ' truncate">' + label + '</span>';
                return '<div class="flex items-center gap-1 min-w-0">' + dot + txt + '</div>';
            }).join('<span class="text-[9px] text-sand-300 flex-shrink-0">—</span>') +
        '</div>';
    }

    const existingCards = {};
    list.querySelectorAll('.task-card').forEach(card => {
        existingCards[card.dataset.taskId] = card;
    });

    entries.forEach(([id, task]) => {
        const [statusLabel, statusClass] = statusMap[task.status] || ['处理中', 'bg-amber-100 text-amber-800'];
        const isDone = task.status === 'completed' || task.status === 'failed' || task.status === 'no_response' || task.status === 'cancelled';
        // 安全获取创建时间（防御性转换：后端可能返回 ISO 字符串）
        const createdAt = task.createdAt ? Number(task.createdAt) : Date.now();
        const validCreatedAt = isNaN(createdAt) ? Date.now() : createdAt;
        const endTime = isDone ? (task.statusChangedAt ? Number(task.statusChangedAt) : validCreatedAt) : Date.now();
        const validEndTime = isNaN(endTime) ? Date.now() : endTime;
        const elapsed = Math.max(0, Math.floor((validEndTime - validCreatedAt) / 1000));
        const elapsedStr = elapsed < 60 ? elapsed + '秒' : Math.floor(elapsed / 60) + '分' + (elapsed % 60) + '秒';
        const progress = isDone ? 100 : Math.min(50, 95);

        if (existingCards[id]) {
            // 更新已有卡片
            const card = existingCards[id];
            const badge = card.querySelector('.task-status-badge');
            if (badge) {
                badge.textContent = statusLabel;
                badge.className = 'text-xs px-1.5 py-0.5 rounded flex-shrink-0 ' + statusClass;
            }
            const bar = card.querySelector('.progress-bar');
            if (bar) {
                bar.style.width = progress + '%';
                bar.className = 'progress-bar h-full rounded-full ' + (task.status === 'failed' || task.status === 'no_response' ? 'bg-clay-500' : 'bg-forest-600');
            }
            const stepText = card.querySelector('.task-step-text');
            if (stepText) stepText.textContent = statusLabel;
            const timeText = card.querySelector('.task-time-text');
            if (timeText) timeText.textContent = elapsedStr;
            const previewBtn = card.querySelector('.task-preview-btn');
            if (isDone && task.previewUrl) {
                if (previewBtn) previewBtn.style.display = 'inline-flex';
            } else if (previewBtn) {
                previewBtn.style.display = 'none';
            }
            const errEl = card.querySelector('.task-error-text');
            if (task.status === 'failed' && task.error) {
                if (errEl) {
                    errEl.textContent = task.error;
                    errEl.style.display = 'block';
                } else {
                    const div = document.createElement('div');
                    div.className = 'mt-2 text-xs text-clay-600 truncate task-error-text';
                    div.textContent = task.error;
                    card.appendChild(div);
                }
            } else if (errEl) {
                errEl.style.display = 'none';
            }
            // 更新三段进度指示器
            const stepIndicator = card.querySelector('.step-indicator-inner');
            if (stepIndicator) {
                const states = getStepStates(task.status);
                const colors = ['bg-sand-300', 'bg-amber-500', 'bg-forest-600'];
                const textColors = ['text-sand-400', 'text-amber-700', 'text-forest-700'];
                const dots = stepIndicator.querySelectorAll('.step-dot');
                const labels = stepIndicator.querySelectorAll('.step-label');
                dots.forEach((dot, i) => {
                    const state = states[i] || 0;
                    dot.className = 'step-dot w-1.5 h-1.5 rounded-full ' + colors[state] + ' flex-shrink-0';
                });
                labels.forEach((label, i) => {
                    const state = states[i] || 0;
                    label.className = 'step-label text-[10px] ' + textColors[state] + ' truncate';
                });
            } else {
                const newHtml = stepIndicatorHtml(getStepStates(task.status));
                card.insertAdjacentHTML('beforeend', newHtml);
            }
        } else {
            // 新建卡片
            const isActive = selectedTaskId === id;
            const promptPreview = task.prompt ? task.prompt.slice(0, 30) + (task.prompt.length > 30 ? '...' : '') : '新任务';
            const cardHtml = '<div class="task-card p-3 border ' + (isActive ? 'border-forest-600 bg-forest-50/30 active' : 'border-sand-200 bg-sand-50/60') + ' rounded-lg" data-task-id="' + escapeHtml(id) + '">' +
                '<div class="flex items-start justify-between mb-2">' +
                    '<span class="text-xs text-ink font-medium truncate flex-1 mr-2" title="' + escapeHtml(task.prompt || '') + '">' + escapeHtml(promptPreview) + '</span>' +
                    '<span class="text-xs px-1.5 py-0.5 rounded flex-shrink-0 task-status-badge ' +
                        escapeHtml(statusClass) + '">' +
                        escapeHtml(statusLabel) +
                    '</span>' +
                '</div>' +
                '<div class="w-full h-1.5 bg-sand-200 rounded-full overflow-hidden mb-2">' +
                    '<div class="progress-bar h-full rounded-full ' +
                        (task.status === 'failed' || task.status === 'no_response' ? 'bg-clay-500' : 'bg-forest-600') +
                        '" style="width:' + progress + '%;"></div>' +
                '</div>' +
                '<div class="flex items-center justify-between text-xs text-ink-muted">' +
                    '<span class="task-step-text">' + escapeHtml(statusLabel) + '</span>' +
                    '<span class="task-time-text">' + escapeHtml(elapsedStr) + '</span>' +
                '</div>' +
                stepIndicatorHtml(getStepStates(task.status)) +
                '<div class="mt-2 flex items-center justify-between">' +
                (isDone && task.previewUrl ? '<button type="button" class="task-preview-btn text-xs text-forest-700 hover:text-forest-900 underline inline-flex items-center gap-1" data-task-id="' + escapeHtml(id) + '"><span class="material-symbols-outlined text-[12px]">visibility</span>预览</button>' : '<span></span>') +
                '<button type="button" class="task-delete-btn text-xs text-clay-500 hover:text-clay-700 inline-flex items-center gap-1" data-task-id="' + escapeHtml(id) + '"><span class="material-symbols-outlined text-[14px]">delete</span>删除</button>' +
                '</div>' +
                (task.status === 'failed' && task.error ? '<div class="mt-2 text-xs text-clay-600 truncate task-error-text" title="' + escapeHtml(task.error) + '">' + escapeHtml(task.error) + '</div>' : '') +
            '</div>';
            list.insertAdjacentHTML('beforeend', cardHtml);
        }
    });

    const currentTaskIds = new Set(entries.map(([id]) => id));
    list.querySelectorAll('.task-card').forEach(card => {
        if (!currentTaskIds.has(card.dataset.taskId)) {
            card.remove();
        }
    });

    list.querySelectorAll('.task-card').forEach(card => {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.task-preview-btn')) return;
            const taskId = this.dataset.taskId;
            selectTask(taskId);
        });
    });
    list.querySelectorAll('.task-preview-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const taskId = this.dataset.taskId;
            selectTask(taskId);
        });
    });
    list.querySelectorAll('.task-delete-btn').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            // 防止重复点击
            if (this.disabled) return;
            this.disabled = true;
            this.classList.add('opacity-40', 'cursor-not-allowed');
            const taskId = this.dataset.taskId;
            const token = getAuthToken();
            try {
                await fetch(getAPIUrl() + '/api/workflow/' + taskId, {
                    method: 'DELETE',
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                });
            } catch (_) {
                // 网络错误或 404 都不影响本地删除
            }
            tasksMap.delete(taskId);
            renderTaskProgress();
            saveTasksToStorage();
        });
    });

    if (typeof saveTasksToStorage === 'function') {
        saveTasksToStorage();
    }
}

// 选中任务卡片
function selectTask(taskId) {
    selectedTaskId = taskId;
    document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active', 'border-forest-600', 'bg-forest-50/30'));
    const active = document.querySelector('.task-card[data-task-id="' + taskId + '"]');
    if (active) {
        active.classList.add('active', 'border-forest-600', 'bg-forest-50/30');
    }

    const task = tasksMap.get(taskId);

    const placeholder = document.getElementById('taskPlaceholderState');
    const placeholderText = document.getElementById('taskPlaceholderText');
    const initialState = document.getElementById('initialState');
    const resultGrid = document.getElementById('resultGrid');
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');

    if (initialState) initialState.style.display = 'none';
    if (resultGrid) { resultGrid.style.display = 'none'; resultGrid.classList.add('hidden', 'opacity-0'); }
    if (loadingState) { loadingState.style.display = 'none'; loadingState.classList.add('hidden', 'opacity-0'); }
    if (errorState) { errorState.style.display = 'none'; errorState.style.opacity = '0'; }

    if (!task) {
        if (placeholder) {
            placeholderText.textContent = '任务不存在';
            placeholder.style.display = 'flex';
        }
        return;
    }

    if (task.status === 'completed') {
        if (placeholder) placeholder.style.display = 'none';
        if (window.displayResults) {
            const images = [task.previewUrl, task.multiUrl].filter(Boolean);
            window.displayResults({
                success: true,
                images,
                image_url: task.previewUrl || '',
                message: '生成完成！',
                jobId: taskId,
                infoJson: { timestamp: new Date().toISOString() }
            });
        } else {
            if (initialState) initialState.style.display = 'flex';
        }
    } else if (task.status === 'multi_ready') {
        if (placeholder) placeholder.style.display = 'none';
        if (window.displayResults) {
            const images = [task.previewUrl, task.multiUrl].filter(Boolean);
            window.displayResults({
                success: true,
                images,
                image_url: task.previewUrl || '',
                message: '多角度图已生成',
                jobId: taskId,
                infoJson: { timestamp: new Date().toISOString() }
            });
        }
    } else if (task.status === 'failed' || task.status === 'no_response') {
        if (placeholder) {
            placeholderText.textContent = task.error || (task.status === 'no_response' ? '用户无应答，任务已销毁' : '任务失败');
            placeholder.style.display = 'flex';
        }
    } else {
        if (placeholder) {
            placeholderText.textContent = '任务处理中...';
            placeholder.style.display = 'flex';
        }
    }
}

// 从 task.result 中提取图片 URL（支持路径如 'preview.image_url'，result 可能是 JSON 字符串或对象）
function extractUrlFromResult(result, path) {
    if (!result) return null;
    let obj = result;
    if (typeof result === 'string') {
        try { obj = JSON.parse(result); } catch (_) { return null; }
    }
    if (typeof obj !== 'object' || obj === null) return null;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (!current || typeof current !== 'object') return null;
        current = current[part];
    }
    return (typeof current === 'string' && current.trim()) ? current.trim() : null;
}

// 定期从后端同步 tasksMap（解决多标签页/多人操作导致的状态不一致）
async function syncTasksFromBackend() {
    const token = getAuthToken();
    if (!token) return;

    try {
        const res = await fetch(getAPIUrl() + '/api/workflow', {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!res.ok) return;

        const data = await res.json();
        if (!data.success || !Array.isArray(data.tasks)) return;

        // 同步后端数据到本地 tasksMap
        let changed = false;
        for (const serverTask of data.tasks) {
            const localTask = tasksMap.get(serverTask.id);
            // 统一转换时间字段为数字（后端返回 ISO 字符串 YYYY-MM-DD HH:MM:SS，SQLite datetime('now') 是 UTC）
            // SQLite datetime('now') 返回 UTC，但 new Date() 会将 "YYYY-MM-DD HH:MM:SS" 解析为本地时区
            // 需要手动修正：添加时区偏移，使实际时间与 UTC 一致
            function convertSqliteTime(isoStr) {
                if (!isoStr) return Date.now();
                // YYYY-MM-DD HH:MM:SS → 替换为 T 加上 Z 表示 UTC
                const utcStr = isoStr.replace(' ', 'T') + 'Z';
                const ts = new Date(utcStr).getTime();
                return isNaN(ts) ? new Date(isoStr).getTime() : ts;
            }
            const serverCreated = convertSqliteTime(serverTask.createdAt);
            const serverUpdated = convertSqliteTime(serverTask.updatedAt);
            const serverStatusChanged = convertSqliteTime(serverTask.statusChangedAt);
            const normalizedTask = {
                ...serverTask,
                // 保留前端独有字段（后端不包含这些字段，同步时不会被覆盖）
                // 同时从后端 params.user_input 提取 prompt（后端任务创建时存入的原始用户输入）
                prompt: localTask?.prompt || serverTask.params?.user_input || '',
                spec: localTask?.spec || serverTask.spec || null,
                previewPrompt: localTask?.previewPrompt || '',
                // 从后端 task.result 中提取图片 URL（页面刷新后 localTask 不存在时使用）
                previewUrl: localTask?.previewUrl || extractUrlFromResult(serverTask.result, 'preview.image_url') || '',
                previewFileId: localTask?.previewFileId || '',
                multiUrl: localTask?.multiUrl || extractUrlFromResult(serverTask.result, 'multi.image_url') || '',
                refFileId: localTask?.refFileId || '',
                taskId: serverTask.id,
                createdAt: serverCreated,
                updatedAt: serverUpdated,
                statusChangedAt: serverStatusChanged,
            };
            // 如果本地不存在，或者后端状态更新时间比本地新，更新本地
            if (!localTask || serverUpdated > (localTask.updatedAt || 0)) {
                tasksMap.set(serverTask.id, normalizedTask);
                changed = true;
            }
        }
        // 删除本地存在但后端不存在的任务（已被删除）
        for (const [taskId] of tasksMap) {
            const exists = data.tasks.some(t => t.id === taskId);
            if (!exists) {
                tasksMap.delete(taskId);
                changed = true;
            }
        }

        // 如果有变化，重新渲染并保存到 localStorage
        if (changed) {
            renderTaskProgress();
            saveTasksToStorage();
        }
    } catch (e) {
        // 同步失败不影响本地，静默失败
        console.warn('[syncTasksFromBackend] 同步失败:', e.message);
    }
}

// 定时刷新右侧面板 + 超时检查 + 后端同步
function startTaskProgressPolling() {
    renderTaskProgress();
    // 动态轮询：有活跃任务时每 5 秒，无活跃任务时每 30 秒
    let pollingInterval = 5000;
    let timer = setInterval(() => {
        renderTaskProgress();
        syncTasksFromBackend();
        // 检查是否有活跃任务（非终态）
        const hasActiveTasks = Array.from(tasksMap.values()).some(t => !TERMINAL_STATES.includes(t.status));
        // 根据是否存在活跃任务动态调整轮询间隔
        if (hasActiveTasks && pollingInterval !== 5000) {
            clearInterval(timer);
            pollingInterval = 5000;
            timer = setInterval(renderTaskProgress, pollingInterval);
        } else if (!hasActiveTasks && pollingInterval !== 30000) {
            clearInterval(timer);
            pollingInterval = 30000;
            timer = setInterval(renderTaskProgress, pollingInterval);
        }
    }, pollingInterval);

    // 页面不可见时暂停轮询（节省资源）
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(timer);
        } else {
            // 页面重新可见时立即同步一次后端数据
            syncTasksFromBackend();
            pollingInterval = Array.from(tasksMap.values()).some(t => !TERMINAL_STATES.includes(t.status)) ? 5000 : 30000;
            timer = setInterval(renderTaskProgress, pollingInterval);
        }
    });
}

// 检查超时任务：等待用户响应超过 10 分钟则标记为无应答
function checkStaleTasks() {
    const STALE_TIMEOUT_MS = 10 * 60 * 1000;
    const waitingStates = ['spec_confirming', 'preview_ready', 'multi_ready'];
    const now = Date.now();

    for (const [id, task] of tasksMap.entries()) {
        // 跳过终态任务，避免浪费 CPU 资源
        if (TERMINAL_STATES.includes(task.status)) continue;
        if (!waitingStates.includes(task.status)) continue;

        const lastChange = task.statusChangedAt || task.createdAt || 0;
        if (now - lastChange > STALE_TIMEOUT_MS) {
            console.log('⏰ 任务 ' + id.slice(0, 8) + '... 超时无响应，销毁中');

            task.status = 'no_response';
            task.statusChangedAt = now;
            task.error = '等待用户响应超时';

            const specModal = document.getElementById('specModal');
            const previewModal = document.getElementById('previewModal');
            const multiModal = document.getElementById('multiModal');
            if (specModal && !specModal.classList.contains('hidden')) {
                if (typeof window.closeSpecModal === 'function') window.closeSpecModal();
            }
            if (previewModal && !previewModal.classList.contains('hidden')) {
                if (typeof window.closePreviewModal === 'function') window.closePreviewModal();
            }
            if (multiModal && !multiModal.classList.contains('hidden')) {
                if (typeof window.closeMultiModal === 'function') window.closeMultiModal();
            }

            renderTaskProgress();
            saveTasksToStorage();

            // 超时任务标记为 no_response 后，检查是否所有任务都已结束，重置按钮
            (function checkButtonResetAfterStale() {
                const allTerminal = Array.from(tasksMap.values()).every(t =>
                    ['completed', 'failed', 'no_response', 'cancelled'].includes(t.status)
                );
                if (allTerminal) setButtonReset();
            })();

            (async function() {
                try {
                    const token = getAuthToken();
                    if (!token) return;
                    await fetch(getAPIUrl() + '/api/workflow/' + id, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                        },
                        body: JSON.stringify({ status: 'cancelled', error: '无应答超时' })
                    });
                } catch (_) {}
            })();
        }
    }
}

// 暴露到 window 供 studio.html 弹窗事件调用
window.renderTaskProgress = renderTaskProgress;
window.selectTask = selectTask;
window.startTaskProgressPolling = startTaskProgressPolling;
window.checkStaleTasks = checkStaleTasks;

// -----------------------------
// 17. 显示结果
// -----------------------------
window.displayResults = function displayResults(data) {
    // 防抖：同一任务 2 秒内重复调用直接忽略
    const taskId = data.jobId || data.taskId || 'unknown';
    if (_lastDisplayResult.taskId === taskId && Date.now() - _lastDisplayResult.timestamp < 2000) {
        console.warn('[displayResults] 重复调用已忽略:', taskId.slice(0, 8));
        return;
    }
    _lastDisplayResult = { taskId, timestamp: Date.now() };

    console.log('🎨 展示结果数据:', data);
    hideAllStates();

    // 标题 & 元数据
    let title = 'Concept · 香水概念';
    let meta = `生成时间: ${new Date().toLocaleString()}`;

    if (data.infoJson) {
        const info = data.infoJson.extracted_infojson || data.infoJson.response_data || data.infoJson;
        if (info && typeof info === 'object') {
            if (info.title || info.name || info.concept) title = info.title || info.name || info.concept;
            if (info.workflow_id) meta += ` · Workflow: ${info.workflow_id}`;
            if (info.timestamp) meta = `生成时间: ${new Date(info.timestamp).toLocaleString()}`;
        }
    }
    resultConceptTitle.textContent = title;
    resultConceptMeta.textContent = meta;

    renderRawError(data);

    const images = extractImages(data);
    renderImages(images, data);

    let downloadUrl = data.downloadUrl || (data.infoJson && data.infoJson.downloadUrl);
    let fileName = data.fileName || (data.infoJson && data.infoJson.fileName) || 'perfume_lookbook.docx';
    if (downloadUrl) {
        attachDownloadUrl(downloadUrl, fileName);
    }

    resultGrid.style.display = 'block';
    resultGrid.classList.add('result-fade-in');
    requestAnimationFrame(() => resultGrid.classList.remove('hidden', 'opacity-0'));
    setTimeout(() => {
        resultGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    saveToHistory({
        prompt: promptInput ? promptInput.value.trim() : (tasksMap.get(taskId)?.prompt || ''),
        title: title,
        imageUrls: images,
        docId: downloadUrl || '',
        status: 'completed',
        options: {
            fragrances: collectSelectedOptions('fragranceTags'),
            moods: collectSelectedOptions('moodTags'),
            style: collectSelectedOptions('styleSelect', true)
        }
    });
};

// -----------------------------
// 18. 图片 URL 安全过滤
// -----------------------------
const ALLOWED_IMAGE_HOSTS = [
    'googleusercontent.com', 'gstatic.com', 'picassousercontent.com',
    'coze.cn', 'coze.com', 'cdn.jsdelivr.net', 'unpkg.com',
    'vercel.app', 'blob.core.windows.net', 's3.amazonaws.com',
    'miheai.com', 'aliyuncs.com'
];

function sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (!/^https?:\/\//i.test(url)) return null;
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const allowed = ALLOWED_IMAGE_HOSTS.some(h =>
            hostname === h || hostname.endsWith('.' + h)
        );
        if (!allowed) return null;
        const safe = url.replace(/['"`\\]/g, '');
        if (safe.length > 2048) return null;
        return safe;
    } catch (_) {
        return null;
    }
}

// -----------------------------
// 19. 提取图片 URL
// -----------------------------
function extractImages(data) {
    const found = [];

    const directKeys = ['images', 'imageUrls', 'conceptImages', 'pictures', 'photos'];
    for (const k of directKeys) {
        if (Array.isArray(data[k])) found.push(...data[k].filter(x => typeof x === 'string'));
    }

    if (typeof data.outData === 'string') {
        try {
            const o = JSON.parse(data.outData);
            for (const k of directKeys) {
                if (Array.isArray(o[k])) found.push(...o[k].filter(x => typeof x === 'string'));
            }
            if (typeof o.image === 'string') found.push(o.image);
        } catch (_) {}
    }

    if (data.infoJson) {
        const candidates = [
            data.infoJson.images,
            data.infoJson.imageUrls,
            data.infoJson.conceptImages,
            data.infoJson.response_data && data.infoJson.response_data.images,
            data.infoJson.response_data && data.infoJson.response_data.imageUrls,
            data.infoJson.extracted_infojson && data.infoJson.extracted_infojson.images,
            data.infoJson.extracted_infojson && data.infoJson.extracted_infojson.imageUrls,
        ];
        for (const c of candidates) {
            if (Array.isArray(c)) found.push(...c.filter(x => typeof x === 'string'));
        }
    }

    const unique = [...new Set(found.map(sanitizeImageUrl).filter(Boolean))];
    return unique;
}

// -----------------------------
// 20. 渲染工作流原始错误详情
// -----------------------------
window.renderRawError = function renderRawError(data) {
    if (!rawErrorContainer || !rawErrorContent) return;
    rawErrorContainer.style.display = 'none';
    if (rawErrorDebugLink) rawErrorDebugLink.style.display = 'none';

    let rawError = data.rawError || '';
    let debugUrl = data.debug_url || null;

    if (!rawError) {
        // 从 tasksMap 中查找错误信息
        for (const task of tasksMap.values()) {
            if (task.status === 'failed' && task.error) {
                rawError = task.error;
                break;
            }
        }
    }

    if (!rawError) return;

    rawErrorContainer.style.display = 'block';
    rawErrorContent.textContent = rawError;

    if (debugUrl && rawErrorDebugLink) {
        rawErrorDebugLink.href = debugUrl;
        rawErrorDebugLink.style.display = 'inline-block';
    }
};

// -----------------------------
// 21. 渲染图片网格
// -----------------------------
function renderImages(urls, data = {}) {
    const defaultViews = ['Front View · 正面', '45° Perspective · 透视', 'Side Profile · 侧面', 'Detail · 细节', 'Backdrop · 场景'];

    imagesContainer.innerHTML = '';

    if (!urls || urls.length === 0) {
        const isWorkflowInvoked = data.workflowInvoked || data.workflow_status === 'invoked_but_image_node_unconfigured';
        const isError = data.success === false;

        if (isError) {
            const safeDebugUrl = data.debug_url ? escapeHtml(data.debug_url) : '';
            const safeMessage = escapeHtml(getFriendlyErrorMessage(data.message || ''));
            imagesContainer.innerHTML = `
                <div class="col-span-full md:col-span-3 bg-surface-container-low/40 border border-red-500/30 rounded-xl p-10 text-center backdrop-blur">
                    <span class="material-symbols-outlined text-[48px] text-red-400/60 block mb-4">error_outline</span>
                    <p class="font-body-md text-on-surface/70 leading-relaxed">
                        生成失败了，请稍后重试 🙏<br>
                        <span class="text-red-300/70 text-sm">${safeMessage}</span>
                    </p>
                    ${safeDebugUrl ? `<a href="${safeDebugUrl}" target="_blank" rel="noopener" class="inline-block mt-3 text-primary underline text-sm">查看执行轨迹 →</a>` : ''}
                </div>
            `;
        } else if (isWorkflowInvoked) {
            const safeDebugUrl = data.debug_url ? escapeHtml(data.debug_url) : '';
            imagesContainer.innerHTML = `
                <div class="col-span-full md:col-span-3 bg-surface-container-low/40 border border-primary/30 rounded-xl p-10 text-center backdrop-blur">
                    <span class="material-symbols-outlined text-[48px] text-primary/60 block mb-4">check_circle</span>
                    <p class="font-body-md text-on-surface/80 leading-relaxed">
                        <strong class="text-primary">✅ 工作流已成功调用</strong><br>
                        API 对接正常，工作流已到达生图节点。<br>
                        <span class="text-on-surface/50 text-sm">生图节点未配置 API，暂无法返回概念图。</span>
                    </p>
                    <p class="mt-4 text-on-surface/40 text-sm">请在 Coze 工作流中配置生图节点 API 后即可完整运行</p>
                    ${safeDebugUrl ? `<a href="${safeDebugUrl}" target="_blank" rel="noopener" class="inline-block mt-3 text-primary underline text-sm">查看执行轨迹 →</a>` : ''}
                </div>
            `;
        } else {
            imagesContainer.innerHTML = `
                <div class="col-span-full md:col-span-3 bg-surface-container-low/40 border border-primary/20 rounded-xl p-10 text-center backdrop-blur">
                    <span class="material-symbols-outlined text-[48px] text-primary/40 block mb-4">image_not_supported</span>
                    <p class="font-body-md text-on-surface/70 leading-relaxed">
                        当前工作流尚未返回概念图。<br>
                        请稍后刷新工作流以返回图片数据，或直接下载下方宣传册查看完整内容 ✨
                    </p>
                </div>
            `;
        }
        return;
    }

    urls.forEach((url, idx) => {
        const label = defaultViews[idx] || `View ${idx + 1}`;
        const safeLabel = escapeHtml(label);
        const isCenter = (urls.length >= 3 && idx === 1);

        const wrap = document.createElement('div');
        wrap.className = 'group relative cursor-pointer';
        wrap.style.marginTop = isCenter ? '0' : (urls.length >= 3 ? '1.5rem' : '1rem');
        wrap.dataset.imageIdx = idx;
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', `概念图 ${idx + 1}: ${label}`);

        wrap.innerHTML = `
            <div class="aspect-[3/4] rounded-xl overflow-hidden border ${isCenter ? 'border-primary/50 shadow-[0_0_30px_rgba(212,175,55,0.15)]' : 'border-primary/20 shadow-lg'} relative ${isCenter ? 'md:-translate-y-6' : ''}">
                <div class="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors duration-500 z-10 pointer-events-none"></div>
                <div class="absolute inset-0 border border-primary/0 group-hover:border-primary/50 transition-colors duration-500 z-20 pointer-events-none rounded-xl"></div>
                <img class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                     src="${escapeAttr(url)}"
                     alt="概念图 ${idx + 1}: ${safeLabel}"
                     loading="lazy"
                     decoding="async"
                     onerror="this.style.display='none'; this.parentElement.querySelector('.img-fallback').style.display='flex';">
                <div class="img-fallback absolute inset-0 hidden flex-col items-center justify-center bg-surface-container text-outline gap-2">
                    <span class="material-symbols-outlined text-[40px]">broken_image</span>
                    <span class="text-xs">图片加载失败</span>
                </div>
                <div class="absolute bottom-4 left-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <span class="material-symbols-outlined text-primary shadow-sm bg-surface/50 rounded-full p-2 backdrop-blur-sm">zoom_in</span>
                </div>
            </div>
            <div class="mt-4 flex flex-col items-center">
                <span class="font-headline-md text-body-lg ${isCenter ? 'text-primary font-bold tracking-wide' : 'text-primary/80'}">${safeLabel}</span>
                <span class="w-${isCenter ? '12' : '6'} h-[1px] bg-primary/${isCenter ? '80' : '30'} mt-2"></span>
            </div>
        `;

        wrap.addEventListener('click', () => openModalWithUrl(url));
        imagesContainer.appendChild(wrap);
    });

    if (urls.length <= 2) {
        imagesContainer.classList.remove('md:grid-cols-3');
        imagesContainer.classList.add('md:grid-cols-' + Math.max(urls.length, 1), 'justify-items-center', 'gap-10');
    }
}

// -----------------------------
// 22. 下载宣传册按钮
// -----------------------------
function attachDownloadUrl(url, fileName) {
    if (!downloadBrochureBtn) return;
    downloadBrochureBtn.disabled = false;
    downloadBrochureBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    downloadBrochureBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'perfume_lookbook.docx';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    downloadBrochureBtnText.textContent = '下载宣传册';
    console.log('🔗 已绑定下载链接:', url, '→', fileName);
}

// -----------------------------
// 23. 异步调用 generate-document 生成文档
// -----------------------------
async function triggerAsyncDocumentGeneration(data) {
    try {
        const workflowData = (data.infoJson && (data.infoJson.extracted_infojson || data.infoJson.response_data)) || data.outData || data;
        if (!workflowData) return;

        const API_BASE_URL = getAPIUrl();
        const apiUrl = `${API_BASE_URL}/api/generate-document`;
        console.log('📄 调用文档生成 API:', apiUrl);

        const token = getAuthToken();
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ workflowData })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        console.log('✅ 文档生成成功:', result);
        attachDownloadUrl(result.downloadUrl, result.fileName);
    } catch (err) {
        console.warn('文档生成失败（不影响图片展示）:', err);
        if (downloadBrochureBtnText) downloadBrochureBtnText.textContent = '文档生成中';
    }
}

// -----------------------------
// 24. 错误提示
// -----------------------------
function getFriendlyErrorMessage(errMsg, errCode) {
    const combined = String(errMsg || '') + ' ' + String(errCode || '');
    const lower = combined.toLowerCase();
    const ERROR_CODE_MAP = [
        { patterns: ['402', '积分', '余额', 'insufficient'], message: '当前积分不足，请联系管理员充值 🙏' },
        { patterns: ['401', '未登录', 'login', 'unauthorized'], message: '登录已过期，请重新登录' },
        { patterns: ['403', '禁止', 'forbidden'], message: '没有权限执行此操作' },
        { patterns: ['404', 'not found'], message: '服务暂时不可用，请稍后重试' },
        { patterns: ['timeout', '超时', '连接', 'network', 'ETIMEDOUT', 'ECONNREFUSED'], message: '网络连接异常，请检查网络后重试 🌐' },
        { patterns: ['cancel', '取消'], message: '生成已取消' }
    ];
    for (const entry of ERROR_CODE_MAP) {
        for (const p of entry.patterns) {
            if (lower.includes(p.toLowerCase())) return entry.message;
        }
    }
    return '生成失败了，请稍后重试 🙏';
}

function showErrorInline(msg, errorDetail) {
    hideAllStates();
    const friendlyMsg = getFriendlyErrorMessage(msg, errorDetail);
    if (errorDetail) console.error('[技术错误详情]', errorDetail);
    else if (msg) console.error('[原始错误]', msg);
    if (errorText) errorText.textContent = friendlyMsg;
    errorState.style.display = 'flex';
    requestAnimationFrame(() => errorState.classList.remove('hidden', 'opacity-0'));
    setTimeout(() => {
        errorState.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
}

// -----------------------------
// 25. Toast 提示
// -----------------------------
function showToast(msg, type = 'success') {
    const existing = document.getElementById('kmToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'kmToast';
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px; z-index: 9999;
        display: flex; align-items: center; gap: 10px;
        padding: 14px 20px; border-radius: 8px;
        font-size: 14px; font-family: inherit;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        opacity: 0; transform: translateY(-12px);
        transition: opacity 0.35s ease, transform 0.35s ease;
        max-width: 400px; word-break: break-word;
    `;
    const isSuccess = type === 'success';
    toast.style.background = isSuccess ? '#eaf5e6' : '#fef3e9';
    toast.style.color = isSuccess ? '#2d4a1e' : '#8a5d1a';
    toast.style.border = isSuccess ? '1px solid #b8d4a8' : '1px solid #f0cfb0';
    toast.innerHTML = `
        <span style="font-size:20px;flex-shrink:0;">${isSuccess ? '✅' : 'ℹ️'}</span>
        <span style="flex:1;">${escapeHtml(msg)}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// -----------------------------
// 26. Modal 大图预览
// -----------------------------
function openModalWithUrl(url) {
    modalImage.style.backgroundImage = `url('${encodeURI(url)}')`;
    imageModal.classList.remove('hidden');
    imageModal.classList.add('flex');
    setTimeout(() => imageModal.classList.remove('opacity-0'), 10);
    document.body.style.overflow = 'hidden';
}

window.closeModal = function () {
    imageModal.classList.add('opacity-0');
    setTimeout(() => {
        imageModal.classList.add('hidden');
        imageModal.classList.remove('flex');
        document.body.style.overflow = 'auto';
    }, 300);
};

// ESC 关闭 Modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !imageModal.classList.contains('hidden')) {
        window.closeModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !generateBtn.disabled) {
        form.dispatchEvent(new Event('submit'));
    }
});

// -----------------------------
// 27. 设计规范提取与渲染
// -----------------------------
function extractDesignSpecs(text) {
    const specs = {};

    const scentKeywords = ['木质', '花香', '柑橘', '海洋', '东方', '果香', '皮革', '烟草', '琥珀', '麝香',
        '檀香', '茉莉', '玫瑰', '薰衣草', '雪松', '松针', '乳香', '没药', '鸢尾', '紫罗兰',
        '佛手柑', '柠檬', '橙花', '绿茶', '白茶', '胡椒', '肉桂', '香草', '可可', '咖啡',
        '无花果', '桃子', '浆果', '葡萄柚', '橘子', '薄荷', '茴香', '杜松', '丝柏', '广藿香',
        '泥土', '矿物', '苔藓', '蜂蜜', '朗姆酒', '白兰地', '焚香', '树脂', 'wood', 'flower',
        'citrus', 'marine', 'oriental', 'fruity', 'leather', 'tobacco', 'amber', 'musk'];
    const foundScents = scentKeywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
    if (foundScents.length > 0) specs.香调 = foundScents.slice(0, 6);

    const moodKeywords = ['静谧', '活力', '神秘', '浪漫', '优雅', '温暖', '清新', '深邃', '甜美', '性感',
        '宁静', '奢华', '简约', '自然', '都市', '古典', '现代', '柔和', '浓郁', '清冽',
        'serene', 'vibrant', 'mysterious', 'romantic', 'elegant', 'warm', 'fresh', 'deep',
        'sweet', 'sensual', 'calm', 'luxury', 'simple', 'natural', 'urban', 'classic'];
    const foundMoods = moodKeywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
    if (foundMoods.length > 0) specs.氛围 = foundMoods.slice(0, 4);
    else if (text.length > 10) specs.氛围 = ['（自定义）'];

    const sceneKeywords = ['森林', '花园', '海洋', '沙漠', '城市', '庙宇', '图书馆', '厨房', '市场',
        '清晨', '黄昏', '夜晚', '月光', '阳光', '雨', '雪', '雾', '风',
        '森林', 'mountain', 'sea', 'garden', 'city', 'temple', 'library'];
    const foundScenes = sceneKeywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
    if (foundScenes.length > 0) specs.场景 = foundScenes.slice(0, 4);

    const audienceKeywords = ['男性', '女性', '男女', '中性', '男士', '女士', '年轻', '成熟', '商务',
        'man', 'woman', 'men', 'women', 'unisex', 'young', 'mature', 'professional'];
    const foundAudience = audienceKeywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
    if (foundAudience.length > 0) specs.目标人群 = foundAudience.slice(0, 3);

    return specs;
}

function renderSpecCards(specs) {
    const container = document.getElementById('specDisplay');
    if (!container) return '';
    const iconMap = {
        '香调': 'local_florist',
        '氛围': 'psychology',
        '场景': 'landscape',
        '目标人群': 'group',
        '风格': 'palette'
    };
    let html = '';
    for (const [key, values] of Object.entries(specs)) {
        if (values && values.length > 0) {
            const icon = iconMap[key] || 'check_circle';
            const safeKey = escapeHtml(key);
            const safeValues = values.map(v => escapeHtml(v));
            html += `
                <div class="bg-sand-100/60 border border-sand-200 p-4">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="material-symbols-outlined text-[16px] text-forest-600">${icon}</span>
                        <span class="text-xs tracking-widest uppercase text-forest-700 font-medium">${safeKey}</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        ${safeValues.map(v => `<span class="px-2.5 py-1 text-xs bg-white border border-sand-200 text-ink rounded">${v}</span>`).join('')}
                    </div>
                </div>
            `;
        }
    }
    if (!html) {
        html = `<div class="bg-sand-100/60 border border-sand-200 p-5 text-center"><p class="text-sm text-ink-muted">AI 已收到你的灵感，将自动解析设计规范</p></div>`;
    }
    container.innerHTML = html;
}

// -----------------------------
// 28. 确认生成 Modal
// -----------------------------
function showConfirmGenerateModal(promptText) {
    const modal = document.getElementById('confirmModal');
    const promptEl = document.getElementById('promptText');
    if (!modal) return;

    if (promptEl) promptEl.textContent = promptText || '（空）';

    const specs = extractDesignSpecs(promptText || '');
    renderSpecCards(specs);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    document.body.style.overflow = 'hidden';
}

window.closeConfirmModal = function () {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        document.body.style.overflow = 'auto';
    }, 300);
};

// 显示清空任务确认弹窗（Promise 方式）
function showClearConfirmModal(total) {
    return new Promise(resolve => {
        const modal = document.getElementById('clearConfirmModal');
        if (!modal) {
            // 弹窗不存在，回退到原生 confirm
            resolve(confirm(`确认清空全部 ${total} 个任务吗？此操作不可撤销。`));
            return;
        }

        const msgEl = document.getElementById('clearConfirmMsg');
        if (msgEl) {
            msgEl.textContent = `确认清空全部 ${total} 个任务吗？此操作不可撤销。`;
        }

        // 显示弹窗（使用 active 类控制 display:flex）
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // 绑定按钮事件（一次性）
        const cancelBtn = document.getElementById('clearConfirmCancelBtn');
        const okBtn = document.getElementById('clearConfirmOkBtn');

        function close() {
            modal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }

        function cleanup() {
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
            if (okBtn) okBtn.removeEventListener('click', onOk);
        }

        function onCancel() {
            cleanup();
            close();
            resolve(false);
        }

        function onOk() {
            cleanup();
            close();
            resolve(true);
        }

        if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
        if (okBtn) okBtn.addEventListener('click', onOk);

        // ESC 关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', escHandler);
                cleanup();
                close();
                resolve(false);
            }
        };
        document.addEventListener('keydown', escHandler);

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.removeEventListener('keydown', escHandler);
                cleanup();
                close();
                resolve(false);
            }
        }, { once: true });
    });
}

// ESC 关闭确认弹窗
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const confirmModal = document.getElementById('confirmModal');
        if (confirmModal && !confirmModal.classList.contains('hidden')) {
            window.closeConfirmModal();
        }
    }
});

// -----------------------------
// 29. 页面初始化
// -----------------------------
document.addEventListener('DOMContentLoaded', () => {
    initUIInteractions();
    if (promptInput) promptInput.focus();
    setTimeout(() => document.body.classList.add('loaded'), 100);

    // 从 localStorage 恢复任务列表
    loadTasksFromStorage();

    // ==== 新增：启动任务面板渲染 + 定时刷新 + 超时检查 ====
    startTaskProgressPolling();

    // 侧边栏 + 移动端「新建任务」按钮
    document.querySelectorAll('#newTaskBtn, #newTaskBtnMobile, #newTaskBtnSidebar').forEach(btn => {
        if (btn) btn.addEventListener('click', () => {
            // 判断当前页面是否为工坊页
            const isStudio = document.getElementById('studio') !== null;
            if (!isStudio) {
                // 非工坊页面 → 跳转到工坊
                window.location.href = 'studio.html';
                return;
            }
            // 工坊页面 → 滚动到输入区域并聚焦
            const main = document.getElementById('studio');
            if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (promptInput) {
                promptInput.focus();
                promptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });

    // 右侧任务面板 - 清空全部任务
    const clearBtn = document.getElementById('clearAllTasksBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            const total = tasksMap.size;
            if (total === 0) {
                showToast('当前没有任务可清空');
                return;
            }

            // 使用自定义确认弹窗替代原生 confirm，避免浏览器兼容性问题
            const confirmed = await showClearConfirmModal(total);
            if (!confirmed) return;

            try {
                const token = getAuthToken();
                const res = await fetch(`${getAPIUrl()}/api/workflow/clear`, {
                    method: 'DELETE',
                    headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
                });
                const data = await res.json();
                if (data.success) {
                    tasksMap.clear();
                    saveTasksToStorage();
                    renderTaskProgress();
                    setButtonReset();
                    showToast(`已清空 ${data.deletedCount || total} 个任务`);
                } else {
                    showToast('清空失败：' + (data.error || '未知错误'));
                }
            } catch (e) {
                showToast('清空失败：' + e.message);
            }
        });
    }
});

// End of file