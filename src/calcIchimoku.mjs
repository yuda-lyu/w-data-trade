import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


let calcIchimoku = (() => {

    //Ichimoku Cloud (一目均衡表)
    //
    //三層 lookback 嚴格按原版 Ichimoku 9 : 26 : 52 比例
    //period label = SenkouB (最長 lookback) 對應的天數 (4hr K 線; SenkouB = period × 6 根)
    //
    //Tenkan  = round(SenkouB × 9 / 52)   (短期動能線)
    //Kijun   = SenkouB / 2                (中期趨勢線)
    //SenkouB = period × 6                 (最長 lookback, 雲頂/底候選之一)
    //
    //僅保留 4day~30day, 短於 4day 時 Tenkan 會 < 4 失意義 (e.g. 1day 對應 Tenkan=1)
    //
    //keyOut:
    //  cloudDist  = (Close - cloudMid) / Close   (Close 相對 cloud 中心偏離 %, 正=多/負=空)
    //  cloudThick = (cloudTop - cloudBot) / Close (雲厚 ratio, 支撐/壓力強度)
    //  tkDiff     = (Tenkan - Kijun) / Close      (TK 動能差 ratio)
    //
    //註: cloudDist 不用 (Close - cloudBot) / bandWidth (=「在雲內 0~1 位置」), 因 Kumo Twist
    //    瞬間 bandWidth ≈ 0 會讓比值極端化 (實測 raw std=134, min/max 達 ±10000+).
    //    改用 cloudMid 標準化的偏離 % 永遠穩定.
    //
    //Chikou (遲行線) 不存: 原版是 Close[i+26] 為 look-ahead, 回測不可用; [d13 處理為 chikou[i]=Close[i]] 失意義
    let kp = {
        '4day': { tenkan: 4, kijun: 12, senkouB: 24 },
        '7day': { tenkan: 7, kijun: 21, senkouB: 42 },
        '15day': { tenkan: 16, kijun: 45, senkouB: 90 },
        '30day': { tenkan: 31, kijun: 90, senkouB: 180 },
    }


    //hhll: 取得 arr[startIdx..endIdx] (inclusive) 之 (max High + min Low) / 2
    let hhll = (arr, startIdx, endIdx, kHigh, kLow) => {
        let hi = -Infinity
        let lo = Infinity
        for (let j = startIdx; j <= endIdx; j++) {
            let h = arr[j][kHigh]
            let l = arr[j][kLow]
            if (h > hi) {
                hi = h
            }
            if (l < lo) {
                lo = l
            }
        }
        return (hi + lo) / 2
    }


    let caIchimoku = (arr, tenkan, kijun, senkouB, opt = {}) => {

        //check
        if (!isNumber(tenkan)) {
            throw new Error(`tenkan is not a number`)
        }
        if (!isNumber(kijun)) {
            throw new Error(`kijun is not a number`)
        }
        if (!isNumber(senkouB)) {
            throw new Error(`senkouB is not a number`)
        }

        //plusClose: 偏移 close 為穩定分母 (cp = c + plusClose)
        let plusClose = get(opt, 'plusClose', 0)

        //plusCloudMid: 偏移 cloudMid 為穩定 cloudDist 分子
        //  cloudDistMod = (cp - cloudMidp) / cp = ((c-cloudMid) + (plusClose-plusCloudMid)) / cp
        //  當 plusCloudMid = plusClose 時, 分子恢復原始 (c - cloudMid), 中心回到 0 而非 1
        let plusCloudMid = get(opt, 'plusCloudMid', 0)

        //plusBandWidth: 偏移 bandWidth 為穩定 cloudThick 分子 (bandWidth 本身 ≥0, 故只加不減)
        let plusBandWidth = get(opt, 'plusBandWidth', 0)

        //plusTenkans: 偏移 tenkan 與 kijun 為穩定 tkDiff 分子, 解決 t-k 雙峰分布
        //  t 與 k 同步偏移, 維持 (t-k) 之 sign, 但讓兩者基準遠離 0 → 比例變化變平緩
        let plusTenkans = get(opt, 'plusTenkans', 0)

        //n
        let n = size(arr)

        //startIdx: 第一個能算出全部 4 線之 index
        //  Tenkan/Kijun 直接算: 需 kijun-1 根之前
        //  SenkouA: 需 i-kijun 之 Tenkan/Kijun 都已存在 → i 至少 2*kijun-1
        //  SenkouB: 需 i-kijun 期回看 senkouB 根 → i 至少 kijun + senkouB - 1
        let startIdx = Math.max(2 * kijun - 1, kijun + senkouB - 1)
        if (n < startIdx + 1) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //先 forward 算 Tenkan, Kijun 全序列
        let tenkans = new Array(n).fill(null)
        let kijuns = new Array(n).fill(null)
        for (let i = 0; i < n; i++) {
            if (i >= tenkan - 1) {
                tenkans[i] = hhll(arr, i - tenkan + 1, i, kHigh, kLow)
            }
            if (i >= kijun - 1) {
                kijuns[i] = hhll(arr, i - kijun + 1, i, kHigh, kLow)
            }
        }

        //再 forward 算 SenkouA, SenkouB (含 forward shift: 用 i-kijun 期前的值前置到當下 i)
        //SenkouA[i] = (Tenkan[i-kijun] + Kijun[i-kijun]) / 2
        //SenkouB[i] = hhll(High/Low, i-kijun-senkouB+1, i-kijun)
        let senkouAs = new Array(n).fill(null)
        let senkouBs = new Array(n).fill(null)
        for (let i = 0; i < n; i++) {
            let srcIdx = i - kijun
            if (srcIdx < 0) {
                continue
            }
            let t = tenkans[srcIdx]
            let k = kijuns[srcIdx]
            if (t !== null && k !== null) {
                senkouAs[i] = (t + k) / 2
            }
            if (srcIdx >= senkouB - 1) {
                senkouBs[i] = hhll(arr, srcIdx - senkouB + 1, srcIdx, kHigh, kLow)
            }
        }

        //rs
        let rs = []
        for (let i = startIdx; i < n; i++) {
            let t = tenkans[i]
            let k = kijuns[i]
            let sa = senkouAs[i]
            let sb = senkouBs[i]
            let c = arr[i][kClose]

            //check (理論上 i >= startIdx 後皆有值, 但仍保留 defensive 檢查)
            if (t === null || k === null || sa === null || sb === null) {
                continue
            }
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //cloud 上下邊界
            let cloudTop = Math.max(sa, sb)
            let cloudBot = Math.min(sa, sb)
            let cloudMid = (cloudTop + cloudBot) / 2
            let bandWidth = cloudTop - cloudBot

            //cloudDist: Close 相對 cloudMid 偏離 % (正=多頭/負=空頭, 永遠穩定不爆炸)
            let cloudDist = c !== 0 ? (c - cloudMid) / c : 0

            //cloudThick: 雲厚相對 Close 之比例 (支撐/壓力強度)
            let cloudThick = c !== 0 ? bandWidth / c : 0

            //tkDiff: Tenkan vs Kijun 動能差 (TK Cross 連續版)
            let tkDiff = c !== 0 ? (t - k) / c : 0

            //*Mod = 對 close 加 plusClose 為穩定分母, 對 index OHLC (close 可 ≈0 或負) 修正除法爆炸
            //  plusClose=0 時退化成原版 (price 預設用法)
            //  plusClose>0 時把 close 偏移正方向, 解決 close ≈ 0 之 outlier
            //  diviProt 額外保護: |分母| < 0.00001 時 floor 至 ±0.00001 (保留 sign)
            let cp = c + plusClose
            let cloudMidp = cloudMid + plusCloudMid
            let bandWidthp = bandWidth + plusBandWidth
            let tenkansp = t + plusTenkans
            let cloudDistMod = diviProt(cp - cloudMidp, cp)
            let cloudThickMod = diviProt(bandWidthp, cp)
            let tkDiffMod = diviProt(tenkansp - k, cp)

            rs.push({
                time: arr[i][kTime],
                cloudDist,
                cloudThick,
                tkDiff,
                cloudDistMod,
                cloudThickMod,
                tkDiffMod,
            })
        }
        // console.log('rs', rs)

        return rs
    }

    let caIchimokus = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (cfg, period) => {

            //caIchimoku
            let rs = caIchimoku(arr, cfg.tenkan, cfg.kijun, cfg.senkouB, opt)

            //push (用 senkouB 當 period 的代表 length, 對應最長 lookback)
            rrs.push({
                period,
                len: cfg.senkouB,
                vs: rs,
            })
            // console.log('rrs', rrs)

        })

        return rrs
    }

    let calcIchimoku = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   ...
        // ]

        //caIchimokus
        let rs = caIchimokus(arr, opt)

        return rs
    }

    return calcIchimoku
})()


export default calcIchimoku
