import { exec } from 'child_process'
import { pathExists, readdir } from 'fs-extra'
import got from 'got'
import { Architecture, JdkDistribution, Platform } from 'chomc-distribution-types'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { LauncherJson } from '../model/mojang/LauncherJson'
import { LoggerUtil } from '../util/LoggerUtil'
import Registry from 'winreg'
import semver from 'semver'
import { Asset, HashAlgo } from '../dl'
import { extractTarGz, extractZip } from '../common/util/FileUtils'

const log = LoggerUtil.getLogger('JavaGuard')

export interface JavaVersion {
    major: number
    minor: number
    patch: number
}

export interface AdoptiumJdk {
    binary: {
        architecture: string
        download_count: number
        heap_size: string
        image_type: 'jdk' | 'debugimage' | 'testimage'
        jvm_impl: string
        os: string
        package: {
            checksum: string
            checksum_link: string
            download_count: number
            link: string
            metadata_link: string
            name: string
            size: number
        }
        project: string
        scm_ref: string
        updated_at: string
    }
    release_name: string
    vendor: string
    version: {
        build: number
        major: number
        minor: number
        openjdk_version: string
        security: number
        semver: string
    }
}

// 参照
// awt.toolkit JDK 9で削除 https://bugs.openjdk.org/browse/JDK-8225358
// file.encoding.pkg JDK 11で削除 https://bugs.openjdk.org/browse/JDK-8199470 "ローカルエンコーディングとUnicode間の変換を処理するコンバータを含むパッケージ"
// java.awt.graphicsenv JDK 13で削除 https://bugs.openjdk.org/browse/JDK-8130266
// java.awt.printerjob 削除された
// java.endorsed.dirs JDK 9で削除 (8で非推奨 https://docs.oracle.com/javase/8/docs/technotes/guides/standards/)
// java.ext.dirs JDK 9で削除 https://openjdk.org/jeps/220
// sun.boot.class.path JDK 9で削除 https://openjdk.org/jeps/261
// sun.desktop JDK 13で削除 https://bugs.openjdk.org/browse/JDK-8222814
// user.timezone 初期値はJDK 12で削除 https://bugs.openjdk.org/browse/JDK-8213551

/**
 * HotSpotプロパティ
 *
 * java -XshowSettings:properties -version で取得
 *
 * https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/System.html#getProperties()
 * https://docs.oracle.com/javase/tutorial/essential/environment/sysprop.html
 * https://docs.oracle.com/javame/config/cdc/cdc-opt-impl/ojmeec/1.1/architecture/html/properties.htm
 */
