import assert from 'assert'
import calcKlr from '../src/calcKlr.mjs'
import { genOhlc, genFlat, genTimes, pickPeriod, assertRrsShape, assertTimeAlign, assertNear } from './unit-setup.mjs'


//規格來源: src/calcKlr.mjs (與 src/diviProt.mjs)
//  ho = diviProt(High+plusClose, Open+plusClose)  = H/O (含分母保護)
//  lo = diviProt(Low+plusClose,  Open+plusClose)  = L/O
//  co = diviProt(Close+plusClose,Open+plusClose)  = C/O
//  hc = diviProt(High+plusClose, Close+plusClose) = H/C
//  lc = diviProt(Low+plusClose,  Close+plusClose) = L/C
//  hl = diviProt(High+plusClose, Low+plusClose)   = H/L
//  diviProt(u,d): opt.plusDenominator 預設 0 (不啟用); |d|<0.00001 時 clamp 至 ±0.00001 (保留正負號), 回傳 u/d
//  opt.plusClose: 對 O/H/L/C 同步加上此偏移量後才計算比值 (預設 0)
//  len 固定為 1 (kp['4hr']=1), 迴圈自 i=0 起算全部 n 根皆有輸出; n<len 時該期回傳 []
let kp = {
    '4hr': 1,
}

//參考實作: 依 diviProt 定義之分母保護規則獨立算出安全除法 (不 import src/diviProt.mjs)
let divSafe = (u, d) => {
    if (Math.abs(d) < 0.00001) {
        d = d < 0 ? -0.00001 : 0.00001
    }
    return u / d
}

let refKlr = (o, h, l, c) => {
    return {
        ho: divSafe(h, o),
        lo: divSafe(l, o),
        co: divSafe(c, o),
        hc: divSafe(h, c),
        lc: divSafe(l, c),
        hl: divSafe(h, l),
    }
}


describe('calcKlr', function() {

    it('回傳結構須符合 kp 定義之 period 與 len', async function() {
        let arr = genOhlc(50)
        let rrs = await calcKlr(arr, 'Close')
        assertRrsShape(rrs, kp)
    })

    it('時間軸自第 0 根起算並逐根對齊 (len=1, 無累積)', async function() {
        let arr = genOhlc(50)
        let rrs = await calcKlr(arr, 'Close')
        let r = pickPeriod(rrs, '4hr')
        assertTimeAlign(r.vs, arr, 0)
    })

    it('手算例: O=10,H=14,L=8,C=12 之六比值', async function() {
        // ho=14/10=1.4, lo=8/10=0.8, co=12/10=1.2
        // hc=14/12=7/6, lc=8/12=2/3, hl=14/8=1.75
        let ts = genTimes(1)
        let arr = [
            { time: ts[0], Open: 10, High: 14, Low: 8, Close: 12 },
        ]
        let rrs = await calcKlr(arr, 'Close')
        let v = pickPeriod(rrs, '4hr').vs[0]
        assertNear(v.ho, 1.4, 1e-12, 'ho')
        assertNear(v.lo, 0.8, 1e-12, 'lo')
        assertNear(v.co, 1.2, 1e-12, 'co')
        assertNear(v.hc, 7 / 6, 1e-12, 'hc')
        assertNear(v.lc, 2 / 3, 1e-12, 'lc')
        assertNear(v.hl, 1.75, 1e-12, 'hl')
    })

    it('各根之六比值須逐點符合 diviProt 定義之公式', async function() {
        let arr = genOhlc(100)
        let rrs = await calcKlr(arr, 'Close')
        let vs = pickPeriod(rrs, '4hr').vs
        vs.forEach((v, i) => {
            let exp = refKlr(arr[i].Open, arr[i].High, arr[i].Low, arr[i].Close)
            assertNear(v.ho, exp.ho, 1e-9, `第 ${i} 筆 ho`)
            assertNear(v.lo, exp.lo, 1e-9, `第 ${i} 筆 lo`)
            assertNear(v.co, exp.co, 1e-9, `第 ${i} 筆 co`)
            assertNear(v.hc, exp.hc, 1e-9, `第 ${i} 筆 hc`)
            assertNear(v.lc, exp.lc, 1e-9, `第 ${i} 筆 lc`)
            assertNear(v.hl, exp.hl, 1e-9, `第 ${i} 筆 hl`)
        })
    })

    it('opt.plusClose 會同步平移 O/H/L/C 後才計算比值', async function() {
        let ts = genTimes(1)
        let arr = [
            { time: ts[0], Open: 10, High: 14, Low: 8, Close: 12 },
        ]
        // opt.plusClose=5 後: O=15,H=19,L=13,C=17
        let rrs = await calcKlr(arr, 'Close', { plusClose: 5 })
        let v = pickPeriod(rrs, '4hr').vs[0]
        assertNear(v.ho, 19 / 15, 1e-12, 'ho')
        assertNear(v.lo, 13 / 15, 1e-12, 'lo')
        assertNear(v.co, 17 / 15, 1e-12, 'co')
        assertNear(v.hc, 19 / 17, 1e-12, 'hc')
        assertNear(v.lc, 13 / 17, 1e-12, 'lc')
        assertNear(v.hl, 19 / 13, 1e-12, 'hl')
    })

    it('定值 K 線 (O=H=L=C) 時六比值皆為 1', async function() {
        let arr = genFlat(10, 100)
        let rrs = await calcKlr(arr, 'Close')
        let vs = pickPeriod(rrs, '4hr').vs
        vs.forEach((v, i) => {
            assertNear(v.ho, 1, 1e-12, `第 ${i} 筆 ho`)
            assertNear(v.lo, 1, 1e-12, `第 ${i} 筆 lo`)
            assertNear(v.co, 1, 1e-12, `第 ${i} 筆 co`)
            assertNear(v.hc, 1, 1e-12, `第 ${i} 筆 hc`)
            assertNear(v.lc, 1, 1e-12, `第 ${i} 筆 lc`)
            assertNear(v.hl, 1, 1e-12, `第 ${i} 筆 hl`)
        })
    })

    it('Open=0 時觸發 diviProt 分母 floor 保護 (clamp 至 +0.00001)', async function() {
        // d=Open=0, |0|<0.00001 且 (0<0)為 false, 故 clamp 為 +0.00001
        let ts = genTimes(1)
        let arr = [
            { time: ts[0], Open: 0, High: 5, Low: -5, Close: 2 },
        ]
        let rrs = await calcKlr(arr, 'Close')
        let v = pickPeriod(rrs, '4hr').vs[0]
        assertNear(v.ho, 5 / 0.00001, 1e-6, 'ho')
        assertNear(v.lo, -5 / 0.00001, 1e-6, 'lo')
        assertNear(v.co, 2 / 0.00001, 1e-6, 'co')
    })

    it('空輸入時該期回傳空陣列', async function() {
        let rrs = await calcKlr([], 'Close')
        assert.strictEqual(pickPeriod(rrs, '4hr').vs.length, 0)
    })

})
