// 遗留路由 - check-status / download / start-workflow / generate-document（EdgeOne 版）
import { Router } from 'express';
import { put } from '@vercel/blob';
import { CONFIG } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

let redis = null;
export function setRedis(r) { redis = r; }

const router = Router();

// ========== GET /api/check-status ==========
router.get('/check-status', async (req, res) => {
    try {
        const { jobId } = req.query;
        if (!jobId || typeof jobId !== 'string')
            return res.status(400).json({ error: 'Invalid jobId', message: '请提供有效的任务 ID' });
        // EdgeOne 无 Redis，返回空状态
        return res.json({ success: false, error: 'Job not found', jobId });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// ========== POST /api/download ==========
router.post('/download', async (req, res) => {
    try {
        const { docId, documentId, fileName } = req.body;
        const finalDocId = docId || documentId;
        if (!finalDocId) return res.status(400).json({ error: '请提供文档 ID' });

        const docResponse = await fetch(`https://docs.google.com/document/d/${finalDocId}/export?format=docx`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (!docResponse.ok) throw new Error(`下载文档失败: ${docResponse.status}`);

        const docBuffer = await docResponse.arrayBuffer();
        const finalFileName = fileName || `document_${Date.now()}.docx`;
        const blob = await put(finalFileName, new Uint8Array(docBuffer), {
            access: 'public',
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        return res.json({ success: true, downloadUrl: blob.url, fileName: finalFileName });
    } catch (error) {
        return res.status(500).json({ error: 'Document processing error', message: error.message });
    }
});

// ========== POST /api/generate-document ==========
router.post('/generate-document', requireAuth, async (req, res) => {
    try {
        const { job_id, workflowData } = req.body;
        if (!workflowData) return res.status(400).json({ error: '请提供 workflowData' });
        // EdgeOne 简化版：直接调用 Google Apps Script
        const gasResponse = await fetch('https://script.google.com/macros/s/AKfycbw44ekOAjkT0xc1ZkQhiIQowZRot_cGTsKd4Z6dVUATM8ROGQMvue3rAWueqb7WEzmlEw/exec', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: workflowData, source: 'coze-workflow', timestamp: new Date().toISOString() })
        });
        if (!gasResponse.ok) throw new Error(`Google Apps Script 调用失败: ${gasResponse.status}`);
        const gasData = await gasResponse.json();
        const docId = gasData.docId || gasData.documentId || gasData.id;
        if (!docId) throw new Error('未能从 Google Apps Script 获取文档 ID');
        return res.json({ success: true, documentUrl: null, docId });
    } catch (e) {
        return res.status(500).json({ error: '生成文档失败', details: e.message });
    }
});

// ========== POST /api/start-workflow (旧版非流式) ==========
router.post('/start-workflow', requireAuth, async (req, res) => {
    try {
        const { input } = req.body;
        if (!input || typeof input !== 'string' || input.trim() === '')
            return res.status(400).json({ error: 'Invalid input', message: '请提供有效的输入内容' });
        // EdgeOne 建议使用新版流式工作流
        return res.status(400).json({ error: '请使用新版工作流 API', message: '请使用 POST /api/workflow/start' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

export default router;