export interface HotSpotSettings {
    /**
     * デフォルトロケールの文字エンコーディング
     */
    'file.encoding': string
    /**
     * ファイルパスのコンポーネントを区切る文字。UNIXでは "/"、Windowsでは "\"
     */
    'file.separator': string
    /**
     * クラスファイルを含むディレクトリやJARアーカイブを見つけるために使用されるパス。クラスパスの要素は、path.separatorプロパティで指定されたプラットフォーム固有の文字で区切られる
     * 明らかな理由により、-XshowSettingsでは空になる
     */
    'java.class.path': string
    /**
     * Javaクラスフォーマットのバージョン番号
     * 文字列として読み取られるが、実際には数値
     */
    'java.class.version': string
    /**
     * Javaインストールディレクトリ（8では、JDKを使用している場合、バンドルされたJREへのパス）
     */
    'java.home': string
    /**
     * デフォルトの一時ファイルパス
     */
    'java.io.tmpdir': string
    /**
     * ライブラリをロードする際に検索するパスのリスト
     */
    'java.library.path': string[]
    /**
     * ランタイム名 *未文書化*
     * https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/VersionProps.java.template#L105
     */
    'java.runtime.name': string
    /**
     * ランタイムバージョン *未文書化*
     * https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/VersionProps.java.template#L104
     * 例 17: 17.0.5+8; 8: 1.8.0_352-b08
     */
    'java.runtime.version': string
    /**
     * 初期リリースでは未定義。ランタイムが仕様の改訂版を実装していることを示す
     * https://bugs.openjdk.org/browse/JDK-8286766
     */
    'java.specification.maintenance.version'?: string
    /**
     * Javaランタイム環境仕様名
     */
    'java.specification.name': string
    /**
     * Javaランタイム環境仕様ベンダー
     */
    'java.specification.vendor': string
    /**
     * Javaランタイム環境仕様バージョン。その値はランタイムバージョンの機能要素
     *
     * 例 17: 17; 8: 1.8
     */
    'java.specification.version': string
    /**
     * Javaランタイム環境ベンダー
     */
    'java.vendor': string
    /**
     * JavaベンダーURL
     */
    'java.vendor.url': string
    /**
     * Javaベンダーバグ報告URL *未文書化*（ただし標準）
     */
    'java.vendor.url.bug': string
    /**
     * Javaベンダーバージョン（オプション）
     * JDK 10+
     * https://openjdk.org/jeps/322
     */
    'java.vendor.version'?: string
    /**
     * Javaランタイム環境バージョン
     * 例 17: 17.0.5; 8: 1.8.0_352
     */
    'java.version': string
    /**
     * Javaランタイム環境バージョン日付（ISO-8601 YYYY-MM-DD形式）
     * JDK 10+
     * https://openjdk.org/jeps/322
     */
    'java.version.date'?: string
    /**
     * 内部フラグ、VMが実行されている圧縮Oopモード（JDK内部テスト用）
     * JDK 9+
     * https://bugs.openjdk.org/browse/JDK-8064457
     */
    'java.vm.compressedOopsMode'?: string
    /**
     * 概要情報は利用不可、非常に長い間JDKの一部である
     */
    'java.vm.info': string
    /**
     * Java仮想マシン実装名
     */
    'java.vm.name': string
    /**
     * 	Javaランタイム環境仕様名
     */
    'java.vm.specification.name': string
    /**
     * Javaランタイム環境仕様ベンダー
     */
    'java.vm.specification.vendor': string
    /**
     * Java仮想マシン仕様バージョン。その値はランタイムバージョンの機能要素
     *
     * 例 17: 17; 8: 1.8
     */
    'java.vm.specification.version': string
    /**
     * Java仮想マシン実装ベンダー
     */
    'java.vm.vendor': string
    /**
     * Java仮想マシン実装バージョン
     * 例 17: 17.0.5+8; 8: 25.352-b08
     */
    'java.vm.version': string
    /**
     * おそらく内部フラグ、使用しないでください。17にはありますが、8にはありません。
     */
    'jdk.debug'?: string
    /**
     * 行区切り文字（UNIXでは "\n"、Windowsでは "\r \n"）
     */
    'line.separator': string
    /**
     * ホスト環境および/またはユーザー設定から派生した文字エンコーディング名。このシステムプロパティを設定しても効果はありません。
     * https://openjdk.org/jeps/400
     * JDK 17+
     */
    'native.encoding'?: string
    /**
     * オペレーティングシステムアーキテクチャ。
     */
    'os.arch': string
    /**
     * オペレーティングシステム名。
     */
    'os.name': string
    /**
     * オペレーティングシステムバージョン。
     * 数値として解析できるように見えます。
     */
    'os.version': string
    /**
     * パス区切り文字（UNIXでは ":"、Windowsでは ";"）
     */
    'path.separator': string
    /**
     * プラットフォームのワードサイズ。例: "32", "64", "unknown"
     */
    'sun.arch.data.model': string
    /**
     * ここから、VMはVMライブラリ（JVMTIに関連するものなど）およびブートクラスパス上のクラスに必要なライブラリをロードします。読み取り専用プロパティ。
     */
    'sun.boot.library.path': string
    /**
     * CPUのエンディアン、"little" または "big"。
     */
    'sun.cpu.endian': string
    /**
     * このプラットフォームで実行可能なネイティブ命令セットの名前。
     */
    'sun.cpu.isalist': string
    /**
     * プラットフォーム固有、sun.cpu.endianに従います。例: "UnicodeLittle"。
     */
    'sun.io.unicode.encoding': string
    /**
     * 内部、javaプロセスが既知のランチャーから来たかどうかを判断するために使用されます。
     * 例: https://github.com/openjdk/jdk/blob/master/src/java.desktop/windows/classes/sun/java2d/windows/WindowsFlags.java#L86
     */
    'sun.java.launcher': string
    /**
     * プラットフォーム文字列を解釈するために使用されるエンコーディング。
     * https://happygiraffe.net/2009/09/24/java-platform-encoding/
     */
    'sun.jnu.encoding': string
    /**
     * Tiered, client, or server
     * https://stackoverflow.com/questions/14818584/which-java-hotspot-jit-compiler-is-running
     */
    'sun.management.compiler': string
    /**
     * 内部
     */
    'sun.os.patch.level': string
    /**
     * 内部
     */
    'sun.stderr.encoding': string
    /**
     * 内部
     */
    'sun.stdout.encoding': string
    /**
     * 国（システム依存）。
     */
    'user.country': string
    /**
     * ユーザーの現在の作業ディレクトリ。
     */
    'user.dir': string
    /**
     * ユーザーのホームディレクトリ。
     */
    'user.home': string
    /**
     * デフォルトロケールの2文字の言語コード（システム依存）。
     */
    'user.language': string
    /**
     * ユーザーのアカウント名。
     */
    'user.name': string
    /**
     * ユーザー指定のスクリプト。
     * https://bugs.openjdk.org/browse/JDK-6990452
     */
    'user.script': string
    /**
     * Variant (more specific than country and language).
     */
    'user.variant': string
}

