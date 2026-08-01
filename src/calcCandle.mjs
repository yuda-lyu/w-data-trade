import size from 'lodash-es/size.js'
import isNumber from 'lodash-es/isNumber.js'
import each from 'lodash-es/each.js'


let calcCandle = (() => {

    //Candle Pattern (K 線型態) - 連續強度版
    //
    //K 線型態本質是每根 K 線自身的形狀, 無 period 累積概念
    //period='4hr' 對應「當下這根 4hr K 線本身」, len=1
    //
    //keyOut (5 個): 4 個結構特徵 + 1 個雙根關係
    //  bodyRatio       = |Close - Open| / (High - Low)     實體佔比 (0~1)
    //  upperWickRatio  = (High - max(O,C)) / (High - Low)  上影佔比 (0~1)
    //  lowerWickRatio  = (min(O,C) - Low) / (High - Low)   下影佔比 (0~1)
    //  candleDir       = (Close - Open) / (High - Low)     方向 + 強度 (-1~+1)
    //  engulfStrength  = signCurr × body_curr / prev_range (當兩根反向時, 否則 0)
    //                    正值大 → 強多吞噬, 負值大 → 強空吞噬
    //                    注: 用 prev_range 而非 prev_body 當分母, 避免 prev 為 doji 時除小爆炸
    //
    //設計原則: DE 自學「型態」組合 (如 bodyRatio<0.3 + lowerWickRatio>0.5 + candleDir>0 → Hammer-like)
    //不硬編型態名稱, 避免 boolean DE 不友善問題
    let kp = {
        '4hr': 1, // 4 小時 = 1 根 4hr K (僅當下根, 無累積)
    }

    let caCandle = (arr, len, opt = {}) => {

        //len 在此固定為 1, 保留參數對齊 d03 介面慣例

        //n
        let n = size(arr)

        //check, 需至少 2 根 (engulfStrength 需前一根)
        if (n < 2) {
            return []
        }

        let kTime = 'time'
        let kOpen = 'Open'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //rs
        let rs = []

        //從 i=1 開始 (engulfStrength 需 i-1)
        for (let i = 1; i < n; i++) {

            let o = arr[i][kOpen]
            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let c = arr[i][kClose]

            //check
            if (!isNumber(o)) {
                throw new Error(`invalid o[${o}]`)
            }
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //K 線結構量
            let range = h - l
            let body = Math.abs(c - o)
            let upperWick = h - Math.max(o, c)
            let lowerWick = Math.min(o, c) - l

            //結構特徵 (4 個 ratio, range=0 時設 0; 真實 K 線 range 極少為 0)
            let bodyRatio = range !== 0 ? body / range : 0
            let upperWickRatio = range !== 0 ? upperWick / range : 0
            let lowerWickRatio = range !== 0 ? lowerWick / range : 0
            //candleDir: (c-o)/range, 含方向 (sign) + 強度 (magnitude), -1~+1
            let candleDir = range !== 0 ? (c - o) / range : 0

            //engulfStrength: 雙根反向時, signCurr × body/prevRange; 同向時為 0
            //用 prevRange (前根 H-L) 而非 prevBody 當分母, 避免 prev 為 doji 時除小爆炸
            let pH = arr[i - 1][kHigh]
            let pL = arr[i - 1][kLow]
            let pO = arr[i - 1][kOpen]
            let pC = arr[i - 1][kClose]
            let prevRange = pH - pL
            let signCurr = Math.sign(c - o)
            let signPrev = Math.sign(pC - pO)

            let engulfStrength = 0
            if (signCurr !== 0 && signPrev !== 0 && signCurr !== signPrev && prevRange > 0) {
                //兩根反向 + prev 有範圍, 才視為 engulf 候選
                engulfStrength = signCurr * (body / prevRange)
                //bullish (curr 陽, prev 陰): +1 × ratio = 正
                //bearish (curr 陰, prev 陽): -1 × ratio = 負
            }

            rs.push({
                time: arr[i][kTime],
                bodyRatio,
                upperWickRatio,
                lowerWickRatio,
                candleDir,
                engulfStrength,
            })
        }
        // console.log('rs', rs)

        return rs
    }

    let caCandles = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caCandle
            let rs = caCandle(arr, len, opt)

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

    let calcCandle = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,...},
        //   ...
        // ]

        //caCandles
        let rs = caCandles(arr, opt)

        return rs
    }

    return calcCandle
})()


export default calcCandle
