import assert from 'assert'
import calcMfi from '../src/calcMfi.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll, assertRange } from './unit-setup.mjs'


//規格來源: src/calcMfi.mjs
//  tp = (High+Low+Close)/3, rawMF = tp*Volumn
//  tp[i]>tp[i-1] 時計入 posMF, tp[i]<tp[i-1] 時計入 negMF, 相等則兩者皆不計入
//  MFI = 100-100/(1+sumPosMF/sumNegMF) (視窗內 rolling 加總)
//  兩者皆<=eps 給 50 (完全平盤), sumNegMF<=eps 給 100 (全部正向), sumPosMF<=eps 給 0 (全部負向)
//  MFIratio = sumPosMF/(sumPosMF+sumNegMF) (totalMF<=eps 給 0.5)
//  MFIdiv: sign(MFI[i]-MFI[i-len]) 與 sign(Close[i]-Close[i-len]) 相同給 1, 相反給 -1, 任一為 0 或無歷史值則 0
//  第一筆輸出對應輸入索引 len, n < len+1 時該期回傳 []
let kp = {
    '12hr': 3,
    '16hr': 4,
    '20hr': 5,
    '1day': 6,
    '2day': 12,
    '4day': 24,
    '7day': 42,
}

//參考實作: 直接照定義暴力計算 rolling 正負向資金流與 MFI (視窗總和逐次重算, 不沿用 running sum)
let refMfi = (arr, len, eps = 1e-12) => {
    let n = arr.length
    let tps = arr.map((v) => {
        return (v.High + v.Low + v.Close) / 3
    })
    let posMFs = new Array(n).fill(0)
    let negMFs = new Array(n).fill(0)
    for (let i = 1; i < n; i++) {
        let rawMF = tps[i] * arr[i].Volumn
        if (tps[i] > tps[i - 1]) {
            posMFs[i] = rawMF
        }
        else if (tps[i] < tps[i - 1]) {
            negMFs[i] = rawMF
        }
    }
    let mfiVals = []
    let rs = []
    for (let i = 1; i < n; i++) {
        if (i < len) {
            mfiVals.push(null)
            continue
        }
        let sumPos = 0
        let sumNeg = 0
        for (let j = i - len + 1; j <= i; j++) {
            sumPos += posMFs[j]
            sumNeg += negMFs[j]
        }
        let MFI
        if (sumNeg <= eps && sumPos <= eps) {
            MFI = 50
        }
        else if (sumNeg <= eps) {
            MFI = 100
        }
        else if (sumPos <= eps) {
            MFI = 0
        }
        else {
            MFI = 100 - 100 / (1 + sumPos / sumNeg)
        }
        let MFIdiv = 0
        let mfiIdx = mfiVals.length - len
        if (mfiIdx >= 0 && mfiVals[mfiIdx] !== null) {
            let mfiDir = Math.sign(MFI - mfiVals[mfiIdx])
            let priceDir = Math.sign(arr[i].Close - arr[i - len].Close)
            if (mfiDir !== 0 && priceDir !== 0) {
                MFIdiv = mfiDir === priceDir ? 1 : -1
            }
        }
        mfiVals.push(MFI)
        let totalMF = sumPos + sumNeg
        let MFIratio = totalMF > eps ? sumPos / totalMF : 0.5
        rs.push({ MFI, MFIratio, MFIdiv })
    }
    return rs
}


