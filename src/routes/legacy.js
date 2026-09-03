// 遗留路由 - 已废弃，保留空路由占位（避免 index.js 导入报错）
import { Router } from 'express';

let redis;
export function setRedis(r) { redis = r; }

const router = Router();

// 所有旧路由已移除
// - /check-status: 不再使用轮询
// - /start-workflow: 改为三步非流式工作流
// - /download: 不再使用
// - /generate-document: 不再使用

export default router;