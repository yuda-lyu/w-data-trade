import assert from 'assert'
import calcVwap from '../src/calcVwap.mjs'
import { genOhlc, genFlat, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcVwap.mjs
//  TR[i] = max(|High-Low|, |High-Close[i-1]|, |Low-Close[i-1]|) (i>=1)
//  典型價 tp = (High+Low+Close)/3, VWAP(len) = rolling window [i-len+1,i] 內 Σ(tp*Volumn) / Σ(Volumn)
//  ATR(len) 為 Wilder 平滑: 種子=前 len 根 TR 之 SMA, 之後 atr[i]=(atr[i-1]*(len-1)+TR[i])/len
//  vwapDist = (Close-VWAP)/Close (Close=0 時給 0), vwapDistATR = (Close-VWAP)/ATR (ATR=0 時給 0)
//  第一筆輸出對應輸入索引 len, n < len+1 時該期回傳 []
let kp = {
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

//參考實作: 直接照定義暴力計算 rolling VWAP 與 Wilder ATR (VWAP 視窗總和逐次重算, 不沿用 running sum)
let refVwap = (arr, len) => {
    let n = arr.length
    let trs = new Array(n).fill(0)
    for (let i = 1; i < n; i++) {
        let h = arr[i].High
        let l = arr[i].Low
        let cPrev = arr[i - 1].Close
        trs[i] = Math.max(Math.abs(h - l), Math.abs(h - cPrev), Math.abs(l - cPrev))
    }
    let tps = arr.map((v) => {
        return (v.High + v.Low + v.Close) / 3
    })
    let atr = 0
    for (let k = 1; k <= len; k++) {
        atr += trs[k]
    }
    atr = atr / len
    let rs = []
    for (let i = len; i < n; i++) {
        if (i > len) {
            atr = (atr * (len - 1) + trs[i]) / len
        }
        let sumTpv = 0
        let sumVol = 0
        for (let j = i - len + 1; j <= i; j++) {
            sumTpv += tps[j] * arr[j].Volumn
            sumVol += arr[j].Volumn
        }
        let c = arr[i].Close
        let vwap = sumVol !== 0 ? sumTpv / sumVol : c
        let vwapDist = c !== 0 ? (c - vwap) / c : 0
        let vwapDistATR = atr !== 0 ? (c - vwap) / atr : 0
        rs.push({ vwapDist, vwapDistATR })
    }
    return rs
}


describe('calcVwap', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVwap(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVwap(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('vwapDist/vwapDistATR 須符合 rolling VWAP + Wilder ATR 定義 (與獨立參考實作逐點比對)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVwap(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exp = refVwap(arr, len)
            assertNearAll(r.vs, 'vwapDist', exp.map((v) => {
                return v.vwapDist
            }), 1e-9, `${period} vwapDist`)
            assertNearAll(r.vs, 'vwapDistATR', exp.map((v) => {
                return v.vwapDistATR
            }), 1e-9, `${period} vwapDistATR`)
        })
    })

    it('VWAP 須落在該視窗 High 最大值與 Low 最小值之間 (加權平均之典型價必落在窗內)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcVwap(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            r.vs.forEach((v, j) => {
                let i = len + j
                let win = arr.slice(i - len + 1, i + 1)
                let hi = Math.max(...win.map((b) => {
                    return b.High
                }))
                let lo = Math.min(...win.map((b) => {
                    return b.Low
                }))
                let c = arr[i].Close
                let vwap = c * (1 - v.vwapDist)
                assert.ok(vwap >= lo - 1e-6 && vwap <= hi + 1e-6, `${period} 第 ${j} 筆 vwap[${vwap}] 超出視窗 [${lo}, ${hi}]`)
            })
        })
    })

    it('手算例: 5 根自訂 OHLCV, 12hr/16hr 逐筆手算驗證', async function() {
        //bar: Open,High,Low,Close,Volumn
        //0: 10,12,9,11,100  1: 11,13,10,12,200  2: 12,14,11,13,150  3: 13,15,12,14,300  4: 14,16,13,15,250
        //TR[i]=max(|H-L|,|H-Cprev|,|L-Cprev|), 每根 H-L=3 且 H-Cprev=2, L-Cprev=1 → TR恆為3
        //tp[i]=(H+L+C)/3: tp0=32/3, tp1=35/3, tp2=38/3, tp3=41/3, tp4=44/3
        //tpv[i]=tp[i]*V: tpv0=3200/3, tpv1=7000/3, tpv2=5700/3, tpv3=12300/3, tpv4=11000/3
        let arr = ohlcFromCloses([0, 0, 0, 0, 0])
        let bars = [
            { Open: 10, High: 12, Low: 9, Close: 11, Volumn: 100 },
            { Open: 11, High: 13, Low: 10, Close: 12, Volumn: 200 },
            { Open: 12, High: 14, Low: 11, Close: 13, Volumn: 150 },
            { Open: 13, High: 15, Low: 12, Close: 14, Volumn: 300 },
            { Open: 14, High: 16, Low: 13, Close: 15, Volumn: 250 },
        ]
        arr.forEach((v, i) => {
            Object.assign(v, bars[i])
        })
        let rrs = await calcVwap(arr, 'Close')

        //12hr(len=3): atrSeed=(TR1+TR2+TR3)/3=(3+3+3)/3=3
        //初始視窗[0,2]: sumTpv=3200/3+7000/3+5700/3=15900/3, sumVol=100+200+150=450
        //i=3: 滑到[1,3]: sumTpv=15900/3-3200/3+12300/3=25000/3, sumVol=450-100+300=650
        //     vwap=(25000/3)/650, c=14, atr=3
        //i=4: 滑到[2,4]: sumTpv=25000/3-7000/3+11000/3=29000/3, sumVol=650-200+250=700
        //     Wilder遞推 atr=(3*2+TR4)/3=(6+3)/3=3 (TR恆為3), c=15
        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 2)
        let vwap3a = (25000 / 3) / 650
        assertNear(r3.vs[0].vwapDist, (14 - vwap3a) / 14, 1e-9, '12hr[0].vwapDist')
        assertNear(r3.vs[0].vwapDistATR, (14 - vwap3a) / 3, 1e-9, '12hr[0].vwapDistATR')
        let vwap3b = (29000 / 3) / 700
        assertNear(r3.vs[1].vwapDist, (15 - vwap3b) / 15, 1e-9, '12hr[1].vwapDist')
        assertNear(r3.vs[1].vwapDistATR, (15 - vwap3b) / 3, 1e-9, '12hr[1].vwapDistATR')

        //16hr(len=4): atrSeed=(TR1+TR2+TR3+TR4)/4=3
        //初始視窗[0,3]: sumTpv=3200/3+7000/3+5700/3+12300/3=28200/3, sumVol=100+200+150+300=750
        //i=4: 滑到[1,4]: sumTpv=28200/3-3200/3+11000/3=36000/3=12000, sumVol=750-100+250=900
        //     vwap=12000/900=40/3, c=15, atr=3
        //     vwapDist=(15-40/3)/15=1/9, vwapDistATR=(15-40/3)/3=5/9
        let r4 = pickPeriod(rrs, '16hr')
        assert.strictEqual(r4.vs.length, 1)
        assertNear(r4.vs[0].vwapDist, 1 / 9, 1e-9, '16hr[0].vwapDist')
        assertNear(r4.vs[0].vwapDistATR, 5 / 9, 1e-9, '16hr[0].vwapDistATR')

        //20hr(len=5)以上僅 5 根資料不足 (需 n>=len+1=6)
        assert.strictEqual(pickPeriod(rrs, '20hr').vs.length, 0)
    })

    it('定值序列: 無波動故 TR=0, vwapDist 與 vwapDistATR 恆為 0', async function() {
        let arr = genFlat(30)
        let rrs = await calcVwap(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.vwapDist, 0, 1e-9, 'flat vwapDist')
            assertNear(v.vwapDistATR, 0, 1e-9, 'flat vwapDistATR')
        })
    })

    it('資料筆數不足 (n < len+1) 時各期皆回傳空陣列', async function() {
        let arr = genOhlc(3)
        let rrs = await calcVwap(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('High 非數值時應拋出例外', async function() {
        let arr = genOhlc(20)
        arr[1].High = 'x'
        await assert.rejects(calcVwap(arr, 'Close'))
    })

})
