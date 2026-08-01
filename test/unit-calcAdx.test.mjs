import assert from 'assert'
import calcAdx from '../src/calcAdx.mjs'
import { genOhlc, genFlat, genUp, genDown, genTimes, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll, assertRange } from './unit-setup.mjs'


//規格來源: src/calcAdx.mjs (Wilder ADX/DMI)
//  自 i=1 起算, upMove = H(i)-H(i-1), downMove = L(i-1)-L(i)
//    +DM = upMove   (需 upMove > downMove 且 upMove > 0), 否則 0
//    -DM = downMove (需 downMove > upMove 且 downMove > 0), 否則 0
//    TR  = max(|H-L|, |H-Cprev|, |L-Cprev|)
//  第一層 Wilder 平滑: 種子取 [1..len] 之 SMA, 其後 v = (vPrev*(len-1) + x) / len
//    +DI = 100 * smoothPdm / smoothTr, -DI = 100 * smoothNdm / smoothTr (smoothTr=0 時給 0)
//    DX  = 100 * |+DI - -DI| / (+DI + -DI) (分母為 0 時給 0)
//    DI/DX 自輸入索引 len 起算
//  第二層 Wilder 平滑: ADX 種子取前 len 筆 DX 之 SMA, 對應輸入索引 2*len-1, 其後同式遞推
//  DIcross = +DI - -DI; ADXslope = ADX - ADXprev, 第一筆無前值給 0
//  n < 2*len+1 時該期回傳 []
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6, // 1 day = 6 * 4 hours
    '2day': 12, // 2 days = 12 * 4 hours
    '4day': 24, // 4 days = 24 * 4 hours
    '7day': 42, // 7 days = 42 * 4 hours
    '15day': 90, // 15 days = 90 * 4 hours
    '30day': 180, // 30 days = 180 * 4 hours
}

//參考實作: 逐根 +DM, -DM, TR, 索引 0 無前一根故為 0
let refDmTr = (arr) => {
    let pdms = [0]
    let ndms = [0]
    let trs = [0]
    for (let i = 1; i < arr.length; i++) {
        let h = arr[i].High
        let l = arr[i].Low
        let hp = arr[i - 1].High
        let lp = arr[i - 1].Low
        let cp = arr[i - 1].Close
        let up = h - hp
        let dn = lp - l
        pdms.push((up > dn && up > 0) ? up : 0)
        ndms.push((dn > up && dn > 0) ? dn : 0)
        trs.push(Math.max(Math.abs(h - l), Math.abs(h - cp), Math.abs(l - cp)))
    }
    return { pdms, ndms, trs }
}

//參考實作: Wilder 平滑, 種子取 xs[ind0..ind0+len-1] 之算術平均, 其後 v = (vPrev*(len-1) + xs[i]) / len
//回傳與輸入等長之陣列, 索引小於 ind0+len-1 處為 null
let refWilder = (xs, len, ind0) => {
    let ws = new Array(xs.length).fill(null)
    let sum = 0
    for (let i = ind0; i < ind0 + len; i++) {
        sum += xs[i]
    }
    let iSeed = ind0 + len - 1
    ws[iSeed] = sum / len
    for (let i = iSeed + 1; i < xs.length; i++) {
        ws[i] = ((ws[i - 1] * (len - 1)) + xs[i]) / len
    }
    return ws
}

//參考實作: 依定義暴力算出各根之 { ADX, plusDI, minusDI }, 自輸入索引 2*len-1 起
let refAdxs = (arr, len) => {
    let n = arr.length
    if (n < (2 * len) + 1) {
        return []
    }
    let { pdms, ndms, trs } = refDmTr(arr)

    //第一層平滑: 種子自索引 1 起之 len 筆, 故種子落於索引 len
    let sp = refWilder(pdms, len, 1)
    let sn = refWilder(ndms, len, 1)
    let st = refWilder(trs, len, 1)

    //DI 與 DX, 索引 len 起
    let pdis = new Array(n).fill(null)
    let ndis = new Array(n).fill(null)
    let dxs = new Array(n).fill(null)
    for (let i = len; i < n; i++) {
        let pdi = st[i] !== 0 ? (100 * sp[i]) / st[i] : 0
        let ndi = st[i] !== 0 ? (100 * sn[i]) / st[i] : 0
        pdis[i] = pdi
        ndis[i] = ndi
        dxs[i] = (pdi + ndi) !== 0 ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0
    }

    //第二層平滑: 種子自索引 len 起之 len 筆 DX, 故種子落於索引 2*len-1
    let adxs = refWilder(dxs, len, len)

    //輸出
    let rs = []
    for (let i = (2 * len) - 1; i < n; i++) {
        rs.push({
            ADX: adxs[i],
            plusDI: pdis[i],
            minusDI: ndis[i],
        })
    }
    return rs
}

