import { Server } from 'Helios-distribution-types'

export function getMainServer(servers: Server[]): Server {

    // main フラグを優先し、無ければ先頭を返す。
    const mainServer = servers.find(({ mainServer }) => mainServer)
    if (mainServer == null && servers.length > 0) {
        return servers[0]
    }

    return mainServer!
}