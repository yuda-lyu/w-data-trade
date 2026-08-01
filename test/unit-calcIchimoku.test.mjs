import assert from 'assert'
import calcIchimoku from '../src/calcIchimoku.mjs'
import { genOhlc, genFlat, genUp, genDown, ohlcFromCloses, valuesOf, pickPeriod, assertRrsShape, assertTimeAlign, assertNear, assertNearAll } from './unit-setup.mjs'


//規格來源: src/calcIchimoku.mjs (+ src/diviProt.mjs)
//  Ichimoku Cloud (一目均衡表) 標準定義, 三層 lookback 依 9:26:52 比例縮放
//    Tenkan(轉換線)[i]  = (最近 tenkan 根之最高 High + 最低 Low) / 2
//    Kijun (基準線)[i]  = (最近 kijun  根之最高 High + 最低 Low) / 2
//    SenkouA(先行帶A)[i] = (Tenkan[i-kijun] + Kijun[i-kijun]) / 2          (前置 kijun 根)
//    SenkouB(先行帶B)[i] = (i-kijun 期回看 senkouB 根之最高 High + 最低 Low) / 2
//    cloudTop = max(SenkouA, SenkouB), cloudBot = min(SenkouA, SenkouB)
//    cloudMid = (cloudTop + cloudBot)/2, bandWidth = cloudTop - cloudBot   (bandWidth 恆 >= 0)
//  keyOut:
//    cloudDist  = C!==0 ? (C - cloudMid)/C : 0    [src:158]
//    cloudThick = C!==0 ? bandWidth/C : 0         [src:161]
//    tkDiff     = C!==0 ? (Tenkan-Kijun)/C : 0    [src:164]
//    cloudDistMod  = diviProt(cp - (cloudMid+plusCloudMid), cp)   , cp = C + plusClose
//    cloudThickMod = diviProt(bandWidth + plusBandWidth, cp)
//    tkDiffMod     = diviProt(Tenkan + plusTenkans - Kijun, cp)
//      各 plus* 預設 0, 此時 *Mod 退化為原版; plusCloudMid=plusClose 時分子恢復 (C-cloudMid) [src:74-76]
//      diviProt: |分母| < 0.00001 時 clamp 至 ±0.00001 (保留 sign)
//  Chikou (遲行線) 不輸出 (原版為 look-ahead, 回測不可用)
//  第一筆輸出對應輸入索引 startIdx = max(2*kijun-1, kijun+senkouB-1); n < startIdx+1 時該期回傳 []
let kp = {
    '4day': { tenkan: 4, kijun: 12, senkouB: 24 },
    '7day': { tenkan: 7, kijun: 21, senkouB: 42 },
    '15day': { tenkan: 16, kijun: 45, senkouB: 90 },
    '30day': { tenkan: 31, kijun: 90, senkouB: 180 },
}

//kp 之 period → len (len 取 senkouB, 即最長 lookback), assertRrsShape 用
let kpLen = {}
Object.entries(kp).forEach(([period, cfg]) => {
    kpLen[period] = cfg.senkouB
})

//startIdx: 第一個四線俱全之索引
let refStartIdx = (cfg) => {
    return Math.max(2 * cfg.kijun - 1, cfg.kijun + cfg.senkouB - 1)
}

//參考實作: 暴力掃 [s, e] 之 (最高 High + 最低 Low) / 2
let refMid = (arr, s, e) => {
    let hi = -Infinity
    let lo = Infinity
    for (let j = s; j <= e; j++) {
        if (arr[j].High > hi) {
            hi = arr[j].High
        }
        if (arr[j].Low < lo) {
            lo = arr[j].Low
        }
    }
    return (hi + lo) / 2
}

//參考實作: 每根輸出各自暴力重掃四線
let refIchimoku = (arr, cfg) => {
    let n = arr.length
    let startIdx = refStartIdx(cfg)
    let rs = []
    for (let i = startIdx; i < n; i++) {
        let src = i - cfg.kijun
        let t = refMid(arr, i - cfg.tenkan + 1, i)
        let k = refMid(arr, i - cfg.kijun + 1, i)
        let sa = (refMid(arr, src - cfg.tenkan + 1, src) + refMid(arr, src - cfg.kijun + 1, src)) / 2
        let sb = refMid(arr, src - cfg.senkouB + 1, src)
        let c = arr[i].Close
        rs.push({
            time: arr[i].time,
            t,
            k,
            cloudTop: Math.max(sa, sb),
            cloudBot: Math.min(sa, sb),
            cloudMid: (Math.max(sa, sb) + Math.min(sa, sb)) / 2,
            bandWidth: Math.max(sa, sb) - Math.min(sa, sb),
            c,
        })
    }
    return rs
}