/**
 * ターゲットJDKのプロパティを取得する。HotSpot VMのみが公式に
 * サポートされている。プロパティはVMによって変更される可能性があるため。
 * 内部プロパティの使用は避けるべきである
 * 
 * @param execPath Java実行可能ファイルへのパス
 * @returns 解析されたHotSpot VMプロパティ
 */
export async function getHotSpotSettings(execPath: string): Promise<HotSpotSettings | null> {

    const javaExecutable = execPath.includes('javaw.exe') ? execPath.replace('javaw.exe', 'java.exe') : execPath

    if (!await pathExists(execPath)) {
        log.warn(`Candidate JVM path does not exist, skipping. ${execPath}`)
        return null
    }

    const execAsync = promisify(exec)

    let stderr
    try {
        stderr = (await execAsync(`"${javaExecutable}" -XshowSettings:properties -version`)).stderr
    } catch (error) {
        log.error(`Failed to resolve JVM settings for '${execPath}'`)
        log.error(error)
        return null
    }


    const listProps = [
        'java.library.path'
    ]

    const ret: Record<string, unknown> = {}

    const split = stderr.split('\n')
    let lastProp: string = null!
    for (const prop of split) {
        if (prop.startsWith('        ')) {
            // 前のプロパティに追加
            if (!Array.isArray(ret[lastProp])) {
                ret[lastProp] = [ret[lastProp]]
            }
            (ret[lastProp] as unknown[]).push(prop.trim())
        }
        else if (prop.startsWith('    ')) {
            const tmp = prop.split('=')
            const key = tmp[0].trim()
            const val = tmp[1].trim()

            ret[key] = val
            lastProp = key
        }
    }

    for (const key of listProps) {
        if (ret[key] != null && !Array.isArray(ret[key])) {
            ret[key] = [ret[key]]
        }
    }

    return ret as unknown as HotSpotSettings
}

export async function resolveJvmSettings(paths: string[]): Promise<{ [path: string]: HotSpotSettings }> {

    const ret: { [path: string]: HotSpotSettings } = {}

    for (const path of paths) {
        const settings = await getHotSpotSettings(javaExecFromRoot(path))
        if (settings != null) {
            ret[path] = settings
        } else {
            log.warn(`Skipping invalid JVM candidate: ${path}`)
        }
    }

    return ret
}

export interface JvmDetails {
    semver: JavaVersion
    semverStr: string
    vendor: string
    path: string
}

