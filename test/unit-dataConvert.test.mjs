import assert from 'assert'
import fs from 'fs'
import { fileURLToPath } from 'url'
import dataConvert from '../src/dataConvert.mjs'
import { genOhlc, assertNear } from './unit-setup.mjs'
import { NEW_FIELDS, SYN_PERIODS, synCalc, KP, methodsOf, runParityCase } from './unit-dataConvertKit.mjs'


//規格來源: src/dataConvert.mjs 之 JSDoc、README〈dataConvert: per-period normalization constants and period statistics〉
//  D1. 未給nm.byPeriod(含null、undefined)時, 寫出之整個資料夾(檔名清單與各檔內容)與回傳列之既有欄位(名稱、次序、值)皆與1.0.66相同(以改動前之sha256快照釘住; 與原版逐檔對拍另見交付之對拍腳本)
//  D2. nm.byPeriod之鍵為期別標籤、值為{avg,std}: 某期別有自己之鍵(own property)者用其avg與std, 否則用nm.avg與nm.std(只給部分期別、空物件、繼承之鍵皆然)
//  D3. nm.byPeriod給了即檢核(先於任何計算與寫檔; 與其他deal之檢核同): 須為一般物件(可為空物件), 各值須為物件、avg為有限數值、std為有限數值且大於0(只收數值, 不收數字字串、BigInt); 否則reject固定訊息(不含輸入值)且不寫出任何檔; deal.keyIn有指定而不在keysIn內者不處理故不檢核
//  D4. 回傳列增列n、median、q25、q75(各期攤平後)與periods(各期正規化後之統計{period,len,n,avg,std,min,max,median,q25,q75}); 分位數為第7型; 回傳列與periods之全部統計(n、avg、std、min、max、median、q25、q75)只取有限數值(NaN、±Infinity皆不計入), n為有限值之個數, 為0時其餘統計欄皆為null(回傳列之min與max亦然); 正規化本身(逐值寫出之檔)不變
//  D5. 往返: 以{avg:0,std:1}取得各期之統計後組成byPeriod重跑, 各期輸出之平均約0、標準差約1; 以中位數與四分位距組成者, 中位數約0、四分位距約1.349


//SNAP, 改動前(w-data-trade 1.0.66)之對拍快照: 以原版dataConvert對unit-dataConvertKit之runParityCase各案(genOhlc(600)、vec/ma/rsi/合成calc)產生之輸出夾清單雜湊與回傳列(去除新增欄位)雜湊; 快照不得以現行程式碼重產
let SNAP = {
    write: { nFiles: 68, nRows: 10, manifest: '01569a89bd7f623633ec1311b15f8e9890ccda3a617a4d68be374d9bd071fa34', rows: 'f5a2f4998c0b43ba6bbc0d97dff10cbe2237d4cd8ca3e1fbc3979f0f6706eea0' },
    deny: { nFiles: 0, nRows: 10, manifest: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', rows: 'f5a2f4998c0b43ba6bbc0d97dff10cbe2237d4cd8ca3e1fbc3979f0f6706eea0' },
    funAdd: { nFiles: 68, nRows: 10, manifest: '1b86f906352ffa9de7003dc91e498408de402701f9aef7b07a518322f61bd8c4', rows: '28e705d20de00f4e89cf9ce30a7665507ab3348205cca5db2436a203e5402a6e' },
    day: { nFiles: 68, nRows: 10, manifest: '02b5eb2a2bb8152e8b11b1cddf84596f8984475c5a5163d1def4ad1ab2c8b0f6', rows: 'f5a2f4998c0b43ba6bbc0d97dff10cbe2237d4cd8ca3e1fbc3979f0f6706eea0' },
}

let MSG = 'invalid deal.nm.byPeriod: must be an object of { avg, std } with a finite avg and a finite std > 0'
let COLS_OLD = ['method', 'keyIn', 'keyOut', 'avg', 'std', 'min', 'max']
let COLS_PERIOD = ['period', 'len', 'n', 'avg', 'std', 'min', 'max', 'median', 'q25', 'q75']

//ARR, dataConvert要求arrOhlc為非空陣列; 測試用之calc不讀其內容
let ARR = [{ time: 't0' }]


//brute, 另寫之暴力統計(不與src共用程式): 只取有限數值(NaN、±Infinity皆不計), 排序後以分數位置線性內插(第7型之定義); n為0時各欄為null
let brute = (xs) => {
    let v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x))
    let n = v.length
    if (n === 0) {
        return { n, avg: null, std: null, min: null, max: null, median: null, q25: null, q75: null }
    }
    let s = [...v].sort((a, b) => a - b)
    let q = (p) => {
        let pos = (n - 1) * p
        let lo = Math.floor(pos)
        let hi = Math.ceil(pos)
        return s[lo] + (pos - lo) * (s[hi] - s[lo])
    }
    let sum = 0
    for (let x of v) {
        sum += x
    }
    let avg = sum / n
    let std = null
    if (n > 1) {
        let ss = 0
        for (let x of v) {
            ss += (x - avg) * (x - avg)
        }
        std = Math.sqrt(ss / (n - 1))
    }
    return { n, avg, std, min: s[0], max: s[n - 1], median: q(0.5), q25: q(0.25), q75: q(0.75) }
}


//assertStat, 斷言一組統計與暴力計算相同(null須全等, 數值以相對誤差1e-9)
let assertStat = (st, br, tag) => {
    for (let k of ['n', 'avg', 'std', 'min', 'max', 'median', 'q25', 'q75']) {
        if (br[k] === null) {
            assert.strictEqual(st[k], null, `${tag} ${k}`)
        }
        else {
            assertNear(st[k], br[k], 1e-9, `${tag} ${k}`)
        }
    }
}


//fixedCalc, 依 periods([{ period, len, xs }])回傳固定值之calc(keyOut為X), 各筆之time逐筆相異; 回傳{ kp, st }, st.calls為被呼叫次數
let fixedCalc = (periods) => {
    let st = { calls: 0 }
    let kp = {
        fx: async () => {
            st.calls++
            return periods.map((p) => ({ period: p.period, len: p.len, vs: p.xs.map((x, i) => ({ time: `t${i}`, X: x })) }))
        },
    }
    return { kp, st }
}


//deal, 單一method單一deal之methods
let dealOf = (nm, extra = {}) => [{ method: 'fx', deals: [{ keyOut: 'X', nm, ...extra }], optMethod: {} }]


