import { LoggerUtil } from '../../util/LoggerUtil'
import { IndexProcessor } from '../IndexProcessor'
import { AssetGuardError } from '../AssetGuardError'
import { validateLocalFile, getVersionJsonPath } from '../../common/util/FileUtils'
import { Asset, HashAlgo } from '../Asset'
import { ChoDistribution, ChoModule, ChoServer } from '../../common/distribution/DistributionFactory'
import { Type } from 'chomc-distribution-types'
import { mcVersionAtLeast } from '../../common/util/MojangUtils'
import { ensureDir, readJson, writeJson } from 'fs-extra'
import StreamZip from 'node-stream-zip'
import { dirname } from 'path'
import { VersionJsonBase } from '../mojang/MojangTypes'

export class DistributionIndexProcessor extends IndexProcessor {

    private static readonly logger = LoggerUtil.getLogger('DistributionIndexProcessor')

    constructor(commonDir: string, protected distribution: ChoDistribution, protected serverId: string) {
        super(commonDir)
    }

    public async init(): Promise<void> {
        // 何もしない
    }

    public totalStages(): number {
        return 1
    }

    public async validate(onStageComplete: () => Promise<void>): Promise<{ [category: string]: Asset[] }> {
        // 配布モジュールをダウンロード前にローカル検証し、不足・不正なものを集計する

        const server: ChoServer = this.distribution.getServerById(this.serverId)!
        if (server == null) {
            throw new AssetGuardError(`Invalid server id ${this.serverId}`)
        }

        const notValid: Asset[] = []
        await this.validateModules(server.modules, notValid)
        await onStageComplete()

        return {
            distribution: notValid
        }
    }

    public async postDownload(): Promise<void> {
        // ダウンロード後にモッドローダーの version.json を必ず用意する
        await this.loadModLoaderVersionJson()
    }

    private async validateModules(modules: ChoModule[], accumulator: Asset[]): Promise<void> {
        // モジュールツリーを再帰的に巡り、ハッシュ検証して修復が必要なものを集める
        for (const module of modules) {
            const hash = module.rawModule.artifact.MD5

            if (!await validateLocalFile(module.getPath(), HashAlgo.MD5, hash)) {
                accumulator.push({
                    id: module.rawModule.id,
                    hash: hash!,
                    algo: HashAlgo.MD5,
                    size: module.rawModule.artifact.size,
                    url: module.rawModule.artifact.url,
                    path: module.getPath()
                })
            }

            if (module.hasSubModules()) {
                await this.validateModules(module.subModules, accumulator)
            }
        }
    }

    public async loadModLoaderVersionJson(): Promise<VersionJsonBase> {

        const server: ChoServer = this.distribution.getServerById(this.serverId)!
        if (server == null) {
            throw new AssetGuardError(`Invalid server id ${this.serverId}`)
        }

        const modLoaderModule = server.modules.find(({ rawModule: { type } }) => type === Type.ForgeHosted || type === Type.Forge || type === Type.Fabric)

        if (modLoaderModule == null) {
            throw new AssetGuardError('No mod loader found!')
        }

        // Fabric と FG3+ は別ファイルの version manifest を持つ 旧 Forge は jar 内に version.json を同梱
        if (modLoaderModule.rawModule.type === Type.Fabric
            || DistributionIndexProcessor.isForgeGradle3(server.rawServer.minecraftVersion, modLoaderModule.getMavenComponents().version)) {
            return await this.loadVersionManifest<VersionJsonBase>(modLoaderModule)
        } else {

            const zip = new StreamZip.async({ file: modLoaderModule.getPath() })

            try {

                const data = JSON.parse((await zip.entryData('version.json')).toString('utf8')) as VersionJsonBase
                const writePath = getVersionJsonPath(this.commonDir, data.id)

                // 抽出した version.json を versions ディレクトリへ書き出し、後続処理で参照できるようにする
                await ensureDir(dirname(writePath))
                await writeJson(writePath, data)

                return data
            }
            finally {
                await zip.close()
            }

        }
    }

    public async loadVersionManifest<T>(modLoaderModule: ChoModule): Promise<T> {
        // モッドローダーに同梱された version manifest モジュールを探す
        const versionManifstModule = modLoaderModule.subModules.find(({ rawModule: { type } }) => type === Type.VersionManifest)
        if (versionManifstModule == null) {
            throw new AssetGuardError('No mod loader version manifest module found!')
        }

        return await readJson(versionManifstModule.getPath(), 'utf-8') as T
    }

    // TODO これをユーティリティに移動するかもしれない
    public static isForgeGradle3(mcVersion: string, forgeVersion: string): boolean {

        // MC1.13+ は FG3+ とみなす それ以前は FG2 最終版との比較で判定
        if (mcVersionAtLeast('1.13', mcVersion)) {
            return true
        }

        try {

            const forgeVer = forgeVersion.split('-')[1]

            const maxFG2 = [14, 23, 5, 2847]
            const verSplit = forgeVer.split('.').map(v => Number(v))

            // 各バージョン番号を順に比較し、上回れば FG3+ と判定
            for (let i = 0; i < maxFG2.length; i++) {
                if (verSplit[i] > maxFG2[i]) {
                    return true
                } else if (verSplit[i] < maxFG2[i]) {
                    return false
                }
            }

            return false

        } catch (err) {
            throw new Error('Forge version is complex (changed).. launcher requires a patch.')
        }
    }

}