import { RestResponse } from '../../common/rest/RestResponse'

/**
 * @see https://wiki.vg/Authentication#Errors
 */
export enum MojangErrorCode {
    ERROR_METHOD_NOT_ALLOWED,       // 内部
    ERROR_NOT_FOUND,                // 内部
    ERROR_USER_MIGRATED,
    ERROR_INVALID_CREDENTIALS,
    ERROR_RATELIMIT,
    ERROR_INVALID_TOKEN,
    ERROR_ACCESS_TOKEN_HAS_PROFILE, // ??
    ERROR_CREDENTIALS_MISSING,      // 内部
    ERROR_INVALID_SALT_VERSION,     // ??
    ERROR_UNSUPPORTED_MEDIA_TYPE,   // 内部
    ERROR_GONE,
    ERROR_UNREACHABLE,
    ERROR_NOT_PAID,                 // 自動的に検出されない、レスポンスは特定のボディを持つ200である
    UNKNOWN
}

export interface MojangResponse<T> extends RestResponse<T> {
    mojangErrorCode?: MojangErrorCode
    isInternalError?: boolean
}

export interface MojangErrorBody {
    error: string
    errorMessage: string
    cause?: string
}

/**
 * レスポンスボディからエラーレスポンスコードを解決する
 *
 * @param body Mojangエラーボディレスポンス
 */
export function decipherErrorCode(body: MojangErrorBody): MojangErrorCode {

    if(body.error === 'Method Not Allowed') {
        return MojangErrorCode.ERROR_METHOD_NOT_ALLOWED
    } else if(body.error === 'Not Found') {
        return MojangErrorCode.ERROR_NOT_FOUND
    } else if(body.error === 'Unsupported Media Type') {
        return MojangErrorCode.ERROR_UNSUPPORTED_MEDIA_TYPE
    } else if(body.error === 'ForbiddenOperationException') {

        if(body.cause && body.cause === 'UserMigratedException') {
            return MojangErrorCode.ERROR_USER_MIGRATED
        }

        if(body.errorMessage === 'Invalid credentials. Invalid username or password.') {
            return MojangErrorCode.ERROR_INVALID_CREDENTIALS
        } else if(body.errorMessage === 'Invalid credentials.') {
            return MojangErrorCode.ERROR_RATELIMIT
        } else if(body.errorMessage === 'Invalid token.') {
            return MojangErrorCode.ERROR_INVALID_TOKEN
        } else if(body.errorMessage === 'Forbidden') {
            return MojangErrorCode.ERROR_CREDENTIALS_MISSING
        }

    } else if(body.error === 'IllegalArgumentException') {

        if(body.errorMessage === 'Access token already has a profile assigned.') {
            return MojangErrorCode.ERROR_ACCESS_TOKEN_HAS_PROFILE
        } else if(body.errorMessage === 'Invalid salt version') {
            return MojangErrorCode.ERROR_INVALID_SALT_VERSION
        }

    } else if(body.error === 'ResourceException' || body.error === 'GoneException') {
        return MojangErrorCode.ERROR_GONE
    }

    return MojangErrorCode.UNKNOWN

}

// これらはデータではなくコードの問題を示す
export function isInternalError(errorCode: MojangErrorCode): boolean {
    switch(errorCode) {
        case MojangErrorCode.ERROR_METHOD_NOT_ALLOWED:       // エンドポイントに間違ったメソッドを送信した（例：POSTへのGET）
        case MojangErrorCode.ERROR_NOT_FOUND:                // エンドポイントが変更されたことを示す（404）
        case MojangErrorCode.ERROR_ACCESS_TOKEN_HAS_PROFILE: // プロファイルの選択はまだ実装されていない（発生しないはず）
        case MojangErrorCode.ERROR_CREDENTIALS_MISSING:      // ユーザー名/パスワードが送信されなかった（UIで禁止すべき）
        case MojangErrorCode.ERROR_INVALID_SALT_VERSION:     // ???（発生しないはず）
        case MojangErrorCode.ERROR_UNSUPPORTED_MEDIA_TYPE:   // データがapplication/jsonとして送信されなかった
            return true
        default:
            return false
    }
}