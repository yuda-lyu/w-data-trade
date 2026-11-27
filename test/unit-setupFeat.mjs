import assert from 'assert'
import { inspect } from 'util'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import periodInfo from '../src/periodInfo.mjs'
import { genTimes, valuesOf, ohlcFromCloses } from './unit-setup.mjs'


//共用層(calcMomz、calcVolx、calcDown、calcFlow 四個特徵族 calc 之單元測試共用): 內建週期表、逐根相異之合成資料、暴力計算用之小工具、共通性質之斷言
//注意: 本檔不含 describe/it, 不被 runner 當測試檔


//KP, 四個 calc 之內建週期表(根數為本, 同 calcCvd; 標籤以每根 4hr 寫定)
let KP = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6,
    '2day': 12,
    '4day': 24,
    '7day': 42,
    '15day': 90,
    '30day': 180,
}

//LABELS_1DAY, 每根 1day(opt.intervalSec = 86400)時各期之標籤(根數 × 1day)
let LABELS_1DAY = ['3day', '4day', '5day', '6day', '12day', '24day', '42day', '90day', '180day']

//mkRand, 線性同餘亂數(固定種子, 可重現; 不用 Math.random)
let mkRand = (seed) => {
    let st = seed >>> 0
    return () => {
        st = (st * 1664525 + 1013904223) >>> 0
        return st / 4294967296
    }
}

/**
 * 逐根相異且非單調之合成 K 線(含量與主動買量)
 * 對數報酬為四個均勻亂數之和(近似常態)再偶爾疊加偏負之衝擊, 故各根之值皆不同, 且有明顯之暴跌根與收跌根; 開盤與前一根收盤有跳空; 高低涵蓋開收; 主動買量為量之 25% ~ 75%
 * opt.vol: 每根報酬之尺度, 預設 0.01; opt.shock: 每根出現衝擊之機率, 預設 0.05
 */
let mkBars = (n, seed = 1, opt = {}) => {
    let rnd = mkRand(seed)
    let vol0 = opt.vol !== undefined ? opt.vol : 0.01
    let pShock = opt.shock !== undefined ? opt.shock : 0.05
    let ts = genTimes(n)
    let arr = []
    let c = 100
    for (let i = 0; i < n; i++) {
        let z = rnd() + rnd() + rnd() + rnd() - 2
        let shock = rnd() < pShock ? (rnd() - 0.7) * 6 : 0
        let o = c * Math.exp((rnd() - 0.5) * vol0 * 0.4)
        let cl = o * Math.exp((z + shock) * vol0)
        let h = Math.max(o, cl) * Math.exp(rnd() * vol0 * 1.2)
        let l = Math.min(o, cl) * Math.exp(-rnd() * vol0 * 1.2)
        let v = 500 + rnd() * 1500
        arr.push({
            time: ts[i],
            Open: o,
            High: h,
            Low: l,
            Close: cl,
            Volumn: v,
            TakerBuyBaseAssetVolume: v * (0.25 + 0.5 * rnd()),
        })
        c = cl
    }
    return arr
}

//sum / mean / popStd(暴力計算用; 母體標準差以「平均平方差之平方根」逐項計, 不用 E[x²] − E[x]²)
let sum = (x) => x.reduce((a, b) => a + b, 0)
let mean = (x) => sum(x) / x.length
let popStd = (x) => {
    let m = mean(x)
    return Math.sqrt(mean(x.map((v) => (v - m) * (v - m))))
}

//win, 視窗 W(i, m) = 第 i − m + 1 ~ i 根(含當根共 m 根); 起點小於 0 即為暴力計算自身之錯, 拋錯而不讓 slice 之負索引靜默回繞
let win = (x, i, m) => {
    assert.ok(i - m + 1 >= 0, `視窗起點 ${i - m + 1} 小於 0`)
    assert.ok(i < x.length, `視窗終點 ${i} 超出 ${x.length}`)
    return x.slice(i - m + 1, i + 1)
}

//distinct, 某欄不同取值之個數
let distinct = (vs, key) => new Set(valuesOf(vs, key)).size

//assertFiniteRrs, 全部輸出欄皆為有限數值(含欄名清單之核對)
let assertFiniteRrs = (rrs, cols, msg = '') => {
    rrs.forEach((r) => {
        r.vs.forEach((v, i) => {
            assert.deepStrictEqual(Object.keys(v), ['time', ...cols], `${msg} ${r.period} 第 ${i} 筆之欄`)
            cols.forEach((k) => {
                assert.strictEqual(typeof v[k], 'number', `${msg} ${r.period} 第 ${i} 筆 ${k} 非數值`)
                assert.ok(Number.isFinite(v[k]), `${msg} ${r.period} 第 ${i} 筆 ${k} 非有限數: ${v[k]}`)
            })
        })
    })
}

