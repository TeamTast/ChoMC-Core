import { resolve } from 'path'
import { Distribution } from 'Cho-distribution-types'
import got, { RequestError } from 'got'
import { LoggerUtil } from '../../util/LoggerUtil'
import { RestResponse, handleGotError, RestResponseStatus } from '../rest/RestResponse'
import { pathExists, readFile, writeJson } from 'fs-extra'
import { ChoDistribution } from './DistributionFactory'

// TODO ローカル比較のためにディストリビューションのハッシュのエンドポイントを確認するオプション
// ディストリビューションが大きい（MB単位）場合に便利

export class DistributionAPI {

    private static readonly log = LoggerUtil.getLogger('DistributionAPI')

    private readonly DISTRO_FILE = 'distribution.json'
    private readonly DISTRO_FILE_DEV = 'distribution_dev.json'

    private distroPath: string
    private distroDevPath: string

    private distribution!: ChoDistribution
    private rawDistribution!: Distribution

    constructor(
        private launcherDirectory: string,
        private commonDir: string,
        private instanceDir: string,
        private remoteUrl: string,
        private devMode: boolean
    ) {
        // 本番/開発の両ディストロファイルパスを保持して後続で使う。
        this.distroPath = resolve(launcherDirectory, this.DISTRO_FILE)
        this.distroDevPath = resolve(launcherDirectory, this.DISTRO_FILE_DEV)
    }

    public async getDistribution(): Promise<ChoDistribution> {
        // リモート/ローカルから遅延ロードし、Cho ラッパーをキャッシュする。
        if (this.rawDistribution == null) {
            this.rawDistribution = await this.loadDistribution()
            this.distribution = new ChoDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
    }

    public async getDistributionLocalLoadOnly(): Promise<ChoDistribution> {
        // ディスクのみから読み込む（開発モード向け）。無ければ例外。
        if (this.rawDistribution == null) {
            const x = await this.pullLocal()
            if (x == null) {
                throw new Error('FATAL: Unable to load distribution from local disk.')
            }
            this.rawDistribution = x
            this.distribution = new ChoDistribution(this.rawDistribution, this.commonDir, this.instanceDir)
        }
        return this.distribution
    }

    public async refreshDistributionOrFallback(): Promise<ChoDistribution> {
        // リフレッシュを試み、リモート・ローカル共に失敗したら現在のメモリ上のものを維持。
        const distro = await this._loadDistributionNullable()

        if (distro == null) {
            DistributionAPI.log.warn('Failed to refresh distribution, falling back to current load (if exists).')
            return this.distribution
        } else {
            this.rawDistribution = distro
            this.distribution = new ChoDistribution(distro, this.commonDir, this.instanceDir)

            return this.distribution
        }
    }

    public toggleDevMode(dev: boolean): void {
        // 開発/本番の読み込み先を切り替えるだけ（自動再読込はしない）。
        this.devMode = dev
    }

    public isDevMode(): boolean {
        return this.devMode
    }

    protected async loadDistribution(): Promise<Distribution> {

        const distro = await this._loadDistributionNullable()

        if (distro == null) {
            // TODO これをより適切に上位に伝播させる
            throw new Error('FATAL: Unable to load distribution from remote server or local disk.')
        }

        return distro
    }

    protected async _loadDistributionNullable(): Promise<Distribution | null> {

        let distro

        if (!this.devMode) {

            // リモートを優先。成功時はオフライン用にディスクへ書き出す。
            distro = (await this.pullRemote()).data
            if (distro == null) {
                distro = await this.pullLocal()
            } else {
                await this.writeDistributionToDisk(distro)
            }

        } else {
            // 開発モードはローカル（dev）コピーのみ参照。
            distro = await this.pullLocal()
        }

        return distro
    }

    protected async pullRemote(): Promise<RestResponse<Distribution | null>> {

        try {

            const res = await got.get<Distribution>(this.remoteUrl, { responseType: 'json' })

            return {
                data: res.body,
                responseStatus: RestResponseStatus.SUCCESS
            }

        } catch (error) {

            return handleGotError('Pull Remote', error as RequestError, DistributionAPI.log, () => null)

        }

    }

    protected async writeDistributionToDisk(distribution: Distribution): Promise<void> {
        // 取得した最新ディストロをキャッシュし、オフラインでも使えるようにする。
        await writeJson(this.distroPath, distribution)
    }

    protected async pullLocal(): Promise<Distribution | null> {
        return await this.readDistributionFromFile(!this.devMode ? this.distroPath : this.distroDevPath)
    }

    protected async readDistributionFromFile(path: string): Promise<Distribution | null> {

        if (await pathExists(path)) {
            const raw = await readFile(path, 'utf-8')
            try {
                return JSON.parse(raw) as Distribution
            } catch (error) {
                DistributionAPI.log.error(`Malformed distribution file at ${path}`)
                return null
            }
        } else {
            DistributionAPI.log.error(`No distribution file found at ${path}!`)
            return null
        }

    }

}
