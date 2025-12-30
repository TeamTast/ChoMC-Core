import { LoggerUtil } from '../../util/LoggerUtil'
import got, { RequestError, HTTPError } from 'got'
import { MojangResponse, MojangErrorCode, decipherErrorCode, isInternalError, MojangErrorBody } from './MojangResponse'
import { RestResponseStatus, handleGotError } from '../../common/rest/RestResponse'

export interface Agent {
    name: 'Minecraft'
    version: number
}

export interface AuthPayload {
    agent: Agent
    username: string
    password: string
    clientToken?: string
    requestUser?: boolean
}

export interface Session {
    accessToken: string
    clientToken: string
    selectedProfile: {
        id: string
        name: string
    }
    user?: {
        id: string
        properties: {
            name: string
            value: string
        }[]
    }
}

export enum MojangStatusColor {
    RED = 'red',
    YELLOW = 'yellow',
    GREEN = 'green',
    GREY = 'grey'
}

export interface MojangStatus {

    service: string
    status: MojangStatusColor
    name: string
    essential: boolean

}

export interface UpptimeSummary {
    slug: string
    status: 'up' | 'down'
}

export class MojangRestAPI {

    private static readonly logger = LoggerUtil.getLogger('Mojang')

    private static readonly TIMEOUT = 2500

    public static readonly AUTH_ENDPOINT = 'https://authserver.mojang.com'
    public static readonly STATUS_ENDPOINT = 'https://raw.githubusercontent.com/AventiumSoftworks/Cho-status-page/master/history/summary.json'

    private static authClient = got.extend({
        prefixUrl: MojangRestAPI.AUTH_ENDPOINT,
        responseType: 'json',
        retry: 0
    })
    private static statusClient = got.extend({
        url: MojangRestAPI.STATUS_ENDPOINT,
        responseType: 'json',
        retry: 0
    })

    public static readonly MINECRAFT_AGENT: Agent = {
        name: 'Minecraft',
        version: 1
    }

    protected static statuses: MojangStatus[] = MojangRestAPI.getDefaultStatuses()

    public static getDefaultStatuses(): MojangStatus[] {
        return [
            {
                service: 'mojang-multiplayer-session-service',
                status: MojangStatusColor.GREY,
                name: 'Multiplayer Session Service',
                essential: true
            },
            {
                service: 'minecraft-skins',
                status: MojangStatusColor.GREY,
                name: 'Minecraft Skins',
                essential: false
            },
            {
                service: 'mojang-s-public-api',
                status: MojangStatusColor.GREY,
                name: 'Public API',
                essential: false
            },
            {
                service: 'mojang-accounts-website',
                status: MojangStatusColor.GREY,
                name: 'Mojang Accounts Website',
                essential: false
            },
            {
                service: 'microsoft-o-auth-server',
                status: MojangStatusColor.GREY,
                name: 'Microsoft OAuth Server',
                essential: true
            },
            {
                service: 'xbox-live-auth-server',
                status: MojangStatusColor.GREY,
                name: 'Xbox Live Auth Server',
                essential: true
            },
            {
                service: 'xbox-live-gatekeeper', // XTokensを提供するために使用されるサーバー
                status: MojangStatusColor.GREY,
                name: 'Xbox Live Gatekeeper',
                essential: true
            },
            {
                service: 'microsoft-minecraft-api',
                status: MojangStatusColor.GREY,
                name: 'Minecraft API for Microsoft Accounts',
                essential: true
            },
            {
                service: 'microsoft-minecraft-profile',
                status: MojangStatusColor.GREY,
                name: 'Minecraft Profile for Microsoft Accounts',
                essential: false
            }
        ]
    }