export function filterApplicableJavaPaths(resolvedSettings: { [path: string]: HotSpotSettings }, semverRange: string): JvmDetails[] {

    const arm = process.arch === Architecture.ARM64

    const jvmDetailsUnfiltered = Object.entries(resolvedSettings)
        .filter(([, settings]) => parseInt(settings['sun.arch.data.model']) === 64) // 64ビットのみ許可。
        .filter(([, settings]) => arm ? settings['os.arch'] === 'aarch64' : true) // armアーキテクチャではarmのみ許可（m2 macでのrosettaを禁止）
        .map(([path, settings]) => {
            const parsedVersion = parseJavaRuntimeVersion(settings['java.version'])
            if (parsedVersion == null) {
                log.error(`Failed to parse JDK version at location '${path}' (Vendor: ${settings['java.vendor']})`)
                return null!
            }
            return {
                semver: parsedVersion,
                semverStr: javaVersionToString(parsedVersion),
                vendor: settings['java.vendor'],
                path
            }
        })
        .filter(x => x != null)

    // オプションでフィルタリング。
    return jvmDetailsUnfiltered
        .filter(details => semver.satisfies(details.semverStr, semverRange))
}

export function rankApplicableJvms(details: JvmDetails[]): void {
    details.sort((a, b) => {

        if (a.semver.major === b.semver.major) {
            if (a.semver.minor === b.semver.minor) {
                if (a.semver.patch === b.semver.patch) {

                    // 同じバージョン、JREを優先。
                    if (a.path.toLowerCase().includes('jdk')) {
                        return b.path.toLowerCase().includes('jdk') ? 0 : 1
                    } else {
                        return -1
                    }

                } else {
                    return (a.semver.patch - b.semver.patch) * -1
                }
            } else {
                return (a.semver.minor - b.semver.minor) * -1
            }
        } else {
            return (a.semver.major - b.semver.major) * -1
        }
    })
}

// 最適なインストールを検出するために使用されます
export async function discoverBestJvmInstallation(dataDir: string, semverRange: string): Promise<JvmDetails | null> {

    // 候補を取得し、重複を除外します
    const paths = [...new Set<string>(await getValidatableJavaPaths(dataDir))]

    // VM設定を取得します
    const resolvedSettings = await resolveJvmSettings(paths)

    // フィルタリング
    const jvmDetails = filterApplicableJavaPaths(resolvedSettings, semverRange)

    // ランク付け
    rankApplicableJvms(jvmDetails)

    return jvmDetails.length > 0 ? jvmDetails[0] : null
}

// 選択されたjvmを検証するために使用されます
export async function validateSelectedJvm(path: string, semverRange: string): Promise<JvmDetails | null> {

    if (!await pathExists(path)) {
        return null
    }

    // VM設定を取得します
    const resolvedSettings = await resolveJvmSettings([path])

    // フィルタリング
    const jvmDetails = filterApplicableJavaPaths(resolvedSettings, semverRange)

    // ランク付け
    rankApplicableJvms(jvmDetails)

    return jvmDetails.length > 0 ? jvmDetails[0] : null
}

/**
 * 最後のOpenJDKバイナリを取得します。
 *
 * HOTFIX: macOSにはCorretto 8を使用します。
 * 参照: https://github.com/dscalzi/ChoLauncher/issues/70
 * 参照: https://github.com/AdoptOpenJDK/openjdk-support/issues/101
 *
 * @param {number} major 取得するJavaのメジャーバージョン。
 * @param {string} dataDir ランチャーデータディレクトリへのパス。
 * @param {JdkDistribution} [distribution] 使用するJDKディストリビューション。指定されていない場合、プラットフォームに基づいて自動的に選択されます。
 *
 * @returns {Promise.<Asset | null>} JDKダウンロードデータを含むオブジェクトに解決されるPromise。
 */
export async function latestOpenJDK(major: number, dataDir: string, distribution?: JdkDistribution): Promise<Asset | null> {

    if (distribution == null) {
        // ディストリビューションが指定されていない場合、macOSではCorretto、それ以外ではTemurinを使用する
        if (process.platform === Platform.DARWIN) {
            return latestCorretto(major, dataDir)
        } else {
            return latestAdoptium(major, dataDir)
        }
    } else {
        // 優先されるディストリビューションを尊重する
        switch (distribution) {
            case JdkDistribution.TEMURIN:
                return latestAdoptium(major, dataDir)
            case JdkDistribution.CORRETTO:
                return latestCorretto(major, dataDir)
            default: {
                const eMsg = `Unknown distribution '${distribution}'`
                log.error(eMsg)
                throw new Error(eMsg)
            }
        }
    }
}

