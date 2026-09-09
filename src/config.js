// 共享配置 - 从环境变量加载
import { config as dotenvConfig } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 在 index.js 导入之前抢先加载 .env.local，确保 config 读取时 env 已就绪
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
for (const f of ['.env.local', '.env']) {
    const p = path.resolve(__dirname, '..', f);
    if (fs.existsSync(p)) {
        try {
            dotenvConfig({ path: p, override: true });
        } catch (_) {}
    }
}

export const CONFIG = {
    PORT: process.env.PORT || 3000,

    // ===== 安全 CORS 白名单 =====
    ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(o => o.length > 0),

    // Coze 工作流配置
    COZE_APP_ID: process.env.COZE_APP_ID,

    // 三步工作流 ID
    WF_SPEC_ID: process.env.WF_SPEC_ID || '',           // 规范生成工作流
    WF_PREVIEW_ID: process.env.WF_PREVIEW_ID || '',     // 预览图生成工作流
    WF_MULTI_ID: process.env.WF_MULTI_ID || '',         // 多角度生成工作流

    // 仿香工作流 ID
    COPY_WORKFLOW_ID: process.env.COPY_WORKFLOW_ID || '7680825923813900314',
    TWEAK_WORKFLOW_ID: process.env.TWEAK_WORKFLOW_ID || process.env.COPY_WORKFLOW_ID || '7680825923813900314',

    // Coze 鉴权 Token（兼容旧变量名）
    KM_COZE_TOKEN: process.env.KM_COZE_TOKEN || process.env.COZE_API_KEY || '',

    // 并发任务数限制（可选）
    KM_MAX_CONCURRENT: parseInt(process.env.KM_MAX_CONCURRENT || '3', 10),

    // 速率限制配置（可选）
    RATE_LIMIT: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
        max: parseInt(process.env.RATE_LIMIT_MAX || '30', 10),
    },

    // 节点空闲超时（可选）
    NODE_IDLE_TIMEOUT_MS: parseInt(process.env.NODE_IDLE_TIMEOUT_MS || '360000', 10),
};

// ===== 启动时强制校验必填变量 =====
// 主项目基于 SQLite（better-sqlite3），SUPABASE_URL / SUPABASE_ANON_KEY 仅在独立的 edgeone-deploy（Supabase 版）中使用，
// 本服务不依赖 Supabase，因此不再强制校验，避免未配置时启动失败。
const REQUIRED_ENV = ['KM_COZE_TOKEN'];
for (const key of REQUIRED_ENV) {
    if (process.env[key] === undefined || process.env[key] === null) {
        console.error(`❌ 致命错误: 环境变量 ${key} 未设置，请检查 .env 文件`);
        process.exit(1);
    }
}
// 若仍配置了 SUPABASE 变量，仅作提示，不影响启动
if (!process.env.SUPABASE_URL && !process.env.SUPABASE_ANON_KEY) {
    console.log('ℹ️ 未配置 SUPABASE 变量（主项目使用 SQLite，不影响功能）');
} else if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.warn('⚠️ SUPABASE_URL 和 SUPABASE_ANON_KEY 需成对配置，缺一项将被忽略（主项目使用 SQLite）');
}

// 校验三步工作流 ID
if (!CONFIG.WF_SPEC_ID || !CONFIG.WF_PREVIEW_ID || !CONFIG.WF_MULTI_ID) {
    console.warn('⚠️ 警告: WF_SPEC_ID / WF_PREVIEW_ID / WF_MULTI_ID 未完全配置，对应工作流将不可用');
}

// OSS 配置检查：缺失时图片保存/删除将降级，仅提示不阻断启动
const OSS_ENV = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'];
const ossMissing = OSS_ENV.filter(k => !process.env[k]);
if (ossMissing.length > 0) {
    console.warn(`⚠️ OSS 配置缺失: ${ossMissing.join(', ')}。图片将保存为临时 URL（不可持久化），删除任务/历史时无法清理 OSS 文件。请参考 .env.example 补齐。`);
} else {
    console.log('✅ OSS 配置完整，图片将持久化到阿里云 OSS');
}

// 生产环境 ALLOWED_ORIGINS 非空警告
if (process.env.NODE_ENV === 'production' && CONFIG.ALLOWED_ORIGINS.length === 0) {
    console.warn('⚠️ 生产环境 ALLOWED_ORIGINS 未配置，所有跨域请求将被拒绝');
}