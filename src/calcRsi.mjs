import isNumber from 'lodash-es/isNumber.js'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'


/**
 * 計算各週期之相對強弱指標RSI(Relative Strength Index，採Wilder平滑法)
 *
 * 各週期len為該期涵蓋之K線根數(以4hr K線為基準，1day=6根)，資料筆數n小於len+1時，該期vs為空陣列
 * 每根漲跌diff=Close-前一根Close，漲幅up=max(diff,0)，跌幅down=max(-diff,0)
 * 種子(opt.seed='sma'，預設)：avgGain為第1至len根up之算術平均，avgLoss為第1至len根down之算術平均
 * 種子(opt.seed='first')：avgGain、avgLoss分別取第1根之up、down，再以Wilder遞推方式(avg=(avg*(len-1)+x)/len)推進至第len根
 * 其後每根皆以avg=(avg*(len-1)+x)/len遞推；RS=avgGain/avgLoss，RSI=100-100/(1+RS)
 * avgGain與avgLoss皆小於等於opt.eps時RSI給50(完全平盤)，僅avgLoss小於等於opt.eps時給100(一路上漲)，僅avgGain小於等於opt.eps時給0(一路下跌)
 * 各期第1筆對應輸入之第len根，其後逐根對齊至最後一根
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcRsi.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time、Close等欄位
 * @param {String} key 輸入計算所用數值欄位名稱字串，目前未實際使用(內部固定採用Close)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.seed='sma'] 輸入種子avgGain、avgLoss之計算方式，'sma'為前len根之算術平均，'first'為取第1根再以Wilder遞推至第len根，預設'sma'
 * @param {Number} [opt.eps=1e-12] 輸入視avgGain、avgLoss為0之門檻值，預設1e-12
 * @returns {Promise} 回傳Promise，resolve為各期結果陣列，各元素為{period,len,vs}，vs內各元素為{time,RSI,rsiAvgGain,rsiAvgLoss,rsiUp,rsiDown}
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Close: 10 },
 *     { time: '2020-01-01T04:00:00', Close: 11 },
 *     { time: '2020-01-01T08:00:00', Close: 10.5 },
 *     { time: '2020-01-01T12:00:00', Close: 12 },
 * ]
 *
 * calcRsi(arr, 'Close')
 *     .then((rs) => {
 *         console.log(rs[0])
 *         // => {
 *         //   period: '12hr',
 *         //   len: 3,
 *         //   vs: [ { time: '2020-01-01T12:00:00', RSI: 83.33333333333334, rsiAvgGain: 0.8333333333333334, rsiAvgLoss: 0.16666666666666666, rsiUp: 1.5, rsiDown: 0 } ]
 *         // }
 *     })
 *
 */
let calcRsi = (() => {

    let kp = {
        '12hr': 3,
        '16hr': 4,
        '20hr': 5,
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
    }

    let caRsi = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //seed
        let seed = get(opt, 'seed', 'sma')

        //eps
        let eps = get(opt, 'eps', 1e-12)

        //n
        let n = size(arr)

        //check
        if (n < len + 1) {
            return []
        }

        let kTime = 'time'
        // let kHigh = 'High'
        // let kLow = 'Low'
        let kClose = 'Close'

        //每根的漲跌ups, downs
        let ups = new Array(n).fill(0)
        let downs = new Array(n).fill(0)
        for (let i = 1; i < n; i++) {

            let c0 = arr[i - 1][kClose]
            let c1 = arr[i][kClose]

            //check
            if (!isNumber(c0)) {
                throw new Error(`invalid c0[${c0}]`)
            }
            if (!isNumber(c1)) {
                throw new Error(`invalid c1[${c1}]`)
            }

            //diff
            let diff = c1 - c0

            //save
            ups[i] = diff > 0 ? diff : 0
            downs[i] = diff < 0 ? -diff : 0

        }

        //種子avgGain, avgLoss
        let avgGain = 0
        let avgLoss = 0
        if (seed === 'first') {
            avgGain = ups[1]
            avgLoss = downs[1]
            //把2至len用Wilder方式跑到len
            for (let i = 2; i <= len; i++) {
                avgGain = (avgGain * (len - 1) + ups[i]) / len
                avgLoss = (avgLoss * (len - 1) + downs[i]) / len
            }
        }
        else {
            //sma用1至len的平均做初始
            let sumGain = 0
            let sumLoss = 0
            for (let i = 1; i <= len; i++) {
                sumGain += ups[i]
                sumLoss += downs[i]
            }
            avgGain = sumGain / len
            avgLoss = sumLoss / len
        }

        let calcRsiValue = (g, l) => {
            //avgLoss=0 -> RSI=100 (一路上漲)
            //avgGain=0 & avgLoss=0 -> RSI=50 (完全平盤)
            if (l <= eps && g <= eps) return 50
            if (l <= eps) return 100
            if (g <= eps) return 0
            let RS = g / l
            return 100 - (100 / (1 + RS))
        }

        //rs
        let rs = []
        {
            let rsi = calcRsiValue(avgGain, avgLoss)
            rs.push({
                time: arr[len][kTime],
                RSI: rsi,
                rsiAvgGain: avgGain,
                rsiAvgLoss: avgLoss,
                rsiUp: ups[len],
                rsiDown: downs[len],
            })
        }
        for (let i = len + 1; i < n; i++) {
            avgGain = (avgGain * (len - 1) + ups[i]) / len
            avgLoss = (avgLoss * (len - 1) + downs[i]) / len
            let rsi = calcRsiValue(avgGain, avgLoss)
            rs.push({
                time: arr[i][kTime],
                RSI: rsi, //相對強弱
                rsiAvgGain: avgGain, //上漲動能
                rsiAvgLoss: avgLoss, //下跌動能
                rsiUp: ups[i], //單根上漲
                rsiDown: downs[i], //單根下跌
            })
        }
        // console.log('rs', rs)

        return rs
    }

    let caRsis = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caRsi
            let rs = caRsi(arr, len, opt)

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

    let calcRsi = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        // //pickValue
        // let vs = pickValue(arr, key) //轉為 { time, value }

        //caRsis
        let rs = caRsis(arr, opt)

        return rs
    }

    return calcRsi
})()


export default calcRsi