//assertSameRrs, 結果全相同(逐期之 period、len、vs 皆逐值相同)
let assertSameRrs = (a, b, msg = '') => {
    assert.deepStrictEqual(a, b, msg)
}

//perturb, 第 t 根「之後」各根依根而異地改動: 價格欄(Open、High、Low、Close)共乘同一個逐根相異之係數(保持高低涵蓋開收), 量欄(Volumn、TakerBuyBaseAssetVolume)共乘另一個逐根相異之係數; 第 t 根(含)以前原樣
let perturb = (arr, t) => {
    return arr.map((v, i) => {
        if (i <= t) {
            return { ...v }
        }
        let f = 1 + 0.15 * Math.sin(0.9 * i + 0.4) + 0.05 * Math.cos(2.3 * i)
        let g = 1 + 0.3 * Math.sin(1.7 * i + 1.1) + 0.1 * Math.cos(0.6 * i)
        let w = { ...v }
        for (let k of ['Open', 'High', 'Low', 'Close']) {
            if (k in w) {
                w[k] = w[k] * f
            }
        }
        for (let k of ['Volumn', 'TakerBuyBaseAssetVolume']) {
            if (k in w) {
                w[k] = w[k] * g
            }
        }
        return w
    })
}

//assertCausal, 只用當根以前之資料:
//  (a) 第 t 根之後依根而異地改動(perturb), 第 t 根(含)以前之輸出逐值不變, 其後之輸出有變(各期皆須有「其後之輸出」且至少一筆有變)
//  (b) 以第 t 根截斷之序列所得全部輸出, 與完整序列之前段逐筆相同(各期)
//  fn(arr) 回 Promise(rrs); tList 為截斷位置(輸入索引)清單, 皆須大於各期之 s0 以使各期於截斷前後皆有輸出
let assertCausal = async(fn, arr, t, tList, msg = '') => {
    let full = await fn(arr)
    let mod = await fn(perturb(arr, t))
    let tEnd = arr[t].time
    assert.strictEqual(full.length, mod.length, `${msg} 期數`)
    full.forEach((r, j) => {
        let m = mod[j]
        assert.strictEqual(r.period, m.period, `${msg} period`)
        let ia = r.vs.filter((x) => x.time <= tEnd)
        let ib = m.vs.filter((x) => x.time <= tEnd)
        assert.ok(ia.length > 0, `${msg} ${r.period} 截斷前須有輸出(須加大 t)`)
        assert.deepStrictEqual(ib, ia, `${msg} ${r.period} 第 ${t} 根之後之改動不得影響其前之輸出`)
        let la = r.vs.filter((x) => x.time > tEnd)
        let lb = m.vs.filter((x) => x.time > tEnd)
        assert.ok(la.length > 0, `${msg} ${r.period} 其後須有輸出(須加大 n)`)
        assert.strictEqual(la.length, lb.length, `${msg} ${r.period} 其後筆數`)
        let nDiff = la.filter((x, k) => JSON.stringify(x) !== JSON.stringify(lb[k])).length
        assert.ok(nDiff > 0, `${msg} ${r.period} 其後之輸出須有變(鑑別)`)
    })
    for (let tt of tList) {
        let part = await fn(arr.slice(0, tt + 1))
        let tE = arr[tt].time
        part.forEach((r, j) => {
            let pre = full[j].vs.filter((x) => x.time <= tE)
            assert.ok(pre.length > 0, `${msg} ${r.period} 截斷於 ${tt} 須有輸出`)
            assert.deepStrictEqual(r.vs, pre, `${msg} ${r.period} 截斷於 ${tt}`)
        })
    }
}

//assertIntervalSec, opt.intervalSec = 86400 時期別標籤為 3day … 180day, 根數與各值同預設, periodInfo 回對應根數; 其他每根時長亦只改標籤
let assertIntervalSec = async(fn, arr, msg = '') => {
    let base = await fn(arr)
    let r1 = await fn(arr, { intervalSec: 86400 })
    assert.deepStrictEqual(r1.map((r) => r.period), LABELS_1DAY, `${msg} 標籤`)
    assert.deepStrictEqual(r1.map((r) => r.len), Object.values(KP), `${msg} len`)
    r1.forEach((r, i) => {
        assert.deepStrictEqual(r.vs, base[i].vs, `${msg} ${r.period} 值須同預設`)
        assert.deepStrictEqual(periodInfo(r.period, { intervalSec: 86400 }), { period: r.period, bars: r.len, spanSec: r.len * 86400 }, `${msg} ${r.period} periodInfo`)
    })
    for (let iv of [3600, '86400', 14400]) {
        let rk = await fn(arr, { intervalSec: iv })
        rk.forEach((r, i) => {
            assert.deepStrictEqual(r.vs, base[i].vs, `${msg} intervalSec ${iv} ${r.period}`)
        })
    }
    //預設與 14400 同標籤
    assert.deepStrictEqual((await fn(arr, { intervalSec: 14400 })).map((r) => r.period), Object.keys(KP), `${msg} 14400 標籤`)
}