    /**
     * Mojangステータスの色をHEX値に変換する。有効なステータスは
     * 'green', 'yellow', 'red', 'grey' である。Greyは不明なステータスを表す
     * カスタムステータスである
     */
    public static statusToHex(status: string): string {
        switch (status.toLowerCase() as MojangStatusColor) {
            case MojangStatusColor.GREEN:
                return '#a5c325'
            case MojangStatusColor.YELLOW:
                return '#eac918'
            case MojangStatusColor.RED:
                return '#c32625'
            case MojangStatusColor.GREY:
            default:
                return '#848484'
        }
    }

    /**
     * handleGotErrorのMojangRestAPI実装。この関数は、
     * Mojangからのレスポンスをさらに分析し、mojang固有のエラー情報を入力する
     * 
     * @param operation ログ出力用の操作名
     * @param error 発生したエラー
     * @param dataProvider レスポンスボディを提供する関数
     * @returns エラー情報で構成されたMojangResponse
     */
    private static handleGotError<T>(operation: string, error: RequestError, dataProvider: () => T): MojangResponse<T> {

        const response: MojangResponse<T> = handleGotError(operation, error, MojangRestAPI.logger, dataProvider)

        if (error instanceof HTTPError) {
            response.mojangErrorCode = decipherErrorCode(error.response.body as MojangErrorBody)
        } else if (error.name === 'RequestError' && error.code === 'ENOTFOUND') {
            response.mojangErrorCode = MojangErrorCode.ERROR_UNREACHABLE
        } else {
            response.mojangErrorCode = MojangErrorCode.UNKNOWN
        }
        response.isInternalError = isInternalError(response.mojangErrorCode)

        return response
    }

    /**
     * 予期しない成功コードを報告するユーティリティ関数。予期しない
     * コードはAPIの変更を示す可能性がある
     * 
     * @param operation 操作名
     * @param expected 期待されるレスポンスコード
     * @param actual 実際のレスポンスコード
     */
    private static expectSpecificSuccess(operation: string, expected: number, actual: number): void {
        if (actual !== expected) {
            MojangRestAPI.logger.warn(`${operation} expected ${expected} response, received ${actual}.`)
        }
    }

