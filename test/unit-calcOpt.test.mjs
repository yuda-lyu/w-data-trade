import assert from 'assert'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import wdt from '../src/WDataTrade.mjs'
import caEma from '../src/caEma.mjs'
import diviProt from '../src/diviProt.mjs'
import { chkIntervalSec } from '../src/resolvePeriods.mjs'
import { genOhlc } from './unit-setup.mjs'
import { assertOptK3, labelOf } from './unit-setupFeat.mjs'


//規格來源: 跨套件規格〈輸入參數之檢測機制〉(K3、K4、K5、V5、V11、§7 之 getOptReader)與各 calc 之 JSDoc(第 688 項)
//  O1 既有 calc 之選項(plusClose、k、subMid、plusMid、powMid、plusBandWidth、plusCloudMid、plusTenkans、plusMiddle、excludeCurrent、norm、eps、seed)皆以 wsemi 之 getOptReader 宣告:
//     給了而非預期之輸入視為未給、改用預設、不 reject; opt.debug 恰為 true 時警告一次(固定詞彙 `[w-data-trade <calc>] invalid opt.<鍵>: must be <描述>, using default <預設>`、不含傳入之值、同一鍵每個行程一次、funLog 出口、拋錯忽略); 鍵之讀取拋錯視為未給且不警告
//  O2 數值類收有限數值與數字字串(K7), 數字字串轉為數值後使用(K4); 布林類只收 true 與 false(K5: 不收 1、0、'true'、'y'); seed 只收 'sma' 與 'first'
//  O3 合法值之輸出不變(R-PER-02 恆等; 另見各 calc 既有測試與 unit-calcPeriods 之 1.0.33 快照)
//  O4 站點全集: 各 calc 讀取 opt 之鍵 ⊆ { kp, intervalSec, debug, funLog } ∪ 其宣告之選項, 且宣告之選項皆被讀取(以記錄讀取之 Proxy 驗證, 不依原始碼掃描)
//  O5 opt 之敵意輸入: opt.intervalSec(K3 之例外, 決定資料口徑)給了而無效即 reject, 讀取拋錯亦然(固定訊息、不洩漏拋出之訊息); 其餘鍵(含 opt.kp)讀取拋錯視為未給


let arr = genOhlc(120)

let MSG_ISEC = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'

//各種「非預期之值」(依選項之種類)
let numAnyBads = () => [NaN, Infinity, -Infinity, '', ' ', 'abc', 'Infinity', '-Infinity', 'NaN', '1e999', '0x10', '1,5', '１２', '-', 'NP', true, false, [], [1], {}, 10n, Object(1), Symbol('s'), () => 1]
let numNonNegBads = () => [...numAnyBads(), -1, '-1', -1e-9, '-0.5']
let boolBads = () => ['true', 'false', 'TRUE', 1, 0, '1', '0', 'y', 'n', 'yes', '', ' ', NaN, [], [true], {}, 10n, Object(true), Symbol('s'), () => true]
let seedBads = () => ['SMA', 'First', 'FIRST', ' sma', 'first ', '', ' ', 'foo', 'smaa', 1, 0, true, false, NaN, [], ['first'], {}, Object('first'), 10n, Symbol('s'), () => 'first']

//各種「合格而等同預設」之寫法
let numSames = (def) => {
    return [def, String(def), ` ${def} `, `${def}.0`, `+${def}`] //def 為 0、1、2(整數)
}

let N = 'a valid number'
let NN = 'a non-negative number'
let B = 'a boolean'

