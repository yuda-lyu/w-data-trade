import assert from 'assert'
import calcKdj from '../src/calcKdj.mjs'
import { genOhlc, genFlat, genUp, genDown, genTimes, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertRange } from './unit-setup.mjs'


//規格來源: src/calcKdj.mjs
//  回看期數 period = len, K/D 平滑係數 kAlpha = dAlpha = 1/3, K 與 D 初始值(seed) = 50
//  Hn = 視窗內 High 之最大值, Ln = 視窗內 Low 之最小值 (視窗為最近 len 根)
//  RSV = (Close - Ln) / (Hn - Ln) * 100; Hn === Ln 時取中性值 50 (避免除以 0)
//  K = kAlpha*RSV + (1-kAlpha)*K
//  D = dAlpha*K + (1-dAlpha)*D
//  J = 3K - 2D, KminusD = K - D
//  輸出自輸入索引 len-1 起 (視窗未滿之根不輸出), 共 n-len+1 筆
//  n < len 時該期回傳 []; High/Low/Close 非數值時拋錯
let kp = {
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
    '15day': 90, // 15 days = 90 * 4 hours
    '30day': 180, // 30 days = 180 * 4 hours
}

//參考實作: 視窗最高最低以暴力掃描取得, K/D 照平滑公式遞推
let refKdj = (arr, len) => {
    if (arr.length < len) {
        return []
    }
    let K = 50
    let D = 50
    let rs = []
    for (let i = len - 1; i < arr.length; i++) {
        let hn = -Infinity
        let ln = Infinity
        for (let j = i - len + 1; j <= i; j++) {
            hn = Math.max(hn, arr[j].High)
            ln = Math.min(ln, arr[j].Low)
        }
        let rsv = 50
        if (hn !== ln) {
            rsv = ((arr[i].Close - ln) / (hn - ln)) * 100
        }
        K = rsv / 3 + K * 2 / 3
        D = K / 3 + D * 2 / 3
        rs.push({
            K,
            D,
            J: 3 * K - 2 * D,
        })
    }
    return rs
}

//由 { h, l, c } 三元組造出 K 線 (caKdj 僅取用 time/High/Low/Close)
let barsFrom = (rows) => {
    let ts = genTimes(rows.length)
    return rows.map((v, i) => {
        return {
            time: ts[i],
            Open: v.c,
            High: v.h,
            Low: v.l,
            Close: v.c,
        }
    })
}


