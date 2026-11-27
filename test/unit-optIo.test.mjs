import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import dataConvert from '../src/dataConvert.mjs'
import dataCalibrate from '../src/dataCalibrate.mjs'
import { assertOptK3, labelOf } from './unit-setupFeat.mjs'


//規格來源: 跨套件規格〈輸入參數之檢測機制〉K3(opt 給了而非預期之輸入視為未給、改用預設、不 reject)與其例外〈決定資料口徑之 opt 比照〉(主控 2026-11-28 增列)、K4(檢測之值即使用之值)、K5(布林不與數字互轉)、V11(每鍵只讀一次、讀取拋錯視為未給)、V19、V20、§7(getOptReader)與排程第 694 項件 3
//  I1 `dataConvert` 之 opt.denyOutput、opt.funAddKeysIn 與 `dataCalibrate` 之 opt.optMethodRef、mags、threshold、thresholdAbs、nSweep、funLog 以 wsemi 之 getOptReader 宣告:
//     合法值生效(數字類之數字字串轉為數值); 非預期之輸入視為未給、改用預設、不 reject; opt.debug 恰為 true 時每個鍵每個行程警告一次(固定詞彙 `[w-data-trade <fn>] invalid opt.<鍵>: must be <描述>, using default <預設>`、不含傳入之值、funLog 出口、拋錯忽略)
//  I5 K3 之例外(決定資料口徑之 opt): `dataConvert` 之 opt.keysIn 與 `dataCalibrate` 之 opt.params、opt.keyIn 未給(undefined、null)取預設; 給了而無效(含鍵或元素之讀取拋錯、已撤銷之 Proxy)即 reject 固定訊息
//     (`invalid opt.keysIn: must be a non-empty array of non-empty strings`、`invalid opt.keysIn[i]: must be a non-empty string`、`invalid opt.params: must be a non-empty array of non-empty strings`、`invalid opt.keyIn: must be a non-empty string`), 先於任何計算與寫檔, 不改用預設、不警告、不回顯輸入值
//  I2 每個鍵每次呼叫只讀一次(含全集盤點: 讀取之鍵恰為宣告之鍵); I1 各鍵之讀取拋錯與 opt 非物件視為未給、不警告
//  I3 陣列類(keysIn、params、mags)檢測時取一份快照, 其後只用快照(元素之存取器第二次回傳他值、檢測後陣列被改動, 皆不影響使用)
//  I4 合法輸入之輸出不變(R-PER-02): 既有 unit-dataConvert、unit-dataCalibrate、unit-intervalSec、unit-calcPeriods 原樣通過(除行為改變表所列)


let fdRoot = fileURLToPath(new URL('./_tmp/unit-optIo/', import.meta.url))
let seq = 0
let fresh = () => {
    let fd = `${fdRoot}d${seq++}/`
    fs.mkdirSync(fd, { recursive: true })
    return fd
}

let SENT = 'SENTINEL-7c3e1a'
let TAG_CONV = 'w-data-trade dataConvert'
let TAG_CAL = 'w-data-trade dataCalibrate'
let OWN_FUNLOG = `[${TAG_CAL}] invalid opt.funLog: must be a function, using default none` //dataCalibrate 之 opt.funLog 本身亦被檢測: 非函式者(debug 時)另警告一則


