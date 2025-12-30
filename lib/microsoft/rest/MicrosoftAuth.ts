import { handleGotError, RestResponseStatus } from '../../common/rest/RestResponse'
import { LoggerUtil } from '../../util/LoggerUtil'
import got, { HTTPError, RequestError } from 'got'
import { decipherErrorCode, MicrosoftErrorCode, MicrosoftResponse } from './MicrosoftResponse'

/* ***********************************/
/*      Microsoft OAuth モデル       */
/* ***********************************/

/**
 * MicrosoftのOAuthエンドポイントへのリクエストの共通プロパティ
 */
export interface AbstractTokenRequest {
    client_id: string
    scope: string
    redirect_uri: string
}
/**
 * 認証コードからMicrosoft OAuthアクセストークンを取得するための
 * リクエストボディ
 */
export interface AuthTokenRequest extends AbstractTokenRequest {
    grant_type: 'authorization_code'
    code: string
}
/**
 * 既存のトークンをリフレッシュしてMicrosoft OAuthアクセストークンを取得するための
 * リクエストボディ
 */
export interface RefreshTokenRequest extends AbstractTokenRequest {
    grant_type: 'refresh_token'
    refresh_token: string
}

/**
 * Microsoft OAuth レスポンス
 */
export interface AuthorizationTokenResponse {
    token_type: string
    expires_in: number
    scope: string
    access_token: string
    refresh_token: string
    user_id: string
    foci: string
}

/* ***********************************/
/*         Xbox Live モデル          */
/* ***********************************/

/**
 * Xbox Live レスポンス
 */
export interface XboxServiceTokenResponse {
    IssueInstant: string
    NotAfter: string
    Token: string
    DisplayClaims: DisplayClaim
}
export interface DisplayClaim {
    xui: {
        uhs: string
    }[]
}

/* ***********************************/
/*       Minecraft 認証モデル        */
/* ***********************************/

/**
 * Minecraft 認証レスポンス
 */
export interface MCTokenResponse {
    username: string
    roles: unknown[]
    access_token: string
    token_type: string
    expires_in: number
}

/* ***********************************/
/*       Minecraft データモデル      */
/* ***********************************/

/**
 * Minecraft プロファイルレスポンス
 */
export interface MCUserInfo {
    id: string
    name: string
    skins: MCSkinInfo[]
    capes: MCCapeInfo[]
}
export enum MCInfoState {
    ACTIVE = 'ACTIVE',
    INACTIVE = 'INACTIVE'
}
export interface MCInfo {
    id: string
    state: MCInfoState
    url: string
}
export interface MCSkinInfo extends MCInfo {
    variant: string
    alias: string
}
export interface MCCapeInfo extends MCInfo {
    alias: string
}

/* ***********************************/
/*         Microsoft Auth API        */
/* ***********************************/

export class MicrosoftAuth {

    private static readonly logger = LoggerUtil.getLogger('MicrosoftAuth')

    private static readonly TIMEOUT = 2500

    public static readonly TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
    public static readonly XBL_AUTH_ENDPOINT = 'https://user.auth.xboxlive.com/user/authenticate'
    public static readonly XSTS_AUTH_ENDPOINT = 'https://xsts.auth.xboxlive.com/xsts/authorize'
    public static readonly MC_AUTH_ENDPOINT = 'https://api.minecraftservices.com/authentication/login_with_xbox'
    public static readonly MC_ENTITLEMENT_ENDPOINT = 'https://api.minecraftservices.com/entitlements/mcstore'
    public static readonly MC_PROFILE_ENDPOINT = 'https://api.minecraftservices.com/minecraft/profile'

