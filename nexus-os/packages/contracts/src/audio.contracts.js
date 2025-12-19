/**
 * 音频服务契约 (Audio Service Contracts)
 *
 * 定义音频引擎的所有公共接口和类型。
 * AI 在编写任何需要音频功能的代码时，只需读取此文件即可。
 *
 * @packageDocumentation
 */
/**
 * 音频配置默认值
 */
export const DEFAULT_AUDIO_CONFIG = {
    enabled: true,
    volume: 100,
    muted: false,
    compressor: false,
    mono: false,
    bass: false,
    eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
//# sourceMappingURL=audio.contracts.js.map