describe('dataConvert(正規化常數依期別、各期統計)', function() {

    let fdRoot = fileURLToPath(new URL('./_tmp/unit-dataConvert/', import.meta.url))
    let seq = 0

    //fresh, 取得全新之空輸出夾
    let fresh = () => {
        let fd = fdRoot + `c${seq++}/`
        fs.mkdirSync(fd, { recursive: true })
        return fd
    }

    //call, 呼叫dataConvert(keysIn預設['none'], 輸出檔名為price_ohlc_none_X_fx_<期別>.json)
    let call = (methods, kp, fd, opt = {}) => dataConvert('t', 'SYM', '4hr', 'price', 'ohlc', methods, ARR, kp, fd, { keysIn: ['none'], ...opt })

    //readP, 讀某期之輸出檔之param序列
    let readP = (fd, period, keyOut = 'X') => JSON.parse(fs.readFileSync(`${fd}price_ohlc_none_${keyOut}_fx_${period}.json`, 'utf8')).map((v) => v.param)

    let readPs = (fd, period, keyOut = 'X', method = 'syn') => JSON.parse(fs.readFileSync(`${fd}price_ohlc_none_${keyOut}_${method}_${period}.json`, 'utf8')).map((v) => v.param)

    before(function() {
        fs.mkdirSync(fdRoot, { recursive: true })
    })

    after(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        try {
            fs.rmdirSync(fileURLToPath(new URL('./_tmp/', import.meta.url))) //test/_tmp已空時一併移除(非空則保留)
        }
        catch (err) {}
    })

    describe('D1 未給nm.byPeriod: 與1.0.66逐位相同', function() {

        for (let id of ['write', 'deny', 'funAdd', 'day']) {
            it(`對拍快照[${id}]: 輸出夾之檔名清單與各檔內容、回傳列之既有欄位(去除新增欄位)皆同改動前`, async function() {
                let fd = fresh()
                let r = await runParityCase(dataConvert, fd, id)
                assert.strictEqual(Object.keys(r.files).length, SNAP[id].nFiles, `${id} 檔數`)
                assert.strictEqual(r.nRows, SNAP[id].nRows, `${id} 列數`)
                assert.strictEqual(r.manifest, SNAP[id].manifest, `${id} 輸出夾`)
                assert.strictEqual(r.rows, SNAP[id].rows, `${id} 回傳列`)
            })
        }

        it('前提: 對拍資料之各期尺度明顯不同(合成calc之各期原值之標準差相差逾100倍, 且各期之值逐筆相異)', async function() {
            let rrs = await synCalc(ARR, 'none', {})
            let stds = rrs.filter((r) => r.vs.length > 1).map((r) => brute(r.vs.map((m) => m.X)).std)
            assert.ok(Math.max(...stds) / Math.min(...stds) > 100, '各期尺度須明顯不同')
            let all = []
            for (let r of rrs) {
                let xs = r.vs.map((m) => m.X)
                assert.strictEqual(new Set(xs).size, xs.length, `期別${r.period}之值須逐筆相異`)
                all.push(...xs)
            }
            assert.strictEqual(new Set(all).size, all.length, '各期之值須兩兩相異')
            assert.ok(rrs.some((r) => r.vs.length === 0) && rrs.some((r) => r.vs.length === 1), '須含0根與1根之期')
        })

        it('回傳列之欄位名稱與次序: 既有七欄在前且不變, 其後依序為n、median、q25、q75、periods; periods各元素之欄位次序固定', async function() {
            let fd = fresh()
            let rs = await call(methodsOf().slice(3), KP, fd, { denyOutput: true })
            assert.ok(rs.length > 0)
            for (let r of rs) {
                assert.deepStrictEqual(Object.keys(r), [...COLS_OLD, 'n', 'median', 'q25', 'q75', 'periods'])
                assert.deepStrictEqual(NEW_FIELDS, ['n', 'median', 'q25', 'q75', 'periods'])
                for (let p of r.periods) {
                    assert.deepStrictEqual(Object.keys(p), COLS_PERIOD)
                }
            }
        })

        it('byPeriod為undefined、null或空物件時, 輸出夾與回傳列同未給(逐檔逐位相同)', async function() {
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30, 45] }, { period: 'b', len: 2, xs: [3, 5, 9] }])
            let nm = { avg: 4, std: 2 }
            let fd0 = fresh()
            let r0 = await call(dealOf(nm), kp, fd0)
            for (let [tag, bp] of [['undefined', undefined], ['null', null], ['空物件', {}]]) {
                let fd = fresh()
                let r = await call(dealOf({ ...nm, byPeriod: bp }), kp, fd)
                assert.deepStrictEqual(r, r0, tag)
                assert.deepStrictEqual(fs.readdirSync(fd).sort(), fs.readdirSync(fd0).sort(), tag)
                for (let fn of fs.readdirSync(fd0)) {
                    assert.ok(fs.readFileSync(fd + fn).equals(fs.readFileSync(fd0 + fn)), `${tag} ${fn}`)
                }
            }
        })

    })

    describe('D2 byPeriod只對有自己之鍵之期別生效', function() {

        it('手算例: a與c有自己之鍵, b沿用nm; 輸出之值、各期統計與攤平統計皆等於手算值', async function() {
            let { kp } = fixedCalc([
                { period: 'a', len: 1, xs: [10, 20, 30] },
                { period: 'b', len: 2, xs: [3, 5, 7] },
                { period: 'c', len: 3, xs: [100, 200] },
            ])
            let nm = { avg: 1, std: 2, byPeriod: { a: { avg: 20, std: 10 }, c: { avg: 100, std: 50 } } }
            let fd = fresh()
            let rs = await call(dealOf(nm), kp, fd)
            assert.deepStrictEqual(readP(fd, 'a'), [-1, 0, 1])
            assert.deepStrictEqual(readP(fd, 'b'), [1, 2, 3])
            assert.deepStrictEqual(readP(fd, 'c'), [0, 2])
            assert.deepStrictEqual(fs.readdirSync(fd).sort(), ['price_ohlc_none_X_fx_a.json', 'price_ohlc_none_X_fx_b.json', 'price_ohlc_none_X_fx_c.json'])
            assert.strictEqual(rs.length, 1)
            let r = rs[0]
            //各期: a [-1,0,1]、b [1,2,3]、c [0,2]
            assert.deepStrictEqual(r.periods.map((p) => [p.period, p.len, p.n, p.min, p.max, p.median, p.q25, p.q75]), [
                ['a', 1, 3, -1, 1, 0, -0.5, 0.5],
                ['b', 2, 3, 1, 3, 2, 1.5, 2.5],
                ['c', 3, 2, 0, 2, 1, 0.5, 1.5],
            ])
            assert.deepStrictEqual(r.periods.map((p) => p.avg), [0, 2, 1])
            assertNear(r.periods[0].std, 1, 1e-12)
            assertNear(r.periods[1].std, 1, 1e-12)
            assertNear(r.periods[2].std, Math.SQRT2, 1e-12)
            //攤平 [-1,0,1,1,2,3,0,2] → 排序 [-1,0,0,1,1,2,2,3]: n 8、平均 1、中位數 1、q25 0(h = 1.75)、q75 2(h = 5.25)
            assert.strictEqual(r.n, 8)
            assert.strictEqual(r.avg, 1)
            assert.strictEqual(r.median, 1)
            assert.strictEqual(r.q25, 0)
            assert.strictEqual(r.q75, 2)
            assert.strictEqual(r.min, -1)
            assert.strictEqual(r.max, 3)
        })

        it('只給部分期別: 其餘期別之輸出同只用nm(逐值相同); 有鍵之期別用自己之avg與std(非nm之avg、非nm之std各自之混用)', async function() {
            let { kp } = fixedCalc([
                { period: 'a', len: 1, xs: [10, 20, 30, 40] },
                { period: 'b', len: 2, xs: [3, 5, 9, 11] },
                { period: 'c', len: 3, xs: [7, 8, 9, 10] },
            ])
            let nm = { avg: 6, std: 4 }
            let fdN = fresh()
            await call(dealOf(nm), kp, fdN)
            let fdP = fresh()
            await call(dealOf({ ...nm, byPeriod: { b: { avg: 100, std: 0.5 } } }), kp, fdP)
            assert.deepStrictEqual(readP(fdP, 'a'), readP(fdN, 'a'))
            assert.deepStrictEqual(readP(fdP, 'c'), readP(fdN, 'c'))
            assert.deepStrictEqual(readP(fdP, 'b'), [3, 5, 9, 11].map((x) => (x - 100) / 0.5))
            //只有avg或只有std不同之鍵: avg不同時std取自byPeriod、std不同時avg取自byPeriod(兩者皆取自該期之鍵)
            let fdA = fresh()
            await call(dealOf({ ...nm, byPeriod: { b: { avg: 6, std: 2 } } }), kp, fdA)
            assert.deepStrictEqual(readP(fdA, 'b'), [3, 5, 9, 11].map((x) => (x - 6) / 2))
            let fdS = fresh()
            await call(dealOf({ ...nm, byPeriod: { b: { avg: 5, std: 4 } } }), kp, fdS)
            assert.deepStrictEqual(readP(fdS, 'b'), [3, 5, 9, 11].map((x) => (x - 5) / 4))
        })

        it('byPeriod列了不存在之期別 ⇒ 忽略; 未給nm.avg與nm.std時以0與1為底', async function() {
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }])
            let fd = fresh()
            await call(dealOf({ byPeriod: { zzz: { avg: 1, std: 1 } } }), kp, fd)
            assert.deepStrictEqual(readP(fd, 'a'), [10, 20, 30])
            //nm須為有鍵之物件, 故以byPeriod本身為其唯一鍵時仍成立
            let fd2 = fresh()
            await call(dealOf({ byPeriod: { a: { avg: 10, std: 10 } } }), kp, fd2)
            assert.deepStrictEqual(readP(fd2, 'a'), [0, 1, 2])
        })

        it('只認自有之鍵: 期別標籤為toString、constructor、__proto__、hasOwnProperty時, byPeriod不含該鍵(含繼承之鍵)則沿用nm; 自有之鍵(含JSON.parse建出之__proto__)才生效', async function() {
            let labels = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']
            let { kp } = fixedCalc(labels.map((p, i) => ({ period: p, len: i + 1, xs: [10 + i, 20 + i, 30 + i] })))
            let nm = { avg: 0, std: 1 }
            //空物件與繼承鍵之物件: 皆沿用nm(值不變)
            for (let [tag, bp] of [['空物件', {}], ['繼承之鍵', Object.create({ toString: { avg: 5, std: 5 }, constructor: { avg: 5, std: 5 }, valueOf: { avg: 5, std: 5 } })]]) {
                let fd = fresh()
                await call(dealOf({ ...nm, byPeriod: bp }), kp, fd)
                labels.forEach((p, i) => {
                    assert.deepStrictEqual(readP(fd, p), [10 + i, 20 + i, 30 + i], `${tag} ${p}`)
                })
            }
            //自有之鍵
            let bp = JSON.parse('{"toString":{"avg":10,"std":2},"__proto__":{"avg":20,"std":4},"constructor":{"avg":0,"std":10}}')
            let fd = fresh()
            await call(dealOf({ ...nm, byPeriod: bp }), kp, fd)
            assert.deepStrictEqual(readP(fd, 'toString'), [(10 - 10) / 2, (20 - 10) / 2, (30 - 10) / 2])
            assert.deepStrictEqual(readP(fd, '__proto__'), [(12 - 20) / 4, (22 - 20) / 4, (32 - 20) / 4])
            assert.deepStrictEqual(readP(fd, 'constructor'), [11 / 10, 21 / 10, 31 / 10])
            assert.deepStrictEqual(readP(fd, 'hasOwnProperty'), [13, 23, 33])
            assert.deepStrictEqual(readP(fd, 'valueOf'), [14, 24, 34])
        })

        it('自有但不可列舉之鍵不算(檢核與使用皆只走自有可列舉之鍵, 同Object.keys): 該期沿用nm', async function() {
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }, { period: 'b', len: 2, xs: [1, 2, 3] }])
            let bp = { b: { avg: 2, std: 1 } }
            Object.defineProperty(bp, 'a', { value: { avg: 'bad', std: -1 }, enumerable: false }) //無效值亦不被檢核, 也不被使用
            let fd = fresh()
            await call(dealOf({ avg: 0, std: 10, byPeriod: bp }), kp, fd)
            assert.deepStrictEqual(readP(fd, 'a'), [1, 2, 3])
            assert.deepStrictEqual(readP(fd, 'b'), [-1, 0, 1])
        })

        it('輸入不被改寫: nm與byPeriod於呼叫前後深度相等; 凍結(Object.freeze)之輸入亦可', async function() {
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }, { period: 'b', len: 2, xs: [1, 2, 3] }])
            let nm = { avg: 1, std: 2, byPeriod: { a: { avg: 20, std: 10 } } }
            let copy = JSON.parse(JSON.stringify(nm))
            Object.freeze(nm.byPeriod.a)
            Object.freeze(nm.byPeriod)
            Object.freeze(nm)
            await call(dealOf(nm), kp, fresh())
            assert.deepStrictEqual(nm, copy)
        })

        it('多個deal各自獨立: 同一method兩個keyOut(X與Y)之byPeriod互不影響', async function() {
            let fd = fresh()
            let deals = [
                { keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: { a: { avg: 3, std: 1 }, c: { avg: 3500, std: 700 } } } },
                { keyOut: 'Y', nm: { avg: 0, std: 1 } },
            ]
            let rs = await call([{ method: 'syn', deals, optMethod: {} }], KP, fd)
            let rrs = await synCalc(ARR, 'none', {})
            let rawX = (p) => rrs.find((r) => r.period === p).vs.map((m) => m.X)
            let rawY = (p) => rrs.find((r) => r.period === p).vs.map((m) => m.Y)
            assert.deepStrictEqual(readPs(fd, 'a', 'X'), rawX('a').map((x) => (x - 3) / 1))
            assert.deepStrictEqual(readPs(fd, 'b', 'X'), rawX('b'))
            assert.deepStrictEqual(readPs(fd, 'c', 'X'), rawX('c').map((x) => (x - 3500) / 700))
            assert.deepStrictEqual(readPs(fd, 'a', 'Y'), rawY('a'))
            assert.deepStrictEqual(readPs(fd, 'c', 'Y'), rawY('c'))
            assert.deepStrictEqual(rs.map((r) => r.keyOut), ['X', 'Y'])
        })

        it('denyOutput為true時不寫檔, 回傳列與寫檔時相同', async function() {
            let nm = { avg: 3, std: 7, byPeriod: { a: { avg: 3, std: 1 }, b: { avg: -2, std: 25 } } }
            let methods = [{ method: 'syn', deals: [{ keyOut: 'X', nm }], optMethod: {} }]
            let fdW = fresh()
            let rW = await call(methods, KP, fdW)
            let fdD = fresh()
            let rD = await call(methods, KP, fdD, { denyOutput: true })
            assert.deepStrictEqual(fs.readdirSync(fdD), [])
            assert.ok(fs.readdirSync(fdW).length > 0)
            assert.deepStrictEqual(rD, rW)
        })

    })

    describe('D3 byPeriod之檢核(先於任何計算與寫檔, 訊息固定)', function() {

        let mkMethods = (bp) => [{ method: 'fx', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: bp } }], optMethod: {} }]

        //expectInvalid, 斷言以固定訊息reject、輸出夾為空、calc未被呼叫; 斷言訊息只含索引(輸入值可能無法讀取)
        let expectInvalid = async (methods, tag, opt = {}) => {
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            let err = null
            try {
                await call(methods, kp, fd, opt)
            }
            catch (e) {
                err = e
            }
            assert.ok(err !== null, `${tag} 應reject`)
            assert.strictEqual(err.message, MSG, `${tag} 訊息`)
            assert.deepStrictEqual(fs.readdirSync(fd), [], `${tag} 輸出夾須為空`)
            assert.strictEqual(st.calls, 0, `${tag} calc不得被呼叫`)
        }

        //revoked, 已撤銷之Proxy(任何讀取皆拋TypeError); 斷言只取訊息與計數, 不檢視此值(§6.3)
        let revoked = () => {
            let { proxy, revoke } = Proxy.revocable({}, {})
            revoke()
            return proxy
        }

        let BAD_CONTAINER = [
            ['字串', 'abc'], ['含機敏樣式之字串', 'sk-secret-7q9x'], ['空字串', ''], ['數值5', 5], ['數值0', 0], ['true', true], ['false', false],
            ['空陣列', []], ['陣列', [{ avg: 1, std: 1 }]], ['函數', () => ({})], ['Map', new Map([['a', { avg: 1, std: 1 }]])], ['Date', new Date(0)],
            ['NaN', NaN], ['Symbol', Symbol('s')], ['BigInt', 1n], ['已撤銷之Proxy', revoked()],
        ]
        BAD_CONTAINER.forEach(([tag, v], i) => {
            it(`byPeriod非物件[${i}: ${tag}] ⇒ reject固定訊息、夾為空、calc未被呼叫`, async function() {
                await expectInvalid(mkMethods(v), `container ${i}`)
            })
        })

        let BAD_ENTRY = [
            ['值為null', null], ['值為數值', 5], ['值為字串', 'x'], ['值為陣列', [1, 1]], ['值為空物件', {}], ['值為函數', () => ({ avg: 1, std: 1 })],
            ['值為帶avg與std之函數', Object.assign(() => {}, { avg: 1, std: 2 })], ['值為帶avg與std之陣列', Object.assign([], { avg: 1, std: 2 })], ['值為帶avg與std之Date', Object.assign(new Date(0), { avg: 1, std: 2 })],
            ['缺std', { avg: 1 }], ['缺avg', { std: 1 }],
            ['avg為NaN', { avg: NaN, std: 1 }], ['avg為Infinity', { avg: Infinity, std: 1 }], ['avg為-Infinity', { avg: -Infinity, std: 1 }],
            ['avg為數字字串', { avg: '1', std: 1 }], ['avg為BigInt', { avg: 1n, std: 1 }], ['avg為null', { avg: null, std: 1 }], ['avg為undefined', { avg: undefined, std: 1 }], ['avg為true', { avg: true, std: 1 }],
            ['std為0', { avg: 0, std: 0 }], ['std為-0', { avg: 0, std: -0 }], ['std為負', { avg: 0, std: -1 }], ['std為NaN', { avg: 0, std: NaN }], ['std為Infinity', { avg: 0, std: Infinity }],
            ['std為數字字串', { avg: 0, std: '1' }], ['std為BigInt', { avg: 0, std: 1n }], ['std為null', { avg: 0, std: null }], ['std為undefined', { avg: 0, std: undefined }], ['std為true', { avg: 0, std: true }],
            ['avg為含機敏樣式之字串', { avg: 'sk-secret-7q9x', std: 1 }],
            ['值為已撤銷之Proxy', revoked()],
        ]
        BAD_ENTRY.forEach(([tag, v], i) => {
            it(`byPeriod之值無效[${i}: ${tag}] ⇒ reject固定訊息、夾為空、calc未被呼叫`, async function() {
                await expectInvalid(mkMethods({ a: v }), `entry ${i}`)
                //其他期別有效而僅此一期無效時亦拒(檢核涵蓋每一個值, 不只第1個)
                await expectInvalid(mkMethods({ good: { avg: 0, std: 1 }, a: v }), `entry ${i} 第2個`)
                await expectInvalid(mkMethods({ a: v, good: { avg: 0, std: 1 } }), `entry ${i} 第1個`)
            })
        })

        it('讀取時拋錯之物件(getter拋錯、Proxy陷阱拋錯) ⇒ 視為無效而reject固定訊息(不洩漏拋出之訊息)、夾為空、calc未被呼叫', async function() {
            let thrower = () => {
                throw new Error('boom-secret')
            }
            let inValue = { a: {} }
            Object.defineProperty(inValue.a, 'avg', { enumerable: true, get: thrower })
            inValue.a.std = 1
            let inContainer = {}
            Object.defineProperty(inContainer, 'a', { enumerable: true, get: thrower })
            let proxy = new Proxy({ a: { avg: 0, std: 1 } }, { ownKeys: thrower })
            for (let [i, bp] of [inValue, inContainer, proxy].entries()) {
                let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
                let fd = fresh()
                await assert.rejects(call(mkMethods(bp), kp, fd), (e) => e.message === MSG, `案${i}`)
                assert.deepStrictEqual(fs.readdirSync(fd), [], `案${i}`)
                assert.strictEqual(st.calls, 0, `案${i}`)
            }
        })

        it('nm.byPeriod本身為讀取即拋錯之存取器 ⇒ 視為無效而reject固定訊息(不洩漏拋出之訊息)、夾為空、calc未被呼叫(讀取發生於檢核內, 不早於檢核)', async function() {
            let nm = { avg: 0, std: 1 }
            let thrower = () => {
                throw new Error('boom-secret')
            }
            Object.defineProperty(nm, 'byPeriod', { enumerable: true, get: thrower })
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            await assert.rejects(call(dealOf(nm), kp, fd), (e) => e.message === MSG)
            assert.deepStrictEqual(fs.readdirSync(fd), [])
            assert.strictEqual(st.calls, 0)
        })

        it('無效之byPeriod先於任何計算與寫檔: 第1個method有效、第2個method之deal無效 ⇒ 第1個method之檔亦不寫出, calc與funAddKeysIn皆未被呼叫', async function() {
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let kp2 = { ...kp, fy: kp.fx }
            let adds = 0
            let fd = fresh()
            let methods = [
                { method: 'fx', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1 } }], optMethod: {} },
                { method: 'fy', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1 } }, { keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: { a: { avg: 0, std: 0 } } } }], optMethod: {} },
            ]
            let funAddKeysIn = (v) => {
                adds++
                return v
            }
            await assert.rejects(call(methods, kp2, fd, { funAddKeysIn }), { message: MSG })
            assert.deepStrictEqual(fs.readdirSync(fd), [])
            assert.strictEqual(st.calls, 0)
            assert.strictEqual(adds, 0)
        })

        it('denyOutput為true時亦先檢核(calc未被呼叫)', async function() {
            await expectInvalid(mkMethods('x'), 'denyOutput', { denyOutput: true })
        })

        it('同時有其他檢核失敗時, 各檢核之優先順序: nm非物件之訊息(invalid deal.nm: must be a non-empty object)先於byPeriod之檢核(同一deal)', async function() {
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            //行為改變(第688項): 訊息改為固定詞彙(原為`invalid deal.nm[x]`, 方括號內為輸入值), 且不再以console輸出輸入(原需靜音)
            let logs = []
            let org = console.log
            console.log = (...a) => {
                logs.push(a)
            }
            try {
                await assert.rejects(call(dealOf('x'), kp, fd), { message: 'invalid deal.nm: must be a non-empty object' })
            }
            finally {
                console.log = org
            }
            assert.strictEqual(logs.length, 0, '不得以console輸出')
            assert.strictEqual(st.calls, 0)
        })

        it('deal.keyIn有指定而不在keysIn內者不處理故不檢核byPeriod(無效亦不拒); 在keysIn內者照檢核', async function() {
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            let deals = [
                { keyIn: 'Open', keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: 'bad' } },
                { keyOut: 'X', nm: { avg: 0, std: 1 } },
            ]
            let rs = await call([{ method: 'fx', deals, optMethod: {} }], kp, fd)
            assert.strictEqual(rs.length, 1)
            assert.strictEqual(st.calls, 1)
            assert.deepStrictEqual(fs.readdirSync(fd), ['price_ohlc_none_X_fx_a.json'])
            //keysIn內
            let m2 = [{ method: 'fx', deals: [{ keyIn: 'none', keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: 'bad' } }], optMethod: {} }]
            await expectInvalid(m2, 'keyIn在keysIn內')
        })

        it('有效之邊界值: avg為0、負數、極大; std為極小之正數、極大; 物件含額外欄位; 無原型之物件; 皆可通過', async function() {
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let np = Object.create(null)
            np.a = { avg: -5, std: 1e-300 }
            for (let [i, bp] of [{ a: { avg: 0, std: 1e300 } }, { a: { avg: -1e300, std: 5, extra: 'x' } }, np, { a: Object.create(null) }].entries()) {
                if (i === 3) {
                    bp.a.avg = 1
                    bp.a.std = 2
                }
                let fd = fresh()
                let rs = await call(dealOf({ avg: 0, std: 1, byPeriod: bp }), kp, fd)
                assert.strictEqual(rs.length, 1, `案${i}`)
                assert.strictEqual(readP(fd, 'a').length, 3, `案${i}`)
            }
        })

    })

    describe('D4 回傳列之n、median、q25、q75與periods', function() {

        it('分位數(第7型)之手算例: 排序後h = (n - 1) × q, x[⌊h⌋] + (h − ⌊h⌋) × (x[⌊h⌋ + 1] − x[⌊h⌋]); 輸入無須已排序', async function() {
            let cases = [
                //[xs, median, q25, q75]
                [[4, 1, 3, 2], 2.5, 1.75, 3.25],
                [[1, 2, 3, 4, 5], 3, 2, 4],
                [[10, 20], 15, 12.5, 17.5],
                [[5], 5, 5, 5],
                [[-3, -1, 9], -1, -2, 4],
                [[7, 7, 7, 7], 7, 7, 7],
                [[100, -100, 0, 50, -50, 25], 12.5, -37.5, 43.75],
            ]
            let { kp } = fixedCalc(cases.map((c, i) => ({ period: `p${i}`, len: i + 1, xs: c[0] })))
            let rs = await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true })
            cases.forEach((c, i) => {
                let p = rs[0].periods[i]
                assert.deepStrictEqual([p.median, p.q25, p.q75, p.n], [c[1], c[2], c[3], c[0].length], `案${i}`)
            })
            //各案各自成一期; 單獨攤平(全期)之手算例: 只有一期時攤平 = 該期
            for (let [i, c] of cases.entries()) {
                let { kp: kp1 } = fixedCalc([{ period: 'p', len: 1, xs: c[0] }])
                let r = (await call(dealOf({ avg: 0, std: 1 }), kp1, fresh(), { denyOutput: true }))[0]
                assert.deepStrictEqual([r.median, r.q25, r.q75, r.n], [c[1], c[2], c[3], c[0].length], `攤平案${i}`)
            }
        })

        it('n為0之期(vs為空、或值皆為非有限: NaN、±Infinity): n為0且其餘統計欄皆為null; 該期不影響攤平之統計; 整體皆無有限值時攤平亦n為0且各統計為null', async function() {
            let { kp } = fixedCalc([
                { period: 'e0', len: 1, xs: [] },
                { period: 'nan', len: 2, xs: [NaN, NaN] },
                { period: 'inf', len: 4, xs: [Infinity, -Infinity, NaN, Infinity] },
                { period: 'ok', len: 3, xs: [2, 4, 6] },
            ])
            let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
            let nul = { n: 0, avg: null, std: null, min: null, max: null, median: null, q25: null, q75: null }
            assert.deepStrictEqual(r.periods[0], { period: 'e0', len: 1, ...nul })
            assert.deepStrictEqual(r.periods[1], { period: 'nan', len: 2, ...nul })
            assert.deepStrictEqual(r.periods[2], { period: 'inf', len: 4, ...nul })
            assert.deepStrictEqual([r.periods[3].n, r.periods[3].avg, r.periods[3].median, r.periods[3].q25, r.periods[3].q75, r.periods[3].min, r.periods[3].max], [3, 4, 4, 3, 5, 2, 6])
            assert.deepStrictEqual([r.n, r.avg, r.median, r.q25, r.q75, r.min, r.max], [3, 4, 4, 3, 5, 2, 6])
            //整體皆無有限值(空、NaN、±Infinity各種組合): 回傳列之n為0, 其餘統計(含min與max)皆為null
            let sets = [[{ period: 'e0', len: 1, xs: [] }], [{ period: 'n', len: 1, xs: [NaN] }], [{ period: 'i', len: 1, xs: [Infinity, -Infinity] }], [{ period: 'a', len: 1, xs: [] }, { period: 'b', len: 2, xs: [NaN, Infinity] }]]
            for (let [i, set] of sets.entries()) {
                let { kp: kp0 } = fixedCalc(set)
                let r0 = (await call(dealOf({ avg: 0, std: 1 }), kp0, fresh(), { denyOutput: true }))[0]
                assert.deepStrictEqual([r0.n, r0.avg, r0.std, r0.min, r0.max, r0.median, r0.q25, r0.q75], [0, null, null, null, null, null, null, null], `整體皆無有限值案${i}`)
                assert.deepStrictEqual(r0.periods, set.map((p) => ({ period: p.period, len: p.len, ...nul })), `整體皆無有限值案${i} periods`)
            }
        })

        it('含±Infinity與NaN之期: 該期與攤平之統計(n、avg、std、min、max、median、q25、q75)等於去除非有限值後之統計; 非有限值不計入n', async function() {
            let I = Infinity
            //各值逐筆相異; 去除非有限值後各期之個數為4、2、4、5(含一期無非有限值之對照)
            let raw = [
                { period: 'pA', len: 1, xs: [7, I, 2.5, -I, 11, NaN, -4, I] },
                { period: 'pB', len: 2, xs: [I, 3, 9] },
                { period: 'pC', len: 3, xs: [-I, 1.5, 6, 8.25, 20] },
                { period: 'pD', len: 4, xs: [5, 13, 21, 34, 55] },
            ]
            let fin = raw.map((p) => ({ ...p, xs: p.xs.filter((x) => Number.isFinite(x)) }))
            //前提(§6.2第6點): 只排除NaN之基準與只取有限值之基準之個數不同(且分位數不同), 否則取錯基準測不到
            assert.deepStrictEqual(raw.map((p) => p.xs.filter((x) => !Number.isNaN(x)).length), [7, 3, 5, 5])
            assert.deepStrictEqual(fin.map((p) => p.xs.length), [4, 2, 4, 5])
            let { kp } = fixedCalc(raw)
            let { kp: kpF } = fixedCalc(fin)
            let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
            let rf = (await call(dealOf({ avg: 0, std: 1 }), kpF, fresh(), { denyOutput: true }))[0]
            //等於去除非有限值後之統計(整個回傳列逐欄相同, 含periods)
            assert.deepStrictEqual(r, rf)
            //手算(pA排序後[-4, 2.5, 7, 11]): n 4, avg 4.125, min -4, max 11, median h = 1.5 → 4.75, q25 h = 0.75 → 0.875, q75 h = 2.25 → 8
            let pA = r.periods[0]
            assert.deepStrictEqual([pA.n, pA.avg, pA.min, pA.max, pA.median, pA.q25, pA.q75], [4, 4.125, -4, 11, 4.75, 0.875, 8])
            assertNear(pA.std, Math.sqrt(41.395833333333336), 1e-12)
            //pB: 只剩[3, 9]
            assert.deepStrictEqual([r.periods[1].n, r.periods[1].avg, r.periods[1].min, r.periods[1].max, r.periods[1].median, r.periods[1].q25, r.periods[1].q75], [2, 6, 3, 9, 6, 4.5, 7.5])
            //另寫之暴力計算(各期與攤平)
            let flat = []
            for (let [k, p] of raw.entries()) {
                assertStat(r.periods[k], brute(p.xs), `期別${p.period}`)
                flat.push(...p.xs)
            }
            assertStat({ n: r.n, avg: r.avg, std: r.std, min: r.min, max: r.max, median: r.median, q25: r.q25, q75: r.q75 }, brute(flat), '攤平')
            //回傳列之n為各期之n之和; 有限值皆為真實之有限數(min、max不為±Infinity)
            assert.strictEqual(r.n, r.periods.reduce((s, p) => s + p.n, 0))
            assert.strictEqual(r.n, 15)
            assert.ok(Number.isFinite(r.min) && Number.isFinite(r.max) && Number.isFinite(r.avg) && Number.isFinite(r.std), '回傳列之avg、std、min、max皆為有限數值')
            assert.deepStrictEqual([r.min, r.max], [-4, 55])
        })

        it('含±Infinity之各種排列: 位於最前、最後、連續、各一個或單獨一個有限值時, 皆等於去除非有限值後之統計(單一有限值: n為1, 分位數與min、max皆為該值, std為null)', async function() {
            let I = Infinity
            let cases = [
                [-I, 1, 2, 3], //最前之-Infinity
                [1, 2, 3, I], //最後之Infinity
                [-I, -I, 4, 5, 6, I, I], //兩端連續
                [10, I, 20, -I, 30, I, 40], //交錯
                [-I, 8, I], //單一有限值
                [I, 9], //單一有限值, 另一端
                [-I, 12.5, NaN, I], //單一有限值, 含NaN
            ]
            let { kp } = fixedCalc(cases.map((xs, i) => ({ period: `p${i}`, len: i + 1, xs })))
            let { kp: kpF } = fixedCalc(cases.map((xs, i) => ({ period: `p${i}`, len: i + 1, xs: xs.filter((x) => Number.isFinite(x)) })))
            let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
            let rf = (await call(dealOf({ avg: 0, std: 1 }), kpF, fresh(), { denyOutput: true }))[0]
            assert.deepStrictEqual(r, rf)
            for (let i of [4, 5, 6]) {
                let p = r.periods[i]
                assert.deepStrictEqual([p.n, p.std, p.avg === p.min, p.min === p.max, p.median === p.min, p.q25 === p.min, p.q75 === p.min], [1, null, true, true, true, true, true], `單一有限值案${i}`)
                assert.ok(Number.isFinite(p.min), `單一有限值案${i}之值為有限`)
            }
            //每一期各自單獨呼叫(攤平即該期)亦同
            for (let [i, xs] of cases.entries()) {
                let { kp: kp1 } = fixedCalc([{ period: 'p', len: 1, xs }])
                let { kp: kp1F } = fixedCalc([{ period: 'p', len: 1, xs: xs.filter((x) => Number.isFinite(x)) }])
                let a = (await call(dealOf({ avg: 0, std: 1 }), kp1, fresh(), { denyOutput: true }))[0]
                let b = (await call(dealOf({ avg: 0, std: 1 }), kp1F, fresh(), { denyOutput: true }))[0]
                assert.deepStrictEqual(a, b, `單獨呼叫案${i}`)
            }
        })

        it('正規化本身不變: 非有限值照常逐值寫出(JSON內為null), 只是統計不計入; nm.std極小使有限之原值正規化後溢位為±Infinity者, 亦不計入統計', async function() {
            //(值 - avg) ÷ std, avg 1、std 2: [0, Inf, -Inf, NaN, 2, 4]; JSON內非有限值為null
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [1, Infinity, -Infinity, NaN, 5, 9] }])
            let fd = fresh()
            let r = (await call(dealOf({ avg: 1, std: 2 }), kp, fd))[0]
            assert.deepStrictEqual(readP(fd, 'a'), [0, null, null, null, 2, 4])
            assert.deepStrictEqual([r.periods[0].n, r.periods[0].avg, r.periods[0].min, r.periods[0].max, r.periods[0].median], [3, 2, 0, 4, 2])
            assert.deepStrictEqual([r.n, r.avg, r.min, r.max, r.median, r.q25, r.q75], [3, 2, 0, 4, 2, 1, 3])
            //nm.std極小: 有限之原值除以std溢位為±Infinity(正規化之既有行為), 統計只取其餘之有限值
            let std = 1e-307
            let xs = [1e-300, 2e-300, 20, 3e-300, -50]
            let ys = xs.map((x) => (x - 0) / std)
            assert.deepStrictEqual(ys.map((y) => Number.isFinite(y)), [true, true, false, true, false], '前提: 20與-50正規化後溢位')
            let { kp: kp2 } = fixedCalc([{ period: 'b', len: 1, xs }])
            let fd2 = fresh()
            let r2 = (await call(dealOf({ avg: 0, std }), kp2, fd2))[0]
            assert.deepStrictEqual(readP(fd2, 'b'), ys.map((y) => (Number.isFinite(y) ? y : null)))
            assertStat(r2.periods[0], brute(ys), '溢位之期')
            assert.deepStrictEqual([r2.n, r2.periods[0].n], [3, 3])
            assert.deepStrictEqual([r2.min, r2.max], [Math.min(ys[0], ys[1], ys[3]), Math.max(ys[0], ys[1], ys[3])])
        })

        it('有限資料下回傳列之min與max同既有(取原順序中之極值, 平手時取先出現者: 0與-0之平手保留符號), 不因統計只取有限值而改變', async function() {
            let cases = [
                [[0, -0], 0, 0], //平手: min、max皆取先出現之0
                [[-0, 0], -0, -0], //平手: 皆取先出現之-0
                [[3, 0, -0, 7], 0, 7],
                [[3, -0, 0, 7], -0, 7],
            ]
            for (let [i, c] of cases.entries()) {
                let { kp } = fixedCalc([{ period: 'z', len: 1, xs: c[0] }])
                let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
                assert.ok(Object.is(r.min, c[1]), `案${i} min`)
                assert.ok(Object.is(r.max, c[2]), `案${i} max`)
            }
        })

        it('空序列(n為0)時回傳列之avg、std、min、max皆為null(與新增之分位數及periods內該期之各統計欄一致; min與max原為undefined, 改為null)', async function() {
            let { kp } = fixedCalc([{ period: 'e0', len: 1, xs: [] }, { period: 'nan', len: 2, xs: [NaN] }])
            let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
            assert.strictEqual(r.avg, null)
            assert.strictEqual(r.std, null)
            assert.strictEqual(r.min, null)
            assert.strictEqual(r.max, null)
            assert.strictEqual(r.n, 0)
            assert.ok(Object.prototype.hasOwnProperty.call(r, 'min') && Object.prototype.hasOwnProperty.call(r, 'max'), 'min與max仍為回傳列之鍵')
            assert.strictEqual(r.periods[0].min, null)
            assert.strictEqual(r.periods[1].max, null)
        })

        it('n為1之期: 分位數與中位數皆為該值, std為null(同arrStd)', async function() {
            let { kp } = fixedCalc([{ period: 'one', len: 1, xs: [8] }])
            let r = (await call(dealOf({ avg: 2, std: 3 }), kp, fresh(), { denyOutput: true }))[0]
            assert.deepStrictEqual(r.periods[0], { period: 'one', len: 1, n: 1, avg: 2, std: null, min: 2, max: 2, median: 2, q25: 2, q75: 2 })
        })

        it('NaN不計入n與各統計(同arrAverage與arrStd只取有限數值); 其餘值照計', async function() {
            let { kp } = fixedCalc([{ period: 'm', len: 1, xs: [1, NaN, 3, NaN] }])
            let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
            let p = r.periods[0]
            assert.deepStrictEqual([p.n, p.avg, p.min, p.max, p.median, p.q25, p.q75], [2, 2, 1, 3, 2, 1.5, 2.5])
            assertNear(p.std, Math.SQRT2, 1e-12)
            assert.strictEqual(r.n, 2)
        })

        it('n與avg、std取用之母體相同(有限數值): n等於arrAverage與arrStd所計之個數, 以平均反推 ⇒ 含±Infinity時avg、std仍為有限且與只取有限值者相同', async function() {
            let xs = [4, Infinity, 8, 15, -Infinity, 16, 23, 42, NaN]
            let { kp } = fixedCalc([{ period: 'm', len: 1, xs }])
            let r = (await call(dealOf({ avg: 0, std: 1 }), kp, fresh(), { denyOutput: true }))[0]
            let p = r.periods[0]
            assert.strictEqual(p.n, 6)
            assertNear(p.avg, (4 + 8 + 15 + 16 + 23 + 42) / 6, 1e-12)
            assert.deepStrictEqual([r.n, r.avg, r.std], [p.n, p.avg, p.std])
            assert.ok(Number.isFinite(p.avg) && Number.isFinite(p.std), 'avg與std為有限數值(不因Infinity而異常)')
        })

        //行為改變(第688項): 原案以nm之avg與std為BigInt(0n、1n)使BigInt之值可相減, 驗BigInt不計入統計; nm.avg、nm.std現只收有限數值(typeof為number), BigInt即reject(見D7), 該案不再可能成立而刪除
        //  BigInt不計入統計(同arrAverage與arrStd只取有限數值)由arrFilterByENum之母體限定所保證, 見上〈n與avg、std取用之母體相同〉與〈含±Infinity與NaN之期〉等案

        it('合成資料(各期尺度相差逾100倍、含重尾與0根、1根之期)之periods與攤平之n、median、q25、q75皆等於另寫之暴力計算(含avg、std、min、max), 於未正規化與正規化兩種nm下', async function() {
            let rrs = await synCalc(ARR, 'none', {})
            for (let nm of [{ avg: 0, std: 1 }, { avg: 3, std: 7 }, { avg: -50, std: 0.25, byPeriod: { a: { avg: 3, std: 2 }, c: { avg: 3500, std: 700 }, e: { avg: 9, std: 3 } } }]) {
                let r = (await call([{ method: 'syn', deals: [{ keyOut: 'X', nm }], optMethod: {} }], KP, fresh(), { denyOutput: true }))[0]
                let flat = []
                assert.deepStrictEqual(r.periods.map((p) => [p.period, p.len]), SYN_PERIODS.map((p) => [p.period, p.len]))
                for (let [k, rr] of rrs.entries()) {
                    let own = nm.byPeriod && Object.prototype.hasOwnProperty.call(nm.byPeriod, rr.period) ? nm.byPeriod[rr.period] : nm
                    let xs = rr.vs.map((m) => (m.X - own.avg) / own.std)
                    flat.push(...xs)
                    assertStat(r.periods[k], brute(xs), `期別${rr.period}`)
                }
                let bf = brute(flat)
                assertStat({ n: r.n, avg: r.avg, std: r.std, min: r.min, max: r.max, median: r.median, q25: r.q25, q75: r.q75 }, bf, '攤平')
            }
        })

        it('真實calc(vec, 各期尺度隨根數而異)之periods與攤平之統計等於暴力計算, 且各期尺度相差逾3倍', async function() {
            let arr = genOhlc(600)
            let calcs = { vec: KP.vec }
            let r = (await dataConvert('t', 'SYM', '4hr', 'price', 'ohlc', [{ method: 'vec', deals: [{ keyOut: 'param', nm: { avg: 0, std: 1 } }], optMethod: {} }], arr, calcs, 'unused', { denyOutput: true, keysIn: ['Close'] }))[0]
            let rrs = await KP.vec(arr, 'Close', {})
            let flat = []
            for (let [k, rr] of rrs.entries()) {
                let xs = rr.vs.map((m) => m.param)
                flat.push(...xs)
                assertStat(r.periods[k], brute(xs), `vec 期別${rr.period}`)
                assert.strictEqual(r.periods[k].len, rr.len)
            }
            assertStat({ n: r.n, avg: r.avg, std: r.std, min: r.min, max: r.max, median: r.median, q25: r.q25, q75: r.q75 }, brute(flat), 'vec 攤平')
            let stds = r.periods.map((p) => p.std)
            assert.ok(Math.max(...stds) / Math.min(...stds) > 3, '前提: 各期尺度須明顯不同')
        })

    })

    describe('D5 往返: 以各期之統計組成byPeriod重跑', function() {

        //byPeriodOf, 取各期之統計(nm = {0,1}、denyOutput)後, 以pick(period統計) 組成byPeriod(只收n至少2且std大於0者)
        let roundTrip = async (methodsFn, kp, arr, pick, optX = {}) => {
            let rs0 = await dataConvert('t', 'SYM', '4hr', 'price', 'ohlc', methodsFn({ avg: 0, std: 1 }), arr, kp, 'unused', { denyOutput: true, ...optX })
            let bps = rs0.map((r) => {
                let bp = {}
                for (let p of r.periods) {
                    if (p.n >= 2 && p.std > 0) {
                        bp[p.period] = pick(p)
                    }
                }
                return bp
            })
            let fd = fresh()
            let rs1 = await dataConvert('t', 'SYM', '4hr', 'price', 'ohlc', methodsFn(null, bps), arr, kp, fd, optX)
            return { rs0, rs1, bps, fd }
        }

        let ms = (nm, bps) => [{ method: 'syn', deals: ['X', 'Y'].map((keyOut, j) => ({ keyOut, nm: nm || { avg: 0, std: 1, byPeriod: bps[j] } })), optMethod: {} }]

        it('平均與標準差: 各期輸出之平均約0、標準差約1(容差1e-9); n不足2之期(0根與1根)不在byPeriod而沿用nm(原值)', async function() {
            let { rs0, rs1, bps, fd } = await roundTrip(ms, KP, ARR, (p) => ({ avg: p.avg, std: p.std }), { keysIn: ['none'] })
            assert.deepStrictEqual(Object.keys(bps[0]), ['a', 'b', 'c'])
            let rrs = await synCalc(ARR, 'none', {})
            for (let [j, keyOut] of ['X', 'Y'].entries()) {
                for (let p of ['a', 'b', 'c']) {
                    let ps = readPs(fd, p, keyOut)
                    let b = brute(ps)
                    assertNear(b.avg, 0, 1e-9, `${keyOut} ${p} 平均`)
                    assertNear(b.std, 1, 1e-9, `${keyOut} ${p} 標準差`)
                    let st1 = rs1[j].periods.find((v) => v.period === p)
                    assertNear(st1.avg, 0, 1e-9, `${keyOut} ${p} 回傳之平均`)
                    assertNear(st1.std, 1, 1e-9, `${keyOut} ${p} 回傳之標準差`)
                }
                //1根之期(e): 沿用nm = {0,1}, 輸出同原值
                assert.deepStrictEqual(readPs(fd, 'e', keyOut), rrs.find((r) => r.period === 'e').vs.map((m) => m[keyOut]))
            }
            assert.ok(rs0.length === 2 && rs1.length === 2)
        })

        it('中位數與四分位距: byPeriod之avg為中位數、std為(q75 − q25) ÷ 1.349 ⇒ 各期輸出之中位數約0、四分位距約1.349', async function() {
            let { fd, rs1 } = await roundTrip(ms, KP, ARR, (p) => ({ avg: p.median, std: (p.q75 - p.q25) / 1.349 }), { keysIn: ['none'] })
            for (let keyOut of ['X', 'Y']) {
                for (let p of ['a', 'b', 'c']) {
                    let ps = readPs(fd, p, keyOut)
                    let b = brute(ps)
                    assertNear(b.median, 0, 1e-9, `${keyOut} ${p} 中位數`)
                    assertNear(b.q75 - b.q25, 1.349, 1e-9, `${keyOut} ${p} 四分位距`)
                }
            }
            for (let st1 of rs1[0].periods.filter((v) => ['a', 'b', 'c'].includes(v.period))) {
                assertNear(st1.median, 0, 1e-9, `回傳之中位數 ${st1.period}`)
                assertNear(st1.q75 - st1.q25, 1.349, 1e-9, `回傳之四分位距 ${st1.period}`)
            }
        })

        it('真實calc(vec): 往返後各期之平均約0、標準差約1; 未依期別時攤平之標準差遠離1(各期尺度不同時)', async function() {
            let arr = genOhlc(600)
            let vecM = (nm, bps) => [{ method: 'vec', deals: [{ keyOut: 'param', nm: nm || { avg: 0, std: 1, byPeriod: bps[0] } }], optMethod: {} }]
            let { rs0, rs1, bps } = await roundTrip(vecM, { vec: KP.vec }, arr, (p) => ({ avg: p.avg, std: p.std }), { keysIn: ['Close'] })
            assert.strictEqual(Object.keys(bps[0]).length, rs0[0].periods.length, '各期皆收入(資料充足)')
            for (let p of rs1[0].periods) {
                assertNear(p.avg, 0, 1e-9, `vec ${p.period} 平均`)
                assertNear(p.std, 1, 1e-9, `vec ${p.period} 標準差`)
            }
            assert.ok(Math.abs(rs0[0].std - 1) > 0.1, '前提: 未依期別時攤平之標準差遠離1(此為依期別各自正規化之動機)')
        })

    })

    describe('D6 檢測之值即使用之值(dspec〈輸入參數之檢測機制〉K4、V11): byPeriod之各鍵與各值於檢核時只讀取一次, 其後正規化只用該快照', function() {

        //flipEntry, { avg, std }之存取器: 第1次讀取回傳first之值, 其後回傳later之值; reads記各自之讀取次數
        let flipEntry = (first, later) => {
            let reads = { avg: 0, std: 0 }
            let e = {}
            Object.defineProperty(e, 'avg', { enumerable: true, get: () => (reads.avg++ === 0 ? first.avg : later.avg) })
            Object.defineProperty(e, 'std', { enumerable: true, get: () => (reads.std++ === 0 ? first.std : later.std) })
            return { e, reads }
        }

        let readK = (fd, keyIn, period) => JSON.parse(fs.readFileSync(`${fd}price_ohlc_${keyIn}_X_fx_${period}.json`, 'utf8')).map((v) => v.param)

        it('值之存取器第1次讀取有效、其後無效 ⇒ 通過檢核且輸出用第1次讀得之值; 兩個keyIn與兩個method共用同一deals之全程, avg與std各只讀取1次', async function() {
            let { e, reads } = flipEntry({ avg: 20, std: 10 }, { avg: 'bad', std: -1 })
            let deals = [{ keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: { a: e } } }]
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }])
            let fd = fresh()
            let rs = await call([{ method: 'fx', deals, optMethod: {} }, { method: 'fx', deals, optMethod: {} }], kp, fd, { keysIn: ['none', 'Open'] })
            assert.strictEqual(rs.length, 4)
            assert.deepStrictEqual(readK(fd, 'none', 'a'), [-1, 0, 1])
            assert.deepStrictEqual(readK(fd, 'Open', 'a'), [-1, 0, 1])
            for (let r of rs) {
                assert.deepStrictEqual([r.periods[0].avg, r.periods[0].median, r.periods[0].min, r.periods[0].max], [0, 0, -1, 1])
            }
            assert.deepStrictEqual(reads, { avg: 1, std: 1 })
        })

        it('值之存取器第1次讀取無效、其後有效 ⇒ 以第1次讀得之值判定而reject固定訊息(夾為空、calc未被呼叫)', async function() {
            let { e, reads } = flipEntry({ avg: NaN, std: 1 }, { avg: 0, std: 1 })
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            await assert.rejects(call(dealOf({ avg: 0, std: 1, byPeriod: { a: e } }), kp, fd), (err) => err.message === MSG)
            assert.deepStrictEqual(fs.readdirSync(fd), [])
            assert.strictEqual(st.calls, 0)
            assert.deepStrictEqual(reads, { avg: 1, std: 1 })
        })

        it('nm.byPeriod本身之存取器第1次讀取為有效之物件、其後為無效之值 ⇒ 輸出用第1次讀得者, 只讀取1次', async function() {
            let reads = 0
            let nm = { avg: 0, std: 1 }
            Object.defineProperty(nm, 'byPeriod', { enumerable: true, get: () => (reads++ === 0 ? { a: { avg: 20, std: 10 } } : 'bad') })
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }])
            let fd = fresh()
            await call(dealOf(nm), kp, fd)
            assert.deepStrictEqual(readP(fd, 'a'), [-1, 0, 1])
            assert.strictEqual(reads, 1)
        })

        it('Proxy之byPeriod: 走訪鍵(ownKeys)只1次、各鍵之值只讀取1次(含兩個keyIn之全程)', async function() {
            let ownKeys = 0
            let gets = {}
            let target = { a: { avg: 20, std: 10 }, b: { avg: 2, std: 1 } }
            let proxy = new Proxy(target, {
                ownKeys: (t) => {
                    ownKeys++
                    return Reflect.ownKeys(t)
                },
                get: (t, k) => {
                    gets[String(k)] = (gets[String(k)] || 0) + 1
                    return Reflect.get(t, k)
                },
            })
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }, { period: 'b', len: 2, xs: [1, 2, 3] }])
            let fd = fresh()
            await call(dealOf({ avg: 0, std: 1, byPeriod: proxy }), kp, fd, { keysIn: ['none', 'Open'] })
            assert.deepStrictEqual(readK(fd, 'Open', 'a'), [-1, 0, 1])
            assert.deepStrictEqual(readK(fd, 'Open', 'b'), [-1, 0, 1])
            assert.strictEqual(ownKeys, 1)
            assert.strictEqual(gets.a, 1)
            assert.strictEqual(gets.b, 1)
        })

        it('檢核之後(funAddKeysIn與calc執行時)改動byPeriod(改值、刪鍵、增鍵) ⇒ 輸出仍用檢核時讀得之值: 有鍵之期別不變、未有鍵之期別沿用nm', async function() {
            let bp = { a: { avg: 20, std: 10 }, b: { avg: 2, std: 1 } }
            let mutate = () => {
                bp.a.avg = 1e6
                bp.a.std = -5
                delete bp.b
                bp.c = { avg: 0, std: 100 }
            }
            let { kp: kp0 } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }, { period: 'b', len: 2, xs: [1, 2, 3] }, { period: 'c', len: 3, xs: [7, 8, 9] }])
            let kp = {
                fx: async (...args) => {
                    mutate()
                    return kp0.fx(...args)
                },
            }
            let funAddKeysIn = (v) => {
                mutate()
                return v
            }
            let fd = fresh()
            await call(dealOf({ avg: 0, std: 1, byPeriod: bp }), kp, fd, { funAddKeysIn })
            assert.deepStrictEqual(readP(fd, 'a'), [-1, 0, 1])
            assert.deepStrictEqual(readP(fd, 'b'), [-1, 0, 1])
            assert.deepStrictEqual(readP(fd, 'c'), [7, 8, 9])
        })

    })

    describe('D7 nm.avg與nm.std之檢核(第688項; 先於任何計算與寫檔, 訊息固定; 未給時行為不變)', function() {

        let MSG_AVG = 'invalid deal.nm.avg: must be a finite number'
        let MSG_STD = 'invalid deal.nm.std: must be a finite number greater than 0'

        //revoked, 已撤銷之Proxy(任何讀取皆拋TypeError); 斷言只取訊息與計數, 不檢視此值(§6.3)
        let revoked = () => {
            let { proxy, revoke } = Proxy.revocable({}, {})
            revoke()
            return proxy
        }

        //expectMsg, 斷言以指定之固定訊息reject、輸出夾為空、calc未被呼叫、未以console輸出
        let expectMsg = async (methods, msg, tag, opt = {}) => {
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            let err = null
            let n = 0
            let names = ['log', 'warn', 'error', 'info', 'debug']
            let orgs = {}
            names.forEach((k) => {
                orgs[k] = console[k]
                console[k] = () => {
                    n++
                }
            })
            try {
                await call(methods, kp, fd, opt)
            }
            catch (e) {
                err = e
            }
            finally {
                names.forEach((k) => {
                    console[k] = orgs[k]
                })
            }
            assert.ok(err !== null, `${tag} 應reject`)
            assert.ok(err.message === msg, `${tag} 訊息(實際 ${err.message})`)
            assert.deepStrictEqual(fs.readdirSync(fd), [], `${tag} 輸出夾須為空`)
            assert.strictEqual(st.calls, 0, `${tag} calc不得被呼叫`)
            assert.strictEqual(n, 0, `${tag} 不得以console輸出`)
        }

        let BAD_AVG = [
            ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['數字字串', '1'], ['含機敏樣式之字串', 'sk-secret-7q9x'], ['空字串', ''], ['BigInt', 1n],
            ['true', true], ['false', false], ['空陣列', []], ['陣列', [1]], ['物件', {}], ['包裝物件', Object(1)], ['函數', () => 1], ['Symbol', Symbol('s')], ['已撤銷之Proxy', revoked()],
        ]
        BAD_AVG.forEach(([tag, v], i) => {
            it(`nm.avg無效[${i}: ${tag}] ⇒ reject固定訊息、夾為空、calc未被呼叫、不以console輸出`, async function() {
                await expectMsg(dealOf({ avg: v, std: 1 }), MSG_AVG, `avg ${i}`)
                //std未給時亦拒
                await expectMsg(dealOf({ avg: v }), MSG_AVG, `avg ${i} 無std`)
            })
        })

        let BAD_STD = [
            ['0', 0], ['-0', -0], ['負數', -1], ['極小負數', -1e-300], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['數字字串', '1'], ['含機敏樣式之字串', 'sk-secret-7q9x'], ['空字串', ''], ['BigInt', 1n],
            ['true', true], ['false', false], ['空陣列', []], ['陣列', [1]], ['物件', {}], ['包裝物件', Object(1)], ['函數', () => 1], ['Symbol', Symbol('s')], ['已撤銷之Proxy', revoked()],
        ]
        BAD_STD.forEach(([tag, v], i) => {
            it(`nm.std無效[${i}: ${tag}] ⇒ reject固定訊息、夾為空、calc未被呼叫、不以console輸出`, async function() {
                await expectMsg(dealOf({ avg: 0, std: v }), MSG_STD, `std ${i}`)
                await expectMsg(dealOf({ std: v }), MSG_STD, `std ${i} 無avg`)
            })
        })

        it('同時有多項無效: nm.avg之訊息先於nm.std, nm.std先於nm.byPeriod; nm非物件之訊息先於三者', async function() {
            await expectMsg(dealOf({ avg: 'x', std: 'y', byPeriod: 5 }), MSG_AVG, 'avg先於std與byPeriod')
            await expectMsg(dealOf({ avg: 0, std: 'y', byPeriod: 5 }), MSG_STD, 'std先於byPeriod')
            await expectMsg(dealOf({ avg: 0, std: 1, byPeriod: 5 }), MSG, 'byPeriod')
            await expectMsg(dealOf('x'), 'invalid deal.nm: must be a non-empty object', 'nm非物件')
        })

        it('讀取拋錯之nm.avg、nm.std(存取器、Proxy陷阱) ⇒ 視為無效而reject各自之固定訊息(不洩漏拋出之訊息)', async function() {
            let thrower = () => {
                throw new Error('boom-secret')
            }
            let nmA = { std: 1 }
            Object.defineProperty(nmA, 'avg', { enumerable: true, get: thrower })
            let nmS = { avg: 0 }
            Object.defineProperty(nmS, 'std', { enumerable: true, get: thrower })
            await expectMsg(dealOf(nmA), MSG_AVG, 'avg存取器')
            await expectMsg(dealOf(nmS), MSG_STD, 'std存取器')
            //nm本身為讀取即拋錯之Proxy: 無法判定為非空物件, 同為無效(固定訊息, 不洩漏拋出之訊息)
            let px = new Proxy({ avg: 0, std: 1 }, { get: thrower })
            await expectMsg(dealOf(px), 'invalid deal.nm: must be a non-empty object', 'Proxy get陷阱')
        })

        it('給了而無效之檢核先於任何計算與寫檔: 第1個method有效、第2個method之deal之nm.avg或nm.std無效 ⇒ 第1個method之檔亦不寫出, calc與funAddKeysIn皆未被呼叫', async function() {
            for (let [bad, msg] of [[{ avg: '0', std: 1 }, MSG_AVG], [{ avg: 0, std: 0 }, MSG_STD]]) {
                let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
                let kp2 = { ...kp, fy: kp.fx }
                let adds = 0
                let fd = fresh()
                let methods = [
                    { method: 'fx', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1 } }], optMethod: {} },
                    { method: 'fy', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1 } }, { keyOut: 'X', nm: bad }], optMethod: {} },
                ]
                let funAddKeysIn = (v) => {
                    adds++
                    return v
                }
                await assert.rejects(call(methods, kp2, fd, { funAddKeysIn }), (e) => e.message === msg)
                assert.deepStrictEqual(fs.readdirSync(fd), [])
                assert.strictEqual(st.calls, 0)
                assert.strictEqual(adds, 0)
            }
        })

        it('deal.keyIn有指定而不在keysIn內者不處理故不檢核nm.avg與nm.std(無效亦不拒); 在keysIn內者照檢核', async function() {
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            let methods = [{ method: 'fx', deals: [{ keyIn: 'other', keyOut: 'X', nm: { avg: '1', std: 0 } }, { keyOut: 'X', nm: { avg: 0, std: 1 } }], optMethod: {} }]
            let rs = await call(methods, kp, fd)
            assert.strictEqual(rs.length, 1)
            await expectMsg([{ method: 'fx', deals: [{ keyIn: 'none', keyOut: 'X', nm: { avg: '1', std: 1 } }], optMethod: {} }], MSG_AVG, 'keyIn在keysIn內')
        })

        it('未給(undefined、null、缺鍵)時行為不變: avg預設0、std預設1, 輸出與明給{avg:0,std:1}逐位相同(寫出之檔與回傳列)', async function() {
            let xs = [4, 8, 15, 16, 23, 42, -3.5, 0]
            let run = async (nm) => {
                let { kp } = fixedCalc([{ period: 'a', len: 1, xs }, { period: 'b', len: 2, xs: [...xs].reverse() }])
                let fd = fresh()
                let rs = await call(dealOf(nm), kp, fd)
                return { rs, a: readP(fd, 'a'), b: readP(fd, 'b'), files: fs.readdirSync(fd) }
            }
            let ref = await run({ avg: 0, std: 1 })
            for (let nm of [{ byPeriod: {} }, { avg: undefined, std: undefined }, { avg: null, std: null }, { avg: 0 }, { std: 1 }, { avg: undefined, std: 1 }, { avg: 0, std: null }, { avg: null, std: 1, byPeriod: null }]) {
                assert.deepStrictEqual(await run(nm), ref, JSON.stringify(nm))
            }
        })

        it('合法值逐位不變: 有限數值之avg(含0、-0、負數、極小、極大)與std(大於0之有限數值, 含極小)與以往之 (值 − avg) ÷ std 逐位相同; 只給其一時另一為預設', async function() {
            let xs = [4, 8, 15, 16, 23, 42, -3.5, 0, 1e300, 5e-324]
            for (let [avg, std] of [[50, 10], [-7.25, 0.5], [0, 1e-300], [1e308, 3], [-0, 2], [5e-324, 1e308], [3, 5e-324]]) {
                let { kp } = fixedCalc([{ period: 'a', len: 1, xs }])
                let fd = fresh()
                await call(dealOf({ avg, std }), kp, fd)
                let exp = xs.map((x) => (x - avg) / std)
                let got = readP(fd, 'a')
                //檔案為JSON: 非有限值寫成null、-0寫成0; 其餘逐位相同(期望值經同一JSON往返)
                assert.deepStrictEqual(got, JSON.parse(JSON.stringify(exp)), `avg ${avg} std ${std}`)
            }
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }])
            let fd1 = fresh()
            await call(dealOf({ avg: 20 }), kp, fd1)
            assert.deepStrictEqual(readP(fd1, 'a'), [-10, 0, 10])
            let fd2 = fresh()
            await call(dealOf({ std: 10 }), kp, fd2)
            assert.deepStrictEqual(readP(fd2, 'a'), [1, 2, 3])
        })

        it('檢測之值即使用之值(V11): nm.avg、nm.std只讀取一次(存取器第2次讀取回傳他值、檢核後被改動皆不影響使用), 同一deal物件於多個method共用時只讀取一次', async function() {
            let reads = { avg: 0, std: 0 }
            let nm = {}
            Object.defineProperty(nm, 'avg', {
                enumerable: true,
                get() {
                    reads.avg++
                    return reads.avg === 1 ? 20 : 1e9
                },
            })
            Object.defineProperty(nm, 'std', {
                enumerable: true,
                get() {
                    reads.std++
                    return reads.std === 1 ? 10 : -1
                },
            })
            let { kp: kp0 } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }])
            let kp = { fx: kp0.fx, fy: kp0.fx }
            let deals = [{ keyOut: 'X', nm }]
            let methods = [{ method: 'fx', deals, optMethod: {} }, { method: 'fy', deals, optMethod: {} }]
            let fd = fresh()
            await call(methods, kp, fd)
            assert.deepStrictEqual(reads, { avg: 1, std: 1 }, '各讀取一次(同一deal物件於兩個method共用)')
            assert.deepStrictEqual(readP(fd, 'a'), [-1, 0, 1])
            //檢核後(funAddKeysIn執行時)改動nm ⇒ 仍用檢核時之值
            let nm2 = { avg: 20, std: 10 }
            let fd2 = fresh()
            let funAddKeysIn = (v) => {
                nm2.avg = 1e9
                nm2.std = 1e-9
                return v
            }
            await call(dealOf(nm2), kp, fd2, { funAddKeysIn })
            assert.deepStrictEqual(readP(fd2, 'a'), [-1, 0, 1])
        })

        it('凍結之nm可用、不改寫呼叫端之輸入', async function() {
            let nm = Object.freeze({ avg: 20, std: 10 })
            let deal = Object.freeze({ keyOut: 'X', nm })
            let methods = Object.freeze([Object.freeze({ method: 'fx', deals: Object.freeze([deal]), optMethod: Object.freeze({}) })])
            let { kp } = fixedCalc([{ period: 'a', len: 1, xs: [10, 20, 30] }])
            let fd = fresh()
            await call(methods, kp, fd)
            assert.deepStrictEqual(readP(fd, 'a'), [-1, 0, 1])
        })

    })

    describe('D8 檢核失敗之處置: 訊息為固定詞彙(只含位置與期望之種類, 不含輸入值)、不以console輸出輸入(V19、V20、〈診斷輸出與遮罩〉)', function() {

        let SENT = 'SENTINEL-8e3b9d'

        //run, 執行並收集拒絕訊息與console輸出(含各層級)
        let run = async (methods, opt = {}) => {
            let { kp, st } = fixedCalc([{ period: 'a', len: 1, xs: [1, 2, 3] }])
            let fd = fresh()
            let err = null
            let outs = []
            let names = ['log', 'warn', 'error', 'info', 'debug']
            let orgs = {}
            names.forEach((k) => {
                orgs[k] = console[k]
                console[k] = (...a) => {
                    outs.push(a)
                }
            })
            try {
                await call(methods, kp, fd, opt)
            }
            catch (e) {
                err = e
            }
            finally {
                names.forEach((k) => {
                    console[k] = orgs[k]
                })
            }
            return { err, outs, st, files: fs.readdirSync(fd) }
        }

        let ok = { method: 'fx', deals: [{ keyOut: 'X', nm: { avg: 0, std: 1 } }], optMethod: {} }

        let CASES = [
            ['keysIn之元素', [ok], { keysIn: ['none', 5] }, 'invalid opt.keysIn[1]: must be a non-empty string'],
            ['keysIn之元素(字串以外之機敏值)', [ok], { keysIn: [{ k: SENT }] }, 'invalid opt.keysIn[0]: must be a non-empty string'],
            ['methods[i]非物件', [ok, SENT], {}, 'invalid methods[1]: must be a non-empty object'],
            ['methods[i]為null', [ok, null], {}, 'invalid methods[1]: must be a non-empty object'],
            ['method非字串', [{ ...ok, method: { k: SENT } }], {}, 'invalid methods[0].method: must be a non-empty string'],
            ['method不在kp內', [{ ...ok, method: SENT }], {}, 'invalid methods[0].method: must be a key of kp'],
            ['deals非陣列', [{ ...ok, deals: SENT }], {}, 'invalid methods[0].deals: must be a non-empty array'],
            ['deals為空陣列', [{ ...ok, deals: [] }], {}, 'invalid methods[0].deals: must be a non-empty array'],
            ['deal.keyOut非字串', [{ ...ok, deals: [{ keyOut: { k: SENT }, nm: { avg: 0, std: 1 } }] }], {}, 'invalid deal.keyOut: must be a non-empty string'],
            ['deal.nm非物件', [{ ...ok, deals: [{ keyOut: 'X', nm: SENT }] }], {}, 'invalid deal.nm: must be a non-empty object'],
            ['deal.nm為空物件', [{ ...ok, deals: [{ keyOut: 'X', nm: {} }] }], {}, 'invalid deal.nm: must be a non-empty object'],
            ['nm.avg無效', [{ ...ok, deals: [{ keyOut: 'X', nm: { avg: SENT, std: 1 } }] }], {}, 'invalid deal.nm.avg: must be a finite number'],
            ['nm.std無效', [{ ...ok, deals: [{ keyOut: 'X', nm: { avg: 0, std: SENT } }] }], {}, 'invalid deal.nm.std: must be a finite number greater than 0'],
            ['nm.byPeriod無效', [{ ...ok, deals: [{ keyOut: 'X', nm: { avg: 0, std: 1, byPeriod: SENT } }] }], {}, 'invalid deal.nm.byPeriod: must be an object of { avg, std } with a finite avg and a finite std > 0'],
        ]
        CASES.forEach(([tag, methods, opt, msg]) => {
            it(`${tag} ⇒ reject固定訊息(逐字)、不含輸入值、不以console輸出、夾為空、calc未被呼叫`, async function() {
                let r = await run(methods, opt)
                assert.ok(r.err !== null, '應reject')
                assert.ok(r.err.message === msg, `訊息(實際 ${r.err.message})`)
                assert.ok(!r.err.message.includes(SENT), '訊息不含輸入值')
                assert.strictEqual(r.outs.length, 0, '不得以console輸出(含methods、m、kp、deals、deal之傾印)')
                assert.deepStrictEqual(r.files, [])
                assert.strictEqual(r.st.calls, 0)
            })
        })

        it('methods之第1個與第2個以後皆依實際索引(i)定位', async function() {
            let r0 = await run([{ ...ok, method: 5 }, ok])
            assert.strictEqual(r0.err.message, 'invalid methods[0].method: must be a non-empty string')
            let r2 = await run([ok, ok, { ...ok, deals: 'x' }])
            assert.strictEqual(r2.err.message, 'invalid methods[2].deals: must be a non-empty array')
        })

    })

})
