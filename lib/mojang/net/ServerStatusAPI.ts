import { SrvRecord } from 'dns'
import { resolveSrv } from 'dns/promises'
import { connect } from 'net'
import { LoggerUtil } from '../../util/LoggerUtil'
import { ServerBoundPacket, ClientBoundPacket, ProtocolUtils } from './Protocol'

const logger = LoggerUtil.getLogger('ServerStatusUtil')

export interface ServerStatus {
    version: {
        name: string
        protocol: number
    }
    players: {
        max: number
        online: number
        sample: {
            name: string
            id: string
        }[]
    }
    description: {
        text: string
    }
    favicon: string
    modinfo?: {             // Modサーバーのみ
        type: string        // 例: FML
        modList: {
            modid: string
            version: string
        }[]
    }
    retrievedAt: number     // 内部追跡
}

/**
 * ハンドシェイクパケットを取得する
 *
 * @param protocol クライアントのプロトコルバージョン
 * @param hostname サーバーのホスト名
 * @param port サーバーのポート
 *
 * @see https://wiki.vg/Server_List_Ping#Handshake
 */
function getHandshakePacket(protocol: number, hostname: string, port: number): Buffer {

    return ServerBoundPacket.build()
        .writeVarInt(0x00)         // パケットID
        .writeVarInt(protocol)
        .writeString(hostname)
        .writeUnsignedShort(port)
        .writeVarInt(1)            // 状態、1 = ステータス
        .toBuffer()
}

/**
 * リクエストパケットを取得する
 *
 * @see https://wiki.vg/Server_List_Ping#Request
 */
function getRequestPacket(): Buffer {

    return ServerBoundPacket.build()
        .writeVarInt(0x00)
        .toBuffer()
}

/**
 * 一部のサーバーは同じステータスオブジェクトを返さない
 * 呼び出し元が単一の形式の処理のみを考慮すればよいように、レスポンスを統一する
 *
 * @param resp サーバーステータスレスポンス
 */
function unifyStatusResponse(resp: ServerStatus): ServerStatus {
    // 一部のサーバーは説明をテキストオブジェクトでラップしない
    if (typeof resp.description === 'string') {
        resp.description = {
            text: resp.description
        }
    }
    resp.retrievedAt = (new Date()).getTime()
    return resp
}

async function checkSrv(hostname: string): Promise<SrvRecord | null> {
    try {
        const records = await resolveSrv(`_minecraft._tcp.${hostname}`)
        return records.length > 0 ? records[0] : null
    } catch (err) {
        return null
    }
}

export async function getServerStatus(protocol: number, hostname: string, port = 25565): Promise<ServerStatus> {

    const srvRecord = await checkSrv(hostname)
    if (srvRecord != null) {
        hostname = srvRecord.name
        port = srvRecord.port
    }

    return await new Promise((resolve, reject) => {

        const socket = connect(port, hostname, () => {
            socket.write(getHandshakePacket(protocol, hostname, port))
            socket.write(getRequestPacket())
        })

        socket.setTimeout(5000, () => {
            socket.destroy()
            logger.error(`Server Status Socket timed out (${hostname}:${port})`)
            reject(new Error(`Server Status Socket timed out (${hostname}:${port})`))
        })

        const maxTries = 5
        let iterations = 0
        let bytesLeft = -1

        socket.once('data', (data) => {

            const inboundPacket = new ClientBoundPacket(data)

            // パケットID + データの長さ
            const packetLength = inboundPacket.readVarInt() // 最初のVarIntはパケット長
            const packetType = inboundPacket.readVarInt()   // 2番目のVarIntはパケットタイプ

            if (packetType !== 0x00) {
                // TODO
                socket.destroy()
                reject(new Error(`Invalid response. Expected packet type ${0x00}, received ${packetType}!`))
                return
            }

            // packetLength VarIntのサイズはpacketLengthに含まれない
            bytesLeft = packetLength + ProtocolUtils.getVarIntSize(packetLength)

            // バッファにすべてのバイトが読み込まれるまで読み続けるリスナー
            const packetReadListener = (nextData: Buffer, doAppend: boolean): void => {

                if (iterations > maxTries) {
                    socket.destroy()
                    reject(new Error(`Data read from ${hostname}:${port} exceeded ${maxTries} iterations, closing connection.`))
                    return
                }
                ++iterations

                if (bytesLeft > 0) {
                    bytesLeft -= nextData.length
                    if (doAppend) {
                        inboundPacket.append(nextData)
                    }
                }

                // すべてのバイトが読み込まれたため、変換を試みる
                if (bytesLeft === 0) {

                    // バッファの残りはサーバーステータスJSON
                    const result = inboundPacket.readString()

                    try {
                        const parsed = JSON.parse(result) as ServerStatus
                        socket.end()
                        resolve(unifyStatusResponse(parsed))
                    } catch (err) {
                        socket.destroy()
                        logger.error('Failed to parse server status JSON', err)
                        reject(new Error('Failed to parse server status JSON'))
                    }
                }
            }

            // Read the data we just received.
            packetReadListener(data, false)
            // Add a listener to keep reading if the data is too long.
            socket.on('data', (data) => packetReadListener(data, true))

        })

        socket.on('error', (err: NodeJS.ErrnoException) => {
            socket.destroy()

            if (err.code === 'ENOTFOUND') {
                // ENOTFOUND = 解決できない
                reject(new Error(`Server ${hostname}:${port} not found!`))
                return
            } else if (err.code === 'ECONNREFUSED') {
                // ECONNREFUSED = ポートに接続できない
                reject(new Error(`Server ${hostname}:${port} refused to connect, is the port correct?`))
                return
            } else {
                logger.error(`Error trying to pull server status (${hostname}:${port})`)
                reject(err)
                return
            }
        })

    })

}