export async function latestAdoptium(major: number, dataDir: string): Promise<Asset | null> {

    const sanitizedOS = process.platform === Platform.WIN32 ? 'windows' : (process.platform === Platform.DARWIN ? 'mac' : process.platform)
    const arch: string = process.arch === Architecture.ARM64 ? 'aarch64' : Architecture.X64
    const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?vendor=eclipse`

    try {
        const res = await got.get<AdoptiumJdk[]>(url, { responseType: 'json' })
        if (res.body.length > 0) {
            const targetBinary = res.body.find(entry => {
                return entry.version.major === major
                    && entry.binary.os === sanitizedOS
                    && entry.binary.image_type === 'jdk'
                    && entry.binary.architecture === arch
            })

            if (targetBinary != null) {
                return {
                    url: targetBinary.binary.package.link,
                    size: targetBinary.binary.package.size,
                    id: targetBinary.binary.package.name,
                    hash: targetBinary.binary.package.checksum,
                    algo: HashAlgo.SHA256,
                    path: join(getLauncherRuntimeDir(dataDir), targetBinary.binary.package.name)
                }
            } else {
                log.error(`Failed to find a suitable Adoptium binary for JDK ${major} (${sanitizedOS} ${arch}).`)
                return null
            }
        } else {
            log.error(`Adoptium returned no results for JDK ${major}.`)
            return null
        }

    } catch (err) {
        log.error(`Error while retrieving latest Adoptium JDK ${major} binaries.`, err)
        return null
    }
}

export async function latestCorretto(major: number, dataDir: string): Promise<Asset | null> {

    let sanitizedOS: string, ext: string
    const arch = process.arch === Architecture.ARM64 ? 'aarch64' : Architecture.X64

    switch (process.platform) {
        case Platform.WIN32:
            sanitizedOS = 'windows'
            ext = 'zip'
            break
        case Platform.DARWIN:
            sanitizedOS = 'macos'
            ext = 'tar.gz'
            break
        case Platform.LINUX:
            sanitizedOS = 'linux'
            ext = 'tar.gz'
            break
        default:
            sanitizedOS = process.platform
            ext = 'tar.gz'
            break
    }

    const url = `https://corretto.aws/downloads/latest/amazon-corretto-${major}-${arch}-${sanitizedOS}-jdk.${ext}`
    const md5url = `https://corretto.aws/downloads/latest_checksum/amazon-corretto-${major}-${arch}-${sanitizedOS}-jdk.${ext}`
    try {
        const res = await got.head(url)
        const checksum = await got.get(md5url)
        if (res.statusCode === 200) {
            const name = url.substring(url.lastIndexOf('/') + 1)
            return {
                url: url,
                size: parseInt(res.headers['content-length']!),
                id: name,
                hash: checksum.body,
                algo: HashAlgo.MD5,
                path: join(getLauncherRuntimeDir(dataDir), name)
            }
        } else {
            log.error(`Error while retrieving latest Corretto JDK ${major} (${sanitizedOS} ${arch}): ${res.statusCode} ${res.statusMessage ?? ''}`)
            return null
        }
    } catch (err) {
        log.error(`Error while retrieving latest Corretto JDK ${major} (${sanitizedOS} ${arch}).`, err)
        return null
    }
}

export async function extractJdk(archivePath: string): Promise<string> {
    let javaExecPath: string = null!
    if (archivePath.endsWith('zip')) {
        await extractZip(archivePath, async zip => {
            const entries = await zip.entries()
            javaExecPath = javaExecFromRoot(join(dirname(archivePath), Object.keys(entries)[0]))
        })
    }
    else {
        await extractTarGz(archivePath, header => {
            // Get the first
            if (javaExecPath == null) {
                let h = header.name
                if (h.includes('/')) {
                    h = h.substring(0, h.indexOf('/'))
                }
                javaExecPath = javaExecFromRoot(join(dirname(archivePath), h))
            }
        })
    }

    return javaExecPath
}

/**
 * 指定されたJavaインストールのOS固有の実行可能ファイルのパスを返す
 * サポートされているOSは win32, darwin, linux
 * 
 * @param {string} rootDir Javaインストールのルートディレクトリ
 * @returns {string} Java実行可能ファイルへのパス
 */
