import { fsyncSync, writeSync } from 'fs'
import { LoggerUtil } from '../../util/LoggerUtil'
import { FullRepairReceiver } from './FullRepairReceiver'
import { ErrorReply, Receiver } from './Receiver'

const log = LoggerUtil.getLogger('ReceiverExecutor')
log.info('Receiver process started.')

const manifest: Record<string, () => Receiver> = {
    FullRepairReceiver: () => new FullRepairReceiver()
}

const targetReceiver = process.argv[2]
if(!Object.prototype.hasOwnProperty.call(manifest, targetReceiver)) {
    log.error(`Unknown receiver '${targetReceiver}', shutting down..`)
    process.exit(1)
}

const receiver = manifest[targetReceiver]()
// eslint-disable-next-line @typescript-eslint/no-misused-promises
process.on('message', async message => {
    try {
        await receiver.execute(message)
    } catch(err) {
        log.error('Error During Receiver Operation')
        log.error(err)
        let displayable = undefined
        try {
            log.error('Asking the reciever for more details (if available):')
            displayable = await receiver.parseError(err)
            if (displayable) {
                log.error(`Receiver replied with ${displayable}`)
            } else {
                log.error('The receiver could not parse the error.')
            }
            
        } catch(fixme) {
            log.error('The reciever\'s error parser threw also, this is a bug and should be reported.', fixme)
        }
        // winstonロガーはstdoutにのみ出力するため、これで機能する
        // stdoutに直接書き込み、フラッシュを待機する
        writeSync(process.stdout.fd, 'Error now being propagated back to the transmitter.')
        fsyncSync(process.stdout.fd)
        process.send!({
            response: 'error',
            displayable

        } as ErrorReply)
        // 現在のエグゼキュータの動作は、最初のエラーで終了することである
        // 理論上、未処理のエラーがここに到達した場合、プロセスは失敗している
        // プロセスをクラッシュさせるべきでないエラーは、この時点に到達する前に処理されるべきである
        process.exit(1)
    }
})

// 問題をコンソールにダンプする
process.on('unhandledRejection', r => console.log(r))

process.on('disconnect', () => {
    log.info('Disconnect singal received, shutting down.')
    process.exit(0)
})