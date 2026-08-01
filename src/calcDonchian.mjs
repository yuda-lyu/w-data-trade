import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


let calcDonchian = (() => {

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

    let caDonchian = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //excludeCurrent, 視窗是否排除當前根
        //false: 視窗含當前根 (適合做 pctB 位置判斷, 對齊 BBpctB 行為)
        //true:  視窗不含當前根 (適合做突破信號, 不會永遠成立; 對齊 d14 methodVolumeBreakout 用法)
        let excludeCurrent = get(opt, 'excludeCurrent', false)

        //subMid: 先扣 mid 之均值 (去中心化), 預設 0 不扣
        //  目的: 原始 mid 偏負 (mean≈-3.4e-4, 69% 負/31% 正), 先扣均值讓正負樣本接近平衡 (47/53)
        //  之後 pow 變換 + plusMid 平移效果更可控
        let subMid = get(opt, 'subMid', 0)

        //plusMid: 平移 mid (扣均值後) 遠離 0, 對 mid≈0 之大宗樣本生效
        //  原 dcWidth = bandWidth / mid, index OHLC 之 mid 可 ≈0 或負 → ratio 爆
        //  命名 plusMid (非 plusClose) 因 mid 是 H/L 之 mid, 跟 close 不同來源
        let plusMid = get(opt, 'plusMid', 0)

        //powMid: 對 mid 之絕對值次方, 保留原符號之非線性變換
        //  powMid<1 對小值有擴大效果 (例: |x|=0.0001 開根號變 0.01)
        //  powMid=1 退化成線性
        //  powMid>1 對大值有擴大效果, 小值被壓更小
        let powMid = get(opt, 'powMid', 1)

        //plusBandWidth: 偏移 bandWidth (=upper-lower, ≥0) 為穩定 dcWidth 分子
        //  目的: 連動改善 dcWidthChangeMod (差分後分布過度擠 0 的問題)
        //  bandWidth 本身 ≥0, 故只加不減
        let plusBandWidth = get(opt, 'plusBandWidth', 0)

        //n
        let n = size(arr)

        //check
        if (n < len) {
            return []
        }

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //iStart: 第一個能算出值的 index
        //含當前根: 需 [0, len-1] 共 len 根 → iStart = len-1
        //不含當前根: 需 [0, len-1] 為視窗, 當前根 = len → iStart = len
        let iStart = excludeCurrent ? len : len - 1

        //rs
        let rs = []
        let widthPrev = null
        let widthModPrev = null

        for (let i = iStart; i < n; i++) {

            //視窗範圍 [winStart, winEnd] inclusive
            let winEnd
            let winStart
            if (excludeCurrent) {
                winEnd = i - 1
                winStart = i - len
            }
            else {
                winEnd = i
                winStart = i - len + 1
            }

            //掃 max(High) / min(Low)
            let upper = -Infinity
            let lower = Infinity
            for (let j = winStart; j <= winEnd; j++) {
                let h = arr[j][kHigh]
                let l = arr[j][kLow]

                //check
                if (!isNumber(h)) {
                    throw new Error(`invalid h[${h}]`)
                }
                if (!isNumber(l)) {
                    throw new Error(`invalid l[${l}]`)
                }

                if (h > upper) {
                    upper = h
                }
                if (l < lower) {
                    lower = l
                }
            }

            //c
            let c = arr[i][kClose]

            //check
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //mid, bandWidth
            let mid = (upper + lower) / 2
            let bandWidth = upper - lower

            //dcPctB = (Close - Lower) / (Upper - Lower), 0~1 (excludeCurrent=true 時可能 <0 或 >1)
            let dcPctB = bandWidth !== 0 ? (c - lower) / bandWidth : 0.5

            //dcWidth = (Upper - Lower) / Mid, 通道寬度 ratio (類比 BBwidth)
            let dcWidth = mid !== 0 ? bandWidth / mid : 0

            //dcWidthChange = dcWidth - dcWidth_prev
            let dcWidthChange = widthPrev !== null ? dcWidth - widthPrev : 0

            //dcWidthMod = (bandWidth+plusBandWidth) / (mid+plusMid), 對 index OHLC 之爆炸修正
            //  plusMid/plusBandWidth=0 時退化成原版 dcWidth (price 預設用法)
            //  plusBandWidth 在分子, plusMid 在分母, 兩者分別調控中心位置與分母穩定度
            let mids = mid - subMid
            let midsp = Math.sign(mids) * Math.abs(mids) ** powMid
            let midspp = midsp + plusMid
            let bandWidthp = bandWidth + plusBandWidth
            let dcWidthMod = diviProt(bandWidthp, midspp)

            //dcWidthChangeMod = dcWidthMod - dcWidthMod_prev (用 Mod ratio 之差分, 同源穩定)
            let dcWidthChangeMod = widthModPrev !== null ? dcWidthMod - widthModPrev : 0

            //push
            rs.push({
                time: arr[i][kTime],
                dcPctB,
                dcWidth,
                dcWidthChange,
                dcWidthMod,
                dcWidthChangeMod,
            })

            widthPrev = dcWidth
            widthModPrev = dcWidthMod

        }
        // console.log('rs', rs)

        return rs
    }

    let caDonchians = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caDonchian
            let rs = caDonchian(arr, len, opt)

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

    let calcDonchian = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,...},
        //   ...
        // ]

        //caDonchians
        let rs = caDonchians(arr, opt)

        return rs
    }

    return calcDonchian
})()


export default calcDonchian
