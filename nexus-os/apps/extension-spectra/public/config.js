/**
 * Media Master 2026 - 配置中心
 * 所有硬编码常量的唯一来源，拒绝分散定义
 */

// 防止重复声明（manifest 自动注入 + 动态注入可能导致重复）
if (typeof CONFIG === 'undefined') {
var CONFIG = {
    // ============================================
    // 模式枚举
    // ============================================
    MODE: {
        NATIVE_WEBAUDIO: 'NATIVE_WEBAUDIO', // 非受限站点 (如 YouTube)，完整 WebAudio 功能
        NATIVE_LITE: 'NATIVE_LITE',         // 受限站点 + 频谱关 + 音量 ≤ 100%
        CAPTURE: 'CAPTURE'                  // 受限站点 + (频谱开 或 音量 > 100%)
    },

    // ============================================
    // 默认用户配置
    // ============================================
    DEFAULT: {
        enabled: true,
        volume: 100,
        muted: false,
        compressor: false,
        mono: false,
        bass: false,
        eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },

    // ============================================
    // 默认全局设置
    // ============================================
    DEFAULT_GLOBAL_SETTINGS: {
        osdEnabled: true,
        visualizerEnabled: true,
        lang: 'en-US'
    },

    // ============================================
    // 受限域名列表（默认使用劫持模式）
    // ============================================
    RESTRICTED_DOMAINS: [
        'douyin.com',
        'live.douyin.com',
        'netflix.com',
        'spotify.com'
    ],

    // ============================================
    // 音频处理参数
    // ============================================
    AUDIO: {
        // EQ 10段频率 (Hz)
        EQ_FREQUENCIES: [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
        // EQ Q值
        EQ_Q: 1.4,
        // 低音增强频率 (Hz)
        BASS_FREQUENCY: 200,
        // 低音增益 (dB)
        BASS_GAIN: 10,
        // 平滑时间常数 (秒)
        SMOOTH_TIME: 0.1,
        SMOOTH_TIME_FAST: 0.05,
        // FFT 分析器大小
        FFT_SIZE: 256,
        // 最大音量 (%)
        MAX_VOLUME: 800,
        // 音量调节步进
        VOLUME_STEP: 10,
        // EQ 范围 (dB)
        EQ_MIN: -12,
        EQ_MAX: 12,
        EQ_STEP: 0.1,
        // 压缩器参数
        COMPRESSOR: {
            threshold: -24,
            knee: 30,
            ratio: 12,
            attack: 0.003,
            release: 0.25
        },
        // 压缩器关闭时的透明参数
        COMPRESSOR_OFF: {
            threshold: 0,
            ratio: 1
        },
        // 原生模式压缩器关闭参数
        COMPRESSOR_NATIVE_OFF: {
            threshold: -10,
            ratio: 1
        }
    },

    // ============================================
    // UI 颜色
    // ============================================
    COLORS: {
        CAPTURE: '#7c3aed',   // 紫色 - 劫持模式
        NATIVE: '#2563eb',    // 蓝色 - 原生模式
        MUTED: '#9ca3af',     // 灰色 - 静音
        WHITE: '#ffffff'
    },

    // ============================================
    // UI 尺寸
    // ============================================
    UI: {
        // 设置页最小高度 (px) - 主 UI 高度不足时展开到此高度
        SETTINGS_MIN_HEIGHT: 480
    },

    // ============================================
    // 时间/计数常量
    // ============================================
    TIMING: {
        // OSD 显示持续时间 (ms)
        OSD_DURATION: 2000,
        // Toast 显示持续时间 (ms)
        TOAST_DURATION: 3000,
        // 最近播放判定阈值 (ms) - 60秒内有播放过视为活跃
        RECENTLY_PLAYED_THRESHOLD: 60000,
        // Capture 请求锁定时间 (ms)
        CAPTURE_LOCK_TIME: 500,
        // MutationObserver 防抖时间 (ms)
        OBSERVER_DEBOUNCE: 500,
        // 状态重新应用间隔 (ms)
        STATE_REAPPLY_INTERVAL: 2000,
        // Capture 初始化等待时间 (ms)
        CAPTURE_INIT_DELAY: 300,
        // Popup 可视化帧率限制间隔 (ms) - ~30 FPS
        VIZ_FRAME_INTERVAL: 32,
        // Mutex 等待轮询间隔 (ms)
        MUTEX_POLL_INTERVAL: 50,
        // Metrics 初始化循环次数
        METRICS_INIT_LOOPS: 20,
        // EQ 抽屉动画时间后更新 metrics (ms)
        EQ_DRAWER_DELAY: 310
    },

    // ============================================
    // 播放页检测规则
    // ============================================
    SITE_RULES: [
        {
            name: '抖音',
            hostPattern: 'douyin.com',
            liveSubdomains: ['live'],
            pathPatterns: ['/video/', '/live/'],
        },
        {
            name: 'YouTube',
            hostPattern: 'youtube.com',
            pathPatterns: ['/watch', '/embed/', '/shorts/'],
        },
        {
            name: 'Bilibili',
            hostPattern: 'bilibili.com',
            pathPatterns: ['/video/', '/bangumi/', '/cheese/'],
        },
        {
            name: 'Netflix',
            hostPattern: 'netflix.com',
            pathPatterns: ['/watch/'],
        },
        {
            name: 'TikTok',
            hostPattern: 'tiktok.com',
            pathPatterns: ['/video/'],
            pathRegex: [/\/@[\w.-]+\/video\//],
        },
        {
            name: 'Spotify',
            hostPattern: 'spotify.com',
            pathPatterns: ['/track/', '/episode/'],
        },
    ],

    // ============================================
    // 通用 URL 检测参数
    // ============================================
    URL_DETECTION: {
        // 视频播放页 URL 参数
        VIDEO_PARAMS: ['modal_id', 'video_id', 'vid', 'v', 'bvid', 'aid', 'ep_id'],
        // Hash 中的播放页关键词正则
        HASH_VIDEO_KEYWORDS: /video|modal|play|watch/i,
        // 通用路径匹配模式
        GENERIC_PATH_PATTERNS: [
            /\/video\//i,
            /\/watch/i,
            /\/play\//i,
            /\/v\//i,
            /\/live\//i,
            /\/embed\//i,
            /\/player\//i,
            /\/episode\//i,
            /\/track\//i,
            /\/clip\//i,
        ]
    },

    // ============================================
    // 受限 URL 前缀（无法注入的页面）
    // ============================================
    RESTRICTED_URL_PREFIXES: ['chrome:', 'edge:', 'about:', 'chrome-extension:'],

    // ============================================
    // 国际化
    // ============================================
    I18N: {
        'en-US': {
            settingsTitle: "Settings",
            osdLabel: "OSD Popup",
            osdSub: "Overlay when using shortcuts",
            vizLabel: "Visualizer",
            vizSub: "Show dynamic audio bars",
            vizDesc: "Disabling this saves resources on restricted sites (e.g. Tiktok) by using Native Lite mode until volume > 100%.",
            langLabel: "Language",
            noAudio: "No Audio Signal",
            bgTitle: "Background",
            paused: "Audio Enhancement Paused",
            clickToResume: "Click to Resume",
            comp: "Compressor",
            bass: "Bass",
            mono: "Mono",
            eqTitle: "🎚️ 10-Band EQ",
            reset: "Reset",
            save: "Save",
            resetTooltip: "Reset volume and EQ to default values",
            saveTooltip: "Save current settings as default for this domain",
            captureListLabel: "Force Capture Mode",
            captureListSub: "One domain per line (e.g. tiktok.com)",
            grpInterface: "Interface",
            grpGeneral: "General",
            grpAdvanced: "Advanced",
            autoAddedToast: (domain) => `🔧 Auto-added ${domain} to capture list`
        },
        'zh-CN': {
            settingsTitle: "设置",
            osdLabel: "屏幕提示 (OSD)",
            osdSub: "快捷键调节时显示",
            vizLabel: "动态频谱",
            vizSub: "显示可视化音频条",
            vizDesc: "关闭后，受限网站 (如抖音) 将预设使用极其省电的原生模式，仅在音量超过100%时自动切换增强模式。",
            langLabel: "语言 (Language)",
            noAudio: "无音频信号",
            bgTitle: "后台播放",
            paused: "增强已暂停",
            clickToResume: "点击恢复",
            comp: "防爆音",
            bass: "低音",
            mono: "单声道",
            eqTitle: "🎚️ 10段均衡器",
            reset: "重置",
            save: "保存",
            resetTooltip: "将当前标签页的音量和均衡器恢复为默认值",
            saveTooltip: "将当前配置保存为该网站 (域名) 的永久默认配置",
            captureListLabel: "强制劫持列表",
            captureListSub: "每行一个域名 (如 douyin.com)",
            grpInterface: "界面",
            grpGeneral: "通用",
            grpAdvanced: "高级",
            autoAddedToast: (domain) => `🔧 已自动添加 ${domain} 到劫持列表`
        },
        'ja-JP': {
            settingsTitle: "設定",
            osdLabel: "OSDポップアップ",
            osdSub: "ショートカット使用時に表示",
            vizLabel: "ビジュアライザー",
            vizSub: "ダイナミックオーディオバーを表示",
            vizDesc: "無効にすると、制限付きサイトでは音量が100%を超えるまでネイティブライトモードを使用し、リソースを節約します。",
            langLabel: "言語",
            noAudio: "オーディオ信号なし",
            bgTitle: "バックグラウンド",
            paused: "オーディオ拡張一時停止中",
            clickToResume: "クリックして再開",
            comp: "コンプレッサー",
            bass: "低音",
            mono: "モノラル",
            eqTitle: "🎚️ 10バンドEQ",
            reset: "リセット",
            save: "保存",
            resetTooltip: "音量とEQをデフォルト値にリセット",
            saveTooltip: "現在の設定をこのドメインのデフォルトとして保存",
            captureListLabel: "強制キャプチャモード",
            captureListSub: "1行に1ドメイン",
            grpInterface: "インターフェース",
            grpGeneral: "一般",
            grpAdvanced: "詳細",
            autoAddedToast: (domain) => `🔧 ${domain} をキャプチャリストに自動追加しました`
        },
        'ko-KR': {
            settingsTitle: "설정",
            osdLabel: "OSD 팝업",
            osdSub: "단축키 사용 시 표시",
            vizLabel: "비주얼라이저",
            vizSub: "동적 오디오 바 표시",
            vizDesc: "비활성화하면 제한된 사이트에서 볼륨이 100%를 초과할 때까지 네이티브 라이트 모드를 사용하여 리소스를 절약합니다.",
            langLabel: "언어",
            noAudio: "오디오 신호 없음",
            bgTitle: "백그라운드",
            paused: "오디오 향상 일시 중지됨",
            clickToResume: "클릭하여 재개",
            comp: "컴프레서",
            bass: "베이스",
            mono: "모노",
            eqTitle: "🎚️ 10밴드 EQ",
            reset: "초기화",
            save: "저장",
            resetTooltip: "볼륨 및 EQ를 기본값으로 재설정",
            saveTooltip: "현재 설정을 이 도메인의 기본값으로 저장",
            captureListLabel: "강제 캡처 모드",
            captureListSub: "한 줄에 하나의 도메인",
            grpInterface: "인터페이스",
            grpGeneral: "일반",
            grpAdvanced: "고급",
            autoAddedToast: (domain) => `🔧 ${domain}을(를) 캡처 목록에 자동 추가했습니다`
        },
        'es-ES': {
            settingsTitle: "Configuración",
            osdLabel: "Popup OSD",
            osdSub: "Mostrar al usar atajos",
            vizLabel: "Visualizador",
            vizSub: "Mostrar barras de audio dinámicas",
            vizDesc: "Desactivar esto ahorra recursos en sitios restringidos usando el modo Nativo Lite hasta que el volumen supere el 100%.",
            langLabel: "Idioma",
            noAudio: "Sin señal de audio",
            bgTitle: "Fondo",
            paused: "Mejora de audio pausada",
            clickToResume: "Clic para reanudar",
            comp: "Compresor",
            bass: "Graves",
            mono: "Mono",
            eqTitle: "🎚️ EQ de 10 bandas",
            reset: "Restablecer",
            save: "Guardar",
            resetTooltip: "Restablecer volumen y EQ a valores predeterminados",
            saveTooltip: "Guardar configuración actual como predeterminada para este dominio",
            captureListLabel: "Modo captura forzada",
            captureListSub: "Un dominio por línea",
            grpInterface: "Interfaz",
            grpGeneral: "General",
            grpAdvanced: "Avanzado",
            autoAddedToast: (domain) => `🔧 ${domain} añadido automáticamente a la lista de captura`
        },
        'fr-FR': {
            settingsTitle: "Paramètres",
            osdLabel: "Popup OSD",
            osdSub: "Afficher lors des raccourcis",
            vizLabel: "Visualiseur",
            vizSub: "Afficher les barres audio dynamiques",
            vizDesc: "Désactiver économise les ressources sur les sites restreints en utilisant le mode Natif Lite jusqu'à ce que le volume dépasse 100%.",
            langLabel: "Langue",
            noAudio: "Pas de signal audio",
            bgTitle: "Arrière-plan",
            paused: "Amélioration audio en pause",
            clickToResume: "Cliquez pour reprendre",
            comp: "Compresseur",
            bass: "Basses",
            mono: "Mono",
            eqTitle: "🎚️ EQ 10 bandes",
            reset: "Réinitialiser",
            save: "Enregistrer",
            resetTooltip: "Réinitialiser le volume et l'EQ aux valeurs par défaut",
            saveTooltip: "Enregistrer les paramètres actuels comme défaut pour ce domaine",
            captureListLabel: "Mode capture forcée",
            captureListSub: "Un domaine par ligne",
            grpInterface: "Interface",
            grpGeneral: "Général",
            grpAdvanced: "Avancé",
            autoAddedToast: (domain) => `🔧 ${domain} ajouté automatiquement à la liste de capture`
        },
        'de-DE': {
            settingsTitle: "Einstellungen",
            osdLabel: "OSD-Popup",
            osdSub: "Anzeige bei Tastenkürzel",
            vizLabel: "Visualizer",
            vizSub: "Dynamische Audiobars anzeigen",
            vizDesc: "Deaktivieren spart Ressourcen auf eingeschränkten Seiten durch Native Lite Modus bis Lautstärke > 100%.",
            langLabel: "Sprache",
            noAudio: "Kein Audiosignal",
            bgTitle: "Hintergrund",
            paused: "Audioverbesserung pausiert",
            clickToResume: "Klicken zum Fortsetzen",
            comp: "Kompressor",
            bass: "Bass",
            mono: "Mono",
            eqTitle: "🎚️ 10-Band EQ",
            reset: "Zurücksetzen",
            save: "Speichern",
            resetTooltip: "Lautstärke und EQ auf Standardwerte zurücksetzen",
            saveTooltip: "Aktuelle Einstellungen als Standard für diese Domain speichern",
            captureListLabel: "Erzwungener Capture-Modus",
            captureListSub: "Eine Domain pro Zeile",
            grpInterface: "Oberfläche",
            grpGeneral: "Allgemein",
            grpAdvanced: "Erweitert",
            autoAddedToast: (domain) => `🔧 ${domain} automatisch zur Capture-Liste hinzugefügt`
        },
        'ru-RU': {
            settingsTitle: "Настройки",
            osdLabel: "OSD-уведомление",
            osdSub: "Показывать при использовании горячих клавиш",
            vizLabel: "Визуализатор",
            vizSub: "Показывать динамические аудиобары",
            vizDesc: "Отключение экономит ресурсы на ограниченных сайтах, используя Native Lite режим до громкости > 100%.",
            langLabel: "Язык",
            noAudio: "Нет аудиосигнала",
            bgTitle: "Фон",
            paused: "Улучшение аудио приостановлено",
            clickToResume: "Нажмите для возобновления",
            comp: "Компрессор",
            bass: "Бас",
            mono: "Моно",
            eqTitle: "🎚️ 10-полосный EQ",
            reset: "Сброс",
            save: "Сохранить",
            resetTooltip: "Сбросить громкость и EQ к значениям по умолчанию",
            saveTooltip: "Сохранить текущие настройки как стандартные для этого домена",
            captureListLabel: "Принудительный режим захвата",
            captureListSub: "Один домен на строку",
            grpInterface: "Интерфейс",
            grpGeneral: "Общие",
            grpAdvanced: "Расширенные",
            autoAddedToast: (domain) => `🔧 ${domain} автоматически добавлен в список захвата`
        }
    }
};

// 导出供其他模块使用（兼容 content script 和 ES module）
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
} // 结束 if (typeof CONFIG === 'undefined')
