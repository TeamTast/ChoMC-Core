import { RestResponse } from '../../common/rest/RestResponse'

/**
 * Discord認証プロセスのエラーコード
 */
export enum DiscordErrorCode {
    /**
     * 不明なエラー
     */
    UNKNOWN,
}

export interface DiscordResponse<T> extends RestResponse<T> {
    discordErrorCode?: DiscordErrorCode
}

/**
 * レスポンスボディからエラーレスポンスコードを解決する
 *
 * @param body Discordエラーボディレスポンス
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decipherErrorCode(body: any): DiscordErrorCode {
    return DiscordErrorCode.UNKNOWN
}
