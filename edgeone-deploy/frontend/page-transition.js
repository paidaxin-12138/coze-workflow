/* ============================================
   页面跳转平滑过渡系统
   覆盖层 + 骨架屏 + 预加载
   所有页面统一引入，自动生效
   ============================================ */
(function () {
    'use strict';

    if (window.top !== window) return;

    // ============================================================
    // 1. 页面加载完成 → 隐藏覆盖层
    // ============================================================
    var html = document.documentElement;
    if (html.classList.contains('pt')) {
        // 通过过渡导航到达此页，覆盖层已可见
        // 等待页面内容就绪后隐藏覆盖层
        function hideOverlay() {
            // 等 200ms 确保内容已渲染，再淡出覆盖层
            setTimeout(function () {
                html.classList.remove('pt');
                try { sessionStorage.removeItem('pt'); } catch (e) {}
            }, 200);
        }
        if (document.readyState === 'complete') {
            hideOverlay();
        } else {
            window.addEventListener('load', hideOverlay);
        }
    }

    // ============================================================
    // 2. 预加载缓存
    // ============================================================
    var prefetchCache = {};

    // ============================================================
    // 3. 点击链接 → 显示覆盖层 → 导航
    // ============================================================
    document.addEventListener('click', function (e) {
        var link = e.target.closest('a[href]');
        if (!link) return;

        // 排除场景
        if (link.getAttribute('target') === '_blank') return;
        if (link.hasAttribute('download')) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (link.hostname !== location.hostname) return;
        if (link.getAttribute('href') === '#' || link.getAttribute('href') === '') return;

        var href = link.href;
        var samePage = link.pathname === location.pathname;

        // 同页面锚点跳转（如 #scent-families）— 不拦截
        if (samePage && link.hash) return;

        // 如果已经在过渡中，不重复触发
        if (html.classList.contains('pt')) return;

        e.preventDefault();

        // 显示覆盖层
        html.classList.add('pt');
        try { sessionStorage.setItem('pt', '1'); } catch (e) {}

        // 等覆盖层淡入动画完成后再导航（与 CSS transition 时长一致）
        setTimeout(function () {
            location.href = href;
        }, 320);
    });

    // ============================================================
    // 4. 悬停 → 预加载目标页面（300ms 防抖）
    //    使用 AbortController 防止导航时产生 net::ERR_ABORTED
    // ============================================================
    var prefetchTimer;
    var prefetchController = null;
    document.addEventListener('mouseover', function (e) {
        var link = e.target.closest('a[href]');
        if (!link) return;
        if (link.hostname !== location.hostname) return;
        if (link.pathname === location.pathname) return;
        if (link.getAttribute('href') === '#' || link.getAttribute('href') === '') return;

        var href = link.href;
        // 已缓存或已在预加载中
        if (prefetchCache[href]) return;

        clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(function () {
            // 取消上一个未完成的预加载
            if (prefetchController) {
                prefetchController.abort();
            }
            prefetchController = new AbortController();
            prefetchCache[href] = 'loading';
            fetch(href, {
                method: 'GET',
                mode: 'same-origin',
                credentials: 'same-origin',
                signal: prefetchController.signal
            })
                .then(function (r) {
                    prefetchCache[href] = r.ok ? 'done' : 'error';
                })
                .catch(function (err) {
                    if (err && err.name === 'AbortError') return;
                    prefetchCache[href] = 'error';
                });
        // 页面卸载前主动中止所有预加载请求，避免浏览器打印 ERR_ABORTED
        window.addEventListener('beforeunload', function () {
            if (prefetchController) { prefetchController.abort(); }
        });
        }, 300);
    });

    // 鼠标离开链接时取消预加载定时器和请求
    document.addEventListener('mouseout', function (e) {
        var link = e.target.closest('a[href]');
        if (!link) return;
        clearTimeout(prefetchTimer);
        if (prefetchController) {
            prefetchController.abort();
            prefetchController = null;
        }
    });

    // ============================================================
    // 5. 浏览器前进/后退 → 也显示覆盖层
    // ============================================================
    window.addEventListener('beforeunload', function () {
        // 如果用户通过浏览器按钮离开，也标记过渡
        if (!html.classList.contains('pt')) {
            try { sessionStorage.setItem('pt', '1'); } catch (e) {}
        }
    });

})();