//labelOf, 值之簡短標籤(供斷言訊息; 以 inspect 取得, 不對可能不可讀之值做 String() 或 JSON.stringify)
let labelOf = (v) => {
    try {
        return inspect(v, { depth: 0 })
    }
    catch (err) {
        return '(unreadable)'
    }
}

//intBads, 整數類 opt 鍵(至少為 min)之非預期值: 小於 min 者、非整數、非數值、非有限數、超出安全整數、包裝物件、BigInt、符號、函數、陣列、物件、各種不合格式之字串(數字字串之合格寫法不在此列)
let intBads = (min) => {
    let vs = [min - 1, String(min - 1), 0, -5, 2.5, '2.5', 'abc', '', ' ', NaN, Infinity, -Infinity, true, false, [], [min + 3], {}, 1e300, '1e300', 10n, Object(min + 3), Symbol('s'), () => min + 3, '0x10', '1,000', '１０', 'Infinity', 'NaN', '-', 'NP']
    return vs.filter((v, i) => vs.findIndex((u) => Object.is(u, v)) === i)
}

//numBads, 正數類 opt 鍵(有限且大於 0)之非預期值
let numBads = () => {
    return [0, -1, '0', '-1', '-0.5', NaN, Infinity, -Infinity, '-Infinity', '1e999', 'abc', '', ' ', true, false, [], [1], {}, 10n, Object(1), Symbol('s'), () => 1, '0x10', '1,5', '-', 'NP']
}