describe('calcKdj', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(300)
        let rrs = await calcKdj(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(300)
        let rrs = await calcKdj(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len - 1)
        })
    })

    it('K 與 D 須符合 RSV 平滑遞推 (視窗最高最低以暴力掃描為準)', async function() {
        let arr = genOhlc(300)
        let rrs = await calcKdj(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refKdj(arr, len)
            assert.strictEqual(r.vs.length, exps.length, `${period} 筆數不符`)
            r.vs.forEach((v, i) => {
                assertNear(v.K, exps[i].K, 1e-9, `${period} 第 ${i} 筆 K`)
                assertNear(v.D, exps[i].D, 1e-9, `${period} 第 ${i} 筆 D`)
            })
        })
    })

    it('K 與 D 恆落在 [0, 100]', async function() {
        //RSV 恆在 [0,100], K 與 D 為 RSV 與前值(初始 50)之凸組合, 故不逸出區間
        let arr = genOhlc(300)
        let rrs = await calcKdj(arr, 'Close')
        rrs.forEach((r) => {
            assertRange(r.vs, 'K', 0, 100, r.period)
            assertRange(r.vs, 'D', 0, 100, r.period)
        })
    })

    it('J 恆等於 3K-2D, KminusD 恆等於 K-D', async function() {
        let arr = genOhlc(300)
        let rrs = await calcKdj(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assertNear(v.J, 3 * v.K - 2 * v.D, 1e-12, `${r.period} 第 ${i} 筆 J`)
                assertNear(v.KminusD, v.K - v.D, 1e-12, `${r.period} 第 ${i} 筆 KminusD`)
            })
        })
    })

    it('手算例: 7 根固定 High=20/Low=10 之序列於 1day(len=6)', async function() {
        //手算: 每根 High=20, Low=10, 故任一視窗之 Hn=20, Ln=10
        //  收盤 = [15,15,15,15,15,12,17], len=6 → 僅索引 5 與 6 有輸出
        //  索引5: RSV = (12-10)/(20-10)*100 = 20
        //         K = 20/3 + (2/3)*50 = 20/3 + 100/3 = 120/3 = 40
        //         D = 40/3 + (2/3)*50 = 40/3 + 100/3 = 140/3
        //         J = 3*40 - 2*(140/3) = 120 - 280/3 = 80/3
        //         K-D = 40 - 140/3 = -20/3
        //  索引6: RSV = (17-10)/(20-10)*100 = 70
        //         K = 70/3 + (2/3)*40 = 70/3 + 80/3 = 150/3 = 50
        //         D = 50/3 + (2/3)*(140/3) = 150/9 + 280/9 = 430/9
        //         J = 3*50 - 2*(430/9) = 150 - 860/9 = 490/9
        let arr = barsFrom([
            { h: 20, l: 10, c: 15 },
            { h: 20, l: 10, c: 15 },
            { h: 20, l: 10, c: 15 },
            { h: 20, l: 10, c: 15 },
            { h: 20, l: 10, c: 15 },
            { h: 20, l: 10, c: 12 },
            { h: 20, l: 10, c: 17 },
        ])
        let rrs = await calcKdj(arr, 'Close')
        let r = pickPeriod(rrs, '1day')
        assert.strictEqual(r.vs.length, 2)

        assert.strictEqual(r.vs[0].time, arr[5].time)
        assertNear(r.vs[0].K, 40, 1e-12, '手算 K1')
        assertNear(r.vs[0].D, 140 / 3, 1e-12, '手算 D1')
        assertNear(r.vs[0].J, 80 / 3, 1e-12, '手算 J1')
        assertNear(r.vs[0].KminusD, -20 / 3, 1e-12, '手算 K-D 1')

        assert.strictEqual(r.vs[1].time, arr[6].time)
        assertNear(r.vs[1].K, 50, 1e-12, '手算 K2')
        assertNear(r.vs[1].D, 430 / 9, 1e-12, '手算 D2')
        assertNear(r.vs[1].J, 490 / 9, 1e-12, '手算 J2')

        //其餘各期資料量不足, 皆為空
        assert.strictEqual(pickPeriod(rrs, '2day').vs.length, 0)
        assert.strictEqual(pickPeriod(rrs, '30day').vs.length, 0)
    })

    it('定值序列時 Hn===Ln, RSV 取 50, 故 K=D=J=50 且 K-D=0', async function() {
        //K = 50/3 + (2/3)*50 = 50, D 同理為 50, J = 3*50-2*50 = 50
        let arr = genFlat(300)
        let rrs = await calcKdj(arr, 'Close')
        rrs.forEach((r) => {
            assert.ok(r.vs.length > 0, `${r.period} 應有輸出`)
            r.vs.forEach((v, i) => {
                assertNear(v.K, 50, 1e-12, `${r.period} 第 ${i} 筆 K`)
                assertNear(v.D, 50, 1e-12, `${r.period} 第 ${i} 筆 D`)
                assertNear(v.J, 50, 1e-12, `${r.period} 第 ${i} 筆 J`)
                assertNear(v.KminusD, 0, 1e-12, `${r.period} 第 ${i} 筆 K-D`)
            })
        })
    })

    it('單調上升序列之 RSV 恆為 100, K 依 K=100/3+2K/3 遞推且 K>D', async function() {
        //genUp 無影線, High=max(Open,Close)=Close, Low=min(Open,Close)=前一根 Close
        //  遞增故視窗 Hn = 當根 High = 當根 Close, 即 Close===Hn → RSV = 100
        let arr = genUp(300)
        let rrs = await calcKdj(arr, 'Close')
        Object.keys(kp).forEach((period) => {
            let r = pickPeriod(rrs, period)
            assert.ok(r.vs.length > 0, `${period} 應有輸出`)
            let K = 50
            let D = 50
            r.vs.forEach((v, i) => {
                K = 100 / 3 + K * 2 / 3
                D = K / 3 + D * 2 / 3
                assertNear(v.K, K, 1e-9, `${period} 第 ${i} 筆 K`)
                assertNear(v.D, D, 1e-9, `${period} 第 ${i} 筆 D`)

                //D 為 K 之再平滑, 上行時落後 K, 故 K 不低於 D
                //(兩者皆趨近 100, 收斂後於雙精度下相等, 故不斷言嚴格大於)
                assert.ok(v.K >= v.D, `${period} 第 ${i} 筆 K 應不低於 D`)
            })

            //K 自 50 向 100 單調趨近, 首筆尚未收斂故 K 嚴格大於 D
            assert.ok(r.vs[0].K > r.vs[0].D, `${period} 首筆 K 應大於 D`)
            assertNear(r.vs[0].K, 200 / 3, 1e-9, `${period} 首筆 K`)
            assert.ok(r.vs[r.vs.length - 1].K > 99, `${period} 末筆 K 應趨近 100`)
        })
    })

    it('單調下降序列之 RSV 恆為 0, K 依 K=2K/3 遞推且 K<D', async function() {
        //genDown 無影線, Low=min(Open,Close)=Close, 遞減故視窗 Ln = 當根 Low = 當根 Close
        //  即 Close===Ln → RSV = 0
        let arr = genDown(300)
        let rrs = await calcKdj(arr, 'Close')
        Object.keys(kp).forEach((period) => {
            let r = pickPeriod(rrs, period)
            assert.ok(r.vs.length > 0, `${period} 應有輸出`)
            let K = 50
            let D = 50
            r.vs.forEach((v, i) => {
                K = K * 2 / 3
                D = K / 3 + D * 2 / 3
                assertNear(v.K, K, 1e-9, `${period} 第 ${i} 筆 K`)
                assertNear(v.D, D, 1e-9, `${period} 第 ${i} 筆 D`)

                //D 為 K 之再平滑, 下行時落後 K, 故 K 不高於 D
                assert.ok(v.K <= v.D, `${period} 第 ${i} 筆 K 應不高於 D`)
            })

            //K 自 50 向 0 單調趨近, 首筆尚未收斂故 K 嚴格小於 D
            assert.ok(r.vs[0].K < r.vs[0].D, `${period} 首筆 K 應小於 D`)
            assertNear(r.vs[0].K, 100 / 3, 1e-9, `${period} 首筆 K`)
            assert.ok(r.vs[r.vs.length - 1].K < 1, `${period} 末筆 K 應趨近 0`)
        })
    })

    it('資料筆數少於 len 時該期回傳空陣列', async function() {
        let arr = genOhlc(5)
        let rrs = await calcKdj(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('High/Low/Close 非數值時拋錯', async function() {
        let rows = new Array(6).fill(null).map(() => {
            return { h: 20, l: 10, c: 15 }
        })

        let arrH = barsFrom(rows)
        arrH[0].High = null
        await assert.rejects(calcKdj(arrH, 'Close'), /invalid h/)

        let arrL = barsFrom(rows)
        arrL[0].Low = 'x'
        await assert.rejects(calcKdj(arrL, 'Close'), /invalid l/)

        let arrC = barsFrom(rows)
        arrC[0].Close = undefined
        await assert.rejects(calcKdj(arrC, 'Close'), /invalid c/)
    })

})
