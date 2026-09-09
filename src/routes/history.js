// 历史记录路由
import { Router } from 'express';
import { addHistory, getHistoryList, getHistoryById, deleteHistory, clearHistory } from '../../db.js';
import { requireAuth } from '../middleware/auth.js';
import OSS from 'ali-oss';

const router = Router();

/**
 * 从 OSS URL 中提取对象键
 */
function getOSSKeyFromUrl(url) {
    try {
        const u = new URL(url);
        return u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
    } catch { return null; }
}

/**
 * 批量删除 OSS 文件
 */
async function deleteOSSFiles(urls) {
    if (!urls || urls.length === 0) return;
    const requiredEnv = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'];
    const missing = requiredEnv.filter(k => !process.env[k]);
    if (missing.length > 0) {
        console.error(`[OSS] 配置缺失: ${missing.join(', ')}，无法删除历史记录文件`);
        return;
    }
    const client = new OSS({
        region: process.env.OSS_REGION,
        accessKeyId: process.env.OSS_ACCESS_KEY_ID,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
        bucket: process.env.OSS_BUCKET,
    });
    const keys = urls.map(u => getOSSKeyFromUrl(u)).filter(Boolean);
    if (keys.length === 0) return;
    try {
        await client.deleteMulti(keys);
        console.log(`[OSS] 已删除 ${keys.length} 个历史记录文件`);
    } catch (e) {
        console.warn('[OSS] 批量删除失败:', e.message);
    }
}

/**
 * 从历史记录项中收集所有图片 URL
 */
function collectHistoryUrls(item) {
    const urls = [];
    if (item.imageUrls && Array.isArray(item.imageUrls)) {
        urls.push(...item.imageUrls);
    }
    if (item.thumbnail) urls.push(item.thumbnail);
    // docId 可能是图片 URL 也可能是文档 ID，仅当包含 http 时视为 URL
    if (item.docId && String(item.docId).startsWith('http')) urls.push(item.docId);
    return urls;
}

// GET /api/history
router.get('/', requireAuth, (req, res) => {
    if (req.query.id) {
        const item = getHistoryById(req.user.id, req.query.id);
        if (!item) return res.status(404).json({ success: false, error: '记录不存在' });
        return res.json({ success: true, item });
    }
    res.json({ success: true, items: getHistoryList(req.user.id) });
});

// POST /api/history
router.post('/', requireAuth, (req, res) => {
    let { prompt, style, title, images, imageUrls, brochure_url, docId, options, tags, taskId } = req.body;
    if (!prompt || !String(prompt).trim()) {
        // 缺少 prompt 时使用默认占位，避免前端空数据报 400
        prompt = '（无描述）';
    }
    const item = addHistory(req.user.id, {
        prompt,
        title: title || style,
        imageUrls: imageUrls || images,
        docId: docId || brochure_url,
        options: { ...options, tags },
        taskId
    });
    res.json({ success: true, id: item ? item.id : null });
});

// DELETE /api/history/:id
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const item = getHistoryById(req.user.id, req.params.id);
        if (!item) return res.status(404).json({ error: '记录不存在' });

        // 清理 OSS 文件
        const urls = collectHistoryUrls(item);
        if (urls.length > 0) {
            await deleteOSSFiles(urls);
        }

        deleteHistory(req.user.id, req.params.id);
        res.json({ success: true, message: '记录及关联图片已删除' });
    } catch (e) {
        console.error('[DELETE /history/:id]', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// DELETE /api/history (clear all)
router.delete('/', requireAuth, async (req, res) => {
    try {
        const items = getHistoryList(req.user.id);
        const allUrls = [];
        for (const item of items) {
            allUrls.push(...collectHistoryUrls(item));
        }
        if (allUrls.length > 0) {
            await deleteOSSFiles(allUrls);
        }
        clearHistory(req.user.id);
        res.json({ success: true, message: '所有历史记录及关联图片已删除' });
    } catch (e) {
        console.error('[DELETE /history]', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;