// 历史记录路由
import { Router } from 'express';
import { addHistory, getHistoryList, getHistoryById, deleteHistory, clearHistory } from '../../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

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
    let { prompt, style, title, images, imageUrls, brochure_url, docId, options, tags } = req.body;
    if (!prompt || !String(prompt).trim()) {
        // 缺少 prompt 时使用默认占位，避免前端空数据报 400
        prompt = '（无描述）';
    }
    const item = addHistory(req.user.id, {
        prompt,
        title: title || style,
        imageUrls: imageUrls || images,
        docId: docId || brochure_url,
        options: { ...options, tags }
    });
    res.json({ success: true, id: item ? item.id : null });
});

// DELETE /api/history/:id
router.delete('/:id', requireAuth, (req, res) => {
    if (!getHistoryById(req.user.id, req.params.id))
        return res.status(404).json({ error: '记录不存在' });
    deleteHistory(req.user.id, req.params.id);
    res.json({ success: true });
});

// DELETE /api/history (clear all)
router.delete('/', requireAuth, (req, res) => {
    clearHistory(req.user.id);
    res.json({ success: true });
});

export default router;