//SITES, 各 calc 之選項全集(站點)與其種類: kind 為 num(任一有限數)、nonneg(不小於 0 之有限數)、bool、enum; valid 為「合格且異於預設」之值(須使結果不同)
let numSite = (calc, key, def, valid) => {
    return { calc, key, kind: 'num', def, desc: N, defDesc: `${def}`, valid, bads: numAnyBads(), probe: NaN, sames: numSames(def) }
}
let SITES = [
    numSite('calcAtr', 'plusClose', 0, 5),
    numSite('calcBbpb', 'k', 2, 3),
    numSite('calcBbpb', 'subMid', 0, 3),
    numSite('calcBbpb', 'plusMid', 0, 7),
    numSite('calcBbpb', 'powMid', 1, 0.5),
    numSite('calcBbpb', 'plusBandWidth', 0, 2),
    { calc: 'calcDonchian', key: 'excludeCurrent', kind: 'bool', def: false, desc: B, defDesc: 'false', valid: true, bads: boolBads(), probe: 'yes', sames: [false] },
    numSite('calcDonchian', 'subMid', 0, 3),
    numSite('calcDonchian', 'plusMid', 0, 7),
    numSite('calcDonchian', 'powMid', 1, 0.5),
    numSite('calcDonchian', 'plusBandWidth', 0, 2),
    { calc: 'calcEma', key: 'norm', kind: 'bool', def: false, desc: B, defDesc: 'false', valid: true, bads: boolBads(), probe: 'yes', sames: [false] },
    numSite('calcIchimoku', 'plusClose', 0, 5),
    numSite('calcIchimoku', 'plusCloudMid', 0, 3),
    numSite('calcIchimoku', 'plusBandWidth', 0, 2),
    numSite('calcIchimoku', 'plusTenkans', 0, 4),
    numSite('calcKeltner', 'plusMiddle', 0, 5),
    numSite('calcKlr', 'plusClose', 0, 5),
    { calc: 'calcMa', key: 'norm', kind: 'bool', def: false, desc: B, defDesc: 'false', valid: true, bads: boolBads(), probe: 'yes', sames: [false] },
    { calc: 'calcMfi', key: 'eps', kind: 'nonneg', def: 1e-12, desc: NN, defDesc: '1e-12', valid: 1e12, bads: numNonNegBads(), probe: -1, sames: [1e-12, '1e-12', ' 1e-12 ', '0.000000000001', '1E-12'], boundary: [0, '0'] },
    { calc: 'calcRsi', key: 'seed', kind: 'enum', def: 'sma', desc: `one of 'sma', 'first'`, defDesc: `'sma'`, valid: 'first', bads: seedBads(), probe: 'foo', sames: ['sma'] },
    { calc: 'calcRsi', key: 'eps', kind: 'nonneg', def: 1e-12, desc: NN, defDesc: '1e-12', valid: 1e6, bads: numNonNegBads(), probe: -1, sames: [1e-12, '1e-12', ' 1e-12 ', '0.000000000001', '1E-12'], boundary: [0, '0'] },
    numSite('calcSupertrend', 'plusClose', 0, 5),
    { calc: 'calcVec', key: 'norm', kind: 'bool', def: false, desc: B, defDesc: 'false', valid: true, bads: boolBads(), probe: 'yes', sames: [false] },
]

//SITES_FEAT, 特徵族四個 calc(Gitea #227)之選項站點(各選項之 K3 測試見 unit-calcMomz、unit-calcDown、unit-calcVolx、unit-calcFlow; 此處只列入站點全集之核對)
let SITES_FEAT = [
    ['calcMomz', 'volLen'],
    ['calcDown', 'volLen'],
    ['calcDown', 'crashK'],
    ['calcVolx', 'longMult'],
    ['calcVolx', 'vrLag'],
    ['calcVolx', 'vovLen'],
    ['calcVolx', 'eps'],
    ['calcFlow', 'scaleWin'],
    ['calcFlow', 'scaleMin'],
]

//OTHER_KEYS, 各 calc 於 kp、intervalSec、debug、funLog 之外所宣告之選項(由 SITES 與 SITES_FEAT 導出; 無選項者為空陣列)
let CALCS = Object.keys(wdt).filter((k) => /^calc/.test(k)).sort()
let OTHER_KEYS = {}
CALCS.forEach((c) => {
    OTHER_KEYS[c] = [...SITES.filter((s) => s.calc === c).map((s) => s.key), ...SITES_FEAT.filter((s) => s[0] === c).map((s) => s[1])]
})
let BASE_KEYS = ['kp', 'intervalSec', 'debug', 'funLog']


//capture, 收集 console.warn(出口之一)
let withWarn = async(fn) => {
    let warns = []
    let org = console.warn
    console.warn = (...a) => {
        warns.push(a)
    }
    try {
        await fn()
    }
    finally {
        console.warn = org
    }
    return warns
}