describe('dataConvert、dataCalibrate 之 opt 檢測: getOptReader 宣告與 K3 之例外(排程第 694 項件 3)', function() {

    before(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        fs.mkdirSync(fdRoot, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        try {
            fs.rmdirSync(fileURLToPath(new URL('./_tmp/', import.meta.url))) //test/_tmp 已空時一併移除(非空則保留)
        }
        catch (err) {
            //非空或不存在
        }
    })


    describe('I1 dataConvert: opt.keysIn(K3 之例外)與 opt.denyOutput、opt.funAddKeysIn(K3)', function() {

        let ARR = [{ time: 't0' }]

        //mk, 每次呼叫一組新的 kp(記錄所收到之 keyIn 與 arr)、新的輸出夾
        let mk = () => {
            let seen = []
            let arrs = []
            let kp = {
                fx: async (arr, keyIn) => {
                    seen.push(keyIn)
                    arrs.push(arr)
                    return [{ period: 'a', len: 1, vs: [{ time: 't0', X: 10 }, { time: 't1', X: 20 }] }]
                },
            }
            return { kp, seen, arrs }
        }
        let methods = [{ method: 'fx', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1 } }], optMethod: {} }]

        //run, 回傳可序列化之結果(回傳列、輸出夾之檔名清單、calc 所收之 keyIn 清單)
        let run = async (opt, o = {}) => {
            let m = mk()
            let fd = fresh()
            let rows = await dataConvert('nm', 'BTCUSDT', '4hr', 'price', 'ohlc', methods, o.arr || ARR, m.kp, fd, opt)
            return { rows, files: fs.readdirSync(fd).sort(), seen: m.seen, arrs: m.arrs }
        }
        let call = async (opt) => {
            let r = await run(opt)
            return { rows: r.rows, files: r.files, seen: r.seen }
        }

        it('keysIn 合法(非空陣列且元素皆為非空字串)⇒ 生效: 依序逐一計算並寫檔', async function() {
            let r = await run({ keysIn: ['Close', 'Open'] })
            assert.deepStrictEqual(r.seen, ['Close', 'Open'])
            assert.deepStrictEqual(r.rows.map((v) => v.keyIn), ['Close', 'Open'])
            assert.deepStrictEqual(r.files, ['price_ohlc_Close_X_fx_a.json', 'price_ohlc_Open_X_fx_a.json'])
        })

        it('keysIn 未給 ⇒ 預設 [none]', async function() {
            for (let opt of [{}, { keysIn: undefined }, { keysIn: null }]) {
                let r = await run(opt)
                assert.deepStrictEqual(r.seen, ['none'])
                assert.deepStrictEqual(r.files, ['price_ohlc_none_X_fx_a.json'])
            }
        })

        //strict, K3 之例外鍵(keysIn): 執行 dataConvert, 收集拒絕、calc 與 funAddKeysIn 呼叫、輸出夾、console 與 funLog 輸出; mkOpt 以 (debug, funLog, funAddKeysIn) 造 opt(敵意存取器須原樣交給被測函數, 不展開)
        let strict = async (mkOpt, debug) => {
            let m = mk()
            let fd = fresh()
            let logs = []
            let outs = []
            let nAdd = 0
            let names = ['log', 'warn', 'error', 'info', 'debug']
            let orgs = {}
            names.forEach((k) => {
                orgs[k] = console[k]
                console[k] = (...a) => outs.push(a)
            })
            let err = null
            try {
                let opt = mkOpt(debug, (...a) => logs.push(a), (v) => {
                    nAdd++
                    return v
                })
                await dataConvert('nm', 'BTCUSDT', '4hr', 'price', 'ohlc', methods, ARR, m.kp, fd, opt)
            }
            catch (e) {
                err = e
            }
            finally {
                names.forEach((k) => {
                    console[k] = orgs[k]
                })
            }
            return { err, nCalc: m.seen.length, nAdd, files: fs.readdirSync(fd), logs, outs }
        }
        //expectStrict, debug 開與關各一次: reject 固定訊息(逐字)、calc 與 funAddKeysIn 未被呼叫、輸出夾為空、無 console 與警告輸出、訊息不含輸入值
        let expectStrict = async (label, mkOpt, msg) => {
            for (let debug of [false, true]) {
                getOptReader.resetWarned()
                let r = await strict(mkOpt, debug)
                assert.ok(r.err !== null, `${label}: 應 reject`)
                assert.ok(r.err.message === msg, `${label}: 訊息(實際 ${r.err.message})`)
                assert.ok(!r.err.message.includes(SENT), `${label}: 訊息不含輸入值`)
                assert.ok(r.nCalc === 0 && r.nAdd === 0, `${label}: calc 與 funAddKeysIn 不得被呼叫`)
                assert.ok(r.files.length === 0, `${label}: 不得寫出任何檔`)
                assert.ok(r.logs.length === 0 && r.outs.length === 0, `${label}: 不得警告或以 console 輸出`)
            }
            getOptReader.resetWarned()
        }
        let withKeys = (keysIn) => (debug, funLog, funAddKeysIn) => ({ keysIn, debug, funLog, funAddKeysIn })
        let boom = () => {
            throw new Error(`boom-${SENT}`)
        }
        let revoked = (target) => {
            let p = Proxy.revocable(target, {})
            p.revoke()
            return p.proxy
        }
        let MSG_ARR = 'invalid opt.keysIn: must be a non-empty array of non-empty strings'
        let MSG_EL = (i) => `invalid opt.keysIn[${i}]: must be a non-empty string`

        it('keysIn 給了而非非空陣列 ⇒ reject 固定訊息(K3 之例外: 不改用預設)、先於任何計算與寫檔、不含輸入值、debug 亦不警告', async function() {
            let bads = ['Close', SENT, 5, 0, -1, 1.5, NaN, Infinity, true, false, '', ' ', {}, 10n, Object(1), Object('Close'), Symbol('s'), () => ['Close'], new Map(), new Set(['Close']), new Float64Array(1), []]
            for (let v of bads) {
                await expectStrict(`keysIn ${labelOf(v)}`, withKeys(v), MSG_ARR)
            }
        })

        it('keysIn 含非非空字串之元素 ⇒ reject 固定訊息(帶第一個無效元素之索引)、先於任何計算與寫檔、不含輸入值', async function() {
            //[值, 第一個無效元素之索引]
            let bads = [[['Close', 5], 1], [[5], 0], [[''], 0], [['Close', ''], 1], [[null], 0], [[undefined], 0], [[['Close']], 0], [[[]], 0], [['Close', Symbol('s')], 1], [['Close', 10n], 1], [[{ k: SENT }], 0], [['a', 'b', { toString: () => SENT }], 2], [[true], 0], [new Array(2), 0], [['Close', SENT, 0], 2]]
            for (let [v, i] of bads) {
                await expectStrict(`keysIn ${labelOf(v)}`, withKeys(v), MSG_EL(i))
            }
        })

        it('keysIn 之讀取拋錯(鍵或元素之存取器、陷阱、已撤銷之 Proxy)視為給了而無效 ⇒ reject 固定訊息、不洩漏拋出之訊息', async function() {
            await expectStrict('keysIn 之存取器拋錯', (debug, funLog, funAddKeysIn) => {
                let o = { debug, funLog, funAddKeysIn }
                Object.defineProperty(o, 'keysIn', { enumerable: true, get: boom })
                return o
            }, MSG_ARR)
            let elemThrow = ['Close']
            Object.defineProperty(elemThrow, 0, { enumerable: true, get: boom })
            await expectStrict('keysIn 元素之存取器拋錯', withKeys(elemThrow), MSG_ARR)
            let trap = new Proxy(['Close'], {
                get(t, k, r) {
                    if (k === 'length' || k === Symbol.iterator || k === '0') {
                        boom()
                    }
                    return Reflect.get(t, k, r)
                },
            })
            await expectStrict('keysIn 陷阱拋錯之 Proxy', withKeys(trap), MSG_ARR)
            await expectStrict('keysIn 已撤銷之陣列 Proxy', withKeys(revoked(['Close'])), MSG_ARR)
            await expectStrict('opt 已撤銷之 Proxy', () => revoked({}), MSG_ARR)
        })

        it('opt 為函數而帶鍵者照讀其鍵(同 getOptReader 之判定): 合法值生效, 無效值即拒', async function() {
            let fnOpt = (keysIn) => {
                let o = () => {}
                o.keysIn = keysIn
                return o
            }
            let r = await run(fnOpt(['Close']))
            assert.deepStrictEqual(r.seen, ['Close'])
            await expectStrict('函數 opt 之 keysIn 無效', () => fnOpt(5), MSG_ARR)
        })

        it('denyOutput 只收 true 與 false(K5): true ⇒ 不寫檔; false ⇒ 寫檔; 其餘視為未給(預設 false, 寫檔)', async function() {
            let r1 = await run({ denyOutput: true })
            assert.deepStrictEqual(r1.files, [])
            assert.strictEqual(r1.rows.length, 1)
            let r2 = await run({ denyOutput: false })
            assert.deepStrictEqual(r2.files, ['price_ohlc_none_X_fx_a.json'])
            for (let v of [1, 0, 'true', 'false', 'y', 'TRUE', {}, [], [true], NaN, 10n, Object(true), Symbol('s'), () => true]) {
                let r = await run({ denyOutput: v })
                assert.ok(r.files.length === 1, `${labelOf(v)} 應視為未給而寫檔`)
            }
        })

        it('denyOutput 之 K3 全套', async function() {
            let invalids = [1, 0, 'true', 'false', 'y', 'n', 'TRUE', '', ' ', {}, [], [true], NaN, 10n, Object(true), Symbol('s'), () => true, 5]
            let base = await call({})
            await assertOptK3({ call, base, name: 'denyOutput', invalids, sames: [false], tag: TAG_CONV, desc: 'a boolean', defDesc: 'false', probe: 'yes' })
        })

        it('funAddKeysIn 為函式 ⇒ 逐筆轉換 arrOhlc(可回傳 Promise), calc 收到轉換後之資料; 非函式視為未給(不轉換)', async function() {
            let r = await run({ funAddKeysIn: (v) => ({ ...v, z: 1 }) }, { arr: [{ time: 't0' }, { time: 't1' }] })
            assert.deepStrictEqual(r.arrs[0], [{ time: 't0', z: 1 }, { time: 't1', z: 1 }])
            let r2 = await run({ funAddKeysIn: async (v) => ({ ...v, z: 2 }) }, { arr: [{ time: 't0' }] })
            assert.deepStrictEqual(r2.arrs[0], [{ time: 't0', z: 2 }])
            for (let v of [5, 'f', {}, true, [], Symbol('s'), 10n]) {
                let r3 = await run({ funAddKeysIn: v }, { arr: [{ time: 't0' }] })
                assert.ok(JSON.stringify(r3.arrs[0]) === JSON.stringify([{ time: 't0' }]), `${labelOf(v)} 不得轉換`)
            }
        })

        it('funAddKeysIn 之 K3 全套', async function() {
            let invalids = [5, 'f', 'x', '', {}, [], true, false, 0, NaN, 10n, Symbol('s'), Object('f')]
            let base = await call({})
            await assertOptK3({ call, base, name: 'funAddKeysIn', invalids, sames: [(v) => v], tag: TAG_CONV, desc: 'a function', defDesc: 'no conversion', probe: 5 })
        })

        it('警告之 funLog 為 opt.funLog; opt.debug 非恰為 true 時不警告; 各鍵之警告互不影響且各一則', async function() {
            getOptReader.resetWarned()
            let logs = []
            await run({ keysIn: ['Close'], denyOutput: 'y', funAddKeysIn: 'f', debug: true, funLog: (m, info) => logs.push([m, info]) })
            assert.deepStrictEqual(logs.map((v) => v[0]).sort(), [
                `[${TAG_CONV}] invalid opt.denyOutput: must be a boolean, using default false`,
                `[${TAG_CONV}] invalid opt.funAddKeysIn: must be a function, using default no conversion`,
            ])
            assert.deepStrictEqual(logs.map((v) => v[1].key).sort(), ['denyOutput', 'funAddKeysIn'])
            logs.forEach((v) => assert.deepStrictEqual({ fn: v[1].fn, reason: v[1].reason }, { fn: TAG_CONV, reason: 'invalid' }))
            getOptReader.resetWarned()
        })

        it('每個鍵每次呼叫只讀一次, 讀取之鍵恰為 { debug, funAddKeysIn, keysIn, denyOutput }(debug 為 false 時不讀 funLog)', async function() {
            let reads = {}
            let opt = new Proxy({ keysIn: ['Close'], denyOutput: true, funAddKeysIn: (v) => v }, {
                get(t, k, r) {
                    reads[String(k)] = (reads[String(k)] || 0) + 1
                    return Reflect.get(t, k, r)
                },
            })
            await run(opt)
            assert.deepStrictEqual(reads, { debug: 1, funAddKeysIn: 1, keysIn: 1, denyOutput: 1 })
        })

        it('敵意輸入(依 K3 之鍵): denyOutput、funAddKeysIn 之存取器拋錯、opt 非物件 ⇒ 視為未給(結果同未給)、不 reject、不警告', async function() {
            let base = JSON.stringify(await call({}))
            let warns = []
            let orgWarn = console.warn
            console.warn = (...a) => warns.push(a)
            try {
                //keysIn 屬 K3 之例外(讀取拋錯即拒), 見〈keysIn 之讀取拋錯〉
                for (let key of ['denyOutput', 'funAddKeysIn']) {
                    let o = { debug: true }
                    Object.defineProperty(o, key, {
                        enumerable: true,
                        get() {
                            throw new Error(`boom-${SENT}`)
                        },
                    })
                    getOptReader.resetWarned()
                    assert.ok(JSON.stringify(await call(o)) === base, `${key} 之存取器拋錯應視為未給`)
                }
                for (let o of [5, 'x', true, null, undefined]) {
                    getOptReader.resetWarned()
                    assert.ok(JSON.stringify(await call(o)) === base, `opt ${labelOf(o)} 應視為未給`)
                }
            }
            finally {
                console.warn = orgWarn
            }
            assert.strictEqual(warns.length, 0, '不得警告')
        })

        it('keysIn 之快照: 元素之存取器第二次讀取回傳他值、檢測後陣列被改動, 皆不影響使用(檢測之值即使用之值)', async function() {
            //(a) 元素之存取器: 第 1 次讀取為字串, 其後為數字
            let reads = 0
            let keysIn = ['Close']
            Object.defineProperty(keysIn, 0, {
                enumerable: true,
                get() {
                    reads++
                    return reads === 1 ? 'Close' : 5
                },
            })
            let r = await run({ keysIn })
            assert.deepStrictEqual(r.seen, ['Close'])
            assert.strictEqual(reads, 1, '元素只讀一次')
            //(b) 檢測後(funAddKeysIn 執行時)陣列被改動
            let ks = ['Close', 'Open']
            let funMut = (v) => {
                ks.push(5)
                ks[0] = 'Low'
                return v
            }
            let r2 = await run({ keysIn: ks, funAddKeysIn: funMut })
            assert.deepStrictEqual(r2.seen, ['Close', 'Open'])
            assert.deepStrictEqual(r2.rows.map((v) => v.keyIn), ['Close', 'Open'])
        })

        it('合法輸入之輸出與先前相同: 未給 opt、給合法值之回傳列與寫出之檔皆逐位不變(另見 unit-dataConvert 之快照)', async function() {
            let a = await call({})
            let b = await call({ keysIn: ['none'], denyOutput: false, funAddKeysIn: null })
            assert.deepStrictEqual(a, b)
        })

    })


    describe('I1 dataCalibrate: opt.params、keyIn(K3 之例外)與 optMethodRef、mags、threshold、thresholdAbs、nSweep、funLog(K3)', function() {

        let mkArr = (n) => {
            let arr = []
            for (let i = 0; i < n; i++) {
                arr.push({ time: `t${i}`, u: Math.sin(i * 1.7) })
            }
            return arr
        }
        let ARR = mkArr(400)

        //mkCalcFn, X = u + a*u^2(a 取自 optMethod.a, 預設 0); 記錄每次呼叫之 keyIn 與 optMethod(複本)
        let mkCalcFn = () => {
            let calls = []
            let calcFn = async (arr, keyIn, optMethod) => {
                calls.push({ keyIn, optMethod: { ...optMethod }, ref: optMethod })
                let a = optMethod.a !== undefined ? optMethod.a : 0
                let vs = arr.map((v) => {
                    let x = v.u + a * v.u * v.u
                    return { time: v.time, X: x }
                })
                return [{ period: 'p1', len: 1, vs }]
            }
            return { calcFn, calls }
        }

        //run, 預設 optMethodInit { a: 0 }、參考側 a = 0.1
        let run = async (opt, init = { a: 0 }) => {
            let m = mkCalcFn()
            let r = await dataCalibrate(m.calcFn, ARR, ARR, ['X'], init, opt)
            return { r, calls: m.calls }
        }
        //call, 回傳可序列化之結果(不展開 opt: 敵意輸入之存取器須原樣交給 dataCalibrate)
        let call = async (opt) => {
            let { r, calls } = await run(opt)
            return { r, keyIns: [...new Set(calls.map((v) => v.keyIn))], n: calls.length }
        }
        let extra = { optMethodRef: { a: 0.1 } }
        //isWarn, opt.funLog 同時收進度輸出(只帶 msg)與警告(帶 { fn, reason, key })
        let isWarn = (m, info) => info !== undefined

        it('params 合法 ⇒ 只搜尋所列之鍵; 未給(undefined、null) ⇒ 預設為 optMethodInit 全部鍵', async function() {
            let init = { a: 0, b: 0 }
            let varied = (calls) => [...new Set(calls.flatMap((c) => Object.keys(c.optMethod).filter((k) => c.optMethod[k] !== init[k])))].sort()
            let m1 = await run({ optMethodRef: { a: 0.1 }, params: ['a'] }, init)
            assert.deepStrictEqual(varied(m1.calls.slice(1)), ['a'])
            for (let opt of [{}, { params: undefined }, { params: null }]) {
                let m2 = await run({ optMethodRef: { a: 0.1 }, ...opt }, init)
                assert.deepStrictEqual(varied(m2.calls.slice(1)), ['a', 'b'])
            }
        })

        it('keyIn 合法 ⇒ 原樣傳入 calcFn; 未給(undefined、null) ⇒ none', async function() {
            let m = await run({ optMethodRef: { a: 0.1 }, keyIn: 'Close' })
            assert.deepStrictEqual([...new Set(m.calls.map((v) => v.keyIn))], ['Close'])
            for (let opt of [{}, { keyIn: undefined }, { keyIn: null }]) {
                let m2 = await run({ optMethodRef: { a: 0.1 }, ...opt })
                assert.deepStrictEqual([...new Set(m2.calls.map((v) => v.keyIn))], ['none'])
            }
        })

        //strict, K3 之例外鍵: 執行 dataCalibrate, 收集拒絕、calcFn 呼叫、console 與 funLog 輸出; mkOpt 以 (debug, funLog) 造 opt(敵意存取器須原樣交給被測函數, 不展開)
        let strict = async (mkOpt, debug) => {
            let m = mkCalcFn()
            let logs = []
            let outs = []
            let names = ['log', 'warn', 'error', 'info', 'debug']
            let orgs = {}
            names.forEach((k) => {
                orgs[k] = console[k]
                console[k] = (...a) => outs.push(a)
            })
            let err = null
            try {
                await dataCalibrate(m.calcFn, ARR, ARR, ['X'], { a: 0 }, mkOpt(debug, (...a) => logs.push(a)))
            }
            catch (e) {
                err = e
            }
            finally {
                names.forEach((k) => {
                    console[k] = orgs[k]
                })
            }
            return { err, calls: m.calls, logs, outs }
        }
        //expectStrict, debug 開與關各一次: reject 固定訊息(逐字)、calcFn 未被呼叫、無 console 與警告輸出、訊息不含輸入值
        let expectStrict = async (label, mkOpt, msg) => {
            for (let debug of [false, true]) {
                getOptReader.resetWarned()
                let r = await strict(mkOpt, debug)
                assert.ok(r.err !== null, `${label}: 應 reject`)
                assert.ok(r.err.message === msg, `${label}: 訊息(實際 ${r.err.message})`)
                assert.ok(!r.err.message.includes(SENT), `${label}: 訊息不含輸入值`)
                assert.ok(r.calls.length === 0, `${label}: calcFn 不得被呼叫`)
                assert.ok(r.logs.length === 0 && r.outs.length === 0, `${label}: 不得警告或以 console 輸出`)
            }
            getOptReader.resetWarned()
        }
        //withValue, 鍵之值為 v 之 opt; withGet, 鍵為存取器之 opt
        let withValue = (key, v) => (debug, funLog) => ({ optMethodRef: { a: 0.1 }, [key]: v, debug, funLog })
        let withGet = (key, get) => (debug, funLog) => {
            let o = { optMethodRef: { a: 0.1 }, debug, funLog }
            Object.defineProperty(o, key, { enumerable: true, get })
            return o
        }
        let boom = () => {
            throw new Error(`boom-${SENT}`)
        }
        let revoked = (target) => {
            let p = Proxy.revocable(target, {})
            p.revoke()
            return p.proxy
        }
        let MSG_PARAMS = 'invalid opt.params: must be a non-empty array of non-empty strings'
        let MSG_KEY_IN = 'invalid opt.keyIn: must be a non-empty string'

        it('params 給了而無效 ⇒ 於任何計算之前 reject 固定訊息(K3 之例外: 不改用預設)、不含輸入值、debug 亦不警告', async function() {
            let bads = ['a', SENT, 5, 0, -1, 1.5, NaN, Infinity, true, false, '', ' ', {}, 10n, Object(1), Object('a'), Symbol('s'), () => ['a'], new Map(), new Set(['a']), new Float64Array(1),
                [], [1], ['a', 5], [''], ['a', ''], [null], [undefined], [['a']], [Symbol('s')], ['a', 10n], [{ toString: () => SENT }], [SENT, 5], new Array(2)]
            for (let v of bads) {
                await expectStrict(`params ${labelOf(v)}`, withValue('params', v), MSG_PARAMS)
            }
        })

        it('keyIn 給了而無效 ⇒ 於任何計算之前 reject 固定訊息、不含輸入值、debug 亦不警告', async function() {
            let bads = [5, 0, -1, 1.5, NaN, Infinity, true, false, '', {}, [], ['x'], [SENT], 10n, Object(1), Object('x'), Symbol('s'), () => 'x', new Map(), { toString: () => SENT }]
            for (let v of bads) {
                await expectStrict(`keyIn ${labelOf(v)}`, withValue('keyIn', v), MSG_KEY_IN)
            }
        })

        it('params、keyIn 之讀取拋錯(鍵或元素之存取器、陷阱、已撤銷之 Proxy)視為給了而無效 ⇒ reject 固定訊息、不洩漏拋出之訊息', async function() {
            await expectStrict('params 之存取器拋錯', withGet('params', boom), MSG_PARAMS)
            await expectStrict('keyIn 之存取器拋錯', withGet('keyIn', boom), MSG_KEY_IN)
            let elemThrow = ['a']
            Object.defineProperty(elemThrow, 0, { enumerable: true, get: boom })
            await expectStrict('params 元素之存取器拋錯', withValue('params', elemThrow), MSG_PARAMS)
            let trap = new Proxy(['a'], {
                get(t, k, r) {
                    if (k === 'length' || k === Symbol.iterator || k === '0') {
                        boom()
                    }
                    return Reflect.get(t, k, r)
                },
            })
            await expectStrict('params 陷阱拋錯之 Proxy', withValue('params', trap), MSG_PARAMS)
            await expectStrict('params 已撤銷之陣列 Proxy', withValue('params', revoked(['a'])), MSG_PARAMS)
            await expectStrict('opt 已撤銷之 Proxy(params 先讀)', () => revoked({}), MSG_PARAMS)
        })

        it('opt 為函數而帶鍵者照讀其鍵(同 getOptReader 之判定): 合法值生效, 無效值即拒', async function() {
            let fnOpt = (o) => Object.assign(() => {}, { optMethodRef: { a: 0.1 } }, o)
            let m = await run(fnOpt({ keyIn: 'Close', params: ['a'] }))
            assert.deepStrictEqual([...new Set(m.calls.map((v) => v.keyIn))], ['Close'])
            await expectStrict('函數 opt 之 params 無效', () => fnOpt({ params: 5 }), MSG_PARAMS)
            await expectStrict('函數 opt 之 keyIn 無效', () => fnOpt({ keyIn: 5 }), MSG_KEY_IN)
        })

        it('params、keyIn 皆無效時先報 params(讀取次序); pairs 之檢核先於 opt', async function() {
            await expectStrict('兩者皆無效', (debug, funLog) => ({ params: 5, keyIn: 5, debug, funLog }), MSG_PARAMS)
            await assert.rejects(dataCalibrate(mkCalcFn().calcFn, ARR, ARR, [{ keyOutRef: 'X' }], { a: 0 }, { params: 5 }), { message: 'invalid pairs[0].keyOutSrc: must be a non-empty string' })
        })

        it('optMethodRef 合法(物件, 可為空物件)⇒ 原樣傳入參考側之 calcFn; 無效 ⇒ 空物件', async function() {
            let ref = { a: 0.1 }
            let m = await run({ optMethodRef: ref })
            assert.strictEqual(m.calls[0].ref, ref, '參考側 calcFn 收到之 optMethod 即傳入之物件')
            for (let v of ['x', 5, true, [], [1], 10n, Symbol('s'), () => 1, new Map(), new Set()]) {
                let m2 = await run({ optMethodRef: v })
                assert.ok(JSON.stringify(m2.calls[0].optMethod) === '{}', `${labelOf(v)} 應改用空物件`)
            }
            let m3 = await run({ optMethodRef: {} })
            assert.deepStrictEqual(m3.calls[0].optMethod, {})
        })

        it('optMethodRef 之 K3 全套', async function() {
            let invalids = ['x', 5, 0, true, false, [], [1], NaN, 10n, Object(1), Symbol('s'), () => 1, new Map(), new Set(), '']
            let base = await call({ optMethodRef: undefined })
            await assertOptK3({ call, base, name: 'optMethodRef', invalids, sames: [{}], isWarn, ownFunLogMsg: OWN_FUNLOG, tag: TAG_CAL, desc: 'an object', defDesc: 'an empty object', probe: 5 })
        })

        it('mags 合法(陣列、可為空、元素皆有效數字)⇒ 生效(數字字串轉為數值); 無效 ⇒ 預設階梯', async function() {
            //自訂階梯 [0.5]: 粗掃候選 = 現值、0、±0.5
            let m = await run({ optMethodRef: { a: 0.1 }, mags: [0.5], nSweep: 1 })
            let cands = [...new Set(m.calls.slice(1).map((c) => c.optMethod.a))].sort((x, y) => x - y)
            assert.ok(cands.includes(0.5) && cands.includes(-0.5) && !cands.includes(0.1), `粗掃含 ±0.5, 不含預設階梯之 0.1(實際 ${cands.join(',')})`)
            //數字字串轉為數值
            let m2 = await run({ optMethodRef: { a: 0.1 }, mags: ['0.5', ' 1e-1 '] })
            m2.calls.forEach((c, i) => assert.ok(typeof c.optMethod.a === 'number' || c.optMethod.a === undefined, `第 ${i} 次呼叫之 a 須為數值`))
            assert.ok(m2.calls.some((c) => c.optMethod.a === 0.1 || c.optMethod.a === -0.1), '之 1e-1 轉為 0.1')
            //空陣列合法: 粗掃只有現值與 0
            let m3 = await run({ optMethodRef: { a: 0.1 }, mags: [], nSweep: 1 })
            let c3 = [...new Set(m3.calls.slice(1).map((c) => c.optMethod.a))]
            assert.ok(c3.includes(0) || c3.length >= 1)
            assert.ok(!c3.includes(0.3) && !c3.includes(-0.3), '空階梯不得含預設階梯之值')
            //無效 ⇒ 預設
            let mDef = await run({ optMethodRef: { a: 0.1 } })
            for (let v of ['x', 5, {}, true, [NaN], ['a'], [Infinity], [null], [undefined], [{}], [[]], [10n], [Symbol('s')], new Set([0.5]), [0.5, 'x']]) {
                let m4 = await run({ optMethodRef: { a: 0.1 }, mags: v })
                assert.ok(m4.calls.length === mDef.calls.length, `${labelOf(v)} 應改用預設階梯(呼叫次數同未給)`)
            }
        })

        it('mags 之 K3 全套', async function() {
            let invalids = ['x', 5, 0, '', {}, true, false, [NaN], ['a'], [Infinity], [null], [undefined], [{}], [[]], [10n], [Symbol('s')], new Set([0.5]), [0.5, 'x'], [0.5, true], () => [0.5], 10n, Symbol('s')]
            let base = await call(extra)
            await assertOptK3({ call, base, name: 'mags', invalids, sames: [[1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3], ['0.0001', '0.0003', '0.001', '0.003', '0.01', '0.03', '0.1', '0.3']], extra, isWarn, ownFunLogMsg: OWN_FUNLOG, tag: TAG_CAL, desc: 'an array of valid numbers', defDesc: 'the built-in steps', probe: 'x' })
        })

        it('threshold、thresholdAbs 合法(有限數值或數字字串)⇒ 生效; 無效 ⇒ 預設', async function() {
            let base = await run({ optMethodRef: { a: 0.1 } })
            assert.strictEqual(base.r.adopt, true, '預設門檻下採納(夾具)')
            //threshold 很大 ⇒ 不採納; 數字字串同值
            let t1 = await run({ optMethodRef: { a: 0.1 }, threshold: 1e9 })
            let t2 = await run({ optMethodRef: { a: 0.1 }, threshold: '1e9' })
            assert.strictEqual(t1.r.adopt, false)
            assert.deepStrictEqual(t2.r, t1.r)
            let a1 = await run({ optMethodRef: { a: 0.1 }, thresholdAbs: 1 })
            let a2 = await run({ optMethodRef: { a: 0.1 }, thresholdAbs: ' 1 ' })
            assert.strictEqual(a1.r.adopt, false)
            assert.deepStrictEqual(a2.r, a1.r)
            //無效 ⇒ 預設(採納)
            for (let v of [NaN, Infinity, -Infinity, 'abc', '', true, false, {}, [], [1], 10n, Symbol('s'), () => 1]) {
                let r1 = await run({ optMethodRef: { a: 0.1 }, threshold: v })
                assert.ok(JSON.stringify(r1.r) === JSON.stringify(base.r), `threshold ${labelOf(v)} 應同預設`)
                let r2 = await run({ optMethodRef: { a: 0.1 }, thresholdAbs: v })
                assert.ok(JSON.stringify(r2.r) === JSON.stringify(base.r), `thresholdAbs ${labelOf(v)} 應同預設`)
            }
        })

        it('threshold、thresholdAbs 之 K3 全套', async function() {
            let invalids = [NaN, Infinity, -Infinity, 'abc', '', ' ', 'NP', '-', '1,5', '0x10', true, false, {}, [], [1], 10n, Object(1), Symbol('s'), () => 1]
            let base = await call(extra)
            await assertOptK3({ call, base, name: 'threshold', invalids, sames: [0.15, '0.15', ' 0.15 '], extra, isWarn, ownFunLogMsg: OWN_FUNLOG, tag: TAG_CAL, desc: 'a valid number', defDesc: '0.15', probe: NaN })
            await assertOptK3({ call, base, name: 'thresholdAbs', invalids, sames: [0.01, '0.01', '1e-2'], extra, isWarn, ownFunLogMsg: OWN_FUNLOG, tag: TAG_CAL, desc: 'a valid number', defDesc: '0.01', probe: NaN })
        })

        it('nSweep 合法(不小於 0 之整數或其數字字串)⇒ 生效(0 為不搜尋); 無效 ⇒ 預設(單參數 1 輪、多參數 2 輪)', async function() {
            let lines = async (opt, init = { a: 0 }) => {
                let logs = []
                let m = await run({ optMethodRef: { a: 0.1 }, ...opt, funLog: (msg) => logs.push(msg) }, init)
                return { logs: logs.filter((v) => /^sweep/.test(v)), m }
            }
            assert.strictEqual((await lines({ nSweep: 2 })).logs.length, 2)
            assert.strictEqual((await lines({ nSweep: '2' })).logs.length, 2)
            let z = await lines({ nSweep: 0 })
            assert.strictEqual(z.logs.length, 0)
            assert.strictEqual(z.m.r.nEval, 1, '0 輪只評估起點')
            assert.strictEqual(z.m.r.adopt, false)
            assert.strictEqual((await lines({})).logs.length, 1, '單參數預設 1 輪')
            assert.strictEqual((await lines({}, { a: 0, b: 0 })).logs.length, 4, '兩個參數預設 2 輪 × 2 參數')
            //預設輪數依「檢測後之 params」之個數(不是 optMethodInit 之鍵數): optMethodInit 有 2 個鍵而 params 只列 1 個 ⇒ 1 輪 × 1 參數
            assert.strictEqual((await lines({ params: ['a'] }, { a: 0, b: 0 })).logs.length, 1, 'params 只列 1 個 ⇒ 預設 1 輪')
            assert.strictEqual((await lines({ params: ['a', 'b'] }, { a: 0, b: 0, c: 0 })).logs.length, 4, 'params 列 2 個 ⇒ 預設 2 輪 × 2 參數')
            assert.strictEqual((await lines({ params: null }, { a: 0, b: 0, c: 0 })).logs.length, 6, 'params 為 null(未給) ⇒ 預設 optMethodInit 全部 3 鍵 ⇒ 2 輪 × 3 參數')
            for (let v of [1.5, '1.5', -1, '-1', NaN, Infinity, 'x', '', true, {}, [], [2], 10n, Symbol('s'), () => 2, 1e300]) {
                assert.ok((await lines({ nSweep: v })).logs.length === 1, `nSweep ${labelOf(v)} 應改用預設(單參數 1 輪)`)
            }
        })

        it('nSweep 之 K3 全套', async function() {
            let invalids = [1.5, '1.5', -1, '-1', NaN, Infinity, 'x', '', ' ', true, false, {}, [], [2], 10n, Object(2), Symbol('s'), () => 2, 1e300, '1e300', '0x10']
            let base = await call(extra)
            await assertOptK3({ call, base, name: 'nSweep', invalids, sames: [1, '1', ' 1 ', '1.0'], extra, isWarn, ownFunLogMsg: OWN_FUNLOG, tag: TAG_CAL, desc: 'an integer >= 0', defDesc: 'the number of params > 1 ? 2 : 1', probe: -3.5 })
        })

        it('funLog 為函式 ⇒ 進度輸出(以 (msg) 呼叫); 非函式視為未給; opt.debug 為 true 時亦為警告之出口', async function() {
            let logs = []
            await run({ optMethodRef: { a: 0.1 }, funLog: (m) => logs.push(m) })
            assert.ok(logs.length === 1 && /^sweep1 a: /.test(logs[0]), `進度輸出(實際 ${logs.length} 則)`)
            for (let v of [5, 'x', {}, true, [], 10n, Symbol('s')]) {
                let r = await run({ optMethodRef: { a: 0.1 }, funLog: v })
                assert.ok(r.r.nEval > 0, `${labelOf(v)} 不得 reject`)
            }
            //debug: 警告與進度皆交 funLog; 警告以 (msg, meta) 呼叫
            getOptReader.resetWarned()
            let all = []
            await run({ optMethodRef: { a: 0.1 }, threshold: 'abc', debug: true, funLog: (m, meta) => all.push([m, meta]) })
            let warn = all.filter((v) => v[1] !== undefined)
            assert.deepStrictEqual(warn.map((v) => v[0]), [`[${TAG_CAL}] invalid opt.threshold: must be a valid number, using default 0.15`])
            assert.deepStrictEqual(warn[0][1], { fn: TAG_CAL, reason: 'invalid', key: 'threshold' })
            assert.ok(all.some((v) => v[1] === undefined && /^sweep1 a: /.test(v[0])), '進度輸出仍交 funLog')
            getOptReader.resetWarned()
            //funLog 無效且 debug: 警告改走 console.warn, 且文字固定
            let warns = []
            let orgWarn = console.warn
            console.warn = (...a) => warns.push(a)
            try {
                await run({ optMethodRef: { a: 0.1 }, funLog: SENT, debug: true })
            }
            finally {
                console.warn = orgWarn
            }
            assert.deepStrictEqual(warns, [[`[${TAG_CAL}] invalid opt.funLog: must be a function, using default none`]])
            getOptReader.resetWarned()
        })

        it('每個鍵每次呼叫只讀一次, 讀取之鍵恰為 { debug, params, keyIn, optMethodRef, mags, threshold, thresholdAbs, nSweep, funLog }', async function() {
            let reads = {}
            let opt = new Proxy({ params: ['a'], keyIn: 'Close', optMethodRef: { a: 0.1 }, mags: [0.5], threshold: 0.15, thresholdAbs: 0.01, nSweep: 1, funLog: () => {} }, {
                get(t, k, r) {
                    reads[String(k)] = (reads[String(k)] || 0) + 1
                    return Reflect.get(t, k, r)
                },
            })
            await run(opt)
            assert.deepStrictEqual(reads, { debug: 1, params: 1, keyIn: 1, optMethodRef: 1, mags: 1, threshold: 1, thresholdAbs: 1, nSweep: 1, funLog: 1 })
        })

        it('敵意輸入(依 K3 之鍵): 各鍵之存取器拋錯、opt 非物件 ⇒ 視為未給(結果同未給)、不 reject、不警告', async function() {
            let base = JSON.stringify(await call(extra))
            let warns = []
            let orgWarn = console.warn
            console.warn = (...a) => warns.push(a)
            try {
                //params、keyIn 屬 K3 之例外(讀取拋錯即拒), 見〈params、keyIn 給了而無效〉
                for (let key of ['optMethodRef', 'mags', 'threshold', 'thresholdAbs', 'nSweep', 'funLog']) {
                    let o = { optMethodRef: { a: 0.1 }, debug: true }
                    Object.defineProperty(o, key, {
                        enumerable: true,
                        get() {
                            throw new Error(`boom-${SENT}`)
                        },
                    })
                    getOptReader.resetWarned()
                    let r = key === 'optMethodRef' ? await run(o) : await call(o)
                    if (key !== 'optMethodRef') {
                        assert.ok(JSON.stringify(r) === base, `${key} 之存取器拋錯應視為未給`)
                    }
                    else {
                        assert.ok(JSON.stringify(r.calls[0].optMethod) === '{}', 'optMethodRef 之存取器拋錯應視為未給(空物件)')
                    }
                }
                let mDef = await run(undefined)
                for (let o of [5, 'x', true, null]) {
                    let m = await run(o)
                    assert.ok(JSON.stringify(m.r) === JSON.stringify(mDef.r), `opt ${labelOf(o)} 應視為未給`)
                }
            }
            finally {
                console.warn = orgWarn
            }
            assert.strictEqual(warns.length, 0, '不得警告')
        })

        it('params、mags 之快照: 元素之存取器第二次讀取回傳他值、檢測後陣列被改動, 皆不影響使用', async function() {
            let reads = 0
            let params = ['a']
            Object.defineProperty(params, 0, {
                enumerable: true,
                get() {
                    reads++
                    return reads === 1 ? 'a' : 5
                },
            })
            let base = await run({ optMethodRef: { a: 0.1 }, params: ['a'] })
            let m = await run({ optMethodRef: { a: 0.1 }, params })
            assert.deepStrictEqual(m.r, base.r)
            assert.strictEqual(reads, 1, 'params 之元素只讀一次')
            //mags: 存取器與檢測後之改動(calcFn 內改動陣列)
            let readsM = 0
            let mags = [0.5]
            Object.defineProperty(mags, 0, {
                enumerable: true,
                get() {
                    readsM++
                    return readsM === 1 ? 0.5 : 'x'
                },
            })
            let b2 = await run({ optMethodRef: { a: 0.1 }, mags: [0.5] })
            let m2 = await run({ optMethodRef: { a: 0.1 }, mags })
            assert.deepStrictEqual(m2.r, b2.r)
            assert.strictEqual(readsM, 1, 'mags 之元素只讀一次')
            let mags3 = [0.5]
            let m3mk = mkCalcFn()
            let calcFn = async (arr, keyIn, om) => {
                mags3.push(9)
                mags3[0] = 123
                return m3mk.calcFn(arr, keyIn, om)
            }
            let r3 = await dataCalibrate(calcFn, ARR, ARR, ['X'], { a: 0 }, { optMethodRef: { a: 0.1 }, mags: mags3 })
            assert.deepStrictEqual(r3, b2.r)
        })

    })

})
