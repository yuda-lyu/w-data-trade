import assert from 'assert'
import wdt from '../src/WDataTrade.mjs'
import { genOhlc, genFlat, genUp, genDown, valuesOf } from './unit-setup.mjs'


//跨指標之共通契約 (各指標之公式正確性由各自的 unit-calcXxx.test.mjs 負責)
//
//規格來源: 各 src/calcXxx.mjs 之共同介面約定
//  1. calcXxx(arr, key, opt) 為 async, 回傳 [{ period, len, vs }]
//  2. vs 內每筆必有 time, 且 time 取自輸入 K 線之 time, 依輸入順序遞增不重複
//  3. vs 內除 time 外之欄位皆為有限數 (指標本身已對除以 0 / 無波動做保護, 不得外洩 NaN 或 Infinity)
//  4. 純函式: 同一輸入重複呼叫結果一致 (模組內 rolling sum 等狀態不得跨呼叫殘留)


//所有指標函式名
let ks = [
    'calcAdx',
    'calcAtr',
    'calcAts',
    'calcBbpb',
    'calcCandle',
    'calcCvd',
    'calcDonchian',
    'calcEma',
    'calcIchimoku',
    'calcKdj',
    'calcKeltner',
    'calcKlr',
    'calcMa',
    'calcMacd',
    'calcMfi',
    'calcObv',
    'calcOrig',
    'calcRsi',
    'calcSupertrend',
    'calcVec',
    'calcVortex',
    'calcVwap',
]

//各情境之合成資料: 一般震盪, 無波動定值, 單調上升, 單調下降
let scenes = [
    { name: '震盪', arr: genOhlc(400) },
    { name: '定值', arr: genFlat(200) },
    { name: '單調上升', arr: genUp(200) },
    { name: '單調下降', arr: genDown(200) },
]

//斷言單一 rrs 符合共通契約
let assertContract = (rrs, arr, msg) => {

    assert.ok(Array.isArray(rrs), `${msg} 回傳須為陣列`)
    assert.ok(rrs.length > 0, `${msg} 回傳不得為空`)

    let ts = valuesOf(arr, 'time')
    let sTs = new Set(ts)

    rrs.forEach((r) => {

        assert.strictEqual(typeof r.period, 'string', `${msg} period 須為字串`)
        assert.ok(Number.isFinite(r.len), `${msg} len 須為數值`)
        assert.ok(Array.isArray(r.vs), `${msg} vs 須為陣列`)

        let indPrev = -1
        r.vs.forEach((v, i) => {

            //time 須來自輸入且遞增
            assert.ok(sTs.has(v.time), `${msg}[${r.period}] 第 ${i} 筆 time[${v.time}] 不在輸入時間軸內`)
            let ind = ts.indexOf(v.time)
            assert.ok(ind > indPrev, `${msg}[${r.period}] 第 ${i} 筆 time 未遞增`)
            indPrev = ind

            //其餘欄位皆須為有限數
            Object.keys(v).forEach((k) => {
                if (k === 'time') {
                    return
                }
                assert.ok(Number.isFinite(v[k]), `${msg}[${r.period}] 第 ${i} 筆 ${k} 非有限數: ${v[k]}`)
            })

        })

    })
}


describe('各指標共通契約', function() {

    it('WDataTrade 匯出之指標清單須完整且皆為函式', function() {
        ks.forEach((k) => {
            assert.strictEqual(typeof wdt[k], 'function', `${k} 須為函式`)
        })
        //helper 亦一併匯出
        assert.strictEqual(typeof wdt.pickValue, 'function')
        assert.strictEqual(typeof wdt.caEma, 'function')
    })

    scenes.forEach((s) => {
        ks.forEach((k) => {
            it(`${k} 於 ${s.name} 序列須符合共通契約 (結構/時間軸/有限數)`, async function() {
                let rrs = await wdt[k](s.arr, 'Close')
                assertContract(rrs, s.arr, `${k}@${s.name}`)
            })
        })
    })

    ks.forEach((k) => {
        it(`${k} 為純函式, 同輸入重複呼叫結果一致`, async function() {
            let arr = genOhlc(120)
            let r1 = await wdt[k](arr, 'Close')
            let r2 = await wdt[k](arr, 'Close')
            assert.deepStrictEqual(r2, r1, `${k} 重複呼叫結果不一致`)
        })
    })

    ks.forEach((k) => {
        it(`${k} 於資料筆數僅 2 根時各期回傳空陣列`, async function() {
            let arr = genOhlc(2)
            let rrs = await wdt[k](arr, 'Close')
            rrs.forEach((r) => {
                if (k === 'calcOrig') {
                    //calcOrig 為原值直出, 無視窗概念, 每根皆有值
                    assert.strictEqual(r.vs.length, 2, 'calcOrig 應逐根輸出')
                    return
                }
                if (k === 'calcKlr') {
                    //calcKlr len=1 且各比值僅取當根 OHLC, 2 根皆有值
                    assert.strictEqual(r.vs.length, 2, `${k}[${r.period}] 應逐根輸出`)
                    return
                }
                if (k === 'calcCandle') {
                    //calcCandle len=1 但 engulfStrength 需前一根, 故自第 2 根起算
                    assert.strictEqual(r.vs.length, 1, `${k}[${r.period}] 應自第 2 根起算`)
                    return
                }
                if (k === 'calcVec' && r.period === '4hr') {
                    //calcVec 之 4hr 期 len=1, 差值僅需 2 根
                    assert.strictEqual(r.vs.length, 1, `${k}[${r.period}] 應有 1 筆差值`)
                    return
                }
                assert.strictEqual(r.vs.length, 0, `${k}[${r.period}] 應為空`)
            })
        })
    })

})
