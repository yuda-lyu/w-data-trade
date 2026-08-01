import assert from 'assert'
import calcMacd from '../src/calcMacd.mjs'
import { genOhlc, genFlat, genUp, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcMacd.mjs 與其呼叫之 src/caEma.mjs
//  以標準 MACD(12, 26, 9) 為基底, 依 len 等比放大:
//    fastPeriod = 12*len, slowPeriod = 26*len, signalPeriod = 9*len
//  DIF(快線) = EMA(fastPeriod) - EMA(slowPeriod), 兩者皆取收盤價
//  DEM(慢線, 即 DEA/訊號線) = DIF 之 EMA(signalPeriod)
//  OSC(柱狀動能) = DIF - DEM
//  EMA 之種子為前 len 筆之 SMA, 遞推 alpha = 2/(len+1) (見 caEma)
//  第一筆 DIF 對應輸入索引 slowPeriod-1, 第一筆 DEM 對應輸入索引 (slowPeriod-1)+(signalPeriod-1)
//  故輸出自輸入索引 35*len-2 起, 共 n-(35*len-2) 筆
//  n < len 或 n < slowPeriod+signalPeriod-1 時該期回傳 []
let kp = {
    '4hr': 1,
    '8hr': 2,
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6, // 1 day = 6 * 4 hours
}

//參考實作: 直接照 EMA 定義遞推, 種子取前 len 筆 SMA
//回傳陣列第 0 筆對應輸入索引 len-1
let refEma = (cs, len) => {
    if (cs.length < len) {
        return []
    }
    let alpha = 2 / (len + 1)
    let sum = 0
    for (let i = 0; i < len; i++) {
        sum += cs[i]
    }
    let e = sum / len
    let rs = [e]
    for (let i = len; i < cs.length; i++) {
        e = cs[i] * alpha + e * (1 - alpha)
        rs.push(e)
    }
    return rs
}

//參考實作: 直接照 MACD 定義, 快慢 EMA 相減得 DIF, 再取 DIF 之 EMA 得 DEM
let refMacd = (cs, len) => {
    let n = cs.length
    let fast = 12 * len
    let slow = 26 * len
    let signal = 9 * len
    if (n < slow + signal - 1) {
        return []
    }

    //快慢 EMA, 第 0 筆分別對應輸入索引 fast-1 與 slow-1
    let ef = refEma(cs, fast)
    let es = refEma(cs, slow)

    //DIF, 自兩者皆有值處(索引 slow-1)起算
    let difs = []
    for (let i = slow - 1; i < n; i++) {
        difs.push(ef[i - (fast - 1)] - es[i - (slow - 1)])
    }

    //DEM 為 DIF 之 EMA, 第 0 筆對應 difs 索引 signal-1
    let dems = refEma(difs, signal)

    let rs = []
    dems.forEach((dem, k) => {
        let dif = difs[k + signal - 1]
        rs.push({
            DIF: dif,
            DEM: dem,
            OSC: dif - dem,
        })
    })
    return rs
}


describe('calcMacd', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(400)
        let rrs = await calcMacd(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 35*len-2 根起算並逐根對齊', async function() {
        //第一筆 DIF 在索引 26len-1, 其後再等 9len-1 根才有第一筆 DEM
        let arr = genOhlc(400)
        let rrs = await calcMacd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, 35 * len - 2)
        })
    })

    it('DIF 須等於快線 EMA(12len) 減慢線 EMA(26len)', async function() {
        let arr = genOhlc(400)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcMacd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'DIF', refMacd(cs, len).map((v) => {
                return v.DIF
            }), 1e-12, period)
        })
    })

    it('DEM 須為 DIF 之 EMA(9len)', async function() {
        let arr = genOhlc(400)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcMacd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertNearAll(r.vs, 'DEM', refMacd(cs, len).map((v) => {
                return v.DEM
            }), 1e-12, period)
        })
    })

    it('OSC 恆等於 DIF - DEM', async function() {
        let arr = genOhlc(400)
        let rrs = await calcMacd(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assertNear(v.OSC, v.DIF - v.DEM, 1e-12, `${r.period} 第 ${i} 筆 OSC`)
            })
        })
    })

    it('手算例: 收盤 1..34 於 4hr(len=1) 得 DIF=7, DEM=7, OSC=0 共一筆', async function() {
        //手算: cs = 1..34 (等差, 公差 1), len=1 → fast=12, slow=26, signal=9
        //  等差序列之 EMA 有閉式解: 種子(索引 L-1) = (c_0+...+c_{L-1})/L = c_{L-1} - (L-1)/2
        //  代入遞推 c_i*a + prev*(1-a), a = 2/(L+1), 1-a = (L-1)/(L+1):
        //    c_i*a + (c_i - 1 - (L-1)/2)*(1-a) = c_i - (1-a)*(1 + (L-1)/2)
        //                                      = c_i - ((L-1)/(L+1))*((L+1)/2) = c_i - (L-1)/2
        //  故 EMA_L(i) = c_i - (L-1)/2 恆成立
        //  DIF(i) = (c_i - (12-1)/2) - (c_i - (26-1)/2) = 25/2 - 11/2 = 7 (定值)
        //  DEM = 定值 7 之 EMA = 7, OSC = 7 - 7 = 0
        //  n=34 恰為 slow+signal-1 = 26+9-1, 故輸出 1 筆, 對應索引 26-1+9-1 = 33 (第 34 根)
        let cs = []
        for (let i = 1; i <= 34; i++) {
            cs.push(i)
        }
        let arr = ohlcFromCloses(cs)
        let rrs = await calcMacd(arr, 'Close')
        let r = pickPeriod(rrs, '4hr')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[33].time)
        assertNear(r.vs[0].DIF, 7, 1e-12, '手算 DIF')
        assertNear(r.vs[0].DEM, 7, 1e-12, '手算 DEM')
        assertNear(r.vs[0].OSC, 0, 1e-12, '手算 OSC')

        //其餘各期資料量不足, 皆為空
        assert.strictEqual(pickPeriod(rrs, '8hr').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs, '1day').vs.length, 0)
    })

    it('等差上升序列之 DIF 恆為 7*len, DEM 同值, OSC 為 0', async function() {
        //承上式 EMA_L(i) = c_i - (L-1)/2 * step, step=1:
        //  DIF = (26len-1)/2 - (12len-1)/2 = 7*len, DEM 為定值之 EMA 故同值, OSC=0
        let arr = genUp(400)
        let rrs = await calcMacd(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assert.ok(r.vs.length > 0, `${period} 應有輸出`)
            r.vs.forEach((v, i) => {
                assertNear(v.DIF, 7 * len, 1e-8, `${period} 第 ${i} 筆 DIF`)
                assertNear(v.DEM, 7 * len, 1e-8, `${period} 第 ${i} 筆 DEM`)
                assertNear(v.OSC, 0, 1e-8, `${period} 第 ${i} 筆 OSC`)
            })
        })
    })

    it('定值序列之 DIF/DEM/OSC 皆為 0', async function() {
        //定值時快慢 EMA 皆等於該定值, 相減為 0, DIF 為 0 則 DEM 與 OSC 亦為 0
        let arr = genFlat(400)
        let rrs = await calcMacd(arr, 'Close')
        Object.keys(kp).forEach((period) => {
            let r = pickPeriod(rrs, period)
            assert.ok(r.vs.length > 0, `${period} 應有輸出`)
            r.vs.forEach((v, i) => {
                assertNear(v.DIF, 0, 1e-9, `${period} 第 ${i} 筆 DIF`)
                assertNear(v.DEM, 0, 1e-9, `${period} 第 ${i} 筆 DEM`)
                assertNear(v.OSC, 0, 1e-9, `${period} 第 ${i} 筆 OSC`)
            })
        })
    })

    it('資料筆數少於 26len+9len-1 時該期回傳空陣列', async function() {
        //4hr(len=1) 之門檻為 26+9-1 = 34, 故 33 根時全期皆空
        let rrs33 = await calcMacd(genOhlc(33), 'Close')
        rrs33.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 於 33 根時應為空`)
        })

        //恰達門檻 34 根時 4hr 有且僅有 1 筆
        let rrs34 = await calcMacd(genOhlc(34), 'Close')
        assert.strictEqual(pickPeriod(rrs34, '4hr').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs34, '8hr').vs.length, 0)
    })

    it('opt.norm=true 不影響 MACD (定義以價格 EMA 之差為準)', async function() {
        //caMacd 內固定以 { norm: false } 取 EMA, 故 DIF/DEM/OSC 皆為價格量綱
        let arr = genOhlc(400)
        let rrs0 = await calcMacd(arr, 'Close')
        let rrs1 = await calcMacd(arr, 'Close', { norm: true })
        assert.deepStrictEqual(rrs1, rrs0)
    })

})