    private static readonly STANDARD_HEADERS = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
    }

    /**
     * handleGotErrorのMicrosoftAuthAPI実装。この関数は、
     * Microsoftからのレスポンスをさらに分析し、Microsoft固有のエラー情報を入力する
     * 
     * @param operation ログ出力用の操作名
     * @param error 発生したエラー
     * @param dataProvider レスポンスボディを提供する関数
     * @returns エラー情報で構成されたMicrosoftResponse
     */
    private static handleGotError<T>(operation: string, error: RequestError, dataProvider: () => T): MicrosoftResponse<T> {

        const response: MicrosoftResponse<T> = handleGotError(operation, error, MicrosoftAuth.logger, dataProvider)

        if (error instanceof HTTPError) {
            if (error.response.statusCode === 404 && error.request.requestUrl === MicrosoftAuth.MC_PROFILE_ENDPOINT) {
                response.microsoftErrorCode = MicrosoftErrorCode.NO_PROFILE
            } else {
                response.microsoftErrorCode = decipherErrorCode(error.response.body)
            }
        } else {
            response.microsoftErrorCode = MicrosoftErrorCode.UNKNOWN
        }

        return response
    }

    /**
     * Microsoftアクセストークンを取得する（初回または既存のトークンのリフレッシュ）
     * 
     * @param code 認証コードまたはリフレッシュトークン
     * @param refresh リフレッシュの場合はtrue、それ以外の場合はfalse
     * @param clientId Azureアプリケーション（クライアント）ID
     * @returns この操作のMicrosoftResponse
     * 
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authorization_Code_-.3E_Authorization_Token
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Refreshing_Tokens
     */
    public static async getAccessToken(code: string, refresh: boolean, clientId: string): Promise<MicrosoftResponse<AuthorizationTokenResponse | null>> {
        try {

            const BASE_FORM: AbstractTokenRequest = {
                client_id: clientId,
                scope: 'XboxLive.signin',
                redirect_uri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
            }

            let form
            if (refresh) {
                form = {
                    ...BASE_FORM,
                    refresh_token: code,
                    grant_type: 'refresh_token'
                } as RefreshTokenRequest
            } else {
                form = {
                    ...BASE_FORM,
                    code: code,
                    grant_type: 'authorization_code'
                } as AuthTokenRequest
            }

            const res = await got.post<AuthorizationTokenResponse>(this.TOKEN_ENDPOINT, {
                form,
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return MicrosoftAuth.handleGotError(`Get ${refresh ? 'Refresh' : 'Auth'} Token`, error as RequestError, () => null)
        }
    }

    /**
     * Microsoftアクセストークンを使用してXbox Liveで認証する
     * 
     * @param accessToken getAccessTokenからのMicrosoftアクセストークン
     * @returns この操作のMicrosoftResponse
     * 
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XBL
     */
    public static async getXBLToken(accessToken: string): Promise<MicrosoftResponse<XboxServiceTokenResponse | null>> {
        try {

            // TODO TYPE REQUEST
            const res = await got.post<XboxServiceTokenResponse>(this.XBL_AUTH_ENDPOINT, {
                json: {
                    Properties: {
                        AuthMethod: 'RPS',
                        SiteName: 'user.auth.xboxlive.com',
                        RpsTicket: `d=${accessToken}`
                    },
                    RelyingParty: 'http://auth.xboxlive.com',
                    TokenType: 'JWT'
                },
                headers: MicrosoftAuth.STANDARD_HEADERS,
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return MicrosoftAuth.handleGotError('Get XBL Token', error as RequestError, () => null)
        }
    }

    /**
     * Xbox Secure Token Service (XSTS) トークンを取得する
     * 
     * @param xblResponse getXBLTokenからのXbox Liveトークンレスポンス
     * @returns この操作のMicrosoftResponse
     * 
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XSTS
     */
    public static async getXSTSToken(xblResponse: XboxServiceTokenResponse): Promise<MicrosoftResponse<XboxServiceTokenResponse | null>> {
        try {

            // TODO TYPE REQUEST
            const res = await got.post<XboxServiceTokenResponse>(this.XSTS_AUTH_ENDPOINT, {
                json: {
                    Properties: {
                        SandboxId: 'RETAIL',
                        UserTokens: [xblResponse.Token]
                    },
                    RelyingParty: 'rp://api.minecraftservices.com/',
                    TokenType: 'JWT'
                },
                headers: MicrosoftAuth.STANDARD_HEADERS,
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return MicrosoftAuth.handleGotError('Get XSTS Token', error as RequestError, () => null)
        }
    }

    /**
     * Minecraftで認証する
     * 
     * @param xstsResponse getXSTSTokenからのXbox Secure Token Service (XSTS) トークンレスポンス
     * @returns この操作のMicrosoftResponse
     * 
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_Minecraft
     */
    public static async getMCAccessToken(xstsResponse: XboxServiceTokenResponse): Promise<MicrosoftResponse<MCTokenResponse | null>> {
        try {

            // TODO TYPE REQUEST
            const res = await got.post<MCTokenResponse>(this.MC_AUTH_ENDPOINT, {
                json: {
                    identityToken: `XBL3.0 x=${xstsResponse.DisplayClaims.xui[0].uhs};${xstsResponse.Token}`
                },
                headers: MicrosoftAuth.STANDARD_HEADERS,
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return MicrosoftAuth.handleGotError('Get MC Access Token', error as RequestError, () => null)
        }
    }

    // TODO Review https://wiki.vg/Microsoft_Authentication_Scheme#Checking_Game_Ownership
    // Cannot detect Xbox Game Pass users, so what good is this? Should we implement it just cause..?
    // public static async checkEntitlement(accessToken: string): Promise<MicrosoftResponse<unknown | null>> {
    //     try {

    //         const res = await got.get<unknown>(this.MC_ENTITLEMENT_ENDPOINT, {
    //             headers: {
    //                 Authorization: `Bearer ${accessToken}`
    //             },
    //             responseType: 'json'
    //         })

    //         return {
    //             data: res.body,
    //             responseStatus: RestResponseStatus.SUCCESS
    //         }

    //     } catch(error) {
    //         return MicrosoftAuth.handleGotError('Check Entitlement', error as RequestError, () => null)
    //     }
    // }

    /**
     * MCプロファイルデータ（特にアカウント名とuuid）を取得する
     * 
     * @param mcAccessToken getMCAccessTokenからのMinecraftアクセストークン
     * @returns この操作のMicrosoftResponse
     * 
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Get_the_profile
     */
    public static async getMCProfile(mcAccessToken: string): Promise<MicrosoftResponse<MCUserInfo | null>> {
        try {

            const res = await got.get<MCUserInfo>(this.MC_PROFILE_ENDPOINT, {
                headers: {
                    Authorization: `Bearer ${mcAccessToken}`
                },
                responseType: 'json'
            })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {
            return MicrosoftAuth.handleGotError('Get MC Profile', error as RequestError, () => null)
        }
    }

}

