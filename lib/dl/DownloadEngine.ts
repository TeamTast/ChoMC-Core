import { createWriteStream, WriteStream } from 'fs'
import got, { Progress, ReadError, RequestError } from 'got'
import { pipeline } from 'stream/promises'
import { Asset } from './Asset'
import * as fastq from 'fastq'
import type { queueAsPromised } from 'fastq'
import { ensureDir } from 'fs-extra'
import { dirname } from 'path'
import { LoggerUtil } from '../util/LoggerUtil'
import { sleep } from '../util/NodeUtil'

const log = LoggerUtil.getLogger('DownloadEngine')

export function getExpectedDownloadSize(assets: Asset[]): number {
    return assets.map(({ size }) => size).reduce((acc, v) => acc + v, 0)
}

export async function downloadQueue(assets: Asset[], onProgress: (received: number) => void): Promise<{ [id: string]: number }> {

    const receivedTotals: { [id: string]: number } = assets.map(({ id }) => id).reduce((acc, id) => ({ ...acc, [id]: 0 }), ({}))

    let received = 0

    const onEachProgress = (asset: Asset): (progress: Progress) => void => {
        return ({ transferred }: Progress): void => {
            received += (transferred - receivedTotals[asset.id])
            receivedTotals[asset.id] = transferred
            onProgress(received)
        }
    }

    const wrap = (asset: Asset): Promise<void> => downloadFile(asset.url, asset.path, onEachProgress(asset))

    const q: queueAsPromised<Asset, void> = fastq.promise(wrap, 15)

    const promises: Promise<void>[] = assets.map(asset => q.push(asset)).reduce((acc, p) => ([...acc, p]), ([] as Promise<void>[]))
    await Promise.all(promises)

    return receivedTotals
}

export async function downloadFile(url: string, path: string, onProgress?: (progress: Progress) => void): Promise<void> {

    await ensureDir(dirname(path))


    const MAX_RETRIES = 10
    let fileWriterStream: WriteStream = null!       // 書き込みストリーム
    let retryCount = 0                              // 試行された再試行回数
    let error: Error = null!                        // キャッチされたエラー
    let retry = false                               // 再試行すべきか
    let rethrow = false                             // エラーをスローすべきか

    // Gotのストリーミング再試行APIは存在せず、その「例」はひどいものだ
    // 彼らの「API」を使うには、再帰的なコールバック地獄に身を投じる必要がある
    // 遠慮しておく。私はこのシンプルでエラーが起きにくいロジックを好む
    do {

        retry = false
        rethrow = false

        if (retryCount > 0) {
            log.debug(`Retry attempt #${retryCount} for ${url}.`)
        }

        try {
            const downloadStream = got.stream(url)

            fileWriterStream = createWriteStream(path)

            if (onProgress) {
                downloadStream.on('downloadProgress', (progress: Progress) => onProgress(progress))
            }

            await pipeline(downloadStream, fileWriterStream)

        } catch (err) {
            error = err as Error
            retryCount++
            rethrow = true

            // 今のところ、タイムアウトのみ再試行する
            retry = retryCount <= MAX_RETRIES && retryableError(error)

            if (fileWriterStream) {
                fileWriterStream.destroy()
            }

            if (onProgress && retry) {
                // 再試行するため、このアセットの進捗をリセットする
                onProgress({ transferred: 0, percent: 0, total: 0 })
            }

            if (retry) {
                // 再試行する前に1秒待つ
                // これは指数バックオフになる可能性があるが、今はその必要性を感じない
                await sleep(1000)
            }
        }

    } while (retry)

    if (rethrow && error) {
        if (retryCount > MAX_RETRIES) {
            log.error(`Maximum retries attempted for ${url}. Rethrowing exception.`)
        } else {
            log.error(`Unknown or unretryable exception thrown during request to ${url}. Rethrowing exception.`)
        }

        throw error
    }

}

function retryableError(error: Error): boolean {
    if (error instanceof RequestError) {
        // error.name === 'RequestError' はサーバーが応答しなかったことを意味する
        return error.name === 'RequestError' || error instanceof ReadError && error.code === 'ECONNRESET'
    } else {
        return false
    }
}