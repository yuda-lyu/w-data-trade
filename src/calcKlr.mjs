import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import diviProt from './diviProt.mjs'


/**
 * 計算各週期之K線OHLC比值(K-Line OHLC Ratio)
 *
 * 僅一期'4hr'(len固定為1)，逐根獨立計算同根Open/High/Low/Close間之六種比值，不需回看歷史根數，
 * 輸出自輸入索引0起，逐根對齊至最後一根，資料筆數不足len(即輸入為空陣列)時，該期vs為空陣列
 * ho=H/O，lo=L/O，co=C/O，hc=H/C，lc=L/C，hl=H/L，六比值皆先將O/H/L/C同步加上opt.plusClose後才經diviProt計算(分母保護：|分母|<0.00001時clamp至±0.00001，保留符號)
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcKlr.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time、Open、High、Low、Close欄位
 * @param {String} key 輸入計算所用數值欄位名稱字串，例如'Close'(僅供介面一致性，本函式實際計算取用Open/High/Low/Close)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.plusClose=0] 輸入對Open/High/Low/Close同步加上之偏移量，加完後才計算六比值，預設0
 * @returns {Promise} 回傳Promise，resolve為各期結果陣列，各元素為{period,len,vs}，vs內各元素為{time,ho,lo,co,hc,lc,hl}
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Open: 101, High: 101.5, Low: 100.5, Close: 101 },
 * ]
 *
 * calcKlr(arr, 'Close')
 *     .then((rs) => {
 *         console.log(rs[0].vs)
 *         // => [
 *         //   {
 *         //     time: '2020-01-01T00:00:00',
 *         //     ho: 1.004950495049505,
 *         //     lo: 0.995049504950495,
 *         //     co: 1,
 *         //     hc: 1.004950495049505,
 *         //     lc: 0.995049504950495,
 *         //     hl: 1.0099502487562189
 *         //   }
 *         // ]
 *     })
 *
 */
let calcKlr = (() => {

    let kp = {
        '4hr': 1,
    }

    let caKlr = (arr, len, opt = {}) => {

        //check
        if (!isNumber(len)) {
            throw new Error(`len is not a number`)
        }

        //n
        let n = size(arr)

        //check
        if (n < len) {
            return []
        }

        //plusClose
        let plusClose = get(opt, 'plusClose', 0)

        let kTime = 'time'
        let kOpen = 'Open'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        //rs
        let rs = []
        for (let i = 0; i < n; i++) {

            //o, h, l, c
            let o = arr[i][kOpen] + plusClose
            let h = arr[i][kHigh] + plusClose
            let l = arr[i][kLow] + plusClose
            let c = arr[i][kClose] + plusClose
            // console.log(`arr[${i}]`, arr[i])

            //ho, h/o
            let ho = diviProt(h, o)

            //lo, l/o
            let lo = diviProt(l, o)

            //co, c/o
            let co = diviProt(c, o)

            //hc, h/c
            let hc = diviProt(h, c)

            //lc, l/c
            let lc = diviProt(l, c)

            //hl, h/l
            let hl = diviProt(h, l)

            //push
            rs.push({
                time: arr[i][kTime],
                ho,
                lo,
                co,
                hc,
                lc,
                hl,
            })

        }
        // console.log('rs', rs)

        return rs
    }

    let caKlrs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caKlr
            let rs = caKlr(arr, len, opt)

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })

        })

        return rrs
    }

    let calcKlr = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        // //pickValue
        // let vs = pickValue(arr, key) //轉為 { time, value }

        //caKlrs
        let rs = caKlrs(arr, opt)

        return rs
    }

    return calcKlr
})()


export default calcKlr
