#!/usr/bin/env node
/**
 * 仿香工作流 /copy 冒烟测试
 *
 * 用途：本地方式校验「副本契约迁移 + COPY_WORKFLOW_ID 切换」后，POST /api/workflow/copy
 *       是否按新契约返回 { success, images:[3 张图] }。
 *
 * 说明：副本本地 SUPABASE 未配置时无法自起服务，本脚本须指向【已部署】的副本线上地址执行。
 *       会消耗一次实际 Coze 仿香工作流额度。
 *
 * 用法（Node >= 18）：
 *   BASE_URL=https://你的副本域名 DESIGNER_ID=xxx PASSWORD=xxx node scripts/smoke-copy.mjs
 *
 * 退出码：0=通过（images 恰 3 张），非 0=失败
 */
import { Buffer } from 'node:buffer';

const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const DESIGNER_ID = process.env.DESIGNER_ID || '';
const PASSWORD = process.env.PASSWORD || '';

if (!BASE_URL || !DESIGNER_ID || !PASSWORD) {
    console.error('❌ 缺少参数。用法：BASE_URL=... DESIGNER_ID=... PASSWORD=... node scripts/smoke-copy.mjs');
    process.exit(2);
}

// 1x1 PNG（透明），作为合法参考图上传
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function toData(prefix, json) {
    const s = `${prefix} ${json.success === false ? '✗' : '✓'}`;
    if (json.success === false || json.error) s += ` | error=${json.error}`;
    console.log(s);
    return json;
}

const run = async () => {
    // 1) 登录拿 token
    console.log(`[1/4] 登录 ${DESIGNER_ID} @ ${BASE_URL}`);
    let login;
    try {
        const r = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ designer_id: DESIGNER_ID, password: PASSWORD })
        });
        login = toData('登录', await r.json());
    } catch (e) {
        console.error('❌ 登录失败（网络/域名问题）:', e.message);
        process.exit(3);
    }
    if (!login.success || !login.token) process.exit(3);
    const token = login.token;

    // 2) 上传参考图 → 应得到 live 的 image_url（验证 getCozeFileUrl 链路）
    console.log('[2/4] 上传参考图 /api/upload/image');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(PNG_1PX, 'base64')], { type: 'image/png' }), 'smoke.png');
    const upRes = await fetch(`${BASE_URL}/api/upload/image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
    });
    const up = toData('上传', await upRes.json());
    if (!up.success || !up.image_url) {
        console.error('❌ 上传未返回 image_url（契约迁移未生效）');
        process.exit(4);
    }
    console.log(`      image_url=${up.image_url}`);

    // 3) 调 /copy，传入 image_url
    console.log('[3/4] 调用 /api/workflow/copy（新工作流，含额度消耗）');
    const cpRes = await fetch(`${BASE_URL}/api/workflow/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ image_url: up.image_url })
    });
    const cp = toData('copy', await cpRes.json());
    if (!cp.success) {
        console.error('❌ /copy 失败');
        process.exit(5);
    }
    if (!Array.isArray(cp.images)) {
        console.error(`❌ /copy 未返回 images 数组，实际结构:`, JSON.stringify(cp));
        process.exit(6);
    }

    // 4) 断言 images 恰为 3 张
    console.log(`[4/4] 断言 images.length === 3（实际 ${cp.images.length}）`);
    cp.images.forEach((u, i) => console.log(`      images[${i}] = ${u}`));
    if (cp.images.length === 3) {
        console.log('\n✅ PASS：/copy 返回恰好 3 张仿香参考图');
        process.exit(0);
    }
    console.error(`\n❌ FAIL：期望 3 张，实际 ${cp.images.length} 张（请核对 COPY_WORKFLOW_ID / 工作流输出字段 image40/60/80）`);
    process.exit(7);
};

run();