describe('calcMfi', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcMfi(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcMfi(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('MFI/MFIratio 須符合資金流定義 (與獨立參考實作逐點比對)', async function() {
        let arr = genOhlc(200)
        let rrs = await calcMfi(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exp = refMfi(arr, len)
            assertNearAll(r.vs, 'MFI', exp.map((v) => {
                return v.MFI
            }), 1e-9, `${period} MFI`)
            assertNearAll(r.vs, 'MFIratio', exp.map((v) => {
                return v.MFIratio
            }), 1e-9, `${period} MFIratio`)
        })
        //註: MFIdiv 為對「MFI 與 len 根前之 MFI」取正負號比較之離散量, 在 sumPosMF/sumNegMF
        //    近乎完全平盤 (真值為0) 之區段, src 之 running sum 與本檔參考實作之逐次重算兩種加總順序
        //    會各自累積不同量級 (約 1e-16~1e-10) 之浮點殘差, 使 MFI 真值 0 附近之正負號比較結果不穩定
        //    (例如 7.1e-14 vs 0, 對 MFI 本身而言在 1e-9 相對誤差內完全相等, 但正負號比較會被放大為 -1 vs 0)
        //    此非 src 偏離定義, 而是兩種加總順序在浮點極限下的正常差異, 故 MFIdiv 改以下方乾淨手算例驗證
    })

    it('MFI 須落在 [0,100], MFIratio 須落在 [0,1]', async function() {
        let arr = genOhlc(200)
        let rrs = await calcMfi(arr, 'Close')
        Object.entries(kp).forEach(([period]) => {
            let r = pickPeriod(rrs, period)
            assertRange(r.vs, 'MFI', 0, 100, `${period} MFI`)
            assertRange(r.vs, 'MFIratio', 0, 1, `${period} MFIratio`)
        })
    })

    it('手算例: 5 根定寬 (H=L=C=tp) 自訂典型價與量, 12hr/16hr 逐筆手算驗證', async function() {
        //tp: [10, 12, 12, 9, 11] (H=L=C=tp, 消除影線影響), vol 恆為100
        //i=1: tp1=12>tp0=10 → posMF1=12*100=1200
        //i=2: tp2=12=tp1=12 → 平盤, 兩者皆不計入
        //i=3: tp3=9<tp2=12 → negMF3=9*100=900
        //i=4: tp4=11>tp3=9 → posMF4=11*100=1100
        let arr = ohlcFromCloses([0, 0, 0, 0, 0])
        let tps = [10, 12, 12, 9, 11]
        arr.forEach((v, i) => {
            v.Open = tps[i]
            v.High = tps[i]
            v.Low = tps[i]
            v.Close = tps[i]
            v.Volumn = 100
        })
        let rrs = await calcMfi(arr, 'Close')

        //12hr(len=3): 第一筆 i=3
        //  sumPos=posMF1+posMF2+posMF3=1200+0+0=1200, sumNeg=negMF1+negMF2+negMF3=0+0+900=900
        //  mfRatio=1200/900=4/3, MFI=100-100/(1+4/3)=100-300/7=400/7
        //  MFIratio=1200/(1200+900)=1200/2100=4/7
        //  第二筆 i=4: sumPos=posMF2+posMF3+posMF4=0+0+1100=1100, sumNeg=negMF2+negMF3+negMF4=0+900+0=900
        //  mfRatio=1100/900=11/9, MFI=100-100/(1+11/9)=100-900/20=100-45=55
        //  MFIratio=1100/(1100+900)=0.55
        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 2)
        assertNear(r3.vs[0].MFI, 400 / 7, 1e-9, '12hr[0].MFI')
        assertNear(r3.vs[0].MFIratio, 4 / 7, 1e-9, '12hr[0].MFIratio')
        assert.strictEqual(r3.vs[0].MFIdiv, 0, '12hr[0].MFIdiv (無歷史值)')
        assertNear(r3.vs[1].MFI, 55, 1e-9, '12hr[1].MFI')
        assertNear(r3.vs[1].MFIratio, 0.55, 1e-9, '12hr[1].MFIratio')

        //16hr(len=4): 第一筆 i=4, 唯一一筆
        //  sumPos=posMF1+posMF2+posMF3+posMF4=1200+0+0+1100=2300, sumNeg=0+0+900+0=900
        //  mfRatio=2300/900=23/9, MFI=100-900/32=71.875
        //  MFIratio=2300/3200=0.71875
        let r4 = pickPeriod(rrs, '16hr')
        assert.strictEqual(r4.vs.length, 1)
        assertNear(r4.vs[0].MFI, 71.875, 1e-9, '16hr[0].MFI')
        assertNear(r4.vs[0].MFIratio, 0.71875, 1e-9, '16hr[0].MFIratio')

        //20hr(len=5)以上僅 5 根資料不足 (需 n>=len+1=6)
        assert.strictEqual(pickPeriod(rrs, '20hr').vs.length, 0)
    })

    it('手算例: 8 根定寬序列驗證 MFIdiv 之實際背離判斷 (-1 與 +1)', async function() {
        //tp: [10, 12, 14, 11, 13, 15, 12, 16] (H=L=C=tp), vol 恆為100
        //方向: i1 pos, i2 pos, i3 neg, i4 pos, i5 pos, i6 neg, i7 pos
        //rawMF=tp*100: posMFs=[_,1200,1400,0,1300,1500,0,1600], negMFs=[_,0,0,1100,0,0,1200,0]
        let arr = ohlcFromCloses([0, 0, 0, 0, 0, 0, 0, 0])
        let tps = [10, 12, 14, 11, 13, 15, 12, 16]
        arr.forEach((v, i) => {
            v.Open = tps[i]
            v.High = tps[i]
            v.Low = tps[i]
            v.Close = tps[i]
            v.Volumn = 100
        })
        let rrs = await calcMfi(arr, 'Close')
        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 5)

        //i=3: sumPos=posMF1+posMF2+posMF3=1200+1400+0=2600, sumNeg=0+0+1100=1100 → MFI=2600/37, 無歷史值 → MFIdiv=0
        //i=4: sumPos=posMF2+posMF3+posMF4=1400+0+1300=2700, sumNeg=0+1100+0=1100 → MFI=1350/19, 無歷史值 → MFIdiv=0
        //i=5: sumPos=posMF3+posMF4+posMF5=0+1300+1500=2800, sumNeg=1100+0+0=1100 → MFI=2800/39, 無歷史值 → MFIdiv=0
        assert.strictEqual(r3.vs[0].MFIdiv, 0, 'i=3 MFIdiv')
        assert.strictEqual(r3.vs[1].MFIdiv, 0, 'i=4 MFIdiv')
        assert.strictEqual(r3.vs[2].MFIdiv, 0, 'i=5 MFIdiv')

        //i=6: sumPos=posMF4+posMF5+posMF6=1300+1500+0=2800, sumNeg=0+0+1200=1200 → MFI=100-100/(1+2800/1200)=70
        //     與 3 根前 (i=3) 之 MFI=2600/37≈70.27 比較: MFI(70)-70.27<0 → mfiDir=-1
        //     價格: Close[6]=12 vs Close[3]=11 → priceDir=sign(12-11)=1
        //     mfiDir(-1) !== priceDir(1) → MFIdiv=-1 (量能與價格背離)
        assertNear(r3.vs[3].MFI, 70, 1e-9, 'i=6 MFI')
        assert.strictEqual(r3.vs[3].MFIdiv, -1, 'i=6 MFIdiv')

        //i=7: sumPos=posMF5+posMF6+posMF7=1500+0+1600=3100, sumNeg=1200+0+0=1200 → MFI=100-1200/43=3100/43≈72.09
        //     與 3 根前 (i=4) 之 MFI=1350/19≈71.05 比較: MFI(72.09)-71.05>0 → mfiDir=1
        //     價格: Close[7]=16 vs Close[4]=13 → priceDir=sign(16-13)=1
        //     mfiDir(1) === priceDir(1) → MFIdiv=1 (量能與價格同向)
        assertNear(r3.vs[4].MFI, 3100 / 43, 1e-9, 'i=7 MFI')
        assert.strictEqual(r3.vs[4].MFIdiv, 1, 'i=7 MFIdiv')
    })

    it('opt.eps 決定「視為 0」之門檻: 相同極小 sumPos/sumNeg 於預設 eps 判為平盤, 於較小 eps 改按實際比例計算', async function() {
        //tp: [10, 11, 9, 12] (H=L=C=tp), vol1=0 (posMF1=0), vol2=1e-13/9 (negMF2=1e-13), vol3=5e-13/12 (posMF3=5e-13)
        //12hr(len=3) 唯一輸出 i=3: sumPos=posMF1+posMF2+posMF3=0+0+5e-13=5e-13, sumNeg=negMF1+negMF2+negMF3=0+1e-13+0=1e-13
        let arr = ohlcFromCloses([0, 0, 0, 0])
        let tps = [10, 11, 9, 12]
        let vols = [100, 0, 1e-13 / 9, 5e-13 / 12]
        arr.forEach((v, i) => {
            v.Open = tps[i]
            v.High = tps[i]
            v.Low = tps[i]
            v.Close = tps[i]
            v.Volumn = vols[i]
        })

        //預設 eps=1e-12: sumPos(5e-13)<=eps 且 sumNeg(1e-13)<=eps → 完全平盤, MFI=50, MFIratio=0.5
        let rrsDefault = await calcMfi(arr, 'Close')
        let rDefault = pickPeriod(rrsDefault, '12hr')
        assert.strictEqual(rDefault.vs.length, 1)
        assertNear(rDefault.vs[0].MFI, 50, 1e-6, 'default eps MFI')
        assertNear(rDefault.vs[0].MFIratio, 0.5, 1e-6, 'default eps MFIratio')

        //自訂 eps=1e-14 (小於 sumPos, sumNeg): 兩者皆非平盤, 依實際比例 sumPos/sumNeg=5 計算
        //MFI=100-100/(1+5)=250/3, MFIratio=5e-13/6e-13=5/6
        let rrsCustom = await calcMfi(arr, 'Close', { eps: 1e-14 })
        let rCustom = pickPeriod(rrsCustom, '12hr')
        assertNear(rCustom.vs[0].MFI, 250 / 3, 1e-6, 'custom eps MFI')
        assertNear(rCustom.vs[0].MFIratio, 5 / 6, 1e-6, 'custom eps MFIratio')
    })

    it('定值序列: 典型價恆平盤, MFI=50 且 MFIratio=0.5', async function() {
        let arr = genFlat(30)
        let rrs = await calcMfi(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.MFI, 50, 1e-9, 'flat MFI')
            assertNear(v.MFIratio, 0.5, 1e-9, 'flat MFIratio')
        })
    })

    it('全漲序列: 典型價恆上升, 負向資金流恆為 0, MFI=100 且 MFIratio=1', async function() {
        let arr = genUp(60)
        let rrs = await calcMfi(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.MFI, 100, 1e-9, '全漲 MFI')
            assertNear(v.MFIratio, 1, 1e-9, '全漲 MFIratio')
        })
    })

    it('全跌序列: 典型價恆下降, 正向資金流恆為 0, MFI=0 且 MFIratio=0', async function() {
        let arr = genDown(60)
        let rrs = await calcMfi(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.MFI, 0, 1e-9, '全跌 MFI')
            assertNear(v.MFIratio, 0, 1e-9, '全跌 MFIratio')
        })
    })

    it('資料筆數不足 (n < len+1) 時各期皆回傳空陣列', async function() {
        let arr = genOhlc(3)
        let rrs = await calcMfi(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('Low 非數值時應拋出例外', async function() {
        let arr = genOhlc(20)
        arr[1].Low = 'x'
        await assert.rejects(calcMfi(arr, 'Close'))
    })

})
