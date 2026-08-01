import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


let calcBbpb = (() => {

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

    let caBbpb = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //k, 布林帶倍數(預設2倍標準差)
        let k = get(opt, 'k', 2)

        //subMid: 先扣 middle 之均值 (去中心化), 預設 0 不扣
        //  原 BBwidth = bandWidth / middle, index OHLC 之 middle=SMA(close) 可 ≈0 或負 (99.5% |mid|<0.001)
        //  公式: mids = middle - subMid
        //        midsp = sign(mids) * |mids|^powMid + plusMid
        //        BBwidthMod = (bandWidth + plusBandWidth) / midsp
        //  此處變數名沿用 Donchian 之 plusMid 系列 (因兩指標分母均為 ohlc 衍生中線, 語意同)
        let subMid = get(opt, 'subMid', 0)

        //plusMid: 平移 mid (扣均值後) 遠離 0
        let plusMid = get(opt, 'plusMid', 0)

        //powMid: 對 mid 之絕對值次方, 保留原符號 (powMid=0.5 為 sqrt)
        let powMid = get(opt, 'powMid', 1)

        //plusBandWidth: 偏移 bandWidth (=upper-lower, ≥0) 為穩定 BBwidth 分子, 連動微調差分分布
        let plusBandWidth = get(opt, 'plusBandWidth', 0)

        //n
        let n = size(arr)

        //check
        if (n < len) {
            return []
        }

        let kTime = 'time'
        let kClose = 'Close'

        //用running sum維持視窗內的sum與sumSq
        let sumClose = 0
        let sumCloseSq = 0

        //rs
        let rs = []
        let bwPrev = null
        let bwModPrev = null
        for (let i = 0; i < n; i++) {

            let c = arr[i][kClose]

            //check
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //加入running sum
            sumClose += c
            sumCloseSq += c * c

            //維護視窗大小, 扣掉超出視窗的最舊值
            let idxDrop = i - len
            if (idxDrop >= 0) {
                let cDrop = arr[idxDrop][kClose]
                sumClose -= cDrop
                sumCloseSq -= cDrop * cDrop
            }

            //check, 視窗未滿len
            if (i < len - 1) {
                continue
            }

            //Middle Band = SMA(Close, period)
            let middle = sumClose / len

            //StdDev = sqrt(E[X^2] - (E[X])^2)
            let variance = (sumCloseSq / len) - (middle * middle)
            if (variance < 0) variance = 0 //避免浮點誤差
            let sigma = Math.sqrt(variance)

            //Upper / Lower Band
            let upper = middle + k * sigma
            let lower = middle - k * sigma

            //BBpctB = (Close - Lower) / (Upper - Lower)
            let bandWidth = upper - lower
            let BBpctB = bandWidth !== 0 ? (c - lower) / bandWidth : 0.5

            //BBwidth = (Upper - Lower) / Middle
            let BBwidth = middle !== 0 ? bandWidth / middle : 0

            //BBwidthChange = BW - BW_prev
            let BBwidthChange = bwPrev !== null ? BBwidth - bwPrev : 0

            //BBwidthMod = (bandWidth+plusBandWidth) / midsp, 對 index OHLC 之爆炸修正
            //  subMid/plusMid/powMid/plusBandWidth=0 時退化成原版 BBwidth (price 預設用法)
            let mids = middle - subMid
            let midsp = Math.sign(mids) * Math.abs(mids) ** powMid
            let midspp = midsp + plusMid
            let bandWidthp = bandWidth + plusBandWidth
            let BBwidthMod = diviProt(bandWidthp, midspp)

            //BBwidthChangeMod = BBwidthMod - BBwidthMod_prev (用 Mod ratio 之差分, 同源穩定)
            let BBwidthChangeMod = bwModPrev !== null ? BBwidthMod - bwModPrev : 0

            //push
            rs.push({
                time: arr[i][kTime],
                BBpctB,
                BBwidth,
                BBwidthChange,
                BBwidthMod,
                BBwidthChangeMod,
            })

            bwPrev = BBwidth
            bwModPrev = BBwidthMod

        }
        // console.log('rs', rs)

        return rs
    }

    let caBbpbs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caBbpb
            let rs = caBbpb(arr, len, opt)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })
            // console.log('rrs', rrs)

        })

        return rrs
    }

    let calcBbpb = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,...},
        //   ...
        // ]

        //caBbpbs
        let rs = caBbpbs(arr, opt)

        return rs
    }

    return calcBbpb
})()


export default calcBbpb
