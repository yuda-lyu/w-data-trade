import assert from 'assert'
import calcObv from '../src/calcObv.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcObv.mjs
//  OBV 累積量: Close 較前一根上漲時 obv[i]=obv[i-1]+Volumn[i], 下跌時 obv[i]=obv[i-1]-Volumn[i], 平盤不變, obv[0]=0
//  OBVnorm = (obv[i] - OBV_MA(len)) / |OBV_MA(len)|, OBV_MA 為近 len 筆 obv 之算術平均 (OBV_MA=0 時給 0)
//  OBVslope = (obv[i] - obv[i-len]) / (len * |obv[i-len]|) (obv[i-len]=0 時分母改為 len)
//  OBVdiv: sign(obv[i]-obv[i-len]) 與 sign(Close[i]-Close[i-len]) 相同給 1, 相反給 -1, 任一為 0 則 0
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

//參考實作: 直接照定義暴力計算 OBV 累積序列與其視窗統計量 (視窗總和逐次重算, 不沿用 running sum)
let refObv = (cs, vols, len) => {
    let n = cs.length
    let obvs = new Array(n).fill(0)
    for (let i = 1; i < n; i++) {
        if (cs[i] > cs[i - 1]) {
            obvs[i] = obvs[i - 1] + vols[i]
        }
        else if (cs[i] < cs[i - 1]) {
            obvs[i] = obvs[i - 1] - vols[i]
        }
        else {
            obvs[i] = obvs[i - 1]
        }
    }
    let rs = []
    for (let i = len; i < n; i++) {
        let win = obvs.slice(i - len + 1, i + 1)
        let obvMa = win.reduce((a, b) => a + b, 0) / len
        let OBVnorm = obvMa !== 0 ? (obvs[i] - obvMa) / Math.abs(obvMa) : 0
        let obvPast = obvs[i - len]
        let OBVslope = Math.abs(obvPast) > 0 ? (obvs[i] - obvPast) / (len * Math.abs(obvPast)) : (obvs[i] - obvPast) / len
        let obvDir = Math.sign(obvs[i] - obvPast)
        let priceDir = Math.sign(cs[i] - cs[i - len])
        let OBVdiv = 0
        if (obvDir !== 0 && priceDir !== 0) {
            OBVdiv = obvDir === priceDir ? 1 : -1
        }
        rs.push({ OBVnorm, OBVslope, OBVdiv })
    }
    return rs
}