//由 {H, L, C} 列造出 K 線, time 用共用層之 4hr 時間軸
let mkBars = (rows) => {
    let ts = genTimes(rows.length)
    return rows.map((r, i) => {
        return {
            time: ts[i],
            Open: r.C,
            High: r.H,
            Low: r.L,
            Close: r.C,
        }
    })
}


describe('calcAdx', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(400)
        let rrs = await calcAdx(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 2*len-1 根起算並逐根對齊', async function() {
        let arr = genOhlc(400)
        let rrs = await calcAdx(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, (2 * len) - 1)
        })
    })

    it('ADX 與 +DI, -DI 須符合 Wilder 雙層平滑之定義', async function() {
        let arr = genOhlc(400)
        let rrs = await calcAdx(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exps = refAdxs(arr, len)
            assertNearAll(r.vs, 'ADX', exps.map((v) => {
                return v.ADX
            }), 1e-12, period)
            assertNearAll(r.vs, 'plusDI', exps.map((v) => {
                return v.plusDI
            }), 1e-12, period)
            assertNearAll(r.vs, 'minusDI', exps.map((v) => {
                return v.minusDI
            }), 1e-12, period)
        })
    })

    it('手算例: 7 根 K 線於 len=3 之 ADX, +DI, -DI', async function() {
        //H, L, C 與逐根 +DM / -DM / TR:
        //  i0: 10,  8,  9
        //  i1: 12,  9, 11   up=+2, dn=-1 → +DM=2, -DM=0; TR=max(3,|12-9|,|9-9|)=3
        //  i2: 11,  7,  8   up=-1, dn=+2 → +DM=0, -DM=2; TR=max(4,|11-11|,|7-11|)=4
        //  i3: 13,  9, 12   up=+2, dn=-2 → +DM=2, -DM=0; TR=max(4,|13-8|,|9-8|)=5
        //  i4: 14, 12, 13   up=+1, dn=-3 → +DM=1, -DM=0; TR=max(2,|14-12|,|12-12|)=2
        //  i5: 12, 10, 11   up=-2, dn=+2 → +DM=0, -DM=2; TR=max(2,|12-13|,|10-13|)=3
        //  i6: 15, 11, 14   up=+3, dn=-1 → +DM=3, -DM=0; TR=max(4,|15-11|,|11-11|)=4
        //第一層(len=3) 種子(i1..i3): sPdm=4/3, sNdm=2/3, sTr=12/3=4
        //  i3: +DI=100*(4/3)/4=100/3,   -DI=50/3,     DX=100*(50/3)/(150/3)=100/3
        //  i4: sPdm=((4/3)*2+1)/3=11/9, sNdm=((2/3)*2+0)/3=4/9,  sTr=(4*2+2)/3=10/3
        //      +DI=110/3, -DI=40/3, DX=100*(70/3)/50=140/3
        //  i5: sPdm=((11/9)*2+0)/3=22/27, sNdm=((4/9)*2+2)/3=26/27, sTr=((10/3)*2+3)/3=29/9
        //      +DI=2200/87, -DI=2600/87, DX=100*400/4800=25/3
        //  i6: sPdm=((22/27)*2+3)/3=125/81, sNdm=((26/27)*2+0)/3=52/81, sTr=((29/9)*2+4)/3=94/27
        //      +DI=6250/141, -DI=2600/141, DX=100*3650/8850=7300/177
        //第二層: ADX 種子 = (100/3+140/3+25/3)/3 = 265/9, 落於 i5(=2*3-1)
        //        ADX(i6) = ((265/9)*2 + 7300/177)/3 = 53170/1593
        //        ADXslope(i6) = 53170/1593 - 265/9 = 6265/1593
        let arr = mkBars([
            { H: 10, L: 8, C: 9 },
            { H: 12, L: 9, C: 11 },
            { H: 11, L: 7, C: 8 },
            { H: 13, L: 9, C: 12 },
            { H: 14, L: 12, C: 13 },
            { H: 12, L: 10, C: 11 },
            { H: 15, L: 11, C: 14 },
        ])
        let rrs = await calcAdx(arr, 'Close')

        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 2)

        let v0 = r3.vs[0]
        assert.strictEqual(v0.time, arr[5].time)
        assertNear(v0.ADX, 265 / 9, 1e-12, '手算 ADX(i5)')
        assertNear(v0.plusDI, 2200 / 87, 1e-12, '手算 +DI(i5)')
        assertNear(v0.minusDI, 2600 / 87, 1e-12, '手算 -DI(i5)')
        assertNear(v0.DIcross, (2200 - 2600) / 87, 1e-12, '手算 DIcross(i5)')
        assert.strictEqual(v0.ADXslope, 0) //第一筆無前值

        let v1 = r3.vs[1]
        assert.strictEqual(v1.time, arr[6].time)
        assertNear(v1.ADX, 53170 / 1593, 1e-12, '手算 ADX(i6)')
        assertNear(v1.plusDI, 6250 / 141, 1e-12, '手算 +DI(i6)')
        assertNear(v1.minusDI, 2600 / 141, 1e-12, '手算 -DI(i6)')
        assertNear(v1.DIcross, (6250 - 2600) / 141, 1e-12, '手算 DIcross(i6)')
        assertNear(v1.ADXslope, 6265 / 1593, 1e-12, '手算 ADXslope(i6)')

        //len=4 需 n>=9, 此處 n=7 → 空
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('DIcross 須等於 +DI 減 -DI', async function() {
        let arr = genOhlc(200)
        let rrs = await calcAdx(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assertNear(v.DIcross, v.plusDI - v.minusDI, 1e-12, `${r.period} 第 ${i} 筆`)
            })
        })
    })

    it('ADXslope 第一筆為 0, 其後為與前一筆 ADX 之差', async function() {
        let arr = genOhlc(200)
        let rrs = await calcAdx(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                if (i === 0) {
                    assert.strictEqual(v.ADXslope, 0, `${r.period} 第一筆 ADXslope 應為 0`)
                }
                else {
                    assertNear(v.ADXslope, v.ADX - r.vs[i - 1].ADX, 1e-12, `${r.period} 第 ${i} 筆`)
                }
            })
        })
    })

    it('ADX 與 +DI, -DI 恆落在 [0,100], DIcross 落在 [-100,100]', async function() {
        //合法 K 線滿足 Low <= Close <= High, 故 +DM <= TR 且 -DM <= TR, DI 不超過 100
        let arr = genOhlc(400)
        let rrs = await calcAdx(arr, 'Close')
        rrs.forEach((r) => {
            assertRange(r.vs, 'ADX', 0, 100, r.period)
            assertRange(r.vs, 'plusDI', 0, 100, r.period)
            assertRange(r.vs, 'minusDI', 0, 100, r.period)
            assertRange(r.vs, 'DIcross', -100, 100, r.period)
        })
    })

    it('定值序列無方向動能, ADX 與 DI 皆為 0', async function() {
        //Open=High=Low=Close → +DM=-DM=TR=0, smoothTr=0 走保護分支給 0, DX=0 → ADX=0
        let arr = genFlat(60, 100)
        let rrs = await calcAdx(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assert.strictEqual(v.ADX, 0, `第 ${i} 筆 ADX`)
            assert.strictEqual(v.plusDI, 0, `第 ${i} 筆 +DI`)
            assert.strictEqual(v.minusDI, 0, `第 ${i} 筆 -DI`)
            assert.strictEqual(v.DIcross, 0, `第 ${i} 筆 DIcross`)
            assert.strictEqual(v.ADXslope, 0, `第 ${i} 筆 ADXslope`)
        })
    })

    it('單調上升(無影線)僅有 +DM, 故 +DI=100, -DI=0, ADX=100', async function() {
        //無影線時第 i 根 H=Close(i), L=Close(i-1) → upMove=step, downMove=-step
        //  → +DM=step, -DM=0, TR=step, 平滑後 +DI=100, -DI=0, DX=100, ADX=100
        let arr = genUp(60, { step: 2 })
        let rrs = await calcAdx(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assertNear(v.plusDI, 100, 1e-12, `第 ${i} 筆 +DI`)
            assertNear(v.minusDI, 0, 1e-12, `第 ${i} 筆 -DI`)
            assertNear(v.ADX, 100, 1e-12, `第 ${i} 筆 ADX`)
            assertNear(v.DIcross, 100, 1e-12, `第 ${i} 筆 DIcross`)
            assertNear(v.ADXslope, 0, 1e-12, `第 ${i} 筆 ADXslope`)
        })
    })

    it('單調下降(無影線)僅有 -DM, 故 -DI=100, +DI=0, ADX=100 且 DIcross=-100', async function() {
        //無影線時第 i 根 H=Close(i-1), L=Close(i) → upMove=-step, downMove=step
        //  → -DM=step, +DM=0, TR=step, 平滑後 -DI=100, +DI=0, DX=100, ADX=100
        let arr = genDown(60, { step: 2 })
        let rrs = await calcAdx(arr, 'Close')
        let vs = pickPeriod(rrs, '1day').vs
        assert.ok(vs.length > 0)
        vs.forEach((v, i) => {
            assertNear(v.plusDI, 0, 1e-12, `第 ${i} 筆 +DI`)
            assertNear(v.minusDI, 100, 1e-12, `第 ${i} 筆 -DI`)
            assertNear(v.ADX, 100, 1e-12, `第 ${i} 筆 ADX`)
            assertNear(v.DIcross, -100, 1e-12, `第 ${i} 筆 DIcross`)
        })
    })

    it('資料筆數少於 2*len+1 時該期回傳空陣列', async function() {
        //最短之 len 為 3, 需 7 根, 故 6 根時各期皆空
        let arr = genOhlc(6)
        let rrs = await calcAdx(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('恰為 2*len+1 根時該期輸出 2 筆(第一筆對應第 2*len-1 根)', async function() {
        let arr = genOhlc(7)
        let rrs = await calcAdx(arr, 'Close')
        let r = pickPeriod(rrs, '12hr')
        assert.strictEqual(r.vs.length, 2)
        assert.strictEqual(r.vs[0].time, arr[5].time)
        assert.strictEqual(r.vs[1].time, arr[6].time)
        assert.strictEqual(pickPeriod(rrs, '16hr').vs.length, 0)
    })

    it('High 非數值時須拋錯', async function() {
        let arr = genOhlc(30)
        arr[1].High = null
        await assert.rejects(async () => {
            await calcAdx(arr, 'Close')
        }, /invalid h/)
    })

    it('Low 非數值時須拋錯', async function() {
        let arr = genOhlc(30)
        arr[2].Low = 'x'
        await assert.rejects(async () => {
            await calcAdx(arr, 'Close')
        }, /invalid l/)
    })

    it('前一根之 High, Low, Close 非數值時須拋錯', async function() {
        let arr1 = genOhlc(30)
        arr1[0].Close = null
        await assert.rejects(async () => {
            await calcAdx(arr1, 'Close')
        }, /invalid cPrev/)

        let arr2 = genOhlc(30)
        arr2[0].High = null
        await assert.rejects(async () => {
            await calcAdx(arr2, 'Close')
        }, /invalid hPrev/)

        let arr3 = genOhlc(30)
        arr3[0].Low = null
        await assert.rejects(async () => {
            await calcAdx(arr3, 'Close')
        }, /invalid lPrev/)
    })

})
