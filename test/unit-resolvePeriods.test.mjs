import assert from 'assert'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import * as rp from '../src/resolvePeriods.mjs'
import resolvePeriods, { INTERVAL_SEC_BASE, INTERVAL_SEC_MAX, SCALE_KEYS } from '../src/resolvePeriods.mjs'
import periodInfo from '../src/periodInfo.mjs'
import { labelOf } from './unit-setupFeat.mjs'


//resetWarned, 重設已警告之紀錄(警告改由wsemi之getOptReader輸出, 去重表為其所有; 本套件不再匯出resetWarned)
let resetWarned = () => {
    getOptReader.resetWarned()
}


//規格來源: src/resolvePeriods.mjs 之 JSDoc 與 README〈opt.intervalSec〉
//  1. 內建週期表之值為根數(或內含根數欄位之參數物件), 標籤以每根4hr寫定; opt.intervalSec未給時原樣回傳(新物件)
//  2. opt.intervalSec(每根秒數)給予時各期之值不變、不剔除, 標籤改為「根數 × 每根秒數」(規則見spanLabelOf); 參數物件亦複製
//  3. 單根型態之表(僅一期且根數為1)於每根1day時標籤為'1day'(同一換算式, 無特例)
//  4. opt.kp給予時直接採用(標籤與值皆原樣), 優先於opt.intervalSec之換算
//  5. 輸入檢核(dspec〈輸入參數之檢測機制〉): kp為必須參數, 無效throw; opt.kp為opt類參數, 非預期之輸入視為未給改用內建表, opt.debug為true時警告; opt.intervalSec給了而無效throw(K3之例外, 見unit-intervalSec); 訊息不含傳入之值
//  6. opt內之未知鍵(含已移除之barsPerDay)忽略: 不換算、不警告、不檢核、不影響其他鍵之處理


//deepFreeze, 供檢驗不改寫呼叫端之輸入
let deepFreeze = (o) => {
    Object.values(o).forEach((v) => {
        if (v !== null && typeof v === 'object') {
            deepFreeze(v)
        }
    })
    return Object.freeze(o)
}

//capture, 以funLog收集警告
let capture = () => {
    let logs = []
    let funLog = (msg, meta) => {
        logs.push({ msg, meta })
    }
    return { logs, funLog }
}


