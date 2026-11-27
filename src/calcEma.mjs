import each from 'lodash-es/each.js'
import getOptReader from 'wsemi/src/getOptReader.mjs'
import pickValue from './pickValue.mjs'
import caEma from './caEma.mjs'
import resolvePeriods from './resolvePeriods.mjs'


/**
 * 計算各週期之指數移動平均EMA(Exponential Moving Average)
 *
 * 各週期len為該期涵蓋之K線根數(根數為本，任何每根時長下不變；期別標籤為根數×每根時長，每根4hr時'1day'即6根)，資料筆數不足該期len時，該期vs為空陣列
 * 第1筆為種子值(取前len筆之算術平均SMA)，對應輸入之第len根，物件僅含{time,param}
 * 其後各筆依EMA公式(alpha=2/(len+1))遞推，逐根對齊至最後一根，物件另含{value,diff,ratio}
 * diff=EMA-現值，ratio=diff/現值(現值為0時ratio給0)
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-trade/blob/master/test/unit-calcEma.test.mjs Github}
 * @function
 * @param {Array} arr 輸入K線陣列，各元素需含time與計算所用之數值欄位
 * @param {String} key 輸入計算所用數值欄位名稱字串，例如'Close'
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number|String} [opt.intervalSec=14400] 輸入每根K線之秒數，60之正整數倍且至多31536000(數值或數字字串)，各期根數不變(根數為本)，期別標籤為根數×每根秒數之時間跨度(例：每根1day時3根之期為'3day')，預設14400(每根4hr，標籤與根數皆同內建表)，無效時reject
 * @param {Object} [opt.kp] 輸入直接採用之週期表物件，鍵為週期標籤，值為正整數根數或參數物件，給予時不換算，預設採內建週期表，非預期之輸入視為未給
 * @param {Boolean} [opt.debug=false] 輸入是否於opt.kp、opt.norm出現非預期輸入(視為未給、改用預設)時輸出警告布林值，須恰為true才生效，警告為固定詞彙、不含傳入之值，同一個鍵每個行程只警告一次，預設false
 * @param {Function} [opt.funLog] 輸入警告出口函數，以(msg, { fn, reason, key })呼叫，未給則用console.warn，預設未給
 * @param {Boolean} [opt.norm=false] 輸入是否將param改為EMA與現值之偏離比例(EMA-現值)/現值布林值，預設false；只收true與false(不收1、0、'true'、'y'等)，非預期之輸入視為未給而改用預設
 * @returns {Promise} 回傳Promise，resolve為各期結果陣列，各元素為{period,len,vs}，vs內各元素為{time,param}(第1筆種子值僅含{time,param}，其後各筆另含{value,diff,ratio})
 * @example
 *
 * let arr = [
 *     { time: '2020-01-01T00:00:00', Open: 101, High: 101.5, Low: 100.5, Close: 101 },
 *     { time: '2020-01-01T04:00:00', Open: 101, High: 105.17, Low: 99.28, Close: 103.45 },
 *     { time: '2020-01-01T08:00:00', Open: 103.45, High: 108.74, Low: 101.35, Close: 106.64 },
 *     { time: '2020-01-01T12:00:00', Open: 106.64, High: 111.54, Low: 104.68, Close: 109.58 },
 *     { time: '2020-01-01T16:00:00', Open: 109.58, High: 112.76, Low: 108.18, Close: 111.37 },
 *     { time: '2020-01-01T20:00:00', Open: 111.37, High: 112.3, Low: 110.72, Close: 111.65 },
 * ]
 *
 * calcEma(arr, 'Close')
 *     .then((rs) => {
 *         console.log(rs[0].vs)
 *         // => [ { time: '2020-01-01T20:00:00', param: 107.28166666666665 } ]
 *     })
 *
 */
let calcEma = (() => {

    let KP = { //內建週期表(值為根數; 標籤以每根4hr寫定: '12hr'=3根、'1day'=6根), 實際週期表由resolvePeriods依opt.intervalSec(根數不變、標籤換算)或opt.kp決定
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
        '15day': 90, // 15 days = 90 * 4 hours
        '30day': 180, // 30 days = 180 * 4 hours
    }

    let caEmas = (vs, opt = {}) => {

        //kp, 週期表(resolvePeriods: opt.intervalSec根數不變、標籤依根數×每根時長換算, 未給時同內建表; opt.kp直接採用)
        let kp = resolvePeriods(KP, opt)

        //norm, opt各鍵經getOptReader讀取一次(給了即檢測, 非預期之輸入視為未給而改用預設, opt.debug為true時警告); 布林只收true與false, 讀得之值交caEma(其再檢測為有效, 不重複警告)
        let rd = getOptReader('w-data-trade calcEma', opt)
        let norm = rd('norm', false, (v) => typeof v === 'boolean', 'a boolean', 'false')

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caEma
            let rs = caEma(vs, len, { norm })

            //push
            rrs.push({
                period,
                len,
                vs: rs,
            })

        })

        return rrs
    }

    let calcEma = async (arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        //pickValue
        let vs = pickValue(arr, key) //轉為 { time, value }

        //caEmas
        let rs = caEmas(vs, opt)

        return rs
    }

    return calcEma
})()


export default calcEma
