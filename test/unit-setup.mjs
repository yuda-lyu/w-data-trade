import assert from 'assert'


//共用層: 提供各 unit 測試之合成 K 線資料與結構性斷言
//注意: 本檔不含 describe/it, 不被 runner 當測試檔


//基準起始時間: 2020-01-01T00:00:00, 每根 K 線間隔 4 小時
let tBase = Date.UTC(2020, 0, 1)
let tStep = 4 * 3600 * 1000

/**
 * 產生 n 根 K 線之時間字串序列 (4hr 間隔, 格式同 binance 匯出之 '2020-01-01T00:00:00')
 */
let genTimes = (n) => {
    let ts = []
    for (let i = 0; i < n; i++) {
        ts.push(new Date(tBase + i * tStep).toISOString().slice(0, 19))
    }
    return ts
}

/**
 * 由 close 序列造出合法 K 線
 * Open = 前一根 Close (第一根用自身 Close), High >= max(Open,Close), Low <= min(Open,Close)
 * opt.wick: 影線長度係數, 0 表示無影線 (High=max(O,C), Low=min(O,C))
 * opt.vols: 自訂成交量序列, 預設為確定性序列
 */
let ohlcFromCloses = (cs, opt = {}) => {
    let wick = opt.wick !== undefined ? opt.wick : 0.5
    let vols = opt.vols
    let n = cs.length
    let ts = genTimes(n)
    let arr = []
    for (let i = 0; i < n; i++) {
        let c = cs[i]
        let o = i === 0 ? cs[0] : cs[i - 1]
        let d = Math.abs(c - o)
        let w = wick * (d + 1) //確定性影線, 與波動同量級
        let h = Math.max(o, c) + w
        let l = Math.min(o, c) - w
        let vol = vols ? vols[i] : (1000 + (i % 17) * 37 + (i % 5) * 11)
        arr.push({
            time: ts[i],
            Open: o,
            High: h,
            Low: l,
            Close: c,
            Volumn: vol,
            QuoteAssetVolume: vol * c,
            NumberOfTrades: 100 + (i % 37),
            TakerBuyBaseAssetVolume: vol * (0.3 + (i % 7) * 0.05),
        })
    }
    return arr
}

/**
 * 確定性震盪 K 線 (以 sin/cos 合成, 不用 Math.random 以確保可重現)
 */
let genOhlc = (n, opt = {}) => {
    let c = opt.start !== undefined ? opt.start : 100
    let cs = []
    for (let i = 0; i < n; i++) {
        let s = Math.sin(i * 0.7) + Math.cos(i * 0.31) * 0.5 + Math.sin(i * 0.13) * 0.8
        c = Math.max(1, c + s * 2)
        cs.push(c)
    }
    return ohlcFromCloses(cs, opt)
}

/**
 * 定值 K 線 (Open=High=Low=Close, 無波動), 用於退化情形
 */
let genFlat = (n, price = 100, opt = {}) => {
    let cs = new Array(n).fill(price)
    return ohlcFromCloses(cs, { wick: 0, ...opt })
}

/**
 * 單調上升 K 線 (每根 Close 遞增, 無影線 → 每根 High/Low 皆高於前根)
 */
let genUp = (n, opt = {}) => {
    let start = opt.start !== undefined ? opt.start : 100
    let step = opt.step !== undefined ? opt.step : 1
    let cs = []
    for (let i = 0; i < n; i++) {
        cs.push(start + step * (i + 1))
    }
    return ohlcFromCloses(cs, { wick: 0, ...opt })
}

/**
 * 單調下降 K 線
 */
let genDown = (n, opt = {}) => {
    let start = opt.start !== undefined ? opt.start : 1000
    let step = opt.step !== undefined ? opt.step : 1
    let cs = []
    for (let i = 0; i < n; i++) {
        cs.push(start - step * (i + 1))
    }
    return ohlcFromCloses(cs, { wick: 0, ...opt })
}

/**
 * 取出 arr 內指定欄位序列
 */
let valuesOf = (arr, key) => {
    return arr.map((v) => {
        return v[key]
    })
}

/**
 * 取 rrs 內指定 period 之區塊
 */
let pickPeriod = (rrs, period) => {
    let r = rrs.find((v) => {
        return v.period === period
    })
    assert.ok(r !== undefined, `找不到 period[${period}]`)
    return r
}

/**
 * 斷言 rrs 外層結構: 依 kpExpect 之鍵序給出 { period, len, vs }
 */
let assertRrsShape = (rrs, kpExpect) => {
    assert.ok(Array.isArray(rrs), 'rrs 須為陣列')
    assert.deepStrictEqual(rrs.map((v) => {
        return v.period
    }), Object.keys(kpExpect), 'period 清單與順序須符合 kp 定義')
    assert.deepStrictEqual(rrs.map((v) => {
        return v.len
    }), Object.values(kpExpect), 'len 須符合 kp 定義')
    rrs.forEach((v) => {
        assert.ok(Array.isArray(v.vs), `period[${v.period}] 之 vs 須為陣列`)
        v.vs.forEach((m, i) => {
            assert.strictEqual(typeof m.time, 'string', `period[${v.period}] 第 ${i} 筆缺 time`)
        })
    })
}

/**
 * 斷言某 period 之輸出時間軸: 自輸入第 indStart 根起算, 逐根對齊至最後一根
 */
let assertTimeAlign = (vs, arr, indStart) => {
    let ts = valuesOf(arr, 'time')
    assert.strictEqual(vs.length, Math.max(0, ts.length - indStart), `筆數須為 n-${indStart}`)
    vs.forEach((v, i) => {
        assert.strictEqual(v.time, ts[indStart + i], `第 ${i} 筆 time 未對齊輸入第 ${indStart + i} 根`)
    })
}

/**
 * 浮點近似斷言
 */
let assertNear = (a, b, tol = 1e-9, msg = '') => {
    assert.ok(Number.isFinite(a), `${msg} 實際值非有限數: ${a}`)
    assert.ok(Number.isFinite(b), `${msg} 期望值非有限數: ${b}`)
    let d = Math.abs(a - b)
    let s = Math.max(1, Math.abs(a), Math.abs(b))
    assert.ok(d / s <= tol, `${msg} 期望 ${b}, 實得 ${a}, 差 ${d}`)
}

/**
 * 逐點近似斷言 (序列)
 */
let assertNearAll = (vs, key, exps, tol = 1e-9, msg = '') => {
    assert.strictEqual(vs.length, exps.length, `${msg} 筆數 ${vs.length} 與期望 ${exps.length} 不符`)
    vs.forEach((v, i) => {
        assertNear(v[key], exps[i], tol, `${msg} [${key}] 第 ${i} 筆`)
    })
}

/**
 * 斷言序列每筆之指定欄位落在 [lo, hi]
 */
let assertRange = (vs, key, lo, hi, msg = '') => {
    vs.forEach((v, i) => {
        let x = v[key]
        assert.ok(Number.isFinite(x), `${msg} [${key}] 第 ${i} 筆非有限數: ${x}`)
        assert.ok(x >= lo - 1e-9 && x <= hi + 1e-9, `${msg} [${key}] 第 ${i} 筆 ${x} 超出 [${lo}, ${hi}]`)
    })
}


export {
    genTimes,
    ohlcFromCloses,
    genOhlc,
    genFlat,
    genUp,
    genDown,
    valuesOf,
    pickPeriod,
    assertRrsShape,
    assertTimeAlign,
    assertNear,
    assertNearAll,
    assertRange
}