describe('resolvePeriods', function() {

    beforeEach(function() {
        resetWarned()
    })

    describe('常數與匯出', function() {

        it('常數: 基準每根14400秒、上限31536000、根數欄位為len/tenkan/kijun/senkouB', function() {
            //規格1, 2, 4
            assert.strictEqual(INTERVAL_SEC_BASE, 14400)
            assert.strictEqual(INTERVAL_SEC_MAX, 31536000)
            assert.deepStrictEqual(SCALE_KEYS, ['len', 'tenkan', 'kijun', 'senkouB'])
        })

        it('已移除barsPerDay之時間換算: 不再匯出BARS_PER_DAY_BASE、BARS_PER_DAY_MAX、barLabelOf', function() {
            //規格6: 專案原則(自有套件不留相容層與雙重語意)
            let names = Object.keys(rp).sort()
            //行為改變(第688項): 警告之去重改由wsemi之getOptReader擁有, 不再匯出resetWarned; 新增匯出readIntervalSec(各處讀取opt.intervalSec之單一入口)
            assert.deepStrictEqual(names, ['INTERVAL_SEC_BASE', 'INTERVAL_SEC_MAX', 'SCALE_KEYS', 'chkIntervalSec', 'default', 'readIntervalSec', 'spanLabelOf', 'spanSecOf'])
        })

    })

    describe('恆等(未給intervalSec時原樣回傳)', function() {

        it('未給/空opt/null/undefined之intervalSec與kp皆回傳相同內容之新物件, 鍵序不變', function() {
            //規格1
            let kp = { '12hr': 3, '1day': 6, '7day': 42 }
            let opts = [undefined, {}, null, { intervalSec: null }, { intervalSec: undefined }, { kp: null }, { kp: undefined }, { debug: true }]
            opts.forEach((opt, i) => {
                let r = resolvePeriods(kp, opt)
                assert.deepStrictEqual(r, kp, `opts[${i}]`)
                assert.notStrictEqual(r, kp)
                assert.deepStrictEqual(Object.keys(r), ['12hr', '1day', '7day'])
            })
        })

        it('參數物件亦複製, 改動結果不牽動輸入', function() {
            let kp = { '1day': { len: 6, mult: 2 } }
            let r = resolvePeriods(kp)
            assert.deepStrictEqual(r, kp)
            assert.notStrictEqual(r['1day'], kp['1day'])
            r['1day'].len = 999
            assert.strictEqual(kp['1day'].len, 6)
        })

        it('給14400(每根4hr)時標籤逐一重現內建標籤, 與未給相同', function() {
            //規格1, 2: 內建表全部11種標籤
            let kp = { '4hr': 1, '8hr': 2, '12hr': 3, '16hr': 4, '20hr': 5, '1day': 6, '2day': 12, '4day': 24, '7day': 42, '15day': 90, '30day': 180 }
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 14400 }), kp)
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: '14400' }), kp)
            assert.deepStrictEqual(Object.keys(resolvePeriods(kp, { intervalSec: 14400 })), Object.keys(kp))
        })

    })

    describe('根數為本(opt.intervalSec): 根數不變、標籤依根數×每根秒數換算', function() {

        it('每根1day: 標籤為4hr標籤之6倍時間, 值不變', function() {
            //規格2
            let kp = { '12hr': 3, '20hr': 5, '1day': 6, '7day': 42 }
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 86400 }), { '3day': 3, '5day': 5, '6day': 6, '42day': 42 })
        })

        it('每根1hr、15m、1m: 整日用day、整小時用hr、其餘用m', function() {
            let kp = { '12hr': 3, '20hr': 5, '1day': 6, '7day': 42 }
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 3600 }), { '3hr': 3, '5hr': 5, '6hr': 6, '42hr': 42 })
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 900 }), { '45m': 3, '75m': 5, '90m': 6, '630m': 42 })
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 60 }), { '3m': 3, '5m': 5, '6m': 6, '42m': 42 })
        })

        it('不剔除: 每根1day時原本不足一日之期(12hr、16hr、20hr)皆保留', function() {
            //規格2: 與已移除之時間換算(日K線剔除12hr/16hr/20hr)相反
            let kp = { '12hr': 3, '16hr': 4, '20hr': 5, '1day': 6, '7day': 42 }
            let r = resolvePeriods(kp, { intervalSec: 86400 })
            assert.deepStrictEqual(Object.keys(r), ['3day', '4day', '5day', '6day', '42day'])
            assert.deepStrictEqual(Object.values(r), [3, 4, 5, 6, 42])
        })

        it('intervalSec為數字字串時使用轉換值(檢測之值即使用之值)', function() {
            let kp = { '1day': 6, '7day': 42 }
            let r = resolvePeriods(kp, { intervalSec: 86400 })
            assert.deepStrictEqual(r, { '6day': 6, '42day': 42 })
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: '86400' }), r)
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: ' 86400 ' }), r)
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: '3600' }), { '6hr': 6, '42hr': 42 })
        })

        it('參數物件: 根數欄位與倍數欄位皆原樣, 標籤依標籤所代表之根數換算, 欄位鍵序不變', function() {
            //規格2
            let r = resolvePeriods({ '1day': { len: 6, mult: 1.5 } }, { intervalSec: 3600 })
            assert.deepStrictEqual(r, { '6hr': { len: 6, mult: 1.5 } })
            assert.deepStrictEqual(Object.keys(r['6hr']), ['len', 'mult'])
            assert.deepStrictEqual(resolvePeriods({ '4day': { tenkan: 4, kijun: 12, senkouB: 24 } }, { intervalSec: 86400 }), { '24day': { tenkan: 4, kijun: 12, senkouB: 24 } })
        })

        it('單根型態之表於每根1day為1day、每根1hr為1hr(同一換算式)', function() {
            //規格3
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1 }, { intervalSec: 86400 }), { '1day': 1 })
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1 }, { intervalSec: 3600 }), { '1hr': 1 })
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1 }, { intervalSec: 900 }), { '15m': 1 })
        })

        it('結果為新物件, 參數物件亦複製(改動結果不牽動輸入), 鍵序同輸入', function() {
            //規格2
            let kp = { '1day': { len: 6, mult: 2 }, '12hr': 3 }
            let r = resolvePeriods(kp, { intervalSec: 86400 })
            assert.deepStrictEqual(r, { '6day': { len: 6, mult: 2 }, '3day': 3 })
            assert.deepStrictEqual(Object.keys(r), ['6day', '3day'])
            assert.notStrictEqual(r['6day'], kp['1day'])
            r['6day'].len = 999
            assert.strictEqual(kp['1day'].len, 6)
        })

    })

    describe('opt.kp 直接採用', function() {

        it('數值與參數物件原樣採用(新物件), 不換算, 優先於intervalSec', function() {
            //規格4
            let kpIn = { '3day': 18, 'x': { len: 5, mult: 1 } }
            let r = resolvePeriods({ '1day': 6 }, { kp: kpIn, intervalSec: 86400 })
            assert.deepStrictEqual(r, kpIn)
            assert.notStrictEqual(r, kpIn)
            assert.notStrictEqual(r.x, kpIn.x)
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { kp: { '3day': 18 } }), { '3day': 18 })
        })

        it('數字字串轉為數值(檢測之值即使用之值), 非根數欄位原樣保留', function() {
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { kp: { '3day': '18', 'x': { len: ' 5 ', mult: 'keep' } } }), { '3day': 18, 'x': { len: 5, mult: 'keep' } })
        })

        it('非預期之opt.kp視為未給, 改用內建表(含依intervalSec換算標籤)', function() {
            //規格5
            let kp = { '1day': 6, '7day': 42 }
            let bads = [
                {}, 'x', 5, true, [1], [],
                { a: 0 }, { a: -1 }, { a: 1.5 }, { a: 'x' }, { a: '' }, { a: '-' }, { a: 'NP' }, { a: 'true' }, { a: '0x10' }, { a: NaN }, { a: null }, { a: true }, { a: Infinity }, { a: 10n }, { a: [1] },
                { a: { len: 0 } }, { a: { len: 1.5 } }, { a: { len: 'x' } }, { a: { tenkan: -1 } }, { a: { kijun: null } }, { a: { senkouB: Infinity } },
                { good: 3, bad: 0 },
            ]
            bads.forEach((bad, i) => {
                assert.deepStrictEqual(resolvePeriods(kp, { kp: bad }), kp, `bads[${i}]`)
                assert.deepStrictEqual(resolvePeriods(kp, { kp: bad, intervalSec: 86400 }), { '6day': 6, '42day': 42 }, `bads[${i}] with intervalSec`)
            })
        })

        it('opt.kp為null/undefined視為未給', function() {
            let kp = { '1day': 6 }
            assert.deepStrictEqual(resolvePeriods(kp, { kp: null }), kp)
            assert.deepStrictEqual(resolvePeriods(kp, { kp: undefined }), kp)
        })

    })

    describe('輸入檢核', function() {

        it('kp(必須參數)非非空物件throw, 訊息不含傳入之值', function() {
            let msg = 'invalid kp: must be a non-empty object'
            let vs = [null, undefined, {}, [], 'x', 5, true, () => {}]
            vs.forEach((v) => {
                assert.throws(() => resolvePeriods(v), { message: msg })
                assert.throws(() => resolvePeriods(v, { intervalSec: 86400 }), { message: msg })
            })
            assert.throws(() => resolvePeriods('secret99'), (err) => !err.message.includes('secret99'))
        })

        it('kp之值非正整數或物件throw, 訊息只帶週期標籤', function() {
            let vs = ['x', 0, 1.5, -1, null, [1], true, Infinity]
            vs.forEach((v) => {
                assert.throws(() => resolvePeriods({ '1day': v }), { message: 'invalid kp[1day]: must be a positive integer or an object' })
            })
        })

        it('opt非物件視為未給(不throw)', function() {
            let kp = { '1day': 6 }
            let bads = [5, 'abc', true, [], () => {}, 24n]
            bads.forEach((bad, i) => {
                assert.deepStrictEqual(resolvePeriods(kp, bad), kp, `bads[${i}]`)
            })
        })

        it('不改寫呼叫端之輸入(kp與opt凍結後仍可執行)', function() {
            let kp = deepFreeze({ '1day': 6, '12hr': { len: 3, mult: 2 } })
            let opt = deepFreeze({ intervalSec: 86400 })
            assert.deepStrictEqual(resolvePeriods(kp, opt), { '6day': 6, '3day': { len: 3, mult: 2 } })
            let optKp = deepFreeze({ kp: { '3day': 18, 'y': { len: 5 } } })
            assert.deepStrictEqual(resolvePeriods(kp, optKp), { '3day': 18, 'y': { len: 5 } })
        })

    })

    describe('已移除之opt.barsPerDay: 視為未知鍵而忽略(輸出與未給相同)', function() {

        //各種值: 曾為有效之值、曾為矛盾之值、非預期之值
        let vals = [24, 1, 6, 48, 288, 0.5, 13, 0.01, 86400, '24', ' 24 ', 0, -1, 'abc', '', null, undefined, NaN, Infinity, true, [], {}, 24n, 86401]

        it('未給intervalSec: 輸出同未給(不換算根數、不剔除、不改標籤、不throw)', function() {
            //規格6
            let kp = { '4hr': 1, '12hr': 3, '1day': 6, '7day': 42 }
            vals.forEach((v, i) => {
                let r = resolvePeriods(kp, { barsPerDay: v })
                assert.deepStrictEqual(r, kp, `vals[${i}]`)
                assert.deepStrictEqual(Object.keys(r), Object.keys(kp), `vals[${i}] 鍵序`)
            })
            //單根型態亦不改標籤; 參數物件亦不換算
            assert.deepStrictEqual(resolvePeriods({ '4hr': 1 }, { barsPerDay: 24 }), { '4hr': 1 })
            assert.deepStrictEqual(resolvePeriods({ '1day': { len: 6, mult: 2 } }, { barsPerDay: 24 }), { '1day': { len: 6, mult: 2 } })
        })

        it('與intervalSec併給: 輸出同只給intervalSec(含曾視為矛盾之值, 不throw)', function() {
            //規格6: 已移除「兩者描述同一每根時長」之一致性檢核
            let kp = { '4hr': 1, '12hr': 3, '1day': 6 }
            let exp = resolvePeriods(kp, { intervalSec: 86400 })
            assert.deepStrictEqual(exp, { '1day': 1, '3day': 3, '6day': 6 })
            vals.forEach((v, i) => {
                assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 86400, barsPerDay: v }), exp, `vals[${i}]`)
            })
            assert.deepStrictEqual(resolvePeriods(kp, { intervalSec: 14400, barsPerDay: 1 }), kp)
        })

        it('與opt.kp併給: 輸出同只給opt.kp', function() {
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { kp: { '3day': 18 }, barsPerDay: 0.01 }), { '3day': 18 })
            assert.deepStrictEqual(resolvePeriods({ '1day': 6 }, { kp: { a: 0 }, barsPerDay: 24 }), { '1day': 6 })
        })

        it('intervalSec無效時以intervalSec之訊息throw, 不受barsPerDay影響', function() {
            let msg = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'
            assert.throws(() => resolvePeriods({ '1day': 6 }, { intervalSec: 61, barsPerDay: 24 }), { message: msg })
            assert.throws(() => resolvePeriods({ '1day': 6 }, { intervalSec: 61, barsPerDay: 'abc' }), { message: msg })
        })

        it('opt.debug為true: 不因barsPerDay警告(僅opt.kp會警告)', function() {
            let { logs, funLog } = capture()
            let kp = { '1day': 6 }
            vals.forEach((v) => {
                resolvePeriods(kp, { barsPerDay: v, debug: true, funLog })
                resolvePeriods(kp, { barsPerDay: v, intervalSec: 86400, debug: true, funLog })
            })
            assert.strictEqual(logs.length, 0)
        })

    })

    describe('opt.debug 警告', function() {

        it('opt.kp非預期且debug為true: 經funLog輸出固定詞彙警告, 不含傳入之值, 每個鍵只警告一次', function() {
            let { logs, funLog } = capture()
            let kp = { '1day': 6 }
            let r1 = resolvePeriods(kp, { kp: { secretLabel: 0 }, debug: true, funLog })
            let r2 = resolvePeriods(kp, { kp: { secretLabel: 0 }, debug: true, funLog })
            assert.deepStrictEqual(r1, kp)
            assert.deepStrictEqual(r2, kp)
            assert.strictEqual(logs.length, 1)
            assert.strictEqual(logs[0].msg, '[w-data-trade resolvePeriods] invalid opt.kp: must be a non-empty object of positive integers or objects whose len, tenkan, kijun and senkouB are positive integers, using default the built-in table')
            //行為改變(第688項): funLog之第2參數改為getOptReader之形式{ fn: 函式標籤, reason: 'invalid', key: 不含opt.前綴之鍵名 }(原為{ fn: 'resolvePeriods', reason: 'invalid', key: 'opt.kp' }); 警告文字不變
            assert.deepStrictEqual(logs[0].meta, { fn: 'w-data-trade resolvePeriods', reason: 'invalid', key: 'kp' })
            assert.ok(!logs[0].msg.includes('secretLabel'))
        })

        it('debug非true(未給/false/字串/1)不警告', function() {
            let { logs, funLog } = capture()
            let ds = [undefined, false, 'true', 1, null, {}]
            ds.forEach((debug) => {
                resolvePeriods({ '1day': 6 }, { kp: 'x', debug, funLog })
            })
            assert.strictEqual(logs.length, 0)
        })

        it('輸入有效時debug為true也不警告', function() {
            let { logs, funLog } = capture()
            resolvePeriods({ '1day': 6 }, { intervalSec: 86400, kp: undefined, debug: true, funLog })
            resolvePeriods({ '1day': 6 }, { kp: { '3day': 18 }, debug: true, funLog })
            assert.strictEqual(logs.length, 0)
        })

        it('未給funLog時改用console.warn; funLog拋錯一律忽略; resetWarned後可再警告', function() {
            let kp = { '1day': 6 }
            let warns = []
            let orig = console.warn
            console.warn = (msg) => {
                warns.push(msg)
            }
            try {
                resolvePeriods(kp, { kp: 'x', debug: true })
                assert.strictEqual(warns.length, 1)
                assert.ok(warns[0].startsWith('[w-data-trade resolvePeriods] invalid opt.kp'))
                resolvePeriods(kp, { kp: 'x', debug: true })
                assert.strictEqual(warns.length, 1)
                resetWarned()
                resolvePeriods(kp, { kp: 'x', debug: true })
                assert.strictEqual(warns.length, 2)
            }
            finally {
                console.warn = orig
            }
            resetWarned()
            let thrower = () => {
                throw new Error('boom')
            }
            assert.deepStrictEqual(resolvePeriods(kp, { kp: 'x', debug: true, funLog: thrower }), kp)
        })

        it('opt.kp之檢測只做一次(檢測之值即使用之值, K4、V11): opt.kp為存取器時只讀取一次, 數字字串轉為數值', function() {
            let n = 0
            let o = {}
            Object.defineProperty(o, 'kp', {
                enumerable: true,
                get() {
                    n++
                    return n === 1 ? { a: '5', b: 7 } : { z: 1 }
                },
            })
            let r = resolvePeriods({ '1day': 6 }, o)
            assert.deepStrictEqual(r, { a: 5, b: 7 })
            assert.strictEqual(n, 1)
        })

        it('opt.kp之值為存取器時檢測與採用為同一次讀取(不另行重新檢測): 第1次讀得有效、其後讀得無效, 結果仍為第1次讀得之值', function() {
            let n = 0
            let kpObj = {}
            Object.defineProperty(kpObj, 'a', {
                enumerable: true,
                get() {
                    n++
                    return n === 1 ? '6' : 'bad'
                },
            })
            let r = resolvePeriods({ '1day': 6 }, { kp: kpObj })
            assert.deepStrictEqual(r, { a: 6 })
            assert.strictEqual(n, 1)
        })

        it('opt.kp之讀取拋錯(存取器、值內之存取器、已撤銷之Proxy)視為未給: 改用內建表、不拋錯、不洩漏拋出之訊息; opt.debug為true時讀取拋錯不警告(同getOptReader), 值內之存取器拋錯屬給了而非預期、警告一次', function() {
            let kp = { '1day': 6 }
            let thrower = () => {
                throw new Error('boom-secret')
            }
            let o = { debug: true }
            Object.defineProperty(o, 'kp', { enumerable: true, get: thrower })
            let { logs, funLog } = capture()
            o.funLog = funLog
            assert.deepStrictEqual(resolvePeriods(kp, o), kp, '存取器拋錯')
            assert.strictEqual(logs.length, 0)
            let rv = Proxy.revocable({}, {})
            rv.revoke()
            assert.deepStrictEqual(resolvePeriods(kp, { kp: rv.proxy, debug: true, funLog }), kp, '值為已撤銷之Proxy')
            assert.strictEqual(logs.length, 1)
            assert.ok(!logs[0].msg.includes('boom-secret'))
            let inner = { a: {} }
            Object.defineProperty(inner.a, 'len', { enumerable: true, get: thrower })
            assert.deepStrictEqual(resolvePeriods(kp, { kp: inner }), kp, '值內之存取器拋錯')
        })

    })

    describe('readIntervalSec(各處讀取opt.intervalSec之單一入口; K3之例外: 給了而無效即throw)', function() {

        let MSG_ISEC = 'invalid opt.intervalSec: must be a positive integer multiple of 60 up to 31536000'

        it('未給: opt非物件與非函數、鍵之值為undefined或null ⇒ null', function() {
            for (let o of [undefined, null, 5, 'x', true, {}, { intervalSec: undefined }, { intervalSec: null }, { kp: 1 }]) {
                assert.strictEqual(rp.readIntervalSec(o), null, String(o))
            }
        })

        it('有效: 60之正整數倍且至多31536000之數值或數字字串 ⇒ 轉為數值(檢測之值即使用之值)', function() {
            for (let [v, exp] of [[60, 60], ['60', 60], [' 3600 ', 3600], ['+86400', 86400], [14400, 14400], ['1.44e4', 14400], [31536000, 31536000]]) {
                assert.strictEqual(rp.readIntervalSec({ intervalSec: v }), exp, String(v))
            }
            //opt為函數(帶屬性)亦可讀
            let f = () => {}
            f.intervalSec = 900
            assert.strictEqual(rp.readIntervalSec(f), 900)
        })

        it('給了而無效 ⇒ throw固定訊息(不含傳入之值)', function() {
            let bads = [0, -60, 59, 61, 90, 1.5, 31536060, 'abc', '', ' ', NaN, Infinity, true, false, [], [60], {}, 60n, Object(60), Symbol('s'), () => 60, '0x3c', '1,000', 'SENTINEL-2b7']
            for (let v of bads) {
                assert.throws(() => rp.readIntervalSec({ intervalSec: v }), (e) => e.message === MSG_ISEC, labelOf(v))
            }
        })

        it('讀取拋錯(存取器、Proxy陷阱、已撤銷之Proxy) ⇒ 視為給了而無效, throw固定訊息(不洩漏拋出之訊息)', function() {
            let thrower = () => {
                throw new Error('boom-secret')
            }
            let o = {}
            Object.defineProperty(o, 'intervalSec', { enumerable: true, get: thrower })
            let rv = Proxy.revocable({}, {})
            rv.revoke()
            for (let x of [o, new Proxy({}, { get: thrower }), rv.proxy]) {
                assert.throws(() => rp.readIntervalSec(x), (e) => e.message === MSG_ISEC && !e.message.includes('boom'))
            }
        })

        it('只讀取一次(存取器): 讀得之值即使用之值', function() {
            let n = 0
            let o = {}
            Object.defineProperty(o, 'intervalSec', {
                enumerable: true,
                get() {
                    n++
                    return n === 1 ? '3600' : 'x'
                },
            })
            assert.strictEqual(rp.readIntervalSec(o), 3600)
            assert.strictEqual(n, 1)
        })

        it('resolvePeriods與periodInfo對讀取拋錯之opt.intervalSec亦throw固定訊息', function() {
            let o = {}
            Object.defineProperty(o, 'intervalSec', {
                enumerable: true,
                get() {
                    throw new Error('boom-secret')
                },
            })
            assert.throws(() => resolvePeriods({ '1day': 6 }, o), (e) => e.message === MSG_ISEC)
            assert.throws(() => periodInfo('12hr', o), (e) => e.message === MSG_ISEC)
        })

    })

})
