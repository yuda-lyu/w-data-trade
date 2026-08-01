import isNumber from 'lodash-es/isNumber.js'
import size from 'lodash-es/size.js'
import last from 'lodash-es/last.js'
import each from 'lodash-es/each.js'


let calcKdj = (() => {

    // import w from 'wsemi'
    // import pickValue from './pickValue.mjs'


    let kp = {
        '1day': 6, // 1 day = 6 * 4 hours
        '2day': 12, // 2 days = 12 * 4 hours
        '4day': 24, // 4 days = 24 * 4 hours
        '7day': 42, // 7 days = 42 * 4 hours
        '15day': 90, // 15 days = 90 * 4 hours
        '30day': 180, // 30 days = 180 * 4 hours
    }

    let caKdj = (arr, len, opt = {}) => {

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

        let kTime = 'time'
        let kHigh = 'High'
        let kLow = 'Low'
        let kClose = 'Close'

        let period = len //RSV回看期數
        let kAlpha = 1 / 3 //K平滑係數(EMA)
        let dAlpha = 1 / 3 //D平滑係數(EMA)
        let seed = 50 //K與D初始值

        let K = seed
        let D = seed
        let J = null

        //雙端佇列維持period內最高與最低值索引
        let hiDeque = [] //存放可能的最高價之索引, 單調遞增索引, 為遞減
        let loDeque = [] //存放可能的最低價之索引, 單調遞增索引, 為遞增

        //rs
        let rs = []
        for (let i = 0; i < n; i++) {

            //h, l, c
            let h = arr[i][kHigh]
            let l = arr[i][kLow]
            let c = arr[i][kClose]

            //check
            if (!isNumber(h)) {
                throw new Error(`invalid h[${h}]`)
            }
            if (!isNumber(l)) {
                throw new Error(`invalid l[${l}]`)
            }
            if (!isNumber(c)) {
                throw new Error(`invalid c[${c}]`)
            }

            //維護最高價deque, 偵測尾端High值, 若比當前h小則移除, 再把i推入
            while (size(hiDeque) > 0 && arr[last(hiDeque)][kHigh] <= h) {
                hiDeque.pop() //從尾端移除
            }
            hiDeque.push(i)

            //若頭部索引超出視窗起始指標(i-period+1), 則須移除
            while (size(hiDeque) > 0 && hiDeque[0] < (i - period + 1)) {
                hiDeque.shift() //從頭端移除
            }

            //維護最低價deque, 偵測尾端Low值, 若比當前l大則移除, 再把i推入
            while (size(loDeque) > 0 && arr[last(loDeque)][kLow] >= l) {
                loDeque.pop() //從尾端移除
            }
            loDeque.push(i)

            //若頭部索引超出視窗起始指標(i-period+1), 則須移除
            while (size(loDeque) > 0 && loDeque[0] < (i - period + 1)) {
                loDeque.shift() //從頭端移除
            }

            //check, 視窗未滿足period
            if (i < period - 1) {
                // if (fillHead) add(i, null, null)
                continue
            }

            //視窗內最高/最低
            let Hn = arr[hiDeque[0]][kHigh]
            let Ln = arr[loDeque[0]][kLow]

            //RSV
            let RSV = null
            if (Hn === Ln) {
                //避免除以0 , 視窗內價格不變取中性50
                RSV = 50
            }
            else {
                RSV = ((c - Ln) / (Hn - Ln)) * 100
            }

            //平滑計算K,D
            K = kAlpha * RSV + (1 - kAlpha) * K
            D = dAlpha * K + (1 - dAlpha) * D
            J = 3 * K - 2 * D

            //push
            rs.push({
                time: arr[i][kTime],
                K,
                D,
                J,
                KminusD: K - D,
            })

        }
        // console.log('rs', rs)

        return rs
    }

    let caKdjs = (arr, opt = {}) => {

        //rrs
        let rrs = []
        each(kp, (len, period) => {

            //caKdj
            let rs = caKdj(arr, len, opt)

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

    let calcKdj = async(arr, key, opt = {}) => {
        // arr = [
        //   {"time":"2020-01-01T00:00:00","Open":7195,"High":7225.62,"Low":7145.01,"Close":7173.32,"Volumn":4657.972543,"CloseTime":"2020-01-01T03:59:59","QuoteAssetVolume":33441599.81960844,"NumberOfTrades":46046,"TakerBuyBaseAssetVolume":2161.591103,"TakerBuyQuoteAssetVolume":15520451.66291961},
        //   {"time":"2020-01-01T04:00:00","Open":7173.75,"High":7208.41,"Low":7165.1,"Close":7195.23,"Volumn":2091.720176,"CloseTime":"2020-01-01T07:59:59","QuoteAssetVolume":15032938.06298061,"NumberOfTrades":29738,"TakerBuyBaseAssetVolume":1010.628114,"TakerBuyQuoteAssetVolume":7263338.98247078},
        //   {"time":"2020-01-01T08:00:00","Open":7195.24,"High":7245,"Low":7175.46,"Close":7225.01,"Volumn":2833.74918,"CloseTime":"2020-01-01T11:59:59","QuoteAssetVolume":20445895.8017956,"NumberOfTrades":32476,"TakerBuyBaseAssetVolume":1548.865619,"TakerBuyQuoteAssetVolume":11176594.41972043},
        //   {"time":"2020-01-01T12:00:00","Open":7225,"High":7236.27,"Low":7199.11,"Close":7209.83,"Volumn":2061.295051,"CloseTime":"2020-01-01T15:59:59","QuoteAssetVolume":14890182.27509305,"NumberOfTrades":29991,"TakerBuyBaseAssetVolume":1049.711236,"TakerBuyQuoteAssetVolume":7582850.37593562},
        //   ...
        // ]

        // //pickValue
        // let vs = pickValue(arr, key) //轉為 { time, value }

        //caKdjs
        let rs = caKdjs(arr, opt)

        return rs
    }

    return calcKdj
})()


export default calcKdj
