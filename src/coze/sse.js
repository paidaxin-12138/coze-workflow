// 工具函数 - 从 Coze 工作流响应中提取图片 URL

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