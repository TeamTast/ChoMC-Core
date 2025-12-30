import { RestResponse } from '../../common/rest/RestResponse'

/**
 * Microsoft認証プロセスの任意の時点からの様々なエラーコード
 */
export enum MicrosoftErrorCode {
    /**
     * 不明なエラー
     */
    UNKNOWN,
    /**
     * プロファイルエラー
     *
     * アカウントがMinecraftプロファイルを設定していないか、ゲームを所有していない
     *
     * Xbox Game Passユーザーで、新しいMinecraft Launcherに少なくとも一度もログインしていない場合、
     * プロファイルは返されず、Minecraftユーザー名を設定するためにXbox Game Passを有効にした後、
     * 一度ログインする必要があることに注意
     *
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Get_the_profile
     */
    NO_PROFILE,
    /**
     * XSTSエラー
     *
     * アカウントにXboxアカウントがない。Xboxアカウントにサインアップする（またはminecraft.netからログインして作成する）と、
     * ログインを続行できる。MicrosoftアカウントでMinecraftを購入したアカウントでは、
     * すでにXboxサインアッププロセスを経ているため、これは発生しないはずである
     *
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XSTS
     */
    NO_XBOX_ACCOUNT = 2148916233,
    /**
     * XSTSエラー
     *
     * アカウントがXbox Liveが利用できない/禁止されている国のものである
     *
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XSTS
     */
    XBL_BANNED = 2148916235,
    /**
     * XSTSエラー
     *
     * アカウントが子供（18歳未満）であり、大人がファミリーに追加しない限り続行できない
     * これは、カスタムMicrosoft Azureアプリケーションを使用している場合にのみ発生するようである
     * MinecraftランチャーのクライアントIDを使用している場合、これはトリガーされない
     *
     * @see https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XSTS
     */
    UNDER_18 = 2148916238
}

export interface MicrosoftResponse<T> extends RestResponse<T> {
    microsoftErrorCode?: MicrosoftErrorCode
}

/**
 * レスポンスボディからエラーレスポンスコードを解決する
 *
 * @param body Microsoftエラーボディレスポンス
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decipherErrorCode(body: any): MicrosoftErrorCode {

    if(body) {
        if(body.XErr) {
            const xErr: number = body.XErr as number
            switch(xErr as MicrosoftErrorCode) {
                case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
                    return MicrosoftErrorCode.NO_XBOX_ACCOUNT
                case MicrosoftErrorCode.XBL_BANNED:
                    return MicrosoftErrorCode.XBL_BANNED
                case MicrosoftErrorCode.UNDER_18:
                    return MicrosoftErrorCode.UNDER_18
            }
        }
    }

    return MicrosoftErrorCode.UNKNOWN
}