describe('calcObv', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(200)
        let rrs = await calcObv(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('各期時間軸自第 len 根起算並逐根對齊', async function() {
        let arr = genOhlc(200)
        let rrs = await calcObv(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, len)
        })
    })

    it('OBVnorm/OBVslope/OBVdiv 須符合累積 OBV 定義 (與獨立參考實作逐點比對)', async function() {
        let arr = genOhlc(200)
        let cs = valuesOf(arr, 'Close')
        let vols = valuesOf(arr, 'Volumn')
        let rrs = await calcObv(arr, 'Close')
        Object.entries(kp).forEach(([period, len]) => {
            let r = pickPeriod(rrs, period)
            let exp = refObv(cs, vols, len)
            assertNearAll(r.vs, 'OBVnorm', exp.map((v) => {
                return v.OBVnorm
            }), 1e-9, `${period} OBVnorm`)
            assertNearAll(r.vs, 'OBVslope', exp.map((v) => {
                return v.OBVslope
            }), 1e-9, `${period} OBVslope`)
            r.vs.forEach((v, i) => {
                assert.strictEqual(v.OBVdiv, exp[i].OBVdiv, `${period} 第 ${i} 筆 OBVdiv`)
            })
        })
    })

    it('手算例: 6 根收盤 [10,12,11,13,13,15] 搭配自訂量, 12hr/16hr/20hr 逐筆手算驗證', async function() {
        //obv: obv0=0
        //  obv1=obv0+2=2 (12>10)
        //  obv2=obv1-3=-1 (11<12)
        //  obv3=obv2+4=3 (13>11)
        //  obv4=obv3=3 (13=13 平盤)
        //  obv5=obv4+6=9 (15>13)
        //vols(index1..5)=[2,3,4,5,6]
        let arr = ohlcFromCloses([10, 12, 11, 13, 13, 15], { wick: 0, vols: [1, 2, 3, 4, 5, 6] })
        let rrs = await calcObv(arr, 'Close')

        //12hr(len=3): 第一筆 i=3
        //  i=3: sumObv=obv1+obv2+obv3=2-1+3=4, obvMa=4/3, OBVnorm=(3-4/3)/(4/3)=1.25
        //       obvPast=obv0=0 → OBVslope=(3-0)/3=1, OBVdiv: sign(3-0)=1 vs sign(C3-C0)=sign(13-10)=1 → 1
        let r3 = pickPeriod(rrs, '12hr')
        assert.strictEqual(r3.vs.length, 3)
        assertNear(r3.vs[0].OBVnorm, 1.25, 1e-9, '12hr[0].OBVnorm')
        assertNear(r3.vs[0].OBVslope, 1, 1e-9, '12hr[0].OBVslope')
        assert.strictEqual(r3.vs[0].OBVdiv, 1, '12hr[0].OBVdiv')
        //  i=4: sumObv=obv2+obv3+obv4=-1+3+3=5, obvMa=5/3, OBVnorm=(3-5/3)/(5/3)=0.8
        //       obvPast=obv1=2 → OBVslope=(3-2)/(3*2)=1/6, OBVdiv: sign(3-2)=1 vs sign(C4-C1)=sign(13-12)=1 → 1
        assertNear(r3.vs[1].OBVnorm, 0.8, 1e-9, '12hr[1].OBVnorm')
        assertNear(r3.vs[1].OBVslope, 1 / 6, 1e-9, '12hr[1].OBVslope')
        assert.strictEqual(r3.vs[1].OBVdiv, 1, '12hr[1].OBVdiv')
        //  i=5: sumObv=obv3+obv4+obv5=3+3+9=15, obvMa=5, OBVnorm=(9-5)/5=0.8
        //       obvPast=obv2=-1 → OBVslope=(9-(-1))/(3*1)=10/3, OBVdiv: sign(9-(-1))=1 vs sign(C5-C2)=sign(15-11)=1 → 1
        assertNear(r3.vs[2].OBVnorm, 0.8, 1e-9, '12hr[2].OBVnorm')
        assertNear(r3.vs[2].OBVslope, 10 / 3, 1e-9, '12hr[2].OBVslope')
        assert.strictEqual(r3.vs[2].OBVdiv, 1, '12hr[2].OBVdiv')

        //16hr(len=4): 第一筆 i=4, 唯一一筆 (n-len=2)
        //  sumObv=obv1+obv2+obv3+obv4=2-1+3+3=7, obvMa=7/4, OBVnorm=(3-7/4)/(7/4)=5/7
        //  obvPast=obv0=0 → OBVslope=(3-0)/4=0.75, OBVdiv: sign(3-0)=1 vs sign(C4-C0)=sign(13-10)=1 → 1
        let r4 = pickPeriod(rrs, '16hr')
        assert.strictEqual(r4.vs.length, 2)
        assertNear(r4.vs[0].OBVnorm, 5 / 7, 1e-9, '16hr[0].OBVnorm')
        assertNear(r4.vs[0].OBVslope, 0.75, 1e-9, '16hr[0].OBVslope')
        assert.strictEqual(r4.vs[0].OBVdiv, 1, '16hr[0].OBVdiv')

        //20hr(len=5): 第一筆 i=5, 唯一一筆 (n-len=1)
        //  sumObv=obv1+..+obv5=2-1+3+3+9=16, obvMa=16/5, OBVnorm=(9-16/5)/(16/5)=29/16
        //  obvPast=obv0=0 → OBVslope=(9-0)/5=1.8, OBVdiv: sign(9-0)=1 vs sign(C5-C0)=sign(15-10)=1 → 1
        let r5 = pickPeriod(rrs, '20hr')
        assert.strictEqual(r5.vs.length, 1)
        assertNear(r5.vs[0].OBVnorm, 29 / 16, 1e-9, '20hr[0].OBVnorm')
        assertNear(r5.vs[0].OBVslope, 1.8, 1e-9, '20hr[0].OBVslope')
        assert.strictEqual(r5.vs[0].OBVdiv, 1, '20hr[0].OBVdiv')

        //1day(len=6)以上僅 6 根資料不足 (需 n>=len+1), 應為空
        assert.strictEqual(pickPeriod(rrs, '1day').vs.length, 0)
    })

    it('定值序列: OBV 恆為 0, OBVnorm/OBVslope 均為 0 且 OBVdiv 為 0 (無方向)', async function() {
        let arr = genFlat(30)
        let rrs = await calcObv(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assertNear(v.OBVnorm, 0, 1e-12, 'flat OBVnorm')
            assertNear(v.OBVslope, 0, 1e-12, 'flat OBVslope')
            assert.strictEqual(v.OBVdiv, 0, 'flat OBVdiv')
        })
    })

    it('全漲序列: OBV 單調遞增, OBVslope 恆為正且 OBVdiv 恆為 1 (量能與價格同向)', async function() {
        let arr = genUp(60)
        let rrs = await calcObv(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assert.ok(v.OBVslope > 0, `全漲 OBVslope 應 > 0, 實得 ${v.OBVslope}`)
            assert.strictEqual(v.OBVdiv, 1, '全漲 OBVdiv 應為 1')
        })
    })

    it('全跌序列: OBV 單調遞減, OBVslope 恆為負且 OBVdiv 恆為 1 (量能與價格同向下跌)', async function() {
        let arr = genDown(60)
        let rrs = await calcObv(arr, 'Close')
        pickPeriod(rrs, '1day').vs.forEach((v) => {
            assert.ok(v.OBVslope < 0, `全跌 OBVslope 應 < 0, 實得 ${v.OBVslope}`)
            assert.strictEqual(v.OBVdiv, 1, '全跌 OBVdiv 應為 1')
        })
    })

    it('資料筆數不足 (n < len+1) 時各期皆回傳空陣列', async function() {
        let arr = genOhlc(3)
        let rrs = await calcObv(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('Volumn 非數值時應拋出例外', async function() {
        let arr = genOhlc(20)
        arr[1].Volumn = 'x'
        await assert.rejects(calcObv(arr, 'Close'))
    })

})