    /**
     * Mojangサービスのステータスを取得する
     * レスポンスは単一のオブジェクトに凝縮される。各サービスはキーであり、
     * 値はステータスと名前プロパティを含むオブジェクトである
     * 
     * 現在、社内の毎日のpingを使用している。毎日のpingはあまり役に立たないため、
     * 後日リファクタリングされる可能性がある。この機能は元々、
     * その後削除されたMojangのステータスAPI上に構築されていた
     * 
     * @see https://wiki.vg/Mojang_API#API_Status_.28Removed.29
     */
    public static async status(): Promise<MojangResponse<MojangStatus[]>> {
        try {

            const res = await MojangRestAPI.statusClient.get<UpptimeSummary[]>({})

            MojangRestAPI.expectSpecificSuccess('Mojang Status', 200, res.statusCode)

            for (const status of res.body) {
                for (const mojStatus of MojangRestAPI.statuses) {
                    if (mojStatus.service === status.slug) {
                        mojStatus.status = status.status === 'up' ? MojangStatusColor.GREEN : MojangStatusColor.RED
                        break
                    }
                }
            }

            return {
                data: MojangRestAPI.statuses,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {

            return MojangRestAPI.handleGotError('Mojang Status', error as RequestError, () => {
                for (const status of MojangRestAPI.statuses) {
                    status.status = MojangStatusColor.GREY
                }
                return MojangRestAPI.statuses
            })
        }

    }

    /**
     * Mojang資格情報を使用してユーザーを認証する
     * 
     * @param {string} username ユーザーのユーザー名（多くの場合メールアドレス）
     * @param {string} password ユーザーのパスワード
     * @param {string} clientToken ランチャーのクライアントトークン
     * @param {boolean} requestUser オプション。レスポンスにユーザーオブジェクトを追加する
     * @param {Object} agent オプション。デフォルトで提供される。レスポンスにユーザー情報を追加する
     * 
     * @see http://wiki.vg/Authentication#Authenticate
     */
    public static async authenticate(
        username: string,
        password: string,
        clientToken: string | null,
        requestUser = true,
        agent: Agent = MojangRestAPI.MINECRAFT_AGENT
    ): Promise<MojangResponse<Session | null>> {

        try {

            const json: AuthPayload = {
                agent,
                username,
                password,
                requestUser
            }
            if (clientToken != null) {
                json.clientToken = clientToken
            }

            const res = await MojangRestAPI.authClient.post<Session>('authenticate', { json, responseType: 'json' })
            MojangRestAPI.expectSpecificSuccess('Mojang Authenticate', 200, res.statusCode)
            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (err) {
            return MojangRestAPI.handleGotError('Mojang Authenticate', err as RequestError, () => null)
        }

    }

    /**
     * アクセストークンを検証する。これは常に起動前に行う必要がある
     * クライアントトークンは、アクセストークンの作成に使用されたものと一致する必要がある
     * 
     * @param {string} accessToken 検証するアクセストークン
     * @param {string} clientToken ランチャーのクライアントトークン
     * 
     * @see http://wiki.vg/Authentication#Validate
     */
    public static async validate(accessToken: string, clientToken: string): Promise<MojangResponse<boolean>> {

        try {

            const json = {
                accessToken,
                clientToken
            }

            const res = await MojangRestAPI.authClient.post('validate', { json })
            MojangRestAPI.expectSpecificSuccess('Mojang Validate', 204, res.statusCode)

            return {
                data: res.statusCode === 204,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (err) {
            if (err instanceof HTTPError && err.response.statusCode === 403) {
                return {
                    data: false,
                    responseStatus: RestResponseStatus.SUCCESS
                }
            }
            return MojangRestAPI.handleGotError('Mojang Validate', err as RequestError, () => false)
        }

    }

    /**
     * アクセストークンを無効にする。clientTokenは、
     * 提供されたaccessTokenの作成に使用されたトークンと一致する必要がある
     * 
     * @param {string} accessToken 無効にするアクセストークン
     * @param {string} clientToken ランチャーのクライアントトークン
     * 
     * @see http://wiki.vg/Authentication#Invalidate
     */
    public static async invalidate(accessToken: string, clientToken: string): Promise<MojangResponse<undefined>> {

        try {

            const json = {
                accessToken,
                clientToken
            }

            const res = await MojangRestAPI.authClient.post('invalidate', { json })
            MojangRestAPI.expectSpecificSuccess('Mojang Invalidate', 204, res.statusCode)

            return {
                data: undefined,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (err) {
            return MojangRestAPI.handleGotError('Mojang Invalidate', err as RequestError, () => undefined)
        }

    }

    /**
     * ユーザーの認証をリフレッシュする。これは、ユーザーに再度資格情報を求めることなく、
     * ユーザーをログイン状態に保つために使用する必要がある。新しいアクセストークンは、
     * 最近の無効なアクセストークンを使用して生成される 詳細についてはWikiを参照
     *
     * @param {string} accessToken 古いアクセストークン
     * @param {string} clientToken ランチャーのクライアントトークン
     * @param {boolean} requestUser オプション。レスポンスにユーザーオブジェクトを追加する
     *
     * @see http://wiki.vg/Authentication#Refresh
     */
    public static async refresh(accessToken: string, clientToken: string, requestUser = true): Promise<MojangResponse<Session | null>> {

        try {

            const json = {
                accessToken,
                clientToken,
                requestUser
            }

            const res = await MojangRestAPI.authClient.post<Session>('refresh', { json, responseType: 'json' })
            MojangRestAPI.expectSpecificSuccess('Mojang Refresh', 200, res.statusCode)

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (err) {
            return MojangRestAPI.handleGotError('Mojang Refresh', err as RequestError, () => null)
        }

    }

}
