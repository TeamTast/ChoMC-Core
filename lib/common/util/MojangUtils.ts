import { Rule, Natives } from '../../dl/mojang/MojangTypes'

export function getMojangOS(): string {
    const opSys = process.platform
    switch(opSys) {
        case 'darwin':
            return 'osx'
        case 'win32':
            return 'windows'
        case 'linux':
            return 'linux'
        default:
            return opSys
    }
}

export function validateLibraryRules(rules?: Rule[]): boolean {
    if(rules == null) {
        return false
    }
    for(const rule of rules){
        if(rule.action != null && rule.os != null){
            const osName = rule.os.name
            const osMoj = getMojangOS()
            if(rule.action === 'allow'){
                return osName === osMoj
            } else if(rule.action === 'disallow'){
                return osName !== osMoj
            }
        }
    }
    return true
}

export function validateLibraryNatives(natives?: Natives): boolean {
    return natives == null ? true : Object.hasOwnProperty.call(natives, getMojangOS())
}

export function isLibraryCompatible(rules?: Rule[], natives?: Natives): boolean {
    return rules == null ? validateLibraryNatives(natives) : validateLibraryRules(rules)
}

/**
 * 実際のバージョンが希望するバージョン以上である場合にtrueを返す
 *
 * @param {string} desired 希望するバージョン
 * @param {string} actual 実際のバージョン
 */
export function mcVersionAtLeast(desired: string, actual: string): boolean {
    const des = desired.split('.')
    const act = actual.split('.')
    if(act.length < des.length) {
        for(let i=act.length; i<des.length; i++) {
            act[i] = '0'
        }
    }

    for(let i=0; i<des.length; i++) {
        const parsedDesired = parseInt(des[i])
        const parsedActual = parseInt(act[i])
        if(parsedActual > parsedDesired){
            return true
        } else if(parsedActual < parsedDesired) {
            return false
        }
    }
    return true
}