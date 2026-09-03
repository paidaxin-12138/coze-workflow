// 历史记录路由（EdgeOne 版）
import { Router } from 'express';
import { addHistory, getHistoryList, getHistoryById, deleteHistory, clearHistory } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/history
router.get('/', requireAuth, async (req, res) => {
    if (req.query.id) {
        const item = await getHistoryById(req.user.id, req.query.id);
        if (!item) return res.status(404).json({ success: false, error: '记录不存在' });
        return res.json({ success: true, item });
    }
    const items = await getHistoryList(req.user.id);
    res.json({ success: true, items });
});

// POST /api/history
router.post('/', requireAuth, async (req, res) => {
    let { prompt, style, title, images, imageUrls, brochure_url, docId, options, tags } = req.body;
    if (!prompt || !String(prompt).trim()) {
        // 缺少 prompt 时使用默认占位，避免前端空数据报 400
        prompt = '（无描述）';
    }
    const item = await addHistory(req.user.id, {
        prompt,
        title: title || style,
        imageUrls: imageUrls || images,
        docId: docId || brochure_url,
        options: { ...options, tags }
    });
    res.json({ success: true, id: item ? item.id : null });
});

// DELETE /api/history/:id
router.delete('/:id', requireAuth, async (req, res) => {
    const item = await getHistoryById(req.user.id, req.params.id);
    if (!item) return res.status(404).json({ error: '记录不存在' });
    await deleteHistory(req.user.id, req.params.id);
    res.json({ success: true });
});

// DELETE /api/history (clear all)
router.delete('/', requireAuth, async (req, res) => {
    await clearHistory(req.user.id);
    res.json({ success: true });
});

export default router;