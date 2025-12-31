import { handleGotError, RestResponseStatus } from '../../common/rest/RestResponse'
import { LoggerUtil } from '../../util/LoggerUtil'
import got, { HTTPError, RequestError } from 'got'
import { decipherErrorCode, DiscordErrorCode, DiscordResponse } from './DiscordResponse'

/* ***********************************/
/*         Discord データモデル      */
/* ***********************************/

/**
 * Discord ユーザー情報レスポンス
 */
export interface DiscordUserInfo {
    id: string
    username: string
    discriminator: string
    avatar: string | null
    bot?: boolean
    system?: boolean
    mfa_enabled?: boolean
    locale?: string
    verified?: boolean
    email?: string | null
    flags?: number
    premium_type?: number
    public_flags?: number
}

/* ***********************************/
/*         Discord Auth API          */
/* ***********************************/

export class DiscordAuth {

    private static readonly logger = LoggerUtil.getLogger('DiscordAuth')

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private static readonly TIMEOUT = 2500

    public static readonly DISCORD_API_ENDPOINT = 'https://discord.com/api/users/@me'
    public static readonly BACKEND_AUTH_ENDPOINT = 'https://api.chomc.net/login'

    /**
     * handleGotErrorのDiscordAuthAPI実装。
     * 
     * @param operation ログ出力用の操作名
     * @param error 発生したエラー
     * @param dataProvider レスポンスボディを提供する関数
     * @returns エラー情報で構成されたDiscordResponse
     */
    private static handleGotError<T>(operation: string, error: RequestError, dataProvider: () => T): DiscordResponse<T> {

        const response: DiscordResponse<T> = handleGotError(operation, error, DiscordAuth.logger, dataProvider)

        if (error instanceof HTTPError) {
            response.discordErrorCode = decipherErrorCode(error.response.body)
        } else {
            response.discordErrorCode = DiscordErrorCode.UNKNOWN
        }

        return response
    }

    /**
     * トークンを使用してDiscordのユーザー情報を取得する
     * 
     * @param token Discordアクセストークン
     * @returns この操作のDiscordResponse
     */
    public static async getDiscordProfile(token: string): Promise<DiscordResponse<DiscordUserInfo | null>> {
        try {

            const res = await got.get<DiscordUserInfo>(this.DISCORD_API_ENDPOINT, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return DiscordAuth.handleGotError('Get Discord Profile', error as RequestError, () => null)
        }
    }

    /**
     * DiscordトークンとMinecraft UUIDをバックエンドに送信する
     * 
     * @param discordToken Discordアクセストークン
     * @param mcUUID Minecraft UUID
     * @returns この操作のDiscordResponse
     */
    public static async sendToBackend(discordToken: string, mcUUID: string): Promise<DiscordResponse<unknown | null>> {
        try {

            const res = await got.post<unknown>(this.BACKEND_AUTH_ENDPOINT, {
                json: {
                    discord_token: discordToken,
                    minecraft_uuid: mcUUID
                },
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return DiscordAuth.handleGotError('Send Auth to Backend', error as RequestError, () => null)
        }
    }

}