//assertOptK3, opt 之數值類鍵(跨套件規格〈輸入參數之檢測機制〉K3、V5): 非預期之輸入視為未給而改用預設, 不 reject, opt.debug 為 true 時另警告
//  call(opt) 回 Promise(rrs); base 為未給該鍵(含 extra)之結果; name 為鍵名; invalids 為非預期之值; sames 為合格而等同預設之寫法(結果同 base 且不警告)
//  tag、desc、defDesc 為警告文字之三段: `[${tag}] invalid opt.${name}: must be ${desc}, using default ${defDesc}`
//  extra 為其他需併給之 opt(如另一鍵之有效值), 併於每次呼叫
let assertOptK3 = async({ call, base, name, invalids, sames = [], tag, desc, defDesc, extra = {} }) => {
    let msgExp = `[${tag}] invalid opt.${name}: must be ${desc}, using default ${defDesc}`

    //(a) 非預期之輸入視為未給: 不 reject、結果同未給(結果須取得之斷言以 assert.ok 加固定訊息, 值可能不可讀)
    for (let v of invalids) {
        let rrs = null
        let err = null
        try {
            rrs = await call({ ...extra, [name]: v })
        }
        catch (e) {
            err = e
        }
        assert.ok(err === null, `opt.${name} ${labelOf(v)} 不應 reject`)
        assert.ok(JSON.stringify(rrs) === JSON.stringify(base), `opt.${name} ${labelOf(v)} 之結果應同未給`)
    }

    //(b) opt.debug 為 true: 每個非預期之值各警告一次, 文字固定、不含傳入之值; funLog 之參數為 { fn, reason, key }
    for (let v of invalids) {
        getOptReader.resetWarned()
        let logs = []
        await call({ ...extra, [name]: v, debug: true, funLog: (m, info) => logs.push([m, info]) })
        let okOne = logs.length === 1 && logs[0][0] === msgExp && JSON.stringify(logs[0][1]) === JSON.stringify({ fn: tag, reason: 'invalid', key: name })
        assert.ok(okOne, `opt.${name} ${labelOf(v)} 於 debug 應警告恰一則 ${msgExp}(實際 ${logs.length} 則)`)
    }

    //(c) 警告不含傳入之值(以特徵字串為值; 該字串非合格之值)
    getOptReader.resetWarned()
    let logs2 = []
    await call({ ...extra, [name]: 'SENTINEL-7c3e1a', debug: true, funLog: (m) => logs2.push(m) })
    assert.ok(logs2.length === 1 && !logs2[0].includes('SENTINEL-7c3e1a'), `opt.${name} 警告不得含傳入之值`)

    //(d) 同一個鍵每個行程只警告一次(不重設去重表連呼兩次)
    getOptReader.resetWarned()
    let logs3 = []
    for (let k = 0; k < 2; k++) {
        await call({ ...extra, [name]: -3.5, debug: true, funLog: (m) => logs3.push(m) })
    }
    assert.ok(logs3.length === 1, `opt.${name} 同一鍵警告一次, 實際 ${logs3.length}`)

    //(e) debug 非恰為 true、未給該鍵(undefined、null)、合格之寫法: 不警告(含出口為 console.warn 者)
    let warns = []
    let orgWarn = console.warn
    console.warn = (...a) => warns.push(a)
    try {
        for (let dbg of ['true', 1, 'yes', {}, [], null, undefined, false]) {
            getOptReader.resetWarned()
            await call({ ...extra, [name]: -3.5, debug: dbg })
        }
        getOptReader.resetWarned()
        for (let v of [undefined, null, ...sames]) {
            let rrs = await call({ ...extra, [name]: v, debug: true })
            assert.ok(JSON.stringify(rrs) === JSON.stringify(base), `opt.${name} ${labelOf(v)} 之結果應同預設`)
        }
        assert.ok(warns.length === 0, `不應警告, 實際 ${warns.length} 則`)

        //(f) 無 funLog(或 funLog 非函數)時出口為 console.warn, 同一文字
        for (let f of [undefined, null, 'x', 5, {}]) {
            getOptReader.resetWarned()
            warns.length = 0
            await call({ ...extra, [name]: -3.5, debug: true, funLog: f })
            assert.ok(warns.length === 1 && warns[0].length === 1 && warns[0][0] === msgExp, `opt.${name} funLog ${labelOf(f)} 時 console.warn 恰一則`)
        }
    }
    finally {
        console.warn = orgWarn
    }

    //(g) funLog 拋錯或回傳 rejection 皆忽略: 結果不變
    getOptReader.resetWarned()
    let funThrow = () => {
        throw new Error('boom')
    }
    let r1 = await call({ ...extra, [name]: -3.5, debug: true, funLog: funThrow })
    assert.ok(JSON.stringify(r1) === JSON.stringify(base), `opt.${name} funLog 拋錯不影響結果`)
    getOptReader.resetWarned()
    let r2 = await call({ ...extra, [name]: -3.5, debug: true, funLog: () => Promise.reject(new Error('boom')) })
    assert.ok(JSON.stringify(r2) === JSON.stringify(base), `opt.${name} funLog 回傳 rejection 不影響結果`)

    //(h) 鍵之讀取拋錯(存取器)視為未給, 不 reject、不警告
    getOptReader.resetWarned()
    let logs4 = []
    let o = { ...extra, debug: true, funLog: (m) => logs4.push(m) }
    let getThrow = () => {
        throw new Error('boom')
    }
    Object.defineProperty(o, name, {
        enumerable: true,
        get: getThrow,
    })
    let r3 = await call(o)
    assert.ok(JSON.stringify(r3) === JSON.stringify(base), `opt.${name} 讀取拋錯視為未給`)
    assert.ok(logs4.length === 0, `opt.${name} 讀取拋錯不警告`)
    getOptReader.resetWarned()
}

//mkGeo, 完全等比之序列(收盤 = start × g^i 逐根累乘; 對數報酬理論上全同, 實際僅差浮點捨入, σ 殘值約 1e-17; 開盤為前一根收盤、高低即開收, 故高低涵蓋開收)
let mkGeo = (n, g, start = 100) => {
    let cs = []
    let c = start
    for (let i = 0; i < n; i++) {
        c *= g
        cs.push(c)
    }
    return ohlcFromCloses(cs, { wick: 0 })
}

//mkAlt, 對數報酬為 +δ、−δ 交替之序列(σ 之母體標準差於偶數長度之視窗恰為 δ; 供 σ 之下限之邊界案: δ 在下限之上下各一組); 高低即開收
let mkAlt = (n, delta, start = 100) => {
    let cs = []
    let lc = Math.log(start)
    for (let i = 0; i < n; i++) {
        lc += i % 2 === 0 ? delta : -delta
        cs.push(Math.exp(lc))
    }
    return ohlcFromCloses(cs, { wick: 0 })
}


export {
    labelOf,
    intBads,
    numBads,
    assertOptK3,
    mkGeo,
    mkAlt,
    KP,
    LABELS_1DAY,
    mkRand,
    mkBars,
    sum,
    mean,
    popStd,
    win,
    distinct,
    assertFiniteRrs,
    assertSameRrs,
    perturb,
    assertCausal,
    assertIntervalSec
}
