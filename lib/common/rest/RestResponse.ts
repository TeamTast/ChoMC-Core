import { RequestError, HTTPError, TimeoutError, ParseError } from 'got'
import { Logger } from 'winston'

/**
 * Restレスポンスステータス
 */
export enum RestResponseStatus {
    /**
     * リクエストが成功したことを示すステータス
     */
    SUCCESS,
    /**
     * レスポンスに問題があったことを示すステータス
     * 200番台以外のすべてのステータスコードはエラーステータスとなる
     */
    ERROR
}

/**
 * 一般的なREST呼び出しのための基本RestResponse
 */
export interface RestResponse<T> {

    /**
     * レスポンスボディ
     */
    data: T
    /**
     * レスポンスステータス
     */
    responseStatus: RestResponseStatus
    /**
     * responseStatusがERRORの場合のエラーボディ
     */
    error?: RequestError

}

/**
 * エラーコードを表示可能なメッセージに変換するためのオブジェクト
 */
export interface DisplayableError {
    /**
     * エラータイトル
     */
    title: string
    /**
     * エラー説明
     */
    desc: string
}

export function isDisplayableError(it: unknown): boolean {
    return typeof it == 'object'
        && it != null
        && Object.prototype.hasOwnProperty.call(it, 'title')
        && Object.prototype.hasOwnProperty.call(it, 'desc')
}

/**
 * 一般的なRestResponseのgotエラーを処理する
 *
 * @param operation ログ出力用の操作名
 * @param error 発生したエラー
 * @param logger ロガーインスタンス
 * @param dataProvider レスポンスボディを提供する関数
 * @returns エラー情報で構成されたRestResponse
 */
export function handleGotError<T>(operation: string, error: RequestError, logger: Logger, dataProvider: () => T): RestResponse<T> {
    const response: RestResponse<T> = {
        data: dataProvider(),
        responseStatus: RestResponseStatus.ERROR,
        error
    }
    
    if(error instanceof HTTPError) {
        logger.error(`${operation} リクエスト中にエラーが発生しました (HTTPレスポンス ${error.response.statusCode})`, error)
        logger.debug('レスポンス詳細:')
        logger.debug(`URL: ${error.request.requestUrl}`)
        logger.debug('ボディ:', error.response.body)
        logger.debug('ヘッダー:', error.response.headers)
    } else if(error.name === 'RequestError') {
        logger.error(`${operation} リクエストは応答を受信しませんでした (${error.code})。`, error)
    } else if(error instanceof TimeoutError) {
        logger.error(`${operation} リクエストがタイムアウトしました (${error.timings.phases.total}ms)。`)
    } else if(error instanceof ParseError) {
        logger.error(`${operation} リクエストが予期しないボディを受信しました (解析エラー)。`)
    } else {
        // CacheError, ReadError, MaxRedirectsError, UnsupportedProtocolError, CancelError
        logger.error(`${operation} リクエスト中にエラーが発生しました。`, error)
    }

    return response
}