export function javaExecFromRoot(rootDir: string): string {
    switch (process.platform) {
        case Platform.WIN32:
            return join(rootDir, 'bin', 'javaw.exe')
        case Platform.DARWIN:
            return join(rootDir, 'Contents', 'Home', 'bin', 'java')
        case Platform.LINUX:
            return join(rootDir, 'bin', 'java')
        default:
            return rootDir
    }
}

/**
 * Javaパスを指定して、ルートを指していることを確認する
 * 
 * @param dir 未テストのパス
 * @returns ルートJavaパス
 */
export function ensureJavaDirIsRoot(dir: string): string {
    switch (process.platform) {
        case Platform.DARWIN: {
            const index = dir.indexOf('/Contents/Home')
            return index > -1 ? dir.substring(0, index) : dir
        }
        case Platform.WIN32:
        case Platform.LINUX:
        default: {
            const index = dir.indexOf(join('/', 'bin', 'java'))
            return index > -1 ? dir.substring(0, index) : dir
        }
    }
}

/**
 * 指定されたパスがJava実行可能ファイルを指しているかどうかを確認する
 * 
 * @param {string} pth チェック対象のパス
 * @returns {boolean} パスがJava実行可能ファイルを指している場合はtrue、それ以外の場合はfalse
 */
export function isJavaExecPath(pth: string): boolean {
    switch (process.platform) {
        case Platform.WIN32:
            return pth.endsWith(join('bin', 'javaw.exe'))
        case Platform.DARWIN:
        case Platform.LINUX:
            return pth.endsWith(join('bin', 'java'))
        default:
            return false
    }
}

// TODO Move this
/**
 * Mojangのlauncher.jsonファイルをロードする
 * 
 * @returns {Promise.<Object>} Mojangのlauncher.jsonオブジェクトに解決されるPromise
 */
export async function loadMojangLauncherData(): Promise<LauncherJson | null> {

    try {
        const res = await got.get<LauncherJson>('https://launchermeta.mojang.com/mc/launcher.json', { responseType: 'json' })
        return res.body
    } catch (err) {
        log.error('Failed to retrieve Mojang\'s launcher.json file.')
        return null
    }
}

/**
 * 完全なJavaランタイムバージョン文字列を解析し、
 * バージョン情報を解決する。使用するフォーマットを
 * 動的に検出する
 * 
 * @param {string} verString 解析する完全なバージョン文字列
 * @returns バージョン情報を含むオブジェクト
 */
export function parseJavaRuntimeVersion(verString: string): JavaVersion | null {
    if (verString.startsWith('1.')) {
        return parseJavaRuntimeVersionLegacy(verString)
    } else {
        return parseJavaRuntimeVersionSemver(verString)
    }
}

/**
 * 完全なJavaランタイムバージョン文字列を解析し、
 * バージョン情報を解決する。Java 8のフォーマットを使用する
 * 
 * @param {string} verString 解析する完全なバージョン文字列
 * @returns バージョン情報を含むオブジェクト
 */
export function parseJavaRuntimeVersionLegacy(verString: string): JavaVersion | null {
    // 1.{major}.0_{update}-b{build}
    // ex. 1.8.0_152-b16
    const regex = /1.(\d+).(\d+)_(\d+)(?:-b(\d+))?/
    const match = regex.exec(verString)!

    if (match == null) {
        log.error(`Failed to parse legacy Java version: ${verString}`)
        return null
    }

    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3])
    }
}

/**
 * 完全なJavaランタイムバージョン文字列を解析し、バージョン情報を解決します。
 * Java 9以降のフォーマットを使用します。
 *
 * @param {string} verString 解析する完全なバージョン文字列。
 * @returns バージョン情報を含むオブジェクト。
 */
export function parseJavaRuntimeVersionSemver(verString: string): JavaVersion | null {
    // {major}.{minor}.{patch}+{build}
    // ex. 10.0.2+13 or 10.0.2.13
    const regex = /(\d+)\.(\d+).(\d+)(?:[+.](\d+))?/
    const match = regex.exec(verString)!

    if (match == null) {
        log.error(`Failed to parse semver Java version: ${verString}`)
        return null
    }

    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3])
    }
}