describe('opt 之檢測(getOptReader 宣告; 第 688 項)', function() {

    beforeEach(function() {
        getOptReader.resetWarned()
    })

    after(function() {
        getOptReader.resetWarned()
    })

    describe('O4 站點全集: 各 calc 讀取 opt 之鍵', function() {

        it('站點表涵蓋之 calc 全為聚合匯出之 calc(27 個); 選項共 33 站(既有 calc 24 站 + 特徵族 9 站), 無重複', function() {
            assert.strictEqual(CALCS.length, 27)
            SITES.forEach((s) => {
                assert.ok(CALCS.includes(s.calc), `${s.calc} 不在聚合匯出內`)
            })
            SITES_FEAT.forEach((s) => {
                assert.ok(CALCS.includes(s[0]), `${s[0]} 不在聚合匯出內`)
            })
            assert.strictEqual(SITES.length, 24)
            assert.strictEqual(SITES_FEAT.length, 9)
            let all = [...SITES.map((s) => `${s.calc}.${s.key}`), ...SITES_FEAT.map((s) => `${s[0]}.${s[1]}`)]
            assert.strictEqual(new Set(all).size, 33)
            //有宣告選項之 calc 共 16 個(既有 12 個 + 特徵族 4 個); 其餘 11 個(含 calcDirChange、calcOrig)只有 kp、intervalSec、debug、funLog
            let withOpt = CALCS.filter((c) => OTHER_KEYS[c].length > 0)
            assert.strictEqual(withOpt.length, 16)
            assert.deepStrictEqual(CALCS.filter((c) => OTHER_KEYS[c].length === 0), ['calcAdx', 'calcAts', 'calcCandle', 'calcCvd', 'calcDirChange', 'calcKdj', 'calcMacd', 'calcObv', 'calcOrig', 'calcVortex', 'calcVwap'])
        })

        CALCS.forEach((c) => {
            it(`${c}: 讀取 opt 之鍵 ⊆ { kp, intervalSec, debug, funLog } ∪ 宣告之選項(${OTHER_KEYS[c].join('、') || '無'}), 且宣告之選項皆被讀取`, async function() {
                let reads = new Set()
                let opt = new Proxy({}, {
                    get(t, k) {
                        if (typeof k === 'string') {
                            reads.add(k)
                        }
                        return undefined
                    },
                })
                await wdt[c](arr, 'Close', opt)
                let allowed = new Set([...BASE_KEYS, ...OTHER_KEYS[c]])
                let extra = [...reads].filter((k) => !allowed.has(k))
                assert.deepStrictEqual(extra, [], `${c} 讀取了未宣告之鍵 ${extra.join('、')}(須經 getOptReader 宣告、加入 SITES)`)
                OTHER_KEYS[c].forEach((k) => {
                    assert.ok(reads.has(k), `${c} 宣告之選項 ${k} 未被讀取`)
                })
            })
        })

        it('對拍: 記錄讀取之 Proxy 抓得到未宣告之讀取(鑑別力自測)', async function() {
            let reads = new Set()
            let opt = new Proxy({}, {
                get(t, k) {
                    if (typeof k === 'string') {
                        reads.add(k)
                    }
                    return undefined
                },
            })
            let hit = (o) => {
                return o.zzz
            }
            hit(opt)
            assert.ok(reads.has('zzz'))
            assert.ok(!BASE_KEYS.includes('zzz'))
        })

    })

    describe('O1~O3 各選項: 合法值生效、非預期之輸入視為未給(K3)', function() {

        SITES.forEach((s) => {

            let call = (o) => wdt[s.calc](arr, 'Close', o)
            let tag = `w-data-trade ${s.calc}`

            describe(`${s.calc} opt.${s.key}(${s.kind}, 預設 ${labelOf(s.def)})`, function() {

                it('合法值生效(結果異於預設); 數字字串轉為數值後使用(同數值之結果, K4)', async function() {
                    let base = await call({})
                    let rv = await call({ [s.key]: s.valid })
                    assert.notDeepStrictEqual(rv, base, '鑑別前提: 合格且異於預設之值須使結果不同')
                    if (s.kind === 'num' || s.kind === 'nonneg') {
                        for (let str of [String(s.valid), ` ${s.valid} `, `+${s.valid}`]) {
                            assert.deepStrictEqual(await call({ [s.key]: str }), rv, `字串 ${JSON.stringify(str)}`)
                        }
                    }
                    //不改寫呼叫端之 opt
                    let o = Object.freeze({ [s.key]: s.valid })
                    assert.deepStrictEqual(await call(o), rv)
                })

                it('非預期之輸入視為未給(結果同未給、不 reject); opt.debug 恰為 true 時警告一次(固定詞彙、不含傳入之值、同鍵一次、funLog 或 console.warn 出口)', async function() {
                    let base = await call({})
                    await assertOptK3({ call, base, name: s.key, invalids: s.bads, sames: s.sames, tag, desc: s.desc, defDesc: s.defDesc, probe: s.probe })
                })

                if (s.boundary) {
                    it(`邊界值 ${s.boundary.map(labelOf).join('、')} 為合格(不 reject、不警告)`, async function() {
                        for (let v of s.boundary) {
                            let rv = null
                            let warns = await withWarn(async() => {
                                rv = await call({ [s.key]: v, debug: true })
                            })
                            assert.ok(rv !== null && warns.length === 0, `${labelOf(v)} 不應警告`)
                        }
                    })
                }

            })

        })

        it('Mfi 之 eps 為負數 ⇒ 非預期, 警告文字逐字(不小於 0 之有效數字)', async function() {
            let warns = await withWarn(async() => {
                await wdt.calcMfi(arr, 'Close', { eps: -1, debug: true })
            })
            assert.strictEqual(warns.length, 1)
            assert.strictEqual(warns[0][0], '[w-data-trade calcMfi] invalid opt.eps: must be a non-negative number, using default 1e-12')
        })

        it('跨選項: 同時給多個非預期之選項, 各自警告一次、結果同全未給(calcBbpb)', async function() {
            let base = await wdt.calcBbpb(arr, 'Close')
            let logs = []
            let rv = await wdt.calcBbpb(arr, 'Close', { k: 'x', subMid: NaN, plusMid: {}, powMid: [], plusBandWidth: true, debug: true, funLog: (m, info) => logs.push([m, info.key]) })
            assert.deepStrictEqual(rv, base)
            assert.deepStrictEqual(logs.map((v) => v[1]).sort(), ['k', 'plusBandWidth', 'plusMid', 'powMid', 'subMid'])
            logs.forEach((v) => {
                assert.ok(v[0].startsWith('[w-data-trade calcBbpb] invalid opt.'), v[0])
            })
        })

        it('Rsi 之 seed 與 eps 並用: 一者非預期、另一者合格 ⇒ 合格者仍生效', async function() {
            let rGood = await wdt.calcRsi(arr, 'Close', { seed: 'first', eps: 1e6 })
            let rMix = await wdt.calcRsi(arr, 'Close', { seed: 'first', eps: -1 })
            let rSeedOnly = await wdt.calcRsi(arr, 'Close', { seed: 'first' })
            assert.deepStrictEqual(rMix, rSeedOnly)
            assert.notDeepStrictEqual(rGood, rSeedOnly)
            let rMix2 = await wdt.calcRsi(arr, 'Close', { seed: 'bad', eps: 1e6 })
            let rEpsOnly = await wdt.calcRsi(arr, 'Close', { eps: 1e6 })
            assert.deepStrictEqual(rMix2, rEpsOnly)
        })

    })

    describe('helper: caEma 之 opt.norm、diviProt 之 opt.plusDenominator', function() {

        let vs = []
        for (let i = 0; i < 20; i++) {
            vs.push({ time: `t${i}`, value: 10 + ((i * 7) % 11) })
        }

        it('caEma opt.norm: 只收 true 與 false; 非預期視為未給(false)並於 opt.debug 恰為 true 時警告一次', function() {
            let base = caEma(vs, 3)
            let rn = caEma(vs, 3, { norm: true })
            assert.notDeepStrictEqual(rn, base, '鑑別前提')
            for (let v of boolBads()) {
                assert.deepStrictEqual(caEma(vs, 3, { norm: v }), base, `norm ${labelOf(v)}`)
            }
            for (let v of [undefined, null, false]) {
                assert.deepStrictEqual(caEma(vs, 3, { norm: v }), base)
            }
            let logs = []
            getOptReader.resetWarned()
            let funLog = (m, info) => logs.push([m, info])
            caEma(vs, 3, { norm: 1, debug: true, funLog })
            caEma(vs, 3, { norm: 'SENTINEL-9f2', debug: true, funLog })
            assert.strictEqual(logs.length, 1)
            assert.strictEqual(logs[0][0], '[w-data-trade caEma] invalid opt.norm: must be a boolean, using default false')
            assert.deepStrictEqual(logs[0][1], { fn: 'w-data-trade caEma', reason: 'invalid', key: 'norm' })
            //opt 非物件、已撤銷之 Proxy: 視為未給
            let rv = Proxy.revocable({}, {})
            rv.revoke()
            for (let o of [undefined, null, 5, 'x', rv.proxy]) {
                assert.deepStrictEqual(caEma(vs, 3, o), base)
            }
        })

        it('diviProt opt.plusDenominator: 有限數與數字字串(轉數值); 非預期視為未給(0)並於 opt.debug 恰為 true 時警告一次', function() {
            let base = diviProt(5, 5)
            assert.strictEqual(base, 1)
            assert.strictEqual(diviProt(5, 5, { plusDenominator: 1 }), 5 / 6)
            assert.strictEqual(diviProt(5, 5, { plusDenominator: '1' }), 5 / 6)
            assert.strictEqual(diviProt(5, -2, { plusDenominator: ' 1 ' }), 5 / -3)
            for (let v of numAnyBads()) {
                assert.strictEqual(diviProt(5, 5, { plusDenominator: v }), base, `plusDenominator ${labelOf(v)}`)
            }
            for (let v of [undefined, null, 0, '0']) {
                assert.strictEqual(diviProt(5, 5, { plusDenominator: v }), base)
            }
            let logs = []
            getOptReader.resetWarned()
            let funLog = (m, info) => logs.push([m, info])
            diviProt(5, 5, { plusDenominator: 'SENTINEL-4c1', debug: true, funLog })
            diviProt(5, 5, { plusDenominator: NaN, debug: true, funLog })
            assert.strictEqual(logs.length, 1)
            assert.strictEqual(logs[0][0], '[w-data-trade diviProt] invalid opt.plusDenominator: must be a valid number, using default 0')
            assert.deepStrictEqual(logs[0][1], { fn: 'w-data-trade diviProt', reason: 'invalid', key: 'plusDenominator' })
            assert.ok(!logs[0][0].includes('SENTINEL'))
            //opt 為已撤銷之 Proxy、存取器拋錯: 視為未給
            let rv = Proxy.revocable({}, {})
            rv.revoke()
            assert.strictEqual(diviProt(5, 5, rv.proxy), base)
            let o = {}
            Object.defineProperty(o, 'plusDenominator', {
                enumerable: true,
                get() {
                    throw new Error('boom')
                },
            })
            assert.strictEqual(diviProt(5, 5, o), base)
            //未給 opt(各 calc 於逐根迴圈內之呼叫)與 opt 為 null
            assert.strictEqual(diviProt(5, 5, null), base)
            assert.strictEqual(diviProt(5, 5, undefined), base)
        })

    })

    describe('O5 opt 之敵意輸入: opt.intervalSec(K3 之例外)給了而無效即 reject、讀取拋錯亦然; 其餘鍵讀取拋錯視為未給', function() {

        let withOpt = CALCS.filter((c) => c !== 'calcOrig') //calcOrig 不讀 opt

        it('calcOrig 不讀 opt(opt 為已撤銷之 Proxy 亦不受影響)', async function() {
            let rv = Proxy.revocable({}, {})
            rv.revoke()
            await wdt.calcOrig(arr, 'Close', rv.proxy)
        })

        it('chkIntervalSec 之訊息為固定詞彙(對照用)', function() {
            assert.throws(() => chkIntervalSec('x'), (e) => e.message === MSG_ISEC)
        })

        withOpt.forEach((c) => {

            it(`${c}: opt.intervalSec 之存取器拋錯 ⇒ reject 固定訊息(不洩漏拋出之訊息); opt 為已撤銷之 Proxy 亦然`, async function() {
                let o = {}
                Object.defineProperty(o, 'intervalSec', {
                    enumerable: true,
                    get() {
                        throw new Error('SECRET-boom')
                    },
                })
                await assert.rejects(wdt[c](arr, 'Close', o), (e) => e.message === MSG_ISEC)
                let rv = Proxy.revocable({}, {})
                rv.revoke()
                await assert.rejects(wdt[c](arr, 'Close', rv.proxy), (e) => e.message === MSG_ISEC)
            })

            it(`${c}: opt.kp 或 opt.debug、opt.funLog 之存取器拋錯 ⇒ 視為未給(同未給之結果、不 reject、不洩漏)`, async function() {
                let base = await wdt[c](arr, 'Close')
                let thrower = {
                    enumerable: true,
                    get() {
                        throw new Error('SECRET-boom')
                    },
                }
                for (let k of ['kp', 'debug', 'funLog']) {
                    let o = {}
                    Object.defineProperty(o, k, thrower)
                    assert.deepStrictEqual(await wdt[c](arr, 'Close', o), base, k)
                }
                //opt.kp 之值內存取器拋錯(參數物件之欄位)亦視為非預期 ⇒ 改用內建表
                let inner = {}
                Object.defineProperty(inner, 'len', thrower)
                assert.deepStrictEqual(await wdt[c](arr, 'Close', { kp: { a: inner } }), base)
            })

        })

    })

})