//參考實作: diviProt 之 clamp 規則 (|d| < 0.00001 時 clamp 至 ±0.00001, d===0 視為正)
let refDivi = (u, d) => {
    let dd = d
    if (Math.abs(dd) < 0.00001) {
        dd = dd < 0 ? -0.00001 : 0.00001
    }
    return u / dd
}

//手算例用資料: 前 31 根定值 10, 後 5 根定值 0 (無影線), 共 36 根恰為 4day 之最短長度
let arrZeroClose = () => {
    let cs = new Array(31).fill(10).concat(new Array(5).fill(0))
    return ohlcFromCloses(cs, { wick: 0 })
}


describe('calcIchimoku', function() {

    it('回傳結構須符合 kp 定義之 period 與 len (len 取 senkouB)', async function() {
        let arr = genOhlc(400)
        let rrs = await calcIchimoku(arr, 'Close')
        assertRrsShape(rrs, kpLen)
    })

    it('各期時間軸自 max(2*kijun-1, kijun+senkouB-1) 根起算並逐根對齊', async function() {
        let arr = genOhlc(400)
        let rrs = await calcIchimoku(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            assertTimeAlign(r.vs, arr, refStartIdx(cfg))
        })
    })

    it('cloudDist 須等於 (Close - cloudMid)/Close', async function() {
        let arr = genOhlc(400)
        let rrs = await calcIchimoku(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refIchimoku(arr, cfg).map((v) => {
                return (v.c - v.cloudMid) / v.c
            })
            assertNearAll(r.vs, 'cloudDist', exps, 1e-12, period)
        })
    })

    it('cloudThick 須等於 (cloudTop - cloudBot)/Close', async function() {
        let arr = genOhlc(400)
        let rrs = await calcIchimoku(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refIchimoku(arr, cfg).map((v) => {
                return v.bandWidth / v.c
            })
            assertNearAll(r.vs, 'cloudThick', exps, 1e-12, period)
        })
    })

    it('tkDiff 須等於 (轉換線 - 基準線)/Close', async function() {
        let arr = genOhlc(400)
        let rrs = await calcIchimoku(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let exps = refIchimoku(arr, cfg).map((v) => {
                return (v.t - v.k) / v.c
            })
            assertNearAll(r.vs, 'tkDiff', exps, 1e-12, period)
        })
    })

    it('各 plus* 皆為 0 時 *Mod 系列退化為原版', async function() {
        //src:166-168 註記 plusClose=0 時退化成原版, 此資料 Close 皆遠離 0 不觸發 clamp
        let arr = genOhlc(400)
        let rrs = await calcIchimoku(arr, 'Close')
        rrs.forEach((r) => {
            r.vs.forEach((v, i) => {
                assertNear(v.cloudDistMod, v.cloudDist, 1e-12, `${r.period} 第 ${i} 筆 cloudDistMod`)
                assertNear(v.cloudThickMod, v.cloudThick, 1e-12, `${r.period} 第 ${i} 筆 cloudThickMod`)
                assertNear(v.tkDiffMod, v.tkDiff, 1e-12, `${r.period} 第 ${i} 筆 tkDiffMod`)
            })
        })
    })

    it('手算例: 36 根等差上升序列於 4day 之三項輸出值', async function() {
        //genUp(36) step=1 無影線: C[i]=101+i, i>=1 時 High[i]=C[i]=101+i, Low[i]=C[i-1]=100+i
        //  第 0 根 O=C=101 → High=Low=101
        //4day 之 (tenkan,kijun,senkouB)=(4,12,24), startIdx=max(23,35)=35, n=36 → 恰 1 筆輸出
        //手算 (i=35, C=136):
        //  Tenkan[35] = (High[35] + Low[32])/2 = (136 + 132)/2 = 134
        //  Kijun [35] = (High[35] + Low[24])/2 = (136 + 124)/2 = 130
        //  srcIdx = 35-12 = 23
        //    Tenkan[23] = (High[23] + Low[20])/2 = (124 + 120)/2 = 122
        //    Kijun [23] = (High[23] + Low[12])/2 = (124 + 112)/2 = 118
        //    SenkouA[35] = (122 + 118)/2 = 120
        //    SenkouB[35] = 回看 0..23 = (High[23] + min Low)/2 = (124 + 101)/2 = 112.5   (第 0 根 Low=101 為最低)
        //  cloudTop=120, cloudBot=112.5, cloudMid=116.25, bandWidth=7.5
        //  cloudDist  = (136 - 116.25)/136 = 19.75/136
        //  cloudThick = 7.5/136
        //  tkDiff     = (134 - 130)/136 = 4/136
        let arr = genUp(36)
        let rrs = await calcIchimoku(arr, 'Close')
        let r = pickPeriod(rrs, '4day')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].time, arr[35].time)
        assertNear(r.vs[0].cloudDist, 19.75 / 136, 1e-12, '4day cloudDist')
        assertNear(r.vs[0].cloudThick, 7.5 / 136, 1e-12, '4day cloudThick')
        assertNear(r.vs[0].tkDiff, 4 / 136, 1e-12, '4day tkDiff')
        //7day 之 startIdx=62, n=36 不足, 故無輸出
        assert.strictEqual(pickPeriod(rrs, '7day').vs.length, 0)
    })

    it('手算例: Close=0 時原版三項走 0 保護, *Mod 走 diviProt clamp', async function() {
        //收盤前 31 根為 10, 後 5 根為 0 (無影線), 共 36 根 → 4day 恰 1 筆輸出 (i=35, C=0)
        //  第 0~30 根 High=Low=10; 第 31 根 O=10,C=0 → High=10,Low=0; 第 32~35 根 High=Low=0
        //手算 (i=35):
        //  Tenkan[35] = 回看 32..35 = (0+0)/2 = 0
        //  Kijun [35] = 回看 24..35 = (最高 10 + 最低 0)/2 = 5
        //  srcIdx=23 (全落在定值 10 區): Tenkan[23]=Kijun[23]=10 → SenkouA[35]=10
        //  SenkouB[35] = 回看 0..23 = (10+10)/2 = 10
        //  cloudTop=cloudBot=cloudMid=10, bandWidth=0
        //  C=0 → cloudDist/cloudThick/tkDiff 皆走 C!==0 之 else 給 0
        //  cp=0 → 分母 clamp 為 +0.00001
        //    cloudDistMod  = (0-10)/0.00001 = -1000000
        //    cloudThickMod = 0/0.00001 = 0
        //    tkDiffMod     = (0-5)/0.00001 = -500000
        let arr = arrZeroClose()
        let rrs = await calcIchimoku(arr, 'Close')
        let r = pickPeriod(rrs, '4day')
        assert.strictEqual(r.vs.length, 1)
        assert.strictEqual(r.vs[0].cloudDist, 0)
        assert.strictEqual(r.vs[0].cloudThick, 0)
        assert.strictEqual(r.vs[0].tkDiff, 0)
        assertNear(r.vs[0].cloudDistMod, -1000000, 1e-12, 'cloudDistMod')
        assert.strictEqual(r.vs[0].cloudThickMod, 0)
        assertNear(r.vs[0].tkDiffMod, -500000, 1e-12, 'tkDiffMod')
    })

    it('opt.plusClose 把分母改為 C+plusClose, 解除 Close=0 之爆炸', async function() {
        //承上例 (cloudMid=10, bandWidth=0, Tenkan=0, Kijun=5, C=0), plusClose=1 → cp=1
        //  cloudDistMod  = (1 - 10)/1 = -9
        //  cloudThickMod = (0 + 0)/1 = 0
        //  tkDiffMod     = (0 - 5)/1 = -5
        let arr = arrZeroClose()
        let rrs = await calcIchimoku(arr, 'Close', { plusClose: 1 })
        let v = pickPeriod(rrs, '4day').vs[0]
        assertNear(v.cloudDistMod, -9, 1e-12, 'cloudDistMod')
        assert.strictEqual(v.cloudThickMod, 0)
        assertNear(v.tkDiffMod, -5, 1e-12, 'tkDiffMod')
        //原版三項不受 opt 影響
        assert.strictEqual(v.cloudDist, 0)
        assert.strictEqual(v.tkDiff, 0)
    })

    it('opt.plusCloudMid 等於 plusClose 時 cloudDistMod 分子恢復 (C - cloudMid)', async function() {
        //src:74-76 註記: plusCloudMid = plusClose 時分子恢復原始 (c - cloudMid), 中心回到 0 而非 1
        //承上例 (cloudMid=10, C=0), plusClose=1 且 plusCloudMid=1 → (0-10)/1 = -10
        let arr = arrZeroClose()
        let rrs = await calcIchimoku(arr, 'Close', { plusClose: 1, plusCloudMid: 1 })
        let v = pickPeriod(rrs, '4day').vs[0]
        assertNear(v.cloudDistMod, -10, 1e-12, 'cloudDistMod')
    })

    it('opt.plusBandWidth 只加在 cloudThickMod 之分子', async function() {
        //承上例 (bandWidth=0, C=0), plusClose=1 且 plusBandWidth=2 → (0+2)/1 = 2
        let arr = arrZeroClose()
        let rrs = await calcIchimoku(arr, 'Close', { plusClose: 1, plusBandWidth: 2 })
        let v = pickPeriod(rrs, '4day').vs[0]
        assertNear(v.cloudThickMod, 2, 1e-12, 'cloudThickMod')
        //不影響其他項
        assertNear(v.cloudDistMod, -9, 1e-12, 'cloudDistMod')
        assertNear(v.tkDiffMod, -5, 1e-12, 'tkDiffMod')
    })

    it('opt.plusTenkans 只加在 tkDiffMod 之分子 (維持 t-k 之正負)', async function() {
        //承上例 (Tenkan=0, Kijun=5, C=0), plusClose=1 且 plusTenkans=3 → (0+3-5)/1 = -2
        let arr = arrZeroClose()
        let rrs = await calcIchimoku(arr, 'Close', { plusClose: 1, plusTenkans: 3 })
        let v = pickPeriod(rrs, '4day').vs[0]
        assertNear(v.tkDiffMod, -2, 1e-12, 'tkDiffMod')
        //不影響其他項
        assertNear(v.cloudDistMod, -9, 1e-12, 'cloudDistMod')
        assert.strictEqual(v.cloudThickMod, 0)
    })

    it('各 plus* 於一般序列須逐點符合公式', async function() {
        let arr = genOhlc(400)
        let opt = { plusClose: 20, plusCloudMid: 20, plusBandWidth: 5, plusTenkans: 7 }
        let rrs = await calcIchimoku(arr, 'Close', opt)
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let refs = refIchimoku(arr, cfg)
            assertNearAll(r.vs, 'cloudDistMod', refs.map((v) => {
                let cp = v.c + opt.plusClose
                return refDivi(cp - (v.cloudMid + opt.plusCloudMid), cp)
            }), 1e-12, `${period} cloudDistMod`)
            assertNearAll(r.vs, 'cloudThickMod', refs.map((v) => {
                let cp = v.c + opt.plusClose
                return refDivi(v.bandWidth + opt.plusBandWidth, cp)
            }), 1e-12, `${period} cloudThickMod`)
            assertNearAll(r.vs, 'tkDiffMod', refs.map((v) => {
                let cp = v.c + opt.plusClose
                return refDivi(v.t + opt.plusTenkans - v.k, cp)
            }), 1e-12, `${period} tkDiffMod`)
        })
    })

    it('雲厚不得為負, 且還原之 cloudMid 須落在雲層上下緣之間', async function() {
        //bandWidth = cloudTop - cloudBot 依定義 >= 0, Close 為正故 cloudThick >= 0
        //cloudMid 為上下緣之算術中點, 由 cloudMid = C*(1-cloudDist) 還原後須落在 [cloudBot, cloudTop]
        let arr = genOhlc(400)
        let cs = valuesOf(arr, 'Close')
        let rrs = await calcIchimoku(arr, 'Close')
        Object.entries(kp).forEach(([period, cfg]) => {
            let r = pickPeriod(rrs, period)
            let refs = refIchimoku(arr, cfg)
            let startIdx = refStartIdx(cfg)
            r.vs.forEach((v, i) => {
                assert.ok(v.cloudThick >= 0, `${period} 第 ${i} 筆 cloudThick 為負: ${v.cloudThick}`)
                let c = cs[startIdx + i]
                let cloudMid = c * (1 - v.cloudDist)
                assert.ok(cloudMid >= refs[i].cloudBot - 1e-9, `${period} 第 ${i} 筆 cloudMid 低於雲底`)
                assert.ok(cloudMid <= refs[i].cloudTop + 1e-9, `${period} 第 ${i} 筆 cloudMid 高於雲頂`)
            })
        })
    })

    it('定值序列之四線與價格同值, 三項輸出皆為 0', async function() {
        //O=H=L=C=100 → Tenkan=Kijun=SenkouA=SenkouB=100 → cloudMid=100, bandWidth=0
        //cloudDist=(100-100)/100=0, cloudThick=0/100=0, tkDiff=0/100=0
        let arr = genFlat(400)
        let rrs = await calcIchimoku(arr, 'Close')
        rrs.forEach((r) => {
            assert.ok(r.vs.length > 0, `${r.period} 應有輸出`)
            r.vs.forEach((v, i) => {
                assert.strictEqual(v.cloudDist, 0, `${r.period} 第 ${i} 筆 cloudDist`)
                assert.strictEqual(v.cloudThick, 0, `${r.period} 第 ${i} 筆 cloudThick`)
                assert.strictEqual(v.tkDiff, 0, `${r.period} 第 ${i} 筆 tkDiff`)
                assert.strictEqual(v.cloudDistMod, 0, `${r.period} 第 ${i} 筆 cloudDistMod`)
                assert.strictEqual(v.cloudThickMod, 0, `${r.period} 第 ${i} 筆 cloudThickMod`)
                assert.strictEqual(v.tkDiffMod, 0, `${r.period} 第 ${i} 筆 tkDiffMod`)
            })
        })
    })

    it('單調上升序列: 價格恆在雲上方 (cloudDist>0) 且轉換線恆高於基準線 (tkDiff>0)', async function() {
        //雲層由 kijun 根前之四線前置而來, 上升趨勢下該值必低於當下 Close → cloudDist>0
        //轉換線視窗較短, 上升時取樣區間較新 → Tenkan > Kijun → tkDiff>0
        let arr = genUp(400)
        let rrs = await calcIchimoku(arr, 'Close')
        rrs.forEach((r) => {
            assert.ok(r.vs.length > 0, `${r.period} 應有輸出`)
            r.vs.forEach((v, i) => {
                assert.ok(v.cloudDist > 0, `${r.period} 第 ${i} 筆 cloudDist 須為正: ${v.cloudDist}`)
                assert.ok(v.tkDiff > 0, `${r.period} 第 ${i} 筆 tkDiff 須為正: ${v.tkDiff}`)
            })
        })
    })

    it('單調下降序列: 價格恆在雲下方 (cloudDist<0) 且轉換線恆低於基準線 (tkDiff<0)', async function() {
        let arr = genDown(400)
        let rrs = await calcIchimoku(arr, 'Close')
        rrs.forEach((r) => {
            assert.ok(r.vs.length > 0, `${r.period} 應有輸出`)
            r.vs.forEach((v, i) => {
                assert.ok(v.cloudDist < 0, `${r.period} 第 ${i} 筆 cloudDist 須為負: ${v.cloudDist}`)
                assert.ok(v.tkDiff < 0, `${r.period} 第 ${i} 筆 tkDiff 須為負: ${v.tkDiff}`)
            })
        })
    })

    it('資料筆數不足 startIdx+1 時該期回傳空陣列', async function() {
        //n=35 未達 4day 之 startIdx+1=36
        let arr = genOhlc(35)
        let rrs = await calcIchimoku(arr, 'Close')
        rrs.forEach((r) => {
            assert.strictEqual(r.vs.length, 0, `${r.period} 應為空`)
        })
    })

    it('恰達 startIdx+1 根時該期僅輸出 1 筆', async function() {
        let arr = genOhlc(36)
        let rrs = await calcIchimoku(arr, 'Close')
        assert.strictEqual(pickPeriod(rrs, '4day').vs.length, 1)
        assert.strictEqual(pickPeriod(rrs, '7day').vs.length, 0)
    })

    it('Close 非數值時須拋錯 (src 之輸入檢查)', async function() {
        let arr = genOhlc(400)
        arr[399].Close = null
        await assert.rejects(calcIchimoku(arr, 'Close'), /invalid c/)
    })

})