export function javaVersionToString({ major, minor, patch }: JavaVersion): string {
    return `${major}.${minor}.${patch}`
}

export interface JavaDiscoverer {

    discover(): Promise<string[]>

}

export class PathBasedJavaDiscoverer implements JavaDiscoverer {

    constructor(
        protected paths: string[]
    ) { }

    public async discover(): Promise<string[]> {

        const res = new Set<string>()

        for (const path of this.paths) {
            if (await pathExists(javaExecFromRoot(path))) {
                res.add(path)
            }
        }

        return [...res]
    }
}

export class DirectoryBasedJavaDiscoverer implements JavaDiscoverer {

    constructor(
        protected directories: string[]
    ) { }

    public async discover(): Promise<string[]> {

        const res = new Set<string>()

        for (const directory of this.directories) {

            if (await pathExists(directory)) {
                const files = await readdir(directory)
                for (const file of files) {
                    const fullPath = join(directory, file)

                    if (await pathExists(javaExecFromRoot(fullPath))) {
                        res.add(fullPath)
                    }
                }
            }
        }

        return [...res]
    }
}

export class EnvironmentBasedJavaDiscoverer implements JavaDiscoverer {

    constructor(
        protected keys: string[]
    ) { }

    public async discover(): Promise<string[]> {

        const res = new Set<string>()

        for (const key of this.keys) {

            const value = process.env[key]
            if (value != null) {
                const asRoot = ensureJavaDirIsRoot(value)
                if (await pathExists(asRoot)) {
                    res.add(asRoot)
                }
            }
        }

        return [...res]
    }
}

export class Win32RegistryJavaDiscoverer implements JavaDiscoverer {

