/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./*.html",
        "./public/*.html",
        "./public/*.js",
        "./script.js"
    ],
    theme: {
        extend: {
            colors: {
                // 暖米/沙色中性
                sand: {
                    50: '#faf8f4',
                    100: '#f5f1ea',
                    200: '#ebe4d8',
                    300: '#ddd2bf',
                    400: '#c7b89e',
                    500: '#b0a083',
                    600: '#968669',
                    700: '#7a6d54',
                    800: '#5f5544',
                    900: '#443d31',
                },
                // 深橄榄/森林绿
                forest: {
                    50: '#f3f5f1',
                    100: '#e3e8df',
                    200: '#c7d1bd',
                    300: '#a3b495',
                    400: '#7d9468',
                    500: '#5f7649',
                    600: '#4a5d38',
                    700: '#3a4a2d',
                    800: '#2d3a24',
                    900: '#1f2a18',
                },
                // 赤陶/陶土强调色
                clay: {
                    50: '#faf6f2',
                    100: '#f3e9e0',
                    200: '#e6d0bf',
                    300: '#d4b098',
                    400: '#c0906f',
                    500: '#a87450',
                    600: '#8c5d3e',
                    700: '#714a31',
                    800: '#563924',
                    900: '#3d2819',
                },
                // 墨色文字
                ink: {
                    DEFAULT: '#2a2520',
                    light: '#4a4339',
                    muted: '#7a7165',
                },
            },
            fontFamily: {
                serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
                sans: ['Inter', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
            },
            letterSpacing: {
                widest: '0.25em',
            },
            borderRadius: {
                DEFAULT: "0.125rem",
                lg: "0.25rem",
                xl: "0.5rem",
                "2xl": "0.75rem",
                full: "9999px"
            },
            spacing: {
                "margin-desktop": "64px",
                unit: "8px",
                gutter: "24px",
                "container-max": "1440px",
                "margin-mobile": "20px"
            },
            fontSize: {
                "headline-lg": ["32px", { lineHeight: "1.3", fontWeight: "600" }],
                "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
                "label-sm": ["12px", { lineHeight: "1.0", letterSpacing: "0.1em", fontWeight: "600" }],
                "display-lg": ["64px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
                "headline-md": ["24px", { lineHeight: "1.4", fontWeight: "500" }],
                "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
                "display-lg-mobile": ["40px", { lineHeight: "1.2", fontWeight: "700" }]
            },
            animation: {
                'fade-in': 'fadeIn 0.8s ease-out forwards',
                'fade-up': 'fadeUp 0.8s ease-out forwards',
                'slide-down': 'slideDown 0.4s ease-out forwards',
                'shimmer': 'shimmer 2s linear infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                fadeUp: {
                    '0%': { opacity: '0', transform: 'translateY(24px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                slideDown: {
                    '0%': { opacity: '0', transform: 'translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
            },
        }
    },
    plugins: []
};
