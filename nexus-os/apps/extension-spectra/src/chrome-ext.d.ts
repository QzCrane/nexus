/**
 * Chrome Extension API 类型扩展
 * 补充 chrome-types 中缺失的 MV3 API 类型
 */

declare namespace chrome {
  namespace offscreen {
    type Reason = 
      | 'AUDIO_PLAYBACK'
      | 'BLOBS'
      | 'CLIPBOARD'
      | 'DISPLAY_MEDIA'
      | 'DOM_PARSER'
      | 'DOM_SCRAPING'
      | 'GEOLOCATION'
      | 'IFRAME_SCRIPTING'
      | 'LOCAL_STORAGE'
      | 'TESTING'
      | 'USER_MEDIA'
      | 'WEB_RTC'
      | 'WORKERS';

    interface CreateParameters {
      url: string;
      reasons: Reason[];
      justification: string;
    }

    function hasDocument(): Promise<boolean>;
    function createDocument(parameters: CreateParameters): Promise<void>;
    function closeDocument(): Promise<void>;
  }

  namespace runtime {
    const lastError: { message?: string } | undefined;
  }

  namespace tabCapture {
    interface GetMediaStreamOptions {
      targetTabId?: number;
      consumerTabId?: number;
    }

    function getMediaStreamId(
      options: GetMediaStreamOptions,
      callback: (streamId: string) => void
    ): void;
  }

  namespace action {
    interface BadgeTextColorDetails {
      tabId?: number;
      color: string | [number, number, number, number];
    }

    function setBadgeTextColor(details: BadgeTextColorDetails): Promise<void>;
  }
}