    public discover(): Promise<string[]> {

        return new Promise((resolve) => {

            const regKeys = [
                '\\SOFTWARE\\JavaSoft\\Java Runtime Environment', // Java 8 and prior
                '\\SOFTWARE\\JavaSoft\\Java Development Kit',     // Java 8 and prior
                '\\SOFTWARE\\JavaSoft\\JRE',                      // Java 9+
                '\\SOFTWARE\\JavaSoft\\JDK'                       // Java 9+
            ]

            let keysDone = 0

            const candidates = new Set<string>()

            // eslint-disable-next-line @typescript-eslint/prefer-for-of
            for (let i = 0; i < regKeys.length; i++) {
                const key = new Registry({
                    hive: Registry.HKLM,
                    key: regKeys[i],
                    arch: 'x64'
                })
                key.keyExists((err, exists) => {
                    if (exists) {
                        key.keys((err, javaVers) => {
                            if (err) {
                                keysDone++
                                console.error(err)

                                // REG KEY DONE
                                // DUE TO ERROR
                                if (keysDone === regKeys.length) {
                                    resolve([...candidates])
                                }
                            } else {
                                if (javaVers.length === 0) {
                                    // REG KEY DONE
                                    // NO SUBKEYS
                                    keysDone++
                                    if (keysDone === regKeys.length) {
                                        resolve([...candidates])
                                    }
                                } else {

                                    let numDone = 0

                                    // eslint-disable-next-line @typescript-eslint/prefer-for-of
                                    for (let j = 0; j < javaVers.length; j++) {
                                        const javaVer = javaVers[j]
                                        const vKey = javaVer.key.substring(javaVer.key.lastIndexOf('\\') + 1).trim()

                                        let major = -1
                                        if (vKey.length > 0) {
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
                                            if (isNaN(vKey as any)) {
                                                // Should be a semver key.
                                                major = parseJavaRuntimeVersion(vKey)?.major ?? -1
                                            } else {
                                                // This is an abbreviated version, ie 1.8 or 17.
                                                const asNum = parseFloat(vKey)
                                                if (asNum < 2) {
                                                    // 1.x
                                                    major = asNum % 1 * 10
                                                } else {
                                                    major = asNum
                                                }
                                            }
                                        }

                                        if (major > -1) {
                                            javaVer.get('JavaHome', (err, res) => {
                                                const jHome = res.value
                                                // Exclude 32bit.
                                                if (!jHome.includes('(x86)')) {
                                                    candidates.add(jHome)
                                                }

                                                // SUBKEY DONE

                                                numDone++
                                                if (numDone === javaVers.length) {
                                                    keysDone++
                                                    if (keysDone === regKeys.length) {
                                                        resolve([...candidates])
                                                    }
                                                }
                                            })
                                        } else {

                                            // SUBKEY DONE
                                            // MAJOR VERSION UNPARSEABLE

                                            numDone++
                                            if (numDone === javaVers.length) {
                                                keysDone++
                                                if (keysDone === regKeys.length) {
                                                    resolve([...candidates])
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        })
                    } else {

                        // REG KEY DONE
                        // DUE TO NON-EXISTANCE

                        keysDone++
                        if (keysDone === regKeys.length) {
                            resolve([...candidates])
                        }
                    }
                })
            }

        })

    }
}



export async function getValidatableJavaPaths(dataDir: string): Promise<string[]> {
    let discoverers: JavaDiscoverer[]
    switch (process.platform) {
        case Platform.WIN32:
            discoverers = await getWin32Discoverers(dataDir)
            break
        case Platform.DARWIN:
            discoverers = await getDarwinDiscoverers(dataDir)
            break
        case Platform.LINUX:
            discoverers = await getLinuxDiscoverers(dataDir)
            break
        default:
            discoverers = []
            log.warn(`Unable to discover Java paths on platform: ${process.platform}`)
    }

    let paths: string[] = []
    for (const discover of discoverers) {
        paths = [
            ...paths,
            ...await discover.discover()
        ]
    }

    return [...(new Set<string>(paths))]
}

export async function getWin32Discoverers(dataDir: string): Promise<JavaDiscoverer[]> {
    return [
        new EnvironmentBasedJavaDiscoverer(getPossibleJavaEnvs()),
        new DirectoryBasedJavaDiscoverer([
            ...(await getPathsOnAllDrivesWin32([
                'Program Files\\Java',
                'Program Files\\Eclipse Adoptium',
                'Program Files\\Eclipse Foundation',
                'Program Files\\AdoptOpenJDK',
                'Program Files\\Amazon Corretto'
            ])),
            getLauncherRuntimeDir(dataDir)
        ]),
        new Win32RegistryJavaDiscoverer()
    ]
}

export async function getDarwinDiscoverers(dataDir: string): Promise<JavaDiscoverer[]> {
    return [
        new EnvironmentBasedJavaDiscoverer(getPossibleJavaEnvs()),
        new DirectoryBasedJavaDiscoverer([
            '/Library/Java/JavaVirtualMachines',
            getLauncherRuntimeDir(dataDir)
        ]),
        new PathBasedJavaDiscoverer([
            '/Library/Internet Plug-Ins/JavaAppletPlugin.plugin' // /Library/Internet Plug-Ins/JavaAppletPlugin.plugin/Contents/Home/bin/java
        ])

    ]
}

export async function getLinuxDiscoverers(dataDir: string): Promise<JavaDiscoverer[]> {
    return [
        new EnvironmentBasedJavaDiscoverer(getPossibleJavaEnvs()),
        new DirectoryBasedJavaDiscoverer([
            '/usr/lib/jvm',
            getLauncherRuntimeDir(dataDir)
        ])
    ]
}

export async function win32DriveMounts(): Promise<string[]> {

    const execAsync = promisify(exec)

    let stdout
    try {
        stdout = (await execAsync('gdr -psp FileSystem | select -eXp root | ConvertTo-Json', { shell: 'powershell.exe' })).stdout
    } catch (error) {
        log.error('Failed to resolve drive mounts!')
        log.error(error)
        // デフォルトは C:\\
        return ['C:\\']
    }

    return JSON.parse(stdout) as string[]
}

export async function getPathsOnAllDrivesWin32(paths: string[]): Promise<string[]> {
    const driveMounts = await win32DriveMounts()
    const res: string[] = []
    for (const path of paths) {
        for (const mount of driveMounts) {
            res.push(join(mount, path))
        }
    }
    return res
}

export function getPossibleJavaEnvs(): string[] {
    return [
        'JAVA_HOME',
        'JRE_HOME',
        'JDK_HOME'
    ]
}

export function getLauncherRuntimeDir(dataDir: string): string {
    return join(dataDir, 'runtime', process.arch)
}